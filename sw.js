// sw.js — service worker.
//
// Prioridad de diseño: que la app ABRA Y CALCULE sin conexión. El día del
// eclipse habrá miles de personas en descampados con la red saturada, y ese es
// justo el momento en que hace falta consultar la hora del segundo contacto.
//
// Todo el cálculo astronómico es local, así que basta con cachear el código.
// Los datos externos (teselas, meteorología) se sirven de caché si están, pero
// nunca bloquean: si no hay red, la app funciona igual, solo que sin mapa nuevo.

const VERSION = 'eclipse-v1';
const NUCLEO = `${VERSION}-nucleo`;
const TESELAS = `${VERSION}-teselas`;
const DATOS = `${VERSION}-datos`;

// Lo imprescindible para arrancar y calcular. Si algo de esto falta, la app no
// abre — por eso se precachea entero en la instalación.
const ARCHIVOS_NUCLEO = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/app.js',
  './js/astro.js',
  './js/eclipse.js',
  './js/shadow.js',
  './js/config.js',
  './js/places.js',
  './js/terrain.js',
  './js/clouds.js',
  './js/map.js',
  './js/horizon-view.js',
  './js/clouds-view.js',
  './js/cloud-map.js',
  './js/ar.js',
  './js/orbit3d.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
];

const LIMITE_TESELAS = 600; // techo aproximado para no llenar el disco

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(NUCLEO);
    // Se añaden de una en una: si un recurso externo falla, no queremos que
    // reviente toda la instalación y la app se quede sin modo offline.
    await Promise.all(ARCHIVOS_NUCLEO.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] no se pudo cachear', url, err);
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(
      nombres.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function esTesela(url) {
  return url.hostname.includes('elevation-tiles-prod')
    || url.hostname.includes('basemaps.cartocdn.com')
    || url.hostname.includes('ign.es')
    || url.hostname.includes('api.maptiler.com');
}

function esMeteo(url) {
  return url.hostname.includes('open-meteo.com');
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ── Teselas: primero caché ──
  // Cambian poquísimo y son lo más pesado. Servirlas de caché hace que el mapa
  // aparezca al instante y que siga habiendo mapa sin cobertura.
  if (esTesela(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(TESELAS);
      const guardada = await cache.match(request);
      if (guardada) return guardada;
      try {
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') {
          cache.put(request, res.clone());
          podarCache(TESELAS, LIMITE_TESELAS);
        }
        return res;
      } catch {
        return guardada ?? Response.error();
      }
    })());
    return;
  }

  // ── Meteorología: primero red ──
  // Una previsión vieja es peor que ninguna, pero si no hay red se muestra la
  // última conocida (la vista avisa de la hora a la que corresponde).
  if (esMeteo(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATOS);
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        const guardada = await cache.match(request);
        if (guardada) return guardada;
        return new Response(
          JSON.stringify({ error: true, reason: 'sin conexión' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
    })());
    return;
  }

  // ── Resto (código propio y librerías): caché con revalidación ──
  // Responde al instante desde caché y actualiza por detrás, así una versión
  // nueva llega sin penalizar el arranque.
  e.respondWith((async () => {
    const cache = await caches.open(NUCLEO);
    const guardada = await cache.match(request, { ignoreSearch: true });
    const red = fetch(request)
      .then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    if (guardada) return guardada;
    const res = await red;
    if (res) return res;

    // Navegación sin caché ni red: se devuelve el index para que la app arranque.
    if (request.mode === 'navigate') {
      const idx = await cache.match('./index.html');
      if (idx) return idx;
    }
    return Response.error();
  })());
});

/** Recorta una caché a un número máximo de entradas (las más antiguas primero). */
async function podarCache(nombre, maximo) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  if (claves.length <= maximo) return;
  for (let i = 0; i < claves.length - maximo; i++) {
    await cache.delete(claves[i]);
  }
}
