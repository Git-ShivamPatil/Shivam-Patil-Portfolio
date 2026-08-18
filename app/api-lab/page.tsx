import { pageMetadata } from "../../lib/seo/metadata";
import { ApiSandbox } from "../../components/api/sandbox";
import { FLAG_DEFAULTS, evaluate } from "../../lib/api/flags";
import { MAX_DEPTH, MAX_FIELDS, renderSdl } from "../../lib/api/graphql";
import { buildSchema } from "../../lib/api/schema";
import { protoSource, encodeMessage, STATS_RESPONSE } from "../../lib/api/protobuf";
import { DOCUMENTED_PATHS } from "../../lib/api/openapi";
import "./api-lab.css";

export const metadata = pageMetadata({
  title: "API Lab: REST, GraphQL & RPC",
  description:
    "Four protocols over the same data: an OpenAPI 3.1 document, a depth-limited GraphQL subgraph, protobuf on the wire, and a sandbox built from the spec itself.",
  path: "/api-lab",
});

export const revalidate = 3600;

/** The example payload used for the size comparison below. */
const SAMPLE = {
  source: "projects",
  total: 6,
  names: ["Distributed rate limiter", "Agentic AI orchestration", "LLM inference server"],
  scores: [7, 9, 8],
  ratio: 0.5,
  stale: false,
};

export default function ApiLabPage() {
  const sdl = renderSdl(buildSchema(), "Query");

  // Measured at render, not asserted. Both encodings of the same object, so the
  // ratio is real rather than a number from a blog post.
  const protoBytes = encodeMessage(STATS_RESPONSE, SAMPLE).length;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(SAMPLE)).length;

  // The sandbox flag, evaluated for an anonymous visitor — which is what a
  // reader of this page is.
  const sandboxWrites = evaluate(
    FLAG_DEFAULTS.find((flag) => flag.key === "lab.sandbox-writes")!,
    { subject: "anonymous", attributes: {} },
  );

  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">API infrastructure</p>
        <h1 data-split>
          Four protocols,
          <br />
          <em>one set of facts.</em>
        </h1>
        <p className="page-lede">
          The same projects, served as REST with a written specification, as a GraphQL subgraph with
          the limits that make one safe to expose, and as protobuf on the wire. The console below
          builds itself from the specification, so the two cannot drift.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            Try it, <em>for real.</em>
          </h2>
          <p>
            Requests go from your browser to this origin. Nothing is mocked and nothing is replayed
            — the timings and the bytes are what the endpoint actually returned.
          </p>
        </div>
        <ApiSandbox />
        <p className="api-note mt-4">
          Read-only. Writes are gated behind the <code>lab.sandbox-writes</code> flag, which
          evaluates to <strong>{String(sandboxWrites.value)}</strong> for an anonymous visitor —
          reason <code>{sandboxWrites.reason}</code>. A public write console on a live site is an
          abuse endpoint with a pleasant interface, and <code>/api/contact</code> would put a
          stranger&rsquo;s message in a real inbox.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            The specification, <em>written by hand.</em>
          </h2>
          <p>
            Generating it from the zod schemas would guarantee the request shapes never drift, and
            it is the better answer for exactly that. It is also where generated specs stop: nothing
            derives a description, an example, or the reason an endpoint returns 409. A generated
            document is complete and says nothing. So request bodies name the schema that defines
            them, the prose is written, and a test asserts every documented path still exists as a
            route — which catches the drift that actually happens.
          </p>
        </div>

        <dl className="api-figures">
          <div>
            <dt>Documented</dt>
            <dd>
              {DOCUMENTED_PATHS.length}
              <small>paths, all verified to exist</small>
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              3.1
              <small>a strict JSON Schema superset</small>
            </dd>
          </div>
          <div>
            <dt>protobuf</dt>
            <dd>
              {protoBytes} B<small>vs {jsonBytes} B as JSON</small>
            </dd>
          </div>
          <div>
            <dt>Saving</dt>
            <dd>
              {Math.round((1 - protoBytes / jsonBytes) * 100)}%<small>on this payload</small>
            </dd>
          </div>
        </dl>

        <p className="api-note">
          That saving is real and also the least interesting property of protobuf. Gzip closes most
          of the gap on a payload this size; what a schema actually buys is that field 3 is field 3
          forever, so a reader built last year decodes a message written today and skips the fields
          it has never heard of. <a href="/api/openapi">The document</a> and{" "}
          <a href="/api/rpc">the .proto</a> are both served.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            GraphQL, and the <em>limits that make it safe.</em>
          </h2>
          <p>
            A parser, a schema walker and an executor, written rather than installed. The subset is
            the honest part: queries, nesting, aliases and scalar arguments are supported;
            mutations, subscriptions, fragments, variables and directives are refused{" "}
            <em>by name</em>. A parser that silently ignores a fragment returns a response missing
            fields the caller asked for, and the caller cannot tell that from data that is genuinely
            absent.
          </p>
        </div>

        <div className="ask-how-grid">
          <article>
            <h3>Depth is capped at {MAX_DEPTH}</h3>
            <p>
              GraphQL&rsquo;s defining denial-of-service surface is that a few hundred bytes of
              nesting can demand unbounded server work. Both this and the {MAX_FIELDS}-field ceiling
              are checked before a single resolver runs, and the measured cost of every query comes
              back in <code>extensions</code>.
            </p>
          </article>
          <article>
            <h3>Read-only by construction</h3>
            <p>
              Everything mutable here already has a REST route with its own CSRF check, rate limit
              and audit trail. Duplicating those guarantees in a second protocol doubles the number
              of places a mistake can happen, for no capability the site did not already have.
            </p>
          </article>
          <article>
            <h3>Always 200</h3>
            <p>
              Including when fields fail. That is the contract and it surprises people: the status
              describes the transport, the <code>errors</code> array describes the query. Field
              errors are collected and the field set to null, so a partial response survives —
              throwing on the first failing resolver would discard everything that succeeded.
            </p>
          </article>
          <article>
            <h3>The SDL is generated</h3>
            <p>
              A federation gateway asks a subgraph for <code>_service &#123; sdl &#125;</code> and
              composes the supergraph from the answers. Rendering it from the same schema object the
              executor walks means the two cannot disagree — unlike a checked-in SDL file sitting
              beside a hand-written resolver map.
            </p>
          </article>
        </div>

        <details className="api-source">
          <summary>The subgraph SDL</summary>
          <pre>
            <code>{sdl}</code>
          </pre>
        </details>

        <details className="api-source">
          <summary>The .proto descriptor</summary>
          <pre>
            <code>{protoSource()}</code>
          </pre>
        </details>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            What is <em>not</em> here.
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>gRPC, properly</h3>
            <p>
              gRPC is HTTP/2 with trailers and a framing browsers cannot originate and this runtime
              does not expose. gRPC-Web exists because of that gap and needs a translating proxy —
              the blueprint&rsquo;s Envoy. What is implemented is the protobuf wire format itself,
              by hand, carried over a POST with Connect&rsquo;s framing. The content type says{" "}
              <code>application/proto</code>, not <code>application/grpc</code>, so a real gRPC
              client fails at negotiation rather than deep inside its framing code.
            </p>
          </article>
          <article>
            <h3>A federation gateway</h3>
            <p>
              Federation is composition across <em>several</em> subgraphs, and there is one service
              here. What is implemented is the subgraph half of the contract — the SDL a gateway
              would ask for. A gateway composing one subgraph is an expensive proxy.
            </p>
          </article>
          <article>
            <h3>Flags in a database</h3>
            <p>
              The evaluator is pure and the inventory lives in code, so a flag can be found by
              grepping — the worst property of a flag system is that dead flags accumulate invisibly
              until nobody dares delete any. Values from a store would layer on top; the evaluation
              would not change, which is the whole reason it is separated.
            </p>
          </article>
          <article>
            <h3>Generated clients</h3>
            <p>
              The document is complete enough for <code>openapi-generator</code> and the descriptor
              for <code>protoc</code>, and neither is run here. At three consumers, hand-written
              calls are less machinery; at thirty, generated clients are obviously right, and this
              is the wrong scale for them.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
