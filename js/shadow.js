// js/shadow.js
//
// Geometría de la sombra lunar sobre la Tierra.
//
// Todo lo de aquí sale de las efemérides, no de ningún fichero de datos: el eje
// de la umbra es simplemente la recta Sol→Luna prolongada, y donde corta al
// elipsoide terrestre está el punto de máximo eclipse en ese instante. Recorrer
// el tiempo dibuja la línea central; el radio del cono en ese punto da la
// anchura de la franja.
//
// Consecuencia práctica: la franja de totalidad del mapa es COHERENTE con los
// tiempos que calcula eclipse.js, porque ambos beben de la misma fuente. Si en
// vez de esto cargásemos un GeoJSON externo, mapa y reloj podrían discrepar.

import {
  DEG, RAD, norm360,
  centuriesTT, julianDay, greenwichSiderealTime,
  sunPosition, moonPosition,
} from './astro.js';

const AU_KM = 149597870.7;
const EARTH_A = 6378.137;          // semieje ecuatorial (WGS84), km
const EARTH_F = 1 / 298.257223563; // achatamiento
const EARTH_B = EARTH_A * (1 - EARTH_F);
const SUN_RADIUS_KM = 696000;
// k2 = 0.272281, la constante que NASA e IGN usan para los contactos UMBRALES.
// Corresponde al limbo lunar medio, mientras que k1 = 0.272488 (algo mayor)
// se usa para los penumbrales porque incluye las montañas del limbo.
// La diferencia es de solo 1.4 km de radio lunar, pero como el radio del cono
// de umbra en el suelo es la pequeña diferencia entre dos cantidades grandes,
// ese 0.08% se amplifica a un ~3% en la anchura de la franja.
const MOON_RADIUS_KM = 0.272281 * 6378.14;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (v) => scale(v, 1 / norm(v));

/**
 * Vectores geocéntricos ecuatoriales (km) del Sol y la Luna, más el tiempo
 * sidéreo, para un instante dado.
 */
export function bodyVectors(date) {
  const jd = julianDay(date);
  const T = centuriesTT(jd);
  const s = sunPosition(T);
  const m = moonPosition(T);
  const toVec = (ra, dec, d) => [
    d * Math.cos(dec * DEG) * Math.cos(ra * DEG),
    d * Math.cos(dec * DEG) * Math.sin(ra * DEG),
    d * Math.sin(dec * DEG),
  ];
  return {
    sun: toVec(s.ra, s.dec, s.R * AU_KM),
    moon: toVec(m.ra, m.dec, m.dist),
    gst: greenwichSiderealTime(jd),
    sunDist: s.R * AU_KM,
    moonDist: m.dist,
  };
}

/**
 * Corta una semirrecta con el elipsoide terrestre.
 * Truco estándar: se escala el eje Z para que el elipsoide sea una esfera, se
 * resuelve la cuadrática, y se deshace la escala. Usar el elipsoide y no una
 * esfera importa: en latitudes altas (Groenlandia, Islandia) la diferencia de
 * 21 km entre semiejes desplaza la sombra decenas de km.
 *
 * @returns {number|null} parámetro t del primer corte, o null si no corta.
 */
function intersectEllipsoid(origin, dir) {
  const k = EARTH_A / EARTH_B;
  const o = [origin[0], origin[1], origin[2] * k];
  const d = [dir[0], dir[1], dir[2] * k];
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = 2 * (o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - EARTH_A * EARTH_A;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = t1 >= 0 ? t1 : t2;
  return t >= 0 ? t : null;
}

/** Vector geocéntrico ecuatorial → { lat, lon } geodésicos (grados). */
function vectorToGeodetic(v, gst) {
  const [x, y, z] = v;
  const lonInertial = Math.atan2(y, x) * RAD;
  const lon = ((lonInertial - gst + 540) % 360) - 180; // a longitud terrestre
  // Latitud geocéntrica → geodésica sobre el elipsoide.
  const p = Math.hypot(x, y);
  const latGeocentric = Math.atan2(z, p);
  const lat = Math.atan(Math.tan(latGeocentric) / (1 - EARTH_F) ** 2) * RAD;
  return { lat, lon };
}

/**
 * Corte del eje de sombra con la Tierra, sin calcular todavía la anchura de
 * franja (que necesita saber hacia dónde se mueve la sombra).
 */
function axisHit(date) {
  const { sun, moon, gst } = bodyVectors(date);

  // Dirección del eje de sombra: del Sol hacia la Luna, prolongada.
  const dir = unit(sub(moon, sun));
  const t = intersectEllipsoid(moon, dir);
  if (t === null) return null; // el eje pasa de largo: eclipse no central

  const hit = add(moon, scale(dir, t));
  const { lat, lon } = vectorToGeodetic(hit, gst);

  // Distancia del vértice del cono de umbra, medida desde la Luna.
  // Los rayos tangentes al Sol y a la Luna convergen a esa distancia; si la
  // Tierra está más cerca que el vértice, la umbra aún no se ha cerrado y el
  // eclipse es TOTAL; si está más lejos, el cono ya se cerró y vemos el anillo
  // (ANULAR).
  const sunMoonDist = norm(sub(moon, sun));
  const umbraVertexDist = (MOON_RADIUS_KM * sunMoonDist) / (SUN_RADIUS_KM - MOON_RADIUS_KM);
  const isTotal = t < umbraVertexDist;
  // Radio del cono en el punto de impacto (negativo tras el vértice → anular).
  const coneRadius = Math.abs(MOON_RADIUS_KM * (1 - t / umbraVertexDist));

  // Base local Este-Norte-Arriba en el punto de impacto, para expresar en él la
  // dirección del Sol.
  const lonI = Math.atan2(hit[1], hit[0]);
  const latG = Math.atan(Math.tan(Math.atan2(hit[2], Math.hypot(hit[0], hit[1]))) / (1 - EARTH_F) ** 2);
  const cl = Math.cos(lonI), sl = Math.sin(lonI);
  const cp = Math.cos(latG), sp = Math.sin(latG);
  const up = [cp * cl, cp * sl, sp];
  const east = [-sl, cl, 0];
  const north = [-sp * cl, -sp * sl, cp];

  const toSun = scale(dir, -1); // del punto hacia el Sol
  const sE = toSun[0] * east[0] + toSun[1] * east[1] + toSun[2] * east[2];
  const sN = toSun[0] * north[0] + toSun[1] * north[1] + toSun[2] * north[2];
  const sU = toSun[0] * up[0] + toSun[1] * up[1] + toSun[2] * up[2];

  const sunAlt = Math.asin(Math.max(-1, Math.min(1, sU))) * RAD;
  const sunAz = norm360(Math.atan2(sE, sN) * RAD);

  return { lat, lon, hit, gst, coneRadius, isTotal, sunAlt, sunAz, sinAlt: sU };
}

/**
 * Posición y tamaño de la sombra lunar sobre la Tierra en un instante.
 *
 * La ANCHURA merece explicación. La umbra es un cono de sección circular; al
 * proyectarse sobre el suelo con el Sol bajo se convierte en una elipse muy
 * alargada en la dirección del Sol (con el Sol a 7°, se estira ~8 veces). Pero
 * la "anchura de la franja" que publican NASA y el IGN no es ese eje mayor:
 * es la anchura de la banda barrida, medida PERPENDICULAR al avance de la
 * sombra. Y como al final del recorrido la sombra viaja casi en la misma
 * dirección en que se alarga, la franja se mantiene estrecha (~290 km) aunque
 * la mancha de sombra sea enorme.
 *
 * Medir el eje mayor en vez de la anchura perpendicular daba 890 km donde las
 * fuentes oficiales dan 294 km.
 *
 * @returns {null | {lat, lon, umbraRadiusKm, widthKm, type, sunAlt, sunAz}}
 */
export function shadowAxisPoint(date) {
  const h = axisHit(date);
  if (!h) return null;

  // Dirección de avance de la sombra, por diferencias finitas.
  const DT = 30000;
  const before = axisHit(new Date(date.getTime() - DT));
  const after = axisHit(new Date(date.getTime() + DT));
  const a = before ?? h, b = after ?? h;

  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(h.lat * DEG);
  let mE = (b.lon - a.lon) * kmPerDegLon;
  const mN = (b.lat - a.lat) * kmPerDegLat;
  if (Math.abs(b.lon - a.lon) > 180) mE = 0; // salto de antimeridiano
  const mLen = Math.hypot(mE, mN) || 1;
  const vE = mE / mLen, vN = mN / mLen;

  // Perpendicular al avance: la dirección en la que se mide la anchura.
  const wE = -vN, wN = vE;

  // Semiejes de la elipse de sombra: `b` perpendicular al Sol, `a` estirado
  // por 1/sen(altura) en la dirección del acimut solar.
  const sinAlt = Math.max(1e-4, Math.abs(h.sinAlt));
  const semiMinor = h.coneRadius;
  const semiMajor = h.coneRadius / sinAlt;

  // Direcciones de los ejes de la elipse sobre el suelo.
  const uE = Math.sin(h.sunAz * DEG), uN = Math.cos(h.sunAz * DEG);
  const pE = -uN, pN = uE;

  // Extensión de la elipse en la dirección w (fórmula de soporte).
  const projMajor = uE * wE + uN * wN;
  const projMinor = pE * wE + pN * wN;
  const halfWidth = Math.hypot(semiMajor * projMajor, semiMinor * projMinor);

  return {
    lat: h.lat,
    lon: h.lon,
    umbraRadiusKm: h.coneRadius,
    widthKm: 2 * halfWidth,
    type: h.isTotal ? 'total' : 'anular',
    sunAlt: h.sunAlt,
    sunAz: h.sunAz,
    hit: h.hit,
    gst: h.gst,
  };
}

/**
 * Recorre el tiempo y devuelve la LÍNEA CENTRAL del eclipse como GeoJSON.
 *
 * @param {string} isoDate
 * @param {number} stepSeconds resolución temporal
 */
export function centerlineGeoJSON(isoDate = '2026-08-12', stepSeconds = 120) {
  const t0 = Date.parse(`${isoDate}T00:00:00Z`);
  const coords = [];
  const props = [];

  for (let s = 0; s <= 86400; s += stepSeconds) {
    const p = shadowAxisPoint(new Date(t0 + s * 1000));
    if (!p) continue;
    coords.push([p.lon, p.lat]);
    props.push({ t: s, width: p.widthKm, sunAlt: p.sunAlt, type: p.type });
  }

  // Partir la línea donde cruce el antimeridiano, o MapLibre dibuja una raya
  // horizontal atravesando el mundo entero.
  const segments = [];
  let current = [];
  for (let i = 0; i < coords.length; i++) {
    if (i > 0 && Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(coords[i]);
  }
  if (current.length > 1) segments.push(current);

  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: segments },
    properties: { name: 'Línea central del eclipse', samples: props.length },
  };
}

/**
 * Límites norte y sur de la franja de totalidad, como polígono.
 *
 * Se obtienen desplazando la línea central perpendicularmente media anchura a
 * cada lado. Es una aproximación (el borde real se calcula con los conos
 * tangentes, no con una perpendicular), pero el error es de pocos km frente a
 * franjas de ~250 km, invisible a las escalas del mapa.
 */
export function totalityBandGeoJSON(isoDate = '2026-08-12', stepSeconds = 120) {
  const t0 = Date.parse(`${isoDate}T00:00:00Z`);
  const pts = [];
  for (let s = 0; s <= 86400; s += stepSeconds) {
    const p = shadowAxisPoint(new Date(t0 + s * 1000));
    if (p && p.type === 'total' && isFinite(p.widthKm)) pts.push(p);
  }
  if (pts.length < 2) return null;

  const north = [], south = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    // Rumbo local de la línea central.
    const dLon = (b.lon - a.lon) * Math.cos(pts[i].lat * DEG);
    const dLat = b.lat - a.lat;
    const len = Math.hypot(dLon, dLat) || 1;
    // Perpendicular, en grados, para media anchura de franja.
    const halfDeg = pts[i].widthKm / 2 / 111.32;
    const px = (-dLat / len) * halfDeg;
    const py = (dLon / len) * halfDeg;
    north.push([pts[i].lon + px / Math.cos(pts[i].lat * DEG), pts[i].lat + py]);
    south.push([pts[i].lon - px / Math.cos(pts[i].lat * DEG), pts[i].lat - py]);
  }

  const ring = [...north, ...south.reverse()];
  ring.push(ring[0]);

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { name: 'Franja de totalidad' },
  };
}

/**
 * Posición de la sombra restringida a la ventana en que cruza la Península,
 * útil para animar el mapa sin recorrer las 24 h.
 */
export function shadowTrack(fromISO, toISO, stepSeconds = 30) {
  const t0 = Date.parse(fromISO), t1 = Date.parse(toISO);
  const out = [];
  for (let t = t0; t <= t1; t += stepSeconds * 1000) {
    const p = shadowAxisPoint(new Date(t));
    if (p) out.push({ time: new Date(t), ...p });
  }
  return out;
}
