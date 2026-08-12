# Eclipse 12A — ¿Se verá desde aquí?

PWA para planificar la observación del **eclipse total de Sol del 12 de agosto
de 2026** en España.

La pregunta que responde no es "¿a qué hora es?" —eso lo dice cualquier web—
sino **"¿lo veré desde donde pienso ponerme?"**. Porque en España este eclipse
ocurre casi al ocaso, con el Sol entre 12° y 1,5° sobre el horizonte: un monte
a 5 km, un edificio o una loma pueden taparlo por completo aunque estés dentro
de la franja de totalidad.

---

## Arrancar

No hay que compilar nada. Es HTML + módulos ES nativos.

```bash
cd eclipses
python3 -m http.server 8137
# abrir http://localhost:8137
```

Para desplegar, sube la carpeta a cualquier hosting estático (Netlify, Vercel,
GitHub Pages, un bucket S3…). **Requisito: HTTPS**, que es obligatorio para la
cámara, los sensores de orientación y el service worker.

### ¿Hace falta alguna API key?

**No.** La app funciona entera sin registrarse en ningún sitio. Todas las
fuentes que usa están abiertas y con CORS permitido:

| Uso | Fuente | Clave |
|---|---|---|
| Elevación del terreno | AWS Terrain Tiles (SRTM/NED) | no |
| Fondo de mapa | CARTO Positron | no |
| Ortofoto y cartografía | IGN — PNOA e IGN Base | no |
| Nubosidad | Open-Meteo | no |
| Textura del globo 3D | ESRI World Imagery | no |

MapTiler es **opcional**. Si quieres usar sus estilos, pon la clave en
`localStorage.maptiler_key`, en `window.__MAPTILER_KEY__` o con `?key=…`.
Sin ella no se pierde nada esencial.

---

## Qué hace

**Mapa** — Franja de totalidad y línea central sobre relieve sombreado, con
modo 3D inclinable. La iluminación del sombreado viene del ONO (285°), la misma
dirección desde la que llegará la luz durante el eclipse, para que las sombras
del mapa se parezcan a las reales. El botón ☀ traza la dirección exacta en la
que habrá que mirar.

**Horizonte** — La función central. Descarga el modelo digital del terreno
alrededor de tu punto, lanza rayos en los 360° y calcula bajo qué ángulo se ve
el relieve en cada dirección (teniendo en cuenta la curvatura terrestre y la
refracción atmosférica). Compara ese perfil con la posición del Sol y dictamina
si lo verás. Si no, busca puntos mejores en los alrededores.

**Nubes** — Previsión de Open-Meteo desglosada por altura. No pondera igual
todas las nubes: los cirros altos dejan ver el eclipse perfectamente, un estrato
bajo lo tapa del todo, y con el Sol tan rasante las nubes bajas penalizan aún
más porque el rayo visual atraviesa decenas de kilómetros de atmósfera baja.

**AR** — Superpone sobre la cámara dónde estará el Sol eclipsado, para
comprobar en el sitio exacto si hay algo delante que ningún modelo del terreno
conoce: un edificio, un árbol, una grúa. Si ya calculaste el horizonte, dibuja
además la silueta del terreno para contrastarla con lo que se ve.

**Órbitas** — Simulación 3D del sistema Tierra-Luna-Sol con las posiciones
reales calculadas por las mismas efemérides que el resto de la app, así que la
sombra cae donde caerá de verdad. Tres encuadres: la Tierra con la mancha de
umbra, el sistema completo con el cono de sombra, y un cenital que sigue a la
sombra por la superficie.

---

## Precisión

El motor astronómico va **en el dispositivo** (series abreviadas de Meeus,
capítulos 25 y 47), sin depender de ninguna red. Contrastado contra las
efemérides oficiales del IGN/OAN y de la NASA GSFC para 15 ciudades:

| Magnitud | Desviación |
|---|---|
| Altura del Sol | ±0,02° |
| Acimut del Sol | ±0,02° |
| Instante del máximo | −3 s (sesgo sistemático) |
| Clasificación total/parcial | 15 de 15 correctas |
| Línea central de la sombra | 16–27 km |
| Anchura de la franja | dentro del 0,6% |

El sesgo de −3 s **no se corrige artificialmente**: procede del truncamiento de
la serie lunar y falsearlo enmascararía errores reales. Para cronometrar la
totalidad al segundo, usa las efemérides oficiales del IGN.

Sobre el perfil de horizonte: el modelo de elevación tiene ~30 m de resolución
y **solo contiene el terreno**. No sabe de árboles, edificios ni postes. Por eso
la app avisa cuando el margen es escaso y por eso existe la vista AR.

---

## Pruebas

```bash
# Motor astronómico y geometría de sombra (necesita Node)
node test/verify.mjs

# Coherencia del grafo de módulos, rutas e ids del DOM
node test/check_imports.mjs

# Validación independiente en Python (extrae las tablas del propio JS)
python3 test/validate_astro.py
python3 test/eclipse_check.py
python3 test/shadow_check.py
python3 test/compare_official.py
```

`validate_astro.py` merece una nota: en vez de re-teclear las tablas de la serie
lunar, las **extrae con regex del propio `js/astro.js`** y las ejecuta contra
los valores publicados por Meeus. Así valida los datos que realmente se envían,
no una copia que podría haber divergido.

---

## Estructura

```
index.html            Estructura y vistas
css/app.css           Estilos (tema oscuro; se usa al atardecer)
js/
  astro.js            Efemérides de Sol y Luna (Meeus)
  eclipse.js          Circunstancias locales: contactos, magnitud, obscuración
  shadow.js           Geometría de la umbra sobre el elipsoide terrestre
  terrain.js          Modelo del terreno y perfil de horizonte
  clouds.js           Previsión de nubosidad
  config.js           ÚNICO punto que conoce claves y endpoints
  places.js           Localidades (embebidas: sirven sin cobertura)
  app.js              Orquestador, estado y navegación
  map.js  horizon-view.js  clouds-view.js  cloud-map.js  ar.js  orbit3d.js
sw.js                 Service worker (la app calcula sin conexión)
tools/gen_icons.py    Genera los PNG del manifiesto sin dependencias
```

Regla que conviene respetar: **solo `config.js` lee claves y URLs externas**.
Cambiar de proveedor de teselas debe ser tocar un archivo, no diez.

---

## Detalles que costaron y conviene no volver a romper

- **La anchura de la franja se mide perpendicular al avance de la sombra**, no
  como el eje mayor de la elipse. Con el Sol a 7° la mancha se estira 8 veces
  hacia el ocaso, pero como viaja en esa misma dirección la franja sigue
  midiendo ~290 km. Medirlo mal daba 890 km donde la NASA da 294.

- **`k₂ = 0,272281`** para la geometría de umbra (limbo lunar medio), no el
  radio nominal. Son 1,4 km de diferencia, pero el radio del cono en el suelo
  es la resta de dos cantidades grandes y ese 0,08% se amplifica al 3%.

- **`bmp.close()` pone `width` a 0.** Hay que guardar las dimensiones antes de
  cerrar un `ImageBitmap` o el array de alturas sale vacío — y sin dar error.

- **El atributo `hidden` pierde** contra cualquier clase que declare `display`.
  Por eso hay un `[hidden] { display: none !important }` global.

- **MapLibre 4.x no admite capas de tipo `sky`** (eso es Mapbox GL). El cielo se
  configura con `map.setSky()`.

- **`setStyle` siempre con `{ diff: false }`** al cambiar de fondo, y las capas
  propias se re-añaden en `style.load`. Con el diff por defecto, MapLibre
  elimina las capas que no están en el estilo nuevo y no vuelve a dispararse el
  evento, así que desaparecen para siempre.

---

## Créditos de datos

Efemérides contrastadas con NASA GSFC (Fred Espenak) y con el Observatorio
Astronómico Nacional vía el IGN. Relieve de AWS Terrain Tiles. Cartografía del
Instituto Geográfico Nacional (CC BY 4.0). Meteorología de Open-Meteo. Fondos de
CARTO sobre OpenStreetMap. Imaginería del globo de ESRI World Imagery.
