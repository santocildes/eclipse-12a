// js/map.js — vista de mapa con relieve 3D y franja de totalidad.

import { CONFIG, TERRAIN, IGN, CARTO_POSITRON, maptilerStyleUrl } from './config.js';
import { centerlineGeoJSON, totalityBandGeoJSON, shadowTrack } from './shadow.js';
import { destinationPoint } from './terrain.js';
import { state, setLocation, locateMe, toast, cardinal, fmtTimeShort } from './app.js';

let map = null;
let marker = null;
let terrain3D = false;
let sunLineOn = false;
let basemapIdx = 0;

const BASEMAP_ORDER = ['relieve', 'ign', 'satelite'];

// ── Construcción del estilo ──────────────────────────────────────────────────
// Se arma a mano en vez de cargar un style.json remoto: así el fondo, el relieve
// y nuestras capas viven en la misma definición y no dependemos de que un
// proveedor externo esté disponible.

function buildStyle(kind) {
  const sources = {
    // Fuente de elevación: sirve a la vez para el sombreado y para el 3D.
    terrainDEM: {
      type: 'raster-dem',
      tiles: TERRAIN.tiles,
      encoding: TERRAIN.encoding,
      tileSize: TERRAIN.tileSize,
      maxzoom: TERRAIN.maxzoom,
      attribution: TERRAIN.attribution,
    },
  };
  const layers = [];

  if (kind === 'satelite') {
    sources.base = {
      type: 'raster', tiles: [IGN.pnoa], tileSize: 256, maxzoom: 19,
      attribution: IGN.attribution,
    };
  } else if (kind === 'ign') {
    sources.base = {
      type: 'raster', tiles: [IGN.base], tileSize: 256, maxzoom: 19,
      attribution: IGN.attribution,
    };
  } else {
    sources.base = {
      type: 'raster', tiles: CARTO_POSITRON.tiles, tileSize: 256, maxzoom: 19,
      attribution: CARTO_POSITRON.attribution,
    };
  }

  layers.push({ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1c' } });
  layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } });

  // Sombreado del relieve. Es la capa que hace visible de un vistazo dónde hay
  // montañas capaces de tapar un Sol que estará a 5-10° de altura.
  layers.push({
    id: 'hillshade', type: 'hillshade', source: 'terrainDEM',
    paint: {
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color': '#04070f',
      'hillshade-highlight-color': '#ffe9c4',
      // Iluminación desde el ONO (~285°), que es de donde vendrá la luz del Sol
      // durante el eclipse: las sombras del mapa se parecen a las reales.
      'hillshade-illumination-direction': 285,
      'hillshade-illumination-anchor': 'map',
    },
  });

  // Sin `glyphs`: ninguna capa propia dibuja texto (las etiquetas del mapa ya
  // vienen impresas en las teselas raster). Declarar un servidor de fuentes
  // remoto solo añadiría una dependencia de red que puede fallar en el campo.
  return { version: 8, sources, layers };
}

// ── Capas propias ────────────────────────────────────────────────────────────
// Se vuelven a añadir en cada `style.load`: cambiar de fondo recarga el estilo
// entero y borra todo lo que no forme parte de él.

function addEclipseLayers() {
  if (!map.getSource('banda')) {
    const band = totalityBandGeoJSON(CONFIG.eclipseDate, 60);
    map.addSource('banda', { type: 'geojson', data: band ?? emptyFC() });
  }
  if (!map.getSource('central')) {
    map.addSource('central', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [centerlineGeoJSON(CONFIG.eclipseDate, 60)] },
    });
  }
  if (!map.getSource('sunline')) {
    map.addSource('sunline', { type: 'geojson', data: emptyFC() });
  }
  if (!map.getSource('punto')) {
    map.addSource('punto', { type: 'geojson', data: emptyFC() });
  }

  if (!map.getLayer('banda-fill')) {
    map.addLayer({
      id: 'banda-fill', type: 'fill', source: 'banda',
      paint: { 'fill-color': '#8b6dff', 'fill-opacity': 0.22 },
    });
  }
  if (!map.getLayer('banda-line')) {
    map.addLayer({
      id: 'banda-line', type: 'line', source: 'banda',
      paint: { 'line-color': '#8b6dff', 'line-width': 1.5, 'line-opacity': 0.75 },
    });
  }
  if (!map.getLayer('central-line')) {
    map.addLayer({
      id: 'central-line', type: 'line', source: 'central',
      paint: {
        'line-color': '#c3b2ff', 'line-width': 2,
        'line-dasharray': [3, 2], 'line-opacity': 0.9,
      },
    });
  }
  if (!map.getLayer('sunline-line')) {
    map.addLayer({
      id: 'sunline-line', type: 'line', source: 'sunline',
      paint: { 'line-color': '#ffb238', 'line-width': 3, 'line-opacity': 0.85 },
    });
  }
  if (!map.getLayer('punto-halo')) {
    map.addLayer({
      id: 'punto-halo', type: 'circle', source: 'punto',
      paint: {
        'circle-radius': 13, 'circle-color': '#ffb238', 'circle-opacity': 0.22,
        'circle-stroke-width': 0,
      },
    });
    map.addLayer({
      id: 'punto-dot', type: 'circle', source: 'punto',
      paint: {
        'circle-radius': 6, 'circle-color': '#ffb238',
        'circle-stroke-width': 2, 'circle-stroke-color': '#0a0f1c',
      },
    });
  }

  applyTerrain();
  updateMarker();
  updateSunLine();
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

function applyTerrain() {
  if (terrain3D) {
    map.setTerrain({ source: 'terrainDEM', exaggeration: 1.4 });
    // El cielo en MapLibre 4.x se configura con setSky(), NO con una capa de
    // tipo "sky" (eso es de Mapbox GL; aquí el validador de estilo la rechaza).
    // Tonos cálidos de atardecer, que es la hora a la que ocurre el eclipse.
    map.setSky({
      'sky-color': '#1b2b52',
      'sky-horizon-blend': 0.6,
      'horizon-color': '#e8935a',
      'horizon-fog-blend': 0.55,
      'fog-color': '#20283f',
      'fog-ground-blend': 0.7,
    });
  } else {
    map.setTerrain(null);
  }
}

// ── Marcador y línea del Sol ─────────────────────────────────────────────────

function updateMarker() {
  const src = map?.getSource('punto');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [state.lon, state.lat] },
      properties: {},
    }],
  });
}

/**
 * Traza hacia dónde habrá que mirar. Con el Sol tan bajo, saber la dirección
 * exacta permite comprobar en el propio mapa qué hay delante: una sierra, un
 * pueblo, el mar.
 */
function updateSunLine() {
  const src = map?.getSource('sunline');
  if (!src) return;
  if (!sunLineOn || !state.circ?.visible) {
    src.setData(emptyFC());
    return;
  }
  const az = state.circ.max.sun.az;
  const pts = [[state.lon, state.lat]];
  for (let d = 5000; d <= 60000; d += 5000) {
    const p = destinationPoint(state.lat, state.lon, az, d);
    pts.push([p.lon, p.lat]);
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }],
  });
}

// ── API pública del módulo ───────────────────────────────────────────────────

export async function init() {
  if (map) return;

  map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(BASEMAP_ORDER[basemapIdx]),
    center: [state.lon, state.lat],
    zoom: CONFIG.initialView.zoom,
    maxZoom: 16,
    attributionControl: { compact: true },
    // El relieve pide inclinar la cámara; sin esto no se aprecia.
    maxPitch: 75,
  });

  // Sin NavigationControl: se solapaba con la cabecera y la columna de
  // herramientas de la derecha ya cubre zoom, 3D y centrado.
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

  map.on('style.load', addEclipseLayers);

  map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    setLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`, elevationGuess(e));
    document.getElementById('sheet').hidden = false;
  });

  // Botones flotantes
  document.getElementById('btn3d').addEventListener('click', (ev) => {
    terrain3D = !terrain3D;
    ev.currentTarget.classList.toggle('on', terrain3D);
    applyTerrain();
    map.easeTo({
      pitch: terrain3D ? 62 : 0,
      // El relieve no se aprecia desde muy alto: al activarlo, nos acercamos.
      zoom: terrain3D ? Math.max(map.getZoom(), 8.5) : map.getZoom(),
      duration: 900,
    });
    toast(terrain3D ? 'Relieve 3D activado' : 'Vista plana');
  });

  document.getElementById('btnBasemap').addEventListener('click', () => {
    basemapIdx = (basemapIdx + 1) % BASEMAP_ORDER.length;
    const kind = BASEMAP_ORDER[basemapIdx];
    // diff:false fuerza recarga completa del estilo → dispara style.load → se
    // vuelven a añadir nuestras capas. Con el diff por defecto, MapLibre las
    // borraría por no estar en el estilo nuevo y no volverían a aparecer.
    map.setStyle(buildStyle(kind), { diff: false });
    const nombres = { relieve: 'Relieve', ign: 'Mapa IGN', satelite: 'Ortofoto PNOA' };
    toast(nombres[kind]);
  });

  document.getElementById('btnLocate').addEventListener('click', async () => {
    try {
      await locateMe();
      flyToLocation();
    } catch { /* locateMe ya avisa */ }
  });

  document.getElementById('btnSunLine').addEventListener('click', (ev) => {
    sunLineOn = !sunLineOn;
    ev.currentTarget.classList.toggle('on', sunLineOn);
    document.getElementById('legendSun').hidden = !sunLineOn;
    updateSunLine();
    if (sunLineOn && state.circ?.visible) {
      const s = state.circ.max.sun;
      toast(`Mira al ${cardinal(s.az)} (${s.az.toFixed(0)}°), a ${s.alt.toFixed(1)}° de altura`);
    }
  });

  await new Promise((res) => map.once('load', res));
}

/** Acceso a la instancia del mapa para otros módulos (capa de nubes). */
export function getMap() { return map; }

export function onLocationChange() {
  updateMarker();
  updateSunLine();
}

export function flyToLocation() {
  map?.flyTo({ center: [state.lon, state.lat], zoom: Math.max(map.getZoom(), 10), duration: 900 });
}

export function resize() { map?.resize(); }

/**
 * Altitud aproximada del punto pulsado, leída del relieve ya cargado.
 * Si el 3D está activo MapLibre sabe la elevación; si no, se deja el valor
 * anterior y el módulo de horizonte la recalculará con precisión.
 */
function elevationGuess(e) {
  try {
    const el = map.queryTerrainElevation?.(e.lngLat);
    return typeof el === 'number' && isFinite(el) ? el : state.elev;
  } catch { return state.elev; }
}

/** Animación del paso de la umbra, para ver el recorrido de un vistazo. */
export function animateShadow() {
  const track = shadowTrack(
    `${CONFIG.eclipseDate}T17:00:00Z`, `${CONFIG.eclipseDate}T18:35:00Z`, 30,
  );
  if (!track.length) return;
  if (!map.getSource('umbra')) {
    map.addSource('umbra', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'umbra-fill', type: 'fill', source: 'umbra',
      paint: { 'fill-color': '#1a1030', 'fill-opacity': 0.55 },
    });
  }
  let i = 0;
  const step = () => {
    const p = track[i];
    map.getSource('umbra').setData(circlePolygon(p.lat, p.lon, p.umbraRadiusKm));
    i = (i + 1) % track.length;
    if (i > 0) requestAnimationFrame(() => setTimeout(step, 60));
  };
  step();
}

function circlePolygon(lat, lon, radiusKm, points = 48) {
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const p = destinationPoint(lat, lon, (360 / points) * i, radiusKm * 1000);
    coords.push([p.lon, p.lat]);
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }],
  };
}
