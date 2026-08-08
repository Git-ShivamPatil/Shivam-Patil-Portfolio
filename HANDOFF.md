# Session handoff

Paste this file's contents into a new session to resume without re-deriving
anything. Everything here is verified fact, not assumption.

---

## 1. Where things stand

**Branch:** `claude/phase-5-6-7` → **PR #2** (open, not merged, "Able to merge")
https://github.com/Git-ShivamPatil/Shivam-Patil-Portfolio/pull/2

**Nothing is deployed.** That is the whole reason P5–P7 changes are not visible
on the live site — the PR is unmerged and no Vercel deployment has been made
from this branch.

**Phases 1–7 are implemented.** Local verification, all green:

- `pnpm test` → 60 tests, 8 files, pass
- `pnpm typecheck` → 0
- `pnpm lint` → 0
- `pnpm build` **with `.env.local` removed and an unreachable DB** → exit 0, 40/40 pages

## 2. Stack facts that constrain every decision

- Next.js 16 App Router, TS, Prisma 7 (client generated to `lib/generated/prisma`,
  Neon driver adapter in `lib/prisma.ts`), NextAuth v5, Tailwind v4.
- **Vercel serverless.** Module-scope memory is NOT shared across requests. This
  is why chat is SSE + DB-poll rather than WebSocket, and why typing indicators
  are stored as deadline columns in Postgres, not in memory.
- **Free tier only** — user directive. Mapbox was removed for being metered;
  the map is OpenStreetMap (no key, no account). Do not reintroduce paid
  services. Razorpay/Stripe are fine: no fee until money is received.
- **Stripe is dropped** from the plan (user decision). The adapter still exists
  and is inert without keys; Razorpay is the only intended provider.
- Every integration must **degrade, not throw**, when its env keys are absent.

## 3. Credentials — actual status

| Service           | State                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| Neon Postgres     | ✅ working, schema pushed (incl. P5–P7 models)                            |
| Resend            | ✅ sending-access key in `.env.local`, verified (HTTP 422 auth check)     |
| Resend domain     | ⚠️ `shivamsfolio.com` registered, **DNS records NOT added** — SETUP.md §1 |
| VAPID (web push)  | ✅ generated locally, in `.env.local`                                     |
| GitHub / LeetCode | ✅ working unauthenticated. LeetCode handle is `shivam2op`                |
| Razorpay          | ❌ **no key generated** — see the blocker below                           |
| Cal.com           | ❌ not set up (section simply hidden without `CAL_USERNAME`)              |
| Vercel            | ❌ env vars not configured                                                |

### Razorpay blocker (deliberate, not an oversight)

The account is **live and activated** — website `www.shivamsfolio.com` is
Approved, and there is **no Test/Live toggle** in that dashboard. Generating a
key there produces a **live** key.

It was left ungenerated on purpose: the webhook endpoint does not exist yet
(nothing is deployed). A live key with no reachable webhook means a customer
can be **charged but never confirmed** — money taken, booking stuck at
`PENDING_PAYMENT`, no invoice issued. Correct order:

1. Merge + deploy → `https://<domain>/api/webhooks/razorpay` exists
2. Generate the key in the Razorpay dashboard
3. Register the webhook with events: `payment.captured`, `payment.failed`,
   `order.paid`, `refund.processed`
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

## 4. Remaining audit findings (NOT yet fixed)

An adversarial P1–P7 audit ran; the verification pass was cut short by a usage
limit, so these are **unverified auditor claims — confirm before acting.** The
high-severity ones from my own changes are already fixed and pushed.

**Security / correctness — do these first**

1. `auth.config.ts:17` — the proxy admin gate reads `auth.user.role`, which is
   reportedly `undefined` in the lightweight NextAuth instance, so the gate may
   always deny (or always pass — verify which).
2. `auth.ts:55` — role is baked into the JWT at sign-in and never refreshed.
   Demoting an admin via `/api/admin/users/[id]/role` has no effect for up to
   30 days.
3. `app/api/forgot-password/route.ts:21` — no rate limit; previously issued
   reset tokens are not invalidated when a new one is issued.
4. `app/search/page.tsx:16` — the only public read path with no
   `readOrFallback`, so a DB error returns a 500.
5. `app/projects.ts:54` — `toProject`'s unchecked JSON casts turn one malformed
   row into a hard 500.

**Reliability / UX**

6. `lib/integrations/cache.ts:62` — no negative caching; every request retries a
   failing upstream.
7. `lib/integrations/cache.ts:86` — `fetchWithTimeout` clears its abort timer
   before the body is read, so body reads are untimed.
8. `components/image-gallery.tsx:53` — declares `role="dialog" aria-modal="true"`
   with no focus management.
9. `app/globals.css:226` — the reduced-motion block neutralises transitions but
   not animations; three infinite animations keep running.
10. `app/admin/inbox/page.tsx:14` — loads every `ContactMessage` with no `take`.
11. `app/api/admin/projects/[id]/route.ts:55` — Prisma `P2025` (not found)
    surfaces as a 500 instead of a 404.
12. `app/api/register/route.ts:23` — discloses whether an email is registered.

**Never audited** (agents died on the usage limit): **P6 comms** and
**P7 payments** full sweeps. `app/api/chat/stream/route.ts` is the
highest-risk unaudited file — specifically whether a visitor can read another
conversation by passing `conversationId`.

## 5. Outstanding work

1. **Verify CI is green on PR #2**, then merge.
2. **Deploy to Vercel** + add every env var (SETUP.md §6). `NEXT_PUBLIC_SITE_URL`
   must be the real origin — it builds email links and webhook return URLs.
3. **Razorpay** per §3 above, after deploy.
4. **Resend DNS** (SETUP.md §1). Until then Resend can only deliver to
   shivampatilinfo@gmail.com, so password resets and booking receipts to real
   customers will not send.
5. **Work the audit list** in §4.
6. Optional: Cal.com, GitHub PAT.

## 6. Things already decided — do not re-litigate

- Chat is SSE + POST, not WebSocket (Vercel cannot host a socket server).
  Correctness comes from the Postgres poll in the stream handler; the in-memory
  hub is only a same-instance latency optimisation.
- CI intentionally has **no database**. The build asserting it survives that is
  the feature, not a gap — do not "fix" CI by adding a Postgres service.
- Money is integer minor units end to end. Never floats.
- Bookings reach `CONFIRMED` only via a signature-verified webhook, never from
  a browser redirect.
- `public/logo.jpeg` is a **photograph**, not a logo mark — hence the
  desaturated, masked watermark treatment on /about and /contact.
- Motion is driven by `data-*` attributes so server components stay server
  components, and everything is gated on `prefers-reduced-motion`.
