/**
 * P13 — escaping for the two places React does not do it for us.
 *
 * React escapes everything it renders as a child, which is why the blog body,
 * the chat bubbles and the admin tables are safe without any of this: they are
 * text nodes. The exceptions are the `dangerouslySetInnerHTML` call sites,
 * which by definition opt out of that protection, and outbound email, which is
 * not React at all (lib/email/layout.ts owns that one).
 */

/**
 * U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR, built from their code
 * points rather than written as literals.
 *
 * Not fussiness — it is the bug itself, one level down. A raw U+2028 is a line
 * terminator to a JavaScript parser, so writing one inside a regex literal here
 * ends that literal and the file stops compiling. That is the same fact
 * `jsonForScript` exists to defend against, just aimed at this file instead of
 * at a rendered page.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * Serialise a value for embedding inside a `<script>` element.
 *
 * `JSON.stringify` alone is not enough, and the reason is a parsing rule rather
 * than an escaping one: inside a `<script>` block the HTML parser is looking
 * for the literal characters `</script` and ends the element there — even in
 * the middle of a JSON string. So a value containing `</script><img
 * onerror=…>` breaks out of the script and into the document while the JSON
 * remains perfectly valid JSON.
 *
 * The three replacements are the standard set:
 *
 * - `<` becomes `<`, which `JSON.parse` reads back as `<` but the HTML
 *   parser never sees as the start of a tag. This is the one that matters.
 * - U+2028 and U+2029 are legal inside a JSON string and illegal inside a
 *   JavaScript string literal, so a value carrying one turns the script into a
 *   syntax error. They are matched via escape sequences rather than written
 *   literally, because a raw U+2028 in this file would terminate the regex
 *   literal containing it — which is exactly the class of bug being fixed.
 *
 * The JSON-LD on the homepage is built from static constants today, so nothing
 * hostile can reach it. It is escaped anyway: "the input is static" is a
 * property of today's data, not of this function.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/**
 * Escape a value for interpolation into an HTML attribute or text node.
 *
 * Only for code that builds HTML strings by hand. If you are in a React
 * component you do not need this — passing the value as a child is already
 * safe, and reaching for `dangerouslySetInnerHTML` in order to use this would
 * be a step backwards.
 *
 * The ampersand is replaced first, or the entities produced by the later
 * replacements get escaped a second time.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
