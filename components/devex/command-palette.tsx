"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { rank } from "../../lib/devex/fuzzy";
import { allCommands, type Command } from "../../lib/devex/commands";
import "./terminal.css";
import { OPEN_PALETTE_EVENT, consumePaletteRequest } from "../../lib/devex/palette-events";

/**
 * P17 — the Cmd+K palette.
 *
 * **It renders nothing until it is opened**, which is the whole reason it can
 * be mounted globally without arguing with the performance work in P12. Closed,
 * it is one keydown listener.
 *
 * Two accessibility details that are the difference between a palette and a
 * div that looks like one, and both are the kind of thing that passes a
 * screenshot and fails a screen reader:
 *
 * - The input owns `role="combobox"` with `aria-activedescendant` pointing at
 *   the highlighted row, so the selection is announced while focus stays in the
 *   text field. Moving DOM focus to the list instead would take focus out of
 *   the input and stop typing from working.
 * - Focus is trapped and restored. Opening from a keyboard and closing back to
 *   nowhere strands the user at the top of the document.
 */

const EMAIL = "shivampatilinfo@gmail.com";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const commands = useMemo(() => allCommands(), []);
  const results = useMemo(() => rank(query, commands, 14), [query, commands]);

  // Clamped during render rather than corrected in an effect.
  //
  // Typing narrows the list, so a stored index can end up past the end — and
  // then Enter silently selects nothing. Fixing that with an effect means a
  // render with the bad value happens first and a second render undoes it,
  // which is the cascading-render pattern the compiler rules reject. Deriving
  // it means there is never a frame where it is wrong.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    restoreFocusTo.current?.focus();
  }, []);

  const run = useCallback(
    (command: Command) => {
      switch (command.kind) {
        case "navigate":
          close();
          router.push(command.href ?? "/");
          break;
        case "external":
          close();
          // Not router.push: /d/resume is a redirect handler that counts the
          // download and then 302s to the file. Pushing it into the client
          // router would try to render a route that never returns HTML.
          window.location.href = command.href ?? "/";
          break;
        case "theme": {
          if (command.id === "action-theme-light") setTheme("light");
          else if (command.id === "action-theme-dark") setTheme("dark");
          else setTheme(resolvedTheme === "dark" ? "light" : "dark");
          close();
          break;
        }
        case "action": {
          if (command.id === "action-copy-email") {
            navigator.clipboard
              ?.writeText(EMAIL)
              .then(() => setToast("Email copied"))
              .catch(() => setToast("Could not copy — the address is in the footer"));
          }
          if (command.id === "action-customize") {
            // The customiser lives on the page; the palette just asks for it.
            window.dispatchEvent(new CustomEvent("sf:open-theme-customizer"));
          }
          close();
          break;
        }
      }
    },
    [close, router, setTheme, resolvedTheme],
  );

  // The global shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteKey) {
        event.preventDefault();
        restoreFocusTo.current = document.activeElement as HTMLElement;
        setOpen((current) => !current);
        return;
      }
      // "/" is the other convention, but only when the user is not typing into
      // something — otherwise it hijacks every search box on the site.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing && !open) {
        event.preventDefault();
        restoreFocusTo.current = document.activeElement as HTMLElement;
        setOpen(true);
      }
    };

    /**
     * A programmatic way in, so the palette is not keyboard-only.
     *
     * The homepage invites a visitor to "press ctrl K", which is useless on a
     * phone — there is no ctrl key to press, and a device with no keyboard had
     * no route into the palette at all. That instruction is now also a button,
     * and this is what it fires.
     *
     * A CustomEvent rather than lifted state or a context: the palette mounts
     * once in the layout and the trigger can be anywhere on any page, so
     * threading a setter through would mean a provider wrapping the whole tree
     * to serve one boolean.
     */
    const onOpenRequest = () => {
      restoreFocusTo.current = document.activeElement as HTMLElement;
      setOpen(true);
    };

    /**
     * A request made before this component existed.
     *
     * The palette is mounted after `requestIdleCallback` fires and its chunk
     * loads, and the homepage tells a visitor to open it as their first action
     * — so the likeliest click on "Press ctrl K to start" lands in the window
     * where this listener is not attached yet, and a CustomEvent with no
     * listener is dropped without a trace. lib/devex/palette-events.ts records
     * every request so this can claim one on arrival. Returns true at most
     * once, so a request cannot re-open the palette later.
     */
    if (consumePaletteRequest()) onOpenRequest();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  // Keep the highlighted row visible without scrolling the page behind it.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) {
    return toast ? (
      <p className="palette-toast" role="status">
        {toast}
      </p>
    ) : null;
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself, not one that started inside the
        // dialog and drifted out while selecting text.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => (results.length ? (current + 1) % results.length : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) =>
              results.length ? (current - 1 + results.length) % results.length : 0,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            const chosen = results[activeIndex];
            if (chosen) run(chosen.item);
          } else if (event.key === "Tab") {
            // Focus trap: there is exactly one focusable element, so the trap
            // is simply "stay here".
            event.preventDefault();
          }
        }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages and actions…"
          aria-label="Search pages and actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={
            results[activeIndex] ? `palette-${results[active].item.id}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
        />

        <ul className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <li className="palette-empty" role="presentation">
              Nothing matches “{query}”.
            </li>
          )}
          {results.map((result, index) => (
            <li
              key={result.item.id}
              id={`palette-${result.item.id}`}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex}
              className="palette-row"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                run(result.item);
              }}
            >
              <span className="palette-row-label">{result.item.label}</span>
              <span className="palette-row-group">{result.item.group}</span>
            </li>
          ))}
        </ul>

        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
