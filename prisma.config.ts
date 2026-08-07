// Prisma 7's CLI no longer loads .env files on its own. Plain `dotenv/config`
// only reads a file literally named `.env`, so load `.env.local` explicitly
// to match the file Next.js itself reads secrets from (per .env.example).
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local" });

// `env()` resolves eagerly the instant this file is evaluated — for EVERY
// Prisma CLI command, including `generate`. That breaks `pnpm install`'s
// `postinstall: prisma generate` in build environments (e.g. Vercel) where
// only DATABASE_URL is configured and DIRECT_URL isn't, since `generate`
// never actually opens a database connection and shouldn't need one.
// Only commands that do connect (migrate, db push, studio) require a real,
// unpooled DIRECT_URL — Neon's pooled DATABASE_URL runs through PgBouncer in
// transaction mode, which can't run the session-level commands those need.
const directUrl = process.argv.includes("generate")
  ? (process.env.DIRECT_URL ??
    process.env.DATABASE_URL ??
    "postgresql://unused:unused@localhost:5432/unused")
  : env("DIRECT_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Used by the Prisma CLI (generate/migrate), not by the app at runtime.
  // The app itself connects via the driver adapter in lib/prisma.ts using
  // the pooled DATABASE_URL instead.
  datasource: { url: directUrl },
});
