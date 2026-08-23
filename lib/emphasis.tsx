import { Fragment, type ReactNode } from "react";

/**
 * Turn `**marked**` runs in a plain string into `<strong>` elements.
 *
 * ### Why this exists rather than JSX in the data files
 *
 * The copy that most needs emphasis lives in data modules, not components:
 * `app/experience.ts` is a `string[]` of résumé bullets, and the same shape
 * feeds `/achievements`, `/resume` and the JSON-LD builders. Putting JSX in
 * those files would make them `.tsx`, drag React into modules that are
 * imported by `generateMetadata` and by structured-data builders that render
 * no markup at all, and turn a string that can be measured, sorted and
 * serialised into a node that cannot.
 *
 * A marker inside the string keeps the data a string. `emphasise()` is the
 * only place that knows what the marker means.
 *
 * ### Why not `dangerouslySetInnerHTML`
 *
 * Because it is not needed and it is not safe. This returns real React
 * elements, so the text is escaped by React exactly as it would be inline.
 * A `<script>` in the source string renders as the literal characters
 * `<script>` — the marker syntax cannot express markup, only emphasis.
 *
 * ### The syntax
 *
 * `**like this**`, matching the Markdown most people already have in their
 * fingers. Deliberately the ONLY thing supported: one marker, one meaning. An
 * unmatched `**` is left as literal text rather than swallowing the rest of
 * the string, which is what makes a typo visible instead of silently eating
 * a bullet.
 */
const MARK = /\*\*([^*]+)\*\*/g;

export function emphasise(text: string): ReactNode {
  // Fast path: most strings carry no marker at all, and this runs for every
  // bullet on every render of every page that shows one.
  if (!text.includes("**")) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  // `MARK` is module-level and stateful because of the /g flag, so reset it
  // before each use — otherwise the second call on the same string starts from
  // wherever the first one stopped.
  MARK.lastIndex = 0;

  while ((match = MARK.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}

/**
 * The plain-text form, for anywhere the string has to stay a string — a
 * `title`, a `meta` description, JSON-LD, the search index, an `aria-label`.
 *
 * Keeping both halves here is the point: the markers are an authoring
 * convenience, and every consumer that is NOT rendering to the DOM has to be
 * able to strip them without knowing why they were there.
 */
export function stripEmphasis(text: string): string {
  return text.includes("**") ? text.replace(MARK, "$1") : text;
}
