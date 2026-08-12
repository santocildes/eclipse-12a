// js/app.js — orquestador de la aplicación.

import { CONFIG } from './config.js';
import { localCircumstances, eclipseState, sunsetTime, ECLIPSE_DATE } from './eclipse.js';
import { CIUDADES, buscarCiudades } from './places.js';
import * as Clouds from './clouds.js';

const $ = (id) => document.getElementById(id);

// ── Estado ───────────────────────────────────────────────────────────────────
export const state = {
  lat: 42.34, lon: -3.70, elev: 860,      // Burgos, dentro de la franja
  name: 'Burgos',
  circ: null,
  horizonProfile: null,
  clouds: null,
  view: 'mapa',
};

const modules = {}; // vistas cargadas bajo demanda

// ── Formato de fechas ────────────────────────────────────────────────────────
const timeFmt = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: CONFIG.displayTimezone,
});
const timeShortFmt = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: CONFIG.displayTimezone,
});

export const fmtTime = (d) => (d ? timeFmt.format(d) : '—');
export const fmtTimeShort = (d) => (d ? timeShortFmt.format(d) : '—');

export function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

/** Convierte un acimut en punto cardinal, que es como la gente se orienta. */
export function cardinal(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return names[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}

export function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ── Ubicación ────────────────────────────────────────────────────────────────

export function setLocation(lat, lon, name, elev = null) {
  state.lat = lat;
  state.lon = lon;
  state.name = name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  if (elev !== null) state.elev = elev;

  // El perfil de horizonte y las nubes son de un punto concreto: al moverse
  // dejan de valer y hay que descartarlos, o mostraríamos el veredicto del
  // sitio anterior.
  state.horizonProfile = null;
  state.clouds = null;

  recompute();
  saveLocation();
}

function saveLocation() {
  try {
    localStorage.setItem('eclipse_loc', JSON.stringify({
      lat: state.lat, lon: state.lon, name: state.name, elev: state.elev,
    }));
  } catch { /* modo privado: seguimos sin persistir */ }
}

function restoreLocation() {
  try {
    const raw = localStorage.getItem('eclipse_loc');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return false;
    state.lat = s.lat; state.lon = s.lon;
    state.name = s.name; state.elev = s.elev ?? 0;
    return true;
  } catch { return false; }
}

export function recompute() {
  state.circ = localCircumstances(
    { lat: state.lat, lon: state.lon, elev: state.elev }, ECLIPSE_DATE,
  );
  state.sunset = sunsetTime({ lat: state.lat, lon: state.lon, elev: state.elev }, ECLIPSE_DATE);
  renderHeader();
  renderSheet();
  modules.map?.onLocationChange?.();
  modules.orbit?.onLocationChange?.();
  document.dispatchEvent(new CustomEvent('eclipse:location'));
}

// ── Cabecera ─────────────────────────────────────────────────────────────────

function renderHeader() {
  $('placeName').textContent = state.name;
  $('placeCoords').textContent =
    `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)} · ${Math.round(state.elev)} m`;

  const c = state.circ;
  const v = $('verdict'), badge = $('verdictBadge'), sub = $('verdictSub');
  if (!c || !c.visible) {
    v.hidden = true;
    return;
  }
  v.hidden = false;

  if (c.type === 'total') {
    badge.textContent = 'Total';
    badge.className = 'verdict-badge total';
    sub.textContent = `${fmtDuration(c.durationTotality)} · ${fmtTimeShort(c.max.date)}`;
  } else {
    const pct = (c.max.obscuration * 100).toFixed(pctDigits(c.max.obscuration));
    badge.textContent = `Parcial ${pct}%`;
    badge.className = 'verdict-badge parcial';
    sub.textContent = `Máximo a las ${fmtTimeShort(c.max.date)}`;
  }
  if (!c.sunUpAtMax) {
    badge.textContent = 'Bajo el horizonte';
    badge.className = 'verdict-badge blocked';
  }

  const summary = $('handleSummary');
  if (summary) {
    summary.textContent = c.type === 'total'
      ? `Totalidad de ${fmtDuration(c.durationTotality)} · Sol a ${c.max.sun.alt.toFixed(1)}° sobre el horizonte`
      : `Parcial del ${(c.max.obscuration * 100).toFixed(1)}% · toca para ver los detalles`;
  }
}

// Con obscuraciones del 99.9% redondear a un decimal borra la diferencia entre
// "casi total" y "total". Se añaden decimales solo cuando hacen falta.
function pctDigits(obsc) {
  const pct = obsc * 100;
  if (pct > 99.9) return 3;
  if (pct > 99) return 2;
  return 1;
}

// ── Panel de detalles ────────────────────────────────────────────────────────

function renderSheet() {
  const body = $('sheetBody');
  if (!body) return;
  const c = state.circ;

  if (!c || !c.visible) {
    body.innerHTML = `<div class="notice error">Desde este punto el eclipse no es
      visible: los discos del Sol y la Luna no llegan a solaparse.</div>`;
    return;
  }

  const s = c.max.sun;
  const rows = [];
  const add = (label, date, cls = '', sub = '') => {
    if (!date) return;
    rows.push(`<div class="timeline-row ${cls}">
      <span>${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>
      <time>${fmtTime(date)}</time></div>`);
  };

  add('Primer contacto', c.contacts.c1, '', 'La Luna muerde el Sol');
  if (c.contacts.c2) add('Empieza la totalidad', c.contacts.c2, 'key total', '¡Quítate las gafas!');
  add('Máximo', c.max.date, c.type === 'total' ? '' : 'key');
  if (c.contacts.c3) add('Acaba la totalidad', c.contacts.c3, 'key total', 'Gafas otra vez, ya');
  add('Último contacto', c.contacts.c4, '', 'Fin del eclipse');
  if (state.sunset) add('Ocaso', state.sunset, '', 'Sin contar el relieve');

  const avisos = c.notes.map((n) => `<div class="notice warn">${n}</div>`).join('');

  const horizonBlock = state.horizonProfile
    ? renderHorizonBadge()
    : `<div class="notice">Aún no has calculado el horizonte de este punto.
        Con el Sol a ${s.alt.toFixed(1)}°, el relieve puede taparlo por completo —
        compruébalo en la pestaña <strong>Horizonte</strong>.</div>`;

  body.innerHTML = `
    ${avisos}
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><div class="k">Obscuración</div>
        <div class="v">${(c.max.obscuration * 100).toFixed(pctDigits(c.max.obscuration))}<span class="u">%</span></div></div>
      <div class="stat"><div class="k">Magnitud</div>
        <div class="v">${c.max.magnitude.toFixed(3)}</div></div>
      <div class="stat"><div class="k">Altura del Sol</div>
        <div class="v">${s.alt.toFixed(1)}<span class="u">°</span></div></div>
      <div class="stat"><div class="k">Dirección</div>
        <div class="v">${cardinal(s.az)}<span class="u"> ${s.az.toFixed(0)}°</span></div></div>
    </div>
    ${c.type === 'total' ? `<div class="card">
      <h4>Totalidad</h4>
      <div style="font-size:1.6rem;font-weight:700;color:#c3b2ff">${fmtDuration(c.durationTotality)}</div>
      <p style="margin:6px 0 0;font-size:.85rem;color:var(--muted)">
        Es el tiempo que podrás mirar al Sol sin filtro. Ni un segundo más.</p>
    </div>` : ''}
    ${horizonBlock}
    <div class="card"><h4>Horario (hora peninsular)</h4>${rows.join('')}</div>
    <p class="fineprint">
      Calculado en tu dispositivo con series abreviadas de Meeus. Contrastado con
      las efemérides del IGN y de la NASA: la altura y el acimut del Sol coinciden
      dentro de 0,02°, y los instantes dentro de unos 3 segundos. Para
      cronometrar la totalidad al segundo, consulta las efemérides oficiales del IGN.
    </p>`;
}

function renderHorizonBadge() {
  const p = state.horizonProfile;
  if (!p || !p.check) return '';
  const { blocked, margin, horizonAlt } = p.check;
  const cls = blocked ? 'no' : margin < 1.5 ? 'tight' : 'ok';
  const title = blocked
    ? 'El terreno tapa el Sol'
    : margin < 1.5 ? 'Por los pelos' : 'Horizonte despejado';
  const detail = blocked
    ? `El horizonte se levanta hasta ${horizonAlt.toFixed(1)}° en esa dirección y
       el Sol solo alcanza ${(horizonAlt + margin).toFixed(1)}°. Desde aquí no lo verás.`
    : `El Sol quedará ${margin.toFixed(1)}° por encima del relieve
       (horizonte a ${horizonAlt.toFixed(1)}°).`;
  return `<div class="verdict-card ${cls}">
    <div class="big">${title}</div><p>${detail}</p></div>`;
}

// ── Cuenta atrás ─────────────────────────────────────────────────────────────

function tickCountdown() {
  const el = $('countdown');
  const c = state.circ;
  if (!c || !c.visible) { el.hidden = true; return; }
  el.hidden = false;

  const now = Date.now();
  const c1 = c.contacts.c1?.getTime();
  const c4 = c.contacts.c4?.getTime();
  const c2 = c.contacts.c2?.getTime();
  const c3 = c.contacts.c3?.getTime();

  let label, value, live = false;

  if (c2 && c3 && now >= c2 && now <= c3) {
    label = 'TOTALIDAD — quítate las gafas';
    value = `${Math.ceil((c3 - now) / 1000)} s`;
    live = true;
  } else if (now < c1) {
    label = 'Empieza en';
    value = hms(c1 - now);
  } else if (now <= c4) {
    label = c2 && now < c2 ? 'Totalidad en' : 'Termina en';
    value = hms((c2 && now < c2 ? c2 : c4) - now);
    live = true;
  } else {
    label = 'El eclipse ha terminado';
    value = '';
  }

  $('countdownLabel').textContent = label;
  $('countdownValue').textContent = value;
  el.classList.toggle('live', live);

  // Durante el eclipse el estado cambia rápido: refrescamos la vista AR.
  if (live) modules.ar?.tick?.();
}

function hms(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  if (d > 0) return `${d} d ${Math.floor((t % 86400) / 3600)} h`;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m`
               : `${m}:${String(s).padStart(2, '0')}`;
}

// ── Navegación entre vistas ──────────────────────────────────────────────────

async function showView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('active', v.id === `view-${name}`);
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
  });

  // Carga perezosa: el mapa, la AR y la escena 3D son pesados y no todo el
  // mundo entra en todas las pestañas.
  try {
    if (name === 'mapa' && !modules.map) {
      modules.map = await import('./map.js');
      await modules.map.init();
    } else if (name === 'mapa') {
      modules.map.resize?.();
    }
    if (name === 'horizonte' && !modules.horizon) {
      modules.horizon = await import('./horizon-view.js');
      modules.horizon.init();
    }
    if (name === 'nubes' && !modules.cloudsView) {
      modules.cloudsView = await import('./clouds-view.js');
      modules.cloudsView.init();
    }
    if (name === 'ar' && !modules.ar) {
      modules.ar = await import('./ar.js');
      modules.ar.init();
    }
    if (name === 'orbita' && !modules.orbit) {
      modules.orbit = await import('./orbit3d.js');
      await modules.orbit.init();
    } else if (name === 'orbita') {
      modules.orbit.resume?.();
    }
    if (name !== 'orbita') modules.orbit?.pause?.();
    if (name !== 'ar') modules.ar?.pause?.();
  } catch (err) {
    console.error(err);
    toast(`No se pudo abrir la vista: ${err.message}`);
  }
}

// ── Buscador de lugares ──────────────────────────────────────────────────────

function initPlaceDialog() {
  const dlg = $('placeDialog');
  const input = $('placeSearch');
  const results = $('placeResults');

  const render = (list) => {
    if (!list.length) {
      results.innerHTML = `<p class="fineprint">Sin resultados. También puedes
        tocar directamente en el mapa para elegir un punto cualquiera.</p>`;
      return;
    }
    results.innerHTML = list.map((c, i) => {
      const circ = localCircumstances({ lat: c.lat, lon: c.lon, elev: c.elev });
      const tag = circ.type === 'total'
        ? `<span class="tag total">TOTAL ${fmtDuration(circ.durationTotality)}</span>`
        : `<span class="tag parcial">${(circ.max.obscuration * 100).toFixed(1)}%</span>`;
      return `<button type="button" class="place-item" data-i="${i}">
        ${tag}${c.nombre}<small>${c.provincia} · ${c.elev} m</small></button>`;
    }).join('');
    results.querySelectorAll('.place-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = list[+btn.dataset.i];
        setLocation(c.lat, c.lon, c.nombre, c.elev);
        dlg.close();
        if (state.view === 'mapa') modules.map?.flyToLocation?.();
      });
    });
  };

  input.addEventListener('input', () => render(buscarCiudades(input.value)));

  $('placeBtn').addEventListener('click', () => {
    input.value = '';
    render(CIUDADES.slice(0, 24));
    dlg.showModal();
    setTimeout(() => input.focus(), 60);
  });
}

// ── Geolocalización ──────────────────────────────────────────────────────────

export function locateMe() {
  if (!navigator.geolocation) {
    toast('Este navegador no permite geolocalización');
    return Promise.reject(new Error('sin geolocalización'));
  }
  toast('Localizando…');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords;
        setLocation(latitude, longitude, 'Mi ubicación', altitude ?? state.elev);
        resolve(pos);
      },
      (err) => {
        const msgs = {
          1: 'Permiso de ubicación denegado',
          2: 'No se pudo determinar la ubicación',
          3: 'La localización tardó demasiado',
        };
        toast(msgs[err.code] || 'Error de geolocalización');
        reject(err);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

// ── Panel deslizante ─────────────────────────────────────────────────────────

function initSheet() {
  const sheet = $('sheet');
  $('sheetHandle')?.addEventListener('click', () => { sheet.hidden = false; });
  $('sheetClose')?.addEventListener('click', () => { sheet.hidden = true; });
}

// ── Arranque ─────────────────────────────────────────────────────────────────

function init() {
  restoreLocation();
  recompute();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  initPlaceDialog();
  initSheet();

  tickCountdown();
  setInterval(tickCountdown, 1000);

  showView('mapa');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin offline, seguimos */ });
  }
}

// Exportado para que otras vistas puedan pedir un cambio de pestaña.
export { showView, modules, Clouds };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
