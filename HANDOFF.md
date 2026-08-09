# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption.

---

## 1. Where things stand

**Deployed and live at https://www.shivamsfolio.com** (commit `e71420c`).
`main` was fast-forwarded to `claude/phase-5-6-7` and pushed; the Vercel
project is git-connected, so the push built and promoted automatically.

Correcting two things earlier versions of this file got wrong, because both
cost time to rediscover:

1. "Nothing is deployed" was **false**. A production site existed the whole
   time — Vercel project `shivam-patil-portfolio`, custom domain
   `www.shivamsfolio.com`. What was actually true is that it served an old
   build stuck at phases 1–4, which is why `/services` and `/stats` 404'd.
2. "Vercel env vars not configured" was **false**. Six were already set
   (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL`,
   `AUTH_TRUST_HOST`, `NEXT_PUBLIC_SITE_URL`) for Preview and Production.

Verified live after deploy: `/`, `/services`, `/stats`, `/search`, `/blog`,
`/projects/[slug]` all 200; `/api/qr` 200 for an on-site payload and 422 for an
off-site one; `/r/<unknown>` 302; `/admin/*` 307 to login when anonymous.

**Still unset in production** (each degrades, none throws): `RESEND_API_KEY`,
`EMAIL_FROM`, `VAPID_*`, `RAZORPAY_*`, `S3_*`, `CAL_*`, `GITHUB_TOKEN`. So
email, web push, paid booking and media upload are inert until you add them —
see §5.

**Phases 1–10 are implemented.** Local verification, all green:

- `pnpm test` → 184 tests, 12 files, pass
- `pnpm typecheck` → 0
- `pnpm lint` → 0
- `pnpm build` → exit 0, 51/51 pages
- `pnpm build` **with `.env.local` removed and an unreachable DB** → exit 0.
  This is the CI condition and it still holds.

**A P7 defect was found and fixed while chasing a red CI run.**
`generateReference()` used a `randomBytes(3)` suffix — 24 bits — against a
`@unique` `Booking.reference`, so by the birthday bound 2,000 references
carried an **~11% chance** of a collision. `app/api/bookings/route.ts` passes
the value straight into `booking.create()` **with no retry**, so a collision
surfaced as a 500 for a customer at the moment they were trying to pay. The
test that kept failing was not flaky; it was correctly reporting that.

Widened to `randomBytes(5)` (40 bits), which puts the same burst at ~1 in
550,000. References are now `BK-2608-4F2A9C1B2D` — 18 characters, still inside
Razorpay's 40-character receipt limit. Existing references are unaffected;
nothing parses them by length. A retry on unique-constraint violation in the
booking route would be belt-and-braces on top and is **still not there**.

`pnpm format:check` reports ~54 files. That is pre-existing CRLF-vs-LF noise
from the Windows checkout, not a code issue, and **CI does not run it** — the
workflow is lint → typecheck → test → build.

## 2. Stack facts that constrain every decision

- Next.js 16 App Router, TS, Prisma 7 (client generated to `lib/generated/prisma`,
  Neon driver adapter in `lib/prisma.ts`), NextAuth v5, Tailwind v4.
- **Vercel serverless.** Module-scope memory is NOT shared across requests. This
  is why chat is SSE + DB-poll rather than WebSocket, and why typing indicators
  are stored as deadline columns in Postgres, not in memory.
- **Free tier only** — user directive. Mapbox was removed for being metered;
  the map is OpenStreetMap. P9 uses Cloudflare R2 for the same reason: 10GB
  free and, critically, **zero egress fees**.
- **Stripe is dropped** from the plan (user decision). The adapter still exists
  and is inert without keys; Razorpay is the only intended provider.
- Every integration must **degrade, not throw**, when its env keys are absent.

## 3. What changed this session

### P1–P7 reverification — one real break found and fixed

**`auth.config.ts` — the admin area was inaccessible to everyone, admins
included.** `authorized()` gates `/admin` on `auth.user.role`, but `proxy.ts`
builds a _second_, adapter-less NextAuth instance from `authConfig` alone, and
Auth.js's default session callback rebuilds `session.user` from a fixed
whitelist — name, email, image — dropping every other claim. So `role` was
`undefined` and the gate denied every request.

Fixed by moving the `session` callback into `auth.config.ts` so both instances
share it. **Verified end to end**, not just reasoned about: with a minted
ADMIN session cookie, `/admin/links` returns 200; removing the callback again
reproduces the 307 to `/login`; a USER cookie is correctly denied at `/admin`
and admitted at `/account`. Pinned by `tests/p2-auth-gate.test.ts` (9 tests).

Also fixed from the prior audit list:

- `auth.ts` — role is re-read from the DB on session update, so demoting an
  admin no longer takes up to 30 days to take effect.
- `app/search/page.tsx` — wrapped in `readOrFallback`; was the only public read
  path that 500'd on a DB blip.
- `app/projects.ts` — `toProject` coerces its JSON columns to arrays, so one
  malformed row degrades a section instead of 500ing the page.
- `app/api/forgot-password/route.ts` — per-email and per-IP rate limits, and
  outstanding reset tokens are burned when a new one is issued.
- `app/api/register/route.ts` — rate-limited. The 409 still distinguishes an
  OAuth-only account on purpose (otherwise a Google signup gets "registration
  failed" forever with no way to understand why); the limit is what makes bulk
  enumeration impractical.
- `lib/integrations/cache.ts` — negative caching via a tombstone row, and
  `fetchWithTimeout` now buffers the body _inside_ the timeout window (it
  previously cleared the timer before the body was read, so body reads were
  untimed).
- Admin `[id]` routes — Prisma `P2025` returns 404 instead of 500.
- `app/admin/inbox/page.tsx` — bounded `take`, with counts from aggregates.
- `components/image-gallery.tsx` — real focus trap, so `aria-modal="true"` is
  now true rather than merely claimed.
- `app/globals.css` — the reduced-motion block blanket-cancels animations
  instead of naming three classes. **Checked that nothing is stranded
  invisible**: every `opacity:0` base in the codebase is transition-driven, not
  animation-driven.
- `app/globals.css` — **project card titles were invisible in dark theme.**
  The accent backgrounds (`.project-cyan` and friends) are pastel literals
  that deliberately never change with the theme, but the text inherited
  `--fg`, which flips to cream. Measured contrast was **1.05:1**. Fixed by
  setting `color: var(--ink)` on `.project-card`; now 16.28:1. This is the
  "handful of page-specific hardcoded text-color literals" the previous
  handoff listed as a known follow-up — it was worse than it sounded.
- `tests/p2-password.test.ts` — given an explicit 30s timeout. `bcryptjs` is
  pure JS, so cost-12 hashing is ~900ms of single-threaded CPU each, and as
  the suite grew to 11 concurrent files these started blowing the 5s default.
  Verified stable over three consecutive full runs.

### Known, deliberately not changed

`.project-number` and `.project-category` on the project cards sit at
3.3–4.4:1 — below WCAG AA for small text. Unlike the titles above, this is
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
- Dynamic QR at `/api/qr`, styled SVG (dots/squares, gradient, logo cut-out).
  Encoding is `qrcode-generator`; the rendering is ours.
- `/admin/links` — CRUD, live QR preview with palettes, and a dashboard
  (area chart, device donut, source bars, per-link conversion table) drawn as
  hand-written SVG in a **server** component, so no charting library ships.

### P9 — Storage

- `MediaAsset` model, content-addressed by SHA-256 so re-uploading identical
  bytes returns the existing row rather than paying to store a second copy.
- `lib/storage/s3.ts` — hand-rolled SigV4 query presigner. No AWS SDK: it would
  add ~15MB to the bundle for one operation. Browser uploads go straight to R2,
  so bytes never cross a Vercel function.
- `lib/storage/validate.ts` — type decided by **magic bytes**, never by the
  browser's `type` or the extension. **SVG is deliberately excluded**: it is an
  XML document that can carry `<script>`, and served from our own origin that
  is stored XSS. `avis` (image sequence) is rejected while `avif` is accepted.
- `lib/storage/compress.ts` — AVIF/WebP conversion + resize in the browser, so
  there is no `sharp` cold-start on serverless. Falls back AVIF → WebP →
  original, and keeps the original when re-encoding would be larger.
- `/admin/media` — drag-drop library with per-file compression savings.

### P10 — Analytics

First-party, cookieless, and **additive to `@vercel/analytics`, not a
replacement**. Vercel Analytics answers "how many views"; it structurally
cannot see where on the page people click, how far they read, or whether they
took the résumé. Those three questions are the phase.

Four tables. `PageView`, `AnalyticsEvent` (the ledgers), `AnalyticsCounter`
and `HeatmapCell` (the aggregates) — the same ledger-plus-denormalised-counter
split P8 already uses for `ReferralClick`/`ReferralLink`.

- **`lib/analytics/normalize.ts` is the whole safety story** and is where the
  tests concentrate. It runs on both sides: in the browser for correctness (so
  `/services` and `/services/?utm=x` are one page rather than two), and again
  on the server because `/api/analytics/collect` is anonymous, so every field
  arriving from it is attacker-controlled.
- **Heatmaps are a sparse aggregate, never raw points.** A row per click
  coordinate is unbounded _and_ a re-identification surface — an exact
  (x, y, timestamp) trail is a behavioural fingerprint. `HeatmapCell` holds a
  counter per grid cell, created lazily, so the table's size tracks _where
  people click_ rather than how much traffic there is.
- **x is normalised against the centred content column, not the viewport.**
  `.shell` is `min(1180px, 100% - 64px)`, so the same button sits at a
  different fraction of the viewport on a 1280px screen than on a 1920px one.
  Normalising by viewport width would smear one element across several columns
  and make the aggregate meaningless. There is a test that pins exactly this.
  y is normalised against document height, not the viewport, or every click
  would pile into the top band.
- **Downloads are counted server-side at `/d/<slug>`**, shaped like P8's
  `/r/<code>`: 302 first, counter written in `after()`. A download counted only
  by client JS is invisible to content blockers, `Save link as…`, and scripting
  being off. The slug is a **closed allowlist**
  (`lib/analytics/downloads.ts`) — a slug that could name its own destination
  would be an open redirect on the production domain. Bot UAs are dropped, and
  `/d/` is disallowed in robots.txt, so "47 people took my résumé" means 47
  people.
- **`PageView.viewId` is the idempotency key.** The tracker flushes on
  `pagehide` _and_ `visibilitychange` because iOS fires only one of the two
  depending on how the tab goes away, so the same view is regularly reported
  twice. Engagement columns are monotonic via a guarded `updateMany` (`where:
{ durationMs: { lt: n } }`), so an out-of-order beacon is a no-op rather than
  rewriting a two-minute read as a bounce.
- **`PageView.day` is deliberately redundant** against `createdAt`. Prisma's
  `groupBy` has no date truncation, so a daily chart otherwise means either
  pulling every row into the app (what P8 does, and what stops scaling) or raw
  SQL. Materialising the bucket key costs 10 bytes a row and makes the read
  proportional to the number of _days_, not to traffic.
- **Privacy is enforced, not just claimed.** No IP and no cookie. `visitorHash`
  is P8's — salted with `AUTH_SECRET` and bucketed by UTC date, so it counts
  uniques without being joinable across days. Reusing it rather than
  reimplementing it means a person is the same hash in both ledgers on a given
  day, and there is one place where those properties are defined. `DNT: 1` and
  `Sec-GPC: 1` are honoured _before_ the rate limiter and the parser. Outbound
  clicks record the hostname only, never the path.
- **Retention is enforced.** `RETENTION_DAYS = 180`, pruned by
  `/api/cron/prune-analytics` (`vercel.json`, daily), in bounded batches — one
  unbounded `deleteMany` over months of rows is a statement timeout, and a
  timed-out delete rolls back entirely, so the job would make no progress while
  appearing to run. Guarded by `CRON_SECRET` (constant-time compare) or an
  admin session. Aggregates are kept: they are the safe form.
- `/admin/analytics` gained the P10 dashboard above the existing inbox/content
  stats, with a 7/30/90-day switcher. Charts are hand-written SVG in a server
  component, as in P8 — `smoothPath` moved to `lib/chart-path.ts` and both
  phases now share it. The heatmap viewer is the one client component, because
  switching maps is a filter rather than a navigation.

**Known dev-only artefact:** React StrictMode runs effects twice, so local
development records two `PageView` rows per navigation. Production is
unaffected.

### Graphics

`app/graphics.css` is new and **purely additive** — every rule targets a class
that already exists and only adds decoration. Deleting the file leaves the site
correct, just plainer. Cursor-tracked card spotlight (reusing the coordinates
the existing tilt handler already measures — no second listener), gradient
hairlines, aurora ribbon, heading underlines, panel sheen, focus rings,
scrollbar and selection styling. Blur-heavy layers are dropped under 720px.

## 4. Credentials — actual status

| Service           | State                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| Neon Postgres     | ✅ working, schema pushed **including the P8/P9 tables**                  |
| Resend            | ✅ sending-access key in `.env.local`                                     |
| Resend domain     | ⚠️ `shivamsfolio.com` registered, **DNS records NOT added** — SETUP.md §1 |
| VAPID (web push)  | ✅ generated locally, in `.env.local`                                     |
| GitHub / LeetCode | ✅ working unauthenticated. LeetCode handle is `shivam2op`                |
| Razorpay          | ❌ **no key generated** — see the blocker below                           |
| Cal.com           | ❌ not set up (section hidden without `CAL_USERNAME`)                     |
| Cloudflare R2     | ❌ not set up — media library is read-only until then (SETUP.md §6)       |
| Vercel            | ❌ env vars not configured                                                |

### Razorpay blocker (deliberate, not an oversight)

The account is live and activated, and there is no Test/Live toggle — so
generating a key there produces a **live** key. It was left ungenerated on
purpose: the webhook endpoint does not exist yet (nothing is deployed), and a
live key with no reachable webhook means a customer can be **charged but never
confirmed**. Correct order:

1. Merge + deploy → `https://<domain>/api/webhooks/razorpay` exists
2. Generate the key in the Razorpay dashboard
3. Register the webhook: `payment.captured`, `payment.failed`, `order.paid`,
   `refund.processed`
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

## 5. Outstanding work

1. **Verify CI is green on PR #2**, then merge.
2. **Deploy to Vercel** + add every env var (SETUP.md §8). `NEXT_PUBLIC_SITE_URL`
   must be the real origin — it builds email links, webhook return URLs, and
   the short links copied out of `/admin/links`.
3. **Razorpay** per §4 above, after deploy.
4. **Resend DNS** (SETUP.md §1).
5. **R2** (SETUP.md §6) if you want uploads. Don't forget the CORS rule — a
   presigned PUT without it is blocked by the browser, not by R2.
6. Optional: Cal.com, GitHub PAT.

### P10 deployment steps

1. **Push the schema.** P10 adds four tables and changes none. Verified with
   `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
--script`: 18 `CREATE` statements, zero `DROP`, zero `ALTER` on an existing
   table. Nothing on the site works until this runs:

   ```
   pnpm prisma db push
   ```

2. **Set `CRON_SECRET`** on the Vercel project (any long random string). Vercel
   then sends it as a bearer token on its own cron invocations. Without it the
   prune endpoint is unreachable except to a signed-in admin, so analytics rows
   are never deleted — that degrades rather than breaks, but on a free database
   tier it eventually matters.
3. `vercel.json` is new and declares the daily cron. It contains **only** the
   `crons` key, so every existing dashboard build setting is untouched.
4. Nothing else. There is no account to create and no key to obtain — that is
   the point of the phase being first-party.

## 6. Never independently audited

P6 comms and P7 payments still have not had a full adversarial sweep — the
agents doing it died on a usage limit in an earlier session. What has since
been checked by hand: `app/api/chat/stream/route.ts` does **not** have the
suspected IDOR. `resolveIdentity()` derives the role from a server-side
`auth()` call, and only an OWNER may pass `conversationId`; a visitor always
resolves to their own thread via their cookie.

## 7. Things already decided — do not re-litigate

- Chat is SSE + POST, not WebSocket (Vercel cannot host a socket server).
- CI intentionally has **no database**. The build surviving that is the
  feature, not a gap — do not "fix" CI by adding a Postgres service.
- Money is integer minor units end to end. Never floats.
- Bookings reach `CONFIRMED` only via a signature-verified webhook.
- `public/logo.jpeg` is a **photograph**, not a logo mark — hence the
  desaturated, masked watermark treatment on /about and /contact.
- Motion is driven by `data-*` attributes so server components stay server
  components, and everything is gated on `prefers-reduced-motion`.
- Image compression is client-side by design. Do not add `sharp`.
- QR module styling must never change which modules are set. There is a test
  (`tests/p8-growth.test.ts`) that reconstructs the matrix from the rendered
  SVG and compares it against the encoder's, module by module.
- P10 analytics is **first-party and stays that way**. No third-party script,
  no IP geolocation call (every provider is metered), no cookie, no
  cross-day identifier. Geo comes from edge headers the CDN already resolved,
  which is why it is empty in local development — that is correct, not a bug.
- The résumé preview on `/resume` points at the file directly and must keep
  doing so. Routing an `<object data>` through `/d/resume` would count a
  download for everyone who merely opened the page.
