# shivamsfolio

An editorial, systems-inspired portfolio built with Next.js, TypeScript, Tailwind CSS, Prisma, and NextAuth v5.

## Run locally

```bash
corepack enable
pnpm install
```

Copy `.env.example` to `.env.local` and fill in real values (see **Environment setup** below — the site runs with placeholder DB/auth values too, just without a working database or OAuth).

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Production check

```bash
pnpm build
pnpm start
```

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm format:check
```

## Database

```bash
pnpm db:generate   # regenerate the Prisma client after a schema change
pnpm db:migrate    # create/apply a migration locally
pnpm db:deploy     # apply migrations in production
pnpm db:studio     # browse the database
```

## Environment setup

Copy `.env.example` to `.env.local`, then:

1. **Database (Neon)** — create a project at [neon.tech](https://neon.tech), copy the pooled connection string into `DATABASE_URL` and the direct (non-pooled) one into `DIRECT_URL`, then run `pnpm db:migrate`.
2. **Auth secret** — run `npx auth secret` and put the result in `AUTH_SECRET`.
3. **Google OAuth** — create an OAuth client at [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Authorized redirect URIs: `https://shivamsfolio.com/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. Put the values in `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`.
4. **GitHub OAuth** — create two OAuth Apps at [github.com/settings/developers](https://github.com/settings/developers) (GitHub allows only one callback URL each): a dev app with callback `http://localhost:3000/api/auth/callback/github`, and a prod app with callback `https://shivamsfolio.com/api/auth/callback/github`. Put the values in `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`.
5. **Resend** — create an API key at [resend.com](https://resend.com), put it in `RESEND_API_KEY`. Without it, password-reset links are logged to the console instead of emailed.

## Cost posture

Everything in this project runs on a free tier, and nothing is able to generate
a charge. That is a deliberate constraint, not a coincidence — treat it as
binding when adding dependencies.

| Service       | Used for              | Free tier                        | Card required |
| ------------- | --------------------- | -------------------------------- | ------------- |
| Neon          | Postgres              | Free project                     | No            |
| Vercel        | Hosting               | Hobby                            | No            |
| Resend        | Transactional email   | 3,000/month, 100/day             | No            |
| GitHub API    | `/stats` panel        | 60 req/hr anon, 5,000 with a PAT | No            |
| LeetCode      | `/stats` panel        | Public endpoint, no auth         | No            |
| OpenStreetMap | `/reach-out` map      | Free embed, no key               | No            |
| Cal.com       | Intro-call scheduling | Free individual plan             | No            |
| Web Push      | Notifications         | Self-generated VAPID keys        | No            |
| Cloudflare R2 | Media uploads         | 10GB stored, **no egress fee**   | No            |

**Mapbox was removed** in favour of OpenStreetMap: it is metered and bills past
a free allowance, which violates the constraint above.

**Stripe and Razorpay** charge no signup or monthly fee — they take a
percentage of money you actually receive. Both are fully implemented and both
are inert until their keys are set, so the site runs with neither. Test mode
costs nothing if you want to exercise the flow end to end.

Every integration degrades rather than failing when its keys are absent:

- No `RESEND_API_KEY` → mail is logged to the console instead of sent.
- No `GITHUB_TOKEN` → the GitHub panel still works, on the anonymous rate limit.
- No `CAL_USERNAME` → the intro-call section is not rendered.
- No VAPID keys → the notification toggle renders nothing at all.
- No payment keys → `POST /api/bookings` returns 503 and `/services` says so.
- No `S3_*` keys → `/admin/media` lists existing assets but disables uploading
  and explains why.

**R2 rather than S3** for the same reason Mapbox was dropped: S3 bills for
egress, and egress is exactly what serving images is. R2's is zero.

Images are converted to AVIF or WebP and resized **in the browser** before
upload, and go straight to the bucket via a presigned URL. So there is no
`sharp` binary in the bundle, no image processing on a serverless function,
and the bytes never cross one.

## Pages

Grouped the way the site's own navigation groups them — both are generated from
`lib/site-routes.ts`, so this list and the site cannot drift apart. **They had**:
this section previously omitted seventeen public routes, all of P19–P25, which is
most of the engineering the site exists to show.

**Start here**

- `/` — the short version, and a map of everything else
- `/about` — background, and how I work
- `/resume` — the one-page résumé, embedded, with a PDF download
- `/contact` — email, phone, and an OpenStreetMap location panel

**My work**

- `/projects`, `/projects/[slug]` — six case studies, each with architecture and trade-offs
- `/experience` — roles and the systems shipped in each
- `/skills` — grouped skills plus a server-rendered graph of which project evidences which
- `/achievements`, `/certifications` — credentials, each with a verifiable source
- `/stats` — live GitHub and LeetCode figures, cached with a stale-on-error fallback

**See it running** — every page here is live, not a screenshot

- `/system-design` — the real architecture, hand-drawn SVG, plus a Raft election you can break
- `/ask` — hybrid pgvector + full-text retrieval, extractive cited answers, optional in-browser LLM
- `/terminal` — a real shell over the site's content
- `/compute` — the same kernel in JS, WASM, a SharedArrayBuffer worker pool and WebGPU
- `/data` — lineage DAG, windowed aggregation, and DuckDB-WASM SQL in the page
- `/api-lab` — OpenAPI 3.1, a GraphQL subgraph, protobuf, and a sandbox built from the spec
- `/reliability` — SLOs, error budgets, and a circuit breaker you can trip
- `/security` — response headers, CI static analysis, and a live CycloneDX SBOM
- `/mlops` — the site's own retrieval measured: recall, MRR, nDCG over a labelled set
- `/edge` — the WAF, a Cloudflare Worker sharing its ruleset, and a Background Sync outbox

**Writing**

- `/blog`, `/blog/[slug]` — write-ups on systems and AI

**Work with me**

- `/reach-out` — a short message form
- `/services`, `/booking/success`, `/invoice/[token]` — paid bookings and invoices

**Audience shortcuts**

- `/for/recruiter`, `/for/human`, `/for/ai`, `/for/theelderbrother` — four ways in, offered inline on the homepage

**Utility, auth and admin**

- `/search` — site search (deliberately `noindex`)
- `/offline` — the cached shell the service worker serves when the network is gone
- `/newsletter/confirmed` — double opt-in confirmation landing page
- `/login`, `/register`, `/forgot-password`, `/reset-password/[token]` — authentication
- `/account` — signed-in user settings (profile, password, linked providers)
- `/admin` — user list and role management
- `/admin/links` — trackable short links, QR generator, click and conversion analytics
- `/admin/media` — image library with browser-side AVIF/WebP compression
- `/admin/analytics` — traffic, geo, devices, scroll reach, click heatmaps, download counters
- `/admin/projects`, `/admin/blogs`, `/admin/skills`, `/admin/bookings`, `/admin/inbox`, `/admin/chat`, `/admin/live` — content and operations
- `/r/[code]` — short-link redirect; tags the destination so conversions attribute back
- `/d/[slug]` — counted download redirect; the résumé's real download number
- `/api/qr?data=…` — dynamic QR code as SVG

The latest SDE-II résumé is available at `/Shivam-Patil-SDE-II-Resume.pdf`.

## Analytics

First-party and cookieless. `@vercel/analytics` answers "how many views"; this
answers the three questions it structurally cannot see from outside the origin:

- **Where do people click?** A click heatmap per page and device class, stored
  as a sparse grid of counters rather than as raw coordinates — a per-click
  `(x, y, timestamp)` trail is a behavioural fingerprint, and an aggregate is
  not.
- **How far do they read?** Deepest scroll position and visible dwell time per
  page. A page with many views and 20% reach is a different problem from a page
  nobody opens, and a view count cannot tell them apart.
- **Did they take the résumé?** `/d/<slug>` counts downloads server-side, so
  the number survives content blockers, `Save link as…`, and scripting being
  off entirely.

What it never stores: an IP address, a cookie, a cross-day identifier, or the
URL of an off-site page anyone visited. Visitors are counted by a SHA-256 of
(salt + UTC date + IP + user agent), which distinguishes two people today and
cannot be joined to yesterday. `DNT: 1` and `Sec-GPC: 1` are honoured before
the request reaches any code that records, and rows are pruned on a schedule
(`vercel.json` → `/api/cron/prune-analytics`).
