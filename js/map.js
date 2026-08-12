// js/map.js — vista de mapa con relieve 3D, franja de totalidad y sombras.

import { CONFIG, TERRAIN, IGN, CARTO_POSITRON } from './config.js';
import { centerlineGeoJSON, totalityBandGeoJSON } from './shadow.js';
import { destinationPoint, sunRayProfile } from './terrain.js';
import { computeShadowMask } from './terrain-shadow.js';
import { state, setLocation, locateMe, toast, cardinal } from './app.js';

let map = null;
let basemap = 'relieve';

// Estado de las capas. Vive aquí y no en el DOM para que el panel pueda
// reabrirse reflejando lo que hay puesto.
const capas = {
  banda: true,
  central: true,
  sol: false,
  sombras: false,
  relieve3D: false,
};

let sombrasPendiente = null;   // temporizador de recálculo
let sombrasCalculando = false;

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

  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1c' } },
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } },
    // Sombreado del relieve: hace visible de un vistazo dónde hay montañas
    // capaces de tapar un Sol que estará a 5-10° de altura.
    {
      id: 'hillshade', type: 'hillshade', source: 'terrainDEM',
      paint: {
        'hillshade-exaggeration': 0.55,
        'hillshade-shadow-color': '#04070f',
        'hillshade-highlight-color': '#ffe9c4',
        // Iluminación desde el ONO (~285°), de donde vendrá la luz durante el
        // eclipse: las sombras del mapa se parecen a las reales.
        'hillshade-illumination-direction': 285,
        'hillshade-illumination-anchor': 'map',
      },
    },
  ];

  // Sin `glyphs`: ninguna capa propia dibuja texto (las etiquetas ya vienen
  // impresas en las teselas raster), y declarar un servidor de fuentes remoto
  // solo añadiría una dependencia de red que puede fallar en el campo.
  return { version: 8, sources, layers };
}

// ── Capas propias ────────────────────────────────────────────────────────────
// Se vuelven a añadir en cada `style.load`: cambiar de fondo recarga el estilo
// entero y borra todo lo que no forme parte de él.

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

function addEclipseLayers() {
  if (!map.getSource('banda')) {
    map.addSource('banda', {
      type: 'geojson',
      data: totalityBandGeoJSON(CONFIG.eclipseDate, 60) ?? emptyFC(),
    });
  }
  if (!map.getSource('central')) {
    map.addSource('central', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [centerlineGeoJSON(CONFIG.eclipseDate, 60)] },
    });
  }
  if (!map.getSource('sunline')) map.addSource('sunline', { type: 'geojson', data: emptyFC() });
  if (!map.getSource('punto')) map.addSource('punto', { type: 'geojson', data: emptyFC() });

  const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };

  add({
    id: 'banda-fill', type: 'fill', source: 'banda',
    paint: { 'fill-color': '#8b6dff', 'fill-opacity': 0.22 },
  });
  add({
    id: 'banda-line', type: 'line', source: 'banda',
    paint: { 'line-color': '#8b6dff', 'line-width': 1.5, 'line-opacity': 0.75 },
  });
  add({
    id: 'central-line', type: 'line', source: 'central',
    paint: {
      'line-color': '#c3b2ff', 'line-width': 2,
      'line-dasharray': [3, 2], 'line-opacity': 0.9,
    },
  });

  // La línea del Sol se colorea por tramos: el color sale de una propiedad de
  // cada segmento, no de un valor fijo.
  add({
    id: 'sunline-line', type: 'line', source: 'sunline',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['get', 'bloqueado'], '#ff5c6e', '#ffb238'],
      'line-width': ['case', ['get', 'bloqueado'], 4, 3.5],
      'line-opacity': 0.92,
    },
  });

  add({
    id: 'punto-halo', type: 'circle', source: 'punto',
    paint: {
      'circle-radius': 13, 'circle-color': '#ffb238', 'circle-opacity': 0.22,
      'circle-stroke-width': 0,
    },
  });
  add({
    id: 'punto-dot', type: 'circle', source: 'punto',
    paint: {
      'circle-radius': 6, 'circle-color': '#ffb238',
      'circle-stroke-width': 2, 'circle-stroke-color': '#0a0f1c',
    },
  });

  aplicarVisibilidad();
  aplicarRelieve3D();
  updateMarker();
  updateSunLine();
  if (capas.sombras) programarSombras(0);
}

function aplicarVisibilidad() {
  const v = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  // Con las sombras puestas se acumulan dos tintes sobre el mismo relieve; la
  // franja cede algo de opacidad para que el terreno siga legible.
  if (map.getLayer('banda-fill')) {
    map.setPaintProperty('banda-fill', 'fill-opacity', capas.sombras ? 0.13 : 0.22);
  }
  v('banda-fill', capas.banda);
  v('banda-line', capas.banda);
  v('central-line', capas.central);
  v('sunline-line', capas.sol);
  v('sombras-img', capas.sombras);
}

function aplicarRelieve3D() {
  if (capas.relieve3D) {
    map.setTerrain({ source: 'terrainDEM', exaggeration: 1.4 });
    // El cielo en MapLibre 4.x se configura con setSky(), NO con una capa de
    // tipo "sky" (eso es de Mapbox GL; aquí el validador la rechaza).
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

// ── Marcador ─────────────────────────────────────────────────────────────────

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

// ── Línea de dirección del Sol ───────────────────────────────────────────────

let sunLineToken = 0;

/**
 * Traza hacia dónde hay que mirar, partiendo la línea donde el terreno se
 * interpone. Dibujarla de un solo color por encima del relieve no decía nada:
 * lo útil es ver a qué distancia empieza a estorbar una montaña.
 */
async function updateSunLine() {
  const src = map?.getSource('sunline');
  if (!src) return;
  if (!capas.sol || !state.circ?.visible) { src.setData(emptyFC()); return; }

  const az = state.circ.max.sun.az;
  const alt = state.circ.max.sun.alt;
  const token = ++sunLineToken;

  // Traza provisional en un solo tramo mientras llega el terreno, para que la
  // línea aparezca al instante y no parezca que el botón no ha hecho nada.
  const provisional = [[state.lon, state.lat]];
  for (let d = 5000; d <= 60000; d += 5000) {
    const p = destinationPoint(state.lat, state.lon, az, d);
    provisional.push([p.lon, p.lat]);
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: provisional },
      properties: { bloqueado: false },
    }],
  });

  let perfil;
  try {
    perfil = await sunRayProfile(state.lat, state.lon, az, alt);
  } catch {
    return; // sin terreno nos quedamos con la traza provisional
  }
  if (token !== sunLineToken || !map?.getSource('sunline')) return; // llegó otra petición

  // Dos tramos contiguos: despejado y tapado. Se comparte el punto de corte
  // para que no quede hueco entre ambos.
  const libres = [[state.lon, state.lat]];
  const tapados = [];
  for (const p of perfil.puntos) {
    if (!p.bloqueado) libres.push([p.lon, p.lat]);
    else {
      if (!tapados.length) tapados.push(libres[libres.length - 1]);
      tapados.push([p.lon, p.lat]);
    }
  }

  const features = [];
  if (libres.length > 1) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: libres },
      properties: { bloqueado: false },
    });
  }
  if (tapados.length > 1) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: tapados },
      properties: { bloqueado: true },
    });
  }
  map.getSource('sunline').setData({ type: 'FeatureCollection', features });

  if (perfil.distanciaBloqueoM !== null) {
    toast(`El relieve tapa el Sol a ${(perfil.distanciaBloqueoM / 1000).toFixed(1)} km`, 3600);
  }
}

// ── Capa de sombras ──────────────────────────────────────────────────────────

/**
 * Recalcula la máscara de sombra para lo que se ve en pantalla. Se difiere
 * para no rehacerla en cada fotograma mientras se arrastra el mapa.
 */
function programarSombras(retardo = 450) {
  clearTimeout(sombrasPendiente);
  sombrasPendiente = setTimeout(() => { recalcularSombras(); }, retardo);
}

async function recalcularSombras() {
  if (!capas.sombras || !map || sombrasCalculando) return;
  // Muy alejado, la sombra del relieve no aporta y el cálculo sería enorme.
  if (map.getZoom() < 6) {
    if (map.getLayer('sombras-img')) map.setLayoutProperty('sombras-img', 'visibility', 'none');
    toast('Acércate para ver las sombras del relieve');
    return;
  }

  sombrasCalculando = true;
  const barra = document.getElementById('sombrasProgress');
  const relleno = barra?.querySelector('.bar');
  if (barra) barra.hidden = false;

  try {
    const b = map.getBounds();
    const bbox = {
      west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(),
    };
    const res = await computeShadowMask(bbox, {
      size: 384,
      onProgress: (p) => { if (relleno) relleno.style.width = `${Math.round(p * 100)}%`; },
    });

    if (!capas.sombras || !map) return;

    const url = res.canvas.toDataURL('image/png');
    if (map.getSource('sombras')) {
      map.getSource('sombras').updateImage({ url, coordinates: res.coordinates });
    } else {
      map.addSource('sombras', { type: 'image', url, coordinates: res.coordinates });
      map.addLayer({
        id: 'sombras-img', type: 'raster', source: 'sombras',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 },
      }, 'banda-fill');
    }
    map.setLayoutProperty('sombras-img', 'visibility', 'visible');

    if (res.cobertura < 0.5) toast('Faltan datos de relieve en parte de la vista');
  } catch (err) {
    console.error(err);
    toast(`No se pudieron calcular las sombras: ${err.message}`);
  } finally {
    sombrasCalculando = false;
    if (barra) barra.hidden = true;
    if (relleno) relleno.style.width = '0';
  }
}

// ── Orientación hacia el Sol ─────────────────────────────────────────────────

/**
 * Gira el mapa para que la dirección del Sol quede hacia arriba de la pantalla.
 * Es lo que hace uno instintivamente con un mapa de papel: orientarlo con lo
 * que busca al frente. Así el relieve que aparece arriba es, literalmente, el
 * que tendrás delante.
 */
function orientarHaciaElSol() {
  if (!state.circ?.visible) return;
  map.easeTo({ bearing: state.circ.max.sun.az, duration: 900 });
  document.getElementById('btnNorte').hidden = false;
}

function volverAlNorte() {
  map.easeTo({ bearing: 0, duration: 700 });
  document.getElementById('btnNorte').hidden = true;
}

// ── Panel de capas ───────────────────────────────────────────────────────────

function cablearPanel() {
  const dlg = document.getElementById('layersDialog');

  document.getElementById('btnLayers').addEventListener('click', () => {
    // Reflejar el estado real antes de abrir.
    document.querySelector(`input[name="basemap"][value="${basemap}"]`).checked = true;
    document.getElementById('lyBanda').checked = capas.banda;
    document.getElementById('lyCentral').checked = capas.central;
    document.getElementById('lySol').checked = capas.sol;
    document.getElementById('lySombras').checked = capas.sombras;
    document.getElementById('ly3D').checked = capas.relieve3D;
    dlg.showModal();
  });

  document.querySelectorAll('input[name="basemap"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      basemap = r.value;
      // diff:false fuerza recarga completa del estilo → dispara style.load → se
      // vuelven a añadir nuestras capas. Con el diff por defecto, MapLibre las
      // borraría por no estar en el estilo nuevo y no volverían a aparecer.
      map.setStyle(buildStyle(basemap), { diff: false });
    });
  });

  const alternar = (id, clave, alCambiar) => {
    document.getElementById(id).addEventListener('change', (e) => {
      capas[clave] = e.target.checked;
      alCambiar?.(e.target.checked);
      aplicarVisibilidad();
    });
  };

  alternar('lyBanda', 'banda');
  alternar('lyCentral', 'central');

  alternar('lySol', 'sol', (on) => {
    updateSunLine();
    if (on) {
      orientarHaciaElSol();
      const s = state.circ?.max?.sun;
      if (s) toast(`Mira al ${cardinal(s.az)} (${s.az.toFixed(0)}°), a ${s.alt.toFixed(1)}° de altura`);
    } else {
      volverAlNorte();
    }
  });

  alternar('lySombras', 'sombras', (on) => {
    if (on) programarSombras(0);
    else if (map.getLayer('sombras-img')) {
      map.setLayoutProperty('sombras-img', 'visibility', 'none');
    }
  });

  alternar('ly3D', 'relieve3D', (on) => {
    aplicarRelieve3D();
    map.easeTo({
      pitch: on ? 62 : 0,
      // El relieve no se aprecia desde muy alto: al activarlo, nos acercamos.
      zoom: on ? Math.max(map.getZoom(), 8.5) : map.getZoom(),
      duration: 900,
    });
  });
}

// ── API pública del módulo ───────────────────────────────────────────────────

export async function init() {
  if (map) return;

  map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(basemap),
    center: [state.lon, state.lat],
    zoom: CONFIG.initialView.zoom,
    maxZoom: 16,
    attributionControl: { compact: true },
    // El relieve pide inclinar la cámara; sin esto no se aprecia.
    maxPitch: 75,
  });

  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

  map.on('style.load', addEclipseLayers);

  map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    setLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`, elevationGuess(e));
    document.getElementById('mapHint')?.setAttribute('hidden', '');
  });

  // Las sombras dependen de lo que se ve, así que se rehacen al mover.
  map.on('moveend', () => { if (capas.sombras) programarSombras(); });
  // Si el usuario gira el mapa a mano, el botón de norte debe aparecer.
  map.on('rotateend', () => {
    document.getElementById('btnNorte').hidden = Math.abs(map.getBearing()) < 1;
  });

  document.getElementById('btnLocate').addEventListener('click', async () => {
    try { await locateMe(); flyToLocation(); } catch { /* locateMe ya avisa */ }
  });
  document.getElementById('btnNorte').addEventListener('click', volverAlNorte);

  cablearPanel();

  await new Promise((res) => map.once('load', res));
}

/** Acceso a la instancia del mapa para otros módulos (capa de nubes). */
export function getMap() { return map; }

export function onLocationChange() {
  updateMarker();
  updateSunLine();
  document.getElementById('mapHint')?.setAttribute('hidden', '');
  if (capas.sombras) programarSombras();
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
