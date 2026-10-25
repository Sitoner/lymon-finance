import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

// Postgres: en Vercel, DATABASE_URL (Neon, Supabase…). Sin DATABASE_URL, un Postgres embebido (PGlite)
// en data/pglite para trabajar en local sin instalar nada. LYMON_PGLITE=memory:// lo deja en memoria (tests).
export const DB_DESTINO = process.env.DATABASE_URL ? 'Postgres (DATABASE_URL)' : process.env.LYMON_PGLITE || path.join(process.cwd(), 'data', 'pglite');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  grupo TEXT NOT NULL,
  subgrupo TEXT NOT NULL,
  orden DOUBLE PRECISION NOT NULL DEFAULT 0, -- admite decimales para colocar una categoría entre dos
  iva DOUBLE PRECISION,
  irpf DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (tipo, grupo, subgrupo)
);

CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  banco TEXT NOT NULL DEFAULT 'Revolut',
  fecha TEXT NOT NULL,              -- YYYY-MM-DD (fecha en que se completa)
  descripcion TEXT NOT NULL,
  referencia TEXT,
  contraparte TEXT,
  importe DOUBLE PRECISION NOT NULL, -- en EUR, signo: + entra, - sale
  divisa TEXT NOT NULL DEFAULT 'EUR',
  tipo TEXT,
  grupo TEXT,
  subgrupo TEXT,
  ext_id TEXT UNIQUE,               -- ID de Revolut (NULL en los históricos del Excel)
  saldo_banco DOUBLE PRECISION,     -- saldo que informa el banco tras el movimiento
  origen TEXT NOT NULL,             -- excel | revolut | manual
  creado TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  mes_gasto TEXT,                   -- mes al que corresponde el gasto (devengo). NULL = el mismo mes que la fecha del banco
  iva DOUBLE PRECISION,             -- % de IVA incluido en el importe. NULL = el de su categoría
  irpf DOUBLE PRECISION,            -- % de retención de IRPF sobre la base. NULL = el de su categoría
  meses_gasto INTEGER               -- gasto repartido: meses_gasto meses que terminan en mes_gasto. NULL = 1
);
CREATE INDEX IF NOT EXISTS movimientos_fecha ON movimientos (fecha);

CREATE TABLE IF NOT EXISTS facturas (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL,
  linea INTEGER NOT NULL DEFAULT 1,
  fecha TEXT NOT NULL,
  cliente TEXT NOT NULL,
  nif TEXT,
  concepto TEXT,
  base DOUBLE PRECISION NOT NULL,
  total DOUBLE PRECISION,
  clase TEXT NOT NULL,              -- recurrente | puntual | excluida
  meses INTEGER NOT NULL DEFAULT 1, -- meses que cubre una factura recurrente
  origen TEXT NOT NULL,             -- excel | beel | manual
  creado TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (numero, linea)
);
CREATE INDEX IF NOT EXISTS facturas_fecha ON facturas (fecha);

CREATE TABLE IF NOT EXISTS importaciones (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  archivo TEXT,
  nuevos INTEGER NOT NULL,
  duplicados INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS saldos_banco (
  banco TEXT NOT NULL,
  mes TEXT NOT NULL,                -- YYYY-MM
  fecha TEXT NOT NULL,              -- fecha del último movimiento del mes en el extracto
  saldo DOUBLE PRECISION NOT NULL,  -- saldo tras ese movimiento
  PRIMARY KEY (banco, mes)
);

-- Presupuesto anual: el ingreso se reparte entre partidas. Los ingresos previstos del año van en ajustes («presupuesto:2027»)
CREATE TABLE IF NOT EXISTS presupuesto_partidas (
  id SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'gasto',   -- gasto (se compara con los pagos de sus categorías) | reserva (lo que debe sobrar: impuestos, colchón…)
  modo TEXT NOT NULL DEFAULT 'pct',     -- pct (% del ingreso del mes) | fijo (€ al mes)
  valor DOUBLE PRECISION NOT NULL DEFAULT 0,
  minimo DOUBLE PRECISION,              -- € al mes; solo en modo pct
  maximo DOUBLE PRECISION,
  categorias TEXT NOT NULL DEFAULT '[]', -- ["Personal", "Generales|Abogados"]: grupos o grupo|subgrupo de Pagos
  orden DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS presupuesto_partidas_anio ON presupuesto_partidas (anio);

CREATE TABLE IF NOT EXISTS prevision_mes (
  mes TEXT PRIMARY KEY,             -- YYYY-MM
  valores TEXT NOT NULL DEFAULT '{}' -- inputs y valores fijados a mano: {"nuevos":5,"personal":7000}
);
`;

// Una sola conexión por proceso (en desarrollo Next recarga los módulos: se guarda en globalThis)
const g = globalThis;
async function abrir() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    return {
      query: (sql, params) => pool.query(sql, params),
      async transaction(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(c);
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(DB_DESTINO);
  return {
    query: (sql, params) => lite.query(sql, params),
    transaction: (fn) => lite.transaction(fn),
    exec: (sql) => lite.exec(sql),
    close: () => lite.close(),
  };
}
function conexion() {
  g.__lymonDb ||= abrir().then(async (c) => {
    await c.exec(ESQUEMA);
    await completarIvaCategorias(c);
    return c;
  }).catch((e) => { g.__lymonDb = null; throw e; });
  return g.__lymonDb;
}

// Dentro de tx(), las consultas van por la conexión de la transacción
const enTx = new AsyncLocalStorage();

// Las consultas se escriben con «?» como antes; aquí se numeran ($1, $2…) para Postgres
function numerar(sql) {
  let n = 0;
  return sql.replace(/'[^']*'|\?/g, (m) => (m === '?' ? `$${++n}` : m));
}

async function ejecutar(sql, params = []) {
  const c = enTx.getStore() || (await conexion());
  return c.query(numerar(sql), params);
}
export const q = async (sql, params) => (await ejecutar(sql, params)).rows;
export const one = async (sql, params) => (await ejecutar(sql, params)).rows[0];
export const run = (sql, params) => ejecutar(sql, params);

export async function tx(fn) {
  if (enTx.getStore()) return fn();
  const c = await conexion();
  return c.transaction((t) => enTx.run(t, fn));
}

export async function cerrar() {
  if (!g.__lymonDb) return;
  const c = await g.__lymonDb;
  g.__lymonDb = null;
  await c.close();
}

// IVA por defecto de cada subgrupo. Proveedores extranjeros (Google, Meta, SaaS) facturan sin IVA (inversión del sujeto pasivo).
const IVA_DEFECTO = {
  'Puesta en marcha': 21, MONEI: 21, 'Suscripción': 21, 'Generación QR': 21, 'Datáfono': 21,
  Soporte: 21, Infraestructura: 0, 'Gestión de datos (BBDD)': 0, Hardware: 21, Hosting: 0, IA: 0, Integraciones: 0,
  'Google Ads': 0, 'Meta Ads': 0, 'Comisión distribuidor/consultoría': 21, 'Folletos publicitarios': 21, 'Follectos publicitarios': 21,
  Otomatico: 21, Outscraper: 0, Canva: 0, Calendly: 0, CRM: 0,
  'Alquiler oficinas': 21, Suministros: 21, 'Servicios Asesoría y Gestoría': 21, Abogados: 21, 'Servidores y Servicios Web': 0,
  Viajes: 10, 'Comisiones y servicios bancarios': 0, Seguros: 0, Marca: 21, Mermas: 0, Tributos: 0, Ordenadores: 21,
  Mobiliario: 21, 'Licencias de software': 0, 'Otros gastos': 21,
};
export function ivaPorDefecto(tipo, grupo, subgrupo) {
  if (grupo === 'Personal' && /^Honorarios/.test(subgrupo)) return 21; // facturas de socios autónomos
  if (tipo === 'Otros cobros/pagos' || tipo === 'Traspaso' || grupo === 'Personal' || grupo === 'Impuestos y deuda' || grupo === 'Cobros atípicos') return 0;
  return IVA_DEFECTO[subgrupo] ?? 21;
}
export async function completarIvaCategorias(c) {
  const consulta = c ? (sql, p) => c.query(numerar(sql), p) : ejecutar;
  for (const cat of (await consulta('SELECT id, tipo, grupo, subgrupo FROM categorias WHERE iva IS NULL')).rows) {
    await consulta('UPDATE categorias SET iva = ? WHERE id = ?', [ivaPorDefecto(cat.tipo, cat.grupo, cat.subgrupo), cat.id]);
  }
}

export async function getAjuste(clave, porDefecto = null) {
  const row = await one('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
  return row ? JSON.parse(row.valor) : porDefecto;
}

export async function setAjuste(clave, valor) {
  await run('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor', [clave, JSON.stringify(valor)]);
}
