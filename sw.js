/* ============================================================
   PRESENTISMO · LOS SOLES — Service Worker (v5.7)
   - La página se pide primero a internet; si en 4 segundos no
     responde, se abre la copia guardada (funciona sin señal).
   - Nunca se guarda una página de error como copia.
   - Los pedidos a la planilla (script.google.com) pasan directo.
   - NUEVO: reportes guardados sin señal → se envían solos cuando
     vuelve internet, aunque la app esté cerrada (Android/Chrome).
   Si cambiás íconos o el manifest, subí el número de VERSION.
   ============================================================ */
var VERSION = 'presentismo-v5.7';
var ESPERA_MS = 4000;
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
  if (req.method !== 'GET') return;                       // los envíos (POST) van directo
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Apps Script y otros sitios: sin intervenir

  if (req.mode === 'navigate') {
    var red = fetch(req).then(function (resp) {
      if (resp && resp.ok) {
        var copia = resp.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copia); });
      }
      return resp;
    });
    var guardada = function () {
      return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
    };
    var plazo = new Promise(function (ok) { setTimeout(ok, ESPERA_MS); }).then(guardada);
    e.respondWith(
      // Gana lo primero que llegue: internet (si responde rápido) o la copia guardada (a los 4 s)
      Promise.race([red, plazo]).then(function (r) { return r || red; })
        .catch(function () { return guardada().then(function (r) { return r || red; }); })
    );
    e.waitUntil(red.catch(function () {}));
    return;
  }

  e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
});

/* ---------- Envío de reportes guardados sin señal (Background Sync) ---------- */
function colaDB() {
  return new Promise(function (ok, mal) {
    var req = indexedDB.open('presentismo', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('cola', { keyPath: 'id' }); };
    req.onsuccess = function () { ok(req.result); };
    req.onerror = function () { mal(req.error); };
  });
}
function colaTx(modo, fn) {
  return colaDB().then(function (db) {
    return new Promise(function (ok, mal) {
      var tx = db.transaction('cola', modo), res = fn(tx.objectStore('cola'));
      tx.oncomplete = function () { ok(res && 'result' in res ? res.result : undefined); db.close(); };
      tx.onerror = function () { mal(tx.error); db.close(); };
    });
  });
}
function avisarPaginas(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage(msg); }); });
}
function enviarCola() {
  return colaTx('readonly', function (st) { return st.getAll(); }).then(function (lista) {
    var pendientes = (lista || []).filter(function (x) { return x.estado === 'pendiente'; });
    var faltan = false;
    var cadena = Promise.resolve();
    pendientes.forEach(function (item) {
      cadena = cadena.then(function () {
        return fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ accion: 'guardarRegistro', args: [item.envio] }),
          redirect: 'follow',
          credentials: 'omit'
        }).then(function (r) { return r.json(); }).then(function (j) {
          var r = j && j.ok ? j.data : { ok: false, reintentar: !!(j && j.reintentar), mensaje: j && j.error };
          if (r && r.ok) {
            return colaTx('readwrite', function (st) { st.delete(item.id); }).then(function () {
              return avisarPaginas({ tipo: 'cola-enviada', texto: item.vista.servicio + ' · ' + item.vista.turno + ' · ' + item.vista.fechaLinda });
            });
          }
          if (r && r.reintentar) { faltan = true; return; }
          item.estado = 'rechazado'; item.error = (r && r.mensaje) || 'No se pudo guardar.';
          return colaTx('readwrite', function (st) { st.put(item); }).then(function () { return avisarPaginas({ tipo: 'cola-cambio' }); });
        }).catch(function () { faltan = true; });
      });
    });
    return cadena.then(function () { if (faltan) throw new Error('Quedan reportes: el teléfono reintenta más tarde'); });
  });
}
self.addEventListener('sync', function (e) {
  if (e.tag === 'enviar-cola') e.waitUntil(enviarCola());
});
