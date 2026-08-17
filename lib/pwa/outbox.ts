/**
 * P23 — the page's half of the offline outbox.
 *
 * Writes to the same IndexedDB store `public/sw.js` drains, and asks for a
 * drain by whichever mechanism the browser supports. Browser-only: every export
 * checks for its API and returns a useless-but-safe answer on the server, so
 * this can be imported from a component without a `typeof window` guard at
 * every call site.
 */

const DB_NAME = "sf-offline";
const DB_VERSION = 1;
const STORE = "outbox";
const SYNC_TAG = "sf-outbox";

export interface QueuedRequest {
  id?: number;
  url: string;
  body: string;
  queuedAt: number;
}

export function isSupported(): boolean {
  return typeof indexedDB !== "undefined" && "serviceWorker" in navigator;
}

/**
 * True when the browser will drain the queue on its own after the tab closes.
 *
 * The distinction is worth surfacing rather than smoothing over: with
 * Background Sync the visitor can close the tab and the message still sends;
 * without it — Safari, at time of writing — the queue drains on the next visit,
 * which may be never. Telling someone their message is queued means something
 * different in each case, so /edge states which is in force.
 */
export function hasBackgroundSync(): boolean {
  return (
    typeof ServiceWorkerRegistration !== "undefined" &&
    "sync" in ServiceWorkerRegistration.prototype
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Queue a request and ask for it to be sent as soon as there is a network. */
export async function enqueue(url: string, payload: unknown): Promise<boolean> {
  if (!isSupported()) return false;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const entry: QueuedRequest = { url, body: JSON.stringify(payload), queuedAt: Date.now() };
      transaction.objectStore(STORE).add(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await requestDrain();
    return true;
  } catch (error) {
    // Storage denied, or a private mode that refuses IndexedDB. The caller
    // shows the ordinary failure, which is honest: nothing was queued.
    console.error("[outbox] could not queue", error);
    return false;
  }
}

/** Which mechanism actually took responsibility for sending. */
export type DrainMechanism = "background-sync" | "message" | "none";

/**
 * Ask the worker to send.
 *
 * **Feature detection is not enough here, and that cost a real bug.** The first
 * version branched on `hasBackgroundSync()` and called `sync.register()` when
 * the API was present. In Chromium the API is present and `register()` still
 * throws `UnknownError: Background Sync is disabled` — the permission is
 * separately revocable, is off by default in several automation and
 * privacy-hardened configurations, and is denied outright when the origin has
 * low engagement. The throw was caught and logged, and the queue then drained
 * *never*, in exactly the browsers where the visitor had most reason to expect
 * it to.
 *
 * So the attempt is the detection. Background Sync is tried, and any failure
 * falls through to messaging the active worker — which only works while the tab
 * is open, and is therefore the weaker promise, but is enormously better than
 * silently doing nothing.
 */
export async function requestDrain(): Promise<DrainMechanism> {
  if (!isSupported()) return "none";

  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("[outbox] no service worker registration", error);
    return "none";
  }

  if (hasBackgroundSync()) {
    try {
      await (
        registration as ServiceWorkerRegistration & {
          sync: { register(tag: string): Promise<void> };
        }
      ).sync.register(SYNC_TAG);
      return "background-sync";
    } catch (error) {
      // Present but refused. Not an error worth surfacing — the fallback below
      // still sends — but worth a log line, because "the queue drains only
      // while the tab is open" is a different product than the one the API's
      // presence advertises.
      console.warn("[outbox] Background Sync refused, falling back to a direct message", error);
    }
  }

  const worker = registration.active;
  if (!worker) return "none";
  worker.postMessage("sf-drain-outbox");
  return "message";
}

/** How many requests are waiting. Read-only; the worker owns draining. */
export async function pending(): Promise<number> {
  if (!isSupported()) return 0;
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
}
