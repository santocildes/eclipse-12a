// js/eclipse.js
//
// Circunstancias locales del eclipse para un observador concreto.
//
// Método: se calculan los vectores TOPOCÉNTRICOS (desde el observador, no desde
// el centro de la Tierra) del Sol y de la Luna, y se sigue su separación angular
// a lo largo del día. De ahí salen los contactos, el máximo, la magnitud y la
// obscuración. Trabajar con vectores en vez de con las fórmulas de paralaje de
// Meeus 40 es más limpio: la misma resta da a la vez la dirección aparente y la
// distancia topocéntrica, y esa distancia es la que fija el semidiámetro (por la
// que la Luna se ve ~2% mayor en el cénit que en el horizonte, diferencia que
// decide si un eclipse es total o anular en el límite).

import {
  DEG, RAD, norm360,
  centuriesTT, julianDay, dateFromJD, greenwichSiderealTime,
  sunPosition, moonPosition, equatorialToHorizontal, refraction,
} from './astro.js';

const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6378.14;
const SUN_RADIUS_KM = 696000;
// k = 0.2725076 (radio lunar / radio ecuatorial terrestre), valor IAU estándar
// para eclipses. Espenak usa 0.2722810 para los contactos umbrales; la
// diferencia son ~0.3 s en los tiempos, irrelevante aquí.
const MOON_RADIUS_KM = 0.2725076 * EARTH_RADIUS_KM;

/** Fecha del eclipse total de Sol visible desde España. */
export const ECLIPSE_DATE = '2026-08-12';

/**
 * Vector geocéntrico del observador, en el sistema ecuatorial (km).
 */
function observerVector(lat, lon, elev, gst) {
  const u = Math.atan(0.99664719 * Math.tan(lat * DEG));
  const rhoSinPhi = 0.99664719 * Math.sin(u) + (elev / 6378140) * Math.sin(lat * DEG);
  const rhoCosPhi = Math.cos(u) + (elev / 6378140) * Math.cos(lat * DEG);
  const lst = (gst + lon) * DEG; // tiempo sidéreo local
  return [
    rhoCosPhi * EARTH_RADIUS_KM * Math.cos(lst),
    rhoCosPhi * EARTH_RADIUS_KM * Math.sin(lst),
    rhoSinPhi * EARTH_RADIUS_KM,
  ];
}

/** Coordenadas ecuatoriales + distancia → vector rectangular (km). */
function toVector(ra, dec, dist) {
  const cd = Math.cos(dec * DEG);
  return [dist * cd * Math.cos(ra * DEG), dist * cd * Math.sin(ra * DEG), dist * Math.sin(dec * DEG)];
}

/** Vector rectangular → { ra, dec, dist }. */
function fromVector([x, y, z]) {
  const dist = Math.hypot(x, y, z);
  return {
    ra: norm360(Math.atan2(y, x) * RAD),
    dec: Math.asin(z / dist) * RAD,
    dist,
  };
}

/**
 * Área de solapamiento de dos círculos (radios r1, r2; separación de centros d),
 * en las mismas unidades al cuadrado. Se usa para la obscuración: qué FRACCIÓN
 * DE SUPERFICIE del Sol está tapada, que no es lo mismo que la magnitud (que es
 * fracción de DIÁMETRO). Con magnitud 0.5 solo está tapado un 39% de la luz —
 * de ahí que un parcial del 90% siga siendo de día claro.
 */
function circleOverlapArea(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const a3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 + a2 - a3;
}

/**
 * Estado instantáneo del eclipse visto desde un punto.
 *
 * @param {Date} date
 * @param {{lat:number, lon:number, elev?:number}} obs
 * @returns estado completo: posiciones topocéntricas, separación, semidiámetros,
 *   magnitud, obscuración, altura/acimut del Sol y desplazamiento aparente de la
 *   Luna respecto al Sol (para dibujar la fase correctamente orientada).
 */
export function eclipseState(date, obs) {
  const { lat, lon, elev = 0 } = obs;
  const jd = julianDay(date);
  const T = centuriesTT(jd);
  const gst = greenwichSiderealTime(jd);

  const sunGeo = sunPosition(T);
  const moonGeo = moonPosition(T);

  const o = observerVector(lat, lon, elev, gst);
  const sVec = toVector(sunGeo.ra, sunGeo.dec, sunGeo.R * AU_KM);
  const mVec = toVector(moonGeo.ra, moonGeo.dec, moonGeo.dist);

  const sTopo = fromVector([sVec[0] - o[0], sVec[1] - o[1], sVec[2] - o[2]]);
  const mTopo = fromVector([mVec[0] - o[0], mVec[1] - o[1], mVec[2] - o[2]]);

  // Semidiámetros aparentes (grados) a la distancia topocéntrica.
  const sunSD = Math.asin(SUN_RADIUS_KM / sTopo.dist) * RAD;
  const moonSD = Math.asin(MOON_RADIUS_KM / mTopo.dist) * RAD;

  // Separación angular entre centros.
  const cosSep =
    (Math.cos(sTopo.dec * DEG) * Math.cos(mTopo.dec * DEG) *
      Math.cos((sTopo.ra - mTopo.ra) * DEG)) +
    Math.sin(sTopo.dec * DEG) * Math.sin(mTopo.dec * DEG);
  const sep = Math.acos(Math.min(1, Math.max(-1, cosSep))) * RAD;

  // Magnitud: fracción del DIÁMETRO solar cubierta. >=1 → total (si moonSD>sunSD).
  const magnitude = Math.max(0, (sunSD + moonSD - sep) / (2 * sunSD));
  const obscuration =
    circleOverlapArea(sunSD, moonSD, sep) / (Math.PI * sunSD * sunSD);

  const sunHz = equatorialToHorizontal(sTopo.ra, sTopo.dec, lat, lon, gst);
  const moonHz = equatorialToHorizontal(mTopo.ra, mTopo.dec, lat, lon, gst);

  // Desplazamiento aparente de la Luna respecto al Sol, en el plano del cielo.
  // dx>0 = la Luna está a la izquierda mirando al Sol (hacia acimut creciente).
  const dx = ((moonHz.az - sunHz.az + 540) % 360 - 180) * Math.cos(sunHz.alt * DEG);
  const dy = moonHz.alt - sunHz.alt;

  const isTotal = sep < moonSD - sunSD;
  const isAnnular = sep < sunSD - moonSD;

  return {
    date,
    sun: { ...sTopo, sd: sunSD, alt: sunHz.alt, az: sunHz.az,
           altApparent: sunHz.alt + refraction(sunHz.alt) },
    moon: { ...mTopo, sd: moonSD, alt: moonHz.alt, az: moonHz.az },
    sep,
    magnitude,
    obscuration,
    isTotal,
    isAnnular,
    isPartial: magnitude > 0 && !isTotal && !isAnnular,
    offset: { dx, dy },
  };
}

// --- Búsqueda de contactos ---------------------------------------------------

/** Busca por bisección el instante en que sep(t) − umbral cambia de signo. */
function bisect(fn, tA, tB, tolMs = 200) {
  let a = tA, b = tB;
  let fa = fn(a);
  for (let i = 0; i < 60 && b - a > tolMs; i++) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if ((fa <= 0) === (fm <= 0)) { a = m; fa = fm; } else { b = m; }
  }
  return new Date((a + b) / 2);
}

/**
 * Circunstancias locales completas del eclipse para un observador.
 *
 * @param {{lat:number, lon:number, elev?:number}} obs
 * @param {string} [isoDate] día a explorar (YYYY-MM-DD, UTC). Por defecto, el
 *   día del eclipse de 2026.
 * @returns {{
 *   visible:boolean, type:'total'|'parcial'|'ninguno',
 *   max:object|null, contacts:object, durationTotality:number,
 *   sunUpAtMax:boolean, notes:string[]
 * }}
 */
export function localCircumstances(obs, isoDate = ECLIPSE_DATE) {
  const dayStart = Date.parse(`${isoDate}T00:00:00Z`);
  const sepAt = (ms) => {
    const st = eclipseState(new Date(ms), obs);
    return st.sep - (st.sun.sd + st.moon.sd); // <0 ⇒ hay eclipse parcial en curso
  };

  // 1) Barrido grueso del día (pasos de 2 min) para localizar el mínimo.
  const STEP = 120000;
  let best = Infinity, bestMs = dayStart;
  for (let ms = dayStart; ms <= dayStart + 86400000; ms += STEP) {
    const v = sepAt(ms);
    if (v < best) { best = v; bestMs = ms; }
  }

  // Sin solapamiento en todo el día: aquí no se ve nada.
  if (best >= 0) {
    return {
      visible: false, type: 'ninguno', max: null, contacts: {},
      durationTotality: 0, sunUpAtMax: false,
      notes: ['Desde esta posición el eclipse no es visible: los discos no llegan a solaparse.'],
    };
  }

  // 2) Refinado del máximo por búsqueda ternaria sobre la separación.
  let lo = bestMs - STEP, hi = bestMs + STEP;
  for (let i = 0; i < 80 && hi - lo > 200; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (sepAt(m1) < sepAt(m2)) hi = m2; else lo = m1;
  }
  const maxMs = (lo + hi) / 2;
  const max = eclipseState(new Date(maxMs), obs);

  // 3) Contactos C1 y C4: primer y último roce de los discos.
  const c1 = bisect(sepAt, maxMs - 4 * 3600000, maxMs);
  const c4 = bisect((ms) => -sepAt(ms), maxMs, maxMs + 4 * 3600000);

  const contacts = { c1, c4 };
  let durationTotality = 0;

  // 4) Contactos C2 y C3 si hay totalidad (la Luna cubre el disco entero).
  if (max.isTotal) {
    const innerAt = (ms) => {
      const st = eclipseState(new Date(ms), obs);
      return st.sep - Math.abs(st.moon.sd - st.sun.sd);
    };
    contacts.c2 = bisect(innerAt, c1.getTime(), maxMs);
    contacts.c3 = bisect((ms) => -innerAt(ms), maxMs, c4.getTime());
    durationTotality = (contacts.c3 - contacts.c2) / 1000;
  }

  // 5) Avisos: en España el Sol está bajísimo, así que el ocaso es determinante.
  const notes = [];
  const sunUpAtMax = max.sun.altApparent > 0;
  const stateAt = (d) => eclipseState(d, obs);

  if (!sunUpAtMax) {
    notes.push('El Sol ya se ha puesto en el momento del máximo: desde aquí no verás el eclipse.');
  } else if (max.sun.alt < 5) {
    notes.push(
      `El Sol estará a solo ${max.sun.alt.toFixed(1)}° sobre el horizonte. ` +
      'Necesitas horizonte totalmente despejado en esa dirección.',
    );
  }
  if (stateAt(c1).sun.altApparent <= 0) {
    notes.push('El eclipse empieza antes de que salga el Sol, o el Sol se pone antes del inicio.');
  }
  if (stateAt(c4).sun.altApparent <= 0) {
    notes.push('El Sol se pone antes de que el eclipse termine: no verás las fases finales.');
  }

  return {
    visible: true,
    type: max.isTotal ? 'total' : max.isAnnular ? 'anular' : 'parcial',
    max,
    contacts,
    durationTotality,
    sunUpAtMax,
    notes,
  };
}

/**
 * Hora del ocaso solar para un punto y día dados (altura aparente = -0.833°,
 * que incluye refracción y semidiámetro). Devuelve null si no hay ocaso.
 */
export function sunsetTime(obs, isoDate = ECLIPSE_DATE) {
  const { lat, lon, elev = 0 } = obs;
  const dayStart = Date.parse(`${isoDate}T00:00:00Z`);
  const altAt = (ms) => {
    const jd = julianDay(new Date(ms));
    const s = sunPosition(centuriesTT(jd));
    const gst = greenwichSiderealTime(jd);
    return equatorialToHorizontal(s.ra, s.dec, lat, lon, gst).alt + 0.833;
  };
  // Ligera corrección por altitud del observador: desde un monte el Sol se pone
  // más tarde. ~ -0.0293° por cada 100 m de altura.
  const horizonDip = elev > 0 ? 1.75 * Math.sqrt(elev) / 60 : 0;

  let prev = altAt(dayStart) + horizonDip;
  for (let ms = dayStart + 600000; ms <= dayStart + 86400000; ms += 600000) {
    const cur = altAt(ms) + horizonDip;
    if (prev > 0 && cur <= 0) {
      return bisect((t) => -(altAt(t) + horizonDip), ms - 600000, ms);
    }
    prev = cur;
  }
  return null;
}

/** Serie temporal del eclipse, para animar o dibujar la curva de obscuración. */
export function eclipseTimeline(obs, contacts, samples = 120) {
  if (!contacts.c1 || !contacts.c4) return [];
  const t0 = contacts.c1.getTime(), t1 = contacts.c4.getTime();
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const d = new Date(t0 + ((t1 - t0) * i) / samples);
    out.push(eclipseState(d, obs));
  }
  return out;
}
