import { buildLlmsFullTxt } from "../../lib/seo/llms";
import { buildCorpus } from "../../lib/ai/corpus";
import { readOrFallback } from "../../lib/db-read";
import { withRed } from "../../lib/sre/red";

export const runtime = "nodejs";

/**
 * P27 — `/llms-full.txt`, the whole corpus in one response.
 *
 * **Six hours, not one.** `buildCorpus()` is the most expensive read on the
 * site — it walks projects, posts, skills, services, experience, achievements
 * and certifications and chunks all of it. That cost is fine once every six
 * hours behind the CDN and is not fine per request, which is what an
 * unrevalidated dynamic route would make it.
 *
 * Falls back to an empty corpus rather than a 500: a machine reader that gets
 * a short document still has `/llms.txt` and the sitemap, and a 500 here would
 * be the site reporting itself broken to exactly the audience this route
 * exists to serve.
 */
export const revalidate = 21600;

export const GET = withRed("/llms-full.txt", handleGET);

async function handleGET() {
  const chunks = await readOrFallback("llms-full/corpus", () => buildCorpus(), []);

  return new Response(buildLlmsFullTxt(chunks), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    },
  });
}
