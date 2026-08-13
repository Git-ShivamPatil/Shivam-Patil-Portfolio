/**
 * P16 — the in-browser language model.
 *
 * **Nothing in this file is imported until a visitor asks for it.** The WebLLM
 * runtime is ~14MB of JavaScript and the model is a few hundred megabytes
 * downloaded from a third party, so it lives behind a dynamic `import()` fired
 * by a click. A portfolio that spent 400MB of someone's connection to answer a
 * question they did not ask would be a worse portfolio than one with no AI on
 * it at all.
 *
 * **Why in the browser rather than on the server.** The constraint is the same
 * one that shaped every other integration here: free tier only. A hosted model
 * is metered per token, and a public endpoint calling one is an open invitation
 * to spend someone else's money. Running on the visitor's own GPU costs nothing
 * to operate, sends their question to no one, and — for a portfolio about
 * building systems under constraints — is a more interesting answer than an API
 * key.
 *
 * The trade, stated plainly: it needs WebGPU (Chrome, Edge, and Safari 18+),
 * it downloads a large model the first time, and a 360M-parameter model is not
 * a frontier model. That is why the server's extractive answer is the default
 * and this is opt-in — see lib/ai/answer.ts.
 */

/**
 * SmolLM2-360M, at ~376MB of VRAM.
 *
 * The smallest model in WebLLM's catalogue that follows an instruction to stay
 * within a provided context. Qwen2.5-0.5B and Llama-3.2-1B both write better
 * prose and both need roughly 900MB — nearly a gigabyte of download before a
 * visitor sees anything, on a page where the honest answer was already on
 * screen. Grounded summarisation of six retrieved passages is a job the small
 * model can do.
 */
export const MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";

/** Roughly what the first run downloads, for the consent prompt. */
export const MODEL_DOWNLOAD_MB = 380;

export interface LoadProgress {
  /** 0 to 1, or null while the runtime is still resolving what to fetch. */
  progress: number | null;
  text: string;
}

/** WebGPU is the hard requirement; everything else degrades. */
export function supportsWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// The engine is cached for the life of the document: creating a second one
// re-downloads nothing (the weights are in the browser's cache) but does pay
// the full GPU compile again, which is several seconds.
type Engine = {
  chat: {
    completions: {
      create: (options: unknown) => Promise<AsyncIterable<StreamChunk>>;
    };
  };
};

interface StreamChunk {
  choices: { delta?: { content?: string } }[];
}

let enginePromise: Promise<Engine> | null = null;

export async function loadEngine(onProgress: (progress: LoadProgress) => void): Promise<Engine> {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    // The import itself is the 14MB. Kept inside the function so it is a
    // separate chunk that no other page pulls in.
    const webllm = await import("@mlc-ai/web-llm");
    return (await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report: { progress: number; text: string }) => {
        onProgress({
          // WebLLM reports 0 for a while before it knows the total; showing that
          // as "0%" for twenty seconds reads as a stuck download.
          progress: report.progress > 0 ? report.progress : null,
          text: report.text,
        });
      },
    })) as unknown as Engine;
  })();

  try {
    return await enginePromise;
  } catch (error) {
    // Do not cache a failure: a visitor who lost their connection mid-download
    // should be able to press the button again.
    enginePromise = null;
    throw error;
  }
}

export interface GenerateOptions {
  prompt: string;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream a grounded answer.
 *
 * The prompt is built on the server (lib/ai/answer.ts) so the grounding rules
 * travel with the retrieved context rather than being assembled by client code.
 * Temperature is low because the job is summarising six passages that are
 * already on screen, not writing — and a model this size invents more the
 * hotter it runs.
 */
export async function generate({ prompt, onToken, signal }: GenerateOptions): Promise<string> {
  const engine = await loadEngine(() => {});

  const stream = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.2,
    // Four sentences, as the prompt asks for. An unbounded generation on a
    // small model tends to keep going long after it has stopped saying
    // anything.
    max_tokens: 320,
  });

  let output = "";
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const token = chunk.choices[0]?.delta?.content ?? "";
    if (!token) continue;
    output += token;
    onToken(token);
  }
  return output;
}
