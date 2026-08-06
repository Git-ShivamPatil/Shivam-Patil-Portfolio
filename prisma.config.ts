// Prisma 7's CLI no longer loads .env files on its own. Plain `dotenv/config`
// only reads a file literally named `.env`, so load `.env.local` explicitly
// to match the file Next.js itself reads secrets from (per .env.example).
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Used by the Prisma CLI (generate/migrate), not by the app at runtime.
  // DIRECT_URL (unpooled) is required here — Neon's pooled connection runs
  // through PgBouncer in transaction mode, which can't run the session-level
  // commands Prisma Migrate needs. The app itself connects via the driver
  // adapter in lib/prisma.ts using the pooled DATABASE_URL instead.
  datasource: { url: env("DIRECT_URL") },
});
