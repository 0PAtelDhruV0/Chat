// Offline shell ONLY: no chats, invitations or signaling data are cached.
// Network-first ensures new deployment code is favored over stale code.
const CACHE = 'veyra-pulse-v5';
const FILES = ['./', './index.html','./style.css','./app.js','./protocol.js',
 './firebase-config.js','./firebase-signal.js','./ice-config.js','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin ||
      new URL(req.url).hash || !['document','script','style','image','manifest'].includes(req.destination)) return;
  event.respondWith(fetch(req).then(resp => {
    if (resp.ok) {const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy));}
    return resp;
  }).catch(() => caches.match(req)));
});
