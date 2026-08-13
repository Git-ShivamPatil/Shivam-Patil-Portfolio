import { prisma } from "../prisma";
import { terms, tokenize } from "./embed";
import { retrieve } from "./retrieve";

/**
 * P16 — the résumé analyser.
 *
 * Paste a job description, get an honest read on how much of it this portfolio
 * actually evidences — and, for each requirement it does cover, the passage
 * that proves it.
 *
 * **The evidence is the feature.** A percentage on its own is a number anyone
 * can produce and nobody can check; "React — covered, see the agentic AI
 * platform case study" is a claim a reader can click. So every matched
 * requirement carries a retrieved passage, and requirements with no passage are
 * reported as gaps rather than quietly rounded away.
 *
 * **What it is not.** There is no model scoring semantic similarity between a
 * requirement and a career here. It is term matching over the same index the
 * search uses, so it will miss a requirement phrased in words the site never
 * uses — which is stated in the UI rather than hidden, because a coverage
 * number a candidate might quote at an interviewer has to be one they can
 * defend.
 */

/** Ceiling on pasted text. A JD is a page; anything longer is a document dump. */
export const MAX_JD_LENGTH = 12_000;

export interface RequirementMatch {
  /** The requirement line as pasted, trimmed. */
  requirement: string;
  covered: boolean;
  /** Terms from the requirement the corpus can evidence. */
  matchedTerms: string[];
  /** The strongest supporting passage, when there is one. */
  evidence: { title: string; url: string; excerpt: string } | null;
}

export interface ResumeAnalysis {
  /** Percentage of requirement lines with at least one supporting passage. */
  coverage: number;
  requirements: RequirementMatch[];
  /** Skills named in the JD that the site already lists. */
  matchedSkills: string[];
  /** Skills named in the JD that it does not. */
  missingSkills: string[];
  /** How many requirement lines were parsed out of the paste. */
  parsed: number;
}

/**
 * Pull requirement-shaped lines out of a pasted job description.
 *
 * A JD is mostly prose about the company. The lines that describe the job are
 * bullets and short sentences, so those are what get extracted — analysing the
 * whole blob would score a candidate against "we're a fast-paced team that
 * loves ping pong".
 */
export function extractRequirements(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-*·–—>]+/, "").trim())
    .filter(Boolean);

  const requirements = lines.filter((line) => {
    const words = line.split(/\s+/).length;
    // Long enough to state something, short enough to be a requirement rather
    // than a paragraph about culture.
    if (words < 3 || words > 60) return false;
    // Headings ("Requirements:", "About us") state nothing to match against.
    if (/^[A-Za-z ]{2,20}:$/.test(line)) return false;
    return true;
  });

  // Bounded: a pasted 200-line JD would otherwise mean 200 retrieval round
  // trips, and the tail of that list is never the interesting part.
  return requirements.slice(0, 40);
}

/** Terms worth trying to evidence — long enough to be a real technical claim. */
function meaningfulTerms(line: string): string[] {
  return [...new Set(tokenize(line))].filter((token) => token.length >= 3);
}

export async function analyseJobDescription(rawText: string): Promise<ResumeAnalysis> {
  const text = rawText.slice(0, MAX_JD_LENGTH);
  const requirements = extractRequirements(text);

  const skills = await prisma.skill.findMany({ select: { name: true } });
  const skillIndex = new Map<string, string>();
  for (const skill of skills) {
    // Indexed by the skill's own tokens so "Node.js" in the corpus matches
    // "node" in a JD, and a multi-word skill matches on its head term.
    for (const token of tokenize(skill.name)) skillIndex.set(token, skill.name);
  }

  const jdTokens = new Set(tokenize(text));
  const matchedSkills = [
    ...new Set(
      [...jdTokens].flatMap((token) => (skillIndex.has(token) ? [skillIndex.get(token)!] : [])),
    ),
  ].sort();

  // A JD term is "missing" only if it looks like a technology and the site
  // never mentions it. Without that filter every ordinary English word in the
  // paste would be reported as a gap.
  //
  // Document frequency is counted, not just presence, because presence alone is
  // not evidence of anything. "knowledge", "experience" and "build" appear all
  // over a portfolio, so a requirement matching only those matches nothing —
  // and that is exactly how "Deep knowledge of COBOL mainframe migration" came
  // back COVERED on the first live run, with a case study about a banking
  // system as its proof. A term shared with most of the corpus is noise.
  const chunks = await prisma.knowledgeChunk.findMany({ select: { content: true, title: true } });
  const documentFrequency = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of new Set(terms(`${chunk.title} ${chunk.content}`))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const corpusTerms = new Set(documentFrequency.keys());
  for (const skill of skills) {
    for (const token of tokenize(skill.name)) {
      corpusTerms.add(token);
      // A named skill is distinctive by definition, whatever its frequency.
      documentFrequency.set(token, Math.min(documentFrequency.get(token) ?? 1, 1));
    }
  }

  /**
   * Distinctive enough that matching it means something.
   *
   * A quarter of the corpus is the line. Below it a term identifies a subject;
   * above it, it identifies the fact that this is a software portfolio.
   */
  const distinctive = (term: string): boolean => {
    const df = documentFrequency.get(term);
    return df !== undefined && df <= Math.max(1, chunks.length * 0.25);
  };

  const missingSkills = [...jdTokens]
    .filter((token) => TECHY.test(token) && !corpusTerms.has(token))
    .slice(0, 20)
    .sort();

  const results: RequirementMatch[] = [];
  for (const requirement of requirements) {
    const requirementTerms = meaningfulTerms(requirement);
    const matchedTerms = requirementTerms.filter((term) => corpusTerms.has(term));
    const distinctiveMatches = matchedTerms.filter(distinctive);

    // Retrieval runs only for requirements the corpus distinctively speaks to.
    // `retrieve` always returns its best effort — that is what a retriever is
    // for — so calling it for a requirement about nothing we do returns a
    // passage, and treating a passage as proof is how a coverage report starts
    // lying.
    let evidence: RequirementMatch["evidence"] = null;
    if (distinctiveMatches.length >= 1) {
      // Several candidates, not one. The second gate below rejects a passage
      // that does not contain a distinctive term, and checking only the
      // top-ranked result made that gate reject requirements the site plainly
      // covers: "PostgreSQL and Redis at scale" came back a gap because the
      // single best-ranked chunk happened not to name either, while the chunk
      // just behind it listed both. Retrieval order is not the same question as
      // "which passage proves this".
      const candidates = await retrieve(requirement, { limit: 4 });
      const proof = candidates.find((candidate) => {
        const evidenceTerms = new Set(terms(`${candidate.title} ${candidate.content}`));
        return distinctiveMatches.some((term) => evidenceTerms.has(term));
      });

      if (proof) {
        evidence = {
          title: proof.heading ? `${proof.title} — ${proof.heading}` : proof.title,
          url: proof.url,
          excerpt: proof.content.slice(0, 220).trim(),
        };
      }
    }

    results.push({
      requirement,
      covered: evidence !== null,
      // The distinctive ones are what got it there, so those are what is shown.
      matchedTerms: distinctiveMatches.slice(0, 8),
      evidence,
    });
  }

  const covered = results.filter((result) => result.covered).length;

  return {
    coverage: results.length === 0 ? 0 : Math.round((covered / results.length) * 100),
    requirements: results,
    matchedSkills,
    missingSkills,
    parsed: results.length,
  };
}

/**
 * A crude "is this a technology" filter.
 *
 * Deliberately crude, and the UI says so. It catches the shapes technology
 * names actually have — internal capitals or digits, a dot or plus, or
 * membership in a small list of common suffixes — which is enough to keep
 * "collaborate" out of the gap list without pretending to be a taxonomy.
 */
const TECHY = /^(?:[a-z]+\d+|[a-z]*(?:sql|js|db|api|ml|ai|ops|css|html)[a-z]*|[a-z]+\+\+?)$/;
