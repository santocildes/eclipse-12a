// test/check_imports.mjs
//
// Comprueba que cada `import { X } from './y.js'` corresponda a algo que `y.js`
// realmente exporta, y detecta ciclos de importación.
//
// Hace falta porque un nombre mal escrito en un import no da error de sintaxis:
// revienta en el navegador al cargar el módulo, y con carga perezosa eso puede
// no notarse hasta que el usuario abre esa pestaña concreta.
//
// Ejecutar:  node test/check_imports.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_JS = join(RAIZ, 'js');

const archivos = readdirSync(DIR_JS).filter((f) => f.endsWith('.js'));
const modulos = new Map();

// ── Extracción de exports ────────────────────────────────────────────────────
function extraerExports(src) {
  const out = new Set();
  // export function|class|const|let|var NOMBRE
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    out.add(m[1]);
  }
  // export { a, b as c }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const t = parte.trim();
      if (!t) continue;
      const alias = t.split(/\s+as\s+/);
      out.add((alias[1] ?? alias[0]).trim());
    }
  }
  if (/^export\s+default/m.test(src)) out.add('default');
  return out;
}

// ── Extracción de imports ────────────────────────────────────────────────────
function extraerImports(src) {
  const out = [];
  const re = /import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clausula = m[1].trim();
    const origen = m[2];
    const nombres = [];
    let namespace = false;

    if (/^\*\s+as\s+/.test(clausula)) {
      namespace = true;
    } else {
      const llaves = clausula.match(/\{([^}]*)\}/);
      if (llaves) {
        for (const parte of llaves[1].split(',')) {
          const t = parte.trim();
          if (!t) continue;
          nombres.push(t.split(/\s+as\s+/)[0].trim());
        }
      }
      // import Algo from '...' → default
      const porDefecto = clausula.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
      if (porDefecto) nombres.push('default');
    }
    out.push({ origen, nombres, namespace });
  }
  // imports dinámicos
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ origen: m[1], nombres: [], namespace: true, dinamico: true });
  }
  return out;
}

for (const f of archivos) {
  const src = readFileSync(join(DIR_JS, f), 'utf8');
  modulos.set(f, { src, exports: extraerExports(src), imports: extraerImports(src) });
}

// ── Comprobación ─────────────────────────────────────────────────────────────
let fallos = 0;
console.log('Comprobando el grafo de módulos de js/\n');

for (const [archivo, mod] of modulos) {
  for (const imp of mod.imports) {
    // Solo se validan las rutas locales; las externas (CDN) no se pueden leer.
    if (!imp.origen.startsWith('./') && !imp.origen.startsWith('../')) continue;

    const destino = imp.origen.replace(/^\.\//, '');
    const objetivo = modulos.get(destino);

    if (!objetivo) {
      console.log(`  FALLO  ${archivo} importa de '${imp.origen}', que no existe`);
      fallos++;
      continue;
    }
    for (const n of imp.nombres) {
      if (!objetivo.exports.has(n)) {
        console.log(`  FALLO  ${archivo} importa '${n}' de ${destino}, ` +
          `que no lo exporta`);
        console.log(`         ${destino} exporta: ${[...objetivo.exports].sort().join(', ')}`);
        fallos++;
      }
    }
  }
}

// ── Detección de ciclos (solo importaciones estáticas) ───────────────────────
const grafo = new Map();
for (const [archivo, mod] of modulos) {
  grafo.set(archivo, mod.imports
    .filter((i) => i.origen.startsWith('./') && !i.dinamico)
    .map((i) => i.origen.replace(/^\.\//, ''))
    .filter((d) => modulos.has(d)));
}

const ciclos = [];
function buscarCiclos(nodo, camino, visitando) {
  visitando.add(nodo);
  camino.push(nodo);
  for (const vecino of grafo.get(nodo) ?? []) {
    if (visitando.has(vecino)) {
      const i = camino.indexOf(vecino);
      ciclos.push([...camino.slice(i), vecino]);
    } else if (!camino.includes(vecino)) {
      buscarCiclos(vecino, camino, visitando);
    }
  }
  visitando.delete(nodo);
  camino.pop();
}
for (const n of grafo.keys()) buscarCiclos(n, [], new Set());

const unicos = [...new Set(ciclos.map((c) => c.join(' → ')))];
if (unicos.length) {
  console.log('\n  Ciclos de importación estática detectados:');
  // Un ciclo no siempre es un error en módulos ES, pero si un módulo usa un
  // valor importado DURANTE su evaluación inicial, obtendrá undefined.
  for (const c of unicos) console.log(`    ${c}`);
  console.log('    (revisar que ninguno use el import en tiempo de evaluación)');
}

// ── Recursos referenciados desde index.html y sw.js ──────────────────────────
console.log('\nComprobando rutas referenciadas:');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8');

const referencias = new Set();
for (const m of html.matchAll(/(?:src|href)="(?!https?:|data:)([^"]+)"/g)) referencias.add(m[1]);
for (const m of sw.matchAll(/'\.\/([^']+)'/g)) referencias.add(m[1]);

const { existsSync } = await import('node:fs');
for (const ref of [...referencias].sort()) {
  const limpio = ref.replace(/^\.\//, '').split('?')[0];
  if (!limpio || limpio === '') continue;
  if (!existsSync(join(RAIZ, limpio))) {
    console.log(`  FALLO  falta el archivo referenciado: ${limpio}`);
    fallos++;
  }
}
if (!fallos) console.log('  Todos los archivos referenciados existen');

// ── Comprobación de los ids usados por el JS contra el HTML ─────────────────
console.log('\nComprobando ids del DOM:');
const idsHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const idsUsados = new Map();
for (const [archivo, mod] of modulos) {
  for (const m of mod.src.matchAll(/(?:getElementById\(|\$\()'([^']+)'\)/g)) {
    if (!idsUsados.has(m[1])) idsUsados.set(m[1], new Set());
    idsUsados.get(m[1]).add(archivo);
  }
}
let idsFaltan = 0;
for (const [id, donde] of [...idsUsados].sort()) {
  if (!idsHtml.has(id)) {
    console.log(`  FALLO  el id '${id}' se usa en ${[...donde].join(', ')} pero no está en index.html`);
    idsFaltan++; fallos++;
  }
}
if (!idsFaltan) console.log(`  Los ${idsUsados.size} ids usados existen en index.html`);

console.log('\n' + '='.repeat(70));
console.log(fallos === 0 ? 'Grafo de módulos coherente.' : `${fallos} problema(s) encontrado(s).`);
process.exit(fallos === 0 ? 0 : 1);
