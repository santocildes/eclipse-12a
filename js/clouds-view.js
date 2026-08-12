// js/clouds-view.js — previsión de nubosidad para el punto elegido.

import {
  fetchPointForecast, visibilityScore, scoreLabel, forecastAvailable, daysUntil,
} from './clouds.js';
import { state, toast, showView } from './app.js';

const $ = (id) => document.getElementById(id);
let cargando = false;

export function init() {
  cargar();
  document.addEventListener('eclipse:location', () => { cargar(); });
  $('btnCloudMap').addEventListener('click', abrirMapaNubes);
}

function horaObjetivoUTC() {
  // La hora del máximo en el punto elegido, redondeada a la hora en punto que
  // es la resolución del modelo meteorológico.
  const max = state.circ?.max?.date;
  if (!max) return '2026-08-12T18:00';
  const d = new Date(Math.round(max.getTime() / 3600000) * 3600000);
  return d.toISOString().slice(0, 13) + ':00';
}

async function cargar() {
  if (cargando) return;
  cargando = true;
  const status = $('cloudStatus');
  const result = $('cloudResult');

  const target = horaObjetivoUTC();

  if (!forecastAvailable(target)) {
    const dias = Math.round(daysUntil(target));
    status.className = 'notice warn';
    status.innerHTML = dias > 0
      ? `Faltan <strong>${dias} días</strong> para el eclipse. Los modelos
         meteorológicos solo predicen con fiabilidad a 16 días vista, así que
         todavía no hay previsión de nubes que mostrar. Vuelve a partir del
         <strong>27 de julio de 2026</strong>.`
      : 'El eclipse ya ha pasado: no hay previsión que mostrar.';
    result.hidden = true;
    cargando = false;
    return;
  }

  status.className = 'notice';
  status.textContent = 'Consultando la previsión…';
  result.hidden = true;

  try {
    const fc = await fetchPointForecast(state.lat, state.lon, target);
    if (!fc.available || !fc.at) throw new Error('sin datos para esa hora');
    render(fc, target);
    status.hidden = true;
    result.hidden = false;
  } catch (err) {
    console.error(err);
    status.className = 'notice error';
    status.textContent = `No se pudo obtener la previsión: ${err.message}. `
      + 'Comprueba la conexión y vuelve a entrar en esta pestaña.';
    status.hidden = false;
  } finally {
    cargando = false;
  }
}

function render(fc, target) {
  const sunAlt = state.circ?.max?.sun?.alt ?? 8;
  const score = visibilityScore(fc.at, sunAlt);
  const label = scoreLabel(score);

  const colores = {
    good: 'var(--good)', mixed: 'var(--mixed)',
    poor: 'var(--poor)', bad: 'var(--bad)', unknown: 'var(--dim)',
  };
  const color = colores[label.tone];

  // ── Anillo de puntuación ──
  const r = 32, circ = 2 * Math.PI * r;
  $('cloudScore').innerHTML = `
    <div class="score-ring">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r="${r}" fill="none" stroke="var(--bg)" stroke-width="7"/>
        <circle cx="37" cy="37" r="${r}" fill="none" stroke="${color}" stroke-width="7"
                stroke-linecap="round" stroke-dasharray="${circ}"
                stroke-dashoffset="${circ * (1 - score / 100)}"/>
      </svg>
      <span class="num" style="color:${color}">${score}</span>
    </div>
    <div class="score-text">
      <div class="t" style="color:${color}">${label.text}</div>
      <div class="d">Probabilidad de cielo útil hacia las
        ${new Date(`${target}:00Z`).toLocaleTimeString('es-ES',
          { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })} h.
        Nubosidad total prevista: ${fc.at.total}%.</div>
    </div>`;

  // ── Desglose por niveles ──
  const niveles = [
    ['Nubes bajas', fc.at.low, 'var(--bad)', 'Tapan por completo'],
    ['Nubes medias', fc.at.mid, 'var(--mixed)', 'Suelen tapar'],
    ['Nubes altas', fc.at.high, 'var(--corona)', 'Cirros: dejan ver el Sol'],
  ];
  $('cloudLevels').innerHTML = niveles.map(([n, v, c, nota]) => `
    <div class="cloud-level">
      <span>${n}<small>${nota}</small></span>
      <span class="track"><span class="fill" style="width:${v ?? 0}%;background:${c}"></span></span>
      <span class="pct">${v ?? '—'}%</span>
    </div>`).join('');

  dibujarSerie(fc.hourly);
}

// ── Serie horaria ────────────────────────────────────────────────────────────

function dibujarSerie(hourly) {
  const cv = $('cloudChart');
  if (!hourly?.time?.length) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 800, H = 240;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 42, padR = 12, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = hourly.time.length;
  const xOf = (i) => padL + (plotW * i) / (n - 1);
  const yOf = (v) => padT + plotH * (1 - v / 100);

  g.fillStyle = '#0e1424'; g.fillRect(0, 0, W, H);

  // Rejilla
  g.strokeStyle = '#1b2338'; g.fillStyle = '#64708c';
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'right';
  for (let v = 0; v <= 100; v += 25) {
    const y = yOf(v);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
    g.fillText(`${v}%`, padL - 6, y + 4);
  }
  g.textAlign = 'center';
  for (let i = 0; i < n; i += 4) {
    const h = hourly.time[i].slice(11, 13);
    // Etiquetas en hora peninsular (UTC+2 en agosto).
    g.fillText(`${(parseInt(h, 10) + 2) % 24}h`, xOf(i), H - 8);
  }

  // Series apiladas visualmente por tipo de nube
  const series = [
    ['cloud_cover_high', 'rgba(207,227,255,.45)'],
    ['cloud_cover_mid', 'rgba(255,196,83,.5)'],
    ['cloud_cover_low', 'rgba(255,92,110,.55)'],
  ];
  for (const [key, color] of series) {
    const arr = hourly[key];
    if (!arr) continue;
    g.beginPath();
    g.moveTo(xOf(0), padT + plotH);
    arr.forEach((v, i) => g.lineTo(xOf(i), yOf(v ?? 0)));
    g.lineTo(xOf(n - 1), padT + plotH);
    g.closePath();
    g.fillStyle = color; g.fill();
  }

  // Nubosidad total, encima
  g.beginPath();
  hourly.cloud_cover.forEach((v, i) => {
    const x = xOf(i), y = yOf(v ?? 0);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = '#e8ecf5'; g.lineWidth = 2; g.stroke();

  // Banda del eclipse, dibujada AL FINAL para que no la tapen las series y se
  // vea de un vistazo qué nubosidad coincide con el evento.
  const c = state.circ;
  if (c?.contacts?.c1 && c?.contacts?.c4) {
    const idxOf = (d) => {
      const iso = d.toISOString().slice(0, 13);
      const i = hourly.time.findIndex((t) => t.startsWith(iso));
      return i < 0 ? null : i;
    };
    const i1 = idxOf(c.contacts.c1), i2 = idxOf(c.contacts.c4);
    if (i1 !== null && i2 !== null) {
      g.fillStyle = 'rgba(255,178,56,.13)';
      g.fillRect(xOf(i1), padT, xOf(i2) - xOf(i1), plotH);
      g.strokeStyle = 'rgba(255,178,56,.8)';
      g.lineWidth = 1.5;
      [i1, i2].forEach((i) => {
        g.beginPath(); g.moveTo(xOf(i), padT); g.lineTo(xOf(i), padT + plotH); g.stroke();
      });
      g.fillStyle = '#ffd08a';
      g.font = '600 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('eclipse', (xOf(i1) + xOf(i2)) / 2, padT + 11);
    }
  }
}

function abrirMapaNubes() {
  toast('Dibujando la nubosidad sobre la franja…');
  showView('mapa');
  import('./cloud-map.js')
    .then((m) => m.mostrarRejillaNubes())
    .catch((err) => {
      console.error(err);
      toast('No se pudo cargar el mapa de nubes');
    });
}
