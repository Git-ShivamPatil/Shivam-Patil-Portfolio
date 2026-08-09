# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption — where something is
inferred rather than observed, it says so.

**Last verified:** 9 Aug 2026, against commit `f0baff1`.

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

**Live at https://www.shivamsfolio.com, commit `f0baff1`.** Local `HEAD`,
`origin/main`, and the Vercel production deployment are all the same commit.

**Everything is green.** Verified 9 Aug, not assumed:

| Check                                    | Result                                   |
| ---------------------------------------- | ---------------------------------------- |
| GitHub Actions run #15                   | ✅ success                               |
| Commit check-run `build`                 | ✅ success                               |
| Commit status `Vercel`                   | ✅ "Deployment has completed"            |
| Combined commit status                   | ✅ `success`                             |
| Vercel production target                 | ✅ `READY` on `f0baff1`                  |
| `pnpm lint`                              | exit 0                                   |
| `pnpm typecheck`                         | exit 0                                   |
| `pnpm test`                              | 185 passed / 185, **3 consecutive runs** |
| `pnpm build` (CI env, unreachable DB)    | exit 0                                   |
| Every internal link on the live homepage | 20/20 → HTTP 200                         |

Vercel retains 28 deployments: **24 READY, 4 ERROR**, and the newest error is
`b30f3b8` from **7 Aug** — fixed by the very next commit. There is no ongoing
deployment failure.

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

**12 of 32 are set.** Verified against the Vercel API on 9 Aug. Nothing missing
here breaks the build — every integration degrades by design — but each absence
silently disables a feature that is already fully built.

**Set** (all Production + Preview): `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
`AUTH_URL`, `AUTH_TRUST_HOST`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM`,
`GITHUB_USERNAME`, `LEETCODE_USERNAME`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`,
`CRON_SECRET`.

**Missing, ordered by impact:**

| Variable(s)                                                | Consequence while absent                                                                                                   | Notes                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `RESEND_API_KEY`                                           | **All transactional email is `console.warn`'d, not sent** — contact form, password reset, booking confirmation, newsletter | Value already in `.env.local` and verified live |
| `VAPID_PRIVATE_KEY`                                        | Web push dead. `/api/push/subscribe` returns `"enabled": false`                                                            | Value already in `.env.local`; pair verified    |
| `AUTH_GOOGLE_ID` / `_SECRET`, `AUTH_GITHUB_ID` / `_SECRET` | Google + GitHub sign-in buttons cannot complete a flow                                                                     | Email/password login is unaffected — see §4     |
| `RAZORPAY_*` / `STRIPE_*`                                  | `/services` booking API returns 503                                                                                        | See §6 for the deliberate ordering              |
| `S3_*`                                                     | Admin media library read-only; uploads disabled                                                                            | Cloudflare R2, SETUP.md §6                      |
| `GITHUB_TOKEN`                                             | `/stats` limited to 60 req/hr instead of 5,000                                                                             | Optional                                        |
| `CAL_USERNAME`, `CAL_EVENT_SLUG`                           | Intro-call section not rendered at all                                                                                     | Optional                                        |

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

### The email trap

`EMAIL_FROM` is `Shivam Patil <onboarding@resend.dev>` — Resend's **shared test
sender**, which only delivers to the Resend account owner's own address. So even
once `RESEND_API_KEY` is set:

- ✅ Contact-form notifications **to you** arrive.
- ❌ Password reset, booking confirmation, newsletter confirmation **to
  visitors** are rejected by Resend.

Fixing that needs the domain verified (SETUP.md §1: DKIM + SPF DNS records) and
`EMAIL_FROM` moved to something like `Shivam Patil <hello@shivamsfolio.com>`.
Until then, treat visitor-facing email as **not working**.

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

**Known, deliberately not changed:** `.project-number` and `.project-category`
sit at 3.3–4.4:1 — below WCAG AA for small text. Unlike the titles above this is
**identical in both themes**, so it is an existing design choice about muted
metadata rather than a bug, and darkening it changes the cards' visual
hierarchy. Left for you to decide.

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

| Service               | State                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Neon Postgres         | ✅ working, schema pushed including P8/P9/P10 tables                                                                      |
| Vercel                | ⚠️ **12 of 32 env vars set** — see §3                                                                                     |
| Resend (key)          | ✅ send-only key in `.env.local`, verified authentic — **not yet on Vercel**                                              |
| Resend (domain)       | ❌ `shivamsfolio.com` DNS records not added — SETUP.md §1. Unverifiable from here: the send-only key cannot list domains. |
| VAPID (web push)      | ✅ pair in `.env.local`, cryptographically verified — **private key not yet on Vercel**                                   |
| GitHub / LeetCode     | ✅ working unauthenticated. LeetCode handle is `shivam2op`                                                                |
| Google / GitHub OAuth | ❌ no client credentials created                                                                                          |
| Razorpay              | ❌ no key generated — see the blocker below                                                                               |
| Cal.com               | ❌ not set up (section hidden without `CAL_USERNAME`)                                                                     |
| Cloudflare R2         | ❌ not set up — media library read-only (SETUP.md §6)                                                                     |

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

Ordered by impact. Steps 1–3 activate features that are **already fully built**.

1. **Copy `VAPID_PRIVATE_KEY` and `RESEND_API_KEY` from `.env.local` to Vercel**
   (Production + Preview, Sensitive). Redeploy. Verify `/api/push/subscribe`
   flips to `"enabled": true`. Zero cost, no new accounts.
2. **Resend domain** — add DKIM + SPF for `shivamsfolio.com` (SETUP.md §1), then
   move `EMAIL_FROM` off `onboarding@resend.dev`. Until this is done,
   visitor-facing email does not work. See §3.
3. **Google + GitHub OAuth apps** → four env vars. Callback URIs in §3.
4. **Add a retry on unique-constraint violation** in
   `app/api/bookings/route.ts` (§2).
5. **Razorpay** per §6, now unblocked.
6. **R2** (SETUP.md §6) if you want uploads. Don't forget the CORS rule — a
   presigned PUT without it is blocked by the browser, not by R2.
7. Optional: Cal.com, GitHub PAT.

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
