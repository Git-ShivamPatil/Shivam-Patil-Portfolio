"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS } from "../../lib/lowlevel/mandelbrot";
import {
  detect,
  runJs,
  runWasm,
  runWebGpu,
  runWorkers,
  type Availability,
  type BackendId,
  type RunResult,
} from "../../lib/lowlevel/backends";
import "./compute.css";

/**
 * P19 — the compute lab.
 *
 * Four backends, one workload, one checksum. The checksum is what makes it a
 * comparison rather than four unrelated numbers: if two backends disagree about
 * the pixels, they are not doing the same work and their timings cannot be put
 * side by side.
 *
 * Nothing runs on load. Every backend is a button, because a page that pegs
 * four cores the moment it opens is a page that measures how loaded the machine
 * already was.
 */

const LABELS: Record<BackendId, string> = {
  js: "JavaScript",
  wasm: "WebAssembly",
  workers: "Workers + SharedArrayBuffer",
  webgpu: "WebGPU compute",
};

export function ComputeLab() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [results, setResults] = useState<Partial<Record<BackendId, RunResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<BackendId, string>>>({});
  const [busy, setBusy] = useState<BackendId | null>(null);
  const [compileMs, setCompileMs] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Detection has to happen after mount: `crossOriginIsolated` does not exist
  // during a server render, and guessing it would report a capability the page
  // may not have.
  useEffect(() => setAvailability(detect()), []);

  const draw = useCallback((pixels: Uint8Array) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const image = context.createImageData(DEFAULT_PARAMS.width, DEFAULT_PARAMS.height);
    for (let i = 0; i < pixels.length; i++) {
      const value = pixels[i];
      // Greyscale rather than a colour ramp: a ramp would hide the banding the
      // WebGPU f32 path genuinely has, and that banding is the honest part of
      // the comparison.
      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, []);

  const run = useCallback(
    async (backend: BackendId) => {
      setBusy(backend);
      setErrors((current) => ({ ...current, [backend]: undefined }));

      try {
        let result: RunResult;
        if (backend === "js") result = await runJs(DEFAULT_PARAMS);
        else if (backend === "wasm") {
          const { loadKernel } = await import("../../lib/lowlevel/backends");
          const { compileMs: compiled } = await loadKernel();
          if (compiled > 0) setCompileMs(compiled);
          result = await runWasm(DEFAULT_PARAMS);
        } else if (backend === "workers") {
          result = await runWorkers(DEFAULT_PARAMS, availability?.hardwareConcurrency ?? 4);
        } else {
          result = await runWebGpu(DEFAULT_PARAMS);
        }

        setResults((current) => ({ ...current, [backend]: result }));
        draw(result.pixels);
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [backend]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setBusy(null);
      }
    },
    [availability, draw],
  );

  const baseline = results.js?.ms;
  const reference = results.js?.checksum ?? results.wasm?.checksum;

  return (
    <div className="compute-lab">
      <div className="compute-support">
        {availability ? (
          <ul>
            <li data-ok={availability.wasm}>WebAssembly {availability.wasm ? "available" : "missing"}</li>
            <li data-ok={availability.sharedMemory}>
              Cross-origin isolated {availability.sharedMemory ? "yes" : "no"} — SharedArrayBuffer{" "}
              {availability.sharedMemory ? "usable" : "unavailable"}
            </li>
            <li data-ok={availability.webgpu}>WebGPU {availability.webgpu ? "available" : "missing"}</li>
            <li data-ok>{availability.hardwareConcurrency} logical cores reported</li>
          </ul>
        ) : (
          <p className="compute-note">Detecting…</p>
        )}
      </div>

      <div className="compute-actions">
        {(Object.keys(LABELS) as BackendId[]).map((backend) => {
          const unsupported =
            (backend === "wasm" && availability && !availability.wasm) ||
            (backend === "workers" && availability && !availability.sharedMemory) ||
            (backend === "webgpu" && availability && !availability.webgpu);

          return (
            <button
              key={backend}
              type="button"
              className="button button-light"
              disabled={busy !== null || !!unsupported || !availability}
              onClick={() => void run(backend)}
              data-ripple
            >
              {busy === backend ? "Running…" : `Run ${LABELS[backend]}`}
            </button>
          );
        })}
      </div>

      <table className="compute-table">
        <caption>
          {DEFAULT_PARAMS.width}×{DEFAULT_PARAMS.height} tile, {DEFAULT_PARAMS.maxIterations} max
          iterations, identical algorithm in every backend.
        </caption>
        <thead>
          <tr>
            <th scope="col">Backend</th>
            <th scope="col">Time</th>
            <th scope="col">vs JS</th>
            <th scope="col">Pixels match</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(LABELS) as BackendId[]).map((backend) => {
            const result = results[backend];
            const error = errors[backend];
            return (
              <tr key={backend}>
                <th scope="row">{LABELS[backend]}</th>
                <td>{result ? `${result.ms.toFixed(1)} ms` : error ? "—" : "not run"}</td>
                <td>
                  {result && baseline
                    ? backend === "js"
                      ? "baseline"
                      : `${(baseline / result.ms).toFixed(2)}×`
                    : "—"}
                </td>
                <td>
                  {result && reference !== undefined
                    ? result.checksum === reference
                      ? "identical"
                      : "differs"
                    : "—"}
                </td>
                <td className="compute-note-cell">{error ? error : (result?.note ?? "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {compileMs !== null && (
        <p className="compute-note">
          The WebAssembly module compiled in {compileMs.toFixed(1)} ms. That is reported separately
          rather than folded into the run — including it would measure the loader, and excluding it
          silently would flatter the result.
        </p>
      )}

      <canvas
        ref={canvasRef}
        width={DEFAULT_PARAMS.width}
        height={DEFAULT_PARAMS.height}
        className="compute-canvas"
        aria-label="Rendered Mandelbrot tile"
        role="img"
      />
    </div>
  );
}
