// service-worker.js
// PasswordMX — SW con versionado, offline y exclusiones de terceros.

const CACHE_VERSION = 'v7-2025-10-21'; // <-- súbelo en cada deploy
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const HTML_CACHE   = `html-${CACHE_VERSION}`;
const RUNTIME_CACHE= `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',                 // raiz
  '/index.html',
  '/faq.html',
  '/privacy.html',
  '/contacto.html',
  '/offline.html',     // fallback (asegúrate de tenerlo)
  '/favicon.png',
  '/icon-192.png',
  '/og-image.png',
  '/manifest.webmanifest'
];

// Dominios/paths que NO se deben cachear (ads/analytics, etc.)
const DENYLIST = [
  'https://pagead2.googlesyndication.com/',
  'https://googleads.g.doubleclick.net/',
  'https://adservice.google.com/',
  'https://tpc.googlesyndication.com/',
  'https://www.googletagservices.com/',
  'https://www.googletagmanager.com/',
  'https://plausible.io/',
];

// Helpers
const isDenied = (url) => DENYLIST.some(d => url.startsWith(d));
const isHTML   = (req) => req.destination === 'document' || (req.headers.get('accept')||'').includes('text/html');
const isLocal  = (url) => new URL(url, self.location).origin === self.location.origin;

// Instalación: pre-cache
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

// Activación: limpia versiones viejas
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => ![STATIC_CACHE, HTML_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Estrategias de fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // No cachear terceros sensibles (Ads/Plausible) ni peticiones no-GET
  if (request.method !== 'GET' || isDenied(url)) {
    return; // pasa directo a red
  }

  // HTML -> network-first (con fallback a caché y offline)
  if (isHTML(request)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(request, { cache: 'no-store' });
        const cache = await caches.open(HTML_CACHE);
        cache.put(request, net.clone());
        return net;
      } catch (err) {
        const cache = await caches.open(HTML_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        // offline fallback local
        const staticCache = await caches.open(STATIC_CACHE);
        return (await staticCache.match('/offline.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Assets locales (css/js/img) -> cache-first + SWR
  if (isLocal(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      const fetchAndUpdate = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);

      // Devuelve caché si existe, y de fondo revalida
      if (cached) {
        event.waitUntil(fetchAndUpdate);
        return cached;
      }
      // Si no hay caché, va a red y guarda
      const net = await fetchAndUpdate;
      return net || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // Otros (CDNs permitidos) -> network-first con fallback a caché
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      const cache = await caches.open(RUNTIME_CACHE);
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      return cached || new Response('Offline', { status: 503 });
    }
  })());
});
