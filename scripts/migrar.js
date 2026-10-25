// Copia la base de datos de la versión local (data/lymon.db, SQLite) a Postgres.
// Destino: DATABASE_URL (Neon en Vercel) si está en .env.local; si no, el Postgres local de data/pglite.
// Uso: npm run migrar            -> solo si el destino está vacío
//      npm run migrar -- --force -> borra lo que haya en el destino y copia de nuevo
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { one, run, tx, DB_DESTINO, cerrar } from '../server/db.js';

const ORIGEN = process.argv.find((a) => a.endsWith('.db')) || 'data/lymon.db';
if (!fs.existsSync(ORIGEN)) { console.error(`No encuentro ${ORIGEN}`); process.exit(1); }
const sqlite = new DatabaseSync(ORIGEN, { readOnly: true });

// Orden y columnas de cada tabla (las de la versión local; el id se conserva)
const TABLAS = {
  ajustes: ['clave', 'valor'],
  categorias: ['id', 'tipo', 'grupo', 'subgrupo', 'orden', 'iva', 'irpf'],
  movimientos: ['id', 'banco', 'fecha', 'descripcion', 'referencia', 'contraparte', 'importe', 'divisa', 'tipo', 'grupo', 'subgrupo', 'ext_id', 'saldo_banco', 'origen', 'creado', 'mes_gasto', 'iva', 'irpf', 'meses_gasto'],
  facturas: ['id', 'numero', 'linea', 'fecha', 'cliente', 'nif', 'concepto', 'base', 'total', 'clase', 'meses', 'origen', 'creado'],
  importaciones: ['id', 'tipo', 'archivo', 'nuevos', 'duplicados', 'fecha'],
  saldos_banco: ['banco', 'mes', 'fecha', 'saldo'],
  prevision_mes: ['mes', 'valores'],
};

const hay = Number((await one('SELECT (SELECT COUNT(*) FROM movimientos) + (SELECT COUNT(*) FROM facturas) AS n')).n);
if (hay && !process.argv.includes('--force')) {
  console.error(`El destino (${DB_DESTINO}) ya tiene datos. Usa «npm run migrar -- --force» para sustituirlos.`);
  await cerrar();
  process.exit(1);
}

await tx(async () => {
  for (const t of Object.keys(TABLAS).reverse()) await run(`DELETE FROM ${t}`);
  for (const [t, cols] of Object.entries(TABLAS)) {
    const filas = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all();
    // Inserta en bloques para no hacer una consulta por fila
    for (let i = 0; i < filas.length; i += 200) {
      const bloque = filas.slice(i, i + 200);
      const marcas = bloque.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
      await run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${marcas}`, bloque.flatMap((f) => cols.map((c) => f[c])));
    }
    if (cols[0] === 'id') await run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    console.log(`${t.padEnd(14)} ${filas.length} filas`);
  }
});

// Comprobación: mismos totales en origen y destino
for (const t of Object.keys(TABLAS)) {
  const a = sqlite.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const b = Number((await one(`SELECT COUNT(*) n FROM ${t}`)).n);
  if (a !== b) { console.error(`¡${t}: ${a} en origen y ${b} en destino!`); process.exitCode = 1; }
}
const suma = (r) => Math.round(Number(r.s) * 100) / 100;
const sa = suma(sqlite.prepare('SELECT SUM(importe) s FROM movimientos').get());
const sb = suma(await one('SELECT SUM(importe) s FROM movimientos'));
console.log(`\nSuma de movimientos: origen ${sa} · destino ${sb} ${sa === sb ? '✓' : '✗'}`);
console.log(process.exitCode ? 'La migración tiene diferencias' : `Migrado a ${DB_DESTINO}`);
sqlite.close();
await cerrar();
