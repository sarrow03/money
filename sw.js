// Офлайн-кэш оболочки приложения. Финансовые данные сюда не попадают (они в IndexedDB).
// При изменении файлов увеличивайте версию.
const CACHE = 'money-v10';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Сначала из кэша (мгновенно и офлайн), в фоне — обновление кэша.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});
