import { useState } from 'react';
import { ResponsiveContainer, BarChart, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from 'recharts';
import { Leyenda, Tip, Kpi, Stat, Delta, MesNav, useColores, ejeEur, delAnioSeries } from '../ui.jsx';
import Importar from './Importar.jsx';
import { fEur, fMes, fMesLargo, fNum, fPct } from '../format.js';

const PRESETS = [['3M', 3], ['6M', 6], ['Todo el año', 0]];

// Recorta todas las series de ingresos al rango de meses [d, h]
function recortar(todo, d, h) {
  const out = {};
  for (const [k, v] of Object.entries(todo)) out[k] = Array.isArray(v) && v.length === todo.meses.length ? v.slice(d, h + 1) : v;
  out.clientes = todo.clientes.map((cl) => ({ ...cl, valores: cl.valores.slice(d, h + 1), actual: cl.valores[h] }))
    .filter((cl) => cl.valores.some((x) => x)).sort((a, b) => b.actual - a.actual || a.cliente.localeCompare(b.cliente));
  return out;
}

export default function Ingresos({ datos, anio, cats, recargar, avisar, ir, filtro }) {
  const [importando, setImportando] = useState(filtro?.importar === 'beel');
  // Siempre arranca sin IVA (como la previsión); con IVA es una vista opcional
  const [conIva, cambiarIva] = useState(false);
  const todo = delAnioSeries(conIva && datos.ingresosIva ? datos.ingresosIva : datos.ingresos, anio);
  const c = useColores();
  const N = todo.meses.length;
  const [rango, setRango] = useState({ d: 0, h: N - 1 });
  const [vista, setVista] = useState('barras');
  const [series, setSeries] = useState({ mrr: true, puntual: true, total: true });
  const [selAbs, setSelAbs] = useState(N - 1);
  const [verClientes, setVerClientes] = useState(false);
  const [verTabla, setVerTabla] = useState(false);
  const [verLocales, setVerLocales] = useState(false);
  if (importando) return <Importar tipo="beel" cats={cats} recargar={recargar} avisar={avisar} ir={ir} onCerrar={() => setImportando(false)} />;
  if (!N) return <div className="empty">No hay facturas en {anio}. <button className="btn pri" onClick={() => setImportando(true)}>Importar facturas de Beel</button></div>;

  const d = Math.min(rango.d, N - 1), h = Math.min(Math.max(rango.h, d), N - 1);
  const ing = recortar(todo, d, h);
  const n = ing.meses.length;
  const sel = Math.min(Math.max(selAbs - d, 0), n - 1);
  const setSel = (i) => setSelAbs(i + d);
  const preset = PRESETS.find(([, k]) => (k === 0 ? d === 0 : d === Math.max(0, N - k)) && h === N - 1)?.[0];

  // Resumen del rango
  const mrrIni = ing.mrr[0], mrrFin = ing.mrr[n - 1];
  const cmgr = n > 1 && mrrIni > 0 ? Math.pow(mrrFin / mrrIni, 1 / (n - 1)) - 1 : null;
  const totalRango = ing.total.reduce((a, b) => a + b, 0);
  const recRango = ing.mrr.reduce((a, b) => a + b, 0);
  const serieEvo = ing.meses.map((m, i) => ({ mes: m, mrr: ing.mrr[i], puntual: ing.puntual[i], total: ing.total[i], cuentas: ing.cuentas[i] }));
  const colTotal = c['text-2'];
  const etiquetaFinal = (negrita) => (p) => (p.index === n - 1
    ? <text x={p.x} y={p.y - 10} textAnchor="end" fontSize={12} fontWeight={negrita ? 600 : 400} fill={c['text-2']}>{fEur(p.value)}</text>
    : null);

  const crec = ing.mrr.map((m, i) => (i && ing.mrr[i - 1] ? m / ing.mrr[i - 1] - 1 : null));
  const filas = [
    ['MRR', ing.mrr, fEur, true],
    ['  MRR nuevo', ing.mrrNuevo, fEur],
    ['  MRR perdido (bajas)', ing.mrrChurn, fEur],
    ['  Crecimiento mensual', crec, fPct],
    ['Clientes recurrentes', ing.cuentas, fNum, true],
    ['  Altas', ing.nuevas, fNum],
    ['  Bajas', ing.bajas, fNum],
    ['  ARPA (MRR medio por cliente)', ing.arpa, fEur],
    ['Locales facturando', ing.locales || [], fNum, true],
    ['  Ticket medio por local', ing.ticketLocal || [], fEur],
    ['Ingresos no recurrentes', ing.puntual, fEur, true],
    ['  Nº clientes', ing.puntualClientes, fNum],
    [conIva ? 'TOTAL INGRESOS (con IVA)' : 'TOTAL INGRESOS (sin IVA)', ing.total, fEur, true],
  ];
  const serie = ing.meses.map((m, i) => ({ mes: m, nuevo: ing.mrrNuevo[i], churn: ing.mrrChurn[i] }));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Ingresos y MRR</h1>
          <div className="sub">Calculado a partir de las facturas, como en «OUTPUT Análisis Ingresos». {conIva
            ? 'Importes con IVA: el total de cada factura, con el IVA que le corresponda (Canarias y Melilla van sin IVA).'
            : 'Importes sin IVA (base imponible), como en tu previsión.'}</div>
        </div>
        <div className="row">
        <button className="btn pri" onClick={() => setImportando(true)}>Importar facturas de Beel</button>
        <div className="seg" title="Con IVA usa el total de cada factura tal como aparece en Beel">
          <button className={conIva ? '' : 'on'} onClick={() => cambiarIva(false)}>Sin IVA</button>
          <button className={conIva ? 'on' : ''} onClick={() => cambiarIva(true)}>Con IVA</button>
        </div>
        </div>
      </div>

      <div className="row">
        <div className="seg">
          {PRESETS.map(([et, k]) => (
            <button key={et} className={preset === et ? 'on' : ''} onClick={() => setRango({ d: k ? Math.max(0, N - k) : 0, h: N - 1 })}>{et}</button>
          ))}
        </div>
        <span className="muted">Desde</span>
        <select value={d} onChange={(e) => setRango({ d: Number(e.target.value), h: Math.max(h, Number(e.target.value)) })}>
          {todo.meses.map((m, i) => <option key={m} value={i}>{fMesLargo(m)}</option>)}
        </select>
        <span className="muted">hasta</span>
        <select value={h} onChange={(e) => setRango({ d: Math.min(d, Number(e.target.value)), h: Number(e.target.value) })}>
          {todo.meses.map((m, i) => <option key={m} value={i}>{fMesLargo(m)}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12.5 }}>El rango se aplica a toda la página.</span>
      </div>

      <div className="grid g-4">
        <Kpi label={`MRR ${fMes(ing.meses[n - 1])}`} value={fEur(mrrFin)}
          foot={n > 1 && `${mrrFin >= mrrIni ? '▲' : '▼'} ${fPct(mrrIni ? mrrFin / mrrIni - 1 : null)} desde ${fMes(ing.meses[0])} (${fEur(mrrIni)})`} tono={mrrFin >= mrrIni ? 'up' : 'down'} />
        <Kpi label="Crecimiento medio mensual del MRR" value={cmgr === null ? '—' : fPct(cmgr)} foot={`Compuesto, ${n - 1} meses`} />
        <Kpi label="Ingresos totales del periodo" value={fEur(totalRango)} foot={`${fEur(totalRango / n)} de media al mes`} />
        <Kpi label="% recurrente" value={totalRango ? fPct(recRango / totalRango).replace('+', '') : '—'} foot={`No recurrente: ${fEur(totalRango - recRango)}`} />
      </div>

      <div className="card">
        <div className="chart-title">
          <h2>Evolución de ingresos</h2>
          <div className="row">
            {[['mrr', 'MRR', c['series-1']], ['puntual', 'No recurrentes', c['series-2']], ['total', 'Total', colTotal]].map(([k, et, col]) => (
              <label key={k} className="row legend" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={series[k]} onChange={(e) => setSeries({ ...series, [k]: e.target.checked })} />
                <span><i className={k === 'total' ? 'dash' : ''} style={k === 'total' ? { borderColor: col } : { background: col }} />{et}</span>
              </label>
            ))}
            <div className="seg">
              <button className={vista === 'barras' ? 'on' : ''} onClick={() => setVista('barras')}>Barras</button>
              <button className={vista === 'lineas' ? 'on' : ''} onClick={() => setVista('lineas')}>Líneas</button>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={serieEvo} margin={{ top: 20, right: 12, left: 0, bottom: 0 }} barCategoryGap="24%"
            onClick={(e) => e?.activeTooltipIndex !== undefined && setSel(Number(e.activeTooltipIndex))}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="mes" tickFormatter={fMes} tick={{ fill: c['text-2'], fontSize: 12 }} axisLine={{ stroke: c.border }} tickLine={false} />
            <YAxis tickFormatter={ejeEur} tick={{ fill: c['text-3'], fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<Tip series={[
              { key: 'total', label: 'Total', color: colTotal }, { key: 'mrr', label: 'MRR', color: c['series-1'] },
              { key: 'puntual', label: 'No recurrentes', color: c['series-2'] }, { key: 'cuentas', label: 'Clientes recurrentes', fmt: fNum }]} />} />
            {vista === 'barras' && series.mrr && (
              <Bar dataKey="mrr" stackId="i" fill={c['series-1']} stroke={c.surface} strokeWidth={1} radius={series.puntual ? 0 : [4, 4, 0, 0]} isAnimationActive={false} />
            )}
            {vista === 'barras' && series.puntual && (
              <Bar dataKey="puntual" stackId="i" fill={c['series-2']} stroke={c.surface} strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            )}
            {vista === 'lineas' && series.mrr && (
              <Line dataKey="mrr" stroke={c['series-1']} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: c['series-1'] }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false}>
                <LabelList dataKey="mrr" content={etiquetaFinal(false)} />
              </Line>
            )}
            {vista === 'lineas' && series.puntual && (
              <Line dataKey="puntual" stroke={c['series-2']} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: c['series-2'] }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
            )}
            {series.total && (
              <Line dataKey="total" stroke={colTotal} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false}>
                <LabelList dataKey="total" content={etiquetaFinal(true)} />
              </Line>
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <div className="kpi-foot">Total = MRR + ingresos no recurrentes (puestas en marcha y otros cobros únicos facturados), {conIva ? 'con IVA' : 'sin IVA'}. Las recargas de monedero marcadas como «No cuenta» no se incluyen. Pulsa un mes para ver sus altas y bajas.</div>
      </div>

      <div className="card">
        <div className="chart-title">
          <h2>Movimiento del MRR</h2>
          <Leyenda items={[{ label: 'Nuevo', color: c['series-1'] }, { label: 'Bajas', color: c['series-2'] }]} />
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={serie} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%"
            onClick={(e) => e?.activeTooltipIndex !== undefined && setSel(Number(e.activeTooltipIndex))}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="mes" tickFormatter={fMes} tick={{ fill: c['text-2'], fontSize: 12 }} axisLine={{ stroke: c.border }} tickLine={false} />
            <YAxis tickFormatter={ejeEur} tick={{ fill: c['text-3'], fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
            <ReferenceLine y={0} stroke={c['text-3']} />
            <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<Tip series={[{ key: 'nuevo', label: 'Nuevo', color: c['series-1'] }, { key: 'churn', label: 'Bajas', color: c['series-2'] }]} />} />
            <Bar dataKey="nuevo" stackId="a" fill={c['series-1']} stroke={c.surface} strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="churn" stackId="a" fill={c['series-2']} stroke={c.surface} strokeWidth={1} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <div className="kpi-foot">Pulsa un mes para ver qué clientes entraron y cuáles se fueron.</div>
      </div>

      <div className="page-head" style={{ marginBottom: 0, marginTop: 8 }}>
        <MesNav meses={ing.meses} valor={ing.meses[sel]} onChange={(m) => setSel(ing.meses.indexOf(m))} />
      </div>
      <div className="grid g-4">
        <Stat label="MRR" value={fEur(ing.mrr[sel])}><Delta actual={ing.mrr[sel]} anterior={sel > 0 ? ing.mrr[sel - 1] : null} /></Stat>
        <Stat label="Clientes recurrentes" value={ing.locales?.[sel] ? <>{fNum(ing.cuentas[sel])} <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>· {fNum(ing.locales[sel])} locales</span></> : fNum(ing.cuentas[sel])}>
          <span className="up">+{ing.nuevas[sel]} altas</span><span className={ing.bajas[sel] ? 'down' : 'muted'}>−{ing.bajas[sel]} bajas</span>
          {ing.ticketLocal?.[sel] ? <span>ticket por local {fEur(ing.ticketLocal[sel])}</span> : <span>ARPA {fEur(ing.arpa[sel])}</span>}
        </Stat>
        <Stat label="Ingresos no recurrentes" value={fEur(ing.puntual[sel])}><span>{ing.puntualClientes[sel]} clientes (puestas en marcha…)</span></Stat>
        <Stat label="Total facturado" value={fEur(ing.total[sel])}><Delta actual={ing.total[sel]} anterior={sel > 0 ? ing.total[sel - 1] : null} /></Stat>
      </div>

      <div className="grid g-2">
        <div className="card">
          <h2>Altas en {fMesLargo(ing.meses[sel])} <span className="badge">{ing.detalleAltas[sel].length}</span></h2>
          {ing.detalleAltas[sel].length ? ing.detalleAltas[sel].map((a) => (
            <div key={a.cliente} className="tip-r" style={{ padding: '3px 0' }}><span>{a.cliente}</span><span>{fEur(a.mrr)}</span></div>
          )) : <div className="muted">Ninguna</div>}
        </div>
        <div className="card">
          <h2>Bajas en {fMesLargo(ing.meses[sel])} <span className="badge">{ing.detalleBajas[sel].length}</span></h2>
          {ing.detalleBajas[sel].length ? ing.detalleBajas[sel].map((a) => (
            <div key={a.cliente} className="tip-r" style={{ padding: '3px 0' }}><span>{a.cliente}</span><span className="neg">−{fEur(a.mrr)}</span></div>
          )) : <div className="muted">Ninguna</div>}
          {ing.detalleBajas[sel].length > 0 && <div className="kpi-foot">Un cliente sale como baja si el mes anterior tenía factura recurrente y este no. Si es un error (p. ej. la factura se emitió con otro nombre), corrígelo en Facturas.</div>}
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={() => setVerTabla(!verTabla)}>{verTabla ? 'Ocultar' : 'Ver'} tabla de métricas de todos los meses</button>
        <button className="btn" onClick={() => setVerClientes(!verClientes)}>{verClientes ? 'Ocultar' : 'Ver'} MRR por cliente ({ing.clientes.length})</button>
        {ing.detalleLocales?.[sel]?.length > 0 && (
          <button className="btn" onClick={() => setVerLocales(!verLocales)}>
            {verLocales ? 'Ocultar' : 'Ver'} locales de {fMesLargo(ing.meses[sel]).toLowerCase()} ({ing.detalleLocales[sel].length})
          </button>
        )}
      </div>
      {verLocales && ing.detalleLocales?.[sel]?.length > 0 && <ListaLocales lista={ing.detalleLocales[sel]} conIva={conIva} />}
      {verTabla && <div className="tbl-wrap">
        <table className="pivot">
          <thead>
            <tr><th>Métrica</th>{ing.meses.map((m, i) => <th key={m} className="n" style={{ cursor: 'pointer', textDecoration: i === sel ? 'underline' : 'none' }} onClick={() => setSel(i)}>{fMes(m)}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map(([nombre, vals, fmt, fuerte]) => (
              <tr key={nombre} className={fuerte ? 'grp' : 'sub'}>
                <td>{nombre.trim()}</td>
                {vals.map((v, i) => <td key={i} className={`n ${v < 0 ? 'neg' : ''}`}>{v === null || v === 0 ? <span className="muted">{v === 0 ? '–' : '—'}</span> : fmt(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {verClientes && (
        <div className="tbl-wrap" style={{ maxHeight: 600 }}>
          <table className="pivot">
            <thead><tr><th>Cliente</th>{ing.meses.map((m) => <th key={m} className="n">{fMes(m)}</th>)}</tr></thead>
            <tbody>
              {ing.clientes.map((cl) => (
                <tr key={cl.cliente}>
                  <td title={cl.cliente} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cl.cliente}</td>
                  {cl.valores.map((v, i) => <td key={i} className="n">{v ? fEur(v) : <span className="muted">–</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Locales de un mes con su cliente y su cuota, para comprobar el recuento
function ListaLocales({ lista, conIva }) {
  const porCliente = lista.reduce((m, l) => m.set(l.cliente, (m.get(l.cliente) || 0) + 1), new Map());
  return (
    <div className="tbl-wrap" style={{ maxHeight: 600 }}>
      <table>
        <thead><tr><th>Cliente</th><th>Local</th><th className="n">Cuota {conIva ? 'con IVA' : 'sin IVA'}</th></tr></thead>
        <tbody>
          {lista.map((l, k) => (
            <tr key={l.cliente + l.local}>
              <td>
                {k === 0 || lista[k - 1].cliente !== l.cliente ? (
                  <>{l.cliente}{porCliente.get(l.cliente) > 1 && <span className="badge" style={{ marginLeft: 8 }}>{porCliente.get(l.cliente)} locales</span>}</>
                ) : ''}
              </td>
              <td>{l.local}</td>
              <td className="n">{fEur(l.mrr)}</td>
            </tr>
          ))}
          <tr className="tot">
            <td>{porCliente.size} clientes</td>
            <td>{lista.length} locales</td>
            <td className="n">{fEur(lista.reduce((a, l) => a + l.mrr, 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
