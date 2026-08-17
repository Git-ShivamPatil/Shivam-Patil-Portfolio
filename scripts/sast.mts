import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { RULES, scanSource, sortFindings, summarise, type Finding } from "../lib/secops/sast.ts";

/**
 * P22 — the SAST runner.
 *
 * Walks the first-party source and applies lib/secops/sast.ts. Exits non-zero
 * on any `high` finding and zero otherwise, so CI fails on the severities that
 * warrant blocking a merge and merely reports the rest. A scanner that fails
 * the build on every low-severity nit is a scanner that gets disabled.
 *
 * `pnpm sast`, or `pnpm sast --json` for machine-readable output.
 */

const ROOT = process.cwd();

/** First-party source only. */
const SCAN_DIRS = ["app", "components", "lib", "scripts", "assembly", "prisma", "e2e", "tests"];
const SCAN_FILES = ["auth.ts", "auth.config.ts", "proxy.ts", "instrumentation.ts", "next.config.ts"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "generated", "ignore_old"]);
const EXTENSIONS = /\.(ts|tsx|js|jsx|mts|mjs)$/;

/**
 * The scanner's own test corpus.
 *
 * **A test for a scanner has to contain the patterns the scanner detects.**
 * `tests/p22-secops.test.ts` asserts that `$queryRawUnsafe`, `eval(` and an
 * AWS-shaped key are flagged, so it necessarily holds all three as fixture
 * strings, and scanning it reports seven findings that are all the test working
 * correctly. Semgrep and CodeQL exclude their own corpora for exactly this
 * reason.
 *
 * Excluded by exact path rather than by a `tests/` blanket, so the other
 * twenty-two suites stay in scope. This is the third self-reference this phase
 * produced: the rule table matched its own patterns, P13's raw-SQL test matched
 * the rule table, and now the scanner matches its own tests. Two scanners in
 * one repository will always find each other, and the answer each time is a
 * narrow named exclusion rather than a broad one.
 */
const SELF_REFERENTIAL = new Set(["tests/p22-secops.test.ts"]);

function walk(directory: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(directory, entry.name), found);
    } else if (EXTENSIONS.test(entry.name)) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

const files: string[] = [];
for (const directory of SCAN_DIRS) files.push(...walk(join(ROOT, directory)));
for (const file of SCAN_FILES) {
  try {
    if (statSync(join(ROOT, file)).isFile()) files.push(join(ROOT, file));
  } catch {
    /* not present in this checkout */
  }
}

const findings: Finding[] = [];
let skipped = 0;

for (const file of files) {
  // Posix separators so a rule's `includes` pattern behaves the same on
  // Windows and in CI — this repo is developed on one and built on the other.
  const label = relative(ROOT, file).split(sep).join("/");
  if (SELF_REFERENTIAL.has(label)) {
    skipped += 1;
    continue;
  }
  findings.push(...scanSource(label, readFileSync(file, "utf8")));
}

const sorted = sortFindings(findings);
const totals = summarise(sorted);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scanned: files.length, rules: RULES.length, totals, findings: sorted }, null, 2));
} else {
  // The skipped count is printed, never silent. A scanner that quietly drops
  // files from its own coverage reports "no findings" for a reason the reader
  // cannot see, which is the same failure mode as a silently stale SBOM.
  console.log(
    `\nSAST — ${files.length - skipped} files, ${RULES.length} rules` +
      (skipped > 0 ? ` (${skipped} self-referential file skipped)` : "") +
      "\n",
  );
  for (const finding of sorted) {
    console.log(`  [${finding.severity.toUpperCase()}] ${finding.file}:${finding.line}  ${finding.title}`);
    console.log(`      ${finding.excerpt}`);
    console.log(`      ${finding.rationale}\n`);
  }
  console.log(
    sorted.length === 0
      ? "  No findings.\n"
      : `  ${totals.high} high, ${totals.medium} medium, ${totals.low} low\n`,
  );
}

process.exit(totals.high > 0 ? 1 : 0);
