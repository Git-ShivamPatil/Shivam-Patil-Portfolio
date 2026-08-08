"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

interface ReferralLink {
  id: string;
  code: string;
  label: string;
  destination: string;
  campaign: string | null;
  active: boolean;
  clickCount: number;
  uniqueCount: number;
}

const inputClass =
  "border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg rounded-lg border px-3 py-2 text-sm outline-none";

const emptyDraft = { code: "", label: "", destination: "", campaign: "", active: true };

export function LinkManager({
  initialLinks,
  origin,
}: {
  initialLinks: ReferralLink[];
  origin: string;
}) {
  const [links, setLinks] = useState(initialLinks);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [qrFor, setQrFor] = useState<ReferralLink | null>(null);

  const shortUrl = (code: string) => `${origin}/r/${code}`;

  async function createLink() {
    if (!draft.label.trim() || !draft.destination.trim()) {
      toast.error("Label and destination are required.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't create link.");
      return;
    }
    setLinks((prev) => [data.link, ...prev]);
    setDraft(emptyDraft);
    toast.success(`Created /r/${data.link.code}`);
  }

  async function saveLink(link: ReferralLink) {
    const res = await fetch(`/api/admin/links/${link.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: link.code,
        label: link.label,
        destination: link.destination,
        campaign: link.campaign ?? "",
        active: link.active,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Couldn't save link.");
      return;
    }
    toast.success("Saved.");
  }

  async function deleteLink(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this link and its click data?")) {
      return;
    }
    const res = await fetch(`/api/admin/links/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't delete link.");
      return;
    }
    setLinks((prev) => prev.filter((link) => link.id !== id));
    toast.success("Deleted.");
  }

  function updateLocal(id: string, patch: Partial<ReferralLink>) {
    setLinks((prev) => prev.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(shortUrl(code));
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="border-app-line rounded-2xl border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
              Label
            </span>
            <input
              className={inputClass}
              value={draft.label}
              onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="LinkedIn bio"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
              Destination
            </span>
            <input
              className={`${inputClass} w-64`}
              value={draft.destination}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, destination: event.target.value }))
              }
              placeholder="/services"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
              Code
            </span>
            <input
              className={`${inputClass} w-32`}
              value={draft.code}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, code: event.target.value.toLowerCase() }))
              }
              placeholder="auto"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-app-muted text-xs font-semibold tracking-wide uppercase">
              Campaign
            </span>
            <input
              className={`${inputClass} w-32`}
              value={draft.campaign}
              onChange={(event) => setDraft((prev) => ({ ...prev, campaign: event.target.value }))}
              placeholder="optional"
            />
          </label>
          <button
            type="button"
            onClick={createLink}
            disabled={busy}
            className="bg-app-ink text-app-lime rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create link"}
          </button>
        </div>
        <p className="text-app-muted mt-3 text-xs">
          Leave the code blank to generate one. Every link redirects with{" "}
          <code>?ref=&lt;code&gt;</code>, so contact, booking and newsletter conversions are
          attributed automatically.
        </p>
      </section>

      <div className="border-app-line overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Label</th>
              <th className="px-4 py-3 font-semibold">Destination</th>
              <th className="px-4 py-3 font-semibold">Clicks</th>
              <th className="px-4 py-3 font-semibold">On</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id} className="border-app-line border-b last:border-0">
                <td className="px-4 py-2">
                  <input
                    className={`${inputClass} w-28 font-mono`}
                    value={link.code}
                    onChange={(event) =>
                      updateLocal(link.id, { code: event.target.value.toLowerCase() })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className={inputClass}
                    value={link.label}
                    onChange={(event) => updateLocal(link.id, { label: event.target.value })}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className={`${inputClass} w-56`}
                    value={link.destination}
                    onChange={(event) => updateLocal(link.id, { destination: event.target.value })}
                  />
                </td>
                <td className="text-app-muted px-4 py-2 whitespace-nowrap tabular-nums">
                  <span className="text-app-fg font-semibold">{link.clickCount}</span>
                  <span className="text-xs"> / {link.uniqueCount} uniq</span>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={link.active}
                    aria-label={`${link.label} active`}
                    onChange={(event) => updateLocal(link.id, { active: event.target.checked })}
                  />
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => saveLink(link)}
                      className="text-app-fg text-xs font-semibold hover:underline"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(link.code)}
                      className="text-app-fg text-xs font-semibold hover:underline"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrFor(link)}
                      className="text-app-fg text-xs font-semibold hover:underline"
                    >
                      QR
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteLink(link.id)}
                      className="text-xs font-semibold text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {links.length === 0 && (
              <tr>
                <td colSpan={6} className="text-app-muted px-4 py-8 text-center">
                  No links yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {qrFor && <QrPanel link={qrFor} url={shortUrl(qrFor.code)} onClose={() => setQrFor(null)} />}
    </div>
  );
}

const QR_PRESETS = [
  { name: "Ink", fg: "#111110", accent: "#3f3f3a", bg: "#ffffff" },
  { name: "Lime", fg: "#111110", accent: "#7fb800", bg: "#ffffff" },
  { name: "Violet", fg: "#3b1e8f", accent: "#a855f7", bg: "#ffffff" },
  { name: "Cyan", fg: "#0b4f6c", accent: "#06b6d4", bg: "#ffffff" },
];

/**
 * The QR is an <img> pointing at /api/qr rather than an inline SVG, so the
 * browser caches it and "save image as" produces a file the user can drop
 * straight into a slide — which is the entire point of generating one here.
 */
function QrPanel({ link, url, onClose }: { link: ReferralLink; url: string; onClose: () => void }) {
  const [preset, setPreset] = useState(QR_PRESETS[1]);
  const [style, setStyle] = useState<"dots" | "squares">("dots");

  const src = useMemo(() => {
    const params = new URLSearchParams({
      data: url,
      size: "512",
      style,
      fg: preset.fg,
      accent: preset.accent,
      bg: preset.bg,
      logo: "SP",
    });
    return `/api/qr?${params.toString()}`;
  }, [url, style, preset]);

  return (
    <section className="border-app-line rounded-2xl border p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-app-fg text-sm font-bold">QR — {link.label}</h2>
          <p className="text-app-muted mt-1 font-mono text-xs break-all">{url}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-app-muted hover:text-app-fg text-xs font-semibold"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="border-app-line rounded-2xl border p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`QR code for ${link.label}`} width={200} height={200} />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-app-muted mb-2 text-xs font-semibold tracking-wide uppercase">
              Palette
            </p>
            <div className="flex gap-2">
              {QR_PRESETS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => setPreset(option)}
                  aria-pressed={preset.name === option.name}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    preset.name === option.name
                      ? "border-app-fg text-app-fg"
                      : "border-app-line text-app-muted"
                  }`}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-app-muted mb-2 text-xs font-semibold tracking-wide uppercase">
              Module shape
            </p>
            <div className="flex gap-2">
              {(["dots", "squares"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setStyle(option)}
                  aria-pressed={style === option}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${
                    style === option
                      ? "border-app-fg text-app-fg"
                      : "border-app-line text-app-muted"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <a
            href={src}
            download={`qr-${link.code}.svg`}
            className="bg-app-ink text-app-lime w-fit rounded-full px-4 py-2 text-xs font-bold"
          >
            Download SVG
          </a>
        </div>
      </div>
    </section>
  );
}
