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

## Pages

- `/` — Home and selected work
- `/about`, `/skills`, `/experience`, `/certifications`, `/achievements`, `/resume` — background and credentials
- `/projects/[slug]` — Six detailed project case studies
- `/contact`, `/reach-out` — ways to get in touch, plus an OpenStreetMap location panel
- `/stats` — live GitHub and LeetCode figures, cached with a stale-on-error fallback
- `/services`, `/booking/success`, `/invoice/[token]` — paid bookings and invoices
- `/newsletter/confirmed` — double opt-in confirmation landing page
- `/login`, `/register`, `/forgot-password`, `/reset-password/[token]` — authentication
- `/account` — signed-in user settings (profile, password, linked providers)
- `/admin` — admin-only user list and role management

The latest SDE-II résumé is available at `/Shivam-Patil-SDE-II-Resume.pdf`.
