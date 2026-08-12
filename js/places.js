// js/places.js
//
// Listado de localidades incluido en la app.
//
// Va embebido a propósito, en vez de consultar un servicio de geocodificación:
// la app se usa en el campo, donde la cobertura falla justo cuando más falta
// hace. Un buscador que no funciona sin datos móviles no sirve para esto.
//
// Cobertura: capitales de provincia, más localidades repartidas por la franja de
// totalidad (sobre todo cerca de la línea central y de los límites, donde la
// diferencia entre ver la totalidad o no se juega en pocos kilómetros).
// Altitudes en metros, aproximadas al núcleo urbano.

export const CIUDADES = [
  // ── Galicia ──
  { nombre: 'A Coruña', provincia: 'A Coruña', lat: 43.3623, lon: -8.4115, elev: 20 },
  { nombre: 'Santiago de Compostela', provincia: 'A Coruña', lat: 42.8805, lon: -8.5457, elev: 260 },
  { nombre: 'Ferrol', provincia: 'A Coruña', lat: 43.4840, lon: -8.2330, elev: 30 },
  { nombre: 'Lugo', provincia: 'Lugo', lat: 43.0121, lon: -7.5559, elev: 465 },
  { nombre: 'Ourense', provincia: 'Ourense', lat: 42.3358, lon: -7.8639, elev: 130 },
  { nombre: 'Vigo', provincia: 'Pontevedra', lat: 42.2406, lon: -8.7207, elev: 30 },
  { nombre: 'Pontevedra', provincia: 'Pontevedra', lat: 42.4310, lon: -8.6444, elev: 20 },
  { nombre: 'Ribadeo', provincia: 'Lugo', lat: 43.5372, lon: -7.0417, elev: 40 },
  { nombre: 'Fisterra', provincia: 'A Coruña', lat: 42.9053, lon: -9.2639, elev: 20 },

  // ── Asturias y Cantabria ──
  { nombre: 'Oviedo', provincia: 'Asturias', lat: 43.3619, lon: -5.8494, elev: 230 },
  { nombre: 'Gijón', provincia: 'Asturias', lat: 43.5322, lon: -5.6611, elev: 15 },
  { nombre: 'Avilés', provincia: 'Asturias', lat: 43.5560, lon: -5.9247, elev: 10 },
  { nombre: 'Llanes', provincia: 'Asturias', lat: 43.4211, lon: -4.7566, elev: 15 },
  { nombre: 'Cangas de Onís', provincia: 'Asturias', lat: 43.3506, lon: -5.1300, elev: 80 },
  { nombre: 'Santander', provincia: 'Cantabria', lat: 43.4623, lon: -3.8100, elev: 15 },
  { nombre: 'Torrelavega', provincia: 'Cantabria', lat: 43.3509, lon: -4.0480, elev: 25 },
  { nombre: 'Laredo', provincia: 'Cantabria', lat: 43.4130, lon: -3.4110, elev: 10 },
  { nombre: 'Reinosa', provincia: 'Cantabria', lat: 42.9997, lon: -4.1381, elev: 850 },

  // ── País Vasco y Navarra ──
  { nombre: 'Bilbao', provincia: 'Bizkaia', lat: 43.2630, lon: -2.9350, elev: 20 },
  { nombre: 'Vitoria-Gasteiz', provincia: 'Álava', lat: 42.8467, lon: -2.6716, elev: 525 },
  { nombre: 'Donostia / San Sebastián', provincia: 'Gipuzkoa', lat: 43.3183, lon: -1.9812, elev: 10 },
  { nombre: 'Getxo', provincia: 'Bizkaia', lat: 43.3567, lon: -3.0106, elev: 40 },
  { nombre: 'Pamplona / Iruña', provincia: 'Navarra', lat: 42.8125, lon: -1.6458, elev: 446 },
  { nombre: 'Tudela', provincia: 'Navarra', lat: 42.0649, lon: -1.6062, elev: 275 },
  { nombre: 'Estella / Lizarra', provincia: 'Navarra', lat: 42.6716, lon: -2.0293, elev: 425 },

  // ── La Rioja y Castilla y León ──
  { nombre: 'Logroño', provincia: 'La Rioja', lat: 42.4650, lon: -2.4456, elev: 384 },
  { nombre: 'Haro', provincia: 'La Rioja', lat: 42.5772, lon: -2.8471, elev: 479 },
  { nombre: 'Calahorra', provincia: 'La Rioja', lat: 42.3049, lon: -1.9646, elev: 350 },
  { nombre: 'Burgos', provincia: 'Burgos', lat: 42.3439, lon: -3.6969, elev: 860 },
  { nombre: 'Miranda de Ebro', provincia: 'Burgos', lat: 42.6866, lon: -2.9463, elev: 463 },
  { nombre: 'Aranda de Duero', provincia: 'Burgos', lat: 41.6704, lon: -3.6893, elev: 798 },
  { nombre: 'Valladolid', provincia: 'Valladolid', lat: 41.6523, lon: -4.7245, elev: 700 },
  { nombre: 'Medina del Campo', provincia: 'Valladolid', lat: 41.3106, lon: -4.9147, elev: 721 },
  { nombre: 'Palencia', provincia: 'Palencia', lat: 42.0096, lon: -4.5288, elev: 740 },
  { nombre: 'León', provincia: 'León', lat: 42.5987, lon: -5.5671, elev: 837 },
  { nombre: 'Astorga', provincia: 'León', lat: 42.4590, lon: -6.0530, elev: 869 },
  { nombre: 'Ponferrada', provincia: 'León', lat: 42.5461, lon: -6.5960, elev: 541 },
  { nombre: 'Zamora', provincia: 'Zamora', lat: 41.5033, lon: -5.7446, elev: 650 },
  { nombre: 'Salamanca', provincia: 'Salamanca', lat: 40.9701, lon: -5.6635, elev: 802 },
  { nombre: 'Ávila', provincia: 'Ávila', lat: 40.6565, lon: -4.6818, elev: 1132 },
  { nombre: 'Segovia', provincia: 'Segovia', lat: 40.9429, lon: -4.1088, elev: 1005 },
  { nombre: 'Soria', provincia: 'Soria', lat: 41.7665, lon: -2.4790, elev: 1063 },
  { nombre: 'El Burgo de Osma', provincia: 'Soria', lat: 41.5866, lon: -3.0673, elev: 895 },

  // ── Aragón ──
  { nombre: 'Zaragoza', provincia: 'Zaragoza', lat: 41.6488, lon: -0.8891, elev: 208 },
  { nombre: 'Huesca', provincia: 'Huesca', lat: 42.1401, lon: -0.4089, elev: 488 },
  { nombre: 'Teruel', provincia: 'Teruel', lat: 40.3456, lon: -1.1065, elev: 915 },
  { nombre: 'Calatayud', provincia: 'Zaragoza', lat: 41.3530, lon: -1.6430, elev: 534 },
  { nombre: 'Jaca', provincia: 'Huesca', lat: 42.5709, lon: -0.5497, elev: 820 },
  { nombre: 'Alcañiz', provincia: 'Teruel', lat: 41.0510, lon: -0.1327, elev: 338 },
  { nombre: 'Barbastro', provincia: 'Huesca', lat: 42.0353, lon: 0.1268, elev: 341 },

  // ── Cataluña ──
  { nombre: 'Barcelona', provincia: 'Barcelona', lat: 41.3874, lon: 2.1686, elev: 12 },
  { nombre: 'Lleida', provincia: 'Lleida', lat: 41.6176, lon: 0.6200, elev: 155 },
  { nombre: 'Tarragona', provincia: 'Tarragona', lat: 41.1189, lon: 1.2445, elev: 68 },
  { nombre: 'Girona', provincia: 'Girona', lat: 41.9794, lon: 2.8214, elev: 70 },
  { nombre: 'Reus', provincia: 'Tarragona', lat: 41.1550, lon: 1.1075, elev: 118 },
  { nombre: 'Tortosa', provincia: 'Tarragona', lat: 40.8126, lon: 0.5211, elev: 12 },
  { nombre: 'Manresa', provincia: 'Barcelona', lat: 41.7230, lon: 1.8265, elev: 238 },
  { nombre: 'La Seu d’Urgell', provincia: 'Lleida', lat: 42.3582, lon: 1.4592, elev: 692 },

  // ── Comunidad Valenciana y Murcia ──
  { nombre: 'València', provincia: 'València', lat: 39.4699, lon: -0.3763, elev: 15 },
  { nombre: 'Castelló de la Plana', provincia: 'Castelló', lat: 39.9864, lon: -0.0513, elev: 30 },
  { nombre: 'Alacant / Alicante', provincia: 'Alacant', lat: 38.3452, lon: -0.4810, elev: 3 },
  { nombre: 'Elx / Elche', provincia: 'Alacant', lat: 38.2699, lon: -0.7126, elev: 86 },
  { nombre: 'Gandia', provincia: 'València', lat: 38.9678, lon: -0.1819, elev: 22 },
  { nombre: 'Dénia', provincia: 'Alacant', lat: 38.8407, lon: 0.1057, elev: 10 },
  { nombre: 'Morella', provincia: 'Castelló', lat: 40.6187, lon: -0.1017, elev: 1004 },
  { nombre: 'Murcia', provincia: 'Murcia', lat: 37.9922, lon: -1.1307, elev: 43 },
  { nombre: 'Cartagena', provincia: 'Murcia', lat: 37.6257, lon: -0.9966, elev: 10 },

  // ── Islas Baleares ──
  { nombre: 'Palma', provincia: 'Illes Balears', lat: 39.5696, lon: 2.6502, elev: 13 },
  { nombre: 'Maó / Mahón', provincia: 'Illes Balears', lat: 39.8885, lon: 4.2658, elev: 50 },
  { nombre: 'Ciutadella', provincia: 'Illes Balears', lat: 40.0018, lon: 3.8377, elev: 25 },
  { nombre: 'Eivissa / Ibiza', provincia: 'Illes Balears', lat: 38.9067, lon: 1.4206, elev: 10 },
  { nombre: 'Alcúdia', provincia: 'Illes Balears', lat: 39.8533, lon: 3.1210, elev: 20 },
  { nombre: 'Sóller', provincia: 'Illes Balears', lat: 39.7667, lon: 2.7150, elev: 54 },

  // ── Madrid y Castilla-La Mancha ──
  { nombre: 'Madrid', provincia: 'Madrid', lat: 40.4168, lon: -3.7038, elev: 667 },
  { nombre: 'Alcalá de Henares', provincia: 'Madrid', lat: 40.4818, lon: -3.3644, elev: 588 },
  { nombre: 'Guadalajara', provincia: 'Guadalajara', lat: 40.6329, lon: -3.1611, elev: 685 },
  { nombre: 'Sigüenza', provincia: 'Guadalajara', lat: 41.0680, lon: -2.6410, elev: 1010 },
  { nombre: 'Cuenca', provincia: 'Cuenca', lat: 40.0704, lon: -2.1374, elev: 946 },
  { nombre: 'Toledo', provincia: 'Toledo', lat: 39.8628, lon: -4.0273, elev: 529 },
  { nombre: 'Albacete', provincia: 'Albacete', lat: 38.9943, lon: -1.8585, elev: 686 },
  { nombre: 'Ciudad Real', provincia: 'Ciudad Real', lat: 38.9848, lon: -3.9273, elev: 628 },

  // ── Sur y resto (parcial) ──
  { nombre: 'Sevilla', provincia: 'Sevilla', lat: 37.3891, lon: -5.9845, elev: 11 },
  { nombre: 'Málaga', provincia: 'Málaga', lat: 36.7213, lon: -4.4214, elev: 11 },
  { nombre: 'Granada', provincia: 'Granada', lat: 37.1773, lon: -3.5986, elev: 738 },
  { nombre: 'Córdoba', provincia: 'Córdoba', lat: 37.8882, lon: -4.7794, elev: 120 },
  { nombre: 'Cádiz', provincia: 'Cádiz', lat: 36.5271, lon: -6.2886, elev: 11 },
  { nombre: 'Almería', provincia: 'Almería', lat: 36.8340, lon: -2.4637, elev: 25 },
  { nombre: 'Jaén', provincia: 'Jaén', lat: 37.7796, lon: -3.7849, elev: 573 },
  { nombre: 'Huelva', provincia: 'Huelva', lat: 37.2614, lon: -6.9447, elev: 24 },
  { nombre: 'Badajoz', provincia: 'Badajoz', lat: 38.8794, lon: -6.9707, elev: 185 },
  { nombre: 'Cáceres', provincia: 'Cáceres', lat: 39.4753, lon: -6.3724, elev: 459 },
  { nombre: 'Las Palmas de Gran Canaria', provincia: 'Las Palmas', lat: 28.1235, lon: -15.4363, elev: 8 },
  { nombre: 'Santa Cruz de Tenerife', provincia: 'S. C. de Tenerife', lat: 28.4636, lon: -16.2518, elev: 50 },

  // ── Miradores y cimas dentro de la franja ──
  // Cotas altas con horizonte despejado al oeste-noroeste, que es hacia donde
  // habrá que mirar. El Sol estará tan bajo que la altitud del punto importa
  // menos que no tener nada delante.
  { nombre: 'Puerto de Pajares', provincia: 'León/Asturias', lat: 42.9686, lon: -5.7639, elev: 1379 },
  { nombre: 'Puerto de Piedrafita', provincia: 'Lugo', lat: 42.7136, lon: -7.0281, elev: 1109 },
  { nombre: 'Alto del Rodicio', provincia: 'Ourense', lat: 42.2264, lon: -7.7500, elev: 980 },
  { nombre: 'Peña Cabarga', provincia: 'Cantabria', lat: 43.3672, lon: -3.7742, elev: 569 },
  { nombre: 'Monte Naranco', provincia: 'Asturias', lat: 43.3833, lon: -5.8611, elev: 634 },
  { nombre: 'Puerto de Urbasa', provincia: 'Navarra', lat: 42.8442, lon: -2.1483, elev: 927 },
  { nombre: 'Moncayo (Agramonte)', provincia: 'Zaragoza', lat: 41.7869, lon: -1.8317, elev: 1180 },
  { nombre: 'Sierra de Cameros', provincia: 'La Rioja', lat: 42.1600, lon: -2.6400, elev: 1200 },
  { nombre: 'Puerto de Navacerrada', provincia: 'Madrid/Segovia', lat: 40.7861, lon: -4.0056, elev: 1858 },
  { nombre: 'Alto de Tudons', provincia: 'Illes Balears', lat: 39.9600, lon: 3.9800, elev: 358 },
];

/**
 * Búsqueda tolerante a acentos y mayúsculas: quien escribe desde el móvil no
 * pone tildes.
 */
function normaliza(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function buscarCiudades(query, limite = 30) {
  const q = normaliza(query);
  if (!q) return CIUDADES.slice(0, limite);

  const puntua = (c) => {
    const n = normaliza(c.nombre), p = normaliza(c.provincia);
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (p.startsWith(q)) return 2;
    if (p.includes(q)) return 3;
    return 99;
  };

  return CIUDADES
    .map((c) => ({ c, s: puntua(c) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.c.nombre.localeCompare(b.c.nombre, 'es'))
    .slice(0, limite)
    .map((x) => x.c);
}
