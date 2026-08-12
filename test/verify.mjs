// test/verify.mjs
//
// Verifica el JavaScript QUE SE ENVÍA (no un port a otro lenguaje) contra:
//   · los ejemplos publicados de Meeus,
//   · las efemérides oficiales del IGN/OAN y de la NASA GSFC.
//
// Ejecutar:  node test/verify.mjs

import {
  sunPosition, moonPosition, nutation, julianDay, centuriesTT,
  greenwichSiderealTime, deltaT,
} from '../js/astro.js';
import { localCircumstances, eclipseState, sunsetTime } from '../js/eclipse.js';
import { shadowAxisPoint, centerlineGeoJSON, totalityBandGeoJSON } from '../js/shadow.js';

let fallos = 0, pruebas = 0;
const R2D = 180 / Math.PI;

function comprobar(etiqueta, obtenido, esperado, tol, unidad = '') {
  pruebas++;
  const d = obtenido - esperado;
  const ok = Math.abs(d) <= tol;
  if (!ok) fallos++;
  console.log(`  [${ok ? 'ok  ' : 'FALLO'}] ${etiqueta.padEnd(30)}` +
    `${obtenido.toFixed(5).padStart(14)}  esp ${esperado.toFixed(5).padStart(14)}` +
    `  Δ${d >= 0 ? '+' : ''}${d.toFixed(5)}${unidad}`);
}

function seccion(t) { console.log(`\n=== ${t} ===`); }

// ─────────────────────────────────────────────────────────────────────────────
seccion('Meeus 47.a — Luna, 1992 abril 12.0 TD');
{
  const T = (2448724.5 - 2451545.0) / 36525;
  const m = moonPosition(T);
  comprobar('longitud eclíptica', m.lambda, 133.162655, 1e-5, '°');
  comprobar('latitud eclíptica', m.beta, -3.229126, 1e-5, '°');
  comprobar('distancia', m.dist, 368409.7, 0.1, ' km');
  comprobar('paralaje', m.parallax, 0.991990, 1e-5, '°');
}

seccion('Meeus 25 — Sol, 1992 octubre 13.0 TD');
{
  const T = (2448908.5 - 2451545.0) / 36525;
  const s = sunPosition(T);
  comprobar('longitud aparente', s.lambda, 199.90895, 1e-4, '°');
  comprobar('distancia', s.R, 0.99766, 1e-5, ' UA');
  comprobar('ascensión recta', s.ra, 198.380830, 2e-3, '°');
  comprobar('declinación', s.dec, -7.785070, 2e-3, '°');
}

seccion('ΔT y tiempo sidéreo');
{
  comprobar('ΔT en 2026', deltaT(2026), 71.4, 0.01, ' s');
  // Meeus, ejemplo 12.a: 1987 abril 10.0 TD → θ0 = 197.693195°
  const g = greenwichSiderealTime(2446895.5);
  comprobar('θ aparente 1987-04-10', g, 197.693195, 2e-3, '°');
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('Circunstancias locales frente a las efemérides oficiales (IGN/OAN)');

// (ciudad, lat, lon, alt_m, máximo UT, altura Sol, acimut Sol, duración totalidad s)
const OFICIAL = [
  ['A Coruña',   43.3623, -8.4115,  20, '18:28:13', 11.95, 279.15,  76.1],
  ['Oviedo',     43.3619, -5.8494, 230, '18:27:54', 10.18, 280.79, 108.2],
  ['Santander',  43.4623, -3.8100,  15, '18:27:23',  8.85, 282.03,  63.0],
  ['Bilbao',     43.2630, -2.9350,  20, '18:27:32',  8.14, 282.68,  28.1],
  ['Logroño',    42.4650, -2.4456, 384, '18:28:44',  7.40, 283.30,  80.5],
  ['Burgos',     42.3439, -3.6969, 860, '18:29:12',  8.20, 282.57, 103.8],
  ['Valladolid', 41.6523, -4.7245, 700, '18:30:31',  8.56, 282.22,  87.9],
  ['Zaragoza',   41.6488, -0.8891, 208, '18:29:39',  5.92, 284.55,  83.4],
  ['Palma',      39.5696,  2.6502,  13, '18:31:48',  2.38, 287.28,  96.1],
  ['Pamplona',   42.8125, -1.6458, 446, '18:27:59',  7.06, 283.65, null],
  ['Madrid',     40.4168, -3.7038, 667, '18:32:17',  7.20, 283.32, null],
];

const seg = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
const DIA0 = Date.parse('2026-08-12T00:00:00Z');

console.log(`  ${'Ciudad'.padEnd(13)}${'Δt'.padStart(8)}${'Δalt'.padStart(9)}` +
            `${'Δaz'.padStart(9)}${'Δdur'.padStart(9)}   Tipo`);
const dts = [], dalts = [], dazs = [];
let tipoOK = true;

for (const [nombre, lat, lon, elev, tUT, altOf, azOf, durOf] of OFICIAL) {
  const c = localCircumstances({ lat, lon, elev });
  pruebas++;

  const dt = (c.max.date.getTime() - DIA0) / 1000 - seg(tUT);
  const dalt = c.max.sun.alt - altOf;
  const daz = c.max.sun.az - azOf;
  dts.push(dt); dalts.push(dalt); dazs.push(daz);

  const esTotalOf = durOf !== null;
  const coincide = (c.type === 'total') === esTotalOf;
  if (!coincide) { tipoOK = false; fallos++; }

  const ddur = esTotalOf ? c.durationTotality - durOf : NaN;
  console.log(`  ${nombre.padEnd(13)}${dt.toFixed(1).padStart(7)}s` +
    `${dalt.toFixed(3).padStart(9)}${daz.toFixed(3).padStart(9)}` +
    `${(isNaN(ddur) ? '—' : ddur.toFixed(1) + 's').padStart(9)}   ` +
    `${c.type}${coincide ? '' : '  ← TIPO INCORRECTO'}`);
}

const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const maxAbs = (a) => Math.max(...a.map(Math.abs));

console.log(`\n  Instante:  media ${media(dts).toFixed(2)}s   máx |${maxAbs(dts).toFixed(1)}|s`);
console.log(`  Altura:    media ${media(dalts).toFixed(3)}°  máx |${maxAbs(dalts).toFixed(3)}|°`);
console.log(`  Acimut:    media ${media(dazs).toFixed(3)}°  máx |${maxAbs(dazs).toFixed(3)}|°`);
console.log(`  Clasificación total/parcial: ${tipoOK ? 'correcta en todas' : 'CON FALLOS'}`);

if (maxAbs(dalts) > 0.05) { console.log('  FALLO: altura fuera de tolerancia'); fallos++; }
if (maxAbs(dazs) > 0.05) { console.log('  FALLO: acimut fuera de tolerancia'); fallos++; }
// Se admite hasta 30 s: Valencia y otros puntos cerca del borde de la franja
// tienen un mínimo muy plano y el instante del máximo queda mal condicionado.
if (maxAbs(dts) > 30) { console.log('  FALLO: instante fuera de tolerancia'); fallos++; }

// ─────────────────────────────────────────────────────────────────────────────
seccion('Geometría de la sombra frente a NASA GSFC');
{
  const NASA = [
    ['18:26', 44.7133, -8.3983, 311],
    ['18:28', 43.3717, -6.1883, 304],
    ['18:30', 41.8167, -3.1850, 294],
  ];
  let peorDist = 0, peorAnchura = 0;
  for (const [hhmm, nlat, nlon, nw] of NASA) {
    const [h, m] = hhmm.split(':').map(Number);
    const p = shadowAxisPoint(new Date(DIA0 + (h * 3600 + m * 60) * 1000));
    pruebas++;
    if (!p) { console.log(`  FALLO: sin sombra a las ${hhmm}`); fallos++; continue; }
    const dist = Math.hypot((p.lat - nlat) * 111.32,
                            (p.lon - nlon) * 111.32 * Math.cos(p.lat / R2D));
    const dpc = (100 * (p.widthKm - nw)) / nw;
    peorDist = Math.max(peorDist, dist);
    peorAnchura = Math.max(peorAnchura, Math.abs(dpc));
    console.log(`  ${hhmm}  línea central a ${dist.toFixed(1)} km de NASA · ` +
      `anchura ${p.widthKm.toFixed(0)} km vs ${nw} km (${dpc >= 0 ? '+' : ''}${dpc.toFixed(1)}%)`);
  }
  if (peorDist > 35) { console.log('  FALLO: línea central demasiado desviada'); fallos++; }
  if (peorAnchura > 5) { console.log('  FALLO: anchura de franja fuera de tolerancia'); fallos++; }
}

seccion('Generación de capas del mapa');
{
  const linea = centerlineGeoJSON('2026-08-12', 120);
  const banda = totalityBandGeoJSON('2026-08-12', 120);
  pruebas += 2;
  const nSeg = linea.geometry.coordinates.length;
  const nPts = linea.geometry.coordinates.reduce((s, c) => s + c.length, 0);
  console.log(`  Línea central: ${nSeg} segmento(s), ${nPts} puntos`);
  if (nPts < 30) { console.log('  FALLO: línea central demasiado corta'); fallos++; }

  const anillo = banda?.geometry?.coordinates?.[0] ?? [];
  console.log(`  Franja de totalidad: polígono de ${anillo.length} vértices`);
  if (anillo.length < 30) { console.log('  FALLO: franja mal generada'); fallos++; }

  // Todas las coordenadas deben ser finitas y estar en rango.
  const malas = anillo.filter(([x, y]) =>
    !isFinite(x) || !isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90);
  pruebas++;
  if (malas.length) {
    console.log(`  FALLO: ${malas.length} coordenadas inválidas, p.ej. ${JSON.stringify(malas[0])}`);
    fallos++;
  } else {
    console.log('  Todas las coordenadas son válidas');
  }
}

seccion('Coherencia interna');
{
  const obs = { lat: 42.3439, lon: -3.6969, elev: 860 }; // Burgos
  const c = localCircumstances(obs);
  pruebas += 4;

  // Los contactos deben ir en orden.
  const t = [c.contacts.c1, c.contacts.c2, c.max.date, c.contacts.c3, c.contacts.c4]
    .filter(Boolean).map((d) => d.getTime());
  const ordenados = t.every((v, i) => i === 0 || v >= t[i - 1]);
  console.log(`  Contactos en orden cronológico: ${ordenados ? 'sí' : 'NO'}`);
  if (!ordenados) fallos++;

  // En el máximo la obscuración debe ser máxima.
  const antes = eclipseState(new Date(c.max.date.getTime() - 60000), obs);
  const despues = eclipseState(new Date(c.max.date.getTime() + 60000), obs);
  const esMax = c.max.obscuration >= antes.obscuration && c.max.obscuration >= despues.obscuration;
  console.log(`  La obscuración es máxima en el máximo: ${esMax ? 'sí' : 'NO'}`);
  if (!esMax) fallos++;

  // En totalidad, obscuración = 100%.
  console.log(`  Obscuración en totalidad: ${(c.max.obscuration * 100).toFixed(2)}%`);
  if (c.max.obscuration < 0.9999) fallos++;

  // El ocaso debe ser posterior al máximo (el eclipse ocurre antes de ponerse).
  const ocaso = sunsetTime(obs);
  const ok = ocaso && ocaso.getTime() > c.max.date.getTime();
  console.log(`  Ocaso (${ocaso?.toISOString().slice(11, 19)} UTC) posterior al máximo: ${ok ? 'sí' : 'NO'}`);
  if (!ok) fallos++;
}

seccion('Rendimiento');
{
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    localCircumstances({ lat: 42.3 + i * 0.1, lon: -3.7, elev: 800 });
  }
  const ms = (performance.now() - t0) / 10;
  console.log(`  Circunstancias completas: ${ms.toFixed(0)} ms por punto`);
  pruebas++;
  // En un móvil de gama baja será ~3-4× más lento; por encima de 400 ms aquí
  // la interfaz se notaría bloqueada al mover el mapa.
  if (ms > 400) { console.log('  FALLO: demasiado lento para uso interactivo'); fallos++; }

  const t1 = performance.now();
  centerlineGeoJSON('2026-08-12', 120);
  console.log(`  Línea central completa: ${(performance.now() - t1).toFixed(0)} ms`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(fallos === 0
  ? `TODO CORRECTO — ${pruebas} comprobaciones superadas.`
  : `${fallos} FALLO(S) sobre ${pruebas} comprobaciones.`);
process.exit(fallos === 0 ? 0 : 1);
