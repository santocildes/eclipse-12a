// js/terrain-shadow.js
//
// Capa de sombras del terreno: dónde el relieve tapa el Sol en el momento del
// eclipse. Se calcula en el navegador, a resolución de píxel.
//
// Por qué propia y no la del IGN: sus "sombras del terreno" se publican como
// GeoTIFF descargable desde el portal interactivo del CNIG — no hay URL directa
// ni servicio WMS que consumir en vivo — y vienen a una resolución muy gruesa.
// Con el modelo de elevación y las efemérides que ya usa la app, calcularla
// aquí sale más fino y además se adapta al zoom.
//
// ALGORITMO. Un rayo de sol que roza una cima sigue bajando conforme se aleja:
// pierde altura a razón de tan(altura_solar) por metro recorrido. Así que basta
// recorrer el raster en la dirección OPUESTA al Sol arrastrando la altura del
// rayo: cada píxel que quede por debajo está en sombra, y cada píxel que
// sobresalga pasa a ser el nuevo obstáculo. Es un barrido lineal — una pasada
// por píxel, no una búsqueda por cada uno.

import { localCircumstances } from './eclipse.js';
import { elevationAtSync, ensureTilesForBBox } from './terrain.js';

const DEG = Math.PI / 180;
const EARTH_R = 6371000;
// Radio efectivo con refracción estándar: los rayos se curvan hacia el suelo,
// lo que permite ver algo por encima del horizonte geométrico.
const EFFECTIVE_R = EARTH_R * 7 / 6;

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;

/**
 * Calcula la máscara de sombra para un recuadro geográfico.
 *
 * @param {{west:number, south:number, east:number, north:number}} bbox
 * @param {object} [opts]
 * @param {number} [opts.size=384]  lado mayor del raster
 * @param {(p:number)=>void} [opts.onProgress]
 * @returns {Promise<{canvas:HTMLCanvasElement, coordinates:number[][], cobertura:number}>}
 */
export async function computeShadowMask(bbox, opts = {}) {
  const { size = 384, onProgress } = opts;
  const { west, south, east, north } = bbox;

  // El raster se construye en espacio Mercator: MapLibre coloca una imagen
  // interpolando linealmente entre sus cuatro esquinas, y en Mercator eso es
  // exacto. Si se repartiera en latitud, la sombra saldría desplazada.
  const yTop = mercY(north), yBot = mercY(south);
  const anchoGeo = east - west;
  const altoMerc = yTop - yBot;

  const aspecto = anchoGeo / (altoMerc * (180 / Math.PI));
  const W = aspecto >= 1 ? size : Math.max(64, Math.round(size * aspecto));
  const H = aspecto >= 1 ? Math.max(64, Math.round(size / aspecto)) : size;

  const latCentro = (north + south) / 2;
  const lonCentro = (east + west) / 2;

  // Resolución del terreno acorde al raster: pedir un MDT mucho más fino que
  // los píxeles que vamos a pintar solo gastaría descargas. Al escalar el zoom
  // con la resolución, el número de teselas se mantiene casi constante aunque
  // el usuario se aleje muchísimo.
  const metrosPorPixel = (anchoGeo * 111320 * Math.cos(latCentro * DEG)) / W;
  let demZoom = Math.round(Math.log2((156543 * Math.cos(latCentro * DEG)) / metrosPorPixel));
  demZoom = Math.max(7, Math.min(12, demZoom));

  const cobertura = await ensureTilesForBBox(bbox, demZoom, onProgress);

  // --- Posición del Sol, interpolada sobre una rejilla gruesa ---------------
  // Cada punto tiene su propio instante de máximo y su propia altura solar,
  // pero varían de forma suave: basta calcular unos pocos e interpolar. Hacerlo
  // por píxel costaría minutos.
  const GX = 4, GY = 4;
  const rejilla = [];
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const lon = west + (anchoGeo * i) / (GX - 1);
      const lat = invMercY(yBot + (altoMerc * (GY - 1 - j)) / (GY - 1));
      const c = localCircumstances({ lat, lon, elev: 0 });
      rejilla.push(c.visible ? { alt: c.max.sun.alt, az: c.max.sun.az } : { alt: -5, az: 285 });
    }
  }
  const solEn = (fx, fy) => {
    const x = Math.min(GX - 1.001, fx * (GX - 1));
    const y = Math.min(GY - 1.001, fy * (GY - 1));
    const i = Math.floor(x), j = Math.floor(y);
    const tx = x - i, ty = y - j;
    const g = (a, b) => rejilla[b * GX + a];
    const mez = (p, q, t) => ({ alt: p.alt + (q.alt - p.alt) * t, az: p.az + (q.az - p.az) * t });
    return mez(mez(g(i, j), g(i + 1, j), tx), mez(g(i, j + 1), g(i + 1, j + 1), tx), ty);
  };

  // --- Muestreo de elevaciones ---------------------------------------------
  const elev = new Float32Array(W * H);
  const lats = new Float32Array(H);
  for (let py = 0; py < H; py++) {
    lats[py] = invMercY(yTop - (altoMerc * (py + 0.5)) / H);
  }
  let sinDatos = 0;
  for (let py = 0; py < H; py++) {
    const lat = lats[py];
    for (let px = 0; px < W; px++) {
      const lon = west + (anchoGeo * (px + 0.5)) / W;
      const h = elevationAtSync(lat, lon, demZoom);
      if (h === null) { sinDatos++; elev[py * W + px] = 0; }
      else elev[py * W + px] = h;
    }
  }
  onProgress?.(0.75);

  // --- Barrido de sombras ---------------------------------------------------
  const sombra = new Uint8Array(W * H);

  // Acimut medio del recuadro: fija la dirección del barrido. Varía unos pocos
  // grados de un extremo a otro y usar el del centro es una aproximación
  // asumible; la ALTURA solar, que es la que decide el resultado, sí se aplica
  // píxel a píxel.
  const azMedio = solEn(0.5, 0.5).az;
  // Bearing → vector en el raster (x al este, y al sur). Mercator es conforme,
  // así que los ángulos se conservan localmente.
  const dirX = -Math.sin(azMedio * DEG); // alejándose del Sol
  const dirY = Math.cos(azMedio * DEG);
  const norma = Math.max(Math.abs(dirX), Math.abs(dirY)) || 1;
  const pasoX = dirX / norma, pasoY = dirY / norma;

  // Metros de suelo por píxel, por fila (Mercator se estira con la latitud).
  const mppFila = new Float32Array(H);
  for (let py = 0; py < H; py++) {
    mppFila[py] = (anchoGeo * 111320 * Math.cos(lats[py] * DEG)) / W;
  }

  const inicios = [];
  if (pasoX > 0) for (let y = 0; y < H; y++) inicios.push([0, y]);
  if (pasoX < 0) for (let y = 0; y < H; y++) inicios.push([W - 1, y]);
  if (pasoY > 0) for (let x = 0; x < W; x++) inicios.push([x, 0]);
  if (pasoY < 0) for (let x = 0; x < W; x++) inicios.push([x, H - 1]);

  for (const [x0, y0] of inicios) {
    let x = x0, y = y0;
    let alturaObstaculo = -Infinity;
    let distDesdeObstaculo = 0;

    while (x >= 0 && x < W && y >= 0 && y < H) {
      const px = Math.round(x), py = Math.round(y);
      if (px < 0 || px >= W || py < 0 || py >= H) break;
      const idx = py * W + px;
      const z = elev[idx];

      const paso = mppFila[py] * Math.hypot(pasoX, pasoY);
      distDesdeObstaculo += paso;

      const sol = solEn(px / (W - 1), py / (H - 1));
      const tanAlt = Math.tan(Math.max(0.05, sol.alt) * DEG);

      // Altura del rayo aquí, partiendo del último obstáculo: baja con la
      // distancia, y se corrige por la curvatura terrestre (a 30 km el suelo ya
      // ha "caído" 60 m, y sin ese término las montañas lejanas parecerían más
      // altas de lo que se ven).
      const alturaRayo = alturaObstaculo
        - distDesdeObstaculo * tanAlt
        + (distDesdeObstaculo * distDesdeObstaculo) / (2 * EFFECTIVE_R);

      if (z >= alturaRayo) {
        // Le da el Sol, y pasa a ser el obstáculo que proyecta hacia adelante.
        alturaObstaculo = z;
        distDesdeObstaculo = 0;
      } else {
        sombra[idx] = 1;
      }

      // Con el Sol por debajo del horizonte no hay nada que ver, tape o no.
      if (sol.alt <= 0) sombra[idx] = 2;

      x += pasoX; y += pasoY;
    }
  }
  onProgress?.(0.95);

  // --- Pintado --------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < sombra.length; i++) {
    const p = i * 4;
    if (sombra[i] === 2) {
      // Sol bajo el horizonte: gris neutro, no es culpa del relieve.
      img.data[p] = 40; img.data[p + 1] = 44; img.data[p + 2] = 60; img.data[p + 3] = 150;
    } else if (sombra[i] === 1) {
      img.data[p] = 12; img.data[p + 1] = 16; img.data[p + 2] = 34; img.data[p + 3] = 158;
    } else {
      img.data[p + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  onProgress?.(1);

  return {
    canvas,
    // Esquinas en el orden que espera MapLibre: NO, NE, SE, SO.
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    cobertura: 1 - sinDatos / (W * H),
    demZoom,
    enSombra: sombra.reduce((n, v) => n + (v ? 1 : 0), 0) / sombra.length,
  };
}
