/**
 * P19 — the band worker.
 *
 * Plain JavaScript in `public/`, not a bundled module, and that is deliberate:
 * a worker built through the bundler needs a build-time URL dance that changes
 * with every Next major, while a static file at a stable path is the same in
 * dev, in the container and on Vercel. The cost is that this cannot import from
 * `lib/` — so the kernel is duplicated here, and a test asserts the two copies
 * stay identical rather than trusting anyone to remember.
 *
 * It writes into a SharedArrayBuffer view. No `postMessage` of pixel data, no
 * structured clone, no transfer: every worker writes into the *same* memory the
 * main thread will read. That is the entire reason SharedArrayBuffer exists,
 * and it is why this needs cross-origin isolation to run at all.
 *
 * Each worker owns a disjoint band, so there is no overlap and therefore no
 * need for Atomics on the pixel data itself. Atomics are used only for the
 * completion counter, where two workers genuinely do race.
 */

self.onmessage = (event) => {
  const { buffer, params, rowStart, rowEnd, doneCounter } = event.data;

  const out = new Uint8Array(buffer);
  const counter = new Int32Array(doneCounter);
  const { width, height, centreX, centreY, scale, maxIterations } = params;
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

  // Atomics, not `counter[0]++`: the increment is read-modify-write, and two
  // workers finishing at once would otherwise lose one of the increments and
  // the main thread would wait forever for a count that never arrives.
  Atomics.add(counter, 0, 1);
  Atomics.notify(counter, 0);

  self.postMessage({ rowStart, rowEnd });
};
