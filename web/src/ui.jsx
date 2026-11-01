import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// ---------- Selector de categoría: botón + buscador flotante ----------
const COLOR_GRUPO = { 'Producción': 'var(--series-1)', 'Marketing y ventas': 'var(--series-2)', Personal: 'var(--series-3)', Generales: 'var(--series-4)', Ventas: 'var(--pos)' };
export const colorGrupo = (grupo) => COLOR_GRUPO[grupo] || 'var(--text-3)';
const claveCat = (c) => `${c.tipo}|${c.grupo}|${c.subgrupo}`;
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Últimas categorías elegidas en este navegador (solo para ponerlas arriba; si no hay almacenamiento, no pasa nada)
const RECIENTES = 'lymon:categorias-recientes';
const leerRecientes = () => { try { return JSON.parse(localStorage.getItem(RECIENTES)) || []; } catch { return []; } };
const guardarReciente = (k) => { try { localStorage.setItem(RECIENTES, JSON.stringify([k, ...leerRecientes().filter((x) => x !== k)].slice(0, 4))); } catch { /* sin almacenamiento */ } };

const Chevron = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Lupa = () => <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
const Check = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// importe (opcional): con signo, para enseñar primero las categorías que encajan (un pago no va a Cobros ni al revés)
export function SelectorCategoria({ cats, valor, onChange, vacio = 'Sin categoría', importe }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef(null);
  const actual = valor?.tipo ? { tipo: valor.tipo, grupo: valor.grupo, subgrupo: valor.subgrupo } : null;
  const cerrar = (devolverFoco) => { setAbierto(false); if (devolverFoco) boton.current?.focus(); };
  return (
    <>
      <button type="button" ref={boton} className={`catsel ${actual ? '' : 'vacio'} ${abierto ? 'abierto' : ''}`}
        title={actual ? `${actual.grupo} › ${actual.subgrupo}` : vacio} aria-haspopup="listbox" aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !abierto) { e.preventDefault(); setAbierto(true); } }}>
        <i className="dot" style={{ background: actual ? colorGrupo(actual.grupo) : 'var(--warning)' }} />
        <span className="catsel-t">{actual ? actual.subgrupo : vacio}</span>
        {actual && `${actual.subgrupo}${actual.grupo}`.length <= 24 && <span className="catsel-g">{actual.grupo}</span>}
        <Chevron />
      </button>
      {abierto && (
        <PanelCategorias cats={cats} actual={actual} importe={importe} ancla={boton.current} onCerrar={cerrar}
          onElegir={(c) => {
            if (c) guardarReciente(claveCat(c));
            onChange(c ? { tipo: c.tipo, grupo: c.grupo, subgrupo: c.subgrupo } : { tipo: null, grupo: null, subgrupo: null });
            cerrar(true);
          }} />
      )}
    </>
  );
}

function PanelCategorias({ cats, actual, importe, ancla, onCerrar, onElegir }) {
  const [texto, setTexto] = useState('');
  const [todas, setTodas] = useState(false);
  const [pos, setPos] = useState(null);
  const caja = useRef(null), lista = useRef(null), buscador = useRef(null);

  // Opciones: primero las recientes (sin buscar), luego por grupo. Al buscar se mira nombre, grupo y tipo, sin tildes
  const encaja = (c) => importe == null || todas || !Number(importe) || (importe < 0 ? c.tipo !== 'Cobros' : c.tipo !== 'Pagos');
  const t = normal(texto.trim());
  const coincide = (c) => normal(`${c.subgrupo} ${c.grupo} ${c.tipo}`).includes(t);
  let base = cats.filter(encaja);
  let filtradas = t ? base.filter(coincide) : base;
  if (t && !filtradas.length) filtradas = cats.filter(coincide); // si no hay nada entre las que encajan, busca en todas
  const recientes = t ? [] : leerRecientes().map((k) => filtradas.find((c) => claveCat(c) === k)).filter(Boolean).slice(0, 3);
  const secciones = [];
  if (recientes.length) secciones.push({ titulo: 'Recientes', items: recientes, reciente: true });
  for (const c of filtradas) {
    const k = `${c.tipo}|${c.grupo}`;
    let s = secciones.find((x) => x.k === k);
    if (!s) secciones.push((s = { k, titulo: c.grupo, tipo: c.tipo, items: [] }));
    s.items.push(c);
  }
  const planas = secciones.flatMap((s) => s.items);
  const opciones = actual ? [...planas, null] : planas; // null = quitar la categoría
  // Al abrir, la lista se coloca en la categoría que ya tiene (en su grupo, no en Recientes); al buscar, en la primera
  const indiceActual = actual ? planas.findLastIndex((c) => claveCat(c) === claveCat(actual)) : -1;
  const [activo, setActivo] = useState(Math.max(0, indiceActual));
  const recienAbierto = useRef(true), busqueda = useRef(`${texto}|${todas}`);
  useEffect(() => { const b = `${texto}|${todas}`; if (b !== busqueda.current) { busqueda.current = b; setActivo(0); } }, [texto, todas]);

  // Posición: debajo del botón (o encima si no cabe); en móvil, hoja pegada abajo
  useLayoutEffect(() => {
    const colocar = () => {
      const r = ancla.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      if (W < 600) return setPos({ left: 8, right: 8, bottom: 8, maxHeight: Math.round(H * 0.7) });
      const ancho = Math.min(340, W - 16), left = Math.max(8, Math.min(r.left, W - ancho - 8));
      const abajo = H - r.bottom - 12, arriba = r.top - 12;
      setPos(abajo >= 320 || abajo >= arriba
        ? { left, width: ancho, top: r.bottom + 6, maxHeight: Math.min(420, abajo) }
        : { left, width: ancho, bottom: H - r.top + 6, maxHeight: Math.min(420, arriba) });
    };
    colocar();
    const fuera = (e) => { if (!caja.current?.contains(e.target) && !ancla.contains(e.target)) onCerrar(false); };
    const scroll = (e) => { if (!caja.current?.contains(e.target)) onCerrar(false); };
    document.addEventListener('mousedown', fuera);
    addEventListener('scroll', scroll, true);
    addEventListener('resize', colocar);
    return () => { document.removeEventListener('mousedown', fuera); removeEventListener('scroll', scroll, true); removeEventListener('resize', colocar); };
  }, []); // eslint-disable-line

  // Sin mover la página: cualquier scroll fuera del panel lo cierra
  useEffect(() => { if (pos) buscador.current?.focus({ preventScroll: true }); }, [!pos]); // eslint-disable-line
  useEffect(() => {
    const l = lista.current, op = l?.querySelector('.catpop-op.on');
    if (!op) return;
    if (recienAbierto.current) { recienAbierto.current = false; l.scrollTop = op.offsetTop - l.clientHeight / 2 + op.offsetHeight / 2; return; } // centrada al abrir
    if (op.offsetTop < l.scrollTop) l.scrollTop = op.offsetTop - 28;
    else if (op.offsetTop + op.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = op.offsetTop + op.offsetHeight - l.clientHeight + 6;
  }, [activo, !pos]); // eslint-disable-line

  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(opciones.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opciones.length) onElegir(opciones[activo]); }
    else if (e.key === 'Escape') { e.preventDefault(); onCerrar(true); }
    else if (e.key === 'Tab') onCerrar(false);
  };

  let i = -1;
  const opcion = (c, reciente) => {
    i++;
    const n = i, elegida = actual && c && claveCat(c) === claveCat(actual);
    return (
      <button type="button" key={(reciente ? 'r:' : '') + claveCat(c)} role="option" aria-selected={elegida}
        className={`catpop-op ${n === activo ? 'on' : ''} ${reciente ? 'reciente' : ''}`}
        onMouseEnter={() => setActivo(n)} onClick={() => onElegir(c)}>
        {reciente && <i className="dot" style={{ background: colorGrupo(c.grupo) }} />}
        <span className="t">{c.subgrupo}</span>
        {reciente && <span className="g">{c.grupo}</span>}
        {elegida && <span className="check"><Check /></span>}
      </button>
    );
  };

  if (!pos) return null;
  return createPortal(
    <div className="catpop" ref={caja} style={pos} role="dialog" aria-label="Elegir categoría">
      <div className="catpop-buscar">
        <Lupa />
        <input ref={buscador} type="text" value={texto} placeholder="Buscar categoría…" onChange={(e) => setTexto(e.target.value)} onKeyDown={teclas}
          role="combobox" aria-expanded="true" aria-autocomplete="list" />
      </div>
      <div className="catpop-lista" ref={lista} role="listbox">
        {secciones.map((s) => (
          <div key={s.k || s.titulo}>
            <div className="catpop-sec">
              {!s.reciente && <i className="dot" style={{ background: colorGrupo(s.titulo) }} />}
              {s.titulo}
              {s.tipo && !['Pagos', 'Cobros'].includes(s.tipo) && <small>{s.tipo}</small>}
            </div>
            {s.items.map((c) => opcion(c, s.reciente))}
          </div>
        ))}
        {!planas.length && <div className="catpop-vacio">Ninguna categoría con «{texto}»</div>}
        {actual && (() => { i++; const n = i; return (
          <button type="button" className={`catpop-op quitar ${n === activo ? 'on' : ''}`} onMouseEnter={() => setActivo(n)} onClick={() => onElegir(null)}>Quitar categoría</button>
        ); })()}
      </div>
      <div className="catpop-pie">
        <span><kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> para elegir</span>
        {importe != null && Number(importe) !== 0 && (
          <button type="button" onClick={() => setTodas(!todas)}>{todas ? (importe < 0 ? 'Solo de pagos' : 'Solo de cobros') : 'Ver todas'}</button>
        )}
      </div>
    </div>,
    document.body,
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

