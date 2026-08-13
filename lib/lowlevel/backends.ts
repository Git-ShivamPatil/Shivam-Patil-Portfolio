import { bands, checksum, renderMandelbrot, type TileParams } from "./mandelbrot";

/**
 * P19 — the four compute backends, behind one interface.
 *
 * Everything here runs in the browser. Each backend produces the same
 * `Uint8Array` for the same parameters, and the page checks that with a
 * checksum before reporting any timing — otherwise the benchmark measures how
 * fast each path produces *some* bytes, which is a different and much less
 * interesting claim.
 */

export type BackendId = "js" | "wasm" | "workers" | "webgpu";

export interface RunResult {
  backend: BackendId;
  /** Milliseconds, measured with performance.now() around the compute only. */
  ms: number;
  checksum: number;
  pixels: Uint8Array;
  /** Anything worth saying about how it ran — thread count, adapter name. */
  note?: string;
}

export interface Availability {
  wasm: boolean;
  /** SharedArrayBuffer needs the document to be cross-origin isolated. */
  sharedMemory: boolean;
  webgpu: boolean;
  hardwareConcurrency: number;
}

export function detect(): Availability {
  return {
    wasm: typeof WebAssembly !== "undefined",
    // `crossOriginIsolated` is the honest check. `typeof SharedArrayBuffer`
    // is not: the constructor exists in browsers that will refuse to let you
    // share the memory, so feature-detecting on it reports a capability the
    // page does not have.
    sharedMemory:
      typeof SharedArrayBuffer !== "undefined" &&
      typeof crossOriginIsolated !== "undefined" &&
      crossOriginIsolated,
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    hardwareConcurrency: typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4,
  };
}

/* ---------------------------------------------------------------- JS ---- */

export async function runJs(params: TileParams): Promise<RunResult> {
  const pixels = new Uint8Array(params.width * params.height);
  const started = performance.now();
  renderMandelbrot(pixels, params);
  const ms = performance.now() - started;
  return { backend: "js", ms, checksum: checksum(pixels), pixels, note: "single thread" };
}

/* -------------------------------------------------------------- WASM ---- */

interface KernelExports {
  memory: WebAssembly.Memory;
  renderMandelbrot(
    out: number,
    width: number,
    height: number,
    centreX: number,
    centreY: number,
    scale: number,
    maxIterations: number,
  ): void;
  allocate(size: number): number;
}

let kernel: KernelExports | null = null;

/**
 * Instantiate once and keep it.
 *
 * Compilation is a real cost — a few milliseconds here — and including it in
 * every timing would measure the loader rather than the kernel. It is reported
 * separately by the page instead of being hidden or smuggled into the result.
 */
export async function loadKernel(): Promise<{ exports: KernelExports; compileMs: number }> {
  if (kernel) return { exports: kernel, compileMs: 0 };

  const started = performance.now();
  // Streaming compilation: the module compiles while it downloads rather than
  // after. It needs the correct Content-Type, which is why the .wasm is a
  // static asset rather than something a route hands back.
  // Not named `module`: that identifier is special in a CommonJS scope and the
  // Next lint rule rejects assigning to it outright.
  const compiled = await WebAssembly.instantiateStreaming(fetch("/wasm/kernel.wasm"), {
    env: {
      abort: () => {
        throw new Error("wasm aborted");
      },
    },
  });
  kernel = compiled.instance.exports as unknown as KernelExports;
  return { exports: kernel, compileMs: performance.now() - started };
}

export async function runWasm(params: TileParams): Promise<RunResult> {
  const { exports } = await loadKernel();
  const size = params.width * params.height;
  const pointer = exports.allocate(size);

  const started = performance.now();
  exports.renderMandelbrot(
    pointer,
    params.width,
    params.height,
    params.centreX,
    params.centreY,
    params.scale,
    params.maxIterations,
  );
  const ms = performance.now() - started;

  // A copy out of linear memory, taken *after* the clock stops. The kernel
  // wrote into memory the host can already see — the copy exists only so the
  // canvas has a stable buffer, and counting it would charge WASM for work the
  // JS path never does.
  const pixels = new Uint8Array(exports.memory.buffer, pointer, size).slice();

  return { backend: "wasm", ms, checksum: checksum(pixels), pixels, note: "single thread, AOT" };
}

/* ----------------------------------------------------------- workers ---- */

export async function runWorkers(params: TileParams, threads: number): Promise<RunResult> {
  const size = params.width * params.height;

  // The shared heap. Every worker writes into this same memory, and the main
  // thread reads it without a single byte being copied between them.
  const shared = new SharedArrayBuffer(size);
  const counter = new SharedArrayBuffer(4);
  const done = new Int32Array(counter);

  const slices = bands(params.height, threads);
  const workers = slices.map(() => new Worker("/workers/mandelbrot.worker.js"));

  const started = performance.now();

  await new Promise<void>((resolve, reject) => {
    let finished = 0;
    const timeout = setTimeout(() => reject(new Error("workers timed out")), 30_000);

    workers.forEach((worker, index) => {
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(`worker failed: ${event.message}`));
      };
      worker.onmessage = () => {
        finished += 1;
        if (finished === workers.length) {
          clearTimeout(timeout);
          resolve();
        }
      };
      worker.postMessage({
        buffer: shared,
        doneCounter: counter,
        params,
        rowStart: slices[index][0],
        rowEnd: slices[index][1],
      });
    });
  }).finally(() => {
    // Workers are not cheap to leave running, and a benchmark that leaks one
    // per click degrades every subsequent measurement it takes.
    for (const worker of workers) worker.terminate();
  });

  const ms = performance.now() - started;
  const pixels = new Uint8Array(shared).slice();

  return {
    backend: "workers",
    ms,
    checksum: checksum(pixels),
    pixels,
    // Atomics.load, not the plain read: the counter is written by other threads,
    // and a non-atomic read of it is exactly the kind of thing that works in
    // testing and reports nonsense under load.
    note: `${workers.length} threads, ${Atomics.load(done, 0)} bands acknowledged`,
  };
}

/* ------------------------------------------------------------ WebGPU ---- */

/**
 * The same escape-time loop as a compute shader.
 *
 * One invocation per pixel, in workgroups of 8×8 — a size chosen because it
 * divides evenly into the tile and matches the wavefront/warp width on most
 * hardware, so no invocation in a group is idle.
 *
 * f32 rather than f64 is not a shortcut: WGSL has no f64. At this zoom the
 * precision loss is visible as banding, which is why the page reports the
 * WebGPU checksum separately rather than claiming it matches — a demo that
 * quietly rounded the comparison to make the numbers agree would be the
 * dishonest version of this.
 */
const SHADER = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  maxIterations: u32,
  _pad: u32,
  centreX: f32,
  centreY: f32,
  scale: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let halfWidth = f32(params.width) * 0.5;
  let halfHeight = f32(params.height) * 0.5;
  let x0 = params.centreX + (f32(id.x) - halfWidth) * params.scale;
  let y0 = params.centreY + (f32(id.y) - halfHeight) * params.scale;

  var x = 0.0;
  var y = 0.0;
  var xx = 0.0;
  var yy = 0.0;
  var iteration = 0u;

  loop {
    if (xx + yy > 4.0 || iteration >= params.maxIterations) { break; }
    y = 2.0 * x * y + y0;
    x = xx - yy + x0;
    xx = x * x;
    yy = y * y;
    iteration = iteration + 1u;
  }

  var value = 0u;
  if (iteration < params.maxIterations) {
    value = (iteration * 255u) / params.maxIterations;
  }
  output[id.y * params.width + id.x] = value;
}
`;

interface GpuNavigator {
  gpu: {
    requestAdapter(): Promise<{
      requestDevice(): Promise<GPUDeviceLike>;
      info?: { vendor?: string; architecture?: string };
    } | null>;
  };
}

// Minimal structural types: @webgpu/types is a dependency for a demo that
// feature-detects its way out on most browsers anyway.
interface GPUDeviceLike {
  createShaderModule(descriptor: { code: string }): unknown;
  createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }): GPUBufferLike;
  createComputePipeline(descriptor: unknown): { getBindGroupLayout(index: number): unknown };
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): GPUEncoderLike;
  queue: {
    writeBuffer(buffer: GPUBufferLike, offset: number, data: BufferSource): void;
    submit(buffers: unknown[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  destroy(): void;
}
interface GPUBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
interface GPUEncoderLike {
  beginComputePass(): {
    setPipeline(pipeline: unknown): void;
    setBindGroup(index: number, group: unknown): void;
    dispatchWorkgroups(x: number, y: number): void;
    end(): void;
  };
  copyBufferToBuffer(
    source: GPUBufferLike,
    sourceOffset: number,
    destination: GPUBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export async function runWebGpu(params: TileParams): Promise<RunResult> {
  const adapter = await (navigator as unknown as GpuNavigator).gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter available.");
  const device = await adapter.requestDevice();

  const pixelCount = params.width * params.height;
  // One u32 per pixel rather than a packed byte array: WGSL storage buffers
  // address in 4-byte units, and hand-packing four pixels per word would add
  // shifting to the hot loop to save memory this demo does not need.
  const outputSize = pixelCount * 4;

  const USAGE = {
    UNIFORM: 0x40,
    STORAGE: 0x80,
    COPY_DST: 0x8,
    COPY_SRC: 0x4,
    MAP_READ: 0x1,
  };

  const uniform = device.createBuffer({ size: 32, usage: USAGE.UNIFORM | USAGE.COPY_DST });
  const storage = device.createBuffer({ size: outputSize, usage: USAGE.STORAGE | USAGE.COPY_SRC });
  const readback = device.createBuffer({ size: outputSize, usage: USAGE.COPY_DST | USAGE.MAP_READ });

  // Layout must match the WGSL struct exactly: four u32 then four f32, with the
  // padding fields present. A mismatch here does not error — it silently reads
  // the wrong bytes and renders noise.
  const uniformData = new ArrayBuffer(32);
  new Uint32Array(uniformData, 0, 4).set([params.width, params.height, params.maxIterations, 0]);
  new Float32Array(uniformData, 16, 4).set([params.centreX, params.centreY, params.scale, 0]);
  device.queue.writeBuffer(uniform, 0, uniformData);

  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: "main" },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: storage } },
    ],
  });

  const started = performance.now();

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(params.width / 8), Math.ceil(params.height / 8));
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, outputSize);
  device.queue.submit([encoder.finish()]);

  // The GPU runs asynchronously, so the clock has to stop after the work is
  // actually done — not after the commands are queued. Timing the submit alone
  // would report a fraction of a millisecond and be meaningless.
  await device.queue.onSubmittedWorkDone();
  const ms = performance.now() - started;

  await readback.mapAsync(USAGE.MAP_READ);
  const words = new Uint32Array(readback.getMappedRange().slice(0));
  readback.unmap();

  const pixels = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) pixels[i] = words[i];

  for (const buffer of [uniform, storage, readback]) buffer.destroy();
  device.destroy();

  return {
    backend: "webgpu",
    ms,
    checksum: checksum(pixels),
    pixels,
    note: "f32 shader — see the note on precision",
  };
}
