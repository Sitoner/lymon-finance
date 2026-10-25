// Verifica que los datos cargados reproducen las cifras del Excel original (en un Postgres en memoria).
delete process.env.DATABASE_URL;
process.env.LYMON_PGLITE = 'memory://';
const { seed } = await import('../server/seed.js');
const { cashflow, ingresos, prevision } = await import('../server/metrics.js');
const { cerrar } = await import('../server/db.js');
await seed({ force: true });

const esperado = {
  saldo: { '2026-01': 2337.53, '2026-02': 2302.87, '2026-03': 3474.12, '2026-04': 4577.76, '2026-05': 8138.95, '2026-06': 9901.36, '2026-07': 10826.94, '2026-08': 11867.48 },
  // Cifras del Excel corregidas a propósito (octubre 2026):
  //  - rectificativas LYM-365 (may), LYM-466 (jul) y LYM-544 (ago): en el Excel tenían la base en positivo
  //  - LYM-367 (may): venta puntual de QRs; el Excel la tenía como recurrente y con el precio unitario como base
  //  - LYM-342 (may): el Excel tenía el precio de tarifa (149 €) en vez de la base con el 76 % de descuento (35,76 €)
  //  - LYM-469 (jul) y LYM-524 (ago): igual, 99 € de tarifa en vez de 89,10 € con el 10 % de descuento
  // Excel original: mrr may 3931.19 · jul 5218.66 · ago 5612.27; cuentas may 37 · jul 45 · ago 47; puntual may 550
  mrr: { '2026-01': 1803.13, '2026-02': 1887.24, '2026-03': 2338.94, '2026-04': 2254.73, '2026-05': 3601.95, '2026-06': 4151.52, '2026-07': 5108.76, '2026-08': 5444.37 },
  cuentas: { '2026-01': 20, '2026-02': 23, '2026-03': 26, '2026-04': 24, '2026-05': 36, '2026-06': 40, '2026-07': 44, '2026-08': 46 },
  puntual: { '2026-01': 50, '2026-02': 500, '2026-03': 450, '2026-04': 1050, '2026-05': 610, '2026-06': 1000, '2026-07': 250, '2026-08': 1000 },
};
let errores = 0;
const cmp = (nombre, mes, real, esp, tol = 0.02) => {
  const ok = Math.abs(real - esp) <= tol;
  if (!ok) errores++;
  console.log(`${ok ? 'OK ' : 'MAL'} ${nombre.padEnd(9)} ${mes}  app=${real}  excel=${esp}`);
};
const cf = await cashflow();
for (const [m, v] of Object.entries(esperado.saldo)) cmp('saldo', m, cf.saldoFin[cf.meses.indexOf(m)], v);
// Runway como el Excel (filas 107-109 de «Cashflow REAL»)
for (const [m, v] of Object.entries({ '2026-02': 132.9, '2026-03': 300.7, '2026-04': 396.2 })) cmp('runway', m, cf.runway[cf.meses.indexOf(m)], v, 0.05);
const ing = await ingresos();
for (const [m, v] of Object.entries(esperado.mrr)) cmp('mrr', m, ing.mrr[ing.meses.indexOf(m)], v);
for (const [m, v] of Object.entries(esperado.cuentas)) cmp('cuentas', m, ing.cuentas[ing.meses.indexOf(m)], v, 0);
for (const [m, v] of Object.entries(esperado.puntual)) cmp('puntual', m, ing.puntual[ing.meses.indexOf(m)], v);
// La previsión ya no es el modelo del Excel (ahora es el modelo sencillo con IVA): solo se comprueba que calcula
const pv = await prevision();
if (!pv?.filas?.length || pv.filas.some((f) => !Number.isFinite(f.caja))) { errores++; console.log('MAL previsión sin calcular'); } else console.log('OK  previsión', pv.filas.length, 'meses');
console.log(errores ? `\n${errores} diferencias` : '\nTodo cuadra con el Excel');
await cerrar();
process.exit(errores ? 1 : 0);
