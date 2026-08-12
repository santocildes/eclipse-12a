// js/config.js
//
// ÚNICO punto que conoce claves, endpoints y URLs externas. Todo lo demás lee
// de aquí. Cambiar de proveedor de teselas o de CDN es tocar este archivo, no
// diez componentes.
//
// DECISIÓN DE DISEÑO: la app funciona SIN NINGUNA API KEY.
// El relieve sale de AWS Terrain Tiles (dominio público, CORS abierto, sin
// registro) y los fondos de MapTiler son opcionales — si no hay clave, se cae a
// un fondo sin clave. Esto importa porque la app se usa en el campo, con mala
// cobertura y sin poder configurar nada: cuantas menos dependencias con puerta,
// mejor.

// La clave de MapTiler es OPCIONAL. Se puede inyectar de tres formas, en orden
// de prioridad; sin ninguna, la app sigue funcionando con fondos abiertos.
function readMaptilerKey() {
  if (typeof window === 'undefined') return '';
  return (
    window.__MAPTILER_KEY__ ||                       // 1. <script> en index.html
    localStorage.getItem('maptiler_key') ||          // 2. ajustes de la app
    new URLSearchParams(location.search).get('key') || // 3. ?key= para pruebas
    ''
  );
}

const MAPTILER_KEY = readMaptilerKey();

export const CONFIG = {
  maptilerKey: MAPTILER_KEY,
  hasMaptilerKey: MAPTILER_KEY.length > 0,

  // Ventana del eclipse
  eclipseDate: '2026-08-12',
  // Franja horaria peninsular en agosto (CEST = UTC+2). Se usa solo para
  // MOSTRAR horas; todo el cálculo interno va en UTC.
  displayTimezone: 'Europe/Madrid',

  // Encuadre inicial: norte de la Península, centrado en la franja.
  initialView: { center: [-4.0, 42.4], zoom: 5.6 },
};

// --- Modelo digital del terreno ---------------------------------------------
// AWS Terrain Tiles ("Terrarium"), derivado de SRTM/NED y otros. Resolución
// ~30 m, cobertura mundial, sin clave y con CORS abierto.
//
// Codificación Terrarium:  altura_m = (R*256 + G + B/256) − 32768
// OJO: NO es la misma que Terrain-RGB de Mapbox/MapTiler. MapLibre distingue
// ambas con `encoding: 'terrarium'`.
export const TERRAIN = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 14,
  attribution:
    '<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>',
};

/** Decodifica un píxel Terrarium a metros sobre el nivel del mar. */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

// --- Fondos de mapa ----------------------------------------------------------
// Todos los que no llevan clave están verificados como CORS-abiertos.
export const BASEMAPS = {
  relieve: {
    label: 'Relieve',
    needsKey: false,
    style: 'carto-positron',
    description: 'Fondo claro y neutro: el relieve 3D se lee mejor',
  },
  satelite: {
    label: 'Satélite (PNOA)',
    needsKey: false,
    style: 'ign-pnoa',
    description: 'Ortofoto del IGN — solo cubre España',
  },
  ign: {
    label: 'Mapa IGN',
    needsKey: false,
    style: 'ign-base',
    description: 'Cartografía oficial del Instituto Geográfico Nacional',
  },
  maptiler: {
    label: 'MapTiler exterior',
    needsKey: true,
    style: 'outdoor-v2',
    description: 'Requiere clave de MapTiler',
  },
};

export function maptilerStyleUrl(style) {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`;
}

// Servicios del IGN. Verificados en directo: responden con CORS abierto y sin
// clave. Son cartografía oficial española, lo que da autoridad al mapa.
export const IGN = {
  pnoa:
    'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0' +
    '&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg' +
    '&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
  base:
    'https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0' +
    '&layer=IGNBaseTodo&style=default&format=image/png' +
    '&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
  attribution: '<a href="https://www.ign.es/">IGN</a> — CC BY 4.0',
};

export const CARTO_POSITRON = {
  tiles: [
    'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  ],
  attribution: '&copy; OSM, &copy; CARTO',
};

// --- Meteorología ------------------------------------------------------------
// Open-Meteo: sin clave, CORS abierto, admite varios puntos por petición
// (latitude=a,b,c) — clave para dibujar una rejilla de nubes con pocas llamadas.
export const WEATHER = {
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  // El modelo solo predice a 16 días vista. Más allá, la app debe decirlo
  // claramente en vez de mostrar una previsión inventada.
  maxForecastDays: 16,
};

// --- Librerías externas ------------------------------------------------------
// Versiones fijadas: un cambio silencioso de versión en un CDN rompiendo la app
// el día del eclipse sería el peor momento posible.
export const VENDOR = {
  maplibre: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  maplibreCss: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  three: 'https://unpkg.com/three@0.160.0/build/three.module.js',
};
