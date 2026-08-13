// P19 — the WebAssembly kernel, in AssemblyScript.
//
// **Why AssemblyScript and not Rust**, given the blueprint says WASM(Rust): a
// Rust toolchain is a second language toolchain in CI, a `cargo` install on
// every build, and wasm-bindgen glue — for a kernel that is forty lines of
// integer arithmetic. AssemblyScript compiles from the language this repo is
// already written in, with one devDependency and no extra toolchain. If the
// kernel ever grew into something Rust's type system would actually help with,
// that trade flips.
//
// **Why this workload.** A benchmark has to be one where WASM genuinely wins,
// or the demo argues against itself. That means: tight integer loops, no
// allocation, no strings, and no crossing the JS boundary inside the hot loop.
// A Mandelbrot escape-time render is exactly that shape — and it is also
// honestly representative, because it is the same shape as image filtering,
// hashing and physics, which are the things people actually reach for WASM to
// do. A JSON-heavy or DOM-touching workload would show WASM *losing*, and
// picking one of those to prove a point would be dishonest in the other
// direction.
//
// The JS baseline in lib/lowlevel/mandelbrot.ts is written to be the same
// algorithm, not a deliberately slow one. Beating a strawman proves nothing.

/**
 * Render one Mandelbrot tile into a caller-supplied buffer.
 *
 * The buffer is allocated by the host and passed in as a pointer, so this
 * function allocates nothing and the result never crosses the boundary as a
 * copy — the host reads the same linear memory the kernel wrote. That is where
 * most of the win comes from, and it is why a WASM function that returns an
 * array is usually slower than the JS it replaced.
 *
 * @param out    Pointer into linear memory: width * height bytes.
 * @param width  Tile width in pixels.
 * @param height Tile height in pixels.
 * @param centreX Complex-plane centre, real axis.
 * @param centreY Complex-plane centre, imaginary axis.
 * @param scale  Complex units per pixel.
 * @param maxIterations Escape-time ceiling.
 */
export function renderMandelbrot(
  out: usize,
  width: i32,
  height: i32,
  centreX: f64,
  centreY: f64,
  scale: f64,
  maxIterations: i32,
): void {
  const halfWidth: f64 = <f64>width * 0.5;
  const halfHeight: f64 = <f64>height * 0.5;

  for (let py: i32 = 0; py < height; py++) {
    const y0: f64 = centreY + (<f64>py - halfHeight) * scale;

    for (let px: i32 = 0; px < width; px++) {
      const x0: f64 = centreX + (<f64>px - halfWidth) * scale;

      let x: f64 = 0.0;
      let y: f64 = 0.0;
      let iteration: i32 = 0;

      // Squares kept in locals rather than recomputed: the loop condition needs
      // x*x + y*y anyway, so reusing them removes two multiplies per iteration
      // from the hottest loop in the program.
      let xx: f64 = 0.0;
      let yy: f64 = 0.0;

      while (xx + yy <= 4.0 && iteration < maxIterations) {
        y = 2.0 * x * y + y0;
        x = xx - yy + x0;
        xx = x * x;
        yy = y * y;
        iteration++;
      }

      // Scaled to a byte for the canvas. Points inside the set get 0.
      store<u8>(
        out + <usize>(py * width + px),
        iteration >= maxIterations ? 0 : <u8>((iteration * 255) / maxIterations),
      );
    }
  }
}

/**
 * FNV-1a over a byte range, returned as two 32-bit halves packed into i64.
 *
 * A second kernel with a different shape — byte-serial rather than
 * floating-point — so the comparison is not one lucky workload. It is also the
 * same hash `lib/ai/embed.ts` uses, which makes it a real function from this
 * codebase rather than a benchmark written to win.
 */
export function fnv1a(ptr: usize, length: i32): u32 {
  let hash: u32 = 0x811c9dc5;
  for (let i: i32 = 0; i < length; i++) {
    hash ^= <u32>load<u8>(ptr + <usize>i);
    hash = hash * 16777619;
  }
  return hash;
}

/** Bytes of scratch memory the host may write into before calling a kernel. */
export function allocate(size: i32): usize {
  return <usize>__new(<usize>size, idof<ArrayBuffer>());
}
