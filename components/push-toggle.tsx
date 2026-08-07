"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type State = "checking" | "unsupported" | "disabled" | "denied" | "enabled" | "working";

/**
 * Web Push opt-in.
 *
 * Renders nothing at all when the server has no VAPID keys or the browser
 * can't do push — an inert toggle that silently fails is worse than no toggle.
 */
export function PushToggle() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }

      try {
        const response = await fetch("/api/push/subscribe");
        const { enabled } = (await response.json()) as { enabled: boolean };
        if (cancelled) return;
        if (!enabled) {
          setState("unsupported");
          return;
        }

        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }

        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setState(existing ? "enabled" : "disabled");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { publicKey } = (await (await fetch("/api/push/subscribe")).json()) as {
        publicKey: string;
      };

      const subscription = await registration.pushManager.subscribe({
        // Chrome refuses a subscription without this — a push you can't see
        // isn't allowed for web apps.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("save failed");

      setState("enabled");
      toast.success("Notifications on — you'll hear about replies.");
    } catch (error) {
      console.error("[push] enable failed:", error);
      setState("disabled");
      toast.error("Couldn't turn on notifications.");
    }
  }

  async function disable() {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("disabled");
      toast.success("Notifications off.");
    } catch {
      setState("enabled");
      toast.error("Couldn't turn notifications off.");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  if (state === "denied") {
    return (
      <p className="push-toggle-note">
        Notifications are blocked for this site in your browser settings.
      </p>
    );
  }

  const busy = state === "working";
  const on = state === "enabled";

  return (
    <button
      type="button"
      className={on ? "push-toggle is-on" : "push-toggle"}
      onClick={on ? disable : enable}
      disabled={busy}
      data-ripple
    >
      <span aria-hidden="true">{on ? "🔔" : "🔕"}</span>
      {busy ? "Working…" : on ? "Notifications on" : "Enable notifications"}
    </button>
  );
}
