import * as XLSX from 'xlsx';
import { q, one, run } from './db.js';

const r2 = (n) => Math.round(n * 100) / 100;

function num(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  // "1.234,56 €", "99.00 €", "21.00%"
  let s = String(v).replace(/[€%\s]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  return Number(s) || 0;
}

function fechaISO(v) {
  if (v instanceof Date) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === 'number') return fechaISO(new Date(Math.round((v - 25569) * 864e5)));
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
}

function leerHoja(buffer, nombre) {
  const esCsv = /\.csv$/i.test(nombre || '');
  const wb = esCsv
    ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
}

// ---------- categorización automática ----------
// Normaliza descripciones para encontrar movimientos "iguales": quita números, referencias tras '*', etc.
export function patron(desc) {
  return String(desc || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\*.*$/, '')
    .replace(/[0-9]+/g, '')
    .replace(/[^a-z&]+/g, ' ')
    .trim();
}

export async function sugeridor() {
  const hist = await q('SELECT descripcion, importe, tipo, grupo, subgrupo FROM movimientos WHERE tipo IS NOT NULL ORDER BY fecha DESC, id DESC');
  const porPatron = new Map();
  for (const h of hist) {
    const k = patron(h.descripcion) + (h.importe >= 0 ? '|+' : '|-');
    if (!porPatron.has(k)) porPatron.set(k, h); // el más reciente manda
  }
  return (desc, importe) => {
    const h = porPatron.get(patron(desc) + (importe >= 0 ? '|+' : '|-'));
    return h ? { tipo: h.tipo, grupo: h.grupo, subgrupo: h.subgrupo } : null;
  };
}

// Mes de gasto sugerido (null = el mismo mes que el banco):
//  1) si la referencia nombra un mes ("Factura Honorarios Julio"), ese mes
//  2) honorarios/salarios pagados hasta el día 15 corresponden al mes anterior
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function sugerirMesGasto(fecha, cat, referencia = '') {
  if (!fecha || !cat) return null;
  const [y, m] = fecha.split('-').map(Number);
  const anterior = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const palabras = String(referencia || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/);
  const nombrados = MESES_ES.map((n, k) => (palabras.includes(n) ? k + 1 : 0)).filter(Boolean);
  if (cat.tipo !== 'Cobros' && nombrados.length >= 1) {
    const mm = nombrados[nombrados.length - 1]; // si nombra varios ("Julio, Agosto, Septiembre"), el último
    const anio = mm > m ? y - 1 : y; // "Diciembre" pagado en enero = diciembre del año anterior
    const mes = `${anio}-${String(mm).padStart(2, '0')}`;
    return mes === fecha.slice(0, 7) ? null : mes;
  }
  if (cat.grupo === 'Personal' && /^(Salarios|Honorarios)/.test(cat.subgrupo || '') && Number(fecha.slice(8, 10)) <= 15) return anterior;
  return null;
}

// Si la referencia nombra varios meses ("Servicios Julio, Agosto, Septiembre"), el gasto se reparte entre ellos
export function sugerirMesesGasto(referencia = '') {
  const palabras = String(referencia || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/);
  const n = MESES_ES.filter((m) => palabras.includes(m)).length;
  return n > 1 ? n : null;
}

// ---------- Revolut ----------
export async function parsearRevolut(buffer, nombre) {
  const filas = leerHoja(buffer, nombre);
  if (!filas.length || !('Total amount' in filas[0] || 'Amount' in filas[0])) {
    throw new Error('No parece un extracto de Revolut (faltan las columnas "Total amount" / "Date completed (UTC)").');
  }
  const sugerir = await sugeridor();
  const existentesId = new Set((await q('SELECT ext_id FROM movimientos WHERE ext_id IS NOT NULL')).map((r) => r.ext_id));
  const sinId = await q('SELECT id, fecha, descripcion, importe FROM movimientos WHERE ext_id IS NULL ORDER BY id');
  const usados = new Set();

  const salida = [];
  for (const f of filas) {
    const estado = f.State || 'COMPLETED';
    if (estado !== 'COMPLETED') continue;
    const fecha = fechaISO(f['Date completed (UTC)'] || f['Date started (UTC)']);
    const importe = r2(num(f['Total amount'] ?? f.Amount));
    const descripcion = String(f.Description || '').trim();
    const ext_id = f.ID || null;
    let duplicado = ext_id && existentesId.has(ext_id);
    let idExistente = null; // movimiento del histórico (sin ID) que corresponde a esta fila
    if (!duplicado) {
      // Históricos del Excel no tienen ID: mismo importe y descripción con +/- 4 días
      const t = Date.parse(fecha);
      const fechaIni = fechaISO(f['Date started (UTC)']);
      const hit = sinId.find((m) => !usados.has(m.id) && Math.abs(m.importe - importe) < 0.005 && m.descripcion === descripcion
        && (Math.abs(Date.parse(m.fecha) - t) <= 4 * 864e5 || m.fecha === fechaIni));
      if (hit) { usados.add(hit.id); duplicado = true; idExistente = hit.id; }
    }
    const sug = sugerir(descripcion, importe);
    salida.push({
      ext_id, fecha, descripcion, importe,
      referencia: f.Reference || null,
      contraparte: f.Payer || null,
      divisa: f['Payment currency'] || 'EUR',
      saldo_banco: f.Balance !== null && f.Balance !== undefined && f.Balance !== '' ? num(f.Balance) : null,
      tipoRevolut: f.Type || null,
      duplicado: !!duplicado,
      idExistente,
      ...(sug || { tipo: null, grupo: null, subgrupo: null }),
      sugerido: !!sug,
    });
  }
  // Saldo de cierre de cada mes según el extracto: la primera fila de cada mes es la más reciente
  const saldosMes = {};
  for (const x of salida) if (x.saldo_banco !== null && x.fecha) { const m = x.fecha.slice(0, 7); if (!saldosMes[m] || x.fecha > saldosMes[m].fecha) saldosMes[m] = { fecha: x.fecha, saldo: x.saldo_banco }; }
  salida.saldosMes = saldosMes;
  // Revolut lista del más nuevo al más antiguo: invertimos para que, dentro del mismo día, el último sea el más reciente
  salida.reverse().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return salida;
}

export async function guardarRevolut(filas, archivo, saldosMes = filas.saldosMes) {
  for (const [mes, x] of Object.entries(saldosMes || {})) {
    await run(`INSERT INTO saldos_banco (banco, mes, fecha, saldo) VALUES ('Revolut', ?, ?, ?)
      ON CONFLICT (banco, mes) DO UPDATE SET fecha = excluded.fecha, saldo = excluded.saldo WHERE excluded.fecha >= saldos_banco.fecha`, [mes, x.fecha, x.saldo]);
  }
  let nuevos = 0;
  const dup = filas.filter((f) => f.duplicado).length;
  for (const f of filas) {
    if (f.duplicado) {
      // Completa los movimientos del histórico con el ID y el saldo de Revolut (para cuadrar cada mes con el banco)
      if (f.idExistente && f.ext_id) {
        await run(`UPDATE movimientos SET ext_id = ?, saldo_banco = ?, referencia = COALESCE(referencia, ?), contraparte = COALESCE(contraparte, ?)
          WHERE id = ? AND ext_id IS NULL`, [f.ext_id, f.saldo_banco, f.referencia, f.contraparte, f.idExistente]);
      }
      continue;
    }
    await run(`INSERT INTO movimientos (banco, fecha, descripcion, referencia, contraparte, importe, divisa, tipo, grupo, subgrupo, ext_id, saldo_banco, origen)
      VALUES ('Revolut', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'revolut')`,
    [f.fecha, f.descripcion, f.referencia, f.contraparte, f.importe, f.divisa, f.tipo || null, f.grupo || null, f.subgrupo || null, f.ext_id, f.saldo_banco]);
    nuevos++;
  }
  await run("INSERT INTO importaciones (tipo, archivo, nuevos, duplicados) VALUES ('revolut', ?, ?, ?)", [archivo, nuevos, dup]);
  return { nuevos, duplicados: dup };
}

// ---------- Beel ----------
export function clasificarConcepto(concepto) {
  const c = String(concepto || '').toLowerCase();
  if (/anticipo|monedero/.test(c)) return { clase: 'excluida', meses: 1 };
  if (/puesta en marcha|implantaci/.test(c)) return { clase: 'puntual', meses: 1 };
  if (/anual/.test(c)) return { clase: 'recurrente', meses: 12 };
  if (/semestral/.test(c)) return { clase: 'recurrente', meses: 6 };
  if (/trimestral/.test(c)) return { clase: 'recurrente', meses: 3 };
  return { clase: 'recurrente', meses: 1 };
}

export async function parsearBeel(buffer, nombre) {
  const filas = leerHoja(buffer, nombre);
  if (!filas.length || !('Num Factura' in filas[0])) throw new Error('No parece un export de facturas de Beel (falta la columna "Num Factura").');
  const existentes = await q('SELECT numero, linea, concepto, base, origen FROM facturas');
  const numerosExcel = new Set(existentes.filter((e) => e.origen === 'excel').map((e) => e.numero));
  const claves = new Set(existentes.map((e) => `${e.numero}|${(e.concepto || '').trim()}|${r2(e.base)}`));

  const lineas = {};
  return filas
    .filter((f) => f['Num Factura'] && String(f.Borrador || 'No').toLowerCase() !== 'sí' && String(f.Borrador || 'No').toLowerCase() !== 'si')
    .map((f) => {
      const numero = String(f['Num Factura']).trim();
      const linea = (lineas[numero] = (lineas[numero] || 0) + 1);
      const concepto = String(f.Item || '').replace(/\s+/g, ' ').trim();
      const total = r2(num(f.Total));
      // Rectificativas: si el total es negativo, la base también
      const base = total < 0 ? -Math.abs(r2(num(f.Subtotal))) : r2(num(f.Subtotal));
      const duplicado = numerosExcel.has(numero) || claves.has(`${numero}|${concepto}|${base}`);
      return {
        numero, linea,
        fecha: fechaISO(f['Fecha expedición'] || f.Fecha || f['Fecha operación']),
        cliente: String(f.Contacto || '').trim(),
        nif: f['NIF Contacto'] || null,
        concepto, base,
        total,
        ...clasificarConcepto(concepto),
        duplicado,
      };
    })
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numero.localeCompare(b.numero)));
}

export async function guardarBeel(filas, archivo) {
  let nuevos = 0;
  const dup = filas.filter((f) => f.duplicado).length;
  for (const f of filas) {
    if (f.duplicado) continue;
    const linea = (await one('SELECT COALESCE(MAX(linea), 0) m FROM facturas WHERE numero = ?', [f.numero])).m + 1;
    await run(`INSERT INTO facturas (numero, linea, fecha, cliente, nif, concepto, base, total, clase, meses, origen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'beel')`, [f.numero, linea, f.fecha, f.cliente, f.nif, f.concepto, f.base, f.total, f.clase, f.meses || 1]);
    nuevos++;
  }
  await run("INSERT INTO importaciones (tipo, archivo, nuevos, duplicados) VALUES ('beel', ?, ?, ?)", [archivo, nuevos, dup]);
  return { nuevos, duplicados: dup };
}
