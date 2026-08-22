import type { MetadataRoute } from "next";

/**
 * P23 — the web app manifest.
 *
 * **Its absence was the reason this site was not installable**, despite having
 * had a service worker since P6. The worker handled push notifications and
 * nothing else, and a worker without a manifest gives a browser no reason to
 * offer "Add to home screen".
 *
 * `display: "standalone"` rather than `"fullscreen"`: fullscreen takes the
 * status bar, which on a phone means hiding the clock and the battery to show
 * a portfolio. That is a trade a game can justify and a document cannot.
 *
 * No `theme_color` that contradicts the palette — the value here is the light
 * theme's paper, and the dark theme's is supplied at runtime by the theme
 * provider through a meta tag, because a manifest is static and this site's
 * theme is not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shivam Patil — Software Engineer",
    short_name: "Shivam Patil",
    description:
      "Portfolio, live coding stats, system-design write-ups, and a set of labs that run real workloads in the browser.",
    start_url: "/",
    // `?source=pwa` is deliberately NOT appended to start_url. It would make
    // every installed launch a distinct URL from the canonical one, splitting
    // the analytics and the ISR cache entry for the busiest page on the site.
    display: "standalone",
    orientation: "any",
    // --paper, the light theme's page ground. These paint the splash screen
    // and the Android status bar of an installed copy, so a value from the
    // retired palette would frame the app in a colour the app no longer has.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/logo.jpeg",
        sizes: "512x512",
        type: "image/jpeg",
        // "any maskable" is a lie unless the icon has the safe-zone padding a
        // maskable icon needs, and a lie here means Android crops the logo.
        // Declared as `any` only, so the platform pads it itself.
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Ask the site",
        short_name: "Ask",
        description: "Retrieval-backed answers about this work",
        url: "/ask",
      },
      {
        name: "Live stats",
        short_name: "Stats",
        description: "GitHub and LeetCode activity",
        url: "/stats",
      },
      { name: "Résumé", short_name: "Résumé", description: "The PDF", url: "/resume" },
    ],
  };
}
