import { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from 'recharts';
import { api } from '../api.js';
import { fEur, fFecha, fMes, fMesLargo, fNum } from '../format.js';
import { Stat, useColores, ejeEur } from '../ui.jsx';
import { simular } from '../../../shared/simulacion.js';

const nombreMes = (m) => (m ? `${fMesLargo(m)} ${m.slice(0, 4)}` : '');

export default function Prevision({ datos, recargar, avisar }) {
  const pv = datos.prevision;
  const c = useColores();
  const [s, setS] = useState(pv?.supuestos);
  const [verDetalle, setVerDetalle] = useState(false);
  const [verPartidas, setVerPartidas] = useState(false);
  const temporizador = useRef(null);
  useEffect(() => setS(pv?.supuestos), [pv?.supuestos]);
  const sim = useMemo(() => (s && pv ? simular(s, pv.base) : null), [s, pv]);
  if (!pv || !s || !sim) return <div className="empty">No hay datos suficientes para simular.</div>;

  // Cambia al momento y se guarda medio segundo después del último cambio
  function cambiar(cambios) {
    const nuevo = { ...s, ...cambios };
    if (nuevo.partidas?.length) nuevo.gastoMensual = Math.round(nuevo.partidas.reduce((a, p) => a + (Number(p.importe) || 0), 0) * 100) / 100;
    setS(nuevo);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      try { await api.put('/api/prevision/config', { supuestos: nuevo }); recargar(); } catch (e) { avisar(e.message, true); }
    }, 500);
  }

  const r = sim.resumen;
  const historico = pv.historico.slice(-6);
  const ultimoReal = historico[historico.length - 1];
  const datosGrafica = [
    ...historico.map((h, i) => ({
      mes: h.mes, ingresos: h.ingresos, gastos: h.gastos, cajaReal: h.caja,
      cajaPrev: i === historico.length - 1 ? h.caja : null, real: true,
    })),
    ...sim.filas.map((f) => ({ mes: f.mes, ingresos: f.ingresos, gastos: f.gastos, cajaPrev: f.caja, hacienda: f.hacienda, real: false, ajustes: f.ajustes })),
  ];
  const mesesFuturos = sim.filas.map((f) => f.mes);
  const cColor = c['series-3'];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Previsión</h1>
          <div className="sub">Simulador de caja desde el último mes real ({nombreMes(pv.ultimoMesReal)}). Mueve los controles y mira cómo cambia. Importes con IVA, como en el banco.</div>
        </div>
        <div className="seg">
          {[6, 12, 18, 24].map((h) => <button key={h} className={Number(s.horizonte) === h ? 'on' : ''} onClick={() => cambiar({ horizonte: h })}>{h} meses</button>)}
        </div>
      </div>

      <div className="card">
        <div className="grid g-2" style={{ gap: '14px 40px' }}>
          <Control label="Locales vendidos al mes" valor={s.nuevosMes} min={0} max={30} paso={1} onChange={(v) => cambiar({ nuevosMes: v })} formato={fNum}
            ayuda={`pagan la puesta en marcha al venderse y la cuota cuando ya están en marcha · ritmo real: ${fNum(pv.base.ritmoActual)} al mes`} />
          <Control label="Semanas desde la venta hasta la puesta en marcha" valor={s.semanas ?? 4} min={0} max={16} paso={1} onChange={(v) => cambiar({ semanas: v })} formato={fNum}
            ayuda={`la cuota empieza ${s.semanas ?? 4} ${(s.semanas ?? 4) === 1 ? 'semana' : 'semanas'} después de la venta (≈ ${fNum((s.semanas ?? 4) / 4.345)} meses); mientras, empiezan a pagar los ya vendidos (${fNum(pv.base.ritmoActual)} al mes)`} />
          <Control label="Bajas al mes" valor={s.bajasMes ?? 0} min={0} max={15} paso={1} onChange={(v) => cambiar({ bajasMes: v })} formato={fNum}
            ayuda="locales que dejan de pagar cada mes" />
          <Control label="Ticket medio por local (+ IVA)" valor={s.ticketMedio} min={20} max={250} paso={0.5} onChange={(v) => cambiar({ ticketMedio: v })} formato={(v) => fEur(v)}
            ayuda={`cuota mensual media por local${datos.ingresos.ticketLocal?.slice(-1)[0] ? ` · real: ${fEur(datos.ingresos.ticketLocal.slice(-1)[0])}` : ''}`} />
          {s.partidas?.length ? (
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Gasto mensual (con IVA)</span>
                <b style={{ fontSize: 18 }}>{fEur(s.gastoMensual)}</b>
              </div>
              <div className="kpi-foot" style={{ marginTop: 4 }}>suma de {s.partidas.length} conceptos · <button className="btn sm ghost" style={{ padding: 0, textDecoration: 'underline' }} onClick={() => setVerPartidas(true)}>editar desglose</button></div>
            </div>
          ) : (
            <div>
              <Control label="Gasto mensual (con IVA)" valor={s.gastoMensual} min={2000} max={25000} paso={50} onChange={(v) => cambiar({ gastoMensual: v })} formato={(v) => fEur(v)}
                ayuda={`los últimos 3 meses reales: ${fEur(pv.historico.slice(-3).reduce((a, h) => a + h.gastos, 0) / Math.max(1, pv.historico.slice(-3).length))} de media`} />
              <button className="btn sm" style={{ marginTop: 4 }} onClick={() => setVerPartidas(true)}>Montarlo por conceptos de pago</button>
            </div>
          )}
          <Control label="Puesta en marcha (+ IVA)" valor={s.precioPuestaMarcha} min={0} max={800} paso={10} onChange={(v) => cambiar({ precioPuestaMarcha: v })} formato={(v) => fEur(v)}
            ayuda="por local nuevo" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="row" style={{ gap: 8 }}>
              Locales hoy
              <input type="number" value={s.restaurantes} min={0} style={{ width: 90 }} onChange={(e) => cambiar({ restaurantes: Number(e.target.value) || 0 })} />
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!s.incluirHacienda} onChange={(e) => cambiar({ incluirHacienda: e.target.checked ? 1 : 0 })} />
              Restar pagos a Hacienda
            </label>
          </div>
        </div>
      </div>

      {verPartidas && (
        <Partidas partidas={s.partidas || []} tipos={pv.gastosTipo || []} onChange={(partidas) => cambiar({ partidas })} onCerrar={() => setVerPartidas(false)} />
      )}

      <div className="kpi-foot" style={{ fontSize: 13.5, marginTop: 0 }}>
        Con <b>{fNum(s.nuevosMes)} locales vendidos</b> al mes (en marcha {fNum(s.semanas ?? 4)} semanas después) y <b>{fNum(s.bajasMes ?? 0)} bajas</b> al mes, <b>{fEur(s.ticketMedio)}</b> de ticket por local y <b>{fEur(s.gastoMensual)}</b> de gasto al mes:
      </div>
      <div className="grid g-4">
        <Stat label={`Dinero en el banco en ${nombreMes(r.mesFinal).toLowerCase()}`} value={fEur(r.cajaFinal)} tono={r.cajaFinal < 0 ? 'neg' : ''}>
          <span>hoy (fin de {fMesLargo(pv.ultimoMesReal).toLowerCase()}): {fEur(ultimoReal?.caja)}</span>
        </Stat>
        <Stat label="El momento más justo" value={r.minimo ? fEur(r.minimo.caja) : fEur(ultimoReal?.caja)} tono={r.minimo && r.minimo.caja < 0 ? 'neg' : ''}>
          <span>{r.minimo ? `en ${nombreMes(r.minimo.mes).toLowerCase()}: lo mínimo que llegaría a haber en el banco` : 'la caja no baja nunca de la de hoy'}</span>
        </Stat>
        <Stat label="¿Desde cuándo ganáis dinero?" value={r.rentableDesde ? `Desde ${fMesLargo(r.rentableDesde).toLowerCase()}` : 'Aún no'} tono={r.rentableDesde ? 'pos' : 'neg'}>
          <span>{r.rentableDesde ? 'a partir de ahí, cada mes entra más de lo que sale' : 'cada mes sale más dinero del que entra'}</span>
        </Stat>
        <Stat label={sim.filas.reduce((a, f) => a + f.resultado, 0) / sim.filas.length >= 0 ? 'Ganáis de media al mes' : 'Perdéis de media al mes'} value={fEur(sim.filas.reduce((a, f) => a + f.resultado, 0) / sim.filas.length)}
          tono={sim.filas.reduce((a, f) => a + f.resultado, 0) / sim.filas.length >= 0 ? 'pos' : 'neg'}>
          <span>cobros − gastos, sin contar Hacienda</span>
        </Stat>
      </div>

      {r.primerMesNegativo && (
        <div className="alert bad"><div><b>Con estos supuestos te quedas sin caja en {nombreMes(r.primerMesNegativo).toLowerCase()}</b>Prueba a subir los locales nuevos o el ticket, o a bajar el gasto, para ver qué hace falta para evitarlo.</div></div>
      )}

      <div className="card">
        <div className="chart-title">
          <h2>Mes a mes</h2>
          <span className="legend">
            <span><i style={{ background: c['series-1'] }} />Ingresos</span>
            <span><i style={{ background: c['series-2'] }} />Gastos</span>
            <span><i style={{ background: cColor, height: 3, borderRadius: 0 }} />Caja</span>
            <span className="muted">· más claro / discontinuo = previsto</span>
          </span>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={datosGrafica} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="mes" tickFormatter={(m) => `${fMes(m)}${m.endsWith('-01') ? ` ${m.slice(2, 4)}` : ''}`} tick={{ fill: c['text-2'], fontSize: 12 }} axisLine={{ stroke: c.border }} tickLine={false} />
            <YAxis tickFormatter={ejeEur} tick={{ fill: c['text-3'], fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
            <ReferenceLine y={0} stroke={c['text-3']} />
            {ultimoReal && <ReferenceLine x={ultimoReal.mes} stroke={c.border} strokeDasharray="3 3" label={{ value: 'hoy', position: 'insideTopRight', fill: c['text-3'], fontSize: 11 }} />}
            <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<TipSim c={c} />} />
            <Bar dataKey="ingresos" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {datosGrafica.map((d) => <Cell key={d.mes} fill={c['series-1']} fillOpacity={d.real ? 1 : 0.4} />)}
            </Bar>
            <Bar dataKey="gastos" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {datosGrafica.map((d) => <Cell key={d.mes} fill={c['series-2']} fillOpacity={d.real ? 1 : 0.4} />)}
            </Bar>
            <Line dataKey="cajaReal" stroke={cColor} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: cColor }} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="cajaPrev" stroke={cColor} strokeWidth={2.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Ajustes ajustes={s.ajustes || []} meses={mesesFuturos} onChange={(ajustes) => cambiar({ ajustes })} />

      <div className="row">
        <button className="btn" onClick={() => setVerDetalle(!verDetalle)}>{verDetalle ? 'Ocultar' : 'Ver'} el detalle mes a mes</button>
      </div>
      {verDetalle && (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Mes</th><th className="n">Locales pagando</th><th className="n">Ingresos</th><th className="n">Gastos</th><th className="n">Resultado</th><th className="n">Hacienda</th><th className="n">Caja</th><th>Ajustes</th></tr></thead>
            <tbody>
              {sim.filas.map((f) => (
                <tr key={f.mes}>
                  <td>{nombreMes(f.mes)}</td>
                  <td className="n">{fNum(Math.round(f.restaurantesInicio))} <span className="muted">({f.vendidos} vendidos · +{fNum(f.nuevos)} empiezan a pagar{f.bajas ? ` · −${f.bajas} bajas` : ''})</span></td>
                  <td className="n">{fEur(f.ingresos)}</td>
                  <td className="n">{fEur(f.gastos)}</td>
                  <td className={`n ${f.resultado < 0 ? 'neg' : 'pos'}`}>{fEur(f.resultado)}</td>
                  <td className="n">{f.hacienda ? <span className="neg">{fEur(-f.hacienda)}</span> : <span className="muted">–</span>}</td>
                  <td className={`n ${f.caja < 0 ? 'neg' : ''}`} style={{ fontWeight: 650 }}>{fEur(f.caja)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{f.ajustes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="kpi-foot">
        Ingresos = locales pagando × ticket + locales vendidos × puesta en marcha, más el IVA medio real de tus ventas ({fNum(pv.base.tipos.ivaVentas)} %). Gastos = gasto mensual ± ajustes.
        Hacienda: IVA y retenciones de cada trimestre, pagados en enero, abril, julio y octubre{Object.keys(pv.base.pagosPendientes || {}).length ? ` (incluye el pago pendiente de ${Object.entries(pv.base.pagosPendientes).map(([m, v]) => `${fEur(v)} en ${fMesLargo(m).toLowerCase()}`).join(', ')})` : ''}.
      </div>
    </div>
  );
}

function Control({ label, valor, min, max, paso, onChange, formato, ayuda }) {
  const v = Number(valor) || 0;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <input type="number" value={valor} step={paso} min={min} onChange={(e) => onChange(Number(e.target.value) || 0)}
          style={{ width: 100, textAlign: 'right', fontWeight: 650 }} title={formato(v)} />
      </div>
      <input type="range" min={min} max={Math.max(max, v)} step={paso} value={v} onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <div className="kpi-foot" style={{ marginTop: 0 }}>{ayuda}</div>
    </div>
  );
}

function TipSim({ active, payload, label, c }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const caja = d.real ? d.cajaReal : d.cajaPrev;
  return (
    <div className="tip">
      <div className="tip-t">{nombreMes(label)} · {d.real ? 'real' : 'previsto'}</div>
      <div className="tip-r"><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c['series-1'], marginRight: 6 }} />Ingresos</span><span>{fEur(d.ingresos)}</span></div>
      <div className="tip-r"><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c['series-2'], marginRight: 6 }} />Gastos</span><span>{fEur(d.gastos)}</span></div>
      <div className="tip-r"><span>Resultado</span><span>{fEur(d.ingresos - d.gastos)}</span></div>
      {d.hacienda > 0 && <div className="tip-r"><span>Pago a Hacienda</span><span>−{fEur(d.hacienda)}</span></div>}
      <div className="tip-r" style={{ fontWeight: 650 }}><span>Caja a fin de mes</span><span>{fEur(caja)}</span></div>
      {d.ajustes?.length > 0 && <div className="muted" style={{ marginTop: 4 }}>{d.ajustes.join(', ')}</div>}
    </div>
  );
}

const EFECTOS = [['mas', 'Más gasto'], ['menos', 'Menos gasto'], ['ingreso', 'Más ingreso']];

function Ajustes({ ajustes, meses, onChange }) {
  const efectoDe = (a) => (a.efecto === 'ingreso' ? 'ingreso' : Number(a.importe) < 0 ? 'menos' : 'mas');
  const actualizar = (id, cambios) => onChange(ajustes.map((a) => (a.id === id ? { ...a, ...cambios } : a)));
  const cambiarEfecto = (a, ef) => {
    const imp = Math.abs(Number(a.importe) || 0);
    actualizar(a.id, ef === 'ingreso' ? { efecto: 'ingreso', importe: imp } : { efecto: 'gasto', importe: ef === 'menos' ? -imp : imp });
  };
  const cambiarImporte = (a, v) => {
    const imp = Math.abs(Number(v) || 0);
    actualizar(a.id, { importe: efectoDe(a) === 'menos' ? -imp : imp });
  };
  const nuevo = () => onChange([...ajustes, { id: Date.now().toString(36), concepto: '', efecto: 'gasto', importe: 1000, tipo: 'puntual', desde: meses[1] || meses[0] }]);

  return (
    <div className="card">
      <div className="chart-title">
        <h2 style={{ margin: 0 }}>Ajustes puntuales</h2>
        <button className="btn" onClick={nuevo}>+ Añadir ajuste</button>
      </div>
      {!ajustes.length && <div className="muted">Por ejemplo: «Campaña de marketing, +2.000 € en noviembre» o «Patricia termina el desarrollo, −1.200 € cada mes desde enero».</div>}
      {ajustes.map((a) => (
        <div key={a.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', opacity: a.desactivado ? 0.5 : 1 }}>
          <input type="checkbox" checked={!a.desactivado} onChange={(e) => actualizar(a.id, { desactivado: !e.target.checked })} title="Activar / desactivar" />
          <input type="text" placeholder="Concepto (p. ej. campaña, nueva contratación…)" value={a.concepto} style={{ flex: 1, minWidth: 180 }}
            onChange={(e) => actualizar(a.id, { concepto: e.target.value })} />
          <select value={efectoDe(a)} onChange={(e) => cambiarEfecto(a, e.target.value)}>
            {EFECTOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" value={Math.abs(Number(a.importe) || 0)} step={50} style={{ width: 100, textAlign: 'right' }} onChange={(e) => cambiarImporte(a, e.target.value)} />
          <span className="muted">€</span>
          <select value={a.tipo} onChange={(e) => actualizar(a.id, { tipo: e.target.value })}>
            <option value="puntual">solo en</option>
            <option value="mensual">cada mes desde</option>
          </select>
          <select value={a.desde} onChange={(e) => actualizar(a.id, { desde: e.target.value })}>
            {[...new Set([a.desde, ...meses])].sort().map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </select>
          {a.tipo === 'mensual' && (
            <select value={a.hasta || ''} onChange={(e) => actualizar(a.id, { hasta: e.target.value || null })}>
              <option value="">sin fin</option>
              {meses.filter((m) => m >= a.desde).map((m) => <option key={m} value={m}>hasta {nombreMes(m)}</option>)}
            </select>
          )}
          <button className="btn sm ghost" title="Quitar" onClick={() => onChange(ajustes.filter((x) => x.id !== a.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}


// Gasto mensual montado por conceptos de pago: eliges en una lista (con scroll y buscador) los pagos que quieres sumar.
// Cada uno trae el importe de su último pago y lo puedes cambiar. Se guarda con la previsión.
function Partidas({ partidas, tipos, onChange, onCerrar }) {
  const [abierto, setAbierto] = useState(partidas.length === 0);
  const [buscar, setBuscar] = useState('');
  const elegidos = new Set(partidas.map((p) => p.clave).filter(Boolean));
  const total = partidas.reduce((a, p) => a + (Number(p.importe) || 0), 0);
  const actualizar = (id, cambios) => onChange(partidas.map((p) => (p.id === id ? { ...p, ...cambios } : p)));
  const alternar = (t) => (elegidos.has(t.clave)
    ? onChange(partidas.filter((p) => p.clave !== t.clave))
    : onChange([...partidas, { id: t.clave, clave: t.clave, nombre: t.nombre, importe: t.importe }]));
  const q = buscar.trim().toLowerCase();
  // (por si llegan datos de una versión anterior del servidor, sin nombre: se usa la categoría)
  const texto = (t) => `${t.nombre || ''} ${t.categoria || ''}`.toLowerCase();
  const lista = tipos.filter((t) => t.clave && (!q || texto(t).includes(q)));
  const info = (p) => tipos.find((t) => t.clave === p.clave);

  return (
    <div className="card">
      <div className="chart-title">
        <h2 style={{ margin: 0 }}>Gasto mensual por conceptos</h2>
        <div className="row">
          {partidas.length > 0 && <button className="btn sm ghost" onClick={() => onChange([])}>Quitar todo</button>}
          <button className="btn sm" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <button className="btn" onClick={() => setAbierto(!abierto)} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>{elegidos.size ? `${elegidos.size} conceptos elegidos` : 'Elegir los gastos que quieres sumar'}</span>
          <span>{abierto ? '▴' : '▾'}</span>
        </button>
        {abierto && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 6, background: 'var(--surface)', boxShadow: '0 6px 18px rgba(0,0,0,.08)' }}>
            <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
              <input type="search" placeholder="Buscar (p. ej. Patricia, Google, asesoría…)" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ width: '100%' }} autoFocus />
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {lista.map((t) => (
                <label key={t.clave} className="row" style={{ padding: '7px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', flexWrap: 'nowrap', gap: 10 }}>
                  <input type="checkbox" checked={elegidos.has(t.clave)} onChange={() => alternar(t)} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.nombre}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{t.categoria} · último pago {fFecha(t.ultimoPago)}</span>
                  </span>
                  {t.meses >= 2 && <span className="badge" title="Pagado en varios de los últimos 3 meses">habitual</span>}
                  {!t.reciente && <span className="badge warn" title="No se ha pagado en los últimos 3 meses">sin pagos recientes</span>}
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{fEur(t.importe)}</span>
                </label>
              ))}
              {!lista.length && <div className="empty" style={{ padding: 16 }}>Nada con «{buscar}».</div>}
            </div>
          </div>
        )}
      </div>

      {partidas.map((p) => (
        <div key={p.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', flexWrap: 'nowrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {p.clave
              ? <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</div>
              : <input type="text" value={p.nombre} placeholder="Concepto (p. ej. nueva contratación)" style={{ width: '100%' }} onChange={(e) => actualizar(p.id, { nombre: e.target.value })} />}
            {info(p) && <div className="muted" style={{ fontSize: 12 }}>último pago {fEur(info(p).importe)} el {fFecha(info(p).ultimoPago)}</div>}
          </div>
          <input type="number" step="10" value={p.importe} style={{ width: 110, textAlign: 'right' }} onChange={(e) => actualizar(p.id, { importe: Number(e.target.value) || 0 })} />
          <span className="muted">€/mes</span>
          <button className="btn sm ghost" title="Quitar" onClick={() => onChange(partidas.filter((x) => x.id !== p.id))}>✕</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => onChange([...partidas, { id: Date.now().toString(36), nombre: '', importe: 0 }])}>+ Otro gasto (que no esté en la lista)</button>
      </div>
      {partidas.length > 0 && (
        <div className="tip-r" style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, fontWeight: 700 }}>
          <span style={{ color: 'var(--text)' }}>Gasto mensual total</span><span>{fEur(total)}</span>
        </div>
      )}
    </div>
  );
}
