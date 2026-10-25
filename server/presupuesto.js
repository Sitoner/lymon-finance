// Presupuesto anual: el ingreso del mes se reparte entre partidas (% del ingreso o € fijos al mes)
// y se compara con el gasto real. Todo sin IVA y por mes de gasto, que es lo que cuesta cada cosa.
import { q, run, tx, getAjuste, setAjuste } from './db.js';
import { cashflow, ingresos, rangoMeses } from './metrics.js';

const r2 = (n) => Math.round(n * 100) / 100;
const r10 = (n) => Math.round(n / 10) * 10;
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const distancia = (desde, hasta) => (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7));

// Gasto que entra en el presupuesto: los pagos operativos (el IVA que se declara no es un gasto)
export const GRUPOS_GASTO = ['Personal', 'Producción', 'Marketing', 'Generales'];

// Reparto recomendado para empezar: lo que suele pedir una empresa sana de software
export const RECOMENDADO = [
  { nombre: 'Personal', tipo: 'gasto', valor: 45, categorias: ['Personal'] },
  { nombre: 'Producción', tipo: 'gasto', valor: 12, categorias: ['Producción'] },
  { nombre: 'Marketing y ventas', tipo: 'gasto', valor: 15, categorias: ['Marketing'] },
  { nombre: 'Generales', tipo: 'gasto', valor: 8, categorias: ['Generales'] },
  { nombre: 'Reserva de impuestos', tipo: 'reserva', valor: 10, categorias: [] },
  { nombre: 'Beneficio y colchón', tipo: 'reserva', valor: 10, categorias: [] },
];

// Lo que le toca a una partida en un mes con un ingreso dado
export function importePartida(p, ingreso) {
  if (p.modo === 'fijo') return p.valor;
  let v = (p.valor / 100) * Math.max(0, ingreso);
  if (p.minimo != null) v = Math.max(v, p.minimo);
  if (p.maximo != null) v = Math.min(v, p.maximo);
  return v;
}

// Datos reales por mes (solo meses cerrados): ingreso facturado sin IVA y gasto por grupo|subgrupo
async function reales() {
  const hoy = new Date().toISOString().slice(0, 7);
  const [ing, cf] = await Promise.all([ingresos(), cashflow({ porGasto: true })]);
  const ingreso = {};
  ing.meses.forEach((m, i) => { if (m < hoy) ingreso[m] = ing.total[i]; });
  const gasto = {}; // mes -> { "grupo|subgrupo": € }
  for (const d of cf.desglose) {
    if (d.tipo !== 'Pagos' || !GRUPOS_GASTO.includes(d.grupo)) continue;
    cf.meses.forEach((m, i) => {
      if (m >= hoy || !d.valores[i]) return;
      (gasto[m] ||= {})[`${d.grupo}|${d.subgrupo}`] = -d.valores[i];
    });
  }
  // Meses cerrados con datos completos: los que tienen facturas y gasto
  const cerrados = Object.keys(ingreso).filter((m) => gasto[m]).sort();
  return { ing, ingreso, gasto, cerrados };
}

// Partida a la que va cada línea de gasto: gana la que la nombra con subgrupo; si no, la de su grupo
function asignador(partidas) {
  return (clave) => {
    const grupo = clave.split('|')[0];
    return partidas.find((p) => p.tipo === 'gasto' && p.categorias.includes(clave))
      || partidas.find((p) => p.tipo === 'gasto' && p.categorias.includes(grupo)) || null;
  };
}

// Ingresos previstos por defecto: el MRR de enero (real si ya existe, si no proyectado) y su ritmo de crecimiento
function ingresosPorDefecto(anio, { ing, cerrados }) {
  const idx = (m) => ing.meses.indexOf(m);
  const ult = cerrados[cerrados.length - 1];
  if (!ult) return { base: 0, crecimiento: 0, puntual: 0 };
  const mrr = cerrados.map((m) => ing.mrr[idx(m)]);
  const deltas = mrr.slice(1).map((v, i) => v - mrr[i]).slice(-6);
  const crecimiento = Math.max(0, r10(media(deltas)));
  const puntual = r10(media(cerrados.slice(-3).map((m) => ing.puntual[idx(m)])));
  const enero = `${anio}-01`;
  const base = cerrados.includes(enero) ? ing.mrr[idx(enero)] : ing.mrr[idx(ult)] + crecimiento * distancia(ult, enero);
  return { base: Math.max(0, r10(base)), crecimiento, puntual };
}

const leerPartidas = async (anio) => (await q('SELECT * FROM presupuesto_partidas WHERE anio = ? ORDER BY orden, id', [anio]))
  .map((p) => ({ ...p, categorias: JSON.parse(p.categorias || '[]') }));

export async function presupuesto(anio) {
  const real = await reales();
  const config = (await getAjuste(`presupuesto:${anio}`)) || ingresosPorDefecto(anio, real);
  const partidas = await leerPartidas(anio);
  const meses = rangoMeses(`${anio}-01`, `${anio}-12`);
  const asignar = asignador(partidas);

  const previsto = meses.map((_, i) => r2(config.base + config.crecimiento * i + config.puntual));
  const ingresoReal = meses.map((m) => (real.cerrados.includes(m) ? r2(real.ingreso[m]) : null));

  // Gasto real de cada partida por mes, y lo que no cae en ninguna
  const gastoPartida = Object.fromEntries(partidas.map((p) => [p.id, meses.map(() => 0)]));
  const sinPartida = meses.map(() => 0);
  const sinPartidaDetalle = {};
  meses.forEach((m, i) => {
    if (ingresoReal[i] === null) return;
    for (const [clave, v] of Object.entries(real.gasto[m] || {})) {
      const p = asignar(clave);
      if (p) gastoPartida[p.id][i] += v;
      else { sinPartida[i] += v; sinPartidaDetalle[clave] = (sinPartidaDetalle[clave] || 0) + v; }
    }
  });

  // Gasto medio de los últimos 3 meses cerrados (de cualquier año): para saber qué ingreso haría falta
  const ultimos = real.cerrados.slice(-3);
  const medioUltimos = (p) => media(ultimos.map((m) => Object.entries(real.gasto[m] || {}).reduce((a, [k, v]) => a + (asignar(k)?.id === p.id ? v : 0), 0)));
  const ingresoUltimos = media(ultimos.map((m) => real.ingreso[m]));

  const filas = partidas.map((p) => {
    const plan = previsto.map((x) => r2(importePartida(p, x)));
    const flexible = ingresoReal.map((x) => (x === null ? null : r2(importePartida(p, x))));
    const gasto = p.tipo === 'gasto' ? gastoPartida[p.id].map((v, i) => (ingresoReal[i] === null ? null : r2(v))) : null;
    const actual = p.tipo === 'gasto' && ultimos.length ? medioUltimos(p) : null;
    return {
      ...p, plan, flexible, gasto,
      planAnual: r2(plan.reduce((a, b) => a + b, 0)),
      // Gasto medio actual y el ingreso mensual con el que ese gasto cabría en su %
      gastoActual: actual === null ? null : r2(actual),
      ingresoNecesario: actual && p.modo === 'pct' && p.valor > 0 ? r10(actual / (p.valor / 100)) : null,
    };
  });

  return {
    anio, config, meses, previsto, ingresoReal,
    previstoAnual: r2(previsto.reduce((a, b) => a + b, 0)),
    partidas: filas,
    sinPartida: sinPartida.map((v, i) => (ingresoReal[i] === null ? null : r2(v))),
    sinPartidaDetalle: Object.entries(sinPartidaDetalle).map(([k, v]) => ({ categoria: k.replace('|', ' › '), importe: r2(v) })).sort((a, b) => b.importe - a.importe),
    ultimos: { meses: ultimos, ingreso: r2(ingresoUltimos) },
    categorias: (await q("SELECT grupo, subgrupo FROM categorias WHERE tipo = 'Pagos' ORDER BY orden, id"))
      .filter((c) => GRUPOS_GASTO.includes(c.grupo)),
  };
}

// Reparto que sale del gasto real de los últimos 12 meses cerrados: % de cada grupo sobre lo facturado
async function desdeHistorico() {
  const real = await reales();
  const meses = real.cerrados.slice(-12);
  const ingreso = meses.reduce((a, m) => a + real.ingreso[m], 0);
  if (!ingreso) return RECOMENDADO;
  const porGrupo = Object.fromEntries(GRUPOS_GASTO.map((g) => [g, 0]));
  for (const m of meses) for (const [k, v] of Object.entries(real.gasto[m] || {})) porGrupo[k.split('|')[0]] += v;
  const pct = (v) => Math.round((v / ingreso) * 1000) / 10;
  const gastos = RECOMENDADO.filter((p) => p.tipo === 'gasto').map((p) => ({ ...p, valor: pct(porGrupo[p.categorias[0]]) }));
  const sobra = Math.max(0, Math.round((100 - gastos.reduce((a, p) => a + p.valor, 0)) * 10) / 10);
  return [...gastos, { nombre: 'Beneficio y colchón', tipo: 'reserva', valor: sobra, categorias: [] }];
}

export async function guardarIngresos(anio, { base, crecimiento, puntual }) {
  const n = (v) => { const x = Number(v); if (!Number.isFinite(x) || x < 0) throw new Error('Los ingresos previstos tienen que ser cifras positivas'); return x; };
  await setAjuste(`presupuesto:${anio}`, { base: n(base), crecimiento: Number(crecimiento) || 0, puntual: n(puntual) });
}

export async function usarPlantilla(anio, origen) {
  const lista = origen === 'historico' ? await desdeHistorico() : RECOMENDADO;
  await tx(async () => {
    await run('DELETE FROM presupuesto_partidas WHERE anio = ?', [anio]);
    let orden = 0;
    for (const p of lista) await crearPartida(anio, { ...p, orden: orden++ });
  });
}

function validar(p) {
  const out = {};
  if ('nombre' in p) { out.nombre = String(p.nombre || '').trim(); if (!out.nombre) throw new Error('La partida necesita un nombre'); }
  if ('tipo' in p) { if (!['gasto', 'reserva'].includes(p.tipo)) throw new Error('Tipo no válido'); out.tipo = p.tipo; }
  if ('modo' in p) { if (!['pct', 'fijo'].includes(p.modo)) throw new Error('Modo no válido'); out.modo = p.modo; }
  if ('valor' in p) {
    const v = Number(p.valor);
    if (!Number.isFinite(v) || v < 0) throw new Error('El valor tiene que ser una cifra positiva');
    out.valor = v;
  }
  for (const k of ['minimo', 'maximo']) {
    if (!(k in p)) continue;
    if (p[k] === null || p[k] === '') { out[k] = null; continue; }
    const v = Number(p[k]);
    if (!Number.isFinite(v) || v < 0) throw new Error(`El ${k === 'minimo' ? 'mínimo' : 'máximo'} tiene que ser una cifra positiva`);
    out[k] = v;
  }
  if ('categorias' in p) out.categorias = JSON.stringify((Array.isArray(p.categorias) ? p.categorias : []).map(String));
  if ('orden' in p) out.orden = Number(p.orden) || 0;
  return out;
}

export async function crearPartida(anio, p) {
  const v = validar({ nombre: 'Nueva partida', tipo: 'gasto', modo: 'pct', valor: 0, categorias: [], ...p });
  if (v.modo === 'pct' && v.valor > 100) throw new Error('Un porcentaje no puede pasar del 100 %');
  if (!('orden' in p)) v.orden = Number((await q('SELECT COALESCE(MAX(orden), -1) + 1 o FROM presupuesto_partidas WHERE anio = ?', [anio]))[0].o);
  const cols = Object.keys(v);
  await run(`INSERT INTO presupuesto_partidas (anio, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [anio, ...Object.values(v)]);
}

export async function editarPartida(id, p) {
  const v = validar(p);
  const actual = (await q('SELECT modo, valor FROM presupuesto_partidas WHERE id = ?', [id]))[0];
  if (!actual) throw new Error('No existe');
  if ((v.modo ?? actual.modo) === 'pct' && (v.valor ?? actual.valor) > 100) throw new Error('Un porcentaje no puede pasar del 100 %');
  const cols = Object.keys(v);
  if (!cols.length) return;
  await run(`UPDATE presupuesto_partidas SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(v), id]);
}

export const borrarPartida = (id) => run('DELETE FROM presupuesto_partidas WHERE id = ?', [id]);

