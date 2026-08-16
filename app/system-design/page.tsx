import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";

// P18. The page is otherwise `○` static and hydrates nothing; the simulator is the
// one interactive thing on it, so it is code-split rather than bundled into a
// page most readers will scroll past.
const RaftVisualizer = dynamic(() =>
  import("../../components/distsys/raft-visualizer").then((m) => m.RaftVisualizer),
);
import "./system-design.css";

export const metadata: Metadata = {
  title: "System design — Shivam Patil",
  description:
    "How this site is actually built: the request path, the data model, the twenty build phases, and the trade-offs behind each decision.",
  alternates: { canonical: "/system-design" },
};

/**
 * The system-design page.
 *
 * Every diagram here is hand-written SVG inside a server component, which is
 * the same call P8 and P10 made for the admin charts: a charting or diagram
 * library would ship tens of kilobytes of client JavaScript to draw shapes
 * that are already known at build time. Nothing on this page hydrates.
 *
 * All strokes and fills read theme tokens (--fg, --accent, --line, --surface)
 * rather than literals, so both diagrams follow the pink/cream and neon/black
 * palettes without a second set of rules. That is also why there is no
 * hardcoded colour anywhere below — a literal here would be the seventh colour
 * defect of the theme work.
 *
 * The content is the REAL architecture, not the original brief's. BUILD-SPEC.md
 * asked for Redis, WebSockets, pgvector and Docker; two of those four have since
 * arrived — pgvector carries the P16 retrieval index, and a Dockerfile exists
 * that is deliberately not the deploy path — and the "spec vs built" section at
 * the bottom accounts for all four either way, rather than diagramming a system
 * that does not exist. A page whose whole premise is that it describes what is
 * running has to be re-checked against HANDOFF.md whenever a phase lands.
 */

/* ---------- diagram 1: the request path ---------- */

const REQUEST_LAYERS = [
  {
    id: "client",
    label: "Client",
    y: 16,
    nodes: [{ x: 20, w: 200, title: "Browser", sub: "React 19 · islands only" }],
  },
  {
    id: "edge",
    label: "Edge",
    y: 104,
    nodes: [
      { x: 20, w: 200, title: "Vercel CDN", sub: "static + ISR cache" },
      { x: 244, w: 200, title: "proxy.ts", sub: "auth gate, no adapter" },
    ],
  },
  {
    id: "app",
    label: "Application",
    y: 192,
    nodes: [
      { x: 20, w: 200, title: "Server Components", sub: "render + data fetch" },
      { x: 244, w: 200, title: "Route Handlers", sub: "/api/*" },
      { x: 468, w: 200, title: "after()", sub: "post-response writes" },
    ],
  },
  {
    id: "data",
    label: "Data",
    y: 280,
    nodes: [
      { x: 20, w: 200, title: "Prisma 7", sub: "Neon driver adapter" },
      { x: 244, w: 200, title: "readOrFallback", sub: "degrade, never 500" },
    ],
  },
  {
    id: "stores",
    label: "Stores & third parties",
    y: 368,
    nodes: [
      { x: 20, w: 200, title: "Neon Postgres", sub: "pooled · single source" },
      { x: 244, w: 200, title: "Resend", sub: "transactional mail" },
      { x: 468, w: 200, title: "Cloudflare R2", sub: "presigned PUT" },
    ],
  },
] as const;

const REQUEST_EDGES = [
  { from: [120, 62], to: [120, 104] },
  { from: [120, 62], to: [344, 104] },
  { from: [120, 150], to: [120, 192] },
  { from: [344, 150], to: [344, 192] },
  { from: [120, 238], to: [120, 280] },
  { from: [344, 238], to: [344, 280] },
  { from: [568, 238], to: [344, 280] },
  { from: [120, 326], to: [120, 368] },
  { from: [344, 326], to: [120, 368] },
  { from: [568, 238], to: [568, 368] },
] as const;

function RequestPathDiagram() {
  return (
    <svg
      className="sd-diagram"
      viewBox="0 0 700 430"
      role="img"
      aria-labelledby="sd-req-title sd-req-desc"
    >
      <title id="sd-req-title">Request path</title>
      <desc id="sd-req-desc">
        A request enters through the Vercel CDN and the proxy auth gate, is rendered by server
        components or handled by a route handler, reaches Postgres through Prisma behind a
        fallback-on-failure read wrapper, and fans out to Resend and R2 for mail and object storage.
      </desc>

      {REQUEST_EDGES.map((e, i) => (
        <path
          key={i}
          className="sd-edge"
          d={`M ${e.from[0]} ${e.from[1]} C ${e.from[0]} ${(e.from[1] + e.to[1]) / 2}, ${e.to[0]} ${(e.from[1] + e.to[1]) / 2}, ${e.to[0]} ${e.to[1]}`}
          style={{ ["--i" as string]: i }}
        />
      ))}

      {REQUEST_LAYERS.map((layer) => (
        <g key={layer.id}>
          <text className="sd-layer-label" x="700" y={layer.y + 26} textAnchor="end">
            {layer.label}
          </text>
          {layer.nodes.map((n) => (
            <g key={n.title} className="sd-node">
              <rect x={n.x} y={layer.y} width={n.w} height="46" rx="12" />
              <text className="sd-node-title" x={n.x + 14} y={layer.y + 20}>
                {n.title}
              </text>
              <text className="sd-node-sub" x={n.x + 14} y={layer.y + 36}>
                {n.sub}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ---------- diagram 2: the data model ---------- */

const ENTITIES = [
  { x: 24, y: 20, w: 190, name: "User", fields: ["id", "email", "role", "passwordHash"] },
  { x: 264, y: 20, w: 190, name: "Project", fields: ["slug", "title", "accent", "tags[]"] },
  { x: 504, y: 20, w: 190, name: "BlogPost", fields: ["slug", "published", "content"] },
  { x: 24, y: 178, w: 190, name: "Booking", fields: ["reference", "status", "amountMinor"] },
  { x: 264, y: 178, w: 190, name: "ReferralLink", fields: ["code", "clicks", "uniques"] },
  { x: 504, y: 178, w: 190, name: "PageView", fields: ["viewId", "day", "visitorHash"] },
  { x: 24, y: 322, w: 190, name: "ContactMessage", fields: ["email", "referralRef"] },
  { x: 264, y: 322, w: 190, name: "MediaAsset", fields: ["sha256", "url", "bytes"] },
  { x: 504, y: 322, w: 190, name: "HeatmapCell", fields: ["gridX", "gridY", "count"] },
] as const;

const RELATIONS = [
  { from: [119, 128], to: [119, 178], label: "places" },
  { from: [359, 128], to: [359, 178], label: "attributed by" },
  { from: [214, 214], to: [264, 214], label: "referralRef" },
  { from: [214, 358], to: [264, 358], label: "" },
  { from: [599, 128], to: [599, 178], label: "viewed as" },
  { from: [599, 250], to: [599, 322], label: "aggregates to" },
] as const;

function DataModelDiagram() {
  return (
    <svg
      className="sd-diagram"
      viewBox="0 0 718 420"
      role="img"
      aria-labelledby="sd-data-title sd-data-desc"
    >
      <title id="sd-data-title">Core data model</title>
      <desc id="sd-data-desc">
        Nine of the principal tables. A user places bookings; referral links attribute contact
        messages, bookings and newsletter signups through a shared referralRef; page views aggregate
        into heatmap cells rather than being stored as raw coordinates.
      </desc>

      {RELATIONS.map((r, i) => (
        <g key={i}>
          <path
            className="sd-rel"
            d={`M ${r.from[0]} ${r.from[1]} L ${r.to[0]} ${r.to[1]}`}
            style={{ ["--i" as string]: i }}
          />
          {r.label ? (
            <text
              className="sd-rel-label"
              x={(r.from[0] + r.to[0]) / 2 + 6}
              y={(r.from[1] + r.to[1]) / 2 - 4}
            >
              {r.label}
            </text>
          ) : null}
        </g>
      ))}

      {ENTITIES.map((e) => (
        <g key={e.name} className="sd-entity">
          <rect x={e.x} y={e.y} width={e.w} height={22 + e.fields.length * 18} rx="10" />
          <rect className="sd-entity-head" x={e.x} y={e.y} width={e.w} height="26" rx="10" />
          <text className="sd-entity-name" x={e.x + 12} y={e.y + 17}>
            {e.name}
          </text>
          {e.fields.map((f, i) => (
            <text key={f} className="sd-entity-field" x={e.x + 12} y={e.y + 44 + i * 18}>
              {f}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ---------- diagram 3: the phase map ---------- */

/**
 * Every phase is deployed and reachable — the status below is HANDOFF §31,
 * which was checked in a browser against production rather than read off the
 * source, so this list is a record and not an aspiration.
 *
 * `awaiting` does not mean unfinished. The feature is built and shipped and one
 * part of it is switched off until a specific credential exists, degrading by
 * design rather than erroring. Naming the credential is the point: "needs a key"
 * on its own is indistinguishable from "we never got to it".
 */
type Phase = { n: string; label: string; note: string; awaiting?: string };

const PHASES: readonly Phase[] = [
  { n: "P1", label: "Foundation", note: "TS, Tailwind, CI" },
  { n: "P2", label: "Auth", note: "Auth.js v5, RBAC", awaiting: "OAuth apps" },
  { n: "P3", label: "Admin", note: "Prisma CRUD, gated" },
  { n: "P4", label: "Content", note: "ranked search, sitemap" },
  { n: "P5", label: "Integrations", note: "GitHub, LeetCode", awaiting: "Cal.com" },
  { n: "P6", label: "Comms", note: "SSE chat, web push", awaiting: "a domain move" },
  { n: "P7", label: "Payments", note: "Razorpay, invoices", awaiting: "Razorpay keys" },
  { n: "P8", label: "Growth", note: "short links, QR" },
  { n: "P9", label: "Storage", note: "R2, content-addressed", awaiting: "R2 keys" },
  { n: "P10", label: "Analytics", note: "first-party, cookieless" },
  { n: "P11", label: "Realtime", note: "presence, live dashboard" },
  { n: "P12", label: "Delivery", note: "vendored fonts, split CSS" },
  { n: "P13", label: "Security", note: "CSP, CSRF, HSTS" },
  { n: "P14", label: "DevOps", note: "health checks, metrics" },
  { n: "P15", label: "QA", note: "41 E2E, axe" },
  { n: "P16", label: "AI", note: "hybrid retrieval, cited" },
  { n: "P17", label: "DevEx UI", note: "Cmd+K, terminal" },
  { n: "P18", label: "DistSys", note: "outbox, leases, Raft" },
  { n: "P19", label: "Low-level", note: "WASM, threads, WebGPU" },
  { n: "P20", label: "Data eng", note: "ELT, DuckDB, lineage" },
];

function PhaseMap() {
  return (
    <ol className="sd-phases">
      {PHASES.map((p, i) => (
        <li
          key={p.n}
          className="sd-phase"
          data-state={p.awaiting ? "keyed" : "live"}
          style={{ ["--i" as string]: i }}
        >
          <span className="sd-phase-n">{p.n}</span>
          <span className="sd-phase-label">{p.label}</span>
          <span className="sd-phase-note">{p.note}</span>
          {/* The state is spelled out rather than left to the marker: colour is
              the third signal here, behind the word and the dashed border. */}
          <span className="sd-phase-state">{p.awaiting ? `needs ${p.awaiting}` : "live"}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- decisions ---------- */

const DECISIONS = [
  {
    title: "SSE and a DB poll, not WebSockets",
    body: "Vercel functions cannot hold a socket open, and module-scope memory is not shared between invocations. Chat streams over SSE; typing indicators are deadline columns in Postgres rather than in-process state.",
  },
  {
    title: "Redis is optional, not infrastructure",
    body: "The brief made it load-bearing. The limiter prefers Upstash when a key is configured and falls back to an in-memory token bucket per instance when one is not — a weaker ceiling, accepted deliberately, because a limiter that returns 429 while its own dependency is down has converted someone else's outage into ours. Anything that must actually hold, like payment capture, is guarded by auth and idempotency keys instead.",
  },
  {
    title: "The answer is extractive by default",
    body: "Retrieval is hybrid: dense vectors and Postgres full-text search fail in different ways, so both run on every question and the results fuse by reciprocal rank. The answer is then assembled from sentences that exist verbatim on the site, each linking to where it came from. Generation is opt-in and runs in the visitor's own browser — on a page about a real person's real work, a fluent invented claim is not a smaller failure than an awkward true one.",
  },
  {
    title: "Reads degrade instead of failing",
    body: "Every public read goes through readOrFallback. A database blip renders an empty section rather than a 500, which is also why the build survives having no database at all — the CI job asserts exactly that.",
  },
  {
    title: "Heatmaps are aggregates, never raw points",
    body: "An exact click trail is a behavioural fingerprint and grows without bound. Counts live per grid cell, created lazily, so the table tracks where people click rather than how much traffic there was.",
  },
  {
    title: "Charts are hand-written SVG",
    body: "Including the two on this page. They are server-rendered from data already in hand, so no charting library ships and nothing here hydrates.",
  },
  {
    title: "Money is integer minor units",
    body: "End to end, never floats. Bookings only reach CONFIRMED through a signature-verified webhook, never from a client callback.",
  },
] as const;

/* ---------- spec vs built ---------- */

/**
 * Four of these seven rows were stale, and each is corrected in place rather
 * than quietly dropped: P16 put the retrieval index in a pgvector column with
 * cited answers, P15 put 41 Playwright specs plus axe and Lighthouse into CI —
 * all three jobs green together for the first time on run #38 — the Dockerfile
 * has existed since P14 as a proof that the deploy is not Vercel-shaped, and
 * the limiter has preferred Upstash over its in-memory fallback since P13.
 * Claiming restraint that is no longer being shown is the one failure a page
 * whose premise is "this is what actually runs" cannot afford.
 */
const DIVERGENCE = [
  ["Redis", "Upstash-capable, memory today", "no key set; it degrades rather than failing closed"],
  ["WebSockets", "SSE + DB poll", "serverless cannot host a socket"],
  [
    "pgvector / RAG",
    "built in P16 — hybrid, cited",
    "the embedding is in-process TF-IDF; every hosted one is metered",
  ],
  ["Docker", "a Dockerfile, not the deploy path", "it proves nothing here depends on Vercel"],
  ["Better Auth", "Auth.js v5", "the spec allowed the swap"],
  ["Stripe", "Razorpay", "India-side rails"],
  [
    "Playwright / Lighthouse CI",
    "41 E2E + axe + Lighthouse",
    "built in P15; green in CI since run #38",
  ],
] as const;

export default function SystemDesignPage() {
  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">
          <span className="live-dot" />
          System design
        </p>
        <h1 data-split>
          How this site
          <br />
          <em>actually works.</em>
        </h1>
        <p>
          Not the brief it was commissioned from — the system that exists. The request path, the
          data model, the twenty phases it was built in, and the trade-offs behind the parts that
          are deliberately not here.
        </p>
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            The request <em>path.</em>
          </h2>
          <p>
            Five layers, and one rule that shapes all of them: a Vercel function keeps nothing in
            memory between requests, so every piece of state lives in Postgres or in the URL.
          </p>
        </div>
        <figure className="sd-figure">
          <RequestPathDiagram />
          <figcaption>
            Read top to bottom. The proxy runs an adapter-less second Auth.js instance so a route
            can be gated without loading Prisma or bcrypt on every request.
          </figcaption>
        </figure>
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            The data <em>model.</em>
          </h2>
          <p>
            Nine of the principal tables. The through-line is <code>referralRef</code>: one column
            on three unrelated conversion paths is what turns short links into attribution without
            touching any of them.
          </p>
        </div>
        <figure className="sd-figure">
          <DataModelDiagram />
          <figcaption>
            PageView carries a redundant <code>day</code> column on purpose — Prisma has no date
            truncation in groupBy, so materialising the bucket key keeps a daily chart proportional
            to the number of days rather than to traffic.
          </figcaption>
        </figure>
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            Built in <em>twenty phases.</em>
          </h2>
          <p>
            Each one shipped and verified before the next started, and all twenty are deployed and
            reachable today. Five are marked as waiting on something outside the code — four on a
            credential, one on a DNS move. Those phases are live; one feature inside each stays
            switched off, degrading quietly rather than erroring, until it lands.
          </p>
        </div>
        <PhaseMap />
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            Decisions worth <em>defending.</em>
          </h2>
          <p>The interesting part of a system is usually what it does not do.</p>
        </div>
        <div className="sd-decisions" data-stagger>
          {DECISIONS.map((d) => (
            <article key={d.title} className="sd-decision">
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            Spec versus <em>reality.</em>
          </h2>
          <p>
            The original brief asked for a larger stack than this. Each row is what it specified,
            what runs instead, and why — including the four that have shifted since this table was
            written, two of them from <em>not built</em> to built.
          </p>
        </div>
        <div className="sd-table-wrap">
          <table className="sd-table">
            <thead>
              <tr>
                <th scope="col">Specified</th>
                <th scope="col">Built</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {DIVERGENCE.map(([spec, built, why]) => (
                <tr key={spec}>
                  <th scope="row">{spec}</th>
                  <td>{built}</td>
                  <td>{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sd-section shell" data-reveal>
        <div className="section-heading">
          <h2>
            Consensus, <em>watchable.</em>
          </h2>
          <p>
            Raft leader election, running live. The rules are a pure state machine in{" "}
            <code>lib/distsys/raft.ts</code> with nineteen tests asserting what the protocol
            actually guarantees — a term only increases, two leaders cannot exist in one term, a
            leader that loses quorum steps down. This component only draws it and drives the clock.
          </p>
          <p>
            Kill the leader and watch a new one get elected. Kill a third node and watch it
            correctly elect <em>nobody</em>: two of five cannot form a majority, and stopping is the
            right answer rather than splitting the cluster in half.
          </p>
        </div>
        <RaftVisualizer />
      </section>

      <section className="sd-section shell sd-outro" data-reveal>
        <p>The code is public if you would rather read it than take my word for any of this.</p>
        <div className="sd-outro-actions">
          <a
            className="button button-solid"
            href="https://github.com/Git-ShivamPatil/Shivam-Patil-Portfolio"
            target="_blank"
            rel="noreferrer"
          >
            Read the source <span aria-hidden="true">↗</span>
          </a>
          <Link className="button button-text" href="/reach-out">
            Ask me about a decision <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
