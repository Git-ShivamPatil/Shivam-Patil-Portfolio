import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

/**
 * Expects a real photo at `public/profile.jpg`, and renders the wordmark
 * treatment when it is absent.
 *
 * **The existence check happens here, on the server, and that is the point.**
 * This was previously a client component that always rendered the `<Image>` and
 * swapped to the fallback from `onError`. The visible result was correct — no
 * broken-image icon — but every visitor still paid for a request to
 * `/_next/image?url=%2Fprofile.jpg`, which **400s** while the file does not
 * exist. A fallback that runs after the failed request hides the symptom from
 * the page and from nobody else: it is in the network panel, in the server log,
 * and it fails Lighthouse's `errors-in-console` audit, which is what took
 * best-practices to 0.96 on every page of the site.
 *
 * `/about` is a static route, so this resolves once at build time and costs
 * nothing per request. Dropping the client component also takes a small amount
 * of JavaScript off the page.
 *
 * Adding `public/profile.jpg` is all that is needed to switch the photo on —
 * there is nothing else to change here.
 */
export function AboutPhoto() {
  const hasPhoto = existsSync(join(process.cwd(), "public", "profile.jpg"));

  return (
    <div className="about-photo-frame">
      {hasPhoto ? (
        <Image
          src="/profile.jpg"
          alt="Shivam Patil"
          fill
          priority
          sizes="(max-width: 900px) 100vw, 40vw"
          className="about-photo-img"
        />
      ) : (
        <div className="about-photo-fallback" aria-hidden="true">
          SP
        </div>
      )}
    </div>
  );
}
