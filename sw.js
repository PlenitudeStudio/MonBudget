// Service worker : met l'application en cache pour qu'elle marche hors ligne.
const CACHE = 'monbudget-v7';
const FONTS = 'monbudget-fonts';
const FILES = ['./', './index.html', './styles.css', './plan.js', './stats.js', './csv.js', './lock.js', './app.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Polices Google : cache d'abord (elles ne changent pas), pour l'affichage hors ligne
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(FONTS).then((c) =>
        c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; }))
      )
    );
    return;
  }
  if (url.origin !== location.origin) return;

  // Réseau d'abord (pour recevoir les mises à jour), cache en secours hors ligne.
  e.respondWith(
    // no-cache : revalide auprès du serveur pour recevoir les mises à jour sans délai
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
