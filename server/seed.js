// Carga los datos históricos del Excel (carpeta seed/) en una base de datos vacía.
// Uso: npm run seed            -> solo si la base está vacía
//      npm run seed -- --force -> borra todo y vuelve a cargar
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, run, tx, setAjuste, DB_DESTINO, completarIvaCategorias, cerrar } from './db.js';

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const leer = (f) => JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));

export async function seed({ force = false } = {}) {
  const hay = (await one('SELECT (SELECT COUNT(*) FROM movimientos) + (SELECT COUNT(*) FROM facturas) AS n')).n;
  if (Number(hay) && !force) return false;

  const config = leer('config.json');
  const movimientos = leer('movimientos.json');
  const facturas = leer('facturas.json');

  await tx(async () => {
    for (const t of ['movimientos', 'facturas', 'categorias', 'ajustes', 'prevision_mes', 'importaciones']) await run(`DELETE FROM ${t}`);

    await setAjuste('empresa', config.empresa);
    await setAjuste('saldoInicial', config.saldoInicial);

    const insCat = (tipo, grupo, sub, orden) => run('INSERT INTO categorias (tipo, grupo, subgrupo, orden) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [tipo, grupo, sub, orden]);
    let orden = 0;
    for (const [tipo, grupos] of Object.entries(config.categorias))
      for (const [grupo, subs] of Object.entries(grupos))
        for (const sub of subs) await insCat(tipo, grupo, sub, orden++);
    // Combinaciones usadas en el histórico que no estaban en la tabla de categorías
    for (const m of movimientos) if (m.tipo) await insCat(m.tipo, m.grupo, m.subgrupo, orden++);
    await completarIvaCategorias();
    await run("UPDATE categorias SET irpf = 7 WHERE grupo = 'Personal' AND subgrupo LIKE 'Honorarios%'"); // retención a socios autónomos
    await run("UPDATE categorias SET irpf = 19 WHERE grupo = 'Personal' AND subgrupo = 'Salarios socios'"); // nómina de administradores (empresa < 100.000 € de facturación)

    for (const m of movimientos) {
      await run(`INSERT INTO movimientos (banco, fecha, descripcion, importe, divisa, tipo, grupo, subgrupo, origen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'excel')`, [m.banco, m.fecha, m.descripcion, m.importe, m.divisa, m.tipo, m.grupo, m.subgrupo]);
    }

    const lineas = {};
    for (const f of facturas) {
      const linea = (lineas[f.numero] = (lineas[f.numero] || 0) + 1);
      const base = f.total < 0 ? -Math.abs(f.base) : f.base; // rectificativas con base negativa
      await run(`INSERT INTO facturas (numero, linea, fecha, cliente, base, total, clase, meses, origen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'excel')`, [f.numero, linea, f.fecha, f.cliente.trim(), base, f.total, f.meses > 0 ? 'recurrente' : 'puntual', f.meses > 0 ? f.meses : 1]);
    }

    const p = config.prevision;
    await setAjuste('prevision', { mesBase: p.mesBase, meses: p.meses, base: p.base, parametros: p.parametros });
    for (const [mes, nuevos] of Object.entries(p.nuevos)) await run('INSERT INTO prevision_mes (mes, valores) VALUES (?, ?)', [mes, JSON.stringify({ nuevos })]);
  });
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const force = process.argv.includes('--force');
  console.log((await seed({ force })) ? `Datos del Excel cargados en ${DB_DESTINO}` : 'La base de datos ya tiene datos. Usa --force para recargar.');
  await cerrar();
}
