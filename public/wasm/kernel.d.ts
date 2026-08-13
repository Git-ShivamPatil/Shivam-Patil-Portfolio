declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
  // Exported runtime interface
  export function __new(size: number, id: number): number;
  export function __pin(ptr: number): number;
  export function __unpin(ptr: number): void;
  export function __collect(): void;
  export const __rtti_base: number;
  /**
   * assembly/kernel/renderMandelbrot
   * @param out `usize`
   * @param width `i32`
   * @param height `i32`
   * @param centreX `f64`
   * @param centreY `f64`
   * @param scale `f64`
   * @param maxIterations `i32`
   */
  export function renderMandelbrot(out: number, width: number, height: number, centreX: number, centreY: number, scale: number, maxIterations: number): void;
  /**
   * assembly/kernel/fnv1a
   * @param ptr `usize`
   * @param length `i32`
   * @returns `u32`
   */
  export function fnv1a(ptr: number, length: number): number;
  /**
   * assembly/kernel/allocate
   * @param size `i32`
   * @returns `usize`
   */
  export function allocate(size: number): number;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;
