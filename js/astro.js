// js/astro.js
//
// Efemérides de Sol y Luna. Algoritmos de Meeus, "Astronomical Algorithms" 2ª ed.
//   · Sol  → cap. 25 (precisión ~0.01°)
//   · Luna → cap. 47, serie abreviada ELP2000 (~10" en longitud, ~4" en latitud)
//
// Precisión resultante en tiempos de contacto del eclipse: del orden de ±20 s.
// Suficiente de sobra para responder "¿se verá desde aquí?", que es lo que hace
// esta app. Para cronometrar contactos al segundo, usa las efemérides del IGN.
//
// Validado contra los ejemplos 25.b y 47.a de Meeus (ver test/astro.test.js).

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);

/** Normaliza un ángulo a [0, 360). */
export function norm360(x) {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}

/** Normaliza un ángulo a (-180, 180]. */
export function norm180(x) {
  const r = norm360(x);
  return r > 180 ? r - 360 : r;
}

// --- Tiempo ------------------------------------------------------------------

/** Día juliano a partir de un Date (interpretado en UTC). */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Date a partir de un día juliano. */
export function dateFromJD(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

// ΔT = TT − UT1, en segundos.
//
// Un error en ΔT desplaza TODOS los tiempos en la misma cantidad, así que
// conviene acertar. El polinomio clásico de Espenak & Meeus (ajustado en los
// 2000) da 75.1 s para 2026 y se queda largo: la Tierra ha acelerado su
// rotación en la última década y ΔT lleva estancada en ~69 s.
//
// Se usa 71.4 s, que es el valor con el que la NASA (GSFC) y el IGN publicaron
// las tablas OFICIALES de este eclipse. Elegirlo así hace que los tiempos de la
// app coincidan con los que el usuario va a encontrar si los contrasta con esas
// fuentes. El valor físicamente observado ronda los 69 s; esos ~2 s de
// diferencia quedan por debajo de la precisión de estas efemérides abreviadas.
const DELTA_T_2026 = 71.4;

export function deltaT(year) {
  if (year >= 2025 && year < 2028) return DELTA_T_2026;
  if (year >= 2005 && year <= 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Siglos julianos desde J2000.0 en Tiempo Terrestre, a partir de un JD en UT. */
export function centuriesTT(jdUT) {
  const year = dateFromJD(jdUT).getUTCFullYear();
  const jdTT = jdUT + deltaT(year) / 86400;
  return (jdTT - 2451545.0) / 36525;
}

/** Tiempo sidéreo aparente en Greenwich, en grados, a partir de un JD en UT. */
export function greenwichSiderealTime(jdUT) {
  const T = (jdUT - 2451545.0) / 36525;
  let theta =
    280.46061837 +
    360.98564736629 * (jdUT - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  // Ecuación de los equinoccios (nutación en longitud × cos ε).
  const { dpsi, eps } = nutation(T);
  theta += dpsi * cos(eps);
  return norm360(theta);
}

// --- Nutación y oblicuidad (cap. 22, términos principales) --------------------

/** Nutación en longitud (dpsi, grados) y oblicuidad aparente (eps, grados). */
export function nutation(T) {
  const omega = 125.04452 - 1934.136261 * T;
  const L = 280.4665 + 36000.7698 * T;
  const Lp = 218.3165 + 481267.8813 * T;

  // dpsi y deps en segundos de arco → grados.
  const dpsi =
    (-17.2 * sin(omega) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * omega)) / 3600;
  const deps =
    (9.2 * cos(omega) + 0.57 * cos(2 * L) + 0.1 * cos(2 * Lp) - 0.09 * cos(2 * omega)) / 3600;

  const eps0 =
    23 + 26 / 60 + 21.448 / 3600 - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;

  return { dpsi, deps, eps: eps0 + deps, eps0 };
}

// --- Sol (cap. 25) -----------------------------------------------------------

/**
 * Posición geocéntrica aparente del Sol.
 * @returns {{ra:number, dec:number, R:number, lambda:number}}
 *   ra/dec en grados, R distancia en UA.
 */
export function sunPosition(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);

  const trueLon = L0 + C;
  const trueAnom = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(trueAnom));

  // Longitud aparente: corrección por nutación y aberración.
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLon - 0.00569 - 0.00478 * sin(omega);

  // Para usar con longitud APARENTE, Meeus añade 0.00256·cos(Ω) a ε0.
  const eps0 =
    23 + 26 / 60 + 21.448 / 3600 - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
  const eps = eps0 + 0.00256 * cos(omega);

  const ra = norm360(Math.atan2(cos(eps) * sin(lambda), cos(lambda)) * RAD);
  const dec = Math.asin(sin(eps) * sin(lambda)) * RAD;

  return { ra, dec, R, lambda: norm360(lambda) };
}

// --- Luna (cap. 47) ----------------------------------------------------------

// Tabla 47.A — argumentos (D, M, M', F) y coeficientes de Σl (·1e-6 grados)
// y Σr (·1e-3 km).
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],   [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],     [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],     [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],     [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],   [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],     [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],          [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],     [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],      [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],       [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],       [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],       [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],       [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],          [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],        [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],        [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],      [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],           [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],           [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],         [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],       [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],            [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],         [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],        [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],           [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],             [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],            [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],         [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],             [2, 0, -1, -2, 0, 8752],
];

// Tabla 47.B — argumentos y coeficiente de Σb (·1e-6 grados).
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602],  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],   [0, 0, 2, 1, 17198],   [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],   [2, -1, 0, -1, 8216],  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],    [2, 1, 0, -1, -3359],  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],   [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],  [0, 1, 0, 1, -1794],   [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],  [1, 0, 0, 1, -1491],   [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],  [0, 1, 0, -1, -1344],  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],    [4, 0, 0, -1, 1021],   [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],    [4, 0, -2, 1, 671],    [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],    [2, -1, 1, -1, 491],   [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],    [2, 0, 2, 1, 422],     [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],   [2, 1, 0, 1, -351],    [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],    [2, -2, 0, -1, 302],   [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],   [1, 1, 0, -1, 223],    [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],  [2, 1, -1, -1, -220],  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],  [0, 1, 2, 1, -177],    [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],  [1, 0, 1, -1, -164],   [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],  [4, -1, 0, -1, 115],   [2, -2, 0, 1, 107],
];

/**
 * Posición geocéntrica aparente de la Luna.
 * @returns {{ra:number, dec:number, dist:number, parallax:number}}
 *   ra/dec en grados, dist en km, parallax (horizontal ecuatorial) en grados.
 */
export function moonPosition(T) {
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D  = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M  = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F  = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);

  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.290 * T);
  const A3 = norm360(313.45 + 481266.484 * T);

  // Excentricidad terrestre: los términos en M se escalan por E (o E² si |M|=2).
  const E = 1 - 0.002516 * T - 0.0000074 * T2;

  let sumL = 0, sumR = 0, sumB = 0;

  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sumL += cl * ecc * sin(arg);
    sumR += cr * ecc * cos(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sumB += cb * ecc * sin(arg);
  }

  // Términos aditivos por Venus, Júpiter y el achatamiento terrestre.
  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sumB += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
        + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  const lambda = Lp + sumL / 1e6;          // longitud eclíptica (grados)
  const beta = sumB / 1e6;                 // latitud eclíptica (grados)
  const dist = 385000.56 + sumR / 1000;    // distancia (km)
  const parallax = Math.asin(6378.14 / dist) * RAD;

  const { dpsi, eps } = nutation(T);
  const lambdaApp = lambda + dpsi;         // nutación en longitud

  const ra = norm360(
    Math.atan2(sin(lambdaApp) * cos(eps) - Math.tan(beta * DEG) * sin(eps), cos(lambdaApp)) * RAD,
  );
  const dec = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambdaApp)) * RAD;

  return { ra, dec, dist, parallax, lambda: norm360(lambda), beta };
}

// --- Paralaje: geocéntrico → topocéntrico (cap. 40) --------------------------

/**
 * Corrige ra/dec geocéntricas a topocéntricas para un observador.
 * @param {number} ra grados
 * @param {number} dec grados
 * @param {number} parallaxDeg paralaje horizontal ecuatorial del astro, grados
 * @param {number} lat latitud del observador, grados
 * @param {number} lon longitud del observador, grados (Este positivo)
 * @param {number} elev altitud del observador, metros
 * @param {number} gst tiempo sidéreo en Greenwich, grados
 */
export function topocentric(ra, dec, parallaxDeg, lat, lon, elev, gst) {
  // Coordenadas geocéntricas del observador sobre el elipsoide IAU76.
  const u = Math.atan(0.99664719 * Math.tan(lat * DEG));
  const rhoSinPhi = 0.99664719 * Math.sin(u) + (elev / 6378140) * sin(lat);
  const rhoCosPhi = Math.cos(u) + (elev / 6378140) * cos(lat);

  const H = norm360(gst + lon - ra); // ángulo horario local
  const sinPi = sin(parallaxDeg);

  const dRa =
    Math.atan2(-rhoCosPhi * sinPi * sin(H), cos(dec) - rhoCosPhi * sinPi * cos(H)) * RAD;
  const decTopo =
    Math.atan2(
      (sin(dec) - rhoSinPhi * sinPi) * cos(dRa),
      cos(dec) - rhoCosPhi * sinPi * cos(H),
    ) * RAD;

  return { ra: norm360(ra + dRa), dec: decTopo };
}

// --- Coordenadas horizontales -------------------------------------------------

/**
 * Convierte ra/dec a altura/acimut.
 * Acimut medido desde el NORTE hacia el ESTE (0=N, 90=E, 180=S, 270=O),
 * que es la convención de brújula que espera el usuario.
 * @returns {{alt:number, az:number}} en grados
 */
export function equatorialToHorizontal(ra, dec, lat, lon, gst) {
  const H = norm360(gst + lon - ra);
  const alt = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) * RAD;
  // Meeus mide el acimut desde el Sur; +180 lo pasa a la convención Norte.
  const azSouth = Math.atan2(sin(H), cos(H) * sin(lat) - Math.tan(dec * DEG) * cos(lat)) * RAD;
  return { alt, az: norm360(azSouth + 180) };
}

/**
 * Refracción atmosférica (Bennett). Devuelve los grados que hay que SUMAR a la
 * altura geométrica para obtener la aparente. Relevante aquí: con el Sol a 2-3°
 * sobre el horizonte la refracción lo eleva ~0.2-0.3°, nada despreciable.
 */
export function refraction(altDeg) {
  if (altDeg < -2) return 0;
  const a = Math.max(altDeg, -0.5);
  return 1.02 / Math.tan((a + 10.3 / (a + 5.11)) * DEG) / 60;
}

/** Separación angular entre dos posiciones ecuatoriales, en grados. */
export function angularSeparation(ra1, dec1, ra2, dec2) {
  const d =
    sin(dec1) * sin(dec2) + cos(dec1) * cos(dec2) * cos(ra1 - ra2);
  // atan2 en vez de acos: estable para separaciones pequeñas, que es el caso
  // justo durante el eclipse.
  const x = cos(dec1) * sin(dec2) - sin(dec1) * cos(dec2) * cos(ra1 - ra2);
  const y = cos(dec2) * sin(ra2 - ra1);
  return Math.atan2(Math.hypot(x, y), d) * RAD;
}
