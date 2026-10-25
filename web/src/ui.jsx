import { useEffect, useState } from 'react';
import { fEur, fMesLargo } from './format.js';

// Lee los colores del tema (cambian con modo claro/oscuro) para pasárselos a Recharts
const VARS = ['series-1', 'series-2', 'series-3', 'series-4', 'grid', 'text-2', 'text-3', 'surface', 'border', 'critical', 'good'];
export function useColores() {
  const leer = () => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(`--${v}`).trim()]));
  };
  const [c, setC] = useState(leer);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setC(leer());
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return c;
}

export function Kpi({ label, value, foot, tono }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {foot && <div className={`kpi-foot ${tono || ''}`}>{foot}</div>}
    </div>
  );
}

export function Leyenda({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}><i className={it.dash ? 'dash' : ''} style={it.dash ? { borderColor: it.color } : { background: it.color }} />{it.label}</span>
      ))}
    </div>
  );
}

// Tooltip genérico: series = [{ key, label, fmt? }]
export function Tip({ active, payload, label, series, titulo = fMesLargo }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-t">{titulo(label)}</div>
      {series.filter((s) => row[s.key] !== null && row[s.key] !== undefined).map((s) => (
        <div className="tip-r" key={s.key}>
          <span>{s.color && <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />}{s.label}</span>
          <span>{(s.fmt || fEur)(row[s.key])}</span>
        </div>
      ))}
    </div>
  );
}

// Selector de categoría en un solo desplegable: optgroups "Tipo · Grupo" con sus subgrupos
export function SelectorCategoria({ cats, valor, onChange, vacio = 'Sin categoría' }) {
  const grupos = [];
  for (const c of cats) {
    const g = `${c.tipo} · ${c.grupo}`;
    let item = grupos.find((x) => x.g === g);
    if (!item) grupos.push((item = { g, opts: [] }));
    item.opts.push(c);
  }
  const v = valor?.tipo ? `${valor.tipo}|${valor.grupo}|${valor.subgrupo}` : '';
  return (
    <select className={`cat ${v ? '' : 'vacio'}`} value={v} title={v ? v.split('|').join(' › ') : vacio}
      onChange={(e) => {
        const [tipo, grupo, subgrupo] = e.target.value ? e.target.value.split('|') : [null, null, null];
        onChange({ tipo, grupo, subgrupo });
      }}>
      <option value="">{vacio}</option>
      {grupos.map((g) => (
        <optgroup key={g.g} label={g.g}>
          {g.opts.map((c) => <option key={c.subgrupo} value={`${c.tipo}|${c.grupo}|${c.subgrupo}`}>{c.subgrupo}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export const ejeEur = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k` : String(Math.round(v)));
export { fEur };



// Navegador de mes ◀ Septiembre 2026 ▶
export function MesNav({ meses, valor, onChange, etiqueta }) {
  const i = meses.indexOf(valor);
  const nombre = valor ? new Date(`${valor}-15`).toLocaleDateString('es-ES', { month: 'long' }) : '';
  return (
    <div className="mesnav">
      <button disabled={i <= 0} onClick={() => onChange(meses[i - 1])} title="Mes anterior">◀</button>
      <b style={{ textTransform: 'capitalize' }}>{nombre}</b>
      <button disabled={i < 0 || i >= meses.length - 1} onClick={() => onChange(meses[i + 1])} title="Mes siguiente">▶</button>
      {etiqueta && <span className="badge warn tag">{etiqueta}</span>}
    </div>
  );
}

// Variación con flecha: bueno = sentido en el que subir es positivo (+1) o negativo (-1)
export function Delta({ actual, anterior, texto = 'vs mes anterior', bueno = 1, pct = true }) {
  if (anterior === null || anterior === undefined || actual === null || actual === undefined) return null;
  const d = actual - anterior;
  if (Math.abs(d) < 0.5) return <span>= {texto}</span>;
  const p = anterior ? d / Math.abs(anterior) : null;
  const ok = d * bueno > 0;
  return (
    <span className={ok ? 'up' : 'down'}>
      {d > 0 ? '▲' : '▼'} {pct && p !== null && Number.isFinite(p) ? `${Math.abs(p * 100).toLocaleString('es-ES', { maximumFractionDigits: 0 })} %` : fEur(Math.abs(d))} <span className="muted">{texto}</span>
    </span>
  );
}

export function Stat({ label, value, children, tono }) {
  return (
    <div className="card stat">
      <span className="l">{label}</span>
      <span className={`v ${tono || ''}`}>{value}</span>
      {children && <span className="c">{children}</span>}
    </div>
  );
}

// Recorta un objeto de series mensuales (cashflow, ingresos…) a los meses de un año.
// Corta todos los arrays que tienen un valor por mes; en el desglose, también sus valores.
export function delAnioSeries(obj, anio) {
  const n = obj.meses.length;
  const idx = obj.meses.map((m, i) => (Number(m.slice(0, 4)) === anio ? i : -1)).filter((i) => i >= 0);
  const d = idx.length ? idx[0] : 0, h = idx.length ? idx[idx.length - 1] + 1 : 0;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Array.isArray(v) && v.length === n ? v.slice(d, h) : v;
  if (obj.desglose) out.desglose = obj.desglose.map((x) => { const valores = x.valores.slice(d, h); return { ...x, valores, total: valores.reduce((a, b) => a + b, 0) }; });
  if (obj.clientes) out.clientes = obj.clientes.map((x) => ({ ...x, valores: x.valores.slice(d, h) })).filter((x) => x.valores.some((v) => v));
  return out;
}

