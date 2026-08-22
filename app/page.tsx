import { JsonLd } from "../components/seo/json-ld";
import { PaletteHint } from "../components/entry/palette-hint";
import { pageMetadata } from "../lib/seo/metadata";
import { personJsonLd, webSiteJsonLd } from "../lib/seo/structured-data";
import { person } from "../lib/seo/site";
import "./home.css";

export const metadata = pageMetadata({
  // **This title carries the name itself, and it has to.** `title.template` in
  // the root layout appends " — Shivam Patil" to child segments, but Next.js
  // does not apply a template to the segment that defines it — and app/page.tsx
  // is that segment. So the one page that most needs the name in its title is
  // the one page the template cannot give it to.
  title: "Shivam Patil — Software Engineer | C++, Rust, Go & AI",
  description:
    "Software engineer at Tata Consultancy Services, building high-throughput backend platforms and distributed systems in C++, Rust, Go and Python.",
  path: "/",
});

/**
 * The homepage, rebuilt to a single screen.
 *
 * ### What was here before, and why it went
 *
 * A hero with an orbital SVG, a proof strip of animated metrics, an
 * audience picker, a hub grid of twenty-eight route cards grouped into six
 * sections, and a contact banner. All of it worked. The brief that replaced it
 * was "only what is required, no bluff, no noise", and a twenty-eight-card
 * index is the definition of noise under that brief — it asks a visitor to
 * read a menu before they have been told who they are reading about.
 *
 * So navigation moved off the homepage entirely. It lives in two places now:
 * the header row, and the command palette. That is the whole point of the
 * "press ctrl K to start" line — it is not decoration, it is the primary
 * navigation affordance, which is why `PaletteHint` makes it clickable rather
 * than leaving it as text a phone cannot act on.
 *
 * ### What did NOT go, and deliberately
 *
 * **The JSON-LD.** It renders nothing and it is the reason this page is
 * findable at all. Person and WebSite anchor every other page's `@id`
 * references — dropping them to "simplify" would silently unpick the
 * structured data across the whole site.
 *
 * **Every route.** Nothing was deleted. All twenty-eight are still reachable,
 * still in the sitemap, still in `/llms.txt`, still in the footer directory
 * and the palette. §55a is the reason that matters: twenty of thirty-three
 * URLs had never been crawled, and the fix was giving them inbound links. A
 * homepage that links nowhere would undo that, which is why the footer keeps
 * its directory even though the reference design has no such thing.
 */
export default function HomePage() {
  return (
    <>
      <JsonLd data={[personJsonLd(), webSiteJsonLd()]} />

      <section className="home">
        <div className="home-inner">
          {/* No `data-split`. SplitText wraps every word in a nowrap
              inline-block, and §54 records what that did to a heading beside a
              sized element: one unbreakable 652px token stole 82px from the
              column next to it and moved every section below by 102px. This
              heading is two short words with nothing beside them, so the
              effect would buy nothing and the risk is not worth taking. */}
          <h1 className="home-name">{person.name}</h1>

          <p className="home-role">
            Software Engineer at{" "}
            <a href="https://www.tcs.com" target="_blank" rel="noopener noreferrer">
              Tata Consultancy Services
            </a>
          </p>

          <p className="home-tagline">Obsessed with user experience</p>

          <PaletteHint />
        </div>
      </section>
    </>
  );
}
