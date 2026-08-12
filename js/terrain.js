// js/terrain.js
//
// Modelo del terreno y perfil de horizonte.
//
// Es el módulo que responde a la pregunta que de verdad importa el 12 de agosto:
// con el Sol a 5° sobre el horizonte, ¿hay algo delante que lo tape?
//
// Cómo funciona: se descargan teselas de elevación (AWS Terrain Tiles, sin
// clave), se lanzan rayos desde el observador en todas direcciones y para cada
// punto del rayo se calcula bajo qué ángulo se ve el terreno. El máximo de esos
// ángulos es la altura del horizonte en esa dirección. Si supera la altura del
// Sol, desde ahí no se ve el eclipse.
//
// Detalle que no se puede omitir a estas distancias: la curvatura terrestre.
// A 30 km, la superficie ya ha "caído" 63 m respecto a la horizontal del
// observador. Ignorarlo haría parecer más altas las montañas lejanas.

import { TERRAIN, decodeTerrarium } from './config.js';

const EARTH_R = 6371000;
// Radio efectivo con refracción atmosférica estándar (k≈0.13): los rayos de luz
// se curvan hacia el suelo, lo que permite "ver por encima" del horizonte
// geométrico. Es la convención usada en topografía y radioenlaces.
const EFFECTIVE_R = EARTH_R * 7 / 6;

const DEG = Math.PI / 180;

// --- Caché de teselas --------------------------------------------------------

const tileCache = new Map();   // "z/x/y" → Float32Array(256*256) | Promise
const failedTiles = new Set();

function tileKey(z, x, y) { return `${z}/${x}/${y}`; }

async function loadTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (tileCache.has(key)) return tileCache.get(key);
  if (failedTiles.has(key)) return null;

  const url = TERRAIN.tiles[0]
    .replace('{z}', z).replace('{x}', x).replace('{y}', y);

  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);

      // Guardar las dimensiones ANTES de cerrar el bitmap: close() libera los
      // recursos y deja width/height a 0, así que leerlas después produce un
      // array de alturas vacío y todo el perfil sale NaN sin dar ningún error.
      const ancho = bmp.width, alto = bmp.height;

      const canvas = new OffscreenCanvas(ancho, alto);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, ancho, alto);
      bmp.close();

      const heights = new Float32Array(ancho * alto);
      for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
        heights[i] = decodeTerrarium(data[p], data[p + 1], data[p + 2]);
      }
      const tile = { heights, size: ancho };
      tileCache.set(key, tile);
      return tile;
    } catch (err) {
      failedTiles.add(key);
      tileCache.delete(key);
      return null;
    }
  })();

  tileCache.set(key, promise);
  return promise;
}

// --- Conversión de coordenadas ----------------------------------------------

function lonLatToTileFraction(lon, lat, z) {
  const n = 2 ** z;
  const latRad = lat * DEG;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/**
 * Punto de destino a partir de un origen, un rumbo y una distancia
 * (fórmula esférica directa).
 */
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const d = distanceM / EARTH_R;
  const br = bearingDeg * DEG;
  const φ1 = lat * DEG, λ1 = lon * DEG;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2),
  );
  return { lat: φ2 / DEG, lon: ((λ2 / DEG + 540) % 360) - 180 };
}

// --- Muestreo de elevación ---------------------------------------------------

/**
 * Elevación en metros en un punto, con interpolación bilineal.
 * Devuelve null si la tesela no está cargada o falló la descarga.
 */
export function elevationAtSync(lat, lon, z) {
  const f = lonLatToTileFraction(lon, lat, z);
  const tx = Math.floor(f.x), ty = Math.floor(f.y);
  const tile = tileCache.get(tileKey(z, tx, ty));
  if (!tile || tile instanceof Promise) return null;

  const { heights, size } = tile;
  const px = (f.x - tx) * size, py = (f.y - ty) * size;
  const x0 = Math.min(size - 1, Math.max(0, Math.floor(px)));
  const y0 = Math.min(size - 1, Math.max(0, Math.floor(py)));
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const fx = px - x0, fy = py - y0;

  const h00 = heights[y0 * size + x0], h10 = heights[y0 * size + x1];
  const h01 = heights[y1 * size + x0], h11 = heights[y1 * size + x1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

/**
 * Carga las teselas que cubren un recuadro geográfico. Se usa para la capa de
 * sombras, que necesita el terreno de toda la pantalla y no de un disco.
 *
 * @returns {Promise<number>} fracción de teselas descargadas con éxito
 */
export async function ensureTilesForBBox(bbox, z, onProgress) {
  const { west, south, east, north } = bbox;
  const a = lonLatToTileFraction(west, north, z);
  const b = lonLatToTileFraction(east, south, z);
  const n = 2 ** z;

  const x0 = Math.floor(a.x), x1 = Math.floor(b.x);
  const y0 = Math.floor(a.y), y1 = Math.floor(b.y);

  const jobs = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue;
      jobs.push(loadTile(z, ((x % n) + n) % n, y));
    }
  }
  // Techo de seguridad: un recuadro enorme a zoom alto pediría miles de
  // teselas. El zoom ya se elige en función de la resolución, así que llegar
  // aquí significa que algo va mal.
  if (jobs.length > 400) {
    console.warn(`[terreno] ${jobs.length} teselas para el recuadro; se aborta`);
    return 0;
  }

  const res = await Promise.all(jobs);
  onProgress?.(0.6);
  return jobs.length ? res.filter(Boolean).length / jobs.length : 0;
}

/**
 * Recorre el rayo visual hacia el Sol y devuelve dónde deja de estar despejado.
 *
 * Sirve para pintar la línea de dirección del Sol en dos tramos: hasta el punto
 * donde el terreno se interpone, y a partir de ahí. Sin eso, la línea se dibuja
 * por encima del relieve y no dice nada sobre si ese relieve te va a tapar.
 *
 * @returns {Promise<{
 *   puntos: Array<{lat:number, lon:number, distM:number, bloqueado:boolean}>,
 *   distanciaBloqueoM: number|null, alturaHorizonte: number
 * }>}
 */
export async function sunRayProfile(lat, lon, azimut, sunAlt, opts = {}) {
  const { maxDistM = 60000, pasoM = 200, observerHeight = 1.6 } = opts;

  // Dos niveles como en el perfil de horizonte: el terreno cercano decide más.
  await ensureTilesAround(lat, lon, 6000, 13);
  await ensureTilesAround(lat, lon, maxDistM, 10);

  const base = elevationAtSync(lat, lon, 13) ?? elevationAtSync(lat, lon, 10) ?? 0;
  const ojo = base + observerHeight;

  const puntos = [];
  let maxAngulo = -90;
  let distanciaBloqueoM = null;

  for (let d = pasoM; d <= maxDistM; d += pasoM) {
    const p = destinationPoint(lat, lon, azimut, d);
    const z = d <= 6000
      ? (elevationAtSync(p.lat, p.lon, 13) ?? elevationAtSync(p.lat, p.lon, 10))
      : elevationAtSync(p.lat, p.lon, 10);
    if (z === null) continue;

    const caida = (d * d) / (2 * EFFECTIVE_R);
    const angulo = Math.atan2(z - ojo - caida, d) / DEG;
    if (angulo > maxAngulo) maxAngulo = angulo;

    // Una vez que el terreno acumulado supera la altura del Sol, todo lo que
    // venga después queda detrás del obstáculo: el bloqueo es permanente.
    const bloqueado = maxAngulo >= sunAlt;
    if (bloqueado && distanciaBloqueoM === null) distanciaBloqueoM = d;

    puntos.push({ lat: p.lat, lon: p.lon, distM: d, bloqueado });
  }

  return { puntos, distanciaBloqueoM, alturaHorizonte: maxAngulo };
}

/** Garantiza que estén cargadas todas las teselas de un disco alrededor de un punto. */
async function ensureTilesAround(lat, lon, radiusM, z) {
  const n = 2 ** z;
  const metersPerTile = (40075017 * Math.cos(lat * DEG)) / n;
  const span = Math.ceil(radiusM / metersPerTile) + 1;
  const c = lonLatToTileFraction(lon, lat, z);
  const cx = Math.floor(c.x), cy = Math.floor(c.y);

  const jobs = [];
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      if (dx * dx + dy * dy > (span + 0.5) ** 2) continue; // solo el disco
      const x = ((cx + dx) % n + n) % n;
      const y = cy + dy;
      if (y < 0 || y >= n) continue;
      jobs.push(loadTile(z, x, y));
    }
  }
  await Promise.all(jobs);
  return jobs.length;
}

// --- Perfil de horizonte -----------------------------------------------------

// Dos niveles de detalle. El terreno cercano decide mucho más que el lejano
// (un ribazo a 300 m tapa lo mismo que una montaña a 20 km), así que se muestrea
// fino de cerca y grueso de lejos, en vez de gastar el mismo presupuesto en todo.
const TIERS = [
  { z: 13, fromM: 30,    toM: 6000,  stepM: 25 },   // ~14 m/px
  { z: 10, fromM: 6000,  toM: 50000, stepM: 250 },  // ~110 m/px
];

/**
 * Calcula el perfil de horizonte alrededor de un punto.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {object} [opts]
 * @param {number[]} [opts.azimuths] direcciones a evaluar (grados desde el N).
 *   Por defecto, 360 (una por grado).
 * @param {number} [opts.observerHeight=1.6] altura de los ojos sobre el suelo.
 * @param {(p:number)=>void} [opts.onProgress]
 * @returns {Promise<{
 *   azimuths:number[], horizon:number[], distances:number[],
 *   observerElevation:number, coverage:number
 * }>}  horizon[i] = altura angular del horizonte (grados) en azimuths[i].
 */
export async function horizonProfile(lat, lon, opts = {}) {
  const {
    azimuths = Array.from({ length: 360 }, (_, i) => i),
    observerHeight = 1.6,
    onProgress,
  } = opts;

  // Cargar teselas de ambos niveles.
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    await ensureTilesAround(lat, lon, t.toM, t.z);
    onProgress?.((i + 1) / (TIERS.length + 1));
  }

  const baseElev = elevationAtSync(lat, lon, TIERS[0].z)
    ?? elevationAtSync(lat, lon, TIERS[1].z) ?? 0;
  const eyeElev = baseElev + observerHeight;

  const horizon = new Array(azimuths.length).fill(-90);
  const distances = new Array(azimuths.length).fill(0);
  let sampled = 0, missing = 0;

  for (let a = 0; a < azimuths.length; a++) {
    const az = azimuths[a];
    let maxAngle = -90, maxDist = 0;

    for (const tier of TIERS) {
      for (let d = tier.fromM; d <= tier.toM; d += tier.stepM) {
        const p = destinationPoint(lat, lon, az, d);
        const h = elevationAtSync(p.lat, p.lon, tier.z);
        sampled++;
        if (h === null) { missing++; continue; }

        // Caída por curvatura terrestre, corregida por refracción.
        const drop = (d * d) / (2 * EFFECTIVE_R);
        const angle = Math.atan2(h - eyeElev - drop, d) / DEG;
        if (angle > maxAngle) { maxAngle = angle; maxDist = d; }
      }
    }

    // Sin obstáculos, el horizonte queda por debajo de 0 por la propia curvatura
    // (el "abatimiento" del horizonte que se ve desde una montaña).
    horizon[a] = maxAngle;
    distances[a] = maxDist;
  }

  onProgress?.(1);

  return {
    azimuths,
    horizon,
    distances,
    observerElevation: baseElev,
    coverage: sampled ? 1 - missing / sampled : 0,
  };
}

/**
 * Altura del horizonte en un acimut concreto, interpolando el perfil.
 */
export function horizonAt(profile, azimuthDeg) {
  const az = ((azimuthDeg % 360) + 360) % 360;
  const { azimuths, horizon } = profile;
  // Perfil regular de 1° → índice directo.
  if (azimuths.length === 360) {
    const i0 = Math.floor(az), i1 = (i0 + 1) % 360;
    const f = az - i0;
    return horizon[i0] * (1 - f) + horizon[i1] * f;
  }
  let best = 0, bestD = Infinity;
  for (let i = 0; i < azimuths.length; i++) {
    const d = Math.abs(((azimuths[i] - az + 540) % 360) - 180);
    if (d < bestD) { bestD = d; best = i; }
  }
  return horizon[best];
}

/**
 * Veredicto de visibilidad: ¿tapa el terreno al Sol en ese momento?
 *
 * @returns {{blocked:boolean, horizonAlt:number, margin:number, obstacleDistanceM:number}}
 *   margin = grados que el Sol queda POR ENCIMA del horizonte (negativo = tapado)
 */
export function checkVisibility(profile, sunAz, sunAlt) {
  const hAlt = horizonAt(profile, sunAz);
  const idx = profile.azimuths.length === 360
    ? Math.round(((sunAz % 360) + 360) % 360) % 360
    : 0;
  return {
    blocked: sunAlt < hAlt,
    horizonAlt: hAlt,
    margin: sunAlt - hAlt,
    obstacleDistanceM: profile.distances[idx] ?? 0,
  };
}

/**
 * Busca un punto cercano con mejor horizonte, cuando el actual está tapado.
 * Explora una rejilla alrededor y devuelve los mejores candidatos.
 *
 * Solo mira la altura del TERRENO respecto a la dirección del Sol; no sabe de
 * caminos, accesos ni propiedad privada. Es una pista para explorar el mapa, no
 * una recomendación de a dónde conducir.
 */
export async function findBetterSpots(lat, lon, sunAz, sunAlt, opts = {}) {
  const { radiusKm = 8, samples = 5, onProgress } = opts;
  const results = [];
  const step = (radiusKm * 1000) / samples;

  const candidates = [];
  for (let i = 1; i <= samples; i++) {
    const ringCount = i * 6;
    for (let j = 0; j < ringCount; j++) {
      const az = (360 / ringCount) * j;
      candidates.push({ ...destinationPoint(lat, lon, az, step * i), distM: step * i });
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // Solo hace falta el horizonte en la dirección del Sol, no los 360°.
    const prof = await horizonProfile(c.lat, c.lon, {
      azimuths: [sunAz - 2, sunAz, sunAz + 2].map((a) => ((a % 360) + 360) % 360),
    });
    const worst = Math.max(...prof.horizon);
    results.push({
      lat: c.lat, lon: c.lon, distanceM: c.distM,
      horizonAlt: worst,
      margin: sunAlt - worst,
      elevation: prof.observerElevation,
    });
    onProgress?.((i + 1) / candidates.length);
  }

  return results.filter((r) => r.margin > 0).sort((a, b) => b.margin - a.margin);
}

/** Vacía la caché de teselas (para liberar memoria al cambiar de zona). */
export function clearTerrainCache() {
  tileCache.clear();
  failedTiles.clear();
}
