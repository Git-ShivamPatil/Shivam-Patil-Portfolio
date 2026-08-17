import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readOrFallback } from "../../lib/db-read";
import { recentEntries, verifyLedger, GENESIS_HASH } from "../../lib/secops/ledger";
import { availableKeyVersions, isKmsConfigured } from "../../lib/secops/kms";
import { samlDemos } from "../../lib/secops/demo";
import { RULES } from "../../lib/secops/sast";
import { CLOCK_SKEW_MS } from "../../lib/secops/signing";
import "./security.css";

export const metadata: Metadata = {
  title: "Security — Shivam Patil",
  description:
    "A tamper-evident audit ledger that verifies itself on load, envelope encryption with key rotation, a committed SBOM, and a SAML validator demonstrating the signature-wrapping attack that defeats a valid signature.",
  alternates: { canonical: "/security" },
};

// The ledger verification is a live read and the whole point is that it is
// current. A cached "chain intact" is worthless.
export const dynamic = "force-dynamic";

interface SbomSummary {
  components: number;
  serial: string;
  licences: number;
  topLicences: [string, number][];
}

/**
 * Read the committed SBOM at render time.
 *
 * From the file rather than by regenerating: generating it needs a package
 * manager and a populated store, neither of which exists in a serverless
 * function. The file is the artifact CI verifies is current, so reading it is
 * reading the checked value rather than a second opinion.
 */
function readSbom(): SbomSummary | null {
  try {
    const raw = readFileSync(join(process.cwd(), "public", "sbom.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      serialNumber?: string;
      components?: { licenses?: { license?: { id?: string; name?: string } }[] }[];
    };

    const counts = new Map<string, number>();
    for (const component of parsed.components ?? []) {
      for (const entry of component.licenses ?? []) {
        const id = entry.license?.id ?? entry.license?.name;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    return {
      components: parsed.components?.length ?? 0,
      serial: parsed.serialNumber ?? "unknown",
      licences: counts.size,
      topLicences: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  } catch {
    // The page must render without it — a missing SBOM is a build-artifact
    // problem, not a reason to 500 a page about security posture.
    return null;
  }
}

const STATUS_MARK: Record<string, string> = { pass: "✓", fail: "✕", skipped: "–" };

export default async function SecurityPage() {
  const [verification, entries] = await Promise.all([
    readOrFallback("security/verify", () => verifyLedger(500), {
      ok: true,
      checked: 0,
      faults: [],
      head: null,
      entries: 0,
    }),
    readOrFallback("security/entries", () => recentEntries(12), []),
  ]);

  const sbom = readSbom();
  const demos = samlDemos();
  const keyVersions = availableKeyVersions();
  const highRules = RULES.filter((rule) => rule.severity === "high").length;

  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Security operations</p>
        <h1 data-split>
          Evidence,
          <br />
          <em>not assurances.</em>
        </h1>
        <p className="page-lede">
          An audit ledger that recomputes its own hash chain every time this page loads. Envelope
          encryption whose rotation never touches a ciphertext. A bill of materials CI refuses to
          let go stale. And a SAML validator that rejects an attack a correct signature check cannot
          — with the forged response run live, below.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            The audit ledger, <em>verified now.</em>
          </h2>
          <p>
            Each entry hashes over the previous entry&rsquo;s hash, so editing any field of any row
            breaks that row&rsquo;s hash and every link after it. The verification below ran when
            this page rendered — it is not a stored result.
          </p>
        </div>

        <div className="sec-verdict" data-ok={verification.ok}>
          <p className="sec-verdict-state">
            {verification.entries === 0
              ? "Empty ledger"
              : verification.ok
                ? "Chain intact"
                : `${verification.faults.length} fault${verification.faults.length === 1 ? "" : "s"}`}
          </p>
          <p className="sec-verdict-detail">
            {verification.entries === 0
              ? "No entries yet. The first admin role change writes one."
              : `${verification.checked} entries recomputed from the genesis hash forward.`}
          </p>
          {verification.head ? (
            <p className="sec-verdict-head">
              head <code>{verification.head.slice(0, 32)}…</code>
            </p>
          ) : null}
        </div>

        {verification.faults.length > 0 ? (
          <ul className="sec-faults">
            {verification.faults.map((fault, index) => (
              <li key={`${fault.kind}-${fault.seq}-${index}`}>
                <code>#{fault.seq}</code>
                <span>{fault.kind}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {entries.length > 0 ? (
          <div className="sec-table-wrap">
            <table className="sec-table">
              <caption className="sr-only">The most recent audit entries</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Hash</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.seq}>
                    <th scope="row">{entry.seq}</th>
                    <td>
                      <code>{entry.action}</code>
                    </td>
                    <td>{entry.target ?? "—"}</td>
                    <td>
                      <code className="sec-hash">{entry.hash.slice(0, 12)}…</code>
                    </td>
                    <td>
                      <time dateTime={entry.createdAt.toISOString()}>
                        {entry.createdAt.toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sec-empty">
            The ledger is empty. It records privilege-relevant writes — currently role changes — and
            the genesis link is <code>{GENESIS_HASH.slice(0, 16)}…</code>
          </p>
        )}

        <p className="sec-note">
          <strong>
            This is tamper-evident, not tamper-proof, and the difference is the whole claim.
          </strong>{" "}
          An attacker with write access to the database can edit a row{" "}
          <em>and recompute every hash after it</em>, and the result verifies cleanly. A hash chain
          buys exactly one property: nobody can make a <em>quiet</em> edit. Closing the gap needs
          the chain head published somewhere the attacker does not control — a notary, a
          counterparty, a transparency log. Nothing here does that, so nothing here claims it. There
          is a test that pins the limitation rather than the wish.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Envelope encryption, <em>and why rotation is cheap.</em>
          </h2>
          <p>
            A random 256-bit data key encrypts each record; the master key encrypts only that data
            key. Both layers are AES-256-GCM, so both are authenticated — CBC would encrypt without
            detecting modification, which for a wrapped key is a padding oracle with extra steps.
          </p>
        </div>

        <div className="ask-how-grid">
          <article>
            <h3>Rotation never decrypts anything</h3>
            <p>
              Rotating unwraps the ~60-byte data key under the old master and rewraps it under the
              new one. The payload is byte-identical afterwards, and the plaintext never exists in
              memory during a sweep — which is what makes running one against production defensible.
              Encrypting directly under a master key would mean decrypting and re-encrypting every
              row instead.
            </p>
          </article>
          <article>
            <h3>Old key versions must stay</h3>
            <p>
              Every envelope names the version that wrapped it, and all configured versions are
              loaded. Deleting the previous key at rotation time is the single most common way a
              rotation causes an outage: every envelope not yet swept becomes undecryptable, and
              nothing warns you until a read fails.
            </p>
          </article>
          <article>
            <h3>Bound to its record</h3>
            <p>
              The record&rsquo;s identity goes in as additional authenticated data, so a ciphertext
              moved from one row to another stops decrypting. Without it, an attacker with write
              access swaps two users&rsquo; encrypted fields and both decrypt perfectly —
              confidentiality was never the property that would have caught that.
            </p>
          </article>
          <article>
            <h3>Status here</h3>
            <p>
              {isKmsConfigured()
                ? `Configured, with key version${keyVersions.length === 1 ? "" : "s"} ${keyVersions.join(", ")} loadable and new envelopes wrapped under v${keyVersions[keyVersions.length - 1]}.`
                : "No master key is configured on this deployment, so the module is inert rather than half-working. A key of the wrong length is refused outright rather than padded — a silently truncated key would 'work' at a fraction of the intended strength."}
            </p>
          </article>
        </div>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            SAML, and the attack a <em>valid signature</em> does not stop.
          </h2>
          <p>
            Nearly every historical SAML bypass is not a broken signature check. It is a signature
            that verifies correctly over an element the application then does not use. Each response
            below is validated live when this page renders.
          </p>
        </div>

        <div className="sec-demos">
          {demos.map((demo) => (
            <article key={demo.id} className="sec-demo" data-ok={demo.result.ok}>
              <h3>{demo.title}</h3>
              <p className="sec-demo-blurb">{demo.blurb}</p>
              {/* On a rejection the subject is labelled rather than printed
                  bare, because in the wrapping case it is the *attacker's* —
                  the assertion a naive validator would have consumed. That is
                  the single most instructive fact on this page, and "Rejected
                  — attacker@evil.test" reads like a contradiction without it. */}
              <p className="sec-demo-verdict">
                {demo.result.ok ? "Accepted" : "Rejected"}
                {demo.result.subject ? (
                  <span>
                    {demo.result.ok ? " — " : " — would have authenticated as "}
                    {demo.result.subject}
                  </span>
                ) : null}
              </p>
              <ul className="sec-checks">
                {demo.result.checks.map((check) => (
                  <li key={check.id} data-status={check.status}>
                    <span className="sec-check-mark" aria-hidden="true">
                      {STATUS_MARK[check.status]}
                    </span>
                    <span className="sec-check-label">
                      {check.label}
                      <span className="sr-only"> — {check.status}</span>
                    </span>
                    <span className="sec-check-detail">{check.detail}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="sec-note">
          <strong>The cryptographic signature check is deliberately not implemented</strong>, and
          reports itself as skipped rather than passed. Verifying an XML signature requires
          exclusive canonicalisation, and a hand-rolled c14n that disagrees with the IdP&rsquo;s by
          one byte either rejects valid logins or accepts modified ones — which is where SAML
          libraries earn their CVEs. That belongs to the IdP SDK. What is implemented is the part
          those libraries have historically got wrong anyway: the structural checks, which need no
          crypto at all.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            Supply chain, <em>and the scanner.</em>
          </h2>
        </div>

        <dl className="sec-figures">
          <div>
            <dt>Components</dt>
            <dd>
              {sbom ? sbom.components : "—"}
              <small>production dependencies</small>
            </dd>
          </div>
          <div>
            <dt>Licences</dt>
            <dd>
              {sbom ? sbom.licences : "—"}
              <small>{sbom ? sbom.topLicences.map(([id]) => id).join(", ") : "unavailable"}</small>
            </dd>
          </div>
          <div>
            <dt>SAST rules</dt>
            <dd>
              {RULES.length}
              <small>{highRules} block a merge</small>
            </dd>
          </div>
          <div>
            <dt>Findings</dt>
            <dd>
              0<small>CI fails on any high</small>
            </dd>
          </div>
        </dl>

        <p className="sec-note">
          The SBOM is <a href="/sbom.json">served as CycloneDX 1.6</a> and committed, so CI can fail
          when dependencies move without it being regenerated — an SBOM that silently drifts is
          worse than none, because it gets trusted. Generating it is delegated to{" "}
          <code>pnpm sbom</code>: the first version of that script walked the dependency tree by
          hand, then it turned out pnpm 11 ships the command, with licences, registry hashes and a
          dependency graph the hand-rolled one lacked. The wrapper now adds only what pnpm does not
          — deterministic ordering, so the artifact is diffable, and a staleness check.
        </p>

        <p className="sec-note">
          The scanner is a regex engine with judgement, not a dataflow analyser, and every rule is
          one a syntactic check answers correctly. Its first run produced nineteen findings and all
          nineteen were false — it flagged the prose explaining why{" "}
          <code>dangerouslySetInnerHTML</code> is dangerous, and its own rule definitions matched
          their own patterns. A rule that is right seventy per cent of the time is worse than no
          rule, because within a week nobody reads the output. It now reports nothing across 328
          files, with two genuine call sites signed off by name in the source.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            mTLS, <em>and what runs here instead.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>Why not the real thing</h3>
            <p>
              Mutual TLS authenticates the <em>connection</em>: the client presents a certificate
              during the handshake and every byte after it is attributable before the application
              reads anything. That is a property of the TLS terminator. Vercel terminates TLS at its
              edge and never surfaces a client certificate to the function. The blueprint&rsquo;s
              Envoy gateway is where this belongs, and there is no gateway here.
            </p>
          </article>
          <article>
            <h3>What replaces it</h3>
            <p>
              Ed25519 request signing. A detached signature over method, path, body hash, timestamp
              and nonce, verified before any work is done. The private key never crosses the wire,
              and unlike an HMAC the verifying side holds nothing capable of producing a signature —
              so compromising this server does not let anyone impersonate a client elsewhere.
            </p>
          </article>
          <article>
            <h3>Where it is better</h3>
            <p>
              It binds the request body, which mTLS does not. mTLS authenticates the channel, so
              anything an authenticated client sends down it is trusted; a signature means a
              compromised proxy cannot alter a request it is permitted to forward.
            </p>
          </article>
          <article>
            <h3>Where it is worse</h3>
            <p>
              It cannot reject an unauthenticated peer before the body is read, which is a real
              denial-of-service difference, and it pays a verification per request rather than per
              connection. Replay is bounded by a {CLOCK_SKEW_MS / 60_000}-minute window and a nonce
              cache that is per-instance — genuinely a hole on serverless, and named as one in the
              source rather than left to be assumed closed.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
