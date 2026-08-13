# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption — where something is
inferred rather than observed, it says so.

**Last verified:** 13 Aug 2026, against commit `1c42c3b` — **live in production**.

Phases 11–16 landed on 13 Aug. Sections 10–16 at the end of this file cover
them; everything before that is the 10 Aug state and is still accurate except
where a later section says otherwise.

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

---

# Phases 11–16 — 13 Aug 2026

Everything above this line is the 10 Aug state. It is still accurate except
where a section below supersedes it.

**Live at https://www.shivamsfolio.com on `1c42c3b`**, verified against
production rather than assumed: `/api/health` reports `version: 1c42c3b`,
`region: iad1`, database reachable in 19ms.

| Check                          | Result                                    |
| ------------------------------ | ----------------------------------------- |
| `pnpm lint` / `typecheck`      | exit 0                                    |
| `pnpm test`                    | **301 passed** (was 185)                  |
| `pnpm test:e2e`                | **41 passed**, Chromium                   |
| `pnpm build`, unreachable DB   | exit 0 — the CI resilience property holds |
| Production header + CSRF sweep | all pass, see §13                         |
| Production RAG queries         | correct sources, correct refusals         |

---

## 10. The three defects the new test layer found

Worth reading first, because all three are the same _kind_ of bug this file has
been recording since P1 — invisible to the build, the types and the unit tests.

**1. `.contact-quick .eyebrow` was `#5f6d21`.** An olive literal: 4.73:1 on the
light fill, under the 7:1 floor every text token here holds, and hue 71° in a
theme whose text must sit at 337–341°. The same stray olive that was removed
once already from the chat live pip.

**2. `.contact-quick h2` measured 1.23:1 in dark theme.** Present, and
unreadable. This is the **third** appearance of the pattern §2b names: a pale
fill that does not follow the theme, plus text that inherits `--fg` and does.
Fixed on the container with `color: var(--ink)`, exactly as `.project-card` was.

**3. The presence rate limit was sized like a signup form.** 12 burst at 0.2/s
throttles _legitimate_ visitors past about four tabs from one address — any
shared NAT, office or household. A limiter's size comes from what the endpoint
costs, not from copying another route's numbers.

Nos. 1 and 2 were found by axe running in **both themes**. A single-theme run
cannot see that class of bug at all, which is why the loop exists.

---

## 11. Realtime — presence, online status, live dashboard

**Presence is state, not memory.** Module scope is not shared between
serverless invocations, so the instance serving a heartbeat and the instance
rendering the dashboard cannot see each other. Postgres is the only store both
can read. `PresenceSession` is that store, and liveness is a **freshness window
on `lastSeenAt`**, not an online flag — same reasoning as the typing deadlines
in `ChatConversation`: a closed laptop never sends "I left", so a flag stays
true forever while a deadline lapses.

**The presence token lives in module scope and is never stored, and that is the
part to not undo.** A token in `sessionStorage` survives a reload, so the
outgoing page's "delete token T" races the incoming page's "I'm here, token T" —
and `sendBeacon` guarantees no ordering. When the beacon lands second it deletes
a row for a visitor who is demonstrably still on the site. Found exactly that
way: the heartbeat returned 200 and the table stayed empty. A per-document token
means the two requests name different rows.

- The `presence` variant has been in `ChatEvent` since P6 and nothing emitted
  it. The chat stream now does, on the visitor's side only.
- The widget used to say "connected", which describes the transport and says
  nothing about whether anyone is reading. It now says which it means.
- `/admin/live` polls rather than pretending to push: the writes arrive from
  `after()` callbacks in other invocations, so there is no change feed and
  anything called push would be a poll with extra steps.
- The live stream closes itself at 50s. Whatever the platform's function
  ceiling is, closing first turns a reaped function into a clean reconnect —
  and the reconnect re-runs the admin guard, so a dashboard left open on an
  unattended screen cannot outlive its session by more than that.

---

## 12. Delivery — and the build break that had to be fixed first

**`next/font/google` had to go, and this was not optional.** Google began
returning **404 for four of the Playfair Display files its own stylesheet points
at**, and `next build` failed with `Module not found:
@vercel/turbopack-next/internal/font/google/font`. Reproducible across clean
builds, while the same URLs fetched by hand returned 200 — so it was not a
network problem here, and it would have failed a Vercel deploy identically.

The fonts are now vendored in `app/fonts/` and **the build touches no network at
all**. Manrope and Playfair are variable fonts, so one file covers each weight
range rather than five byte-identical copies; latin subset only. `size-adjust`
fallback metrics are still generated, so the CLS of 0 is unaffected, and the
head still carries five same-origin preloads and zero external origins.

**Do not reintroduce `next/font/google`.** There is a test that fails if the
import comes back.

**The render-blocking CSS is split.** All six stylesheets were `@import`ed into
`globals.css`, so every visitor to every route parsed the /stats panels, the
invoice table, the admin chat console and the /system-design diagrams. Each now
lives in a stylesheet imported by the page or component that owns it. Global
sheet: **114.6KB → 96.2KB**; seven route sheets at 1.5–4.1KB. Verified in
production: `/` ships one stylesheet, `/system-design` ships two.

Splitting the two shared breakpoint blocks by section is the part that is easy
to get wrong — a rule left behind still applies, but only on the routes that
load the file it was left in — so each media query was divided along with the
selectors it targets.

- The chat widget's CSS is attached to the **component**, so it travels with the
  idle-gated dynamic chunk instead of blocking first paint everywhere.
- Integration routes carry `s-maxage` + `stale-while-revalidate` in front of —
  not instead of — the database cache. Verified live: `x-vercel-cache: HIT`.
  Vercel consumes `s-maxage` and rewrites the downstream header to `public`, so
  do not read that as the header having been dropped.
- `sw.js` is explicitly never cached. A hard-cached service worker is stuck
  forever: the thing that would fetch its replacement is the stale copy.
- Brotli is the edge's job and `compress` stays off — Next only does gzip, and
  producing gzip in front of an edge that recompresses is CPU spent on bytes
  that get discarded. Verified live: `content-encoding: br`.
- There is deliberately **no** `/_next/static` cache rule. Next already serves
  those immutable for a year, and restating it makes the build warn.

---

## 13. Security

**The headers are in `next.config.ts`, not the proxy, and that is load-bearing.**
A proxy that matches a route forces it to render dynamically — putting them in
middleware would have silently converted every static page into a per-request
render.

**`script-src` keeps `'unsafe-inline'` deliberately.** The App Router inlines
the RSC flight payload into a `<script>` on every page, and the theme and reveal
bootstraps must run before first paint. The only alternative is a per-request
nonce, which Next can supply only from middleware. What the policy still buys,
stated precisely rather than dismissed: third-party script sources blocked,
`eval` blocked, and `connect-src` allowing only our origin plus four read-only
model repositories — so the usual "inject a script, exfiltrate cookies" chain is
broken at two of its three links.

`object-src` is `'self'`, not `'none'`: /resume previews the PDF through an
`<object>`.

**CSRF is an origin check in the proxy, ahead of and instead of the auth
instance for `/api`.** `authorized()` only decides /admin and /account, so
running it over /api would cost a JWT decode to reach a verdict it does not
make. **The auth gate is untouched** — it was broken once and is pinned by
`tests/p2-auth-gate.test.ts`. Webhooks and Auth.js routes are exempt: webhooks
authenticate by signature over the raw body, and the OAuth callback is
legitimately a cross-site navigation.

Adding `/api` to the matcher costs no static generation, because API routes
already render per request. **That is exactly why the matcher may grow there and
must never grow to cover pages.**

**The rate limiter has a shared backend now.** `consume()` prefers Upstash Redis
when configured — one INCR plus a conditional EXPIRE, where the key's own TTL
_is_ the refill, which is what makes it one atomic round trip. It is a fixed
window rather than a true bucket, so a caller can spend capacity either side of
a boundary; not worth a Lua script for endpoints whose job is stopping a script.
**It degrades to memory rather than failing closed** — a limiter that 429s
because its own dependency is down has converted someone else's outage into
ours.

**The vault** reads `NAME_FILE` before `NAME`, which is the Docker and
Kubernetes convention: an env var is visible to every process in a container and
lands in `docker inspect`, a mounted file has permissions. It is split into
`lib/security/secrets.ts` (pure, edge-safe) and `lib/security/vault.ts` (touches
`node:fs`) because `instrumentation.ts` is bundled for the Edge runtime too, and
anything in that graph that so much as _mentions_ `node:fs` makes the build warn.

XSS and SQLi were mostly audit rather than new code, which is the honest
finding: React escapes every rendered child, blog content is plain text, and the
one raw query already used a tagged template. What is new is `jsonForScript` for
the JSON-LD block — valid JSON containing `</script` still ends the element —
and two tests that fail the build if anything reaches for `$queryRawUnsafe` or
calls `$queryRaw` with a built string.

**Verified in production**, not just asserted: every header present including
HSTS, cross-site POST to `/api/contact` returns 403, the webhook exemption
holds, and the CSP carries `wasm-unsafe-eval`, `worker-src 'self' blob:` and
`upgrade-insecure-requests`.

---

## 14. DevOps and observability

**Sentry over its HTTP API, with no SDK.** `@sentry/nextjs` is a build-time
plugin: it patches the bundler, uploads source maps, wraps every route. What is
needed is one POST of a documented envelope format, and doing it by hand means
the error path carries no build-time dependency — on a project whose build was
broken by a third party three commits earlier. The trade is named in the file:
no breadcrumbs, no tracing, stack frames point at built output.

Frames are **reversed** on the way out: Sentry renders innermost-last, V8 prints
innermost-first, and getting that backwards makes every error look like it
originated in the framework. Messages are scrubbed through the vault first.

Client errors relay through `/api/report-error` rather than going to Sentry
directly — a browser-side DSN is public by construction and would force
`connect-src` to be widened.

**`/api/metrics` exposes gauges and not one counter, deliberately.** RED metrics
are counters incremented in the process handling a request; on serverless those
live in one instance's memory while a scrape reaches whichever instance the
platform picks, so the series would jump between unrelated instances' totals and
`rate()` over it would produce numbers that look precise and mean nothing. What
is exposed is state that is genuinely shared — the database. Request rate and
latency are already answered by the platform's own per-function metrics, which
can see every invocation in a way no endpoint running _inside_ one ever can.

**`/api/health` returns 503 when unhealthy**, not 200 with a `degraded` body
that every automated consumer would read as fine. Admins additionally get the
secrets report; anonymous callers never do.

**The container is not the production path and does not pretend to be.** It
exists to prove nothing here depends on Vercel, to reproduce a build without the
platform, and to hold secrets as mounted files. `output: "standalone"` is opted
into by `DOCKER_BUILD=1` so the Vercel deploy is untouched. Non-root user;
health-checks readiness rather than an open port, because a Next server answers
on the port well before it can reach the database.

---

## 15. QA — the layer that was missing

`pnpm test:e2e` runs Playwright against a production build. **`E2E_BASE_URL=…
pnpm test:e2e` runs the same specs against a deployment**, which makes them a
post-deploy smoke test — the checks that matter after a deploy are the ones that
mattered before it. Every request carries `DNT: 1`, so a run against production
cannot write synthetic page views into real analytics.

The suite exists because of the blank-navigation outage (§2z). So it **clicks**
rather than calling `goto()` per route — a `goto` is a fresh document load,
which is precisely the case that always worked and would have passed throughout
the outage.

**The invariant is "nothing substantially on screen is unrevealed", not "some
element got armed".** Both wrong versions were written first and both taught
something: `/blog` has no `[data-reveal]` sections at all, and the homepage's
four are all below the fold, which §2a is explicit is the design working. The
threshold is the element's **top edge** at 75% of viewport height, because the
failure being caught is an element whose beginning you can see and whose content
is not there — `/reach-out`'s `.channel-list` sat at 485 in a 720px viewport when
it broke. An "any intersection at all" rule flags the next section peeking over
the bottom edge on every page that has one.

**axe composites elements over their background**, so one caught mid-stagger at
0.988 opacity reads as a colour that never ships — enough to tip text near the
AA boundary into a violation that does not exist. It showed up as failures
moving between routes and themes on consecutive runs. The scan now waits for
opacity to **stop changing**, rather than for a threshold: some elements are
legitimately never revealed, and several decorative animations never finish.

Lighthouse CI closes the gap §2a recorded — the font work was structurally
verified but its LCP effect was never measured. It runs `continue-on-error`:
variance on a shared runner is several points, and a build that fails on noise
is one people re-run without reading.

---

## 16. AI — retrieval, and what it honestly is

**There is no embedding API call anywhere in this phase.** Every hosted provider
is metered and free-tier-only is a standing constraint. The alternatives were a
~500MB transformer with a cold start per invocation, or one in the browser —
which puts the index and the query in different processes and so puts it back on
the server. So the embedding is computed in-process: hashed TF-IDF over unigrams
and bigrams, sublinear TF × IDF, L2-normalised into 256 dimensions, in a
pgvector column.

**It is a lexical embedding and the code says so.** It cannot know that
"Kubernetes" and "container orchestration" are related, and no tuning will teach
it. **Which is exactly why retrieval is hybrid**: dense vectors and Postgres
full-text search fail differently, so both run on every query and the results
fuse by **reciprocal rank**. RRF rather than a weighted sum because cosine
similarity and `ts_rank` are on incomparable scales — 0.42 against 0.0007 — so
any weighting is a decision about which retriever wins, dressed up as
arithmetic.

**The default answer is extractive because it cannot hallucinate.** Every
sentence exists verbatim on the site and links to where it came from. Generation
is a button that says what it costs: WebLLM downloads a ~380MB model once and
runs it on the visitor's own GPU, grounded on the same passages. On a page
describing a real person's real work, a fluent invented claim is not a smaller
failure than an awkward true one — the visitor cannot tell them apart.

**Three things were calibrated against measured output, not guessed:**

- Confidence originally required a raw score of 1.0. Real answers score
  **0.19–0.33**, so it could never fire, which reads as permanent uncertainty
  about answers that are correct. It now needs two distinct matched words, half
  the question covered, and agreement between both retrievers. One word is not
  enough: "where does he work?" reduces to "work", matched "knowledge-work" in
  an unrelated project, and produced a confidently wrong answer.
- Sentence ranking ignored retrieval order, so the right sentence beat a wrong
  one 0.31 to 0.25 — close enough that ordinary variation flips it.
- The stemmer left "caching"/"cache" and "service"/"services" as different
  terms. Dropping a silent "e" fixes both, with a **length floor of 5, not 4**:
  at 4 it also collapses "rate"→"rat" and "site"→"sit" for no gain, since
  plurals already agree without it.

**The JD matcher shipped a lie on its first live run, and the fix is the
interesting part.** "Deep knowledge of COBOL mainframe migration" came back
COVERED with a banking case study as proof, because "knowledge" and "deep"
cleared a two-terms threshold and `retrieve` **always returns its best effort** —
that is what a retriever is for. Treating a returned passage as proof is how a
coverage report starts lying. Requirements now need a _distinctive_ term (under
a quarter of the corpus) **and** the passage must contain it. That fix then
produced the opposite error — "PostgreSQL and Redis at scale" reported as a gap
because only the top-ranked chunk was checked and it named neither — so it now
scans four candidates for one that actually proves the requirement.

`KnowledgeChunk.heading` is **non-nullable**, and that is not cosmetic: Postgres
treats NULLs as distinct inside a unique index, so a nullable heading would let
the same chunk insert twice and duplicate on every reindex.

**`pnpm ai:index` is a full rebuild every time.** IDF is a property of the whole
corpus, so adding one document changes the weight of every term in every other
document's vector. An incremental indexer would leave old vectors in one space
and new ones in another, and the failure would be invisible — the numbers still
come out, just wrong. Re-run it after any content change, and after any change
to the tokenizer or the embedding.

---

## 17. Newly settled — do not re-litigate

Additions to §9. Everything there still holds.

- **Fonts are vendored in `app/fonts/`.** Not `next/font/google` — that broke
  the build when Google 404'd its own files. A test fails if the import returns.
- **`prisma db push` is still the workflow**, and pgvector must exist first.
  `pnpm ai:index` creates the extension and the HNSW index, so a fresh database
  needs that one command.
- **The presence token must not be stored.** See §11 for the race it causes.
- **Route CSS belongs to the page or component that owns it.** Do not move a
  route stylesheet back into `globals.css` to "keep the imports tidy".
- **`consume()`, not `takeToken()`, at request boundaries.** `takeToken` remains
  exported because it is the in-memory fallback.
- **The extractive answer stays the default.** Generation is opt-in, in-browser,
  and grounded. Do not make a model the primary answer path.
- **`/api/metrics` has no counters, on purpose.** See §14 before adding one.
- **The E2E suite sends `DNT: 1`.** Do not remove it — a suite that pollutes the
  analytics it is meant to protect is worse than no suite.

---

## 18. Outstanding after P16

Supersedes §7. Items 7 (render-blocking CSS) and 8 (no E2E layer) from that list
are **done**.

1. **Move DNS off Wix**, then verify the Resend domain and set `EMAIL_FROM` to
   `shivam@shivamsfolio.com`. Still the only thing between transactional mail
   and the inbox. Unchanged from §7.
2. **Google + GitHub OAuth apps** → four env vars. Callback URIs in §3.
3. **A retry on unique-constraint violation** in `app/api/bookings/route.ts`.
   Still the oldest open code defect.
4. **Razorpay** per §6, still unblocked.
5. **R2** (SETUP.md §6) if uploads are wanted.
6. **`public/profile.jpg` does not exist.** `components/about-photo.tsx` handles
   it — it falls back to the "SP" wordmark rather than a broken image — but the
   `priority` preload still fires a request that 400s on every /about load, and
   the server logs it. Adding the photo removes both.
7. Optional: `UPSTASH_REDIS_REST_URL`/`_TOKEN` for shared rate limiting,
   `SENTRY_DSN` for error reporting, `METRICS_TOKEN` for the scrape endpoint.
   All three degrade cleanly while unset, which is also why their absence is
   invisible — `/api/health` reports which are on.

---

# Phases 17–20 — 13 Aug 2026

**Live on `fc5b1a1`.** Verified against production, not asserted: `/terminal`,
`/skills`, `/stats`, `/system-design`, `/compute` and `/data` all 200 with their
new sections rendered; `/compute` carries `COEP: require-corp` and the homepage
does not; `/wasm/kernel.wasm` serves `application/wasm` with a valid magic
number; the warehouse export returns 99 fact rows with no per-visitor column.

**385 unit tests, 41 E2E, lint and typecheck clean.**

---

## 19. The deployment failure worth remembering

**Production stopped advancing after P17 while every build passed locally**, and
nothing in the build output pointed at why. The cause was `vercel.json`: the
outbox worker was scheduled `*/10 * * * *`, and **the Hobby plan permits cron
jobs only at daily granularity**. The deployment was rejected on its
configuration, not its code — so `pnpm build` was green, the push succeeded, and
`/api/health` simply kept reporting the previous commit.

**If production is not on the commit you pushed, check `vercel.json` before you
check anything else.** A config rejection looks exactly like nothing happening.

The fix was better than what it replaced, which is worth noting because the
constraint forced it. An outbox drained once a day delivers a contact email
tomorrow — technically eventually consistent, practically broken. So the drain
is now kicked from the contact route itself in `after()`, once the response is
flushed: the common case is immediate, the write path stays atomic, and the
daily cron became what it should always have been — the retry safety net, not
the delivery mechanism. The lease makes the two safe together.

---

## 20. DevEx UI (P17)

**One command registry, two front ends.** The Cmd+K palette and the `/terminal`
CLI read the same list from `lib/devex/commands.ts`, so they cannot drift into
two different answers to "what can I do here". A test asserts every navigation
command points at a page that exists and that none offers a route the visitor
would be redirected away from.

**The terminal is not a typewriter animation.** It parses input, drives the real
router, sets the real theme, and `ask` runs the P16 retrieval endpoint — so it
answers questions about the site, with sources, from a prompt. Arrow keys walk
shell history; Tab completes command names.

**The customiser cannot produce a third hue, and that constraint is the
design.** A colour picker would let any visitor break the two-colour brief in
one drag and every contrast guarantee with it. The accent rotates ±18° through
`oklch(from … l c calc(h + shift))`, which rewrites **only** the hue channel —
lightness and chroma pass through untouched, and every ratio in §2b is a
function of lightness against the surface, so this provably cannot move one. A
`hue-rotate()` filter would have changed lightness _and_ rotated the photograph.
Behind `@supports`, so a browser without relative colour gets the designed
palette rather than a broken one.

**The heatmap is labelled as what it is**: public GitHub activity over 90 days,
which is what the unauthenticated events endpoint can see — not "contributions",
which would include private work and a full year. `GITHUB_TOKEN` is optional
here by design, so a feature built on the GraphQL contribution calendar would be
dead most of the time.

**The skill graph is force-directed and settled on the server**, seeded so it is
byte-identical for every visitor. A live physics loop would ship a simulation,
run it on the main thread during hydration, and draw a different picture every
visit.

One real hole a test caught: strict comparison scored "Résumé" **zero** for the
spelling almost everyone types, and ranked "Achievements" first because "resume"
is a subsequence of its keyword list. Accents are folded now, and the fold
preserves length so highlight indices still address the original string.

---

## 21. Distributed systems (P18)

**The outbox exists because two writes to different systems cannot be atomic.**
`/api/contact` used to save a row and then send an email in a second try/catch —
four outcomes, two of them wrong. Now the row and the _intent to email_ commit
in one transaction and a worker turns intent into effect with backoff.

There is no Kafka and there should not be: a broker is a server that must stay
up, and this runs on functions that do not. The guarantee a broker provides here
comes from writing the event in the same transaction, not from the broker.
`FOR UPDATE SKIP LOCKED` makes two workers safe without a lock between them.

**The DLQ is the part people skip.** Retrying forever turns one poison message
into permanent load; giving up silently loses it. `DEAD` is a third state:
stopped, kept, countable. An unknown topic is dead-lettered immediately — no
number of retries produces a handler that was never written.

Backoff is **quadratic, not exponential**: doubling reaches hours by the sixth
attempt, which for a contact email means it arrives tomorrow.

**The lease is in Postgres, not Redis, and that inverts the usual assumption.**
Every critical section it guards is Postgres work, so a Redis lock can be held
perfectly while Postgres is unreachable — the lock succeeds and the work fails.
Worse, a Redis failover can hand one lock to two holders while both commit.
Redlock is implemented alongside it and `lib/distsys/lock.ts` says plainly that
at one Upstash instance it reduces to `SET NX PX`; its release is a two-round-
trip compare-and-delete, which is a real race, documented rather than hidden.

**Fencing tokens are not optional.** Release requires the token from
acquisition. Without it a holder whose lease expired mid-run releases the _next_
holder's lock on the way out and two workers run concurrently.

**Idempotency returns the stored response**, which is the whole feature — a 409
would be correct and useless. A key reused with a different body gets 422, since
that is a caller bug and replaying would hide it permanently.

**The Raft simulator is a pure state machine** with the visualisation on top.
Nineteen tests assert what the protocol guarantees, and one caught a real
modelling gap: a leader that lost quorum kept leading, which is exactly the
split-brain Raft prevents. It steps down now.

---

## 22. Low level (P19)

**The JavaScript baseline is written to be fast, not to lose** — same algorithm,
same squared-term reuse, same buffer shape. Benchmarking WASM against
deliberately naive JS is the oldest way to produce an impressive, meaningless
number.

**Every backend is checksummed before any timing is reported.** WebGPU is
reported as _differs_ rather than loosening the comparison until it agreed: WGSL
has no f64, so the shader computes in f32 and the banding is visible.

**Cross-origin isolation is scoped to `/compute`.** COEP blocks every
cross-origin subresource that does not opt in — site-wide it would break the
OpenStreetMap frame on `/reach-out` and the OAuth avatars. The worker and the
`.wasm` carry CORP so they survive under it, and the `.wasm` is served as
`application/wasm` because `instantiateStreaming` refuses anything else.

**AssemblyScript, not Rust**: a Rust toolchain is a second language in CI for a
forty-line integer kernel. **The `.wasm` is committed**, so the build needs no
second toolchain and a deploy cannot fail on a compiler version — the same
reasoning that vendored the fonts. `pnpm wasm:build` regenerates it.

The worker is a static file in `public/`, not a bundled module, because a
bundled worker needs a build-time URL dance that changes every Next major. The
price is a duplicated kernel, and **there is a test that fails if the two
copies drift** — a divergence would render a banded image subtly different from
the single-threaded one, which nobody would catch by looking.

The bands are deliberately uneven and the page says so: points inside the set
run the full iteration count, so the speed-up lands well under the core count.
That is the real load-imbalance problem.

---

## 23. Data engineering (P20)

**It is ELT, not ETL.** The raw events are already loaded, so there is nothing
to extract-then-load; the transform runs after the load. Transforming on the way
in throws away the rows you did not yet know you would need.

**The export is aggregated in Postgres before it is published**, which is what
makes publishing it possible at all. Shipping the ledger and letting DuckDB
aggregate in the browser would be simpler and would publish a per-visitor row
for every view ever recorded. A test asserts the pipeline never selects
`visitorHash` or `viewId`, and that it exports no further back than the
retention window — exporting past the prune point is inventing data.

**The query runs on the visitor's machine.** No query endpoint means no
injection surface, nothing to rate limit, and no way to make the database do
expensive work. That is the actual argument for client-side OLAP. ~30MB of WASM,
so it loads on a click and never before.

JSON rather than Parquet is a stated trade: a Parquet writer is megabytes on a
serverless function to serve rows that gzip to kilobytes, and DuckDB reads JSON
natively. At a hundred times this size the trade flips.

**The lineage DAG validates itself before it draws.** A cycle, a dangling edge
or a stage no source reaches renders as an error instead of a believable
picture, and every node names the file that implements it — checked by a test
that the file exists. Layering is by longest path, or an edge would run
backwards.

The blueprint names Flink; there is no stream processor and cannot be one. The
window semantics are real and the difference is named on the page: this
recomputes from the ledger on read, so it is correct and gets slower as the
ledger grows. Windows are aligned to the epoch, not to `now` — windows that
shift under you make two readings incomparable.

---

## 24. Also settled — do not re-litigate

- **Check `vercel.json` first when a deploy silently does not land.** Hobby
  crons are daily-only. See §19.
- **The outbox drains opportunistically from the write path**, with the cron as
  the retry net. Do not move delivery back onto the cron.
- **The lease is the Postgres one.** `acquireRedisLock` exists and is not used;
  read the note in `lib/distsys/lock.ts` before reaching for it.
- **`public/wasm/kernel.wasm` is committed.** Regenerate with `pnpm wasm:build`
  after editing `assembly/kernel.ts`, and commit the result.
- **The worker kernel is duplicated on purpose** and pinned by a test. Change
  both or neither.
- **COEP stays scoped to `/compute`.** Site-wide it breaks the map and avatars.
- **The theme customiser must never touch lightness.** The 7:1 floor depends on
  it; rotate hue only, through OKLCH.
- **The warehouse export must stay aggregated.** It is public because no row in
  it is a person.
- **`assembly/` is excluded from the app tsconfig.** It is a different language
  with the same syntax; typechecking it with the app's config produces dozens of
  "Cannot find name usize".

---

## 25. Outstanding after P20

Carries forward §18, unchanged except where noted.

1. **Move DNS off Wix**, then verify the Resend domain and set `EMAIL_FROM`.
   Still the only thing between transactional mail and the inbox.
2. **Google + GitHub OAuth apps** → four env vars.
3. **A retry on unique-constraint violation** in `app/api/bookings/route.ts`.
   Now easier than it was: `lib/distsys/command.ts` is the natural place, and
   bookings is the obvious next route to move onto it.
4. **Razorpay**, **R2** — unchanged.
5. **`public/profile.jpg` does not exist.** The fallback handles it, but the
   `priority` preload still 400s on every `/about` load.
6. **The E2E suite does not yet cover P17–P20.** The specs exist for P11–P16
   and the new pages are only checked by unit tests and by hand. `/terminal`,
   `/compute` and `/data` are the obvious additions — `/compute` especially,
   since a COEP regression would disable SharedArrayBuffer silently.
7. **A full production E2E run has never completed.** `E2E_BASE_URL=… pnpm
test:e2e` works but took 31 minutes over the network and was cut short at 13
   passed with no failures. Worth running once to completion from a faster link.
8. Optional: `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `SENTRY_DSN`, `METRICS_TOKEN`.
   All degrade cleanly while unset; `/api/health` reports which are on.

---

# Session of 13 Aug 2026 (later) — CI, and two features that were dead in production

This session developed nothing. It was scoped to getting P1–P20 verifiably
running on the live site and every CI job green.

**Pushed as `cd2fb98`.** Everything below was observed, not inferred, except
where it says otherwise.

---

## 26. Why CI was red — and why it was never the reason it looked like

Runs **#25–#32 all failed**, every run since P15 landed. The interesting part is
what was _not_ wrong:

| Job                                 | Result                                                        |
| ----------------------------------- | ------------------------------------------------------------- |
| `build` (lint→typecheck→test→build) | ✅ **passed on every one of those runs**                      |
| `e2e`                               | ❌ failed on every one — it has never once passed             |
| `lighthouse`                        | ❌ failed, but `continue-on-error` so it never failed the run |

So the workflow's red X came from `e2e` alone, and the gate everyone looks at
was green the whole time. That is why this survived eight runs.

**Root cause, confirmed against the installed version rather than assumed.**
`playwright.config.ts` points `webServer.url` at `/api/health`. Playwright
1.62.1 accepts only **2xx, 3xx, 400, 401, 402 or 403** as "ready" — the contract
is stated in `playwright/types/test.d.ts`. `/api/health` returns **503** when the
database is unreachable, deliberately and correctly (§14). CI sets a
deliberately unreachable `DATABASE_URL`, equally deliberately (§9). Two correct
decisions met and produced a 120-second timeout before a single test ran.

**Past that gate it still could not pass**, which is what rules out the tempting
small fix of pointing the gate at a liveness route:

- The P14 spec asserts `/api/health` returns **200** with `database.ok === true`.
- P11's heartbeat and all four P16 retrieval specs need real rows.
- Dynamic routes hang on connection timeouts with no database, so client-side
  navigations blow the 5s `toHaveURL` window — the navigation specs fail too.
- **`/` is a static route.** Its project list is baked into HTML at build time,
  so a no-database build produces an empty homepage and zero project pages.

That last point is why the E2E job could not simply reuse the `build` job's
artifact, which it used to download. **The two jobs genuinely need different
builds**: `build` proves a build survives having no database, and E2E needs a
build that has content. The artifact upload/download is gone; each builds its
own, and both comments say why.

### What CI looks like now

- `build` — unchanged, still on the unreachable placeholders. **Do not "fix"
  this by giving it a database.** §9 still holds: surviving a mid-build Neon
  blip is the property this asserts.
- `e2e` — overrides `DATABASE_URL`/`DIRECT_URL` from `secrets.E2E_DATABASE_URL`
  at the job level, then `prisma db push` → seed → `ai:index` → `pnpm build` →
  Playwright. Job-level `concurrency: ci-database` serialises it across runs,
  because two runs rebuilding the retrieval index on one branch would interleave.
- `lighthouse` — `needs: e2e` rather than `build`, for the same content-bearing
  build and to keep two jobs off the one database at once. Reads only; never seeds.
- A **fail-fast step** names a missing secret explicitly. Without it the failure
  is a silent 120-second timeout that says nothing, which is precisely how this
  hid for eight runs.

**One URL serves both `DATABASE_URL` and `DIRECT_URL` on purpose**: it must be
the _unpooled_ endpoint, because `prisma db push` runs session-level statements
that PgBouncer in transaction mode cannot. The Neon driver adapter connects
happily to either.

### Still required — CI stays red until this is done

`secrets.E2E_DATABASE_URL` **is not set yet.** It needs a Neon branch (free,
same project) and a GitHub Actions secret:

1. Neon → the existing project → Branches → **New branch**, name it `ci`.
2. Copy its **unpooled / direct** connection string — the host _without_
   `-pooler` in it.
3. GitHub → repo → Settings → Secrets and variables → Actions → **New
   repository secret**, named `E2E_DATABASE_URL`.
4. Re-run the latest workflow.

A branch rather than a second project because it is free, isolated and
disposable. **It must not be the production database** — the job pushes a
schema, seeds it and rebuilds the retrieval index on whatever it is pointed at.

---

## 27. Two features that shipped dead, and one silent a11y defect

All three have the shape §2b keeps recording: green build, green types, green
unit tests, and nothing working in a browser. None was reachable by `fetch()`.

**1. `/compute` — the worker backend never ran in production.** A dedicated
worker **inherits its creator's embedder policy**, so when the creating document
is cross-origin isolated the worker's _own script response_ must assert
`Cross-Origin-Embedder-Policy: require-corp` as well. `/workers/:path*` carried
CORP but not COEP. Chrome refused the load with `ERR_BLOCKED_BY_RESPONSE` before
the worker started, and the page reported **`worker failed: undefined`** — a
blocked load produces an `ErrorEvent` with no message. Same-origin and
CORP-tagged is _not_ sufficient; that is the trap.

Three of the four backends worked, so the page read as fine.
`crossOriginIsolated` was `true` and `SharedArrayBuffer` existed, which made it
look like a code bug rather than a header one.

`tests/p19-lowlevel.test.ts` asserted COEP applied to exactly `["/compute"]`,
which **pinned the bug in place**. It now asserts the page _and_ its worker, and
separately keeps the guarantee that actually matters — nothing broader may carry
COEP, or the OpenStreetMap frame and the OAuth avatars break.

**2. `/data` — DuckDB never loaded.** Reading the warehouse export means reading
JSON, and JSON is a DuckDB **extension**, fetched from `extensions.duckdb.org` at
query time. It is not part of the jsDelivr bundle that `connect-src` already
allowed. The CSP blocked it, the button re-enabled itself, no table ever
appeared, and the only evidence anywhere was a console violation.

Added as `DATA_EXTENSION_ORIGINS`, kept **separate from `DATA_ORIGINS` on
purpose**: that list is spread into `script-src` too, and this origin is only
ever fetched. The allowlist test in `tests/p13-security.test.ts` names it — that
test is built so a new origin cannot appear without being declared.

**3. `aria-label` on a bare `<div>`** (`app/page.tsx`, the skill marquee). A div
with no role maps to `role="generic"`, which does not support an accessible
name, so the label was **silently dropped** and did nothing for the screen
readers it was added for. axe reports it as `aria-prohibited-attr` (serious).
Fixed with `role="group"`, which permits naming.

---

## 28. What was verified live, and how

Against `https://www.shivamsfolio.com`, by request and in a real browser — not
by reading the source.

| Area                            | Result                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| 23 public page routes           | ✅ all 200; `/projects` 404 by design                                 |
| `/api/health`                   | ✅ `status: ok`, database reachable                                   |
| P4 search, P5 GitHub + LeetCode | ✅ live data, real ranked results                                     |
| P8 QR, P20 warehouse            | ✅ 200; export leaks no `visitorHash`/`viewId`                        |
| P13 headers, HSTS, CSRF         | ✅ all present; cross-site POST → 403                                 |
| P14 guarded endpoints           | ✅ `/api/metrics` and both crons → 401                                |
| Admin + account routes          | ✅ 307 to login                                                       |
| P16 retrieval                   | ✅ correct extractive answer **and** correct refusal                  |
| P19 isolation                   | ✅ `crossOriginIsolated: true`, SAB + WebGPU; COEP only on `/compute` |
| P19 worker backend              | ❌ **was** dead — fixed in `cd2fb98`                                  |
| P20 DuckDB                      | ❌ **was** dead — fixed in `cd2fb98`                                  |
| P17 terminal, P20 lineage DAG   | ✅ render with real content (15 DAG nodes)                            |

**Local suite at HEAD against a real database: 39/41 E2E, then clean after the
two fixes.** 385 unit tests, lint and typecheck all pass.

Both header fixes were verified **behaviourally**, not merely as headers: the
worker backend went from `worker failed: undefined` to `213.4 ms — 4 threads, 4
bands acknowledged`, and DuckDB went from nothing at all to returning real rows
(`/ | 297 | 26`) in five seconds.

### Two things worth knowing about the tooling

- **The E2E "project page renders its case study" failure was a flake**, not a
  bug: it passed 3/3 on re-run. It appeared under `--workers=2`; the config pins
  one worker in CI for exactly this reason.
- **A database-less local run is a faithful CI reproduction.** Next does not
  overwrite variables already present in `process.env`, so exporting
  `DATABASE_URL` in the shell beats `.env.local` without touching the file.

---

## 29. Also settled — do not re-litigate

- **COEP belongs on the worker as well as the page.** This is not a widening of
  §22's "scoped to /compute" rule — a dedicated worker inherits the policy, so
  its own response needs it. The test now pins both, plus "nothing broader".
- **`extensions.duckdb.org` is a `connect-src` origin only.** Do not fold it into
  `DATA_ORIGINS`; that list also feeds `script-src`.
- **CI's `build` job keeps its unreachable database.** Only `e2e` and
  `lighthouse` get the real one.
- **E2E must build its own artifact.** The `build` job's output has an empty
  homepage by design and is not a valid subject for an end-to-end test.
- §9's "any element with a pale background must set its `color`" now has a
  sibling: **any element carrying `aria-label` must have a role that permits a
  name.** A bare `<div>` does not.
- **`public/wasm/kernel.js` and `kernel.d.ts` are unused AssemblyScript
  by-products.** The `/wasm/:path*` rule serves them as `application/wasm`,
  which is harmless because nothing loads them. Not a defect — do not "fix" the
  MIME type without first checking whether anything references them.

---

## 30. Outstanding after this session

Carries forward §25. The new item is first because it blocks green CI.

1. **Set `secrets.E2E_DATABASE_URL`** — see §26. Until then `e2e` fails fast
   with a named error instead of a silent timeout.
2. **The Lighthouse job has never passed either**, and was not diagnosed this
   session — it is `continue-on-error`, so it does not fail the run. Its
   assertions are strict (accessibility and SEO pinned at 1.0, performance 0.95,
   `third-party-summary` at 0) and it had been measuring a **no-database build
   with an empty homepage**, which is very likely part of it. Re-check once it
   runs against a seeded branch, before changing any threshold.
3. **The E2E suite still does not cover P17–P20.** `/compute` most of all: the
   defect fixed this session is exactly the silent COEP regression §25 warned
   about, and no test would have caught it. A spec asserting that all four
   backends report a time, and that `/data` returns rows, would have.
4. Items 1–8 of §25 are otherwise unchanged: DNS off Wix, OAuth apps, the
   booking unique-constraint retry, Razorpay, R2, `public/profile.jpg`, a full
   production E2E run, and the optional Upstash / Sentry / metrics variables.
