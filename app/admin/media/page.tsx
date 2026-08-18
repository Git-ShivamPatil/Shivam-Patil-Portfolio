import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { readOrFallback } from "../../../lib/db-read";
import { isStorageConfigured } from "../../../lib/storage/s3";
import { MediaLibrary } from "../../../components/admin/media-library";

export const metadata: Metadata = {
  title: "Admin · Media",
  robots: { index: false, follow: false },
};

export default async function AdminMediaPage() {
  await requireAdmin("/admin/media");

  const assets = await readOrFallback(
    "adminMedia",
    () => prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    [],
  );

  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Media</h1>
        <p className="text-app-muted mt-2 text-sm">
          {assets.length} asset{assets.length === 1 ? "" : "s"} ·{" "}
          {(totalBytes / (1024 * 1024)).toFixed(1)} MB stored
        </p>
      </div>

      <MediaLibrary
        initialAssets={assets.map((asset) => ({
          ...asset,
          createdAt: asset.createdAt.toISOString(),
        }))}
        storageConfigured={isStorageConfigured()}
      />
    </div>
  );
}
