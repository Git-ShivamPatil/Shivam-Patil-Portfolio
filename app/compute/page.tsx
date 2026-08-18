import { pageMetadata } from "../../lib/seo/metadata";
import { ComputeLab } from "../../components/lowlevel/compute-lab";

export const metadata = pageMetadata({
  title: "Compute Lab: WebAssembly, SIMD & WebGPU",
  description:
    "The same Mandelbrot kernel in JavaScript, WebAssembly, a SharedArrayBuffer worker pool and a WebGPU compute shader, measured against each other with a checksum.",
  path: "/compute",
});

export default function ComputePage() {
  return (
    <div className="shell py-16">
      <section className="page-hero" data-reveal>
        <p className="eyebrow">Low level</p>
        <h1 data-split>
          Four ways to
          <br />
          <em>do the same work.</em>
        </h1>
        <p className="page-lede">
          One escape-time Mandelbrot kernel, written four times: plain JavaScript, WebAssembly
          compiled ahead of time, a worker pool writing into one SharedArrayBuffer, and a WebGPU
          compute shader. Every backend renders the identical tile, and a checksum proves it before
          any timing is reported.
        </p>
      </section>

      <section className="mt-10" data-reveal>
        <ComputeLab />
      </section>

      <section className="mt-14" data-reveal>
        <div className="section-heading">
          <h2>
            What the numbers <em>actually mean.</em>
          </h2>
        </div>
        <div className="ask-how-grid">
          <article>
            <h3>The JavaScript is not a strawman</h3>
            <p>
              It is the same algorithm with the same squared-term reuse, writing into the same
              buffer shape. Benchmarking WebAssembly against deliberately naive JavaScript is the
              oldest way to produce an impressive and meaningless number. What is left measures what
              an ahead-of-time compiled module with a fixed memory layout buys over an optimising
              JIT on identical arithmetic — a real margin, and a smaller one than the demos usually
              claim.
            </p>
          </article>
          <article>
            <h3>Cross-origin isolation is scoped to this page</h3>
            <p>
              SharedArrayBuffer needs <code>COOP: same-origin</code> and{" "}
              <code>COEP: require-corp</code>, and COEP blocks every cross-origin subresource that
              does not opt in. Site-wide it would break the OpenStreetMap frame on /reach-out and
              the OAuth avatars. So it is applied to this route only — the isolation is real here
              and nowhere else, which is the correct scope rather than a compromise.
            </p>
          </article>
          <article>
            <h3>The bands are deliberately uneven</h3>
            <p>
              Points inside the set run the full iteration count; points outside escape in two.
              Slicing the tile into contiguous bands therefore gives each worker very different
              amounts of work, and the speed-up lands well under the core count. That is the real
              load-imbalance problem parallel work has, and hiding it behind a workload that divides
              evenly would make the demo prettier and less true.
            </p>
          </article>
          <article>
            <h3>WebGPU computes in f32, and it shows</h3>
            <p>
              WGSL has no f64. At this zoom the reduced precision produces visible banding and a
              checksum that does not match the other three — which the table reports as{" "}
              <em>differs</em> rather than quietly loosening the comparison until it agreed. The GPU
              is doing enormously more arithmetic in parallel; it is not doing the identical
              arithmetic.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
