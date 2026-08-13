"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { MODEL_DOWNLOAD_MB, supportsWebGpu, type LoadProgress } from "./local-model";

/**
 * P16 — the ask console.
 *
 * The order of what appears on screen is the argument this feature makes:
 *
 * 1. The **extractive answer** arrives first, from the server, in one round
 *    trip. Every sentence in it exists verbatim on this site and links to where
 *    it came from. It cannot invent anything.
 * 2. The **sources** are always shown, whether or not anything is generated,
 *    because the retrieval is the useful part.
 * 3. **Generation is a button**, and the button says what it costs. A model
 *    runs on the visitor's own GPU, after they choose to download it.
 *
 * Putting the checkable answer first and the fluent one second is deliberate.
 * On a page describing a real person's real work, a confident invented claim is
 * worse than an awkward true one, and the visitor cannot tell them apart.
 */

interface Source {
  title: string;
  heading: string | null;
  url: string;
  source: string;
}

interface AskResponse {
  answer: {
    text: string;
    sentences: { text: string; url: string; title: string }[];
    sources: Source[];
    confidence: "high" | "low" | "none";
  };
  chunks: { title: string; heading: string | null; url: string; content: string }[];
  prompt: string;
  error?: string;
}

const EXAMPLES = [
  "What has he built with rate limiting?",
  "How did he improve RAG accuracy?",
  "What does he know about Kubernetes?",
  "Which projects use Postgres?",
];

export function AskConsole() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local generation state.
  const [generated, setGenerated] = useState("");
  const [generating, setGenerating] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 2) return;

    setAsking(true);
    setError(null);
    setResult(null);
    setGenerated("");
    setModelError(null);

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = (await response.json()) as AskResponse;
      if (!response.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      setResult(json);
    } catch {
      setError("Could not reach the search. Check your connection and try again.");
    } finally {
      setAsking(false);
    }
  }, []);

  const runLocalModel = useCallback(async () => {
    if (!result) return;
    setGenerating(true);
    setGenerated("");
    setModelError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Imported here, not at module scope: this is the ~14MB runtime, and a
      // visitor who never presses the button never downloads a byte of it.
      const { generate, loadEngine } = await import("./local-model");
      await loadEngine(setLoadProgress);
      setLoadProgress(null);
      await generate({
        prompt: result.prompt,
        onToken: (token) => setGenerated((current) => current + token),
        signal: controller.signal,
      });
    } catch (caught) {
      setModelError(
        caught instanceof Error
          ? `The local model could not run: ${caught.message}`
          : "The local model could not run.",
      );
      setLoadProgress(null);
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [result]);

  const webGpu = typeof window !== "undefined" && supportsWebGpu();

  return (
    <div className="ask-console">
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-input" className="chat-visually-hidden">
          Ask a question about this portfolio
        </label>
        <input
          id="ask-input"
          type="search"
          value={question}
          placeholder="Ask anything about my work…"
          onChange={(event) => setQuestion(event.target.value)}
          autoComplete="off"
        />
        <button type="submit" disabled={asking || question.trim().length < 2} data-ripple>
          {asking ? "Searching…" : "Ask"}
        </button>
      </form>

      <ul className="ask-examples">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => {
                setQuestion(example);
                void ask(example);
              }}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p className="ask-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="ask-result">
          <div className="ask-answer">
            <div className="ask-answer-head">
              <h2>Answer</h2>
              <span className={`ask-badge ask-badge-${result.answer.confidence}`}>
                {result.answer.confidence === "high"
                  ? "Direct match"
                  : result.answer.confidence === "low"
                    ? "Partial match"
                    : "No match"}
              </span>
            </div>
            <p className="ask-answer-text">{result.answer.text}</p>
            <p className="ask-note">
              Quoted verbatim from the pages below — nothing here is generated, so it cannot say
              anything the site does not.
            </p>
          </div>

          {result.answer.sources.length > 0 && (
            <div className="ask-sources">
              <h3>Sources</h3>
              <ul>
                {result.answer.sources.map((source) => (
                  <li key={`${source.url}-${source.heading ?? ""}`}>
                    <Link href={source.url}>
                      {source.title}
                      {source.heading && <span> — {source.heading}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ask-local">
            <h3>Generate a summary locally</h3>
            {!webGpu ? (
              <p className="ask-note">
                This browser has no WebGPU, so the local model cannot run here. The answer above
                does not need it. WebGPU ships in Chrome, Edge and Safari 18+.
              </p>
            ) : (
              <>
                <p className="ask-note">
                  Downloads a ~{MODEL_DOWNLOAD_MB}MB model once and runs it on your own GPU. Your
                  question never leaves your browser, and it is grounded on the same passages listed
                  above — but it is a small model, so trust the quoted answer over this one.
                </p>
                <button
                  type="button"
                  className="button button-solid"
                  onClick={() => void runLocalModel()}
                  disabled={generating}
                  data-ripple
                >
                  {generating ? "Running…" : "Run the local model"}
                </button>
              </>
            )}

            {loadProgress && (
              <p className="ask-progress" aria-live="polite">
                {loadProgress.progress === null
                  ? "Preparing the model…"
                  : `Loading — ${Math.round(loadProgress.progress * 100)}%`}
                <span>{loadProgress.text}</span>
              </p>
            )}

            {modelError && (
              <p className="ask-error" role="alert">
                {modelError}
              </p>
            )}

            {generated && (
              <div className="ask-generated">
                <p>{generated}</p>
                <span className="ask-note">
                  Generated in your browser, grounded on the sources above.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
