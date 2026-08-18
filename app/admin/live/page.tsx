import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { LiveDashboard } from "../../../components/admin/live-dashboard";
import { PRESENCE_TTL_MS } from "../../../lib/realtime/constants";

export const metadata: Metadata = {
  title: "Admin · Live",
  robots: { index: false, follow: false },
};

// Nothing on this page is cacheable for even a second — the shell is static
// but the guard must run per request.
export const dynamic = "force-dynamic";

export default async function AdminLivePage() {
  await requireAdmin("/admin/live");

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Live</h1>
        <p className="text-app-muted mt-2 max-w-2xl text-sm">
          Server-sent events over the same first-party ledgers the analytics page reads, so the live
          number and the daily number can never disagree. Presence is a{" "}
          {Math.round(PRESENCE_TTL_MS / 1000)}-second freshness window on a token minted per page
          load, held in memory and never stored — it dies with the tab and is not joinable to a
          visit, a referral click or a person.
        </p>
      </div>

      <LiveDashboard />
    </div>
  );
}
