/* Service worker for Web Push.
 *
 * Deliberately minimal: this handles notification display and click routing
 * only. It installs no fetch handler and caches nothing, so it cannot serve a
 * stale build — offline caching would be a separate, much more careful piece
 * of work than notification delivery needs.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every existing tab to
  // close; there is no old worker whose in-flight work we'd be disrupting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
