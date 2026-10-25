import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fEur2, fFecha, fMesLargo } from '../format.js';

export const CLASES = { recurrente: 'Recurrente', puntual: 'No recurrente', excluida: 'No cuenta' };

export default function Facturas({ anio, datos, recargar, avisar, filtro }) {
  const meses = datos.ingresos.meses.filter((m) => Number(m.slice(0, 4)) === anio).reverse();
  const [mes, setMes] = useState(filtro.mes ?? meses[0] ?? '');
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState([]);
  const [editCliente, setEditCliente] = useState(null);

  const cargar = async () => {
    const p = new URLSearchParams();
    if (mes) p.set('mes', mes);
    else p.set('anio', anio);
    if (q) p.set('q', q);
    setFilas(await api.get(`/api/facturas?${p}`));
  };
  useEffect(() => { cargar().catch((e) => avisar(e.message, true)); }, [mes, q]); // eslint-disable-line

  async function cambiar(f, cambios) {
    try {
      await api.patch(`/api/facturas/${f.id}`, cambios);
      await Promise.all([cargar(), recargar()]);
    } catch (e) { avisar(e.message, true); }
  }

  const tot = (clase) => filas.filter((f) => f.clase === clase).reduce((a, f) => a + f.base, 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Facturas</h1>
          <div className="sub">Equivale a «INPUT Análisis Ingresos». «Recurrente» suma al MRR (repartido entre los meses que cubre); «No recurrente» son puestas en marcha y otros cobros únicos; «No cuenta» no entra en ingresos (p. ej. recargas de monedero).</div>
        </div>
      </div>

      <div className="row">
        <select value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todo {anio}</option>
          {meses.map((m) => <option key={m} value={m}>{fMesLargo(m)}</option>)}
        </select>
        <input type="search" placeholder="Buscar cliente, número o concepto…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {filas.length} líneas · recurrente <b>{fEur2(tot('recurrente'))}</b> · no recurrente <b>{fEur2(tot('puntual'))}</b>{tot('excluida') ? <> · no cuenta {fEur2(tot('excluida'))}</> : null}
        </span>
      </div>

      <div className="daylist">
        {porDia(filas).map(([dia, fs]) => (
          <div key={dia} className="day">
            <div className="day-h">
              <span>{new Date(`${dia}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <span>{fEur2(fs.filter((f) => f.clase !== 'excluida').reduce((x, f) => x + f.base, 0))} sin IVA</span>
            </div>
            {fs.map((f) => (
              <div key={f.id} className="item" style={{ gridTemplateColumns: '1fr auto auto auto auto' }}>
                <div className="d">
                  {editCliente?.id === f.id ? (
                    <input type="text" autoFocus value={editCliente.valor} style={{ width: '100%' }}
                      onChange={(e) => setEditCliente({ ...editCliente, valor: e.target.value })}
                      onBlur={() => { if (editCliente.valor.trim() && editCliente.valor !== f.cliente) cambiar(f, { cliente: editCliente.valor }); setEditCliente(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditCliente(null); }} />
                  ) : (
                    <span title="Doble clic para corregir el nombre (sirve para unificar clientes)" onDoubleClick={() => setEditCliente({ id: f.id, valor: f.cliente })}>{f.cliente}</span>
                  )}
                  <small>{f.numero}{f.linea > 1 ? ` · línea ${f.linea}` : ''}{f.concepto ? ` · ${f.concepto}` : ''}</small>
                </div>
                <select value={f.clase} onChange={(e) => cambiar(f, { clase: e.target.value })}
                  className={`cat ${f.clase === 'recurrente' ? '' : f.clase === 'excluida' ? 'vacio' : ''}`}>
                  {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {f.clase === 'recurrente'
                  ? <select className="cat" value={f.meses} onChange={(e) => cambiar(f, { meses: Number(e.target.value) })} title="Meses que cubre la factura">
                      {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'mensual' : `${n} meses`}</option>)}
                    </select>
                  : <span />}
                <span className={`amt ${f.base < 0 ? 'neg' : ''}`} style={f.clase === 'excluida' ? { opacity: 0.5, textDecoration: 'line-through' } : null}>{fEur2(f.base)}</span>
                <span className="muted" style={{ fontSize: 12, minWidth: 60, textAlign: 'right' }}>{f.origen}</span>
              </div>
            ))}
          </div>
        ))}
        {!filas.length && <div className="empty">No hay facturas con estos filtros.</div>}
      </div>
    </div>
  );
}

function porDia(filas) {
  const m = new Map();
  for (const f of filas) { if (!m.has(f.fecha)) m.set(f.fecha, []); m.get(f.fecha).push(f); }
  return [...m.entries()];
}
