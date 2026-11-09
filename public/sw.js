/* AutomatePal service worker: shows push notifications for the team inbox and opens the ticket on tap.
   It does not cache pages or intercept requests. Notifications carry no visitor text (lib/push-notify.ts). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const url = typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') ? d.url : '/tickets';
  const title = typeof d.title === 'string' ? d.title.slice(0, 120) : 'AutomatePal';
  const body = typeof d.body === 'string' ? d.body.slice(0, 200) : '';
  e.waitUntil(self.registration.showNotification(title, {body, tag: typeof d.tag === 'string' ? d.tag : 'automatepal', renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data: {url}}));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || '/tickets', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
