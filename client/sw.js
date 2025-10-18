const CACHE = 'cafeduo-v1';
const ASSETS = [
  '/', '/index.html', '/css/styles.css', '/js/app.js', '/js/socket.js',
  '/js/games/refleks.js', '/js/games/aritmetik.js',
  '/manifest.webmanifest'
];
self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request))
  );
});
