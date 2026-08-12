import type { NextConfig } from "next";

/**
 * P12 — the delivery layer.
 *
 * Two things in here that are easy to get backwards, so they are stated once:
 *
 * **Compression is the CDN's job, not the app's.** Vercel negotiates Brotli at
 * the edge for every text response, and Next's own `compress` option only does
 * gzip — enabling it in front of an edge that already compresses means the
 * origin spends CPU producing gzip that gets thrown away and replaced. It is
 * left off deliberately. The one place it would be needed is a self-hosted
 * container (see the Dockerfile), where whatever sits in front of the Node
 * server owns it instead.
 *
 * **`output: "standalone"` is opt-in via an env var.** Vercel builds this
 * project with its own output tracing, and pinning standalone unconditionally
 * would change how the platform deploys it to solve a problem it does not have.
 * The Dockerfile sets DOCKER_BUILD=1, so the container gets a self-contained
 * server and the production deploy is untouched.
 */

const nextConfig: NextConfig = {
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
    // AVIF first, WebP as the fallback. The header wordmark is a photograph
    // (public/logo.jpeg), which is exactly the content AVIF wins on — Next
    // ships WebP only by default, so this is not a setting anyone gets for
    // free. A browser that supports neither still gets the original.
    formats: ["image/avif", "image/webp"],
    // A year, because every URL Next generates already carries the content
    // hash, the width and the quality in its query string.
    minimumCacheTTL: 31_536_000,
  },

  experimental: {
    // Rewrites `import { motion } from "motion/react"` into deep imports of the
    // exact modules used, so a barrel file cannot drag its whole package into
    // the client graph. `motion` is the biggest dependency in this project.
    optimizePackageImports: ["motion", "sonner"],
  },

  async headers() {
    return [
      {
        // Everything under /_next/static is content-hashed, so the only correct
        // answer is "never revalidate". Next sets this itself for its own
        // assets; stating it here means it survives a self-hosted deploy where
        // nothing else would.
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // The résumé is the single most-downloaded file on the site and it
        // changes a few times a year. A day at the edge with a week of
        // stale-while-revalidate means a new version is live within a day
        // without anyone waiting on a cold origin in the meantime.
        source: "/Shivam-Patil-SDE-II-Resume.pdf",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/logo.jpeg",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, immutable" },
        ],
      },
      {
        // The service worker is the one file that must never be cached hard.
        // A stale worker is a stale worker forever: it is the thing that would
        // have fetched its own replacement.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
