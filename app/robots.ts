import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /d/ is the counted-download redirect (P10). It is disallowed not to
        // hide it — the PDF it points at stays crawlable at its real path —
        // but because a crawler following it would be counted as a person
        // taking the résumé. The UA check in recordDownload is the belt; this
        // is the braces, and it also saves the request.
        disallow: ["/api/", "/admin/", "/account/", "/d/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
