// Service worker de Socias MIA: guarda la "carcasa" de la app para que abra rápido como aplicación.
// Los datos de las socias NO se guardan aquí: siempre vienen de Supabase (hace falta conexión).
const CACHE = "mia-v1";
const SHELL = ["/", "/index.html", "/shim.js", "/config.js", "/vendor/supabase.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return; // Supabase y fuentes: siempre red
  // Red primero (para tener siempre la última versión); si no hay conexión, lo guardado.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.includes(u.pathname)) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match("/index.html"))));
});
