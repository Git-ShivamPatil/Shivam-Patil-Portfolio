"use client";

import { useMemo, useState } from "react";
import type { SkillCategory } from "../../app/skills";
import "./skill-search.css";

/**
 * A search box and category chips over the skill list.
 *
 * ### Why this page in particular
 *
 * /skills is the page a recruiter opens with one question already formed —
 * "does he know Rust?" — and before this it answered by making them read.
 * Twelve category groups of chips, rendered flat, with no way to ask. The
 * answer was on the page; finding it was the visitor's problem.
 *
 * ### Why the skills are still all in the HTML
 *
 * Every skill is rendered on the server and remains in the DOM; filtering sets
 * `hidden` on the ones that do not match rather than removing them from the
 * tree. That is deliberate and it is an SEO constraint, not an implementation
 * shortcut: /skills is the only page on this site whose rendered text contains
 * the strings "C++", "Rust" and "Go", so a filter that rebuilt the list from
 * client state would leave a crawler seeing whatever the default filter
 * happened to be. `hidden` content is still indexed; content that was never
 * rendered is not.
 *
 * The same reasoning is why the empty state is a message rather than an early
 * return: the list element has to stay mounted.
 *
 * ### Why a client component here when the rest of the page is server-rendered
 *
 * The page keeps its server-rendered skill graph and its heading. Only this
 * control is a client island, and it holds two pieces of state — a query string
 * and a selected category. There is no way to do a live text filter without
 * one, and `<details>` (which is how the dense prose pages avoid this) cannot
 * express "show me the matching subset".
 */
export function SkillSearch({ categories }: { categories: SkillCategory[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const total = useMemo(
    () => categories.reduce((sum, category) => sum + category.items.length, 0),
    [categories],
  );

  const needle = query.trim().toLowerCase();

  // Computed per render rather than memoised: it is a substring test over a few
  // dozen short strings, which is far cheaper than the bookkeeping to cache it.
  const matches = (item: string) => needle === "" || item.toLowerCase().includes(needle);
  const visibleCount = categories
    .filter((category) => active === null || category.label === active)
    .reduce((sum, category) => sum + category.items.filter(matches).length, 0);

  return (
    <div className="skill-search">
      <div className="skill-search-controls">
        <label className="skill-search-field">
          <span className="skill-search-label">Search skills</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try Rust, Kubernetes, C++…"
            // enterKeyHint rather than a submit button: there is nothing to
            // submit, the filter is live, and a form here would offer a button
            // that does nothing.
            enterKeyHint="search"
            autoComplete="off"
          />
        </label>

        {/* `role="group"` and not `role="tablist"`: these are filters, not tabs.
            A tablist promises arrow-key navigation between panels, and there is
            one list here, not twelve panels. */}
        <div className="skill-search-chips" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={active === null ? "is-active" : undefined}
            aria-pressed={active === null}
            onClick={() => setActive(null)}
          >
            Everything <span>{total}</span>
          </button>
          {categories.map((category) => (
            <button
              key={category.label}
              type="button"
              className={active === category.label ? "is-active" : undefined}
              aria-pressed={active === category.label}
              onClick={() => setActive(active === category.label ? null : category.label)}
            >
              {category.label} <span>{category.items.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* aria-live so a screen reader hears the result count change. `polite`
          rather than `assertive`: it must not interrupt the letter the visitor
          is still typing. */}
      <p className="skill-search-count" aria-live="polite">
        {needle === "" && active === null
          ? `${total} skills, grouped.`
          : `${visibleCount} of ${total} match.`}
      </p>

      <div className="skill-groups">
        {categories.map((category) => {
          const inCategory = active === null || category.label === active;
          const shown = category.items.filter(matches);
          return (
            <div
              key={category.label}
              className="skill-group"
              hidden={!inCategory || shown.length === 0}
            >
              <h2>{category.label}</h2>
              <ul className="skill-chip-list">
                {category.items.map((item) => (
                  // `hidden` rather than filtered out — see the note above.
                  <li key={item} hidden={!matches(item)}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {visibleCount === 0 ? (
        <p className="skill-search-empty">
          Nothing matches “{query}”. It may still be something I can pick up — the list is what I
          have shipped with, not the ceiling.
        </p>
      ) : null}
    </div>
  );
}
