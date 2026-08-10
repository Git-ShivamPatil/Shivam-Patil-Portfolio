# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption — where something is
inferred rather than observed, it says so.

**Last verified:** 10 Aug 2026, against commit `4a13ac1`.

---

## 0. Canonical working copy — read this first

**The project lives at `C:\Users\Administrator\Desktop\Portfolio Website`.**

There is a **second, stale clone** of the same GitHub repo at
`C:\Users\Administrator\Documents\GitHub\Shivam-Patil-Portfolio` (GitHub
Desktop's default location). It is **29 commits behind**, stuck at `c56c577`
from 1 Aug, and predates the entire site rewrite — no `prisma/`, no `lib/`, no
`tests/`, no `auth.ts`, no `.github/`, no `vercel.json`, and a 4-dependency
`package.json`.

**The trap:** its `origin/main` ref still points at `c56c577` because it has not
fetched since 7 Aug, so `git status` there reports _"up to date with
'origin/main'"_ — which is false. That is exactly the symptom that reads as
"my changes aren't landing."

Decisions taken (9 Aug):

- The stale folder is **left in place, untouched**. Do not work in it, do not
  push from it.
- **GitHub Desktop is not used to push this project.**
- Its two untracked files — `whatisinthiswebsite.md` (the original build spec)
  and `logo.jpeg` — are backed up, hash-verified, at
  `C:\Users\Administrator\Desktop\portfolio-old-clone-backup\`. They exist
  nowhere else; they are not in the live repo or on GitHub.

Audit of that clone, for the record: one branch (`main` @ `c56c577`) fully
contained in `origin/main`, no stashes, no unpushed commits, no `.env*` files.
Nothing there is unrecoverable.

---

## 1. Where things stand

**Live at https://www.shivamsfolio.com, commit `4a13ac1`.** Local `HEAD`,
`origin/main`, and the Vercel production deployment are all the same commit.

**Everything is green.** Verified 10 Aug, not assumed:

| Check                                 | Result                          |
| ------------------------------------- | ------------------------------- |
| GitHub Actions runs #16, #18–#21      | ✅ all success                  |
| Vercel production target              | ✅ `READY` on `4a13ac1`         |
| `pnpm lint`                           | exit 0                          |
| `pnpm typecheck`                      | exit 0                          |
| `pnpm test`                           | 185 passed / 185                |
| `pnpm build` (CI env, unreachable DB) | exit 0                          |
| Production route sweep                | 18/18 → HTTP 200                |
| `/api/push/subscribe`                 | `"enabled": true`               |
| `/api/cron/prune-analytics`           | 401 unauthenticated ✅          |
| Rendered-DOM contrast audit           | no text below AA (either theme) |

**Six merges landed on 10 Aug**, in this order — `ad26d20` (defer client
layer + prefetch discipline), `170801c` (self-host fonts), `12b8313` (hero
timeline + session refetch), `85bb7a0` (two-colour themes, light default),
`4a13ac1` (`/system-design` + dark `--ink` fix). Each is described in §2a–§2c.

There is no ongoing deployment failure; the last Vercel ERROR was `b30f3b8`
on 7 Aug, fixed by the commit after it.

The canonical host is **`www.shivamsfolio.com`** — `link[rel=canonical]`,
`og:url`, `sitemap.xml` and `robots.txt` all agree. Anything that needs the
origin (OAuth redirect URIs, webhooks) must use the `www` form.

`pnpm format:check` reports ~54 files. That is pre-existing CRLF-vs-LF noise
from the Windows checkout, not a code issue, and **CI does not run it** — the
workflow is lint → typecheck → test → build.

---

## 2. Why CI was red for two days — three separate causes, all fixed

Runs #1–#15 include 8 failures. They were **not one recurring problem**, which
is why they resisted a single fix. Do not re-diagnose these:

| Runs   | Failing step            | Root cause                                                                                                                                           | Fixed by  |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| #2–#4  | `Build`                 | `prisma generate` ran only in `postinstall`, so `next build` had no client                                                                           | `5975bdc` |
| #5–#12 | `actions/setup-node@v5` | Corepack's pnpm shim stopped landing on PATH on GitHub's runner image — died 9s in, before any check ran. The runner image changed, not the project. | `232c516` |
| #14    | `Test`                  | Booking-reference birthday collision — see below                                                                                                     | `f0baff1` |

The same `prisma generate` bug caused the last Vercel error (`b30f3b8`).

**#14 was a real defect, not a flaky test.** `generateReference()` used a
`randomBytes(3)` suffix — 24 bits — against a `@unique` `Booking.reference`, so
by the birthday bound 2,000 references carried an **~11% chance** of collision:
it failed roughly one run in nine. `app/api/bookings/route.ts` passes the value
straight into `booking.create()` **with no retry**, so a collision surfaced as a
500 for a customer at the moment they were trying to pay.

Widened to `randomBytes(5)` (40 bits) — the same burst now collides at ~1 in
550,000. References are `BK-2608-4F2A9C1B2D`, 18 chars, still inside Razorpay's
40-char receipt limit. Existing references unaffected; nothing parses them by
length.

**Still open:** a retry on unique-constraint violation in
`app/api/bookings/route.ts`. 40 bits makes a collision rare, not impossible, and
when it happens it is still a 500 mid-payment.

**CI-workflow notes worth keeping:** `pnpm/action-setup@v4` deliberately pins no
`version:` — it reads `packageManager` from `package.json`, so there is one
source of truth. It must run **before** `actions/setup-node`, because
`cache: pnpm` shells out to `pnpm store path`.

---

## 3. Vercel environment variables — exact live inventory

**14 of 32 are set.** Verified against the Vercel API on 10 Aug. Nothing missing
here breaks the build — every integration degrades by design — but each absence
silently disables a feature that is already fully built.

**Set** (all Production + Preview): `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
`AUTH_URL`, `AUTH_TRUST_HOST`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM`,
`RESEND_API_KEY`, `GITHUB_USERNAME`, `LEETCODE_USERNAME`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.

`RESEND_API_KEY` and `VAPID_PRIVATE_KEY` were added on 10 Aug. **Web push went
from dead to working** — `/api/push/subscribe` flipped from `"enabled": false`
to `true`, and because the deployed public key was byte-identical to the local
one, existing subscriptions stayed valid. Email now genuinely sends; see the
delivery caveat below.

**Missing, ordered by impact:**

| Variable(s)                                                | Consequence while absent                               | Notes                                       |
| ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `AUTH_GOOGLE_ID` / `_SECRET`, `AUTH_GITHUB_ID` / `_SECRET` | Google + GitHub sign-in buttons cannot complete a flow | Email/password login is unaffected — see §4 |
| `RAZORPAY_*` / `STRIPE_*`                                  | `/services` booking API returns 503                    | See §6 for the deliberate ordering          |
| `S3_*`                                                     | Admin media library read-only; uploads disabled        | Cloudflare R2, SETUP.md §6                  |
| `GITHUB_TOKEN`                                             | `/stats` limited to 60 req/hr instead of 5,000         | Optional                                    |
| `CAL_USERNAME`, `CAL_EVENT_SLUG`                           | Intro-call section not rendered at all                 | Optional                                    |

### The two secrets that already exist locally

Both were validated on 9 Aug — they need copying to Vercel, not regenerating:

- **VAPID pair: VALID.** The `VAPID_PRIVATE_KEY` in `.env.local` cryptographically
  pairs with the `VAPID_PUBLIC_KEY` already deployed (P-256 sign/verify
  round-trip; 65-byte uncompressed point, leading `0x04`). The local and
  deployed public keys are byte-identical, so **existing push subscriptions stay
  valid** — no re-subscription needed.
- **`RESEND_API_KEY`: authentic, send-only.** `GET /domains` returns
  `401 restricted_api_key` — _"This API key is restricted to only send emails."_
  That is the correct least-privilege scope, **not a broken key**: `lib/mail.ts`
  only ever calls `resend.emails.send()`. Do not "fix" this by minting a
  full-access key.

### Email: sends, but lands in spam — and the fix is blocked

Corrected 10 Aug after testing it end to end. Mail **is** being delivered: the
Resend dashboard shows production sends with status **Opened**, and the account
owner address is `shivampatilinfo@gmail.com`, which is the one address the
shared test sender is permitted to reach. So the earlier note that visitor mail
was "rejected by Resend" was wrong — nothing is rejected.

**The real problem is placement: it arrives in spam.** `EMAIL_FROM` is
`Shivam Patil <onboarding@resend.dev>`, Resend's shared test sender, and
`shivamsfolio.com` has **no SPF, no DKIM and no DMARC** (confirmed by direct DNS
lookup). Mail from a shared third-party domain with no alignment to the site it
claims to come from is exactly what a spam filter is built to catch.

**There is no partial fix.** SPF/DKIM on `shivamsfolio.com` cannot help mail
sent from `resend.dev`, because authentication follows the _sending_ domain.
It is fix the domain or stay in spam.

**And the domain fix is blocked.** Resend's own dashboard says so:

> "Wix doesn't support subdomains for MX records. This means you can't verify
> your domain for Resend if your DNS is managed by Wix."

`shivamsfolio.com` uses `ns0.wixdns.net` / `ns1.wixdns.net`. Resend requires an
**MX record on the `send` subdomain**, which Wix cannot create. The TXT records
(DKIM on `resend._domainkey`, SPF on `send`, DMARC on `_dmarc`) would all be
fine; the MX is the blocker. Domain status in Resend is **"Not Started"**,
region Tokyo (`ap-northeast-1`).

**Decision taken 10 Aug: stay on Wix for now** and accept spam placement. When
this is revisited, the move is low-risk — the whole zone is two records
(`A` on the apex and a `CNAME` on `www`, both to Vercel), **no MX at all**, and
**no TXT at all**, so nothing is disturbed by changing nameservers to Vercel or
Cloudflare. The chosen sender for that day is **`shivam@shivamsfolio.com`**.

### OAuth redirect URIs

Register exactly these — the `www` matters, and production already advertises
them via `/api/auth/providers`:

```
https://www.shivamsfolio.com/api/auth/callback/google
https://www.shivamsfolio.com/api/auth/callback/github
```

Add the localhost equivalents for development:

```
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/callback/github
```

---

## 2z. The bug that mattered most (10 Aug) — client-side navigation rendered blank

**Every internal link on the site led to a blank page.** Content was in the DOM
and correct; it was simply invisible. Only a hard refresh recovered it. This was
**pre-existing**, not introduced by the performance or theme work — reproduced
identically on `/about` and `/contact`, whose `prefetch` was never touched.

Root cause is an ordering trap between two components that are individually
correct:

- `PageTransition` wraps the route in `<AnimatePresence mode="wait">`. "wait"
  means the **outgoing** page stays mounted until its exit animation finishes —
  the incoming page is not in the DOM yet.
- `ScrollReveal` ran `useEffect(..., [pathname])`, and `pathname` updates the
  moment navigation commits.

So the effect fired, queried `[data-reveal]`, found only the outgoing page's
elements, and cleaned up. When the new subtree mounted ~200ms later nothing was
watching it, so its sections kept the `opacity: 0` start state forever.
Measured on production: six targets, six at `opacity: 0`, including a
`.page-hero` at `top: 101` — above the fold and invisible.

**Fixed with a `MutationObserver`** in both `ScrollReveal` and `SplitText`,
watching `document.body` for added nodes and arming whatever appears whenever it
appears. Deliberately not a `setTimeout` (a race) and deliberately not dropping
`mode="wait"` (changes how the site feels). The observer also covers any future
content that mounts late for an unrelated reason.

`SplitText` had the identical flaw. Its failure was cosmetic — an unsplit
heading is plain visible text — but it meant the signature character reveal
**only ever played on a full page load**, never on a navigation.

**A second-order bug the first fix exposed.** With the observer in place, six of
seven routes were correct but `/reach-out` still left one element unrevealed:
`.channel-list` settles at `top: 485` against a `492` immediate-reveal
threshold, so it should have armed. It did not, because the observer measures
**before layout settles** — fonts have not applied and images have not taken
their space — so the element reported a lower position, missed the threshold,
and fell through to the IntersectionObserver, whose `0.12` requirement an
element straddling the fold cannot meet until the visitor scrolls.

Fixed with a `requestAnimationFrame` re-scan after each mutation batch, so
everything is re-evaluated against settled layout. `arm()` is idempotent, so the
second pass costs one `querySelectorAll`. All nine routes verified clean after.

This one was easy to dismiss: "on screen but not revealed" reads like the design
working. It is not — it is an element whose space the visitor can see but whose
content they cannot.

**Two lessons worth carrying:**

1. **`fetch()` sweeps cannot catch this.** Every route audit in this file up to
   now used `fetch()`, which tests server responses. The pages returned 200 and
   full HTML the entire time they were rendering blank to a human. Click
   through the nav after any change to routing, transitions, or reveal.
2. **`getComputedStyle` lies in a non-fronted browser pane.** A pane that is not
   displayed produces no frames, so CSS transitions never advance and opacity
   reads as its pre-transition value. After the fix, `opacity: 0` readings
   persisted while screenshots showed the page fully rendered. The reliable
   signal is the **`data-revealed` attribute**, not computed opacity: `null`
   means the driver never ran (a real bug), `"true"` means it did.

---

## 2a. Performance work (10 Aug) — what was real and what was not

**The headline fix was the fonts, and it was not what anyone suspected first.**
`globals.css` opened with `@import url(fonts.googleapis.com/...)`. An `@import`
is invisible to the preload scanner, so the browser only found it _after_
parsing globals.css and then made two more **serial** cross-origin round trips
(googleapis for the `@font-face` CSS, gstatic for the files), each with its own
DNS + TLS handshake. Production measured FCP 396ms but **LCP ~830ms**: the hero
paragraph painted in the fallback face, then _repainted_ when Manrope swapped
in, and repainting the largest element re-registers LCP at the swap.

Moved to `next/font/google`. Verified on the built output: **zero external
origins**, five same-origin `rel="preload"` links in `<head>`, and
`document.fonts` reporting 53 faces where it previously reported 0 (they were
invisible to our own instrumentation because they lived in a cross-origin
sheet). `adjustFontFallback` generates a metric-matched fallback, which is what
protects the existing CLS of 0.

Two dead ends worth recording so nobody re-walks them:

- The **scroll-reveal system is not broken.** All seven `[data-reveal]`
  sections reveal correctly on scroll; below-fold sections sitting at
  `opacity: 0` before you scroll to them is the design working.
- **`PageTransition` is not hiding content.** `AnimatePresence initial={false}`
  means the SSR'd HTML ships `style="opacity:1"`. Confirmed in the raw response.

Also landed:

- **Prefetch discipline.** There was not one `prefetch` prop in the codebase, so
  ~17 prefetches fired per page load from the header and footer alone — and
  `/services`, `/stats`, `/search` are `ƒ` dynamic routes, meaning each was a
  server render plus Neon queries for a page nobody asked for (538ms, 568ms,
  384ms measured). `prefetch={false}` on exactly those three. It stays ON for
  `/blog` (ISR-static) and the SSG project pages, which are free CDN hits.
  Requests per page load: **20 → 15**.
- **`components/providers/deferred-layer.tsx`** — cursor follower, tilt layer,
  scroll progress, back-to-top, chat launcher and toaster now mount behind a
  `requestIdleCallback` gate, code-split via `next/dynamic`. ~330KB moved off
  the critical path. Read that file before moving anything else into it: four
  providers are deliberately left immediate, and each for a concrete reason.
- **Hero timeline.** `.reveal`'s opacity ramp now completes at 28% of the
  timeline (~150ms) while the translate runs the full 550ms, and SplitText's
  stagger halved (26ms/900ms → 12ms/380ms). The headline goes from ~1.5s to
  ~0.84s to fully readable. The important part is decoupling opacity from
  motion: LCP is recorded when the element renders its text, so a slow fade on
  the hero reports the headline as painted a third of a second late.

**Honest caveat: the LCP improvement was never independently confirmed.** The
structural facts are certain (zero external origins is not a matter of
measurement), but PageSpeed Insights rate-limited every attempt from this
network and the browser pane would not composite frames, so no trustworthy
before/after number exists. Run https://pagespeed.web.dev against the site to
close that out.

---

## 2b. The two-colour themes (10 Aug)

Light is **pink + cream white**. Dark is **neon green + black**. Nothing else in
either. Light is now the default (`defaultTheme="light"`, `enableSystem={false}`).

Values were chosen against a contrast calculator and then **verified by hue**:
light text tokens all sit at 337–341°, light surfaces ramp cream (22°) → pink
(347°), dark sits at 120–130° throughout. Anything outside those bands is a
stray colour. Contrast floor is **AAA (7:1) for every text token against every
surface it can land on** — not merely against the page background. Weakest
pairing: 7.63:1 light, 9.93:1 dark.

**The failure pattern this codebase keeps hitting — read this before touching
colour.** Seven defects were found, and _every one_ passed the build, the tests
and the palette maths. All seven were caught by taking a screenshot:

1. The page rendered **mint, not pink** — three 46vw blurred ambient washes were
   hardcoded lime/cyan/violet. They tint more of the viewport than any accent
   element, so they, not the tokens, decide a theme's cast.
2. Hero italics were **pale peach on cream, unreadable** — `--grad-accent` is
   clipped to TEXT on headings and used as a FILL elsewhere; those jobs want
   opposite things. Split out `--grad-heading`.
3. Live dot and chat pip were a hardcoded olive green.
4. **`--ink` regression (twice).** See §9 — it now has its own entry.
5. The `"Plan"/"Find"/"Act"` chips measured **~1.1:1, invisible**. This one
   **predated the theme work**: the old dark theme put `#ede9dd` on the same
   `#f0ecff` fill for **~1.03:1**. It shipped broken and pastel cards hid it —
   exactly as the 1.05:1 card-title bug did.
6. The whole family of card illustrations had that same shape: pale hardcoded
   fills, `rgba(17,17,16,x)` strokes invisible on near-black, labels inheriting
   `--fg`.
7. `.project-number` / `.project-category` at 3.25:1 — see §9.

**The pattern is "hardcoded pale fill + inherited `--fg`".** It has now produced
invisible dark-theme text three separate times in this file. When adding any
element with a light background, set its `color` explicitly.

A rendered-DOM audit — compositing translucent backgrounds over their parents
rather than comparing raw rgba — now reports **no visible text below AA in
either theme** (208 nodes dark, 236 light). Sub-AA readings on `.split-char`
spans are false positives: their computed colour is `transparent` because they
are painted by a clipped background gradient.

---

## 2c. `/system-design` (10 Aug)

A new static page documenting the real architecture: request path, data model,
the ten phases, decisions worth defending, and a "spec versus reality" table.

Two hand-written inline SVG diagrams in a **server component** — same call P8
and P10 made for the admin charts. The route builds as `○` static and nothing on
it hydrates; draw-in is CSS `stroke-dashoffset`, gated on reduced-motion.

**It deliberately does not reproduce `BUILD-SPEC.md`'s mermaid diagrams.** That
file specifies Redis, WebSockets, pgvector and Docker, none of which exist, so
drawing it literally would be a polished picture of a system that is not real —
on a page whose value is that a technical reader can check it against the
source. The spec's ambitions live in the divergence table instead.

Styles are in `app/features.css` under a `SYSTEM DESIGN PAGE` banner. Every
stroke and fill reads a theme token; there is no colour literal on that page,
and there should not be.

Linked from the **header nav** (between Blog and About) as well as the footer —
it was footer-only at first and effectively undiscoverable.

### The header wordmark

The circular "SP" lettermark is now `public/logo.jpeg`, rendered through
`next/image` at 62px for a 31px slot so it stays sharp on 2x displays, with
`priority` because it sits in the header of every page. Its `alt` is empty on
purpose: the parent link already carries `aria-label="Shivam Patil home"`, so
describing the image would make a screen reader announce the same thing twice.

---

## 4. Stack facts that constrain every decision

- Next.js 16 App Router, TS, Prisma 7 (client generated to
  `lib/generated/prisma`, Neon driver adapter in `lib/prisma.ts`), NextAuth v5,
  Tailwind v4. Node 24 on both CI and Vercel.
- **Vercel serverless.** Module-scope memory is NOT shared across requests. This
  is why chat is SSE + DB-poll rather than WebSocket, and why typing indicators
  are stored as deadline columns in Postgres, not in memory.
- **Free tier only** — user directive. Mapbox was removed for being metered; the
  map is OpenStreetMap. P9 uses Cloudflare R2 for the same reason: 10GB free
  and, critically, **zero egress fees**.
- **Auth providers:** `auth.config.ts` registers Google + GitHub. `auth.ts`
  layers **Credentials** on top. So email/password login works with no OAuth
  keys configured — only the two social buttons are inert.
- **`auth.config.ts` is deliberately dependency-light** — no Prisma adapter, no
  bcrypt — because `proxy.ts` imports it on every matched request just to decide
  whether a route is allowed.
- **Stripe is dropped** from the plan (user decision). The adapter still exists
  and is inert without keys; Razorpay is the only intended provider.
- Every integration must **degrade, not throw**, when its env keys are absent.
- `/projects` has **no index page by design** — only `app/projects/[slug]/`.
  A bare `/projects` returning 404 is correct, not a regression; the homepage is
  the project listing.

---

## 5. Implemented phases — the reasoning worth keeping

Phases 1–10 are implemented. What follows is the rationale that is expensive to
rediscover, not a changelog.

### P1–P7 — the admin lockout, and other fixes

**`auth.config.ts` — the admin area was inaccessible to everyone, admins
included.** `authorized()` gates `/admin` on `auth.user.role`, but `proxy.ts`
builds a _second_, adapter-less NextAuth instance from `authConfig` alone, and
Auth.js's default session callback rebuilds `session.user` from a fixed
whitelist — name, email, image — dropping every other claim. So `role` was
`undefined` and the gate denied every request.

Fixed by moving the `session` callback into `auth.config.ts` so both instances
share it. **Verified end to end**, not just reasoned about: with a minted ADMIN
session cookie, `/admin/links` returns 200; removing the callback again
reproduces the 307 to `/login`; a USER cookie is correctly denied at `/admin`
and admitted at `/account`. Pinned by `tests/p2-auth-gate.test.ts` (9 tests).

Also fixed:

- `auth.ts` — role re-read from the DB on session update, so demoting an admin
  no longer takes up to 30 days to take effect.
- `app/search/page.tsx` — wrapped in `readOrFallback`; was the only public read
  path that 500'd on a DB blip.
- `app/projects.ts` — `toProject` coerces its JSON columns to arrays, so one
  malformed row degrades a section instead of 500ing the page.
- `app/api/forgot-password/route.ts` — per-email and per-IP rate limits;
  outstanding reset tokens are burned when a new one is issued.
- `app/api/register/route.ts` — rate-limited. The 409 still distinguishes an
  OAuth-only account on purpose (otherwise a Google signup gets "registration
  failed" forever with no way to understand why); the limit is what makes bulk
  enumeration impractical.
- `lib/integrations/cache.ts` — negative caching via a tombstone row, and
  `fetchWithTimeout` buffers the body _inside_ the timeout window (it previously
  cleared the timer before the body was read, so body reads were untimed).
- Admin `[id]` routes — Prisma `P2025` returns 404 instead of 500.
- `app/admin/inbox/page.tsx` — bounded `take`, counts from aggregates.
- `components/image-gallery.tsx` — real focus trap, so `aria-modal="true"` is
  now true rather than merely claimed.
- `app/globals.css` — the reduced-motion block blanket-cancels animations
  instead of naming three classes. **Checked that nothing is stranded
  invisible**: every `opacity:0` base in the codebase is transition-driven, not
  animation-driven.
- `app/globals.css` — **project card titles were invisible in dark theme.** The
  accent backgrounds (`.project-cyan` and friends) are pastel literals that
  deliberately never change with the theme, but the text inherited `--fg`, which
  flips to cream. Measured contrast was **1.05:1**. Fixed with
  `color: var(--ink)` on `.project-card`; now 16.28:1.
- `tests/p2-password.test.ts` — explicit 30s timeout. `bcryptjs` is pure JS, so
  cost-12 hashing is ~900ms of single-threaded CPU each, and as the suite grew
  to 11 concurrent files these blew the 5s default.

**`.project-number` / `.project-category` — decided 10 Aug.** These sat at
3.25:1 and 4.11:1, the only text on the site below WCAG AA, and were previously
recorded here as a deliberate choice "left for you to decide". The light
theme's brief is that it stays readable for an eighty-year-old, and 3.25:1 is
not that, so they now use `--prose-soft` (≥7.5:1). The hierarchy is carried by
size, letter-spacing and the uppercase treatment — all unchanged — rather than
by being too faint to read. Revert to a literal if the fainter look is wanted
back, but do not go below 7:1 without revisiting the brief.

### P8 — Growth

- `ReferralLink` + `ReferralClick` models.
- `/r/<code>` redirect: 302 (not 301 — a permanent redirect gets cached and the
  click stops reaching us), click recorded in `after()` so analytics never sits
  between the tap and the page.
- **The integration that makes this worth building:** the redirect appends
  `?ref=<code>`, which the existing referral cookie already funnels into
  `ContactMessage`, `Booking` and `NewsletterSubscriber` as `referralRef`. So
  every existing conversion path became attributed without being touched.
- Privacy: no raw IP stored. `visitorHash` is a daily-rotating salted SHA-256,
  so it counts uniques without being joinable across days.
- Dynamic QR at `/api/qr`, styled SVG. Encoding is `qrcode-generator`; the
  rendering is ours.
- `/admin/links` — CRUD, live QR preview, and a dashboard drawn as hand-written
  SVG in a **server** component, so no charting library ships.

### P9 — Storage

- `MediaAsset` content-addressed by SHA-256, so re-uploading identical bytes
  returns the existing row rather than paying to store a second copy.
- `lib/storage/s3.ts` — hand-rolled SigV4 query presigner. No AWS SDK: ~15MB of
  bundle for one operation. Browser uploads go straight to R2, so bytes never
  cross a Vercel function.
- `lib/storage/validate.ts` — type decided by **magic bytes**, never by the
  browser's `type` or the extension. **SVG is deliberately excluded**: it is an
  XML document that can carry `<script>`, and served from our own origin that is
  stored XSS. `avis` is rejected while `avif` is accepted.
- `lib/storage/compress.ts` — AVIF/WebP conversion + resize in the browser, so
  no `sharp` cold-start on serverless. Falls back AVIF → WebP → original, and
  keeps the original when re-encoding would be larger.

### P10 — Analytics

First-party, cookieless, and **additive to `@vercel/analytics`, not a
replacement**. Vercel Analytics answers "how many views"; it structurally cannot
see where on the page people click, how far they read, or whether they took the
résumé.

Four tables: `PageView`, `AnalyticsEvent` (ledgers), `AnalyticsCounter`,
`HeatmapCell` (aggregates) — the same ledger-plus-denormalised-counter split P8
uses.

- **`lib/analytics/normalize.ts` is the whole safety story.** It runs in the
  browser for correctness (so `/services` and `/services/?utm=x` are one page)
  and again on the server because `/api/analytics/collect` is anonymous, so
  every field arriving from it is attacker-controlled.
- **Heatmaps are a sparse aggregate, never raw points.** An exact
  (x, y, timestamp) trail is a behavioural fingerprint. `HeatmapCell` holds a
  counter per grid cell, created lazily, so table size tracks _where people
  click_ rather than how much traffic there is.
- **x is normalised against the centred content column, not the viewport.**
  `.shell` is `min(1180px, 100% - 64px)`, so normalising by viewport width would
  smear one element across several columns. A test pins exactly this. y is
  normalised against document height or every click piles into the top band.
- **Downloads are counted server-side at `/d/<slug>`**, shaped like `/r/<code>`.
  Client-JS-only counting is invisible to blockers, `Save link as…`, and
  scripting being off. The slug is a **closed allowlist**
  (`lib/analytics/downloads.ts`) — a slug naming its own destination would be an
  open redirect on the production domain.
- **`PageView.viewId` is the idempotency key.** The tracker flushes on
  `pagehide` _and_ `visibilitychange` because iOS fires only one of the two
  depending on how the tab goes away. Engagement columns are monotonic via a
  guarded `updateMany` (`where: { durationMs: { lt: n } }`), so an out-of-order
  beacon is a no-op rather than rewriting a two-minute read as a bounce.
- **`PageView.day` is deliberately redundant** against `createdAt`. Prisma's
  `groupBy` has no date truncation, so a daily chart otherwise means pulling
  every row into the app or raw SQL. 10 bytes a row makes the read proportional
  to the number of _days_, not to traffic.
- **Privacy is enforced, not claimed.** No IP, no cookie. `DNT: 1` and
  `Sec-GPC: 1` are honoured _before_ the rate limiter and the parser. Outbound
  clicks record hostname only, never the path.
- **Retention is enforced.** `RETENTION_DAYS = 180`, pruned daily by
  `/api/cron/prune-analytics` in bounded batches — one unbounded `deleteMany`
  over months of rows is a statement timeout, and a timed-out delete rolls back
  entirely, so the job would make no progress while appearing to run. Guarded by
  `CRON_SECRET` (constant-time compare) or an admin session. **Verified live:
  the endpoint returns 401 unauthenticated**, which is correct.

**Known dev-only artefact:** React StrictMode runs effects twice, so local
development records two `PageView` rows per navigation. Production is
unaffected.

### Graphics

`app/graphics.css` is **purely additive** — every rule targets a class that
already exists and only adds decoration. Deleting the file leaves the site
correct, just plainer. Blur-heavy layers are dropped under 720px.

---

## 6. Credentials — actual status

| Service               | State                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Neon Postgres         | ✅ working, schema pushed including P8/P9/P10 tables                                                    |
| Vercel                | ⚠️ **14 of 32 env vars set** — see §3                                                                   |
| Resend (key)          | ✅ send-only key, **live on Vercel since 10 Aug**. Production sends confirmed "Opened" in the dashboard |
| Resend (domain)       | ⛔ **BLOCKED, not merely undone** — Wix DNS cannot create the required MX on a subdomain. See §3        |
| Web push (VAPID)      | ✅ **working in production** — `/api/push/subscribe` returns `"enabled": true`                          |
| GitHub / LeetCode     | ✅ working unauthenticated. LeetCode handle is `shivam2op`                                              |
| Google / GitHub OAuth | ❌ no client credentials created                                                                        |
| Razorpay              | ❌ no key generated — see the blocker below                                                             |
| Cal.com               | ❌ not set up (section hidden without `CAL_USERNAME`)                                                   |
| Cloudflare R2         | ❌ not set up — media library read-only (SETUP.md §6)                                                   |

### Razorpay blocker (deliberate, not an oversight)

The account is live and activated, and there is **no Test/Live toggle** — so
generating a key produces a **live** key. It was left ungenerated on purpose:
originally because nothing was deployed. **That precondition is now satisfied** —
`https://www.shivamsfolio.com/api/webhooks/razorpay` exists. Correct order:

1. Generate the key in the Razorpay dashboard
2. Register the webhook: `payment.captured`, `payment.failed`, `order.paid`,
   `refund.processed`
3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

Doing 3 before 2 means a customer can be **charged but never confirmed**.

---

## 7. Outstanding work

Ordered by impact. Items 1 and 2 of the previous list are **done** — the two
secrets are on Vercel and web push is live.

1. **Move DNS off Wix**, then verify the Resend domain and set `EMAIL_FROM` to
   `shivam@shivamsfolio.com`. This is the only thing standing between
   transactional mail and the inbox — see §3 for why there is no partial fix and
   why the move is low-risk (two records, no MX, no TXT). Deferred by decision
   on 10 Aug, not forgotten.
2. **Confirm the LCP number.** Run https://pagespeed.web.dev against the site.
   The font work is structurally verified but its effect on LCP was never
   independently measured — see §2a.
3. **Google + GitHub OAuth apps** → four env vars. Callback URIs in §3.
4. **Add a retry on unique-constraint violation** in
   `app/api/bookings/route.ts` (§2). Still the oldest open code defect.
5. **Razorpay** per §6, now unblocked.
6. **R2** (SETUP.md §6) if you want uploads. Don't forget the CORS rule — a
   presigned PUT without it is blocked by the browser, not by R2.
7. **The 121KB of render-blocking CSS.** Six files, `globals.css` alone ~59KB.
   Deliberately not touched during the theme rewrite because that work rewrote
   the same files; it is now the largest untouched performance item.
8. **No E2E layer.** `BUILD-SPEC.md` specified Playwright, Lighthouse CI and
   axe-core; none exist. 185 Vitest unit tests is the whole safety net, and the
   seven colour defects in §2b are precisely the class of bug it cannot catch.
9. Optional: Cal.com, GitHub PAT.

**Doc debt:** `SETUP.md` skips from §2 to §4 — there is no §3, and §8's list
predates the current Vercel state. Reconcile it against §3 of this file.

---

## 8. Never independently audited

P6 comms and P7 payments still have not had a full adversarial sweep — the
agents doing it died on a usage limit in an earlier session. What has since been
checked by hand: `app/api/chat/stream/route.ts` does **not** have the suspected
IDOR. `resolveIdentity()` derives the role from a server-side `auth()` call, and
only an OWNER may pass `conversationId`; a visitor always resolves to their own
thread via their cookie.

---

## 9. Things already decided — do not re-litigate

- **The themes are two-colour systems.** Light is pink + cream white; dark is
  neon green + black. Not "mostly" — a third hue anywhere is a defect. Verify by
  hue (337–341° light text, 120–130° dark), not by eye.
- **`--ink` is not a text token.** It means "always dark regardless of theme"
  and is the `background` for the back-to-top button, chat launcher, solid
  buttons and filled graphic nodes. It has now been broken twice by treating it
  as a colour to restyle. Light `#1a0a10` (pink-tinted), dark `#101a10`
  (green-tinted); both near-black, both overridden in the
  `prefers-color-scheme` fallback too. `--fg` is the token that switches.
- **Any element with a pale background must set its `color` explicitly.**
  Inheriting `--fg` there has produced invisible dark-theme text three separate
  times in `globals.css`. See §2b.
- **Screenshot before believing a colour change.** Seven defects, zero caught by
  the build, the tests or the contrast maths.
- **`ScrollReveal` and `SplitText` need their `MutationObserver`.** It is not
  defensive padding — without it every client-side navigation renders a blank
  page, because `AnimatePresence mode="wait"` mounts the incoming route after
  `pathname` has already changed. See §2z before simplifying either file.
- **Verify navigation by clicking, not by `fetch()`.** A route can return 200
  with complete HTML and still render blank to a human. That is exactly how the
  blank-navigation bug survived several route audits.
- Light is the default theme, `enableSystem={false}` so the default is honoured
  rather than overridden by the OS.
- Fonts are self-hosted via `next/font`. Do **not** reintroduce a Google Fonts
  `@import` — see §2a for what it costs.
- `prefetch={false}` belongs only on the `ƒ` dynamic routes. Leaving it on for
  static/ISR routes is correct; those are free CDN hits.
- Chat is SSE + POST, not WebSocket (Vercel cannot host a socket server).
- CI intentionally has **no database**. The build surviving that is the feature,
  not a gap — do not "fix" CI by adding a Postgres service.
- CI runs lint → typecheck → test → build, and **not** `format:check`.
- `pnpm/action-setup` must stay **before** `actions/setup-node`, and must keep
  its `version:` unpinned so `packageManager` stays the single source of truth.
- Money is integer minor units end to end. Never floats.
- Bookings reach `CONFIRMED` only via a signature-verified webhook.
- `public/logo.jpeg` is a **photograph**, not a logo mark — hence the
  desaturated, masked watermark treatment on /about and /contact.
- Motion is driven by `data-*` attributes so server components stay server
  components, and everything is gated on `prefers-reduced-motion`.
- Image compression is client-side by design. Do not add `sharp`.
- QR module styling must never change which modules are set. There is a test
  (`tests/p8-growth.test.ts`) that reconstructs the matrix from the rendered SVG
  and compares it against the encoder's, module by module.
- P10 analytics is **first-party and stays that way**. No third-party script, no
  IP geolocation call (every provider is metered), no cookie, no cross-day
  identifier. Geo comes from edge headers the CDN already resolved, which is why
  it is empty in local development — that is correct, not a bug.
- The résumé preview on `/resume` points at the file directly and must keep
  doing so. Routing an `<object data>` through `/d/resume` would count a
  download for everyone who merely opened the page.
- The Resend key is **send-only on purpose**. A 401 from any non-send endpoint
  is expected.
