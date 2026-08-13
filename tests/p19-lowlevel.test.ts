import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";
import { bands, checksum, renderBand, renderMandelbrot } from "../lib/lowlevel/mandelbrot";

/**
 * P19 — low-level compute.
 *
 * The property that makes the whole page honest is that **every backend must
 * produce the same pixels**. Without it the benchmark measures how fast four
 * different programs produce four different images, which is not a comparison.
 * The JS and banded paths are asserted equal here; the WASM and WebGPU paths
 * are checked in the browser at runtime, because they need one.
 */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers;
  if (!headers) throw new Error("next.config.ts declares no headers()");
  return (await headers()) as HeaderRule[];
}

/**
 * A small tile for the unit tests — the default is 640x480 at 600 iterations,
 * far too slow here.
 *
 * It also zooms *out*. The default centre is a deep zoom, and at 60 iterations
 * every pixel there hits the ceiling and the whole tile renders black — which
 * passed "is it deterministic" perfectly and told us nothing. A view that
 * straddles the boundary is the one that can actually catch a broken kernel.
 */
const TINY = {
  width: 48,
  height: 32,
  centreX: -0.6,
  centreY: 0,
  scale: 0.08,
  maxIterations: 60,
};

describe("the reference kernel", () => {
  it("is deterministic", () => {
    const first = new Uint8Array(TINY.width * TINY.height);
    const second = new Uint8Array(TINY.width * TINY.height);
    renderMandelbrot(first, TINY);
    renderMandelbrot(second, TINY);
    expect(checksum(first)).toBe(checksum(second));
  });

  it("renders something, not a blank tile", () => {
    // A kernel that returns all zeros passes every "is it deterministic" test
    // ever written.
    const pixels = new Uint8Array(TINY.width * TINY.height);
    renderMandelbrot(pixels, TINY);
    expect(new Set(pixels).size).toBeGreaterThan(3);
  });

  it("marks points inside the set as zero", () => {
    // The origin is in the set: it never escapes, so it hits the iteration
    // ceiling and is drawn black.
    const centred = { ...TINY, centreX: 0, centreY: 0, scale: 0.01 };
    const pixels = new Uint8Array(centred.width * centred.height);
    renderMandelbrot(pixels, centred);
    expect(
      pixels[Math.floor(centred.height / 2) * centred.width + Math.floor(centred.width / 2)],
    ).toBe(0);
  });
});

describe("banding", () => {
  it("covers every row exactly once", () => {
    for (const threads of [1, 2, 3, 4, 7, 16]) {
      const slices = bands(TINY.height, threads);
      const covered = new Set<number>();
      for (const [start, end] of slices) {
        for (let row = start; row < end; row++) {
          // Overlapping bands would mean two workers writing the same pixels —
          // harmless here only because they compute the same value, and a real
          // bug the moment the kernel changes.
          expect(covered.has(row)).toBe(false);
          covered.add(row);
        }
      }
      expect(covered.size).toBe(TINY.height);
    }
  });

  it("never produces an empty band", () => {
    for (const [start, end] of bands(TINY.height, 5)) {
      expect(end).toBeGreaterThan(start);
    }
  });

  it("produces the identical image whether banded or not", () => {
    // The invariant the whole worker path depends on. If this diverges, the
    // parallel result is a different picture that happens to arrive faster.
    const whole = new Uint8Array(TINY.width * TINY.height);
    renderMandelbrot(whole, TINY);

    for (const threads of [1, 3, 8]) {
      const banded = new Uint8Array(TINY.width * TINY.height);
      for (const [start, end] of bands(TINY.height, threads)) {
        renderBand(banded, TINY, start, end);
      }
      expect(checksum(banded), `${threads} bands`).toBe(checksum(whole));
    }
  });
});

describe("the checksum", () => {
  it("changes when a single pixel changes", () => {
    // A checksum that missed a one-pixel difference would let two backends
    // disagree while the table reported "identical".
    const pixels = new Uint8Array(64);
    const before = checksum(pixels);
    pixels[31] = 1;
    expect(checksum(pixels)).not.toBe(before);
  });

  it("stays a 32-bit unsigned integer", () => {
    const pixels = new Uint8Array(4096).fill(200);
    const value = checksum(pixels);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("the compiled kernel", () => {
  const wasmPath = join(process.cwd(), "public/wasm/kernel.wasm");

  it("is committed, so the build needs no second toolchain", () => {
    // Same reasoning that vendored the fonts in P12: a deploy must not be able
    // to fail because a compiler version drifted.
    expect(statSync(wasmPath).size).toBeGreaterThan(0);
  });

  it("is a real WebAssembly module", () => {
    // The magic number. Catches a truncated or half-written file, which would
    // otherwise only fail in a browser.
    const header = readFileSync(wasmPath).subarray(0, 4);
    expect([...header]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it("exports the functions the loader calls", () => {
    const text = readFileSync(join(process.cwd(), "public/wasm/kernel.wat"), "utf8");
    expect(text).toContain('(export "renderMandelbrot"');
    expect(text).toContain('(export "allocate"');
    expect(text).toContain('(export "memory"');
  });
});

describe("the worker copy of the kernel", () => {
  it("matches the reference implementation's arithmetic", () => {
    // The worker is a static file in public/ so it needs no bundler dance, and
    // the price is a duplicated kernel. This is the guard that the two do not
    // drift — a divergence would show up as a banded image that differs from
    // the single-threaded one, which nobody would notice by looking.
    const worker = readFileSync(join(process.cwd(), "public/workers/mandelbrot.worker.js"), "utf8");
    for (const line of [
      "y = 2 * x * y + y0;",
      "x = xx - yy + x0;",
      "xx = x * x;",
      "yy = y * y;",
      "while (xx + yy <= 4 && iteration < maxIterations)",
    ]) {
      expect(worker, `worker is missing: ${line}`).toContain(line);
    }
  });

  it("uses Atomics for the completion counter", () => {
    // A plain increment is read-modify-write: two workers finishing at once
    // lose one of them, and the main thread waits for a count that never
    // arrives.
    const source = readFileSync(join(process.cwd(), "public/workers/mandelbrot.worker.js"), "utf8");
    expect(source).toContain("Atomics.add");

    // Comments stripped before searching. The comment above that line in the
    // worker explains why the plain increment is wrong, and a naive search
    // finds its own explanation and fails — which is what happened first.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/counter\[0\]\s*\+\+/);
  });
});

describe("cross-origin isolation", () => {
  it("applies COEP to the isolated page and its worker, and nowhere else", async () => {
    // Site-wide COEP blocks every cross-origin subresource that does not opt
    // in, which here means the OpenStreetMap frame on /reach-out and the OAuth
    // avatars. Scoping it is the correct answer, not a compromise.
    //
    // The worker is on this list because a dedicated worker inherits its
    // creator's embedder policy: when the creating document is cross-origin
    // isolated, the worker's own script response must assert `require-corp`
    // too, or Chrome blocks the load outright. This test previously asserted
    // `["/compute"]` exactly, and that pinned the bug in place — the worker
    // carried CORP but not COEP, so /compute shipped with its
    // SharedArrayBuffer backend dead while every check here stayed green.
    const withCoep = (await rules()).filter((rule) =>
      rule.headers.some((header) => header.key === "Cross-Origin-Embedder-Policy"),
    );
    expect(withCoep.map((rule) => rule.source).sort()).toEqual(["/compute", "/workers/:path*"]);

    // The guarantee that actually protects the rest of the site: no rule broad
    // enough to catch a page other than /compute may carry it.
    for (const rule of withCoep) {
      expect(rule.source.startsWith("/compute") || rule.source.startsWith("/workers/")).toBe(true);
    }
  });

  it("pairs it with COOP, which is the half that is already global", async () => {
    const compute = (await rules()).find((rule) => rule.source === "/compute");
    const keys = compute?.headers.map((header) => header.key) ?? [];
    // Isolation needs both. One without the other silently does nothing.
    expect(keys).toContain("Cross-Origin-Embedder-Policy");
    expect(keys).toContain("Cross-Origin-Opener-Policy");
  });

  it("marks the worker and the wasm as same-origin resources", async () => {
    // Under COEP, a subresource without CORP is blocked — including the worker
    // the isolation exists to enable.
    for (const source of ["/workers/:path*", "/wasm/:path*"]) {
      const rule = (await rules()).find((entry) => entry.source === source);
      expect(
        rule?.headers.some((header) => header.key === "Cross-Origin-Resource-Policy"),
        `${source} has no CORP`,
      ).toBe(true);
    }
  });

  it("serves the wasm as application/wasm", async () => {
    // instantiateStreaming refuses anything else and falls back to a slower
    // path only if the caller wrote one.
    const rule = (await rules()).find((entry) => entry.source === "/wasm/:path*");
    expect(rule?.headers.find((header) => header.key === "Content-Type")?.value).toBe(
      "application/wasm",
    );
  });
});
