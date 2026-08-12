// js/horizon-view.js — perfil de horizonte y veredicto de visibilidad.

import { horizonProfile, checkVisibility, findBetterSpots } from './terrain.js';
import { eclipseState } from './eclipse.js';
import { state, setLocation, recompute, toast, cardinal } from './app.js';

const $ = (id) => document.getElementById(id);
let calculando = false;

export function init() {
  $('btnHorizon').addEventListener('click', calcular);
  $('btnBetterSpots').addEventListener('click', buscarMejores);

  // Al cambiar de sitio, el perfil anterior deja de valer.
  document.addEventListener('eclipse:location', () => {
    if (!state.horizonProfile) {
      $('horizonResult').hidden = true;
      $('betterSpots').innerHTML = '';
    }
  });
}

async function calcular() {
  if (calculando) return;
  const c = state.circ;
  if (!c?.visible) { toast('Desde este punto no hay eclipse que ver'); return; }

  calculando = true;
  const btn = $('btnHorizon');
  btn.disabled = true;
  btn.textContent = 'Descargando el relieve…';
  const prog = $('horizonProgress');
  prog.hidden = false;
  const bar = prog.querySelector('.bar');

  try {
    const profile = await horizonProfile(state.lat, state.lon, {
      onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; },
    });

    if (profile.coverage < 0.5) {
      toast('No se pudo descargar bastante relieve. ¿Hay conexión?');
    }

    const sun = c.max.sun;
    profile.check = checkVisibility(profile, sun.az, sun.alt);
    state.horizonProfile = profile;

    // La altitud medida del terreno suele diferir de la que traía la ciudad;
    // se adopta la real porque cambia los tiempos ligeramente.
    if (Math.abs(profile.observerElevation - state.elev) > 40) {
      state.elev = profile.observerElevation;
      recompute();
      profile.check = checkVisibility(profile, state.circ.max.sun.az, state.circ.max.sun.alt);
    }

    render(profile);
    $('horizonResult').hidden = false;
  } catch (err) {
    console.error(err);
    toast(`No se pudo calcular el horizonte: ${err.message}`);
  } finally {
    calculando = false;
    btn.disabled = false;
    btn.textContent = 'Recalcular mi horizonte';
    prog.hidden = true;
    bar.style.width = '0';
  }
}

function render(profile) {
  const c = state.circ;
  const sun = c.max.sun;
  const { blocked, margin, horizonAlt, obstacleDistanceM } = profile.check;

  // ── Veredicto ──
  const card = $('horizonVerdict');
  let cls, titulo, texto;

  if (blocked) {
    cls = 'no';
    titulo = 'Desde aquí no lo verás';
    texto = `En dirección ${cardinal(sun.az)} el terreno se levanta hasta
      ${horizonAlt.toFixed(1)}°, y el Sol solo llegará a ${sun.alt.toFixed(1)}°.
      El obstáculo está a unos ${(obstacleDistanceM / 1000).toFixed(1)} km.
      Tendrás que moverte.`;
  } else if (margin < 1) {
    cls = 'tight';
    titulo = 'Al límite';
    texto = `El Sol quedará solo ${margin.toFixed(1)}° por encima del relieve —
      apenas ${(margin / 0.53).toFixed(1)} diámetros solares. Cualquier árbol o
      edificio que no esté en el modelo del terreno puede taparlo. Busca un punto
      algo más alto o despejado.`;
  } else if (margin < 3) {
    cls = 'tight';
    titulo = 'Justo, pero se ve';
    texto = `El Sol quedará ${margin.toFixed(1)}° sobre el horizonte real
      (relieve a ${horizonAlt.toFixed(1)}°). Vigila los obstáculos cercanos:
      el modelo del terreno no incluye ni arbolado ni edificios.`;
  } else {
    cls = 'ok';
    titulo = 'Horizonte despejado';
    texto = `El Sol estará ${margin.toFixed(1)}° por encima del relieve en
      dirección ${cardinal(sun.az)}. Desde aquí tienes vista limpia.`;
  }

  card.className = `verdict-card ${cls}`;
  card.innerHTML = `<div class="big">${titulo}</div><p>${texto}</p>`;

  // ── Estadísticas ──
  $('horizonStats').innerHTML = `
    <div class="stat"><div class="k">Tu altitud</div>
      <div class="v">${Math.round(profile.observerElevation)}<span class="u"> m</span></div></div>
    <div class="stat"><div class="k">Horizonte al ${cardinal(sun.az)}</div>
      <div class="v">${horizonAlt.toFixed(1)}<span class="u">°</span></div></div>
    <div class="stat"><div class="k">Sol en el máximo</div>
      <div class="v">${sun.alt.toFixed(1)}<span class="u">°</span></div></div>
    <div class="stat"><div class="k">Margen</div>
      <div class="v" style="color:${blocked ? 'var(--bad)' : margin < 3 ? 'var(--mixed)' : 'var(--good)'}">
        ${margin > 0 ? '+' : ''}${margin.toFixed(1)}<span class="u">°</span></div></div>`;

  dibujarPerfil(profile, sun);
}

// ── Gráfico del perfil ───────────────────────────────────────────────────────

function dibujarPerfil(profile, sun) {
  const cv = $('horizonChart');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 800, H = 340;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 38, padR = 12, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // El eje vertical se ajusta al relieve real, con un mínimo para que un
  // horizonte llano no se vea deformado.
  const maxH = Math.max(12, Math.ceil(Math.max(...profile.horizon) + 3));
  const minH = Math.min(-3, Math.floor(Math.min(...profile.horizon) - 1));
  const yOf = (deg) => padT + plotH * (1 - (deg - minH) / (maxH - minH));
  const xOf = (az) => padL + plotW * (az / 360);

  g.fillStyle = '#0e1424';
  g.fillRect(0, 0, W, H);

  // Rejilla y etiquetas de acimut
  g.strokeStyle = '#26304a'; g.fillStyle = '#64708c';
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
  for (const [az, lbl] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'O'], [360, 'N']]) {
    const x = xOf(az);
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + plotH); g.stroke();
    g.fillText(lbl, x, H - 10);
  }
  g.textAlign = 'right';
  for (let d = Math.ceil(minH / 5) * 5; d <= maxH; d += 5) {
    const y = yOf(d);
    // La línea del 0° se destaca: es la referencia del horizonte llano.
    g.strokeStyle = d === 0 ? '#3d4a6b' : '#1b2338';
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
    g.fillStyle = '#64708c';
    g.fillText(`${d}°`, padL - 6, y + 4);
  }

  // Relleno del terreno
  g.beginPath();
  g.moveTo(xOf(0), padT + plotH);
  profile.azimuths.forEach((az, i) => g.lineTo(xOf(az), yOf(profile.horizon[i])));
  g.lineTo(xOf(360), padT + plotH);
  g.closePath();
  const grad = g.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, 'rgba(60,74,110,.85)');
  grad.addColorStop(1, 'rgba(22,30,51,.95)');
  g.fillStyle = grad; g.fill();

  g.beginPath();
  profile.azimuths.forEach((az, i) => {
    const x = xOf(az), y = yOf(profile.horizon[i]);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = '#8fa0c4'; g.lineWidth = 1.5; g.stroke();

  // Trayectoria del Sol durante el eclipse: no basta con el punto del máximo,
  // porque el Sol se mueve mientras dura y puede esconderse a mitad.
  const c = state.circ;
  if (c?.contacts?.c1 && c?.contacts?.c4) {
    const pts = [];
    const t0 = c.contacts.c1.getTime(), t1 = c.contacts.c4.getTime();
    for (let i = 0; i <= 40; i++) {
      const d = new Date(t0 + ((t1 - t0) * i) / 40);
      const st = eclipseSunAt(d);
      if (st) pts.push(st);
    }
    g.beginPath();
    pts.forEach((p, i) => {
      const x = xOf(p.az), y = yOf(p.alt);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = 'rgba(255,178,56,.5)'; g.lineWidth = 2;
    g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
  }

  // Posición del Sol en el máximo
  const sx = xOf(sun.az), sy = yOf(sun.alt);
  const tapado = profile.check.blocked;
  g.beginPath(); g.arc(sx, sy, 13, 0, Math.PI * 2);
  g.fillStyle = tapado ? 'rgba(255,92,110,.2)' : 'rgba(255,178,56,.25)'; g.fill();
  g.beginPath(); g.arc(sx, sy, 6.5, 0, Math.PI * 2);
  g.fillStyle = tapado ? '#ff5c6e' : '#ffb238'; g.fill();
  g.strokeStyle = '#0e1424'; g.lineWidth = 2; g.stroke();

  g.fillStyle = tapado ? '#ff9aa6' : '#ffd08a';
  g.font = '600 11px system-ui, sans-serif';
  g.textAlign = sun.az > 300 ? 'right' : 'left';
  g.fillText(
    tapado ? 'Sol tapado' : 'Sol en el máximo',
    sx + (sun.az > 300 ? -12 : 12), sy - 12,
  );
}

function eclipseSunAt(date) {
  const st = eclipseState(date, { lat: state.lat, lon: state.lon, elev: state.elev });
  return { az: st.sun.az, alt: st.sun.alt };
}

// ── Búsqueda de puntos mejores ───────────────────────────────────────────────

async function buscarMejores() {
  const btn = $('btnBetterSpots');
  const cont = $('betterSpots');
  const sun = state.circ?.max?.sun;
  if (!sun) return;

  btn.disabled = true;
  btn.textContent = 'Explorando los alrededores…';
  cont.innerHTML = '';

  try {
    const spots = await findBetterSpots(state.lat, state.lon, sun.az, sun.alt, {
      radiusKm: 8, samples: 3,
      onProgress: (p) => { btn.textContent = `Explorando… ${Math.round(p * 100)}%`; },
    });

    if (!spots.length) {
      cont.innerHTML = `<div class="notice warn">No he encontrado ningún punto
        claramente mejor en 8 km a la redonda. Prueba a alejarte más o busca
        una cota alta en el mapa.</div>`;
      return;
    }

    const mejores = spots.slice(0, 5);
    cont.innerHTML = `<div class="card"><h4>Puntos con mejor horizonte</h4>${
      mejores.map((s, i) => `
        <div class="timeline-row">
          <span>${(s.distanceM / 1000).toFixed(1)} km al ${cardinal(bearingTo(s))}
            <span class="sub">${Math.round(s.elevation)} m · margen +${s.margin.toFixed(1)}°</span></span>
          <button class="cta ghost" style="width:auto;margin:0;padding:6px 12px;font-size:.8rem"
                  data-i="${i}">Ir</button>
        </div>`).join('')
    }</div>
    <p class="fineprint">Solo se ha comparado la altura del terreno en la
      dirección del Sol. No se tienen en cuenta accesos, caminos ni si el punto
      es público — compruébalo antes de desplazarte.</p>`;

    cont.querySelectorAll('button[data-i]').forEach((b) => {
      b.addEventListener('click', () => {
        const s = mejores[+b.dataset.i];
        setLocation(s.lat, s.lon, `Punto a ${(s.distanceM / 1000).toFixed(1)} km`, s.elevation);
        toast('Ubicación cambiada. Recalcula el horizonte para confirmar.');
      });
    });
  } catch (err) {
    console.error(err);
    toast('No se pudo explorar la zona');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar un punto mejor cerca';
  }
}

function bearingTo(spot) {
  const dLon = (spot.lon - state.lon) * Math.cos((state.lat * Math.PI) / 180);
  const dLat = spot.lat - state.lat;
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}
