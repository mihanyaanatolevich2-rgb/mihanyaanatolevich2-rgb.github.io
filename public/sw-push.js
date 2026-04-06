// Service Worker for Push Notifications
self.addEventListener('push', (event) => {
  let data = { title: 'Новое сообщение', body: '', data: {} };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('Push parse error:', e);
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    tag: data.data?.conversation_id || 'general',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const conversationId = event.notification.data?.conversation_id;
  const url = conversationId ? `/?chat=${conversationId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'OPEN_CHAT', conversationId });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
