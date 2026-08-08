"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { compressImage, checksumOf, headerBytesOf } from "../../lib/storage/compress";
import { acceptAttribute, HEADER_BYTES, MAX_UPLOAD_BYTES } from "../../lib/storage/validate";

interface MediaAsset {
  id: string;
  key: string;
  url: string;
  filename: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  createdAt: string | Date;
}

interface UploadProgress {
  name: string;
  stage: "compressing" | "uploading" | "saving" | "done" | "error";
  message?: string;
  saved?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibrary({
  initialAssets,
  storageConfigured,
}: {
  initialAssets: MediaAsset[];
  storageConfigured: boolean;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const patch = (name: string, next: Partial<UploadProgress>) =>
    setProgress((prev) => prev.map((item) => (item.name === name ? { ...item, ...next } : item)));

  const uploadOne = useCallback(async (file: File) => {
    const name = file.name;
    patch(name, { stage: "compressing" });

    // Compress before hashing: the checksum must describe the bytes actually
    // stored, since it is both the dedupe key and the object key.
    const compressed = await compressImage(file);
    const [checksum, header] = await Promise.all([
      checksumOf(compressed.blob),
      headerBytesOf(compressed.blob, HEADER_BYTES),
    ]);

    const saved = compressed.originalBytes - compressed.compressedBytes;
    patch(name, { stage: "uploading", saved });

    const signRes = await fetch("/api/admin/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: name,
        contentType: compressed.mime,
        bytes: compressed.compressedBytes,
        checksum,
        header,
        width: compressed.width || undefined,
        height: compressed.height || undefined,
      }),
    });
    const signData = await signRes.json().catch(() => null);

    if (!signRes.ok) {
      patch(name, { stage: "error", message: signData?.error ?? "Upload rejected." });
      return null;
    }
    if (signData.duplicate) {
      patch(name, { stage: "done", message: "Already in the library." });
      return signData.asset as MediaAsset;
    }

    const putRes = await fetch(signData.uploadUrl, {
      method: "PUT",
      // Must match the type that was signed, or R2 rejects the signature.
      headers: { "Content-Type": signData.contentType },
      body: compressed.blob,
    });
    if (!putRes.ok) {
      patch(name, { stage: "error", message: `Storage rejected the upload (${putRes.status}).` });
      return null;
    }

    patch(name, { stage: "saving" });
    const confirmRes = await fetch("/api/admin/media", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: signData.key,
        url: signData.publicUrl,
        filename: name,
        contentType: signData.contentType,
        bytes: compressed.compressedBytes,
        checksum,
        width: compressed.width || undefined,
        height: compressed.height || undefined,
      }),
    });
    const confirmData = await confirmRes.json().catch(() => null);
    if (!confirmRes.ok) {
      patch(name, { stage: "error", message: confirmData?.error ?? "Couldn't save the asset." });
      return null;
    }

    patch(name, { stage: "done" });
    return confirmData.asset as MediaAsset;
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const tooBig = list.filter((file) => file.size > MAX_UPLOAD_BYTES);
      if (tooBig.length > 0) {
        toast.error(`${tooBig[0].name} is too large.`);
      }

      const usable = list.filter((file) => file.size <= MAX_UPLOAD_BYTES);
      if (usable.length === 0) return;

      setProgress(usable.map((file) => ({ name: file.name, stage: "compressing" as const })));

      // Sequential, not parallel: each upload holds a full decoded bitmap in
      // memory, and a drop of twenty photos in parallel will exhaust a tab.
      const uploaded: MediaAsset[] = [];
      for (const file of usable) {
        const asset = await uploadOne(file);
        if (asset) uploaded.push(asset);
      }

      if (uploaded.length > 0) {
        setAssets((prev) => {
          const seen = new Set(prev.map((asset) => asset.id));
          return [...uploaded.filter((asset) => !seen.has(asset.id)), ...prev];
        });
        toast.success(`${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded.`);
      }
      // Leave the rows up briefly so a failure is readable.
      setTimeout(() => setProgress([]), 4000);
    },
    [uploadOne],
  );

  async function saveAlt(asset: MediaAsset, alt: string) {
    const res = await fetch(`/api/admin/media/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt }),
    });
    if (!res.ok) {
      toast.error("Couldn't save the alt text.");
      return;
    }
    toast.success("Alt text saved.");
  }

  async function remove(asset: MediaAsset) {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${asset.filename}?`)) return;
    const res = await fetch(`/api/admin/media/${asset.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't delete.");
      return;
    }
    setAssets((prev) => prev.filter((item) => item.id !== asset.id));
    toast.success("Deleted.");
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copied.");
    } catch {
      toast.error("Couldn't copy.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {!storageConfigured && (
        <p className="border-app-line text-app-muted rounded-2xl border border-dashed p-4 text-sm">
          Object storage isn&apos;t configured, so uploading is disabled. Set{" "}
          <code>S3_ENDPOINT</code>, <code>S3_BUCKET</code>, <code>S3_ACCESS_KEY_ID</code> and{" "}
          <code>S3_SECRET_ACCESS_KEY</code> to enable it. Existing assets are still listed.
        </p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (storageConfigured) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (storageConfigured) void handleFiles(event.dataTransfer.files);
        }}
        className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-app-fg bg-app-line/20" : "border-app-line"
        } ${storageConfigured ? "" : "opacity-50"}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 left-1/2 -z-10 h-40 w-72 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--lime), transparent 70%)" }}
        />
        <p className="text-app-fg text-sm font-semibold">
          {dragging ? "Drop to upload" : "Drag images here, or"}{" "}
          {!dragging && (
            <button
              type="button"
              disabled={!storageConfigured}
              onClick={() => inputRef.current?.click()}
              className="underline underline-offset-4 disabled:no-underline"
            >
              browse
            </button>
          )}
        </p>
        <p className="text-app-muted mt-2 text-xs">
          Auto-converted to AVIF or WebP in your browser before upload, and resized to 2400px. JPEG,
          PNG, WebP, AVIF, GIF and PDF accepted.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttribute()}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {progress.length > 0 && (
        <ul className="flex flex-col gap-2">
          {progress.map((item) => (
            <li
              key={item.name}
              className="border-app-line flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 text-sm"
            >
              <span className="text-app-fg truncate font-medium">{item.name}</span>
              <span
                className={
                  item.stage === "error" ? "text-xs text-red-600" : "text-app-muted text-xs"
                }
              >
                {item.message ??
                  {
                    compressing: "Compressing…",
                    uploading: "Uploading…",
                    saving: "Saving…",
                    done: "Done",
                    error: "Failed",
                  }[item.stage]}
                {item.stage !== "error" && item.saved && item.saved > 0
                  ? ` · saved ${formatBytes(item.saved)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((asset) => (
          <figure
            key={asset.id}
            className="border-app-line group relative overflow-hidden rounded-2xl border"
          >
            <div className="bg-app-line/20 aspect-[4/3] overflow-hidden">
              {asset.contentType === "application/pdf" ? (
                <div className="text-app-muted flex h-full items-center justify-center font-mono text-xs">
                  PDF
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset.url}
                  alt={asset.alt || asset.filename}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              )}
            </div>
            <figcaption className="flex flex-col gap-2 p-3">
              <span className="text-app-fg truncate text-xs font-medium" title={asset.filename}>
                {asset.filename}
              </span>
              <span className="text-app-muted font-mono text-[10px]">
                {formatBytes(asset.bytes)}
                {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
              </span>
              <input
                defaultValue={asset.alt}
                placeholder="Alt text"
                onBlur={(event) => {
                  if (event.target.value !== asset.alt) void saveAlt(asset, event.target.value);
                }}
                className="border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg w-full rounded-lg border px-2 py-1 text-xs outline-none"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => copyUrl(asset.url)}
                  className="text-app-fg text-[11px] font-semibold hover:underline"
                >
                  Copy URL
                </button>
                <button
                  type="button"
                  onClick={() => remove(asset)}
                  className="text-[11px] font-semibold text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {assets.length === 0 && (
        <p className="text-app-muted py-8 text-center text-sm">Nothing uploaded yet.</p>
      )}
    </div>
  );
}
