// js/clouds.js
//
// Previsión de nubosidad (Open-Meteo: sin clave, CORS abierto).
//
// Se pide nubosidad total y desglosada por niveles porque NO son equivalentes
// para ver un eclipse: los cirros altos dejan pasar perfectamente un eclipse
// (incluso lo adornan), mientras que un estrato bajo lo tapa por completo. Una
// cifra única de "70% de nubes" no distingue esos dos casos opuestos, así que la
// app puntúa cada nivel con distinto peso.

import { WEATHER } from './config.js';

/** Hora objetivo por defecto: el máximo del eclipse en la Península (UTC). */
export const DEFAULT_TARGET_UTC = '2026-08-12T18:00';

/**
 * ¿Está la fecha dentro del alcance del modelo? Open-Meteo predice a 16 días.
 * Fuera de esa ventana no hay previsión real, y la app debe decirlo en vez de
 * enseñar un número sin fundamento.
 */
export function forecastAvailable(targetISO = DEFAULT_TARGET_UTC) {
  const days = (Date.parse(targetISO) - Date.now()) / 86400000;
  return days >= -1 && days <= WEATHER.maxForecastDays;
}

export function daysUntil(targetISO = DEFAULT_TARGET_UTC) {
  return (Date.parse(targetISO) - Date.now()) / 86400000;
}

function buildUrl(lats, lons, targetISO) {
  const day = targetISO.slice(0, 10);
  const p = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,temperature_2m,wind_speed_10m',
    start_date: day,
    end_date: day,
    timezone: 'UTC',
  });
  return `${WEATHER.endpoint}?${p}`;
}

function pickHour(block, targetISO) {
  const times = block?.hourly?.time ?? [];
  const want = targetISO.slice(0, 13); // 'YYYY-MM-DDTHH'
  let idx = times.findIndex((t) => t.startsWith(want));
  if (idx === -1) idx = Math.min(18, times.length - 1);
  if (idx < 0) return null;
  const h = block.hourly;
  return {
    time: times[idx],
    total: h.cloud_cover?.[idx] ?? null,
    low: h.cloud_cover_low?.[idx] ?? null,
    mid: h.cloud_cover_mid?.[idx] ?? null,
    high: h.cloud_cover_high?.[idx] ?? null,
    visibility: h.visibility?.[idx] ?? null,
    temperature: h.temperature_2m?.[idx] ?? null,
    wind: h.wind_speed_10m?.[idx] ?? null,
  };
}

/**
 * Puntuación 0–100 de "qué probabilidad hay de VER el eclipse" según las nubes.
 *
 * No es lo mismo que "100 − nubosidad". Los pesos reflejan cuánto estorba cada
 * tipo de nube a la observación:
 *   · nubes bajas  → tapan por completo. Peso máximo.
 *   · nubes medias → tapan casi siempre. Peso alto.
 *   · nubes altas  → cirros; el Sol se ve a través. Peso bajo.
 *
 * Además, con el Sol a pocos grados del horizonte el rayo visual atraviesa
 * decenas de km de atmósfera baja: una nube lejana, invisible desde arriba,
 * puede cruzarse igualmente. Por eso las nubes bajas penalizan aún más cuando
 * el Sol está muy bajo.
 */
export function visibilityScore(cloud, sunAltDeg = 8) {
  if (!cloud || cloud.total === null) return null;
  const low = cloud.low ?? cloud.total;
  const mid = cloud.mid ?? 0;
  const high = cloud.high ?? 0;

  // Con el Sol muy bajo, las nubes bajas del horizonte pesan más.
  const lowWeight = sunAltDeg < 10 ? 1.25 : 1.0;

  const blocked = Math.min(100, low * lowWeight * 0.85 + mid * 0.55 + high * 0.15);
  return Math.round(Math.max(0, 100 - blocked));
}

export function scoreLabel(score) {
  if (score === null) return { text: 'Sin datos', tone: 'unknown' };
  if (score >= 75) return { text: 'Buenas perspectivas', tone: 'good' };
  if (score >= 50) return { text: 'Dudoso', tone: 'mixed' };
  if (score >= 25) return { text: 'Malas perspectivas', tone: 'poor' };
  return { text: 'Muy cubierto', tone: 'bad' };
}

/**
 * Previsión para un punto, con la serie horaria completa del día para poder
 * dibujar la evolución.
 */
export async function fetchPointForecast(lat, lon, targetISO = DEFAULT_TARGET_UTC) {
  if (!forecastAvailable(targetISO)) {
    return { available: false, daysAway: daysUntil(targetISO) };
  }
  const res = await fetch(buildUrl([lat.toFixed(4)], [lon.toFixed(4)], targetISO));
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const json = await res.json();
  const block = Array.isArray(json) ? json[0] : json;

  return {
    available: true,
    at: pickHour(block, targetISO),
    hourly: block.hourly,
    elevation: block.elevation,
  };
}

/**
 * Rejilla de nubosidad para pintar sobre el mapa.
 *
 * Open-Meteo admite varios puntos en una sola petición (latitude=a,b,c), así que
 * una rejilla entera cuesta unas pocas llamadas en vez de una por celda. Se trocea
 * en lotes para no construir URLs gigantes.
 *
 * @returns {Promise<{type:'FeatureCollection', features:Array}>} GeoJSON de puntos
 */
export async function fetchCloudGrid(bounds, opts = {}) {
  const { targetISO = DEFAULT_TARGET_UTC, cols = 12, rows = 9, batchSize = 60, onProgress } = opts;
  if (!forecastAvailable(targetISO)) {
    return { type: 'FeatureCollection', features: [], available: false };
  }

  const [[west, south], [east, north]] = bounds;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        lat: south + ((north - south) * (r + 0.5)) / rows,
        lon: west + ((east - west) * (c + 0.5)) / cols,
      });
    }
  }

  const features = [];
  for (let i = 0; i < pts.length; i += batchSize) {
    const batch = pts.slice(i, i + batchSize);
    const url = buildUrl(
      batch.map((p) => p.lat.toFixed(3)),
      batch.map((p) => p.lon.toFixed(3)),
      targetISO,
    );
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
    const json = await res.json();
    const blocks = Array.isArray(json) ? json : [json];

    blocks.forEach((b, k) => {
      const cloud = pickHour(b, targetISO);
      const p = batch[k];
      if (!p || !cloud) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          total: cloud.total, low: cloud.low, mid: cloud.mid, high: cloud.high,
          score: visibilityScore(cloud),
        },
      });
    });
    onProgress?.(Math.min(1, (i + batchSize) / pts.length));
  }

  return { type: 'FeatureCollection', features, available: true };
}
