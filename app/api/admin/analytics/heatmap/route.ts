import { NextResponse } from "next/server";
import { requireAdminApi } from "../../../../../lib/api-guards";
import { getHeatmap, isHeatmapDevice } from "../../../../../lib/analytics/report";
import { normalizePath } from "../../../../../lib/analytics/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P10 — heatmap data for one (path, device) pair.
 *
 * A route rather than a server action because the viewer switches maps without
 * a navigation, and this is a pure read of a bounded, already-aggregated grid.
 * The device parameter is checked against the allowlist rather than passed
 * through: it reaches a `where` clause, and "it's only a string we group by"
 * is how an unvalidated parameter ends up somewhere it matters.
 */
export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path") ?? "/");
  const device = (url.searchParams.get("device") ?? "desktop").toLowerCase();

  if (!isHeatmapDevice(device)) {
    return NextResponse.json({ error: "Unknown device class." }, { status: 400 });
  }

  try {
    return NextResponse.json({ heatmap: await getHeatmap(path, device) });
  } catch (error) {
    console.error("GET /api/admin/analytics/heatmap failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
