import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

/**
 * The portrait on /about, resolved at build time against what is actually on
 * disk.
 *
 * **The existence check happens here, on the server, and that is the point.**
 * This was previously a client component that always rendered the `<Image>` and
 * swapped to a fallback from `onError`. The visible result was correct — no
 * broken-image icon — but every visitor still paid for a request to
 * `/_next/image?url=%2Fprofile.jpg`, which **400s** while the file does not
 * exist. A fallback that runs after the failed request hides the symptom from
 * the page and from nobody else: it is in the network panel, in the server log,
 * and it fails Lighthouse's `errors-in-console` audit, which is what took
 * best-practices to 0.96 on every page of the site.
 *
 * `/about` is a static route, so this resolves once at build time and costs
 * nothing per request.
 *
 * ### Why there are two candidates
 *
 * `profile.jpg` has never existed, so for the whole life of this page the frame
 * rendered a 64px "SP" on a near-black card — a placeholder that looked
 * deliberate enough that nobody read it as missing. Meanwhile `logo.jpeg` — the
 * same photograph the header already shows as a 28px avatar — was sitting in
 * `public/` the entire time at 720×1280, which is far more resolution than this
 * frame needs.
 *
 * So the list is ordered by intent rather than collapsed to one file:
 * `profile.jpg` first, because a portrait shot for a 4:5 frame will always beat
 * one cropped from a phone photo, and dropping that file in is still all it
 * takes to switch to it. `logo.jpeg` second, because it is a real photograph of
 * a real person and that is what this slot is for. The lettermark stays last,
 * for the case where someone removes both.
 */
const CANDIDATES = ["/profile.jpg", "/logo.jpeg"];

export function AboutPhoto() {
  const photo = CANDIDATES.find((src) =>
    existsSync(join(process.cwd(), "public", src.replace(/^\//, ""))),
  );

  return (
    <div className="about-photo-frame">
      {photo ? (
        <Image
          src={photo}
          alt="Shivam Patil"
          fill
          priority
          /* `fill` + object-fit: cover, so the 9:16 source is cropped to the
             frame's 4:5 rather than letterboxed. The crop takes it off the top
             and bottom, which is the right axis for a portrait. */
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
