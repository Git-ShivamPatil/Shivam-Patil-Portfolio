import type { Metadata } from "next";
import { PwaStatus } from "../../components/edge/pwa-status";
import { WebUsbLab } from "../../components/edge/webusb-lab";
import "./edge.css";

export const metadata: Metadata = {
  title: "Edge & offline — Shivam Patil",
  description:
    "The WAF that runs on every API request, a Cloudflare Worker sharing its ruleset, an offline outbox backed by Background Sync, and a WebUSB lab that mostly refuses to run.",
  alternates: { canonical: "/edge" },
};

// Static. Everything dynamic on this page is measured in the visitor's own
// browser by the two client components, which is the only place those answers
// exist — a server cannot tell you whether *your* browser has Background Sync.
export const revalidate = 3600;

export default function EdgePage() {
  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Edge &amp; offline</p>
        <h1 data-split>
          Closer to you,
          <br />
          <em>or not connected at all.</em>
        </h1>
        <p className="page-lede">
          Filtering that runs before the application does, a queue that survives losing signal, and
          a device API that will probably refuse to run for you. Two of the four things on this page
          are live; the other two say so.
        </p>
      </section>

      <section className="mt-12" data-reveal>
        <div className="section-heading">
          <h2>
            Offline, <em>in this browser.</em>
          </h2>
          <p>
            Read from your browser, not asserted by mine. &ldquo;Works offline&rdquo; means four
            different things across four browsers and a page that states it flatly is wrong in at
            least two of them.
          </p>
        </div>
        <PwaStatus />

        <div className="ask-how-grid mt-10">
          <article>
            <h3>Documents are never served from cache</h3>
            <p>
              Network first, always, for navigation. A service worker is the only thing on a website
              that can outlive a deploy, and a cached document referencing JavaScript chunks that no
              longer exist is a white screen with no way for the visitor to tell you and no way for
              you to push a fix — because the fix is served by the broken worker. Only
              content-hashed build assets are cached, where a stale entry is unreachable rather than
              wrong.
            </p>
          </article>
          <article>
            <h3>The outbox is IndexedDB, not localStorage</h3>
            <p>
              Not a preference. A service worker has no access to localStorage at all — it is
              synchronous, and workers are denied synchronous storage. IndexedDB is the only store
              both the page and the worker can see, which is what lets a message queued by the page
              be sent by a worker after the tab is closed.
            </p>
          </article>
          <article>
            <h3>A 4xx deletes the queued message</h3>
            <p>
              That looks wrong and is deliberate. A 400 means the server read the payload and
              rejected it, so retrying sends identical bytes to an identical judgement forever and
              the queue never drains. Only a network failure or a 5xx is retried, because only those
              might succeed unchanged.
            </p>
          </article>
          <article>
            <h3>Navigation preload</h3>
            <p>
              The browser starts the network request for a navigation in parallel with booting the
              worker. Without it every navigation waits for worker startup first, which is the usual
              way adding a service worker makes a fast site slower.
            </p>
          </article>
        </div>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            One ruleset, <em>two edges.</em>
          </h2>
          <p>
            The request filter is a pure function with no platform imports — no{" "}
            <code>next/server</code>, no <code>node:</code>, no Cloudflare globals. It takes a
            Request and returns a verdict, which is what lets Vercel&rsquo;s edge run it in the live
            path today and a Cloudflare Worker run the identical module the day DNS moves. Neither
            reimplements the other.
          </p>
        </div>

        <div className="ask-how-grid">
          <article>
            <h3>What is live — and what shadows it</h3>
            <p>
              The filter runs in <code>proxy.ts</code> on every request to <code>/api</code>,{" "}
              <code>/admin</code> and <code>/account</code>, plus a hand-listed set of probe paths.
              It answers a probe with a 404 rather than a 403, on the reasoning that a 403 confirms
              something is filtering while a 404 is what a site lacking the file returns anyway.
            </p>
            <p>
              <strong>
                On production you will get a 403, because this code never runs for those paths.
              </strong>{" "}
              Vercel&rsquo;s own managed firewall mitigates them at the edge first —{" "}
              <code>X-Vercel-Mitigated: deny</code> — so the probe rule here is shadowed entirely.
              Verified after deploying, not assumed. It still does the work the platform does not:
              traversal, scanner user-agents and oversized headers on the dynamic surface.
            </p>
          </article>
          <article>
            <h3>Why the paths are listed one by one</h3>
            <p>
              A catch-all matcher is how this is normally done, and here it would drag every
              prerendered page through the proxy and cost the site its static generation. So the
              traversal, hostile-agent and header-size rules cover only the dynamic surface. That is
              a real limit of filtering inside the application instead of in front of it, and it is
              exactly what the Worker fixes.
            </p>
          </article>
          <article>
            <h3>The Worker is written, not deployed</h3>
            <p>
              <code>edge/worker.ts</code> and its wrangler config are in the repository and are one{" "}
              <code>wrangler deploy</code> from live. Putting Cloudflare in front of this site means
              moving DNS off Wix — the same blocked task that has held up transactional email since
              P5. Writing a Worker nobody runs and calling it shipped would have been the easier
              claim.
            </p>
          </article>
          <article>
            <h3>Canary routing needs to be in front</h3>
            <p>
              Choosing between two deployments is impossible from inside either one. The Worker
              buckets on a hash rather than a random draw, because assignment has to be stable —
              random per request puts one visitor on both versions during a single page load, with
              the document from one build and its chunks from another. Static assets are excluded
              from bucketing for the same reason.
            </p>
          </article>
        </div>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            WebUSB, and <em>why it will not run.</em>
          </h2>
          <p>
            Chromium only. Firefox declined to implement it — its position is that exposing
            arbitrary USB devices to web content is not a risk worth taking — and Safari has not
            shipped it. Secure context and a user gesture are required, and the browser mediates
            every device through a chooser this page cannot skip.
          </p>
        </div>
        <WebUsbLab />

        <p className="edge-note mt-6">
          The permission model is the interesting part. A page cannot enumerate what is plugged in:{" "}
          <code>getDevices()</code> returns only devices already granted to this origin, which on a
          first visit is empty. So there is no fingerprinting surface and no silent access — and the
          &ldquo;list your devices&rdquo; demo everyone expects cannot be built, by design.
        </p>
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            The React Native app <em>that is not here.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>What the roadmap asked for</h3>
            <p>
              A React Native application. Shipping one means an Expo workspace, a second dependency
              tree several times the size of this one, and two app-store accounts — to deliver a
              portfolio that is already a website. The honest answer is that it would be a worse
              product and a much larger maintenance surface, not that it was too hard.
            </p>
          </article>
          <article>
            <h3>What is here instead</h3>
            <p>
              An installable PWA: a manifest with shortcuts, an offline shell, a sync-backed outbox,
              and web push that predates all of it. On Android that is a home-screen icon and a
              standalone window. On iOS it is the same, minus push until the user adds it to the
              home screen.
            </p>
          </article>
          <article>
            <h3>Where the roadmap is right</h3>
            <p>
              A PWA is not a native app. It has no background location, no widgets, no share-sheet
              integration, and on iOS it lives under a storage budget the browser can evict. If any
              of those mattered here, none of the above would substitute — they do not, and that is
              the whole argument.
            </p>
          </article>
          <article>
            <h3>The part that would transfer</h3>
            <p>
              Everything under <code>lib/</code> that has no platform import: the circuit breaker,
              the request filter, the histogram maths, the outbox protocol. That is the actual
              reusable surface between a web app and a native one, and it is reusable because those
              modules were written without reaching for a runtime — not because a framework promised
              it.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
