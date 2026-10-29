self.addEventListener("push", (event) => {
  const data = event.data?.json?.() ?? {};
  const title = data.title ?? "Keinsaas Navigator";
  const body = data.body ?? "An agent needs your attention.";
  const url = data.url ?? "/";
  const tag = data.tag ?? data.kind ?? "agent-alert";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/favicon.ico",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
  );
});
