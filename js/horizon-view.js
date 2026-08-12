// js/horizon-view.js — perfil del terreno en la dirección del Sol.
//
// El gráfico es una SECCIÓN del terreno a lo largo del rayo visual: distancia
// en horizontal, altura en vertical. Sobre ella se traza el rayo del Sol en el
// momento del eclipse. Si el terreno cruza por encima de la recta, te tapa —y
// se ve exactamente dónde y a qué distancia.
//
// Antes había un gráfico de los 360°, que decía mucho de golpe pero no
// respondía a lo único que importa: qué hay entre tú y el Sol.

import {
  horizonProfile, checkVisibility, findBetterSpots, sunRayProfile,
  sunsetBehindTerrain,
} from './terrain.js';
import { eclipseState } from './eclipse.js';
import { state, setLocation, recompute, toast, cardinal, fmtTime } from './app.js';

const $ = (id) => document.getElementById(id);
let calculando = false;
let perfilRayo = null;

// Alcance del muestreo. Se guarda largo porque el cálculo debe considerar
// sierras lejanas, pero el GRÁFICO se dibuja mucho más corto: para tapar el Sol
// a 8° hace falta que algo se eleve 140 m por cada km de distancia, así que a
// 1 km basta un cerro de 140 m, a 5 km hace falta una montaña de 700 m y a
// 15 km una de 2.100 m. Casi todo lo que estorba de verdad está en los primeros
// kilómetros; el resto se consulta con el selector.
const MUESTREO_M = 40000;
let alcanceVista = 4000;

export function init() {
  $('btnHorizon').addEventListener('click', calcular);
  $('btnBetterSpots').addEventListener('click', buscarMejores);

  $('rangePicker').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    alcanceVista = Number(b.dataset.m);
    $('rangePicker').querySelectorAll('button')
      .forEach((x) => x.classList.toggle('on', x === b));
    if (perfilRayo) dibujarSeccion();
  });

  document.addEventListener('eclipse:location', () => {
    if (!state.horizonProfile) {
      $('horizonResult').hidden = true;
      $('betterSpots').innerHTML = '';
      perfilRayo = null;
    }
  });
  window.addEventListener('resize', () => { if (perfilRayo) dibujarSeccion(); });
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
    const sun = c.max.sun;

    // La sección en la dirección del Sol es lo que se dibuja; el perfil de 360°
    // se sigue necesitando para el veredicto y para el ocaso tras el relieve.
    perfilRayo = await sunRayProfile(state.lat, state.lon, sun.az, sun.alt, {
      maxDistM: MUESTREO_M, pasoM: 50,
    });
    bar.style.width = '55%';

    const profile = await horizonProfile(state.lat, state.lon, {
      onProgress: (p) => { bar.style.width = `${55 + Math.round(p * 45)}%`; },
    });
    if (profile.coverage < 0.5) toast('No se pudo descargar bastante relieve. ¿Hay conexión?');

    profile.check = checkVisibility(profile, sun.az, sun.alt);
    state.horizonProfile = profile;

    // La altitud medida suele diferir de la que traía la ciudad; se adopta la
    // real porque cambia ligeramente los tiempos.
    if (Math.abs(profile.observerElevation - state.elev) > 40) {
      state.elev = profile.observerElevation;
      recompute();
      profile.check = checkVisibility(profile, state.circ.max.sun.az, state.circ.max.sun.alt);
    }

    // Ocaso real: cuándo el Sol se mete detrás del relieve.
    const obs = { lat: state.lat, lon: state.lon, elev: state.elev };
    const posSol = (d) => {
      const st = eclipseState(d, obs);
      return { alt: st.sun.alt, az: st.sun.az };
    };
    profile.ocasoRelieve = sunsetBehindTerrain(
      profile, posSol, c.max.date.getTime() - 3 * 3600000, c.max.date.getTime() + 5 * 3600000,
    );

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
      El obstáculo está a unos ${((perfilRayo?.distanciaBloqueoM ?? obstacleDistanceM) / 1000).toFixed(1)} km.
      Tendrás que moverte.`;
  } else if (margin < 1) {
    cls = 'tight';
    titulo = 'Al límite';
    texto = `El Sol quedará solo ${margin.toFixed(1)}° por encima del relieve —
      apenas ${(margin / 0.53).toFixed(1)} diámetros solares. Cualquier árbol o
      edificio que no esté en el modelo del terreno puede taparlo.`;
  } else if (margin < 3) {
    cls = 'tight';
    titulo = 'Justo, pero se ve';
    texto = `El Sol quedará ${margin.toFixed(1)}° sobre el relieve real
      (horizonte a ${horizonAlt.toFixed(1)}°). Vigila los obstáculos cercanos:
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
  const oc = profile.ocasoRelieve;
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

  // ── Ocaso tras el relieve ──
  // Es el dato que ningún almanaque da: la hora a la que el Sol desaparece
  // detrás de la ladera, que puede ser bastante antes del ocaso teórico.
  const box = $('ocasoRelieve');
  if (oc) {
    const teorico = state.sunset;
    const adelanto = teorico ? Math.round((teorico - oc.fecha) / 60000) : null;
    const finEclipse = c.contacts.c4;
    const cortaEclipse = finEclipse && oc.fecha < finEclipse;
    box.hidden = false;
    box.className = `notice ${cortaEclipse ? 'warn' : ''}`;
    box.innerHTML = `
      <strong>El Sol se te oculta a las ${fmtTime(oc.fecha)}</strong>, cuando se
      mete detrás del relieve (a ${oc.altHorizonte.toFixed(1)}° de altura, hacia
      el ${cardinal(oc.azimut)}).
      ${adelanto !== null && adelanto > 1
        ? `Son <strong>${adelanto} minutos antes</strong> que el ocaso teórico de las
           ${fmtTime(teorico)}, que supone un horizonte llano.` : ''}
      ${cortaEclipse
        ? ` El eclipse termina a las ${fmtTime(finEclipse)}: no llegarás a ver el final.`
        : ' Llegas a ver el eclipse completo.'}`;
  } else {
    box.hidden = true;
  }

  dibujarSeccion();
}

// ── Sección del terreno ──────────────────────────────────────────────────────

function dibujarSeccion() {
  const cv = $('horizonChart');
  if (!perfilRayo?.puntos?.length) return;
  const c = state.circ;
  const sun = c.max.sun;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 800, H = 320;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 48, padR = 14, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const ojo = perfilRayo.alturaOjo;
  const pts = perfilRayo.puntos;
  const maxDist = alcanceVista;

  // El rayo del Sol sube en la gráfica porque la Tierra se curva bajo él: a
  // 40 km el suelo ya ha caído 107 m. Incluir ese término deja la comparación
  // exacta aunque el eje vertical siga siendo cota sobre el nivel del mar,
  // que es lo que la gente sabe leer.
  const EFECTIVO_R = 6371000 * 7 / 6;
  const alturaRayo = (d, altGrados) =>
    ojo + d * Math.tan(altGrados * Math.PI / 180) + (d * d) / (2 * EFECTIVO_R);

  // Solo entran en la escala vertical los puntos del tramo visible.
  const visibles = pts.filter((p) => p.distM <= maxDist);
  const cotas = visibles.map((p) => p.elev);
  const rayoMax = alturaRayo(maxDist, sun.alt);
  const alto = Math.max(...cotas, rayoMax, ojo + 50);
  const bajo = Math.min(...cotas, ojo) - 40;
  const rango = Math.max(120, alto - bajo);

  const xOf = (d) => padL + (plotW * d) / maxDist;
  const yOf = (z) => padT + plotH * (1 - (z - bajo) / rango);

  g.fillStyle = '#0e1424'; g.fillRect(0, 0, W, H);

  // Rejilla
  g.font = '11px system-ui, sans-serif';
  g.strokeStyle = '#1b2338'; g.fillStyle = '#64708c';
  g.textAlign = 'right';
  const pasoZ = rango > 2000 ? 500 : rango > 800 ? 200 : 100;
  for (let z = Math.ceil(bajo / pasoZ) * pasoZ; z <= alto; z += pasoZ) {
    const y = yOf(z);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
    g.fillText(`${z} m`, padL - 6, y + 4);
  }
  g.textAlign = 'center';
  const pasoKm = maxDist <= 1500 ? 0.25 : maxDist <= 5000 ? 1 : maxDist <= 15000 ? 3 : 10;
  for (let km = 0; km <= maxDist / 1000 + 1e-6; km += pasoKm) {
    const x = xOf(km * 1000);
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + plotH); g.stroke();
    g.fillText(km < 1 ? `${km * 1000} m` : `${km} km`, x, H - 9);
  }

  // Terreno
  g.beginPath();
  g.moveTo(xOf(0), yOf(ojo));
  visibles.forEach((p) => g.lineTo(xOf(p.distM), yOf(p.elev)));
  g.lineTo(xOf(maxDist), padT + plotH);
  g.lineTo(xOf(0), padT + plotH);
  g.closePath();
  const grad = g.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, 'rgba(96,112,150,.9)');
  grad.addColorStop(1, 'rgba(26,34,58,.95)');
  g.fillStyle = grad; g.fill();
  g.beginPath();
  visibles.forEach((p, i) => (i ? g.lineTo(xOf(p.distM), yOf(p.elev)) : g.moveTo(xOf(p.distM), yOf(p.elev))));
  g.strokeStyle = '#9fb0d0'; g.lineWidth = 1.4; g.stroke();

  // Rayo al final del eclipse: el Sol sigue bajando mientras dura, y algo que
  // ahora se ve puede quedar tapado antes del último contacto.
  if (c.contacts?.c4) {
    const stFin = eclipseState(c.contacts.c4, { lat: state.lat, lon: state.lon, elev: state.elev });
    if (stFin.sun.alt > 0) {
      g.beginPath();
      g.moveTo(xOf(0), yOf(ojo));
      g.lineTo(xOf(maxDist), yOf(alturaRayo(maxDist, stFin.sun.alt)));
      g.strokeStyle = 'rgba(255,178,56,.35)'; g.lineWidth = 1.5;
      g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    }
  }

  // Rayo en el máximo, en dos tramos: naranja mientras hay visión libre y rojo
  // a partir del punto en que el terreno se interpone. Mismo código de color
  // que la línea del mapa, para que se lean igual.
  const corte = perfilRayo.distanciaBloqueoM;
  const dLibre = corte === null ? maxDist : Math.min(corte, maxDist);

  g.beginPath();
  g.moveTo(xOf(0), yOf(ojo));
  g.lineTo(xOf(dLibre), yOf(alturaRayo(dLibre, sun.alt)));
  g.strokeStyle = '#ffb238'; g.lineWidth = 2.5; g.stroke();

  if (corte !== null && corte < maxDist) {
    g.beginPath();
    g.moveTo(xOf(dLibre), yOf(alturaRayo(dLibre, sun.alt)));
    g.lineTo(xOf(maxDist), yOf(alturaRayo(maxDist, sun.alt)));
    g.strokeStyle = '#ff5c6e'; g.lineWidth = 2.5; g.stroke();
  }

  // Punto de bloqueo
  if (corte !== null && corte <= maxDist) {
    const d = corte;
    const x = xOf(d), y = yOf(alturaRayo(d, sun.alt));
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,92,110,.25)'; g.fill();
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2);
    g.fillStyle = '#ff5c6e'; g.fill();
    g.fillStyle = '#ff9aa6';
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = x > W * 0.6 ? 'right' : 'left';
    g.fillText(`el terreno lo tapa a ${(d / 1000).toFixed(1)} km`,
               x + (x > W * 0.6 ? -10 : 10), y - 10);
  }

  // Observador
  g.beginPath(); g.arc(xOf(0), yOf(ojo), 5, 0, Math.PI * 2);
  g.fillStyle = '#ffb238'; g.strokeStyle = '#0e1424'; g.lineWidth = 2;
  g.fill(); g.stroke();

  // Rótulo de dirección
  g.fillStyle = '#97a2bb';
  g.font = '600 11px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(`Sección hacia el ${cardinal(sun.az)} (${sun.az.toFixed(0)}°) — la dirección del Sol`,
             padL + 4, padT + 13);
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
