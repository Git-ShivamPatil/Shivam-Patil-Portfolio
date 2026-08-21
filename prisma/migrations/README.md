# Migrations

**This project has always used `prisma db push`, not migrations.** `ci.yml`
pushes the schema into the CI database, and §45 of HANDOFF.md records that the
three schema changes before this one went to production the same way. There was
no `_prisma_migrations` table anywhere and no migration history to inherit.

P27 added the first two files here, because a change that creates tables on a
database holding real bookings deserves a reviewable artifact rather than a
command someone runs from memory.

## What is here

| Directory                     | What it is                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0_init`                      | The schema **as it already exists in production**. Generated with `migrate diff --from-empty`. Applying it to production would fail — every table already exists — which is exactly why it must be marked as applied rather than run. |
| `20260821120000_api_metering` | `ApiKey` and `UsageRecord`, plus their enums, indexes and foreign keys. **Purely additive**: two `CREATE TYPE`, two `CREATE TABLE`, five `CREATE INDEX`, two `ADD CONSTRAINT`. It does not `ALTER` or `DROP` anything that exists.    |

## Applying it

Two routes. Both produce the same tables; they differ in what they leave behind.

### Option A — keep using `db push` (no workflow change)

```bash
pnpm exec prisma db push
```

`db push` ignores this directory entirely and diffs the live database against
`schema.prisma`. Since the only difference is the two new tables, this executes
the same statements as the migration file. It writes no migration history, so
the next change is in exactly the same position as this one.

Use this if you want the smallest possible change today.

### Option B — adopt migrations from here on

One-time baseline, then deploy:

```bash
# Tell Prisma the production database already IS 0_init. Runs no SQL.
pnpm exec prisma migrate resolve --applied 0_init

# Applies only 20260821120000_api_metering.
pnpm db:deploy
```

`migrate resolve --applied` creates the `_prisma_migrations` table and records
`0_init` as done without executing it. Skipping this step and running
`db:deploy` directly would try to create every table from scratch and fail on
the first one.

After the baseline, `pnpm db:deploy` is the deploy path and `pnpm db:migrate`
creates new migrations. **`ci.yml` still runs `prisma db push`** against the
CI database, which is fine and deliberate: that database is disposable and
recreated from the schema, so migration history there buys nothing.

## Verifying it worked

```bash
pnpm exec prisma db execute --stdin <<'SQL'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('ApiKey', 'UsageRecord');
SQL
```

Two rows means it landed. Zero means nothing was applied.

## If you need to undo it

Nothing reads these tables unless a key exists, so leaving them in place is
harmless. To remove them anyway:

```sql
DROP TABLE IF EXISTS "UsageRecord";
DROP TABLE IF EXISTS "ApiKey";
DROP TYPE IF EXISTS "ApiKeyStatus";
DROP TYPE IF EXISTS "ApiKeyTier";
```

`UsageRecord` first — it holds the foreign key.
