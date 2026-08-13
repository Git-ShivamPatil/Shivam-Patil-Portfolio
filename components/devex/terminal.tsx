"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  NAVIGATION_COMMANDS,
  TERMINAL_COMMANDS,
  parseLine,
  resolvePage,
} from "../../lib/devex/commands";
import "./terminal.css";

/**
 * P17 — a real terminal, not a typewriter animation.
 *
 * The distinction matters because the version of this that appears on most
 * portfolios prints a scripted sequence and ignores what you type. This one
 * parses input, navigates the actual router, changes the actual theme, and —
 * the reason it is worth building at all — `ask` runs the same P16 retrieval
 * endpoint `/ask` uses and prints the answer with its sources. It can tell you
 * something the site knows, from a prompt.
 *
 * Accessibility is the part a terminal usually fails. The transcript is a
 * `log` live region so a screen reader hears output as it arrives, the input is
 * a real labelled `<input>` rather than a contenteditable div pretending, and
 * every command is reachable by typing `help` — there is no hidden syntax.
 */

interface Line {
  id: number;
  kind: "input" | "output" | "error" | "link";
  text: string;
  href?: string;
}

const BANNER = [
  "shivamsfolio — type `help` for commands, `ask <question>` to query the site.",
];

export function Terminal() {
  const [lines, setLines] = useState<Line[]>(
    BANNER.map((text, index) => ({ id: index, kind: "output" as const, text })),
  );
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // Shell history, arrow-key navigable. Newest last.
  const history = useRef<string[]>([]);
  const historyCursor = useRef<number>(-1);
  const nextId = useRef(BANNER.length);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();

  const push = useCallback((entries: Omit<Line, "id">[]) => {
    setLines((current) => [
      ...current,
      ...entries.map((entry) => ({ ...entry, id: nextId.current++ })),
    ]);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const run = useCallback(
    async (raw: string) => {
      const { name, argument } = parseLine(raw);
      if (!name) return;

      push([{ kind: "input", text: raw }]);
      history.current.push(raw);
      historyCursor.current = -1;

      switch (name) {
        case "help":
          push(
            TERMINAL_COMMANDS.map((command) => ({
              kind: "output" as const,
              text: `${command.usage.padEnd(22)} ${command.summary}`,
            })),
          );
          return;

        case "ls":
          push(
            NAVIGATION_COMMANDS.map((command) => ({
              kind: "output" as const,
              text: `${(command.href ?? "").padEnd(18)} ${command.label}`,
            })),
          );
          return;

        case "cd":
        case "open": {
          const target = resolvePage(argument);
          if (!target?.href) {
            push([{ kind: "error", text: `No such page: ${argument || "(nothing given)"}` }]);
            return;
          }
          push([{ kind: "output", text: `→ ${target.href}` }]);
          router.push(target.href);
          return;
        }

        case "whoami":
          push([
            { kind: "output", text: "Shivam Patil — software engineer, Mumbai." },
            { kind: "output", text: "Backend platforms, distributed systems, AI products." },
            { kind: "link", text: "/about", href: "/about" },
          ]);
          return;

        case "stack":
          push([
            { kind: "output", text: "Next.js 16 · TypeScript · Prisma 7 · Neon Postgres · Tailwind v4" },
            { kind: "output", text: "pgvector retrieval · SSE realtime · first-party analytics" },
            { kind: "output", text: "Deployed on Vercel. Everything degrades when a key is absent." },
            { kind: "link", text: "/system-design", href: "/system-design" },
          ]);
          return;

        case "theme": {
          const wanted = argument.toLowerCase();
          if (!wanted) {
            push([{ kind: "output", text: `theme is ${resolvedTheme ?? "unknown"}` }]);
            return;
          }
          if (wanted !== "light" && wanted !== "dark") {
            push([{ kind: "error", text: "usage: theme [light|dark]" }]);
            return;
          }
          setTheme(wanted);
          push([{ kind: "output", text: `theme set to ${wanted}` }]);
          return;
        }

        case "resume":
          push([{ kind: "output", text: "Downloading the résumé…" }]);
          // Not router.push: /d/resume is a redirect handler that counts the
          // download server-side and then 302s to the file. Pushing it into
          // the client router would try to render a route that never returns
          // HTML — and routing the preview through it is exactly what HANDOFF
          // says must not happen.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/d/resume";
          return;

        case "clear":
          setLines([]);
          return;

        case "ask": {
          if (!argument) {
            push([{ kind: "error", text: "usage: ask <question>" }]);
            return;
          }
          setBusy(true);
          push([{ kind: "output", text: "searching…" }]);
          try {
            const response = await fetch("/api/ai/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: argument }),
            });
            const json = (await response.json()) as {
              answer?: { text: string; confidence: string; sources: { url: string; title: string }[] };
              error?: string;
            };
            if (!response.ok || !json.answer) {
              push([{ kind: "error", text: json.error ?? "Search is unavailable." }]);
              return;
            }
            push([
              { kind: "output", text: json.answer.text },
              ...json.answer.sources.slice(0, 3).map((source) => ({
                kind: "link" as const,
                text: `${source.url} — ${source.title}`,
                href: source.url,
              })),
              {
                kind: "output" as const,
                // Said every time, because a terminal makes output look
                // authoritative and this is a retrieval result, not a verdict.
                text:
                  json.answer.confidence === "high"
                    ? "(quoted from the pages above)"
                    : "(partial match — quoted from the pages above)",
              },
            ]);
          } catch {
            push([{ kind: "error", text: "Network error." }]);
          } finally {
            setBusy(false);
          }
          return;
        }

        default:
          push([{ kind: "error", text: `command not found: ${name} — try \`help\`` }]);
      }
    },
    [push, router, setTheme, resolvedTheme],
  );

  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      <header className="terminal-bar">
        <span className="terminal-dot" />
        <span className="terminal-dot" />
        <span className="terminal-dot" />
        <span className="terminal-title">visitor@shivamsfolio — bash</span>
      </header>

      <div className="terminal-screen" ref={scrollRef}>
        {/* `log` rather than `status`: output arrives as a stream of discrete
            messages, which is what a log region is for, and it does not
            interrupt whatever the reader is already hearing. */}
        <div role="log" aria-live="polite" aria-label="Terminal output">
          {lines.map((line) => {
            if (line.kind === "link") {
              return (
                <p key={line.id} className="terminal-line">
                  <a href={line.href}>{line.text}</a>
                </p>
              );
            }
            return (
              <p key={line.id} className={`terminal-line terminal-${line.kind}`}>
                {line.kind === "input" && <span className="terminal-prompt">$</span>}
                {line.text}
              </p>
            );
          })}
        </div>

        <form
          className="terminal-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            const line = value;
            setValue("");
            void run(line);
          }}
        >
          <label htmlFor="terminal-input" className="terminal-prompt" aria-label="Command">
            $
          </label>
          <input
            id="terminal-input"
            ref={inputRef}
            value={value}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Shell history. The cursor walks backwards from the end and
              // returns to an empty prompt when it walks past the newest entry.
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (history.current.length === 0) return;
                historyCursor.current =
                  historyCursor.current === -1
                    ? history.current.length - 1
                    : Math.max(0, historyCursor.current - 1);
                setValue(history.current[historyCursor.current] ?? "");
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                if (historyCursor.current === -1) return;
                historyCursor.current += 1;
                if (historyCursor.current >= history.current.length) {
                  historyCursor.current = -1;
                  setValue("");
                } else {
                  setValue(history.current[historyCursor.current] ?? "");
                }
              } else if (event.key === "Tab") {
                // Completion over command names only. Completing paths too
                // would need a second namespace and this has ten commands.
                event.preventDefault();
                const prefix = value.trim().toLowerCase();
                const match = TERMINAL_COMMANDS.find((command) => command.name.startsWith(prefix));
                if (match && prefix) setValue(match.name + " ");
              } else if (event.key === "l" && event.ctrlKey) {
                event.preventDefault();
                setLines([]);
              }
            }}
          />
        </form>
      </div>
    </div>
  );
}
