/**
 * P22 — static analysis, scoped to what a hand-written scanner can honestly do.
 *
 * **This is a grep with judgement, not a dataflow analyser, and the difference
 * decides which rules are worth writing.** Semgrep and CodeQL parse to an AST
 * and track taint from source to sink; they can answer "does user input reach
 * this query". Nothing here can. So every rule below is one that a *syntactic*
 * check answers correctly — the pattern is dangerous wherever it appears,
 * regardless of what flows into it — and the rules that would need taint
 * tracking are deliberately absent rather than approximated.
 *
 * A rule that is right 70% of the time is worse than no rule. Developers learn
 * within a week that the scanner cries wolf, start passing `--no-verify`, and
 * the 30% that mattered goes with it. Every rule here is therefore biased hard
 * towards false negatives: it stays quiet unless the pattern is nearly always
 * a defect in this codebase.
 *
 * Pure and dependency-free so the same rules run in CI, in a unit test, and on
 * the /security page.
 */

export type Severity = "high" | "medium" | "low";

export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  /** Why this pattern is a problem, in one sentence a reviewer can act on. */
  rationale: string;
  pattern: RegExp;
  /** Files this rule applies to. */
  includes?: RegExp;
  /** An escape hatch for the lines that are legitimately fine. */
  allow?: RegExp;
}

export const RULES: Rule[] = [
  {
    id: "raw-sql-interpolation",
    severity: "high",
    title: "Raw SQL built by interpolation",
    rationale:
      "$queryRawUnsafe and $executeRawUnsafe take a string, so any interpolation into them is a SQL injection unless every input is provably internal. The tagged-template forms ($queryRaw`…`) parameterise instead and should be used unless there is a reason not to.",
    pattern: /\$(?:query|execute)RawUnsafe\s*\(/,
  },
  {
    id: "dangerous-html",
    severity: "high",
    title: "dangerouslySetInnerHTML without a sanitiser",
    rationale:
      "React escapes by default; this opts out. It is safe only when the HTML is authored by us or has been through a sanitiser on the same line.",
    // The `=` is load-bearing: it matches the JSX attribute rather than the
    // bare identifier, so prose about the prop in a comment and this very rule
    // definition stop matching. Both did, before.
    pattern: /dangerouslySetInnerHTML\s*=/,
    allow: /sanitiz|sanitis|escapeHtml|DOMPurify|jsonForScript/i,
  },
  {
    id: "eval",
    severity: "high",
    title: "eval or Function constructor",
    rationale:
      "Executes a string as code. Even where the string is currently constant, it defeats CSP and turns any future injection into remote code execution.",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    id: "child-process-interpolation",
    severity: "high",
    title: "Shell command built from a template literal",
    rationale:
      "exec and execSync run through a shell, so an interpolated value can end the command and start another. execFile with an argument array does not.",
    pattern: /exec(?:Sync)?\s*\(\s*`[^`]*\$\{/,
  },
  {
    id: "hardcoded-secret",
    severity: "high",
    title: "Credential-shaped literal in source",
    rationale:
      "A key committed to the repository is a key in every clone, every fork and the reflog, and rotating it is the only remediation.",
    // Deliberately narrow: real prefixes with a real length, not "any long
    // string", which would flag every hash and base64 fixture in the tests.
    pattern:
      /(?:sk_live_[A-Za-z0-9]{16,}|rzp_live_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/,
    // AWS publishes AKIAIOSFODNN7EXAMPLE in its own signing documentation and
    // it is the standard fixture for SigV4 tests. Every vendor's example
    // credentials carry a marker like this precisely so scanners can skip them.
    allow: /EXAMPLE|example_key|\bplaceholder\b/,
  },
  {
    id: "md5-or-sha1",
    severity: "medium",
    title: "MD5 or SHA-1 used for a security purpose",
    rationale:
      "Both have practical collision attacks. Fine for a cache key, never for a signature, a token or an integrity check.",
    pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']/,
  },
  {
    id: "weak-random-for-secrets",
    severity: "medium",
    // sast-ignore: weak-random-for-secrets — this is the rule's own title, matched by the rule.
    title: "Math.random() used to build a token",
    rationale:
      "Math.random is not a CSPRNG and its output is predictable from a few samples. Anything a user must not guess needs crypto.randomUUID or randomBytes.",
    pattern: /Math\.random\(\)/,
    // Excluded: the seeded PRNGs, whose whole purpose is reproducibility a
    // CSPRNG cannot provide, and the test suites, where `key-${Math.random()}`
    // is isolating one test's rate-limit bucket from another's and no attacker
    // is present. Scoping a rule to where its rationale actually holds is the
    // difference between a scanner people read and one they mute.
    includes: /^(?!(?:tests|e2e)\/)(?!.*(?:raft|chaos|graph|seeded)).*$/,
  },
  {
    id: "timing-unsafe-compare",
    severity: "medium",
    title: "Secret compared with ===",
    rationale:
      "String comparison short-circuits on the first differing byte, so the time it takes leaks how much of a guess was correct. Use timingSafeEqual behind a length check.",
    pattern: /(?:secret|token|signature|hmac|apiKey)\s*===\s*/i,
    // `x === undefined` is a presence check, not a comparison of two secrets,
    // and there is no timing signal in it to leak.
    allow: /timingSafeEqual|secretsMatch|===\s*(?:undefined|null)\b/,
  },
  {
    id: "http-url",
    severity: "low",
    title: "Plaintext http:// URL",
    rationale:
      "Anything fetched over http can be read and rewritten in transit. localhost is exempt because there is no network to intercept.",
    // A bare "http://" with no host is a malformed-URL fixture, not a fetch.
    pattern: /["'`]http:\/\/\w/,
    // XML and SAML namespace URIs are identifiers that happen to look like
    // URLs. Nothing dereferences them, and changing them to https would break
    // every signature comparison they appear in.
    allow: /localhost|127\.0\.0\.1|schemas?\.|www\.w3\.org|xmlsoap\.org|oasis-open\.org/,
  },
  {
    id: "permissive-cors",
    severity: "medium",
    // sast-ignore: permissive-cors — this is the rule's own title, matched by the rule.
    title: "Access-Control-Allow-Origin: *",
    rationale:
      "A wildcard origin lets any site read the response. Harmless on a public asset, a data leak on anything that varies by session.",
    pattern: /Access-Control-Allow-Origin["'\s:]+\*/,
  },
];

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  rationale: string;
  file: string;
  line: number;
  /** The offending line, trimmed and truncated — never the whole file. */
  excerpt: string;
}

/** `// sast-ignore: rule-id — reason` on the line above suppresses one rule. */
const IGNORE = /\/\/\s*sast-ignore:\s*([\w-]+)/;

/**
 * Lines that are entirely comment.
 *
 * **The single largest source of false positives before this existed.** This
 * codebase documents its own security decisions at length, so the prose
 * explaining why `dangerouslySetInnerHTML` is dangerous matched the rule
 * looking for `dangerouslySetInnerHTML` — the scanner was flagging the
 * documentation of the very defence it was checking for.
 *
 * A line-based approximation, and it is honest about being one: a `/* … *​/`
 * block opened on an earlier line is not tracked, so prose inside a multi-line
 * block whose lines do not start with `*` still matches. Tracking block state
 * properly needs a tokeniser, which is the point where this should stop being
 * a regex scanner and start being Semgrep.
 */
const COMMENT_ONLY = /^\s*(?:\/\/|\*|\/\*)/;

export function scanSource(file: string, source: string, rules: Rule[] = RULES): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split(/\r?\n/);

  for (const rule of rules) {
    if (rule.includes && !rule.includes.test(file)) continue;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (COMMENT_ONLY.test(line)) continue;
      if (!rule.pattern.test(line)) continue;
      if (rule.allow?.test(line)) continue;

      // A suppression on the line itself or the one above, naming the rule.
      // Naming it matters: a bare ignore comment silences rules nobody
      // considered, including ones added after the comment was written.
      const previous = index > 0 ? lines[index - 1] : "";
      const suppression = IGNORE.exec(line) ?? IGNORE.exec(previous);
      if (suppression && suppression[1] === rule.id) continue;

      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        rationale: rule.rationale,
        file,
        line: index + 1,
        excerpt: line.trim().slice(0, 160),
      });
    }
  }

  return findings;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

export function summarise(findings: Finding[]): Record<Severity, number> {
  return findings.reduce(
    (totals, finding) => {
      totals[finding.severity] += 1;
      return totals;
    },
    { high: 0, medium: 0, low: 0 } as Record<Severity, number>,
  );
}
