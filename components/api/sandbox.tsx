"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * P24 — the API sandbox.
 *
 * **It builds itself from `/api/openapi`.** The endpoint list, the summaries and
 * the example bodies are all read from the specification at runtime rather than
 * hard-coded here. That is the only arrangement in which a console and a spec
 * cannot disagree: a hand-written list beside a hand-written document is two
 * inventories, and the one nobody is looking at goes stale first.
 *
 * **Read-only by default.** Only GET operations, plus the two POSTs that are
 * pure functions of their body (`/api/graphql`, `/api/rpc`), are offered. A
 * public write console on a live site is an abuse endpoint with a nice
 * interface, and `/api/contact` would put a stranger's message in a real inbox.
 */

interface Operation {
  id: string;
  method: "GET" | "POST";
  path: string;
  summary: string;
  body?: string;
}

interface Result {
  status: number;
  ms: number;
  bytes: number;
  contentType: string;
  body: string;
  binary: boolean;
}

/** Operations the sandbox is willing to issue. Everything else is display-only. */
const ALLOWED = new Set([
  "GET /api/health",
  "GET /api/search",
  "GET /api/integrations/github",
  "GET /api/integrations/leetcode",
  "GET /api/openapi",
  "GET /api/graphql",
  "GET /api/rpc",
  "POST /api/graphql",
]);

interface SpecShape {
  paths?: Record<
    string,
    Record<
      string,
      {
        summary?: string;
        requestBody?: {
          content?: Record<string, { examples?: Record<string, { value?: unknown }> }>;
        };
      }
    >
  >;
}

function operationsFrom(spec: SpecShape): Operation[] {
  const operations: Operation[] = [];

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const upper = method.toUpperCase();
      if (upper !== "GET" && upper !== "POST") continue;
      if (!ALLOWED.has(`${upper} ${path}`)) continue;

      // The first example in the spec becomes the prefilled body. If the spec
      // gains a better example, this picks it up without a code change.
      const examples = operation.requestBody?.content?.["application/json"]?.examples ?? undefined;
      const firstExample = examples ? Object.values(examples)[0]?.value : undefined;

      operations.push({
        id: `${upper} ${path}`,
        method: upper,
        path: path === "/api/search" ? "/api/search?q=rate+limiter" : path,
        summary: operation.summary ?? path,
        body: firstExample ? JSON.stringify(firstExample, null, 2) : undefined,
      });
    }
  }

  return operations;
}

export function ApiSandbox() {
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/openapi")
      .then((response) => response.json())
      .then((spec: SpecShape) => {
        if (cancelled) return;
        const found = operationsFrom(spec);
        setOperations(found);
        const first = found[0];
        if (first) {
          setSelectedId(first.id);
          setBody(first.body ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setOperations([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = operations?.find((operation) => operation.id === selectedId) ?? null;

  const choose = useCallback((operation: Operation) => {
    setSelectedId(operation.id);
    setBody(operation.body ?? "");
    // Cleared, not kept. A response left on screen under a different endpoint
    // is the most confusing thing a console can show.
    setResult(null);
  }, []);

  const send = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setResult(null);

    const started = performance.now();
    try {
      const response = await fetch(selected.path, {
        method: selected.method,
        ...(selected.method === "POST"
          ? { headers: { "Content-Type": "application/json" }, body }
          : {}),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const buffer = await response.arrayBuffer();
      const binary = contentType.includes("proto") || contentType.includes("octet-stream");

      let text: string;
      if (binary) {
        // Hex, in rows. A protobuf frame rendered as text is mojibake, and the
        // point of showing it at all is the framing — the leading zero flag and
        // the four-byte length are visible in the first five bytes.
        const bytes = new Uint8Array(buffer);
        text = [...bytes]
          .map(
            (byte, index) =>
              `${byte.toString(16).padStart(2, "0")}${(index + 1) % 16 === 0 ? "\n" : " "}`,
          )
          .join("")
          .trim();
      } else {
        const raw = new TextDecoder().decode(buffer);
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          text = raw;
        }
      }

      setResult({
        status: response.status,
        ms: Math.round(performance.now() - started),
        bytes: buffer.byteLength,
        contentType,
        body: text.slice(0, 20_000),
        binary,
      });
    } catch (error) {
      setResult({
        status: 0,
        ms: Math.round(performance.now() - started),
        bytes: 0,
        contentType: "",
        body: error instanceof Error ? error.message : String(error),
        binary: false,
      });
    } finally {
      setBusy(false);
    }
  }, [selected, body]);

  if (operations === null) return <p className="api-note">Reading the specification…</p>;

  if (operations.length === 0) {
    return (
      <div className="api-panel">
        <p className="api-note">
          The specification could not be read, so there is nothing to offer. The sandbox is built
          from <code>/api/openapi</code> rather than from a hard-coded list, which means it cannot
          drift from the spec — and cannot exist without it.
        </p>
      </div>
    );
  }

  return (
    <div className="api-sandbox">
      <div className="api-operations" role="group" aria-label="Endpoint">
        {operations.map((operation) => (
          <button
            key={operation.id}
            type="button"
            className="api-operation"
            data-active={operation.id === selectedId}
            aria-pressed={operation.id === selectedId}
            onClick={() => choose(operation)}
          >
            <span className="api-method">{operation.method}</span>
            <code>{operation.path.split("?")[0]}</code>
          </button>
        ))}
      </div>

      {selected ? <p className="api-note">{selected.summary}</p> : null}

      {selected?.method === "POST" ? (
        <label className="api-body">
          <span className="sr-only">Request body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className="api-actions">
        <button type="button" className="api-send" onClick={send} disabled={busy || !selected}>
          {busy ? "Sending…" : "Send"}
        </button>
        <span className="api-note">
          Issued from your browser against this origin — the response below is the real one.
        </span>
      </div>

      {result ? (
        <div className="api-result" data-ok={result.status >= 200 && result.status < 400}>
          <p className="api-result-meta">
            <strong>{result.status === 0 ? "network error" : result.status}</strong>
            <span>{result.ms}ms</span>
            <span>{result.bytes} bytes</span>
            {result.contentType ? <span>{result.contentType.split(";")[0]}</span> : null}
          </p>
          <pre>
            <code>{result.body}</code>
          </pre>
          {result.binary ? (
            <p className="api-note">
              Raw bytes. The first five are the frame: <code>00</code> for uncompressed, then a
              four-byte big-endian length. Everything after is the protobuf message.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
