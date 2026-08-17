/* Service worker: Web Push (P6) and offline (P23).
 *
 * P6 left this deliberately minimal — notification display and click routing,
 * no fetch handler, nothing cached — on the grounds that "offline caching would
 * be a separate, much more careful piece of work than notification delivery
 * needs". That was right, and P23 is that separate piece of work.
 *
 * THE RULE THAT GOVERNS EVERYTHING BELOW: a service worker is the only thing on
 * a website that can outlive a deploy. Get it wrong and visitors are served a
 * build that no longer exists, with no way to tell you, and no way for you to
 * fix it — because the fix is also served by the broken worker. Every decision
 * here is made to keep that impossible:
 *
 *   - HTML is NEVER served from cache while the network is reachable. A stale
 *     document referencing deleted JavaScript chunks is a white screen.
 *   - Only hashed build assets are cached long-term. Their filenames change on
 *     every deploy, so a stale entry is unreachable rather than wrong.
 *   - The cache name carries a version. Bumping it drops everything.
 *   - Anything not understood is passed straight through to the network.
 */

const VERSION = "v1";
const SHELL_CACHE = `sf-shell-${VERSION}`;
const ASSET_CACHE = `sf-assets-${VERSION}`;

/** The offline fallback document, precached at install. */
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every existing tab to
  // close; there is no old worker whose in-flight work we'd be disrupting.
  self.skipWaiting();

  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // `reload` bypasses the HTTP cache for this one fetch. Without it the
      // install can precache a copy the browser already had, which on a
      // redeploy means the offline page is the previous build's.
      cache.addAll([new Request(OFFLINE_URL, { cache: "reload" })]).catch((error) => {
        // A failed precache must not fail the install — the worker still has
        // push to deliver, and a missing offline page degrades to the
        // browser's own error page.
        console.warn("[sw] offline page precache failed", error);
      }),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from a previous version. This is what makes the
      // VERSION constant an actual kill switch rather than decoration.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("sf-") && !name.endsWith(VERSION))
          .map((name) => caches.delete(name)),
      );

      // Navigation preload lets the browser start the network request for a
      // navigation *in parallel* with booting this worker. Without it, every
      // navigation waits for worker startup first — which is how adding a
      // service worker makes a fast site slower.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      await self.clients.claim();
    })(),
  );
});

/* Local development, where `/_next/static/` filenames are NOT content-hashed.
 *
 * This was not a guess. With caching on, editing a component produced no
 * visible change: 34 dev chunks were in the cache, including
 * `app_edge_edge_1-yfgar.css` and the HMR client itself, and cache-first was
 * serving the versions from before the edit. Turbopack's dev chunk names are
 * stable across rebuilds — they identify the module, not its contents — so the
 * one assumption that makes cache-first safe in production is false here.
 *
 * Rather than not registering the worker in development, which would also
 * disable the offline shell and the outbox and make /edge untestable locally,
 * only the asset cache is switched off. Navigation, precache and the outbox all
 * behave exactly as they do in production.
 */
const IS_DEV = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);

/** Build output: content-hashed in production, so a cached copy is never wrong. */
function isHashedAsset(url) {
  if (IS_DEV) return false;
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/wasm/") ||
      url.pathname.startsWith("/workers/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET. A cached POST is meaningless, and intercepting one risks
  // replaying a payment or a form submission.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch these. The API is dynamic by definition; auth carries
  // session state; a cached /api/metrics would report a snapshot of the past
  // as the present.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Prefer the preloaded response when one exists, then the network.
          // NETWORK FIRST, ALWAYS, for documents — see the rule at the top.
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(request);
        } catch {
          // Genuinely offline. Serve the shell rather than the browser's
          // error page, and do not attempt to serve a cached copy of the
          // requested page — there isn't one, by design.
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ??
            new Response("Offline, and the offline page was not cached.", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        // Cache-first is safe here and nowhere else: these filenames contain a
        // content hash, so a hit is byte-identical to what the network would
        // return and a stale entry is simply never requested again.
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        // Only cache a real success. Caching an opaque or errored response
        // pins a failure for the lifetime of the cache version.
        if (response.ok && response.status === 200) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});

/* ------------------------------------------------------- offline outbox
 *
 * P23. A message written on a train is a message the visitor believes they
 * sent. Losing it to a failed fetch — and showing an error they cannot act on,
 * because acting requires signal — is the failure this exists to remove.
 *
 * The queue is IndexedDB rather than localStorage for one decisive reason: a
 * service worker has no access to localStorage at all. It is synchronous, and
 * workers are denied synchronous storage. IndexedDB is the only store both the
 * page and the worker can see.
 *
 * Background Sync fires this when connectivity returns, even if the tab has
 * been closed since. Where it is unsupported — every Safari, at time of
 * writing — lib/pwa/outbox.ts drains the same store on the next page load
 * instead. Same queue, weaker trigger, and the page says which one is in force
 * rather than claiming the stronger guarantee everywhere.
 */

const DB_NAME = "sf-offline";
const DB_VERSION = 1;
const STORE = "outbox";

function openDb() {
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

function readAll(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

function remove(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Send everything queued.
 *
 * A 4xx deletes the entry. That looks wrong and is deliberate: a 400 means the
 * server has read the payload and rejected it, so retrying sends the identical
 * bytes to the identical judgement forever, and the queue never drains. Only a
 * network failure or a 5xx is worth retrying, because only those might succeed
 * unchanged.
 */
async function drainOutbox() {
  const db = await openDb();
  const queued = await readAll(db);

  for (const item of queued) {
    try {
      const response = await fetch(item.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: item.body,
        // Same-origin only; the outbox never posts anywhere else.
        credentials: "same-origin",
      });

      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await remove(db, item.id);
      }
      // A 5xx is left in place for the next sync.
    } catch {
      // Still offline. Stop rather than burning through the rest of the queue
      // against a network that is plainly not there.
      break;
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "sf-outbox") event.waitUntil(drainOutbox());
});

// The page asks for a drain when Background Sync is unavailable.
self.addEventListener("message", (event) => {
  if (event.data === "sf-drain-outbox") event.waitUntil(drainOutbox());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Shivam Patil", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Shivam Patil";
  const options = {
    body: payload.body || "",
    icon: "/logo.jpeg",
    badge: "/logo.jpeg",
    tag: payload.tag || undefined,
    // Replace an existing notification with the same tag silently, so a burst
    // of chat messages doesn't re-buzz the device for each one.
    renotify: false,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Prefer focusing an already-open tab on this origin over opening a
      // duplicate one.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
