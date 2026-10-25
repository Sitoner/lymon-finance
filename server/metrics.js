import { q, one, getAjuste, setAjuste } from './db.js';
import { simular } from '../shared/simulacion.js';

// ---------- utilidades de meses ----------
export const mesDe = (fecha) => fecha.slice(0, 7);
export function sumarMeses(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function rangoMeses(desde, hasta) {
  const out = [];
  for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) out.push(m);
  return out;
}
const r2 = (n) => Math.round(n * 100) / 100;

// Nombre de cliente normalizado: "LA TAPERIA DEL LULU SL, sociedad limitada" == "La Tapería del Lulu S.L."
export function claveCliente(nombre) {
  let s = String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/sociedad limitada( unipersonal)?/g, ' ')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
  let antes;
  do { antes = s; s = s.replace(/\s+(s l u|s l|slu|sl|s a|sa|s c|sc|s coop|scoop)$/, '').trim(); } while (s !== antes);
  return s;
}

// Nombre del local en el concepto de una línea de Beel: "Plan Estándar — Snoopy - Zig Zag — 2026-09-01 al …"
export function nombreLocal(concepto, { original = false } = {}) {
  if (!concepto) return null;
  const partes = concepto.includes('—') ? concepto.split(/\s*—\s*/) : concepto.split(/\s+-\s+/);
  if (partes.length < 2 || /^\d{4}-\d{2}-\d{2}/.test(partes[1])) return null;
  if (original) return partes[1].trim();
  return partes[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------- caja ----------
// porGasto = false: cada movimiento cuenta en el mes del banco (caja, cuadra con Revolut)
// porGasto = true:  cuenta en su «mes de gasto» (devengo), p. ej. la nómina de septiembre pagada el 1/10,
// sinIva = true:    quita el IVA (y la retención de IRPF) de cada importe, para compararlo con la previsión.
//                   Por defecto va con porGasto; el flujo de caja de la app usa porGasto sin quitar el IVA.
export async function cashflow({ porGasto = false, sinIva = porGasto } = {}) {
  const saldoInicial = await getAjuste('saldoInicial', { fecha: '2025-12-31', importe: 0 });
  const movs = await q('SELECT m.fecha, m.mes_gasto, m.meses_gasto, m.importe, m.tipo, m.grupo, m.subgrupo, m.saldo_banco, m.ext_id, COALESCE(m.iva, c.iva, 0) AS iva, COALESCE(m.irpf, c.irpf, 0) AS irpf FROM movimientos m LEFT JOIN categorias c ON c.tipo = m.tipo AND c.grupo = m.grupo AND c.subgrupo = m.subgrupo ORDER BY m.fecha, m.id');
  const mesMov = (m) => (porGasto && m.mes_gasto ? m.mes_gasto : mesDe(m.fecha));
  let primerMes = sumarMeses(mesDe(saldoInicial.fecha), 1);
  let ultimoMov = movs.length ? mesDe(movs[movs.length - 1].fecha) : primerMes;
  // Meses en que cuenta un movimiento: el del banco, o (por mes de gasto) los meses_gasto meses que terminan en mes_gasto
  const repartos = (m) => { const fin = mesMov(m); const n = porGasto ? Math.max(1, m.meses_gasto || 1) : 1; return Array.from({ length: n }, (_, k) => sumarMeses(fin, k - n + 1)); };
  if (porGasto) for (const m of movs) for (const k of repartos(m)) { if (k < primerMes) primerMes = k; if (k > ultimoMov) ultimoMov = k; }
  const meses = rangoMeses(primerMes, ultimoMov > primerMes ? ultimoMov : primerMes);
  const idx = Object.fromEntries(meses.map((m, i) => [m, i]));
  const cero = () => meses.map(() => 0);

  const totales = { cobros: cero(), pagos: cero(), otros: cero(), traspasos: cero(), sinCategoria: cero() };
  const filas = {}; // "tipo|grupo|subgrupo" -> valores
  const saldoBanco = meses.map(() => null); // último saldo informado por el banco en cada mes

  for (const m of movs) for (const mesCuenta of repartos(m)) {
    const i = idx[mesCuenta];
    if (i === undefined) continue;
    const clave = m.tipo ? `${m.tipo}|${m.grupo}|${m.subgrupo}` : 'Sin categoría|Sin categoría|Sin categoría';
    // Transferencia a un autónomo = base × (1 + IVA − IRPF). Sin IVA: base × (1 − IRPF); la retención
    // cuenta como gasto cuando se paga a Hacienda (modelo 111, categoría Personal › IRPF)
    const total = sinIva ? (m.importe * (100 - m.irpf)) / (100 + m.iva - m.irpf) : m.importe;
    const imp = total / (porGasto ? Math.max(1, m.meses_gasto || 1) : 1);
    (filas[clave] ||= cero())[i] += imp;
    if (!m.tipo) totales.sinCategoria[i] += imp;
    else if (m.tipo === 'Cobros') totales.cobros[i] += imp;
    else if (m.tipo === 'Pagos') totales.pagos[i] += imp;
    else if (m.tipo === 'Traspaso') totales.traspasos[i] += imp;
    else totales.otros[i] += imp;
  }

  if (!porGasto) {
    const sb = Object.fromEntries((await q('SELECT mes, SUM(saldo) saldo FROM saldos_banco GROUP BY mes')).map((r) => [r.mes, r.saldo]));
    meses.forEach((m, i) => { if (sb[m] !== undefined) saldoBanco[i] = sb[m]; });
  }
  const neto = meses.map((_, i) => totales.cobros[i] + totales.pagos[i] + totales.otros[i] + totales.traspasos[i] + totales.sinCategoria[i]);
  const saldoIni = [], saldoFin = [];
  let s = saldoInicial.importe;
  for (let i = 0; i < meses.length; i++) { saldoIni.push(r2(s)); s += neto[i]; saldoFin.push(r2(s)); }

  // Burn y runway como en el Excel: burn = min(neto, 0), media 3 meses, runway = caja / burn medio
  const burn = neto.map((n) => Math.min(n, 0));
  // Como el Excel: Burn Rate (avg 3m) = media de la quema de ese mes y los dos anteriores (los meses con beneficio cuentan 0)
  // Runway = saldo del mes ÷ esa media, a 1 decimal; si la media es 0 o el resultado sale negativo, «Break-even»
  const burn3 = burn.map((_, i) => { const a = burn.slice(Math.max(0, i - 2), i + 1); return a.reduce((x, y) => x + y, 0) / a.length; });
  const runway = burn3.map((b, i) => (b === 0 || -saldoFin[i] / b < 0 ? null : Math.round((-saldoFin[i] / b) * 10) / 10));
  // Fecha estimada fin caja = FIN.MES(mes; REDONDEAR(runway; 0))
  const finCaja = runway.map((r, i) => (r === null ? null : sumarMeses(meses[i], Math.round(r))));

  const desglose = Object.entries(filas).map(([k, v]) => {
    const [tipo, grupo, subgrupo] = k.split('|');
    return { tipo, grupo, subgrupo, valores: v.map(r2), total: r2(v.reduce((a, b) => a + b, 0)) };
  });
  const orden = Object.fromEntries((await q('SELECT tipo, grupo, subgrupo, orden FROM categorias')).map((c) => [`${c.tipo}|${c.grupo}|${c.subgrupo}`, c.orden]));
  desglose.sort((a, b) => (orden[`${a.tipo}|${a.grupo}|${a.subgrupo}`] ?? 9999) - (orden[`${b.tipo}|${b.grupo}|${b.subgrupo}`] ?? 9999));

  const fix = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map(r2)]));
  return {
    porGasto, sinIva, meses, saldoInicial, desglose, ...fix(totales),
    neto: neto.map(r2), saldoIni, saldoFin, saldoBanco,
    descuadre: saldoFin.map((sf, i) => (saldoBanco[i] == null ? null : r2(saldoBanco[i] - sf))),
    burn: burn.map(r2), burn3: burn3.map(r2), runway, finCaja,
  };
}

// ---------- ingresos (MRR) ----------
// conIva = true: usa el total de cada factura (con el IVA que le corresponda; Canarias y Melilla van sin IVA)
export async function ingresos({ conIva = false } = {}) {
  const fac = await q(`SELECT fecha, cliente, concepto, ${conIva ? 'COALESCE(total, base)' : 'base'} AS base, clase, meses
    FROM facturas WHERE clase != 'excluida' ORDER BY fecha, id`);
  if (!fac.length) return { meses: [], mrr: [], clientes: [] };
  const primero = mesDe(fac[0].fecha);
  const ultimo = mesDe(fac[fac.length - 1].fecha);
  const meses = rangoMeses(primero, ultimo);
  const idx = Object.fromEntries(meses.map((m, i) => [m, i]));
  const n = meses.length;

  const rec = {}, punt = {}, nombres = {};
  for (const f of fac) {
    const c = claveCliente(f.cliente);
    nombres[c] ||= f.cliente;
    const i = idx[mesDe(f.fecha)];
    if (f.clase === 'recurrente') {
      const arr = (rec[c] ||= new Array(n).fill(0));
      const meses_ = Math.max(1, f.meses);
      for (let k = 0; k < meses_ && i + k < n; k++) arr[i + k] += f.base / meses_;
    } else {
      (punt[c] ||= new Array(n).fill(0))[i] += f.base;
    }
  }

  const z = () => new Array(n).fill(0);
  const out = { mrr: z(), mrrNuevo: z(), mrrChurn: z(), mrrExpansion: z(), cuentas: z(), nuevas: z(), bajas: z(), puntual: z(), puntualClientes: z(), puntualNuevos: z() };
  const detalleBajas = meses.map(() => []), detalleAltas = meses.map(() => []);

  for (const [c, arr] of Object.entries(rec)) {
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? arr[i - 1] : 0;
      const antes = arr.slice(0, i).some((v) => v > 0.005);
      out.mrr[i] += arr[i];
      if (arr[i] > 0.005) out.cuentas[i]++;
      if (arr[i] > 0.005 && !antes) { out.nuevas[i]++; out.mrrNuevo[i] += arr[i]; detalleAltas[i].push({ cliente: nombres[c], mrr: r2(arr[i]) }); }
      else if (arr[i] <= 0.005 && prev > 0.005) { out.bajas[i]++; out.mrrChurn[i] -= prev; detalleBajas[i].push({ cliente: nombres[c], mrr: r2(prev) }); }
      else if (arr[i] > 0.005 && prev > 0.005) out.mrrExpansion[i] += arr[i] - prev;
    }
  }
  for (const [c, arr] of Object.entries(punt)) {
    let visto = false;
    for (let i = 0; i < n; i++) {
      if (arr[i] > 0) { out.puntual[i] += arr[i]; out.puntualClientes[i]++; if (!visto) out.puntualNuevos[i]++; visto = true; }
    }
  }

  const res = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.map(r2)]));
  res.arpa = res.mrr.map((m, i) => (out.cuentas[i] ? r2(m / out.cuentas[i]) : 0));
  // Locales: se cobra por local y un cliente (SL) puede tener varios. Se cuentan con el nombre del local del concepto
  // de Beel ("Plan Estándar — Snoopy - Zig Zag — …"). Solo para meses en que todas las líneas recurrentes traen concepto.
  const porMesLocales = meses.map(() => ({ nombres: new Map(), sinConcepto: false }));
  for (const f of fac) {
    if (f.clase !== 'recurrente') continue;
    const i = idx[mesDe(f.fecha)];
    const l = nombreLocal(f.concepto);
    const meses_ = Math.max(1, f.meses);
    for (let k = 0; k < meses_ && i + k < n; k++) {
      if (!l) { porMesLocales[i + k].sinConcepto = true; continue; }
      const m = porMesLocales[i + k].nombres;
      if (!m.has(l)) m.set(l, { local: nombreLocal(f.concepto, { original: true }), cliente: f.cliente, mrr: 0 });
      m.get(l).mrr += f.base / meses_;
    }
  }
  res.locales = porMesLocales.map((x) => (x.sinConcepto || !x.nombres.size ? null : x.nombres.size));
  // Detalle para comprobar el recuento: cada local con su cliente y su cuota del mes
  res.detalleLocales = porMesLocales.map((x) => [...x.nombres.values()].map((d) => ({ ...d, mrr: r2(d.mrr) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.local.localeCompare(b.local)));
  res.ticketLocal = res.mrr.map((m, i) => (res.locales[i] ? r2(m / res.locales[i]) : null));
  res.total = res.mrr.map((m, i) => r2(m + out.puntual[i]));
  res.meses = meses;
  res.detalleAltas = detalleAltas;
  res.detalleBajas = detalleBajas;
  res.clientes = Object.entries(rec).map(([c, arr]) => ({ cliente: nombres[c], valores: arr.map(r2), actual: r2(arr[n - 1]) }))
    .sort((a, b) => b.actual - a.actual || a.cliente.localeCompare(b.cliente));
  return res;
}

// ---------- previsión: simulador de caja (shared/simulacion.js), importes con IVA ----------
const GRUPOS_GASTO = ['Producción', 'Marketing', 'Personal', 'Generales'];
const esGastoOperativo = (d) => d.tipo === 'Pagos' && GRUPOS_GASTO.includes(d.grupo) && d.subgrupo !== 'IRPF';

// IVA real por mes: repercutido = IVA de las facturas emitidas (fecha de factura); soportado y retenciones = pagos del banco (fecha de pago)
async function ivaReal() {
  const rep = Object.fromEntries((await q(`SELECT substr(fecha, 1, 7) mes, SUM(COALESCE(total, base) - base) iva
    FROM facturas GROUP BY 1`)).map((r) => [r.mes, r.iva]));
  const sop = {};
  const ret = {}; // IRPF retenido a autónomos, a ingresar con el modelo 111
  // Por fecha de pago (no por mes de gasto): así se declaran el 303 y el 111, y así cuadra con lo pagado a Hacienda
  const movs = await q(`SELECT substr(m.fecha, 1, 7) mes, m.importe, m.grupo, m.subgrupo, COALESCE(m.iva, c.iva, 0) iva, COALESCE(m.irpf, c.irpf, 0) irpf
    FROM movimientos m LEFT JOIN categorias c ON c.tipo = m.tipo AND c.grupo = m.grupo AND c.subgrupo = m.subgrupo
    WHERE m.tipo = 'Pagos'`);
  for (const m of movs) {
    const div = 100 + m.iva - m.irpf;
    if (m.iva) sop[m.mes] = (sop[m.mes] || 0) - (m.importe * m.iva) / div;
    if (m.irpf) ret[m.mes] = (ret[m.mes] || 0) - (m.importe * m.irpf) / div;
  }
  return { rep, sop, ret, movs };
}

// % medios reales, para estimar el IVA y el IRPF que hay dentro de los importes previstos
async function tiposMedios(movs) {
  let base = 0, cuotaIva = 0, cuotaIrpf = 0;
  for (const m of movs) {
    if (!GRUPOS_GASTO.includes(m.grupo) || m.subgrupo === 'IRPF') continue;
    const b = (-m.importe * 100) / (100 + m.iva - m.irpf);
    base += b; cuotaIva += (b * m.iva) / 100; cuotaIrpf += (b * m.irpf) / 100;
  }
  const fac = await one('SELECT SUM(base) b, SUM(COALESCE(total, base) - base) i FROM facturas WHERE base > 0');
  const pct = (x) => (base > 0 ? Math.round((x / base) * 1000) / 10 : 0);
  return { ivaVentas: fac.b ? Math.round((fac.i / fac.b) * 1000) / 10 : 21, ivaGastos: pct(cuotaIva), irpfGastos: pct(cuotaIrpf) };
}

export async function prevision() {
  const conf = await getAjuste('prevision');
  const iva = await ivaReal();
  const cf = await cashflow(); // caja: fecha del banco
  const cfG = cf; // ingresos y gastos reales por fecha de Revolut, con IVA
  const mesActual = new Date().toISOString().slice(0, 7);
  const ultimoMesReal = cf.meses.filter((m) => m < mesActual).pop() || cf.meses[cf.meses.length - 1];
  const gIdx = Object.fromEntries(cfG.meses.map((m, i) => [m, i]));

  // Real mes a mes (ingresos = cobros de ventas, gastos = gasto operativo, caja = saldo del banco)
  const historico = cf.meses.filter((m) => m <= ultimoMesReal).map((mes) => {
    const i = gIdx[mes];
    let ingresos = 0, gastos = 0;
    for (const d of i === undefined ? [] : cfG.desglose) {
      if (d.tipo === 'Cobros' && d.grupo === 'Ventas') ingresos += d.valores[i];
      else if (esGastoOperativo(d)) gastos -= d.valores[i];
    }
    return { mes, ingresos: r2(ingresos), gastos: r2(gastos), resultado: r2(ingresos - gastos), caja: cf.saldoFin[cf.meses.indexOf(mes)] };
  });

  // Supuestos del simulador (se crean una vez a partir de la previsión anterior)
  let s = await getAjuste('simulacion');
  if (!s) {
    const p = conf?.parametros || {};
    const ing = await ingresos();
    const ult3 = (arr) => { const v = arr.slice(-3); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    const ultimos = historico.slice(-3);
    const prevMes = await q('SELECT mes, valores FROM prevision_mes');
    const futuros = Object.values(Object.fromEntries(prevMes
      .filter((r) => r.mes > ultimoMesReal).map((r) => [r.mes, JSON.parse(r.valores).nuevos ?? 0])));
    s = {
      restaurantes: p.restaurantes ?? 72,
      // Ritmo real de los últimos 3 meses: clientes con puesta en marcha y bajas
      nuevosMes: Math.round(ult3(ing.puntualClientes)) || (futuros.length ? Math.round(futuros.reduce((a, b) => a + b, 0) / futuros.length) : 3),
      bajasMes: Math.round(ult3(ing.bajas)),
      ticketMedio: p.ticketMedio ?? 75,
      precioPuestaMarcha: p.precioPuestaMarcha ?? 250,
      gastoMensual: p.gastoMensual ?? (ultimos.length ? Math.round(ultimos.reduce((a, h) => a + h.gastos, 0) / ultimos.length / 10) * 10 : 8000),
      horizonte: 12,
      incluirHacienda: p.incluirIva ?? 1,
      ajustes: [],
    };
    // Restaurantes a fecha de hoy: los que tenía la previsión anterior al final del último mes real
    if (conf?.mesBase && conf.mesBase < ultimoMesReal) {
      const nuevosPorMes = Object.fromEntries(prevMes.map((r) => [r.mes, JSON.parse(r.valores).nuevos ?? 0]));
      for (let m = conf.mesBase; m <= ultimoMesReal; m = sumarMeses(m, 1)) s.restaurantes += nuevosPorMes[m] || 0;
    }
    // Locales de hoy y ticket por local, con las facturas del último mes (si traen el nombre del local)
    const ul = ing.locales?.[ing.locales.length - 1];
    if (ul) s.restaurantes = ul;
    if (ing.mrr.length && s.restaurantes) s.ticketMedio = Math.round((ing.mrr[ing.mrr.length - 1] / s.restaurantes) * 100) / 100;
    await setAjuste('simulacion', s);
  }

  // Datos reales para arrancar: IVA de los meses ya cerrados del trimestre en curso y pagos pendientes a Hacienda
  const mesInicio = sumarMeses(ultimoMesReal, 1);
  const trimInicio = sumarMeses(mesInicio, -((Number(mesInicio.slice(5, 7)) - 1) % 3));
  const ivaMesesReales = {};
  for (let m = trimInicio; m < mesInicio; m = sumarMeses(m, 1)) ivaMesesReales[m] = { rep: iva.rep[m] || 0, sop: iva.sop[m] || 0, ret: iva.ret[m] || 0 };
  const imp = await impuestos();
  const pagosPendientes = {};
  for (const t of imp.trimestres) if (t.estado === 'pendiente' && t.vence.slice(0, 7) >= mesInicio) pagosPendientes[t.vence.slice(0, 7)] = t.total;
  const ultimoCerrado = imp.trimestres.filter((t) => t.estado !== 'en curso').pop();
  // Ritmo real de puestas en marcha (media de los últimos 3 meses): lo que ya está vendido y se pondrá en marcha pronto
  const ingSinIva = await ingresos();
  const ritmoActual = Math.round(ingSinIva.puntualClientes.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ingSinIva.puntualClientes.length)));
  // Semanas desde la venta hasta la puesta en marcha (antes se guardaba en meses)
  if (s.semanas === undefined) { s = { ...s, semanas: Math.round((s.retraso ?? 1) * 4) }; await setAjuste('simulacion', s); }
  const base = {
    mesInicio,
    ritmoActual,
    cajaInicial: historico.length ? historico[historico.length - 1].caja : 0,
    tipos: await tiposMedios(iva.movs),
    ivaMesesReales,
    pagosPendientes,
    compensarIva: ultimoCerrado ? ultimoCerrado.compensarSiguiente : 0,
  };
  const sim = simular(s, base);

  // Conceptos de pago para montar el gasto mensual: cada proveedor o transferencia del último año,
  // con el importe de su último pago (si ese día hubo varios, la suma), si se repite cada mes y si se ha pagado últimamente
  const desde = sumarMeses(ultimoMesReal, -11) + '-01';
  const desdeReciente = sumarMeses(ultimoMesReal, -2) + '-01';
  const pagos = await q(`SELECT fecha, descripcion, importe, grupo, subgrupo FROM movimientos
    WHERE tipo = 'Pagos' AND importe < 0 AND fecha >= ? AND COALESCE(grupo, '') != 'Impuestos y deuda' AND COALESCE(subgrupo, '') != 'IRPF'
    ORDER BY fecha, id`, [desde]);
  const claveConcepto = (d) => d.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*.*$/, '').replace(/[0-9]+/g, '').replace(/[^a-z&]+/g, ' ').trim();
  const porConcepto = new Map();
  for (const pg of pagos) {
    const k = claveConcepto(pg.descripcion);
    if (!porConcepto.has(k)) porConcepto.set(k, { clave: k, pagos: [] });
    const c = porConcepto.get(k);
    c.pagos.push(pg); c.nombre = pg.descripcion; c.categoria = `${pg.grupo} › ${pg.subgrupo}`;
  }
  const gastosTipo = [...porConcepto.values()].map((c) => {
    const ultimo = c.pagos[c.pagos.length - 1].fecha;
    return {
      clave: c.clave, nombre: c.nombre, categoria: c.categoria, ultimoPago: ultimo,
      importe: r2(-c.pagos.filter((pg) => pg.fecha === ultimo).reduce((x, pg) => x + pg.importe, 0)),
      meses: new Set(c.pagos.filter((pg) => pg.fecha >= desdeReciente).map((pg) => pg.fecha.slice(0, 7))).size,
      reciente: ultimo >= desdeReciente,
    };
  }).sort((x, y) => (y.meses >= 2) - (x.meses >= 2) || y.reciente - x.reciente || y.importe - x.importe);

  return {
    supuestos: s,
    base,
    gastosTipo,
    historico,
    ultimoMesReal,
    filas: sim.filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, typeof x === 'number' ? r2(x) : x]))),
    resumen: sim.resumen,
  };
}

// ---------- impuestos: IVA (modelo 303) e IRPF retenido (modelo 111) por trimestre ----------
const trimestreDe = (mes) => `${mes.slice(0, 4)}-T${Math.ceil(Number(mes.slice(5, 7)) / 3)}`;
// Plazo de pago: 20 del mes siguiente al trimestre; el 4T, 30 de enero
function plazo(trim) {
  const [y, t] = [Number(trim.slice(0, 4)), Number(trim.slice(-1))];
  return t === 4 ? `${y + 1}-01-30` : `${y}-${String(t * 3 + 1).padStart(2, '0')}-20`;
}

export async function impuestos() {
  const { rep, sop, ret } = await ivaReal();
  const hoy = new Date().toISOString().slice(0, 10);
  // Desde el primer mes con facturas: antes no hay IVA repercutido y el cálculo no sería completo
  const primerMes = Object.keys(rep).sort()[0];
  const meses = [...new Set([...Object.keys(rep), ...Object.keys(sop), ...Object.keys(ret)])].filter((m) => m >= primerMes).sort();
  if (!meses.length) return { trimestres: [], hoy };

  // Pagos a Hacienda encontrados en el banco (por fecha del banco)
  const pagos = await q(`SELECT fecha, importe, subgrupo FROM movimientos
    WHERE (subgrupo IN ('IVA (declaraciones)', 'IRPF') OR descripcion ILIKE '%Agencia Tributaria%' OR descripcion ILIKE '%AEAT%') AND importe < 0`);

  const trims = [...new Set(rangoMeses(meses[0], hoy.slice(0, 7)).map(trimestreDe))];
  const marcados = await getAjuste('impuestosPagados', {}); // trimestres pagados desde fuera de Revolut
  let compensar = 0; // IVA negativo de trimestres anteriores
  const trimestres = trims.map((t) => {
    const ms = rangoMeses(meses[0], hoy.slice(0, 7)).filter((m) => trimestreDe(m) === t);
    const s = (o) => ms.reduce((a, m) => a + (o[m] || 0), 0);
    const repercutido = s(rep), soportado = s(sop), retenciones = s(ret);
    const ivaTrim = repercutido - soportado;
    const ivaConCompensar = ivaTrim + compensar;
    const ivaPagar = Math.max(0, ivaConCompensar);
    const compensarAntes = compensar;
    compensar = Math.min(0, ivaConCompensar);
    const vence = plazo(t);
    // Pagos del banco dentro del mes de plazo (o hasta 15 días después)
    const ini = vence.slice(0, 8) + '01';
    const fin = new Date(Date.parse(vence) + 15 * 864e5).toISOString().slice(0, 10);
    const pagado = pagos.filter((p) => p.fecha >= ini && p.fecha <= fin);
    const enCurso = ms.includes(hoy.slice(0, 7));
    return {
      trimestre: t, meses: ms, enCurso, vence,
      repercutido: r2(repercutido), soportado: r2(soportado), ivaTrimestre: r2(ivaTrim),
      compensarAnterior: r2(compensarAntes), ivaPagar: r2(ivaPagar), compensarSiguiente: r2(compensar),
      retenciones: r2(retenciones), total: r2(ivaPagar + retenciones),
      pagadoBanco: Math.abs(r2(pagado.reduce((a, p) => a + p.importe, 0))),
      pagadoFuera: !!marcados[t],
      estado: enCurso ? 'en curso' : pagado.length || marcados[t] ? 'pagado' : hoy > fin ? 'sin pago en el banco' : 'pendiente',
    };
  });
  const cf = await cashflow();
  const saldo = cf.saldoBanco.filter((x) => x !== null).pop() ?? cf.saldoFin[cf.saldoFin.length - 1];
  const pendientes = trimestres.filter((t) => t.estado === 'pendiente' || t.estado === 'en curso');
  const deuda = pendientes.reduce((a, t) => a + t.total, 0);
  return { hoy, trimestres, saldo: r2(saldo), pendiente: r2(deuda), cajaLibre: r2(saldo - deuda) };
}

