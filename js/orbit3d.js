// js/orbit3d.js — simulación 3D del sistema Tierra-Luna-Sol durante el eclipse.
//
// Las posiciones NO son decorativas: la dirección del Sol, la posición de la
// Luna y la orientación de la Tierra salen de las mismas efemérides que calculan
// los horarios de la app. Por eso la sombra cae donde cae de verdad.
//
// Qué está a escala y qué no:
//   · Distancia Tierra-Luna .... a escala (60 radios terrestres)
//   · Tamaño de la Luna ........ a escala (0.273 radios terrestres)
//   · Geometría de la sombra ... a escala (el cono de umbra es así de fino)
//   · Posición del Sol ......... dirección correcta, distancia comprimida
//     (a escala real estaría 23.500 radios terrestres: fuera de cualquier pantalla)

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { bodyVectors, shadowAxisPoint } from './shadow.js';
import { centuriesTT, julianDay, greenwichSiderealTime, sunPosition } from './astro.js';
import { CONFIG } from './config.js';
import { state, fmtTime } from './app.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

const R_EARTH_KM = 6378.137;
const SUN_VIEW_DIST = 600;   // distancia comprimida del Sol, en radios terrestres

let renderer, scene, camera, raf = null;
let earth, moon, sunMesh, sunLight, umbraCone, penumbraCone, shadowSpot, marcadorUsuario;
let pathLine, moonOrbitLine;
let corriendo = false, reproduciendo = false, velocidad = 60;
let tActual = Date.parse(`${CONFIG.eclipseDate}T18:28:00Z`);
let modoVista = 'tierra';

// Ventana temporal que recorre el deslizador: todo el paso de la sombra.
const T_INICIO = Date.parse(`${CONFIG.eclipseDate}T16:40:00Z`);
const T_FIN = Date.parse(`${CONFIG.eclipseDate}T18:50:00Z`);

// ── Construcción de la escena ────────────────────────────────────────────────

export async function init() {
  const stage = $('orbitStage');

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, stage.clientWidth / stage.clientHeight, 0.1, 5000);

  crearEstrellas();
  await crearTierra();
  crearLuna();
  crearSol();
  crearSombra();
  crearTrayectoria();

  controlesCamara(renderer.domElement);
  cablearControles();

  window.addEventListener('resize', redimensionar);

  $('orbitView').textContent = VISTAS[modoVista].etiqueta;
  corriendo = true;
  colocarCamara();
  actualizar(tActual);
  bucle();
}

function crearEstrellas() {
  // Estrellas de fondo. Posiciones aleatorias: no pretenden ser el cielo real,
  // solo dar sensación de profundidad.
  const N = 1500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const r = 1200 + Math.random() * 600;
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xbfd0ee, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75,
  })));
}

/**
 * Textura de la Tierra a partir de teselas reales.
 *
 * Las teselas web son Mercator y la esfera de Three.js espera equirectangular,
 * así que hay que remuestrear: para cada fila de la textura destino se calcula
 * qué latitud le corresponde y de qué fila Mercator hay que leer. Sin ese paso,
 * los continentes saldrían estirados hacia los polos.
 *
 * Si no hay red, se cae a un degradado sobrio en vez de dejar la esfera negra.
 */
async function crearTierra() {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const mat = new THREE.MeshPhongMaterial({
    color: 0xffffff, shininess: 12, specular: 0x223344,
  });

  earth = new THREE.Mesh(geo, mat);
  scene.add(earth);

  // Atmósfera: una esfera algo mayor, vista por dentro, que simula la dispersión.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5b9bff, transparent: true, opacity: 0.13, side: THREE.BackSide,
    }),
  );
  // Hijo de la Tierra para que acompañe su rotación y su escala.
  earth.add(halo);

  try {
    mat.map = await texturaDesdeTeselas();
    mat.needsUpdate = true;
  } catch {
    mat.map = texturaDeReserva();
    mat.needsUpdate = true;
  }
}

// Fuentes de textura, por orden de preferencia. Ambas verificadas: responden
// con CORS abierto y sin clave.
const FUENTES_TEXTURA = [
  { // Imaginería satélite real: la Tierra se ve como es.
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    zoom: 3,
  },
  { // Reserva cartográfica, por si ESRI falla.
    url: (z, x, y) => `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
    zoom: 3,
  },
];

async function texturaDesdeTeselas() {
  for (const fuente of FUENTES_TEXTURA) {
    try {
      return await componerTextura(fuente);
    } catch { /* se prueba la siguiente */ }
  }
  throw new Error('ninguna fuente de textura disponible');
}

async function componerTextura(fuente) {
  const Z = fuente.zoom, N = 2 ** Z, TS = 256;
  const merc = document.createElement('canvas');
  merc.width = N * TS; merc.height = N * TS;
  const mg = merc.getContext('2d');

  const cargas = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      cargas.push(new Promise((res) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { mg.drawImage(img, x * TS, y * TS, TS, TS); res(true); };
        img.onerror = () => res(false);
        img.src = fuente.url(Z, x, y);
      }));
    }
  }
  const ok = (await Promise.all(cargas)).filter(Boolean).length;
  if (ok < N * N * 0.6) throw new Error('teselas insuficientes');

  // Remuestreo Mercator → equirectangular.
  const W = 2048, H = 1024;
  const eq = document.createElement('canvas');
  eq.width = W; eq.height = H;
  const eg = eq.getContext('2d');
  eg.fillStyle = '#0d1a2b'; eg.fillRect(0, 0, W, H);

  const srcH = merc.height;
  const LIM = 85.0511 * DEG; // límite de la proyección Mercator
  for (let row = 0; row < H; row++) {
    const lat = (0.5 - (row + 0.5) / H) * Math.PI; // +π/2 … −π/2
    if (Math.abs(lat) > LIM) continue;             // los polos no existen en Mercator
    const yMerc = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
    const srcY = Math.min(srcH - 1, Math.max(0, Math.round(yMerc * srcH)));
    eg.drawImage(merc, 0, srcY, merc.width, 1, 0, row, W, 1);
  }

  // Casquetes polares: fuera del alcance de Mercator, se rellenan de hielo.
  eg.fillStyle = '#dfe9f5';
  const filasPolo = Math.round(H * (90 - 85.0511) / 180);
  eg.fillRect(0, 0, W, filasPolo);
  eg.fillRect(0, H - filasPolo, W, filasPolo);

  const tex = new THREE.CanvasTexture(eq);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function texturaDeReserva() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#cfdcea');
  grad.addColorStop(0.18, '#1d3c5c');
  grad.addColorStop(0.5, '#14507a');
  grad.addColorStop(0.82, '#1d3c5c');
  grad.addColorStop(1, '#cfdcea');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crearLuna() {
  moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.2725, 48, 32),
    new THREE.MeshPhongMaterial({ color: 0x9a9a9a, shininess: 2 }),
  );
  scene.add(moon);

  moonOrbitLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x5a6a8c, transparent: true, opacity: 0.4 }),
  );
  scene.add(moonOrbitLine);
}

function crearSol() {
  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x3d4a6b, 0.85));

  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(9, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd98a }),
  );
  scene.add(sunMesh);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texturaHalo(), color: 0xffcf7a, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(80, 80, 1);
  sunMesh.add(halo);
}

function texturaHalo() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,235,190,1)');
  grad.addColorStop(0.25, 'rgba(255,200,120,.5)');
  grad.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function crearSombra() {
  // Cono de penumbra: se abre desde la Luna. Amplio y difuso.
  penumbraCone = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 40, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2a2f45, transparent: true, opacity: 0.09,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  scene.add(penumbraCone);

  // Cono de umbra: converge a un vértice. Es MUY fino — así es en realidad, y
  // por eso la totalidad solo se ve en una franja estrecha.
  umbraCone = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  scene.add(umbraCone);

  // Mancha de la umbra sobre la superficie.
  shadowSpot = new THREE.Mesh(
    new THREE.CircleGeometry(0.025, 32),
    new THREE.MeshBasicMaterial({ color: 0x120a20, transparent: true, opacity: 0.9 }),
  );
  scene.add(shadowSpot);

  marcadorUsuario = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb238 }),
  );
  scene.add(marcadorUsuario);
}

/** Recorrido de la umbra sobre el globo, dibujado en coordenadas fijas a la Tierra. */
function crearTrayectoria() {
  const pts = [];
  for (let t = T_INICIO; t <= T_FIN; t += 60000) {
    const p = shadowAxisPoint(new Date(t));
    if (!p) continue;
    pts.push(vectorSuperficie(p.lat, p.lon, 1.004));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  pathLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xc3b2ff, transparent: true, opacity: 0.85,
  }));
  earth.add(pathLine); // hijo de la Tierra: gira con ella
}

/** lat/lon terrestres → punto en la esfera unidad, en el sistema FIJO a la Tierra. */
function vectorSuperficie(lat, lon, r = 1) {
  const φ = lat * DEG, λ = lon * DEG;
  return new THREE.Vector3(
    r * Math.cos(φ) * Math.cos(λ),
    r * Math.sin(φ),
    -r * Math.cos(φ) * Math.sin(λ),
  );
}

// ── Actualización por instante ───────────────────────────────────────────────

function actualizar(t) {
  const fecha = new Date(t);
  const { sun, moon: moonVec, gst } = bodyVectors(fecha);

  // Marco de la escena: X hacia el punto Aries, Y hacia el polo norte celeste.
  // Los vectores de las efemérides vienen como (x, y, z) ecuatoriales con
  // Z al polo, así que se permutan para que Y sea la vertical de Three.js.
  const aEscena = (v) => new THREE.Vector3(v[0], v[2], -v[1]).divideScalar(R_EARTH_KM);

  const vSol = aEscena(sun);
  const vLuna = aEscena(moonVec);

  // La Tierra gira: su meridiano cero apunta según el tiempo sidéreo.
  earth.rotation.y = gst * DEG;

  moon.position.copy(vLuna);

  const dirSol = vSol.clone().normalize();
  sunMesh.position.copy(dirSol.clone().multiplyScalar(SUN_VIEW_DIST));
  sunLight.position.copy(dirSol.clone().multiplyScalar(SUN_VIEW_DIST));
  sunLight.target.position.set(0, 0, 0);
  sunLight.target.updateMatrixWorld();

  aplicarEscalaCuerpos();
  colocarConos(vSol, vLuna);
  colocarMancha(fecha);
  colocarUsuario(gst);
  actualizarOrbitaLunar(t);
  actualizarPanel(fecha);
}

/**
 * Agranda los cuerpos en la vista de sistema y oculta los detalles de
 * superficie, que a esa escala serían un borrón sobre la Tierra.
 */
function aplicarEscalaCuerpos() {
  const enSistema = modoVista === 'sistema';
  const k = enSistema ? AUMENTO_SISTEMA : 1;
  earth.scale.setScalar(k);
  moon.scale.setScalar(k);
  pathLine.visible = !enSistema;
  shadowSpot.visible = !enSistema;
  marcadorUsuario.visible = !enSistema;
  moonOrbitLine.visible = enSistema;
}

/**
 * Coloca los conos de sombra. El de umbra se dibuja desde la Luna hasta su
 * vértice; el de penumbra, abriéndose. Ambos apuntan en la dirección
 * Sol → Luna prolongada.
 */
function colocarConos(vSol, vLuna) {
  const eje = vLuna.clone().sub(vSol).normalize();
  const R_LUNA = 0.2725;
  const R_SOL_RT = 696000 / R_EARTH_KM;
  const distSolLuna = vLuna.clone().sub(vSol).length();

  // Vértice del cono de umbra, medido desde la Luna.
  const largoUmbra = (R_LUNA * distSolLuna) / (R_SOL_RT - R_LUNA);

  orientarCono(umbraCone, vLuna, eje, R_LUNA, largoUmbra);
  // La penumbra se abre; se dibuja un tramo suficiente para llegar a la Tierra.
  const largoPenumbra = vLuna.length() + 1.5;
  orientarCono(penumbraCone, vLuna, eje, R_LUNA, largoPenumbra, true);

  // Los conos solo se muestran en la vista de sistema. En las vistas cercanas
  // la cámara queda DENTRO de ellos y su superficie translúcida cruzaba la
  // pantalla como bandas difusas.
  // Esto va DESPUÉS de orientarCono a propósito: esa función también toca
  // `visible`, y si se pusiera antes lo sobrescribiría en cada fotograma.
  const enSistema = modoVista === 'sistema';
  umbraCone.visible = umbraCone.visible && enSistema;
  penumbraCone.visible = penumbraCone.visible && enSistema;
}

function orientarCono(mesh, apice, eje, radioBase, largo, invertido = false) {
  // ConeGeometry nace centrado en el origen, con el eje en +Y y la punta arriba.
  mesh.geometry.dispose();
  mesh.geometry = invertido
    ? new THREE.ConeGeometry(radioBase * 2.6, largo, 40, 1, true)
    : new THREE.ConeGeometry(radioBase, largo, 32, 1, true);

  // El cono debe ir del ápice (posición de la Luna) hacia `eje`.
  const centro = apice.clone().add(eje.clone().multiplyScalar(largo / 2));
  mesh.position.copy(centro);
  // Punta hacia −eje para que la base quede en la Luna.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), eje);
  mesh.visible = largo > 0 && isFinite(largo);
}

function colocarMancha(fecha) {
  const p = shadowAxisPoint(fecha);
  // En la vista de sistema los cuerpos van aumentados y la mancha quedaría
  // enterrada dentro de la esfera: allí el cono de umbra ya señala el punto.
  if (!p || modoVista === 'sistema') { shadowSpot.visible = false; return; }
  shadowSpot.visible = true;

  // La mancha se sitúa en el marco INERCIAL, no en el fijo a la Tierra: su
  // posición ya viene calculada con el tiempo sidéreo dentro.
  const gstRad = p.gst * DEG;
  const local = vectorSuperficie(p.lat, p.lon, 1.002);
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), gstRad);

  shadowSpot.position.copy(local);
  shadowSpot.lookAt(0, 0, 0);
  shadowSpot.rotateX(Math.PI);

  const radio = Math.max(0.012, (p.widthKm / 2) / R_EARTH_KM);
  shadowSpot.scale.setScalar(radio / 0.025);
}

function colocarUsuario(gst) {
  const v = vectorSuperficie(state.lat, state.lon, 1.008);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), gst * DEG);
  marcadorUsuario.position.copy(v);
}

function actualizarOrbitaLunar(t) {
  const pts = [];
  for (let dt = -6; dt <= 6; dt += 0.5) {
    const { moon: mv } = bodyVectors(new Date(t + dt * 3600000));
    pts.push(new THREE.Vector3(mv[0], mv[2], -mv[1]).divideScalar(R_EARTH_KM));
  }
  moonOrbitLine.geometry.dispose();
  moonOrbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

function actualizarPanel(fecha) {
  $('orbitClock').textContent = fmtTime(fecha);
  const p = shadowAxisPoint(fecha);
  $('orbitPhase').textContent = p
    ? `Umbra sobre ${p.lat.toFixed(1)}°N ${p.lon.toFixed(1)}° · franja de ${p.widthKm.toFixed(0)} km`
    : 'La umbra aún no toca la Tierra';
  const s = $('orbitSlider');
  if (document.activeElement !== s) {
    s.value = String(Math.round(((fecha - T_INICIO) / (T_FIN - T_INICIO)) * 1000));
  }
}

// ── Cámara ───────────────────────────────────────────────────────────────────

// Tres encuadres, porque el sistema abarca escalas muy distintas: la Luna está
// a 60 radios terrestres, así que un plano que muestre ambos cuerpos deja la
// Tierra diminuta, y uno que luzca la Tierra deja la Luna fuera de cuadro.
//
// `desdeSol` es el ángulo entre la cámara y la dirección del Sol. Colocar la
// cámara respecto al Sol —y no en una dirección fija— garantiza ver siempre el
// hemisferio ILUMINADO. Con una posición fija, la rotación terrestre acababa
// dejando la cámara sobre la cara nocturna y la escena salía negra.
// `encaja` es el radio (en radios terrestres) que debe caber en pantalla; la
// distancia se deduce del campo de visión real, porque en vertical de móvil el
// FOV horizontal es menos de la mitad del vertical y una distancia fija dejaba
// el globo desbordado por los lados.
const VISTAS = {
  tierra:  { etiqueta: 'Tierra',  encaja: 1.25, desdeSol: 32 },
  sistema: { etiqueta: 'Sistema', encaja: 72,   desdeSol: 72 },
  sombra:  { etiqueta: 'Sombra',  encaja: 0.42, desdeSol: null },
};

// Aumento de los CUERPOS en la vista de sistema. La Luna está a 60 radios
// terrestres: a escala estricta la Tierra ocupa 1/60 del encuadre y la Luna es
// un punto invisible. Se agrandan los cuerpos dejando intactas las DISTANCIAS
// —convención de cualquier planetario—, y la vista lo advierte por escrito.
const AUMENTO_SISTEMA = 20;

const ORDEN_VISTAS = ['tierra', 'sistema', 'sombra'];

let camGiro = 0.35;   // giro del usuario alrededor del eje Sol-Tierra
let zoomManual = 1;   // factor que el usuario ajusta con pellizco o arrastre
const camTarget = new THREE.Vector3();

/** Distancia a la que una esfera de radio `r` cabe entera en el encuadre. */
function distanciaParaEncajar(r) {
  const vFov = (camera.fov * DEG) / 2;
  const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  return (r / Math.sin(Math.min(vFov, hFov))) * zoomManual;
}

function colocarCamara() {
  const vista = VISTAS[modoVista];
  const camDist = distanciaParaEncajar(vista.encaja);

  if (modoVista === 'sombra') {
    // Cenital sobre la mancha de sombra: se ve avanzar por la superficie.
    const p = shadowAxisPoint(new Date(tActual));
    if (p) {
      const v = vectorSuperficie(p.lat, p.lon, 1);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.gst * DEG);
      camTarget.copy(v.clone().multiplyScalar(0.6));
      camera.position.copy(v.clone().multiplyScalar(1 + camDist));
      camera.up.set(0, 1, 0);
      camera.lookAt(camTarget);
      return;
    }
  }

  // Base ortonormal anclada a la dirección del Sol.
  const { sun } = bodyVectors(new Date(tActual));
  const haciaSol = new THREE.Vector3(sun[0], sun[2], -sun[1]).normalize();
  const ref = Math.abs(haciaSol.y) > 0.9
    ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const derecha = new THREE.Vector3().crossVectors(ref, haciaSol).normalize();
  const arriba = new THREE.Vector3().crossVectors(haciaSol, derecha).normalize();

  const a = (vista.desdeSol ?? 32) * DEG;
  const dir = haciaSol.clone().multiplyScalar(Math.cos(a))
    .addScaledVector(derecha, Math.sin(a) * Math.cos(camGiro))
    .addScaledVector(arriba, Math.sin(a) * Math.sin(camGiro))
    .normalize();

  camTarget.set(0, 0, 0);
  camera.position.copy(dir.multiplyScalar(camDist));
  camera.up.set(0, 1, 0);
  camera.lookAt(camTarget);
}

function controlesCamara(dom) {
  let arrastrando = false, lx = 0, ly = 0, pinchIni = 0, distIni = 0;

  const abajo = (x, y) => { arrastrando = true; lx = x; ly = y; };
  const mover = (x, y) => {
    if (!arrastrando || modoVista === 'sombra') return;
    camGiro += (x - lx) * 0.008;
    // El arrastre vertical acerca y aleja: con la cámara anclada al Sol, subir
    // y bajar la órbita no aporta (siempre queremos la cara iluminada de frente).
    zoomManual = Math.max(0.35, Math.min(6, zoomManual * (1 + (y - ly) * 0.004)));
    lx = x; ly = y;
    colocarCamara();
  };
  const arriba = () => { arrastrando = false; };

  dom.addEventListener('mousedown', (e) => abajo(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => mover(e.clientX, e.clientY));
  window.addEventListener('mouseup', arriba);

  dom.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) abajo(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) {
      pinchIni = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      distIni = zoomManual;
    }
  }, { passive: true });

  dom.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) mover(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2 && pinchIni) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      zoomManual = Math.max(0.35, Math.min(6, distIni * (pinchIni / d)));
      colocarCamara();
    }
  }, { passive: true });

  dom.addEventListener('touchend', arriba);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomManual = Math.max(0.35, Math.min(6, zoomManual * (1 + Math.sign(e.deltaY) * 0.12)));
    colocarCamara();
  }, { passive: false });
}

// ── Controles de la interfaz ─────────────────────────────────────────────────

function cablearControles() {
  $('orbitSlider').addEventListener('input', (e) => {
    reproduciendo = false;
    $('orbitPlay').textContent = '▶';
    tActual = T_INICIO + ((T_FIN - T_INICIO) * e.target.value) / 1000;
    actualizar(tActual);
    colocarCamara();
  });

  $('orbitPlay').addEventListener('click', (e) => {
    reproduciendo = !reproduciendo;
    e.currentTarget.textContent = reproduciendo ? '❚❚' : '▶';
  });

  $('orbitSpeed').addEventListener('click', (e) => {
    const pasos = [10, 60, 300, 1200];
    velocidad = pasos[(pasos.indexOf(velocidad) + 1) % pasos.length];
    e.currentTarget.textContent = `${velocidad}×`;
  });

  $('orbitView').addEventListener('click', (e) => {
    const i = ORDEN_VISTAS.indexOf(modoVista);
    modoVista = ORDEN_VISTAS[(i + 1) % ORDEN_VISTAS.length];
    zoomManual = 1; // cada encuadre parte de su ajuste natural
    e.currentTarget.textContent = VISTAS[modoVista].etiqueta;
    // Hay que rehacer la escena entera, no solo la cámara: el tamaño de los
    // cuerpos y la visibilidad de conos y marcadores dependen del modo, y con
    // la reproducción parada nada más volvería a evaluarlos.
    actualizar(tActual);
    colocarCamara();
  });

  $('orbitReal').addEventListener('click', () => {
    tActual = Math.min(T_FIN, Math.max(T_INICIO, Date.now()));
    reproduciendo = false;
    $('orbitPlay').textContent = '▶';
    actualizar(tActual);
  });
}

// ── Bucle ────────────────────────────────────────────────────────────────────

let ultimoFrame = 0;

function bucle(ts = 0) {
  if (!corriendo) return;
  raf = requestAnimationFrame(bucle);

  if (reproduciendo) {
    const dt = ultimoFrame ? Math.min(100, ts - ultimoFrame) : 16;
    tActual += dt * velocidad;
    if (tActual > T_FIN) tActual = T_INICIO;
    actualizar(tActual);
    colocarCamara();
  }
  ultimoFrame = ts;
  renderer.render(scene, camera);
}

function redimensionar() {
  const stage = $('orbitStage');
  if (!stage || !renderer) return;
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
}

export function pause() {
  corriendo = false;
  if (raf) cancelAnimationFrame(raf);
}

export function resume() {
  if (!renderer) return;
  corriendo = true;
  redimensionar();
  bucle();
}

export function onLocationChange() {
  if (marcadorUsuario) {
    const { gst } = bodyVectors(new Date(tActual));
    colocarUsuario(gst);
  }
}
