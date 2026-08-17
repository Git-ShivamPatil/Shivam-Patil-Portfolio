import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * P22 — a CycloneDX software bill of materials.
 *
 * **What an SBOM is for.** When a CVE lands against a transitive dependency the
 * only question that matters is "are we running it, and at what version".
 * Answering that by reading a lockfile during an incident is how the answer
 * arrives late. An SBOM is that answer, precomputed, in a format scanners
 * already consume.
 *
 * **This shells out to `pnpm sbom` rather than generating one, and that is the
 * interesting decision.** The first version of this file walked the dependency
 * tree and emitted CycloneDX by hand — about 150 lines. Then it turned out
 * pnpm 11 ships `pnpm sbom` as a first-class command, which produces the same
 * document with licences, external references, registry hashes and a full
 * dependency graph that the hand-rolled version had none of. Keeping the
 * hand-rolled one would have been strictly worse output from strictly more
 * code.
 *
 * That is not a contradiction of this codebase hand-rolling its Redis client,
 * its S3 signing and its OTLP exporter. The test is the same one every time:
 * hand-roll when the protocol is small and completely specified and the
 * dependency is large. Here there is no dependency to add at all — the tool is
 * already installed, because it is the package manager.
 *
 * So this wrapper does only the two things `pnpm sbom` does not:
 *
 * 1. **Makes the output deterministic**, so the artifact can be committed and
 *    diffed. pnpm emits a random `serialNumber` and a wall-clock `timestamp`,
 *    both of which change on every run — which would mean a diff on every CI
 *    run even when not one dependency moved, and a staleness check that can
 *    never pass.
 * 2. **Provides `--check`**, so CI fails when dependencies change without the
 *    SBOM being regenerated. An SBOM that silently drifts out of date is worse
 *    than none, because it will be trusted.
 *
 * `pnpm security:sbom` — writes public/sbom.json, served publicly and read by
 * /security. Everything in it derives from a lockfile that is already in a
 * public repository, so there is nothing here to withhold.
 *
 * NOTE the script name. `pnpm sbom` runs pnpm's *own* command, not this file —
 * a package script cannot shadow a built-in, and the first version of this was
 * silently never executed because of it.
 */

const ROOT = process.cwd();
const OUTPUT = join(ROOT, "public", "sbom.json");

interface Component {
  name?: string;
  version?: string;
  purl?: string;
  "bom-ref"?: string;
}

interface DependencyEdge {
  ref?: string;
  dependsOn?: string[];
}

interface Sbom {
  serialNumber?: string;
  metadata?: { timestamp?: string; [key: string]: unknown };
  components?: Component[];
  dependencies?: DependencyEdge[];
  [key: string]: unknown;
}

const refOf = (component: Component) =>
  component["bom-ref"] ?? component.purl ?? `${component.name}@${component.version}`;

/**
 * Invoke pnpm without going through a shell.
 *
 * `execFileSync("pnpm.cmd", …)` fails with EINVAL on Node 20 and later: the fix
 * for CVE-2024-27980 stopped Node spawning `.cmd` and `.bat` files directly,
 * because the Windows command interpreter re-parses the arguments and an
 * argument containing shell metacharacters became command injection.
 *
 * The usual workaround is `shell: true`, which re-introduces exactly the
 * interpreter that CVE was about. `npm_execpath` avoids it: every package
 * manager sets it to the path of its own JavaScript entry point when running a
 * script, so this runs `node <pnpm.cjs> sbom …` — a real executable with a real
 * argument vector, no shell anywhere. The fallback only matters when the script
 * is run outside a package manager, and it is the plain binary name rather than
 * the `.cmd` shim, which POSIX resolves correctly.
 */
function pnpmCommand(args: string[]): { file: string; argv: string[] } {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.(c?js|mjs)$/.test(execPath)) {
    return { file: process.execPath, argv: [execPath, ...args] };
  }
  return { file: "pnpm", argv: args };
}

function generate(): Sbom {
  const { file, argv } = pnpmCommand([
    "sbom",
    "--sbom-format",
    "cyclonedx",
    // 1.6 rather than the 1.7 default: 1.6 is what the current generation of
    // vulnerability scanners consume without a conversion step, and nothing in
    // 1.7 is needed here.
    "--sbom-spec-version",
    "1.6",
    // Production dependencies only. A devDependency is not in the deployed
    // artifact, so listing it inflates the surface a scanner reports and
    // buries the components that can actually be reached at runtime.
    "--prod",
    "--sbom-type",
    "application",
  ]);

  const raw = execFileSync(file, argv, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw) as Sbom;
}

/**
 * Make the document byte-identical across runs of an unchanged dependency tree.
 *
 * Three sources of churn, and the third was the one that actually mattered:
 *
 * 1. `metadata.timestamp` — wall clock. Removed.
 * 2. `serialNumber` — a random UUID. Replaced with one derived from the sorted
 *    component list, which keeps it a valid v4-shaped UUID while making it
 *    change exactly when the contents do.
 * 3. **Component order.** `pnpm sbom` emits components in a different sequence
 *    on every run — same set, same count, same byte length, different order.
 *    Nothing in CycloneDX requires an order, so this is not a pnpm bug; it just
 *    makes the output undiffable. Sorting by `bom-ref` fixes it, and the
 *    dependency graph needs the same treatment: both the edge list and each
 *    edge's `dependsOn` array.
 *
 * Worth recording how long that took to see: the first attempt compared two
 * runs with PowerShell's `Compare-Object`, which reports *set* differences and
 * duly said only the serial and timestamp differed. It was right about the set
 * and silent about the order. A positional, line-by-line diff found it
 * immediately.
 */
function normalise(sbom: Sbom): string {
  if (sbom.components) {
    sbom.components.sort((a, b) => refOf(a).localeCompare(refOf(b)));
  }

  if (sbom.dependencies) {
    for (const edge of sbom.dependencies) {
      edge.dependsOn?.sort((a, b) => a.localeCompare(b));
    }
    sbom.dependencies.sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? ""));
  }

  const identity = (sbom.components ?? []).map(refOf).join("\n");
  const digest = createHash("sha256").update(identity).digest("hex");
  sbom.serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;

  if (sbom.metadata) delete sbom.metadata.timestamp;

  return `${JSON.stringify(sbom, null, 2)}\n`;
}

const serialised = normalise(generate());
const count = JSON.parse(serialised).components?.length ?? 0;

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(OUTPUT, "utf8");
  } catch {
    console.error("public/sbom.json does not exist. Run `pnpm security:sbom`.");
    process.exit(1);
  }
  if (existing !== serialised) {
    console.error(
      "public/sbom.json is stale — dependencies changed without the SBOM being regenerated.\n" +
        "Run `pnpm security:sbom` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`SBOM is current: ${count} components.`);
  process.exit(0);
}

writeFileSync(OUTPUT, serialised, "utf8");
console.log(`Wrote public/sbom.json — ${count} production components.`);
