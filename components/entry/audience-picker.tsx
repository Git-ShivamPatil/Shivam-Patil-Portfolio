import Link from "next/link";
import { audiences } from "../../app/audiences";
import "./audience-picker.css";

/**
 * The four entry paths, offered inline on the homepage.
 *
 * ### What this replaced
 *
 * The same four choices used to be a `position: fixed` overlay covering the
 * entire viewport on **every load of every page**, asking "Who's reading?"
 * before a visitor had seen a single word of the site. It was a client
 * component, it locked body scroll, it moved focus into itself, and the choice
 * was deliberately not persisted — so a returning reader met it again on every
 * visit, and a reader navigating with a full page load met it on every page.
 *
 * The original argument for it was that it is "part of how the site introduces
 * itself rather than a settings prompt to get past". That is a real intent, and
 * the overlay was carefully built — the page underneath was rendered rather
 * than withheld, precisely so search and CLS were unharmed. What it could not
 * fix is the thing that actually matters: a modal is a toll gate. The visitor
 * has to read it, understand four options — one of which is the uninterpretable
 * proper noun "theelderbrother" — and act, before being allowed to see whether
 * the site was worth the interruption. On a portfolio, whose entire job is to
 * make a stranger's first ten seconds count, that is the most expensive
 * possible thing to spend them on.
 *
 * ### Why inline is strictly better here
 *
 * - **Nothing is lost.** All four `/for/*` routes still exist, still carry
 *   their own metadata, and are still in the sitemap. The only change is that
 *   choosing is now an option on the page rather than a condition of entry.
 * - **It is a server component.** The overlay shipped a `"use client"` bundle,
 *   `useSyncExternalStore`, two `useEffect` hooks, a scroll lock and a focus
 *   trap. This is four `<Link>`s and no JavaScript at all.
 * - **The links are real links.** The overlay's options were `<button>`s that
 *   called `router.push`, so they could not be opened in a new tab, could not
 *   be middle-clicked, showed no destination on hover, and were invisible to a
 *   crawler. These are anchors with hrefs, which also gives the four audience
 *   pages the inbound internal links they never had.
 * - **The scroll lock is gone.** With it goes the failure mode where a
 *   JavaScript error between mount and dismissal left the page unscrollable.
 */
export function AudiencePicker() {
  return (
    <section className="audience-picker shell" data-reveal aria-labelledby="audience-picker-title">
      <div className="section-heading">
        <p className="eyebrow">Shortcuts</p>
        <h2 id="audience-picker-title">
          Here for something <em>specific?</em>
        </h2>
        <p>
          Every one of these is a normal page you can also reach from the menu. This is just the
          fast way in.
        </p>
      </div>
      <div className="audience-picker-grid" data-stagger>
        {audiences.map((audience) => (
          <Link key={audience.id} href={audience.href} className="audience-picker-card">
            <span className="audience-picker-label">{audience.label}</span>
            <span className="audience-picker-blurb">{audience.blurb}</span>
            <span className="audience-picker-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
