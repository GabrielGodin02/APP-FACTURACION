// Service worker: cachea el "cascarón" de la app para abrir rápido y sin conexión.
// Las llamadas a Supabase/Wompi NUNCA se cachean (datos siempre en vivo).
const VERSION = "bs-v2";
const SHELL = [
  "./", "./index.html", "./style.css", "./script.js", "./app-mobile.js", "./app-mobile.css", "./supabase.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(CDN.map(u => fetch(u, { mode: "no-cors" }).then(r => c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("wompi.co")) return; // siempre red

  // Archivos propios: red primero (así las actualizaciones llegan), caché como respaldo
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r;
      }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }
  // Librerías CDN: caché primero
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
