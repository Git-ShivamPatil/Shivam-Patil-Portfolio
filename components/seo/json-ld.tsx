import { jsonForScript } from "../../lib/security/escape";

/**
 * Renders one or more JSON-LD blocks.
 *
 * Exists so no page has to repeat the `<script type="application/ld+json">`
 * boilerplate — and, more importantly, so no page can forget `jsonForScript`.
 * Before this component the site had exactly one JSON-LD call site and it did
 * remember; the risk arrives with the thirtieth, especially since several of
 * the new blocks carry database-backed text (project summaries, blog excerpts)
 * where a `</script` is a content edit away rather than impossible by
 * construction.
 *
 * Multiple graphs are emitted as separate `<script>` elements rather than as
 * one array. Both are valid, and separate elements mean one malformed block
 * cannot invalidate the others.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((block, index) => (
        <script
          // The index is a stable key here: `blocks` is built fresh on the
          // server for each render and never reordered or filtered.
          key={index}
          type="application/ld+json"
          // sast-ignore: dangerous-html — jsonForScript is the P13 serialiser; it neutralises `</script` and the U+2028/9 separators.
          dangerouslySetInnerHTML={{ __html: jsonForScript(block) }}
        />
      ))}
    </>
  );
}
