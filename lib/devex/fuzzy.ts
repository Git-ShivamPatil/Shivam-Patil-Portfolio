/**
 * P17 — subsequence fuzzy matching for the command palette and the terminal.
 *
 * **Subsequence, not substring, and not Levenshtein.** A command palette is
 * used by typing initials — "sd" for "System design", "adl" for "Admin ·
 * Live" — which a substring match cannot serve at all. Edit distance would
 * serve it but is the wrong shape: it measures how much two strings differ,
 * when the question here is "does everything the user typed appear, in order,
 * and how well". Those are different questions, and only the second one
 * explains why "sd" should rank "System design" above "Skills · databases".
 *
 * The scoring is where a palette feels good or bad, so each bonus below exists
 * for a specific typing habit rather than as a tuning knob.
 *
 * Pure and dependency-free: it runs in the browser on every keystroke, and it
 * is the kind of thing that is easy to get subtly wrong and easy to test.
 */

export interface FuzzyMatch {
  /** Higher is better. 0 means no match. */
  score: number;
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[];
}

const NO_MATCH: FuzzyMatch = { score: 0, positions: [] };

/** Bonus for a character that starts a word — how initials-typing wins. */
const WORD_START_BONUS = 12;
/** Bonus for continuing a run, so contiguous typing beats scattered hits. */
const CONSECUTIVE_BONUS = 8;
/** Bonus for matching the very first character of the haystack. */
const LEADING_BONUS = 10;
/** Penalty per skipped character, so an early match beats a late one. */
const GAP_PENALTY = 1;

/**
 * Fold accents so "resume" finds "Résumé".
 *
 * Found by a test, and it was a real hole rather than a nicety: the site labels
 * that page with its accents, almost nobody types them, and a strict comparison
 * meant the query "resume" scored the page **zero** while ranking
 * "Achievements" first — because "resume" happens to be a subsequence of its
 * keyword list. So the palette confidently offered the wrong page for one of
 * the most likely searches on a portfolio.
 *
 * NFKD splits a letter from its combining mark; the range strips the marks. The
 * same fold `lib/ai/embed.ts` applies for the same reason.
 *
 * Length is preserved by construction — every stripped mark was a separate code
 * point — so the indices this returns still address the original string and the
 * highlight positions stay correct.
 */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  return previous === " " || previous === "-" || previous === "_" || previous === "/" || previous === ".";
}

/**
 * Score `needle` against `haystack`.
 *
 * Greedy left-to-right rather than an optimal alignment. Optimal matching is a
 * dynamic program over needle × haystack, and for a palette over a few hundred
 * short strings that is real work on every keystroke to change the ordering of
 * results that are already right. Greedy has one visible weakness — it can take
 * an early character that a later one would have used better — and the word-
 * start bonus is what keeps that from mattering on the strings this actually
 * searches.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch {
  const query = fold(needle.trim().toLowerCase());
  if (!query) return { score: 1, positions: [] };

  const target = fold(haystack.toLowerCase());
  if (query.length > target.length) return NO_MATCH;

  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousMatch = -1;

  for (const character of query) {
    // Spaces in a query are separators, not characters to find: "sys des"
    // should behave like "sysdes".
    if (character === " ") continue;

    const found = target.indexOf(character, cursor);
    if (found === -1) return NO_MATCH;

    positions.push(found);
    score += 1;

    if (isWordBoundary(target, found)) score += WORD_START_BONUS;
    if (found === 0) score += LEADING_BONUS;
    if (previousMatch !== -1 && found === previousMatch + 1) score += CONSECUTIVE_BONUS;
    else if (previousMatch !== -1) score -= Math.min(GAP_PENALTY * (found - previousMatch - 1), 8);

    previousMatch = found;
    cursor = found + 1;
  }

  // Shorter haystacks win ties: with "ask" typed, the page called "Ask" should
  // beat "Ask about the architecture".
  score += Math.max(0, 12 - target.length / 4);

  return { score: Math.max(score, 1), positions };
}

export interface Rankable {
  /** The text matched against. */
  label: string;
  /** Extra text that should also match but ranks lower — a description, a path. */
  keywords?: string;
}

export interface Ranked<T extends Rankable> {
  item: T;
  score: number;
  positions: number[];
}

/**
 * Rank a list, best first.
 *
 * Keyword matches are scored at a discount rather than equally: something whose
 * *name* matches is what the user meant, and something whose description
 * happens to contain the letters usually is not.
 */
export function rank<T extends Rankable>(query: string, items: T[], limit = 12): Ranked<T>[] {
  const trimmed = query.trim();

  if (!trimmed) {
    // No query is not "no results" — an empty palette should still offer the
    // list in its authored order.
    return items.slice(0, limit).map((item) => ({ item, score: 1, positions: [] }));
  }

  const results: Ranked<T>[] = [];
  for (const item of items) {
    const direct = fuzzyMatch(trimmed, item.label);
    if (direct.score > 0) {
      results.push({ item, score: direct.score, positions: direct.positions });
      continue;
    }
    if (item.keywords) {
      const indirect = fuzzyMatch(trimmed, item.keywords);
      if (indirect.score > 0) {
        results.push({ item, score: indirect.score * 0.4, positions: [] });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
