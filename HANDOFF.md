# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption.

---

## 1. Where things stand

**Branch:** `claude/phase-5-6-7` → **PR #2** (open, not merged)
https://github.com/Git-ShivamPatil/Shivam-Patil-Portfolio/pull/2

**Nothing is deployed.** That is still why none of P5–P9 is visible on the live
site — the PR is unmerged and no Vercel deployment has been made from it.

**Phases 1–9 are implemented.** Local verification, all green:

- `pnpm test` → 122 tests, 11 files, pass
- `pnpm typecheck` → 0
- `pnpm lint` → 0
- `pnpm build` → exit 0, 51/51 pages
- `pnpm build` **with `.env.local` removed and an unreachable DB** → exit 0.
  This is the CI condition and it still holds.

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
