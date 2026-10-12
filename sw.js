/**
 * Service worker: hace que la app funcione sin conexión y se pueda instalar.
 *
 * Estrategias:
 *  - Página, JS y CSS: primero la red (para recibir cambios), y la copia guardada si no hay conexión.
 *  - Datos geográficos, librerías e íconos: la copia guardada al instante y se actualiza en segundo plano.
 *  - Teselas de relieve (Esri): copia guardada si existe; se limitan a MAX_TESELAS.
 *  - Supabase y cualquier otro servidor: sin intervenir (la sincronización necesita red real).
 *
 * Al publicar cambios grandes, sube VERSION para descartar la caché anterior.
 */
const VERSION = 'v2';
const CACHE_APP = `mi-colombia-app-${VERSION}`;
const CACHE_TESELAS = 'mi-colombia-teselas';
const MAX_TESELAS = 1500;

const ARCHIVOS = [
  './',
  'manifest.webmanifest',
  'css/estilos.css',
  'js/main.js',
  'js/config.js',
  'js/data.js',
  'js/storage.js',
  'js/fotos.js',
  'js/nube.js',
  'js/map.js',
  'js/geo.js',
  'js/capas.js',
  'js/colors.js',
  'js/logros.js',
  'js/compartir.js',
  'js/importar-externo.js',
  'js/export-png.js',
  'js/utils.js',
  'js/ui/aviso.js',
  'js/ui/buscador.js',
  'js/ui/compartir.js',
  'js/ui/cuenta.js',
  'js/ui/estadisticas.js',
  'js/ui/galeria.js',
  'js/ui/importacion.js',
  'js/ui/lista.js',
  'js/ui/lugar.js',
  'js/ui/pestanas.js',
  'js/ui/retos.js',
  'data/municipios.topo.json',
  'data/centros-poblados.json',
  'data/parques.topo.json',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet-heat.js',
  'vendor/topojson-client.min.js',
  'vendor/exifr.umd.js',
  'vendor/supabase.js',
  'icons/icono.svg',
  'icons/icono-180.png',
  'icons/icono-192.png',
  'icons/icono-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then((cache) => cache.addAll(ARCHIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves
        .filter((c) => c.startsWith('mi-colombia-app-') && c !== CACHE_APP)
        .map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

async function primeroRed(solicitud) {
  const cache = await caches.open(CACHE_APP);
  try {
    const respuesta = await fetch(solicitud);
    if (respuesta.ok) cache.put(solicitud, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(solicitud, { ignoreSearch: true })
      ?? (solicitud.mode === 'navigate' ? await cache.match('./') : undefined);
    if (guardada) return guardada;
    throw error;
  }
}

async function primeroCache(solicitud) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(solicitud, { ignoreSearch: true });
  const red = fetch(solicitud)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(solicitud, respuesta.clone());
      return respuesta;
    })
    .catch(() => undefined);
  return guardada ?? (await red) ?? Response.error();
}

async function tesela(solicitud) {
  const cache = await caches.open(CACHE_TESELAS);
  const guardada = await cache.match(solicitud);
  if (guardada) return guardada;
  const respuesta = await fetch(solicitud);
  if (respuesta.ok || respuesta.type === 'opaque') {
    await cache.put(solicitud, respuesta.clone());
    const claves = await cache.keys();
    for (const vieja of claves.slice(0, Math.max(0, claves.length - MAX_TESELAS))) await cache.delete(vieja);
  }
  return respuesta;
}

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'server.arcgisonline.com') {
    evento.respondWith(tesela(request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const esEstatico = /\/(data|vendor|icons)\//.test(url.pathname);
  evento.respondWith(esEstatico ? primeroCache(request) : primeroRed(request));
});
