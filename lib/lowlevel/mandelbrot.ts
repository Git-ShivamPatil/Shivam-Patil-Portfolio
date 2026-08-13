/**
 * P19 — the JavaScript baseline, and the shared parameters.
 *
 * **This is written to be fast, not to lose.** It is the same algorithm as
 * assembly/kernel.ts, with the same squared-term reuse and the same escape
 * test, writing into the same `Uint8Array` shape. Benchmarking WASM against a
 * deliberately naive JS implementation is the oldest way to produce an
 * impressive and meaningless number, and a portfolio that did it would be
 * making an argument it cannot defend.
 *
 * What the comparison then actually measures is the thing worth measuring: what
 * an ahead-of-time compiled, fixed-layout, no-GC module buys over an optimising
 * JIT on identical arithmetic. On this workload it is a real but unglamorous
 * margin — and where it goes is more interesting than the number, which is why
 * the page reports both.
 */

export interface TileParams {
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  /** Complex units per pixel. Smaller is deeper. */
  scale: number;
  maxIterations: number;
}

/**
 * A view worth zooming into, and a size that finishes inside a frame budget on
 * a laptop while still taking long enough to measure.
 */
export const DEFAULT_PARAMS: TileParams = {
  width: 640,
  height: 480,
  centreX: -0.743643887037151,
  centreY: 0.13182590420533,
  scale: 0.0000045,
  maxIterations: 600,
};

/**
 * Render into a caller-supplied buffer.
 *
 * The buffer is passed in rather than returned so this matches the WASM
 * kernel's contract exactly — allocation would otherwise be counted on one side
 * and not the other, which is the second most common way these comparisons lie.
 */
export function renderMandelbrot(out: Uint8Array, params: TileParams): void {
  const { width, height, centreX, centreY, scale, maxIterations } = params;
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;

  for (let py = 0; py < height; py++) {
    const y0 = centreY + (py - halfHeight) * scale;

    for (let px = 0; px < width; px++) {
      const x0 = centreX + (px - halfWidth) * scale;

      let x = 0;
      let y = 0;
      let xx = 0;
      let yy = 0;
      let iteration = 0;

      while (xx + yy <= 4 && iteration < maxIterations) {
        y = 2 * x * y + y0;
        x = xx - yy + x0;
        xx = x * x;
        yy = y * y;
        iteration++;
      }

      out[py * width + px] =
        iteration >= maxIterations ? 0 : Math.floor((iteration * 255) / maxIterations);
    }
  }
}

/**
 * Render one horizontal band. This is what a worker is handed.
 *
 * Bands rather than interleaved rows: the Mandelbrot set's cost is wildly
 * uneven — points inside it run the full iteration count, points far outside
 * escape in two — so contiguous bands give workers very different amounts of
 * work. That is deliberate and it is the point of the demo: it is exactly the
 * load-imbalance problem real parallel work has, and the page says so rather
 * than hiding it behind a workload that happens to divide evenly.
 */
export function renderBand(
  out: Uint8Array,
  params: TileParams,
  rowStart: number,
  rowEnd: number,
): void {
  const { width, centreX, centreY, scale, maxIterations, height } = params;
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;

  for (let py = rowStart; py < rowEnd && py < height; py++) {
    const y0 = centreY + (py - halfHeight) * scale;

    for (let px = 0; px < width; px++) {
      const x0 = centreX + (px - halfWidth) * scale;
      let x = 0;
      let y = 0;
      let xx = 0;
      let yy = 0;
      let iteration = 0;

      while (xx + yy <= 4 && iteration < maxIterations) {
        y = 2 * x * y + y0;
        x = xx - yy + x0;
        xx = x * x;
        yy = y * y;
        iteration++;
      }

      out[py * width + px] =
        iteration >= maxIterations ? 0 : Math.floor((iteration * 255) / maxIterations);
    }
  }
}

/** Split `height` rows into `count` contiguous bands. */
export function bands(height: number, count: number): [number, number][] {
  const size = Math.ceil(height / count);
  const result: [number, number][] = [];
  for (let start = 0; start < height; start += size) {
    result.push([start, Math.min(start + size, height)]);
  }
  return result;
}

/**
 * A cheap checksum, so every backend can be proved to have produced the *same*
 * image.
 *
 * Without this the benchmark measures how fast each path produces some bytes,
 * which is not the same claim. A WebGPU shader with a subtly different escape
 * test would look fastest and be wrong.
 */
export function checksum(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
