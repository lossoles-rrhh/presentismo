/* ============================================================
   PRESENTISMO · LOS SOLES — Service Worker (v5.0)
   Hace que la página se pueda INSTALAR como app en el celular/PC
   y que abra rápido aunque la señal sea mala.

   Reglas:
   - La página (index.html) se pide SIEMPRE primero a internet, así los
     supervisores ven la última versión apenas se publica. Si no hay
     señal, se muestra la copia guardada.
   - Íconos y manifest se sirven desde la copia guardada.
   - Los pedidos a la planilla (script.google.com) NO se tocan nunca:
     pasan directo a internet, sin guardar copias (nada de datos viejos
     ni reportes duplicados).

   Al publicar cambios en index.html no hace falta tocar este archivo.
   Si cambiás íconos o el manifest, subí el número de VERSION.
   ============================================================ */
var VERSION = 'presentismo-v5.4';
var ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(ARCHIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                         // los envíos (POST) van directo
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Apps Script y otros sitios: sin intervenir

  // Página: primero internet, si falla la copia guardada
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (resp) {
        var copia = resp.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copia); });
        return resp;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  // Íconos / manifest: primero la copia guardada
  e.respondWith(
    caches.match(req).then(function (r) { return r || fetch(req); })
  );
});
