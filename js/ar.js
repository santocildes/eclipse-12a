// js/ar.js — realidad aumentada: dónde estará el Sol eclipsado, sobre la cámara.
//
// La idea: en vez de fiarte de un mapa, apuntas el móvil hacia donde estará el
// Sol y ves si hay algo delante. Es la comprobación definitiva, porque incluye
// lo que ningún modelo del terreno conoce: el edificio de enfrente, el chopo del
// vecino, la grúa de la obra.
//
// Sobre la precisión: la brújula de un móvil se desvía con facilidad 5-15° por
// interferencias magnéticas. Por eso la app muestra SIEMPRE el acimut y la
// altura en números —eso sí es exacto— y ofrece un ajuste manual del rumbo. El
// dibujo superpuesto es la ayuda visual; los números son la verdad.

import { eclipseState } from './eclipse.js';
import { horizonAt } from './terrain.js';
import { state, toast, cardinal, fmtTimeShort } from './app.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

let video, canvas, ctx, stream = null;
let orientation = null;      // { alpha, beta, gamma }
// Corrección manual de brújula, en grados. Se restaura de la sesión anterior:
// la desviación magnética depende del sitio, no del momento.
let headingOffset = Number(localStorage.getItem('ar_heading_offset') ?? 0) || 0;
let running = false;
let rafId = null;
// Campo de visión horizontal de la cámara trasera típica de un móvil. No hay
// forma fiable de leerlo desde el navegador, así que se asume un valor y se
// permite ajustarlo si el usuario ve que no cuadra.
let hfov = 62;

// ── Arranque ─────────────────────────────────────────────────────────────────

export function init() {
  video = $('arVideo');
  canvas = $('arCanvas');
  ctx = canvas.getContext('2d');
  $('btnAR').addEventListener('click', activar);
  $('arLeft').addEventListener('click', () => ajustarRumbo(-5));
  $('arRight').addEventListener('click', () => ajustarRumbo(5));
}

async function activar() {
  const err = $('arError');
  err.hidden = true;

  if (!window.isSecureContext) {
    mostrarError('La cámara solo funciona sobre HTTPS (o en localhost). '
      + 'Abre la app con una dirección https:// y vuelve a intentarlo.');
    return;
  }

  try {
    await pedirSensores();
    await pedirCamara();
    $('arStart').classList.add('hidden');
    $('arStage').classList.add('on');
    running = true;
    ajustarLienzo();
    bucle();
    toast('Busca la dirección marcada en pantalla');
  } catch (e) {
    mostrarError(e.message);
  }
}

function mostrarError(msg) {
  const err = $('arError');
  err.textContent = msg;
  err.hidden = false;
}

async function pedirCamara() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no da acceso a la cámara.');
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    const motivos = {
      NotAllowedError: 'Has denegado el acceso a la cámara. Actívalo en los ajustes del navegador.',
      NotFoundError: 'No se ha encontrado ninguna cámara en este dispositivo.',
      NotReadableError: 'La cámara está siendo usada por otra aplicación.',
    };
    throw new Error(motivos[e.name] || `No se pudo abrir la cámara (${e.name}).`);
  }
  video.srcObject = stream;
  await video.play();
}

async function pedirSensores() {
  // iOS 13+ exige pedir permiso explícito, y solo desde un gesto del usuario.
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    const res = await DOE.requestPermission();
    if (res !== 'granted') {
      throw new Error('Sin permiso para leer la orientación del dispositivo. '
        + 'Puedes seguir usando la brújula con los números de pantalla.');
    }
  }

  // `deviceorientationabsolute` da rumbo referido al norte magnético real;
  // `deviceorientation` a secas puede ser relativo al arranque y no serviría.
  const evento = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute' : 'deviceorientation';

  window.addEventListener(evento, (e) => {
    if (e.alpha === null && e.webkitCompassHeading === undefined) return;
    orientation = {
      // En iOS, webkitCompassHeading ya viene referido al norte y crece en
      // sentido horario; alpha crece al revés.
      alpha: e.webkitCompassHeading !== undefined
        ? 360 - e.webkitCompassHeading
        : (e.alpha ?? 0),
      beta: e.beta ?? 0,
      gamma: e.gamma ?? 0,
    };
  }, true);
}

export function pause() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('arStage')?.classList.remove('on');
  $('arStart')?.classList.remove('hidden');
}

export function tick() { /* el bucle propio ya refresca */ }

// ── Proyección ───────────────────────────────────────────────────────────────

/**
 * Matriz de rotación del dispositivo al marco terrestre (X=este, Y=norte, Z=arriba),
 * según la especificación W3C: R = Rz(α)·Rx(β)·Ry(γ).
 */
function matrizRotacion(alpha, beta, gamma) {
  const A = alpha * DEG, B = beta * DEG, C = gamma * DEG;
  const cA = Math.cos(A), sA = Math.sin(A);
  const cB = Math.cos(B), sB = Math.sin(B);
  const cC = Math.cos(C), sC = Math.sin(C);
  return [
    [cA * cC - sA * sB * sC, -sA * cB, cA * sC + sA * sB * cC],
    [sA * cC + cA * sB * sC,  cA * cB, sA * sC - cA * sB * cC],
    [-cB * sC,                sB,      cB * cC],
  ];
}

const col = (R, j) => [R[0][j], R[1][j], R[2][j]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Vector unitario de una dirección del cielo, en el marco terrestre. */
function vectorCielo(azDeg, altDeg) {
  const az = azDeg * DEG, alt = altDeg * DEG;
  return [
    Math.sin(az) * Math.cos(alt),  // este
    Math.cos(az) * Math.cos(alt),  // norte
    Math.sin(alt),                 // arriba
  ];
}

/**
 * Proyecta una dirección del cielo a coordenadas de pantalla.
 * @returns {{x:number, y:number, visible:boolean, angle:number}}
 *   `visible` false si queda a la espalda; `angle` = separación al centro.
 */
function proyectar(azDeg, altDeg, W, H) {
  if (!orientation) return { x: W / 2, y: H / 2, visible: false, angle: 180 };

  const R = matrizRotacion(orientation.alpha + headingOffset, orientation.beta, orientation.gamma);

  // Ejes de la cámara: mira por −Z del dispositivo; la pantalla define derecha
  // (+X) y arriba (+Y).
  let derecha = col(R, 0);
  let arriba = col(R, 1);
  let frente = col(R, 2).map((v) => -v);

  // Corrección por giro de pantalla: al poner el móvil en horizontal, los ejes
  // de la pantalla rotan respecto a los del dispositivo.
  const giro = (screen.orientation?.angle ?? window.orientation ?? 0) * DEG;
  if (giro) {
    const c = Math.cos(giro), s = Math.sin(giro);
    const d2 = derecha.map((v, i) => c * v - s * arriba[i]);
    const a2 = derecha.map((v, i) => s * v + c * arriba[i]);
    derecha = d2; arriba = a2;
  }

  const v = vectorCielo(azDeg, altDeg);
  const d = dot(v, frente);
  const ang = Math.acos(Math.max(-1, Math.min(1, d))) / DEG;

  if (d <= 0.05) {
    // A la espalda o casi perpendicular: la proyección se dispara.
    return { x: W / 2, y: H / 2, visible: false, angle: ang,
             offX: dot(v, derecha), offY: dot(v, arriba) };
  }

  const f = (W / 2) / Math.tan((hfov / 2) * DEG);
  return {
    x: W / 2 + (dot(v, derecha) / d) * f,
    y: H / 2 - (dot(v, arriba) / d) * f,
    visible: true,
    angle: ang,
    offX: dot(v, derecha), offY: dot(v, arriba),
  };
}

// ── Dibujo ───────────────────────────────────────────────────────────────────

function ajustarLienzo() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function bucle() {
  if (!running) return;
  dibujar();
  rafId = requestAnimationFrame(bucle);
}

function dibujar() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * Math.min(2, devicePixelRatio || 1)) ajustarLienzo();
  ctx.clearRect(0, 0, W, H);

  const obs = { lat: state.lat, lon: state.lon, elev: state.elev };
  const c = state.circ;
  if (!c?.visible) return;

  // Se muestra el instante ACTUAL si el eclipse está en curso; si no, el máximo.
  // Así la app sirve igual para planificar días antes que durante el evento.
  const ahora = Date.now();
  const enCurso = c.contacts.c1 && c.contacts.c4
    && ahora >= c.contacts.c1.getTime() && ahora <= c.contacts.c4.getTime();
  const momento = enCurso ? new Date(ahora) : c.max.date;
  const st = eclipseState(momento, obs);

  const pxPorGrado = (W / 2) / Math.tan((hfov / 2) * DEG) * DEG;
  const p = proyectar(st.sun.az, st.sun.alt, W, H);

  dibujarHorizonte(W, H, pxPorGrado);

  if (p.visible && p.x > -200 && p.x < W + 200 && p.y > -200 && p.y < H + 200) {
    dibujarSol(p.x, p.y, st, pxPorGrado);
  } else {
    dibujarFlecha(W, H, p, st);
  }

  actualizarHUD(st, p, enCurso, momento);
}

/**
 * Silueta del terreno sobre la imagen de la cámara. Permite comparar de un
 * vistazo el horizonte calculado con el que se ve de verdad — y de paso
 * comprobar si la brújula está bien orientada.
 */
function dibujarHorizonte(W, H, pxPorGrado) {
  const prof = state.horizonProfile;
  if (!prof || !orientation) return;

  ctx.beginPath();
  let iniciado = false;
  for (let dx = -40; dx <= 40; dx += 1) {
    const az = (state.circ.max.sun.az + dx + 360) % 360;
    const alt = horizonAt(prof, az);
    const p = proyectar(az, alt, W, H);
    if (!p.visible) { iniciado = false; continue; }
    if (!iniciado) { ctx.moveTo(p.x, p.y); iniciado = true; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(110,220,180,.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** El Sol con la mordida real de la Luna, orientada como se verá. */
function dibujarSol(x, y, st, pxPorGrado) {
  // El Sol mide medio grado: a escala real serían unos pocos píxeles, invisible.
  // Se dibuja aumentado para que se vea la fase, manteniendo la PROPORCIÓN
  // correcta entre los discos y la dirección del desplazamiento lunar.
  const escala = 26;
  const rSol = Math.max(16, st.sun.sd * pxPorGrado * escala);
  const rLuna = rSol * (st.moon.sd / st.sun.sd);
  const sep = st.sep * pxPorGrado * escala;

  // Dirección del desplazamiento de la Luna respecto al Sol, en pantalla.
  const dx = st.offset.dx, dy = st.offset.dy;
  const norma = Math.hypot(dx, dy) || 1;
  const mx = x + (dx / norma) * sep;
  const my = y - (dy / norma) * sep;

  const total = st.isTotal;

  // Halo / corona
  const halo = ctx.createRadialGradient(x, y, rSol * 0.6, x, y, rSol * (total ? 3.4 : 2.1));
  if (total) {
    halo.addColorStop(0, 'rgba(207,227,255,.55)');
    halo.addColorStop(0.5, 'rgba(160,190,255,.22)');
    halo.addColorStop(1, 'rgba(120,150,255,0)');
  } else {
    halo.addColorStop(0, 'rgba(255,200,90,.5)');
    halo.addColorStop(1, 'rgba(255,160,60,0)');
  }
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, rSol * (total ? 3.4 : 2.1), 0, Math.PI * 2); ctx.fill();

  // Disco solar
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, rSol, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = total ? '#0a0a12' : '#ffd45e';
  ctx.fillRect(x - rSol, y - rSol, rSol * 2, rSol * 2);
  // Disco lunar recortando el solar
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(mx, my, rLuna, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Borde
  ctx.beginPath(); ctx.arc(x, y, rSol, 0, Math.PI * 2);
  ctx.strokeStyle = total ? 'rgba(207,227,255,.9)' : 'rgba(255,220,140,.75)';
  ctx.lineWidth = 2; ctx.stroke();

  // Retículo de puntería
  ctx.beginPath(); ctx.arc(x, y, rSol * 4.2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
}

/** Flecha hacia el Sol cuando queda fuera de encuadre. */
function dibujarFlecha(W, H, p, st) {
  const cx = W / 2, cy = H / 2;
  let ang;
  if (p.visible) {
    ang = Math.atan2(p.y - cy, p.x - cx);
  } else {
    // A la espalda: se usa la componente lateral para saber por dónde girar.
    ang = Math.atan2(-(p.offY ?? 0), p.offX ?? 1);
  }
  const r = Math.min(W, H) * 0.3;
  const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(26, 0); ctx.lineTo(-14, 15); ctx.lineTo(-6, 0); ctx.lineTo(-14, -15);
  ctx.closePath();
  ctx.fillStyle = '#ffb238';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();

  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = '#ffd08a';
  ctx.textAlign = 'center';
  ctx.fillText('Gira hacia aquí', cx + Math.cos(ang) * (r + 34), cy + Math.sin(ang) * (r + 34));
}

// ── Panel numérico ───────────────────────────────────────────────────────────

function actualizarHUD(st, p, enCurso, momento) {
  const readout = $('arReadout');
  const rumbo = orientation
    ? ((orientation.alpha + headingOffset) % 360 + 360) % 360
    : null;

  const chips = [
    `<span class="ar-chip hot">Sol · ${cardinal(st.sun.az)} ${st.sun.az.toFixed(0)}° · alt ${st.sun.alt.toFixed(1)}°</span>`,
    rumbo !== null
      ? `<span class="ar-chip">Miras al ${cardinal(rumbo)} ${rumbo.toFixed(0)}°</span>`
      : '<span class="ar-chip">Sin brújula</span>',
    `<span class="ar-chip">${enCurso
        ? `Obscuración ${(st.obscuration * 100).toFixed(1)}%`
        : `Máximo ${fmtTimeShort(momento)}`}</span>`,
  ];

  if (state.horizonProfile) {
    const h = horizonAt(state.horizonProfile, st.sun.az);
    const libre = st.sun.alt - h;
    chips.push(`<span class="ar-chip" style="border-color:${libre > 0 ? 'var(--good)' : 'var(--bad)'}">
      ${libre > 0 ? `Libre por ${libre.toFixed(1)}°` : `Tapado ${Math.abs(libre).toFixed(1)}°`}</span>`);
  }

  readout.innerHTML = chips.join('');

  const guia = $('arGuide');
  if (!orientation) {
    guia.textContent = 'Mueve el móvil en forma de 8 para calibrar la brújula';
  } else if (p.visible && p.angle < 6) {
    guia.textContent = st.isTotal ? '¡Ahí estará la totalidad!' : 'Justo ahí estará el Sol';
  } else {
    guia.textContent = `A ${p.angle.toFixed(0)}° de donde apuntas`;
  }
}

// ── Ajuste manual del rumbo ──────────────────────────────────────────────────
// La brújula del móvil se desvía con facilidad. Dos toques en la pantalla
// permiten corregirla sin salir de la vista.

export function ajustarRumbo(delta) {
  headingOffset = ((headingOffset + delta) % 360 + 360) % 360;
  const mostrado = headingOffset > 180 ? headingOffset - 360 : headingOffset;
  $('arCalibLabel').textContent = `brújula ${mostrado > 0 ? '+' : ''}${mostrado}°`;
  // Se guarda: la desviación magnética del sitio no cambia entre sesiones, y
  // volver a calibrar cada vez sería un incordio el día del eclipse.
  try { localStorage.setItem('ar_heading_offset', String(headingOffset)); } catch { /* modo privado */ }
}
