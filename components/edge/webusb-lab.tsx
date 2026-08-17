"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * P23 — WebUSB.
 *
 * **Everything here is real and almost none of it will run for you**, which is
 * the honest shape of WebUSB and the reason it is worth showing rather than
 * describing. The API exists in Chromium only; Firefox declined to implement it
 * on the grounds that it is too dangerous to expose, and Safari has not shipped
 * it. It additionally requires a secure context and a user gesture, and the
 * browser mediates every device through a chooser the page cannot skip.
 *
 * That permission model is the interesting part. A page cannot enumerate what
 * is plugged in — `getDevices()` returns only devices the user has *already*
 * granted this origin, which on a first visit is an empty list. `requestDevice`
 * opens a native chooser, and the page learns nothing about anything the user
 * does not pick. So there is no fingerprinting surface and no silent access,
 * which is precisely why the spec is shaped this way and why the "list your
 * devices" demo everyone expects cannot exist.
 *
 * Nothing is claimed, opened, or transferred to. Reading a descriptor is where
 * this stops: sending bytes to an arbitrary interface is how you brick a device
 * belonging to someone reading a portfolio.
 */

interface DeviceInfo {
  name: string;
  vendorId: string;
  productId: string;
  serial: string | null;
  usbVersion: string;
  deviceClass: number;
  configurations: number;
}

type Support = "checking" | "supported" | "unsupported";

/** Minimal shape of the parts of the WebUSB API used here. */
interface UsbDeviceLike {
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  usbVersionMajor: number;
  usbVersionMinor: number;
  deviceClass: number;
  configurations: unknown[];
}

interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: unknown[] }): Promise<UsbDeviceLike>;
}

const hex = (value: number) => `0x${value.toString(16).padStart(4, "0")}`;

function describe(device: UsbDeviceLike): DeviceInfo {
  return {
    name:
      device.productName ||
      device.manufacturerName ||
      // A device with neither string descriptor is normal, not an error —
      // plenty of hardware simply does not populate them.
      `Unnamed device ${hex(device.vendorId)}:${hex(device.productId)}`,
    vendorId: hex(device.vendorId),
    productId: hex(device.productId),
    serial: device.serialNumber ?? null,
    usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
    deviceClass: device.deviceClass,
    configurations: device.configurations.length,
  };
}

/* Feature detection as an external store rather than a `useState` flipped in an
   effect — the same pattern components/nav/nav-drawer.tsx uses for its portal
   gate, and for the same two reasons. `navigator` does not exist during the
   server render, so the server snapshot has to be a third state rather than a
   guess; and setting state directly in an effect is what the compiler's
   set-state-in-effect rule rejects.

   Support cannot change during a session, so `subscribe` never fires. */
const subscribeToNothing = () => () => {};
const readSupport = (): Support =>
  (navigator as Navigator & { usb?: UsbLike }).usb ? "supported" : "unsupported";
const serverSupport = (): Support => "checking";

export function WebUsbLab() {
  const support = useSyncExternalStore(subscribeToNothing, readSupport, serverSupport);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
    if (!usb) return;

    // Previously-granted devices only. Empty on a first visit, and that is the
    // permission model working rather than a failure.
    usb
      .getDevices()
      .then((found) => setDevices(found.map(describe)))
      .catch(() => {
        /* A rejection here means no permissions have been granted. */
      });
  }, []);

  const choose = useCallback(async () => {
    const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
    if (!usb) return;

    setBusy(true);
    setMessage(null);
    try {
      // No filters: show everything and let the person decide. A filtered
      // chooser would be more polished and would quietly hide devices, which
      // for a demonstration of the permission model is the wrong lesson.
      const device = await usb.requestDevice({ filters: [] });
      setDevices((current) => {
        const info = describe(device);
        return current.some((entry) => entry.name === info.name && entry.serial === info.serial)
          ? current
          : [...current, info];
      });
    } catch (error) {
      // Dismissing the chooser throws NotFoundError. That is the ordinary
      // outcome of choosing not to share, not an error worth styling as one.
      const name = error instanceof Error ? error.name : "";
      setMessage(
        name === "NotFoundError"
          ? "No device selected — the chooser was dismissed. Nothing was shared with this page."
          : `The browser refused: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (support === "checking") {
    return <p className="edge-note">Checking for WebUSB…</p>;
  }

  if (support === "unsupported") {
    return (
      <div className="edge-panel" data-state="unsupported">
        <p className="edge-panel-state">WebUSB is not available in this browser</p>
        <p className="edge-note">
          Chromium only. Firefox declined to implement it — its position is that exposing arbitrary
          USB devices to web content is not a risk worth taking — and Safari has not shipped it.
          This is the majority outcome, and a demo that hid it behind a polyfilled fake would be
          teaching the wrong thing about the API.
        </p>
      </div>
    );
  }

  return (
    <div className="edge-panel" data-state="supported">
      <div className="edge-actions">
        <button type="button" className="edge-button" onClick={choose} disabled={busy}>
          {busy ? "Waiting for the chooser…" : "Choose a USB device"}
        </button>
        <span className="edge-note">
          {devices.length === 0
            ? "No devices granted to this origin yet."
            : `${devices.length} device${devices.length === 1 ? "" : "s"} shared with this page.`}
        </span>
      </div>

      {message ? <p className="edge-note">{message}</p> : null}

      {devices.length > 0 ? (
        <ul className="edge-devices">
          {devices.map((device) => (
            <li key={`${device.vendorId}:${device.productId}:${device.serial ?? "none"}`}>
              <p className="edge-device-name">{device.name}</p>
              <dl>
                <div>
                  <dt>Vendor</dt>
                  <dd>{device.vendorId}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{device.productId}</dd>
                </div>
                <div>
                  <dt>USB</dt>
                  <dd>{device.usbVersion}</dd>
                </div>
                <div>
                  <dt>Class</dt>
                  <dd>{device.deviceClass}</dd>
                </div>
                <div>
                  <dt>Configs</dt>
                  <dd>{device.configurations}</dd>
                </div>
                <div>
                  <dt>Serial</dt>
                  <dd>{device.serial ?? "—"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="edge-note">
        Descriptors only. Nothing is claimed, opened or written to — sending bytes to an interface
        on a stranger&rsquo;s hardware is how a demonstration bricks somebody&rsquo;s keyboard.
      </p>
    </div>
  );
}
