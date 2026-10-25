import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SelectorCategoria } from '../ui.jsx';
import { fEur2, fFecha, fMesLargo } from '../format.js';

export default function Movimientos({ anio, datos, cats, recargar, avisar, filtro }) {
  const meses = datos.cashflow.meses.filter((m) => Number(m.slice(0, 4)) === anio).reverse();
  const [mes, setMes] = useState(filtro.mes ?? (filtro.pendientes ? '' : meses[0] || ''));
  const [q, setQ] = useState(filtro.q || '');
  const [pendientes, setPendientes] = useState(!!filtro.pendientes);
  const [filas, setFilas] = useState([]);
  const [similares, setSimilares] = useState(true);
  const [nuevo, setNuevo] = useState(null);
  const [nuevaCat, setNuevaCat] = useState(null);

  const cargar = async () => {
    const p = new URLSearchParams();
    if (mes) p.set('mes', mes);
    else p.set('anio', anio);
    if (q) p.set('q', q);
    if (pendientes) p.set('pendientes', '1');
    setFilas(await api.get(`/api/movimientos?${p}`));
  };
  useEffect(() => { cargar().catch((e) => avisar(e.message, true)); }, [mes, q, pendientes]); // eslint-disable-line

  async function categorizar(m, cat) {
    try {
      const r = await api.patch(`/api/movimientos/${m.id}`, { ...cat, aplicarSimilares: similares && !m.tipo });
      if (r.similares) avisar(`Categorizado también en ${r.similares} movimientos parecidos`);
      await Promise.all([cargar(), recargar()]);
    } catch (e) { avisar(e.message, true); }
  }
  async function borrar(m) {
    if (m._confirmar !== true) { setFilas((fs) => fs.map((x) => (x.id === m.id ? { ...x, _confirmar: true } : x))); return; }
    await api.del(`/api/movimientos/${m.id}`);
    await Promise.all([cargar(), recargar()]);
  }
  async function crear() {
    try {
      await api.post('/api/movimientos', nuevo);
      setNuevo(null);
      await Promise.all([cargar(), recargar()]);
      avisar('Movimiento añadido');
    } catch (e) { avisar(e.message, true); }
  }

  const total = filas.reduce((a, m) => a + m.importe, 0);
  const entradas = filas.filter((m) => m.importe > 0).reduce((a, m) => a + m.importe, 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Movimientos bancarios</h1>
          <div className="sub">Equivale a la hoja «Movimientos bancarios». Cambia la categoría desde el desplegable.</div>
        </div>
        <div className="row">
        <button className="btn" onClick={() => setNuevaCat(nuevaCat ? null : { tipo: 'Pagos', grupo: 'Generales', subgrupo: '' })}>+ Categoría</button>
        <button className="btn" onClick={() => setNuevo(nuevo ? null : { fecha: new Date().toISOString().slice(0, 10), descripcion: '', importe: '' })}>+ Movimiento manual</button>
        </div>
      </div>

      {nuevaCat && (
        <div className="card row">
          <span>Nueva categoría en</span>
          <select value={nuevaCat.tipo + '|' + nuevaCat.grupo} onChange={(e) => { const [tipo, grupo] = e.target.value.split('|'); setNuevaCat({ ...nuevaCat, tipo, grupo }); }}>
            {[...new Set(cats.map((c) => c.tipo + '|' + c.grupo))].map((k) => <option key={k} value={k}>{k.replace('|', ' · ')}</option>)}
          </select>
          <input type="text" placeholder="Nombre (p. ej. Anthropic)" value={nuevaCat.subgrupo} onChange={(e) => setNuevaCat({ ...nuevaCat, subgrupo: e.target.value })} />
          <button className="btn pri" disabled={!nuevaCat.subgrupo.trim()} onClick={async () => { await api.post('/api/categorias', nuevaCat); setNuevaCat(null); await recargar(); avisar('Categoría creada'); }}>Crear</button>
        </div>
      )}

      {nuevo && (
        <div className="card row">
          <input type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
          <input type="text" placeholder="Descripción" style={{ flex: 1, minWidth: 180 }} value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          <input type="number" step="0.01" placeholder="Importe (− si es pago)" style={{ width: 170 }} value={nuevo.importe} onChange={(e) => setNuevo({ ...nuevo, importe: e.target.value })} />
          <SelectorCategoria cats={cats} valor={nuevo} onChange={(c) => setNuevo({ ...nuevo, ...c })} />
          <button className="btn pri" disabled={!nuevo.descripcion || nuevo.importe === ''} onClick={crear}>Guardar</button>
        </div>
      )}

      <div className="row">
        <select value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todo {anio}</option>
          {meses.map((m) => <option key={m} value={m}>{fMesLargo(m)}</option>)}
        </select>
        <input type="search" placeholder="Buscar descripción, referencia o categoría…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={pendientes} onChange={(e) => setPendientes(e.target.checked)} /> Solo sin categoría {datos.pendientes > 0 && <span className="badge warn">{datos.pendientes}</span>}</label>
        <label className="row" style={{ gap: 6 }} title="Al categorizar un movimiento sin categoría, aplica la misma a los que tienen una descripción parecida">
          <input type="checkbox" checked={similares} onChange={(e) => setSimilares(e.target.checked)} /> Aplicar a parecidos
        </label>
        <span className="muted" style={{ marginLeft: 'auto' }}>{filas.length} movimientos · entradas {fEur2(entradas)} · salidas {fEur2(entradas - total)} · neto <b>{fEur2(total)}</b></span>
      </div>

      <div className="daylist">
        {porDia(filas).map(([dia, movs]) => (
          <div key={dia} className="day">
            <div className="day-h">
              <span>{new Date(`${dia}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <span>{fEur2(movs.reduce((x, m) => x + m.importe, 0))}</span>
            </div>
            {movs.map((m) => (
              <div key={m.id} className="item">
                <div className="d">
                  {m.descripcion}
                  <small>{[m.referencia, m.origen !== 'revolut' ? `origen: ${m.origen}` : null].filter(Boolean).join(' · ') || ' '}</small>
                </div>
                <SelectorCategoria cats={cats} valor={m} onChange={(c) => categorizar(m, c)} />
                <span className={`amt ${m.importe < 0 ? '' : 'pos'}`}>{m.importe > 0 ? '+' : ''}{fEur2(m.importe)}</span>
                <button className={`btn sm ${m._confirmar ? '' : 'ghost'}`} title="Borrar" onClick={() => borrar(m)}>{m._confirmar ? '¿Borrar?' : '✕'}</button>
              </div>
            ))}
          </div>
        ))}
        {!filas.length && <div className="empty">No hay movimientos con estos filtros.</div>}
      </div>
    </div>
  );
}

function porDia(filas) {
  const m = new Map();
  for (const f of filas) { if (!m.has(f.fecha)) m.set(f.fecha, []); m.get(f.fecha).push(f); }
  return [...m.entries()];
}
