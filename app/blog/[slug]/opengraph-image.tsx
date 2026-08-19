import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "../../../lib/seo/og-image";
import { prisma } from "../../../lib/prisma";
import { readOrFallback } from "../../../lib/db-read";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Blog post";

/**
 * A card per post, for the same reason the case studies have one: a shared link
 * to a specific write-up should not look like a link to the site.
 *
 * Reads through `readOrFallback` so a database blip degrades to the generic
 * card rather than failing the image route — an unfurl is not worth a 500.
 */
export default async function BlogOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await readOrFallback(
    "og/blogPost",
    () =>
      prisma.blogPost.findFirst({
        where: { slug, published: true },
        select: { title: true, excerpt: true },
      }),
    null,
  );
  if (!post) {
    return renderOgImage({ eyebrow: "Blog", title: "Notes from the build" });
  }
  return renderOgImage({ eyebrow: "Blog", title: post.title, subtitle: post.excerpt });
}
