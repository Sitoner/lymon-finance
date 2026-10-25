// API de la app (antes Express). app/api/[...ruta]/route.js le pasa cada petición.
import * as XLSX from 'xlsx';
import { q, one, run, tx, getAjuste, setAjuste, ivaPorDefecto } from './db.js';
import { cashflow, ingresos, prevision, impuestos } from './metrics.js';
import { parsearRevolut, guardarRevolut, parsearBeel, guardarBeel, patron } from './importers.js';

class Fallo extends Error {
  constructor(mensaje, code = 400) { super(mensaje); this.code = code; }
}

const rutas = [];
const ruta = (metodo, patronRuta, fn) => {
  const nombres = [];
  const re = new RegExp('^' + patronRuta.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; }) + '$');
  rutas.push({ metodo, re, nombres, fn });
};

// ---------- resumen ----------
ruta('GET', '/resumen', async () => {
  const [empresa, cf, ing, ingIva, prev, imp, pend, ultima] = await Promise.all([
    getAjuste('empresa', ''), cashflow(), ingresos(), ingresos({ conIva: true }), prevision(), impuestos(),
    one('SELECT COUNT(*)::int n FROM movimientos WHERE tipo IS NULL'),
    one('SELECT * FROM importaciones ORDER BY id DESC LIMIT 1'),
  ]);
  return { empresa, cashflow: cf, ingresos: ing, ingresosIva: ingIva, prevision: prev, impuestos: imp, pendientes: pend.n, ultimaImportacion: ultima || null };
});

// ---------- categorías ----------
ruta('GET', '/categorias', () => q(`SELECT c.id, c.tipo, c.grupo, c.subgrupo, c.iva, c.irpf, (SELECT COUNT(*)::int FROM movimientos m WHERE m.tipo = c.tipo AND m.grupo = c.grupo AND m.subgrupo = c.subgrupo) usos
  FROM categorias c ORDER BY c.orden, c.id`));
ruta('POST', '/categorias', async ({ body }) => {
  const { tipo, grupo, subgrupo } = body || {};
  if (!tipo || !grupo || !subgrupo) throw new Fallo('Faltan tipo, grupo o subgrupo');
  const orden = (await one('SELECT COALESCE(MAX(orden), 0) + 1 o FROM categorias WHERE tipo = ? AND grupo = ?', [tipo, grupo])).o;
  const iva = body.iva !== undefined && body.iva !== '' ? Number(body.iva) : ivaPorDefecto(tipo, grupo, subgrupo.trim());
  await run('INSERT INTO categorias (tipo, grupo, subgrupo, orden, iva) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [tipo, grupo, subgrupo.trim(), orden, iva]);
  return { ok: true };
});

ruta('PATCH', '/categorias/:id', async ({ params, body }) => {
  for (const campo of ['iva', 'irpf']) {
    if (!(campo in (body || {}))) continue;
    const v = Number(body[campo]);
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Fallo(`${campo.toUpperCase()} no válido`);
    await run(`UPDATE categorias SET ${campo} = ? WHERE id = ?`, [v, Number(params.id)]);
  }
  return { ok: true };
});

// ---------- movimientos ----------
ruta('GET', '/movimientos', ({ query }) => {
  const { mes, anio, q: texto, pendientes } = query;
  const where = [], args = [];
  if (mes) { where.push('substr(m.fecha, 1, 7) = ?'); args.push(mes); }
  else if (anio) { where.push('substr(m.fecha, 1, 4) = ?'); args.push(String(anio)); }
  if (pendientes === '1') where.push('m.tipo IS NULL');
  if (texto) { where.push("(m.descripcion ILIKE ? OR COALESCE(m.referencia,'') ILIKE ? OR COALESCE(m.subgrupo,'') ILIKE ? OR COALESCE(m.grupo,'') ILIKE ?)"); args.push(...Array(4).fill(`%${texto}%`)); }
  const sql = `SELECT m.*, c.iva AS iva_categoria, c.irpf AS irpf_categoria FROM movimientos m
    LEFT JOIN categorias c ON c.tipo = m.tipo AND c.grupo = m.grupo AND c.subgrupo = m.subgrupo
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.fecha DESC, m.id DESC`;
  return q(sql, args);
});

ruta('POST', '/movimientos', async ({ body }) => {
  const m = body || {};
  if (!m.fecha || !m.descripcion || m.importe === undefined) throw new Fallo('Faltan fecha, descripción o importe');
  const r = await one(`INSERT INTO movimientos (banco, fecha, descripcion, importe, divisa, tipo, grupo, subgrupo, origen)
    VALUES (?, ?, ?, ?, 'EUR', ?, ?, ?, 'manual') RETURNING id`, [m.banco || 'Revolut', m.fecha, m.descripcion, Number(m.importe), m.tipo || null, m.grupo || null, m.subgrupo || null]);
  return { id: r.id };
});

ruta('PATCH', '/movimientos/:id', async ({ params, body = {} }) => {
  const mov = await one('SELECT * FROM movimientos WHERE id = ?', [Number(params.id)]);
  if (!mov) throw new Fallo('No existe', 404);
  const { tipo = mov.tipo, grupo = mov.grupo, subgrupo = mov.subgrupo, aplicarSimilares = false } = body;
  let similares = 0;
  await tx(async () => {
    // IVA propio del movimiento: null = el de su categoría
    const propio = (k) => (k in body ? (body[k] === null || body[k] === '' ? null : Number(body[k])) : mov[k]);
    await run('UPDATE movimientos SET tipo = ?, grupo = ?, subgrupo = ?, iva = ?, irpf = ? WHERE id = ?',
      [tipo, grupo, subgrupo, propio('iva'), propio('irpf'), mov.id]);
    if (aplicarSimilares) {
      const p = patron(mov.descripcion);
      const signo = mov.importe >= 0;
      for (const o of await q('SELECT id, fecha, descripcion, referencia, importe FROM movimientos WHERE tipo IS NULL AND id != ?', [mov.id])) {
        if (patron(o.descripcion) === p && (o.importe >= 0) === signo) {
          await run('UPDATE movimientos SET tipo = ?, grupo = ?, subgrupo = ? WHERE id = ?', [tipo, grupo, subgrupo, o.id]);
          similares++;
        }
      }
    }
  });
  return { ok: true, similares };
});

ruta('DELETE', '/movimientos/:id', async ({ params }) => {
  await run('DELETE FROM movimientos WHERE id = ?', [Number(params.id)]);
  return { ok: true };
});

// ---------- facturas ----------
ruta('GET', '/facturas', ({ query }) => {
  const { mes, anio, q: texto } = query;
  const where = [], args = [];
  if (mes) { where.push('substr(fecha, 1, 7) = ?'); args.push(mes); }
  else if (anio) { where.push('substr(fecha, 1, 4) = ?'); args.push(String(anio)); }
  if (texto) { where.push("(cliente ILIKE ? OR numero ILIKE ? OR COALESCE(concepto,'') ILIKE ?)"); args.push(...Array(3).fill(`%${texto}%`)); }
  return q(`SELECT * FROM facturas ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, numero DESC, linea`, args);
});

ruta('PATCH', '/facturas/:id', async ({ params, body }) => {
  const f = await one('SELECT * FROM facturas WHERE id = ?', [Number(params.id)]);
  if (!f) throw new Fallo('No existe', 404);
  const { clase = f.clase, meses = f.meses, cliente = f.cliente } = body || {};
  if (!['recurrente', 'puntual', 'excluida'].includes(clase)) throw new Fallo('Clase no válida');
  await run('UPDATE facturas SET clase = ?, meses = ?, cliente = ? WHERE id = ?', [clase, Math.max(1, Number(meses) || 1), String(cliente).trim(), f.id]);
  return { ok: true };
});

ruta('DELETE', '/facturas/:id', async ({ params }) => {
  await run('DELETE FROM facturas WHERE id = ?', [Number(params.id)]);
  return { ok: true };
});

// ---------- importación ----------
const IMPORT = {
  revolut: { parsear: parsearRevolut, guardar: guardarRevolut },
  beel: { parsear: parsearBeel, guardar: guardarBeel },
};
ruta('POST', '/importar/:tipo/previsualizar', async ({ params, archivo, cabeceras }) => {
  const imp = IMPORT[params.tipo];
  if (!imp) throw new Fallo('Tipo de importación desconocido', 404);
  const buf = await archivo();
  if (!buf.length) throw new Fallo('No ha llegado el archivo. Vuelve a intentarlo.');
  const nombre = decodeURIComponent(cabeceras.get('x-archivo') || '');
  const filas = await imp.parsear(buf, nombre);
  return { archivo: nombre, filas, saldosMes: filas.saldosMes || null };
});
ruta('POST', '/importar/:tipo/confirmar', ({ params, body }) => {
  const imp = IMPORT[params.tipo];
  if (!imp) throw new Fallo('Tipo de importación desconocido', 404);
  const { filas, archivo, saldosMes } = body || {};
  return tx(() => imp.guardar(filas || [], archivo || null, saldosMes));
});
ruta('GET', '/importaciones', () => q('SELECT * FROM importaciones ORDER BY id DESC LIMIT 50'));

// ---------- previsión ----------
ruta('GET', '/prevision', () => prevision());

// Supuestos del simulador: { restaurantes, nuevosMes, ticketMedio, precioPuestaMarcha, gastoMensual, horizonte, incluirHacienda, ajustes }
ruta('PUT', '/prevision/config', async ({ body }) => {
  const actual = (await getAjuste('simulacion')) || {};
  const cambios = body?.supuestos || {};
  const listas = ['ajustes', 'partidas']; // el resto son números (incluido «retraso»)
  const numeros = Object.fromEntries(Object.entries(cambios).filter(([k]) => !listas.includes(k)).map(([k, v]) => [k, Number(v) || 0]));
  const nuevo = { ...actual, ...numeros, ...(Array.isArray(cambios.ajustes) && { ajustes: cambios.ajustes }), ...(Array.isArray(cambios.partidas) && { partidas: cambios.partidas }) };
  // Si el gasto está desglosado en partidas, el gasto mensual es su suma
  if (nuevo.partidas?.length) nuevo.gastoMensual = Math.round(nuevo.partidas.reduce((a, p) => a + (Number(p.importe) || 0), 0) * 100) / 100;
  await setAjuste('simulacion', nuevo);
  return prevision();
});

ruta('PUT', '/impuestos/:trimestre', async ({ params, body }) => {
  const m = await getAjuste('impuestosPagados', {});
  if (body?.pagado) m[params.trimestre] = true; else delete m[params.trimestre];
  await setAjuste('impuestosPagados', m);
  return impuestos();
});

// ---------- exportar (copia de seguridad en Excel) ----------
ruta('GET', '/exportar', async () => {
  const wb = XLSX.utils.book_new();
  const movs = await q('SELECT banco "Banco", fecha "Fecha", descripcion "Descripción", referencia "Referencia", importe "Importe", divisa "Divisa", tipo "Tipo", grupo "Grupo", subgrupo "Subgrupo", origen "Origen" FROM movimientos ORDER BY fecha, id');
  const facs = await q('SELECT fecha "Fecha", numero "Número", linea "Línea", cliente "Cliente", nif "NIF", concepto "Concepto", base "Base imponible", total "Total", clase "Clase", meses "Meses", origen "Origen" FROM facturas ORDER BY fecha, numero, linea');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movs), 'Movimientos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(facs), 'Facturas');
  const cf = await cashflow();
  const filasCf = [['Concepto', ...cf.meses],
    ...cf.desglose.map((d) => [`${d.tipo} / ${d.grupo} / ${d.subgrupo}`, ...d.valores]),
    ['Saldo fin de mes', ...cf.saldoFin]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasCf), 'Cashflow');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="lymon-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});

export async function manejar(request, partes = []) {
  const camino = '/' + partes.join('/');
  for (const r of rutas) {
    if (r.metodo !== request.method) continue;
    const m = camino.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const query = Object.fromEntries(new URL(request.url).searchParams);
    try {
      const esJson = (request.headers.get('content-type') || '').includes('application/json');
      const body = esJson ? await request.json().catch(() => ({})) : undefined;
      const archivo = async () => Buffer.from(await request.arrayBuffer());
      const res = await r.fn({ params, query, body, archivo, cabeceras: request.headers });
      return res instanceof Response ? res : Response.json(res ?? null);
    } catch (e) {
      if (!(e instanceof Fallo)) console.error(e);
      return Response.json({ error: e.message || String(e) }, { status: e instanceof Fallo ? e.code : 400 });
    }
  }
  return Response.json({ error: 'No encontrado' }, { status: 404 });
}
