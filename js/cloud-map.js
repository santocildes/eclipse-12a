// js/cloud-map.js — rejilla de nubosidad superpuesta al mapa.

import { fetchCloudGrid } from './clouds.js';
import { toast } from './app.js';
import { getMap } from './map.js';

let cargando = false;

/**
 * Pide una rejilla de nubosidad sobre la franja de totalidad y la pinta como
 * capa de calor. Se consulta a Open-Meteo por lotes (varios puntos en una sola
 * petición), así que una rejilla de 12×9 cuesta un par de llamadas.
 */
export async function mostrarRejillaNubes() {
  if (cargando) return;
  const map = getMap();
  if (!map) { toast('El mapa aún no está listo'); return; }

  cargando = true;
  try {
    // Encuadre de la franja peninsular, algo holgado.
    const bounds = [[-10.5, 37.5], [5.0, 45.0]];
    const fc = await fetchCloudGrid(bounds, { cols: 16, rows: 10 });

    if (!fc.available) {
      toast('Todavía no hay previsión: faltan más de 16 días');
      return;
    }
    if (!fc.features.length) {
      toast('No se recibieron datos de nubosidad');
      return;
    }

    if (!map.getSource('nubes')) {
      map.addSource('nubes', { type: 'geojson', data: fc });

      // Capa de calor: interpola entre los puntos de la rejilla para dar una
      // idea continua, que es como se comporta la nubosidad.
      map.addLayer({
        id: 'nubes-heat', type: 'heatmap', source: 'nubes',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'total'], 0, 0, 100, 1],
          'heatmap-intensity': 0.9,
          'heatmap-radius': 34,
          'heatmap-opacity': 0.42,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(0,0,0,0)',
            0.2, 'rgba(90,180,255,.35)',
            0.45,'rgba(190,205,225,.55)',
            0.7, 'rgba(230,235,245,.72)',
            1,   'rgba(255,255,255,.88)',
          ],
        },
      }, 'banda-fill');

      // Etiquetas con el porcentaje, para leer valores concretos.
      map.addLayer({
        id: 'nubes-pct', type: 'circle', source: 'nubes',
        paint: {
          // El radio crece con el zoom. Fijo, a escala peninsular los puntos se
          // tocaban entre sí y formaban una masa opaca que ocultaba el mapa y
          // la propia franja de totalidad, que es lo que hay que comparar.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 4.5,
            6, 8,
            9, 18,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'score'],
            0, '#ff5c6e', 40, '#ff8a5b', 60, '#ffc453', 80, '#35d39a',
          ],
          'circle-opacity': 0.72,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(8,11,20,.55)',
        },
      });
      // Nada de capa `symbol` con texto: MapLibre pediría glifos a un servidor
      // de fuentes remoto y ese servicio devuelve una página HTML con código
      // 200 para la pila por defecto, lo que hace reventar al decodificador de
      // teselas. Además, con una rejilla densa las etiquetas se solaparían y la
      // app debe seguir funcionando sin conexión. El detalle va en un popup.
      map.on('click', 'nubes-pct', mostrarDetalle);
      map.on('mouseenter', 'nubes-pct', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'nubes-pct', () => { map.getCanvas().style.cursor = ''; });
    } else {
      map.getSource('nubes').setData(fc);
      ['nubes-heat', 'nubes-pct'].forEach((id) => {
        map.setLayoutProperty(id, 'visibility', 'visible');
      });
    }

    map.fitBounds(bounds, { padding: 40, duration: 900 });
    toast('Nubosidad prevista a la hora del eclipse');
  } catch (err) {
    console.error(err);
    toast(`No se pudo cargar la nubosidad: ${err.message}`);
  } finally {
    cargando = false;
  }
}

/** Ficha de la celda tocada, con el desglose por altura de nube. */
function mostrarDetalle(e) {
  const map = getMap();
  const f = e.features?.[0];
  if (!f) return;
  const { total, low, mid, high, score } = f.properties;
  new maplibregl.Popup({ closeButton: false, offset: 14, className: 'nube-popup' })
    .setLngLat(f.geometry.coordinates)
    .setHTML(
      `<strong>${score}/100</strong> de cielo útil<br>` +
      `Nubosidad total ${total}%<br>` +
      `<small>bajas ${low}% · medias ${mid}% · altas ${high}%</small>`,
    )
    .addTo(map);
}

export function ocultarRejillaNubes() {
  const map = getMap();
  if (!map?.getSource('nubes')) return;
  ['nubes-heat', 'nubes-pct'].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  });
}
