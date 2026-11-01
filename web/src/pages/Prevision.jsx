import { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from 'recharts';
import { api } from '../api.js';
import { fEur, fFecha, fMes, fMesLargo, fNum } from '../format.js';
import { Stat, useColores, ejeEur, colorGrupo } from '../ui.jsx';
import { simular, huecoSocio, pagoSocio, socioActivo, IRPF_POR_DEFECTO } from '../../../shared/simulacion.js';

const nombreMes = (m) => (m ? `${fMesLargo(m)} ${m.slice(0, 4)}` : '');
const DEPARTAMENTOS = ['Producción', 'Marketing y ventas', 'Generales', 'Personal'];

export default function Prevision({ datos, recargar, avisar }) {
  const pv = datos.prevision;
  const c = useColores();
  const [s, setS] = useState(pv?.supuestos);
  const [verDetalle, setVerDetalle] = useState(false);
  const [modalidadHueco, setModalidadHueco] = useState('nomina');
  const temporizador = useRef(null);
  useEffect(() => setS(pv?.supuestos), [pv?.supuestos]);
  const sim = useMemo(() => (s && pv ? simular(s, pv.base) : null), [s, pv]);
  const hueco = useMemo(() => (s && pv ? huecoSocio(s, pv.base, { modalidad: modalidadHueco, cajaMinima: Number(s.cajaMinima) || 0 }) : 0), [s, pv, modalidadHueco]);
  if (!pv || !s || !sim) return <div className="empty">No hay datos suficientes para simular.</div>;

  // Cambia al momento y se guarda medio segundo después del último cambio
  function cambiar(cambios) {
    const nuevo = { ...s, ...cambios };
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
    ...sim.filas.map((f) => ({ mes: f.mes, ingresos: f.ingresos, gastos: f.gastos, margen: f.margen, cajaPrev: f.caja, hacienda: f.hacienda, sociedades: f.sociedades, real: false, ajustes: f.ajustes })),
  ];
  const mesesFuturos = sim.filas.map((f) => f.mes);
  const cColor = c['series-3'];
  const primero = sim.filas[0];
  const nominaHueco = pagoSocio({ modalidad: 'nomina', coste: hueco });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Previsión</h1>
          <div className="sub">Simulador de caja desde el último mes real ({nombreMes(pv.ultimoMesReal)}). Mueve los controles y mira cómo cambia. Los gastos y los socios se ponen sin IVA, lo que de verdad cuestan; la app añade el IVA para calcular la caja y los pagos a Hacienda.</div>
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
          <Control label="Puesta en marcha (+ IVA)" valor={s.precioPuestaMarcha} min={0} max={800} paso={10} onChange={(v) => cambiar({ precioPuestaMarcha: v })} formato={(v) => fEur(v)}
            ayuda="por local nuevo" />
          <div className="row" style={{ justifyContent: 'space-between', alignSelf: 'center' }}>
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

      <GastoPrevisto gastos={s.gastos || []} socios={s.socios || []} conceptos={pv.gastosTipo || []} meses={mesesFuturos}
        onGastos={(gastos) => cambiar({ gastos })} onSocios={(socios) => cambiar({ socios })} primero={primero} />

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
        <Stat label="Margen medio al mes (sin IVA)" value={fEur(r.margenMedio)} tono={r.margenMedio >= 0 ? 'pos' : 'neg'}>
          <span>ingresos − gastos − socios, sin IVA · al final: {fEur(r.margenFinal)}</span>
        </Stat>
      </div>

      {r.primerMesNegativo && (
        <div className="alert bad"><div><b>Con estos supuestos te quedas sin caja en {nombreMes(r.primerMesNegativo).toLowerCase()}</b>Prueba a subir los locales nuevos o el ticket, o a bajar el gasto, para ver qué hace falta para evitarlo.</div></div>
      )}

      <div className="card">
        <div className="chart-title">
          <h2 style={{ margin: 0 }}>¿Cabe otro socio?</h2>
          <div className="seg">
            {[['nomina', 'Por nómina'], ['factura', 'Por factura']].map(([k, v]) => <button key={k} className={modalidadHueco === k ? 'on' : ''} onClick={() => setModalidadHueco(k)}>{v}</button>)}
          </div>
        </div>
        <div className="grid g-2" style={{ gap: '10px 40px', alignItems: 'end' }}>
          <div>
            <div className="kpi-label">Podría costar hasta</div>
            <div className="kpi-value">{fEur(hueco)} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>al mes, sin IVA</span></div>
            <div className="kpi-foot">
              {hueco > 0
                ? (modalidadHueco === 'nomina'
                  ? <>entrando ya por nómina: {fEur(hueco)} brutos, le llegarían unos {fEur(nominaHueco.alSocio)} netos (IRPF {IRPF_POR_DEFECTO.nomina} %)</>
                  : <>entrando ya por factura: {fEur(hueco)} + IVA; el IVA se recupera en el trimestre, pero se adelanta, por eso da algo menos que por nómina</>)
                : 'con estos supuestos no queda hueco sin bajar de la caja mínima'}
            </div>
          </div>
          <div>
            <label className="row" style={{ justifyContent: 'space-between' }}>
              <span>sin que el banco baje nunca de</span>
              <input type="number" step={500} min={0} value={s.cajaMinima ?? 0} style={{ width: 110, textAlign: 'right', fontWeight: 650 }} onChange={(e) => cambiar({ cajaMinima: Number(e.target.value) || 0 })} />
            </label>
            <div className="kpi-foot">en los próximos {s.horizonte} meses. Para que se pague solo, sin tirar de caja, fíjate en el margen al final: {fEur(r.margenFinal)} al mes.</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chart-title">
          <h2>Mes a mes</h2>
          <span className="legend">
            <span><i style={{ background: c['series-1'] }} />Ingresos</span>
            <span><i style={{ background: c['series-2'] }} />Gastos</span>
            <span><i style={{ background: cColor, height: 3, borderRadius: 0 }} />Caja</span>
            <span className="muted">· con IVA, como en el banco · más claro / discontinuo = previsto</span>
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
            <thead><tr><th>Mes</th><th className="n">Locales pagando</th><th className="n">Ingresos</th><th className="n">Gastos</th><th className="n">de ellos, socios</th><th className="n">Margen sin IVA</th><th className="n">Hacienda</th><th className="n">Caja</th><th>Ajustes</th></tr></thead>
            <tbody>
              {sim.filas.map((f) => (
                <tr key={f.mes}>
                  <td>{nombreMes(f.mes)}</td>
                  <td className="n">{fNum(Math.round(f.restaurantesInicio))} <span className="muted">({f.vendidos} vendidos · +{fNum(f.nuevos)} empiezan a pagar{f.bajas ? ` · −${f.bajas} bajas` : ''})</span></td>
                  <td className="n">{fEur(f.ingresos)}</td>
                  <td className="n">{fEur(f.gastos)}</td>
                  <td className="n muted">{fEur(f.socios)}</td>
                  <td className={`n ${f.margen < 0 ? 'neg' : 'pos'}`}>{fEur(f.margen)}</td>
                  <td className="n">{f.hacienda ? <span className="neg">{fEur(-f.hacienda)}</span> : <span className="muted">–</span>}{f.sociedades > 0 && <div className="muted" style={{ fontSize: 12 }}>Sociedades {fEur(f.sociedades)}</div>}</td>
                  <td className={`n ${f.caja < 0 ? 'neg' : ''}`} style={{ fontWeight: 650 }}>{fEur(f.caja)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{f.ajustes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="kpi-foot">
        Ingresos = locales pagando × ticket + locales vendidos × puesta en marcha, más el IVA medio real de tus ventas ({fNum(pv.base.tipos.ivaVentas)} %).
        Gastos = cada línea de gasto con su IVA real, más lo que se paga a los socios (por factura con IVA y menos IRPF; por nómina menos IRPF, y la cuota si la paga la empresa).
        Hacienda: IVA y retenciones de cada trimestre, pagados en enero, abril, julio y octubre; y el Impuesto de Sociedades al {fNum(pv.base.sociedades?.tipo ?? 15)} % del beneficio sin IVA de cada año (real hasta hoy + margen previsto), en julio del año siguiente, con sus pagos a cuenta en abril, octubre y diciembre si el año anterior salió cuota{Object.keys(pv.base.pagosPendientes || {}).length ? ` (incluye el pago pendiente de ${Object.entries(pv.base.pagosPendientes).map(([m, v]) => `${fEur(v)} en ${fMesLargo(m).toLowerCase()}`).join(', ')})` : ''}.
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

// Importe del movimiento (lo que sale del banco: con IVA y sin la retención) y coste sin IVA de una línea de gasto
const factorBanco = (g) => (100 + (Number(g.iva) || 0) - (Number(g.irpf) || 0)) / 100;
const bancoDe = (g) => (g.importe != null ? Number(g.importe) || 0 : (Number(g.coste) || 0) * factorBanco(g));
const conImporte = (g, importe) => ({ importe, coste: importe / factorBanco(g) });

// Gasto previsto al mes, por departamento, con el importe de cada pago tal cual sale del banco. Cada línea es un concepto
// de pago elegido de la lista (o uno a mano); su IVA real va por dentro para sacar el coste sin IVA y el margen.
// En Personal van además los socios, con su coste acordado
function GastoPrevisto({ gastos, socios, conceptos, meses, onGastos, onSocios, primero }) {
  const [abiertos, setAbiertos] = useState({});
  const [eligiendo, setEligiendo] = useState(null); // departamento con la lista de pagos abierta
  const [buscar, setBuscar] = useState('');
  const actualizar = (id, cambios) => onGastos(gastos.map((g) => (g.id === id ? { ...g, ...cambios } : g)));
  const anadir = (grupo) => onGastos([...gastos, { id: Date.now().toString(36), grupo, nombre: '', subgrupo: '', importe: 0, coste: 0, iva: 21, irpf: 0, nuevo: true }]);
  const elegidos = new Set(gastos.map((g) => g.clave).filter(Boolean));
  const alternar = (t) => (elegidos.has(t.clave)
    ? onGastos(gastos.filter((g) => g.clave !== t.clave))
    : onGastos([...gastos, { id: t.clave, clave: t.clave, nombre: t.nombre, grupo: t.grupo, subgrupo: t.subgrupo, importe: t.importe, coste: t.coste, iva: t.iva, irpf: t.irpf }]));
  const deDep = (dep) => gastos.filter((g) => (DEPARTAMENTOS.includes(g.grupo) ? g.grupo : 'Generales') === dep);
  const suma = (lista) => lista.filter((g) => !g.desactivado).reduce((a, g) => a + (Number(g.coste) || 0), 0);
  const mesHoy = meses[0];
  const costeSocios = socios.filter((so) => socioActivo(so, mesHoy)).reduce((a, so) => a + pagoSocio(so).costeReal, 0);
  const total = suma(gastos) + costeSocios;
  const sumaBanco = (lista) => lista.filter((g) => !g.desactivado).reduce((a, g) => a + bancoDe(g), 0);
  const bancoSocios = socios.filter((so) => socioActivo(so, mesHoy)).reduce((a, so) => a + pagoSocio(so).banco, 0);
  const totalBanco = sumaBanco(gastos) + bancoSocios;
  const q = buscar.trim().toLowerCase();

  return (
    <div className="card">
      <div className="chart-title">
        <h2 style={{ margin: 0 }}>Gasto previsto al mes <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>lo que sale del banco</span></h2>
        <span style={{ textAlign: 'right' }}><b style={{ fontSize: 20 }}>{fEur(totalBanco)}</b><span className="muted" style={{ display: 'block', fontSize: 12 }}>coste sin IVA {fEur(total)}</span></span>
      </div>
      <div className="kpi-foot" style={{ marginTop: -6, marginBottom: 6 }}>
        Elige de la lista los pagos que se repiten y pon lo que esperas pagar en cada uno, tal cual sale del banco. A los socios, su coste acordado: la app calcula lo que sale del banco.
      </div>
      {DEPARTAMENTOS.map((dep) => {
        const lineas = deDep(dep), esPersonal = dep === 'Personal';
        const sub = suma(lineas) + (esPersonal ? costeSocios : 0);
        const subBanco = sumaBanco(lineas) + (esPersonal ? bancoSocios : 0);
        const abierto = abiertos[dep] ?? esPersonal;
        const lista = conceptos.filter((t) => t.grupo === dep && (!q || `${t.nombre} ${t.subgrupo}`.toLowerCase().includes(q)));
        const resumen = esPersonal
          ? `${socios.filter((so) => socioActivo(so, mesHoy)).length} socios${lineas.length ? ` · ${lineas.length} más` : ''}`
          : `${lineas.length} ${lineas.length === 1 ? 'concepto' : 'conceptos'}`;
        return (
          <div key={dep} style={{ borderTop: '1px solid var(--line)' }}>
            <button type="button" className="row" onClick={() => setAbiertos({ ...abiertos, [dep]: !abierto })}
              style={{ width: '100%', border: 0, background: 'none', padding: '11px 2px', cursor: 'pointer', justifyContent: 'space-between', color: 'var(--text)', font: 'inherit' }}>
              <span className="row" style={{ gap: 8 }}>
                <i style={{ width: 9, height: 9, borderRadius: '50%', background: colorGrupo(dep), display: 'inline-block' }} />
                <b>{dep}</b>
                <span className="muted" style={{ fontSize: 13 }}>{resumen}</span>
              </span>
              <span className="row" style={{ gap: 10 }}><span className="muted" style={{ fontSize: 12 }}>coste sin IVA {fEur(sub)}</span><b>{fEur(subBanco)}</b><span className="muted">{abierto ? '▴' : '▾'}</span></span>
            </button>
            {abierto && (
              <div style={{ padding: '0 0 10px 17px' }}>
                {lineas.map((g) => (
                  <div key={g.id} className="row" style={{ padding: '4px 0', flexWrap: 'nowrap', opacity: g.desactivado ? 0.5 : 1 }}>
                    <input type="checkbox" checked={!g.desactivado} onChange={(e) => actualizar(g.id, { desactivado: !e.target.checked })} title="Contar / no contar" />
                    {g.nuevo
                      ? <input type="text" value={g.nombre || ''} placeholder="Concepto (p. ej. nueva herramienta)" style={{ flex: 1, minWidth: 0 }} onChange={(e) => actualizar(g.id, { nombre: e.target.value })} />
                      : (
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nombre || g.subgrupo}</span>
                          {g.nombre && g.subgrupo && <span className="muted" style={{ fontSize: 12 }}>{g.subgrupo}</span>}
                        </span>
                      )}
                    <input type="number" step={1} min={0} value={Math.round(bancoDe(g) * 100) / 100} style={{ width: 100, textAlign: 'right' }} title="Lo que sale del banco cada mes"
                      onChange={(e) => actualizar(g.id, conImporte(g, Number(e.target.value) || 0))} />
                    <span className="muted">€/mes</span>
                    <span className="muted" style={{ fontSize: 12, minWidth: 104, textAlign: 'right' }} title="Coste para la empresa, sin IVA">sin IVA {fEur(g.coste)}</span>
                    <button className="btn sm ghost" title="Quitar" onClick={() => onGastos(gastos.filter((x) => x.id !== g.id))}>✕</button>
                  </div>
                ))}
                {esPersonal && <Socios socios={socios} meses={meses} onChange={onSocios} />}
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <button className="btn sm" onClick={() => { setEligiendo(eligiendo === dep ? null : dep); setBuscar(''); }}>{eligiendo === dep ? 'Cerrar la lista' : 'Elegir de la lista de pagos'}</button>
                  <button className="btn sm ghost" onClick={() => anadir(dep)}>+ Otro gasto a mano</button>
                </div>
                {eligiendo === dep && (
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 6, background: 'var(--surface)', boxShadow: '0 6px 18px rgba(0,0,0,.08)' }}>
                    <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
                      <input type="search" placeholder={`Buscar en los pagos de ${dep.toLowerCase()}…`} value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ width: '100%' }} autoFocus />
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {lista.map((t) => (
                        <label key={t.clave} className="row" style={{ padding: '7px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', flexWrap: 'nowrap', gap: 10 }}>
                          <input type="checkbox" checked={elegidos.has(t.clave)} onChange={() => alternar(t)} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.nombre}</span>
                            <span className="muted" style={{ fontSize: 12 }}>{t.subgrupo} · último pago {fFecha(t.ultimoPago)}</span>
                          </span>
                          {t.meses >= 2 && <span className="badge" title="Pagado en varios de los últimos 3 meses">habitual</span>}
                          {!t.reciente && <span className="badge warn" title="No se ha pagado en los últimos 3 meses">sin pagos recientes</span>}
                          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }} title="Último pago, tal cual salió del banco">{fEur(t.importe)}</span>
                        </label>
                      ))}
                      {!lista.length && <div className="empty" style={{ padding: 16 }}>{q ? `Nada con «${buscar}».` : 'No hay pagos de este departamento en el último año.'}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Socios({ socios, meses, onChange }) {
  const actualizar = (id, cambios) => onChange(socios.map((x) => (x.id === id ? { ...x, ...cambios } : x)));
  const cambiarModalidad = (so, modalidad) => actualizar(so.id, { modalidad, irpf: IRPF_POR_DEFECTO[modalidad] });
  const nuevo = () => onChange([...socios, { id: Date.now().toString(36), nombre: '', modalidad: 'nomina', coste: 2000, irpf: IRPF_POR_DEFECTO.nomina, cuota: 0 }]);
  // Para pasar de factura a nómina (o al revés) en un mes: este socio hasta el mes anterior y una copia con la otra forma desde ese mes
  const duplicar = (so) => {
    const otra = so.modalidad === 'nomina' ? 'factura' : 'nomina', desde = meses[1] || meses[0];
    onChange([...socios.map((x) => (x.id === so.id ? { ...x, hasta: meses[0] } : x)),
      { ...so, id: Date.now().toString(36), modalidad: otra, irpf: IRPF_POR_DEFECTO[otra], cuota: 0, desde, hasta: null }]);
  };
  return (
    <div style={{ margin: '4px 0 6px', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <b style={{ fontSize: 13.5 }}>Socios</b>
        <button className="btn sm" onClick={nuevo}>+ Añadir socio</button>
      </div>
      <div className="kpi-foot" style={{ marginTop: 0, marginBottom: 6 }}>Coste = base de su factura o bruto de su nómina. Para cambiar a nómina desde un mes, usa «Cambiar desde…».</div>
      {!socios.length && <div className="muted">Sin socios todavía.</div>}
      {socios.map((so) => {
        const p = pagoSocio(so), nomina = so.modalidad === 'nomina';
        return (
          <div key={so.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line)', opacity: so.desactivado ? 0.5 : 1 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="checkbox" checked={!so.desactivado} onChange={(e) => actualizar(so.id, { desactivado: !e.target.checked })} title="Contar / no contar" />
              <input type="text" value={so.nombre} placeholder="Nombre" style={{ flex: 1, minWidth: 0 }} onChange={(e) => actualizar(so.id, { nombre: e.target.value })} />
              <div className="seg">
                {[['factura', 'Factura'], ['nomina', 'Nómina']].map(([k, v]) => <button key={k} className={so.modalidad === k ? 'on' : ''} onClick={() => cambiarModalidad(so, k)}>{v}</button>)}
              </div>
              <input type="number" step={50} min={0} value={so.coste} style={{ width: 100, textAlign: 'right', fontWeight: 650 }} onChange={(e) => actualizar(so.id, { coste: Number(e.target.value) || 0 })} />
              <span className="muted">€/mes</span>
              <button className="btn sm ghost" title="Quitar" onClick={() => onChange(socios.filter((x) => x.id !== so.id))}>✕</button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 5, fontSize: 12.5, color: 'var(--text-2)' }}>
              <label className="row" style={{ gap: 4 }}>IRPF <input type="number" step={1} min={0} max={50} value={so.irpf ?? IRPF_POR_DEFECTO[nomina ? 'nomina' : 'factura']} style={{ width: 52, padding: '3px 6px' }} onChange={(e) => actualizar(so.id, { irpf: Number(e.target.value) || 0 })} /> %</label>
              {nomina && <label className="row" style={{ gap: 4 }}>cuota de autónomo que paga la empresa <input type="number" step={10} min={0} value={so.cuota ?? 0} style={{ width: 70, padding: '3px 6px' }} onChange={(e) => actualizar(so.id, { cuota: Number(e.target.value) || 0 })} /> €</label>}
              <select value={so.desde || ''} style={{ padding: '3px 6px' }} onChange={(e) => actualizar(so.id, { desde: e.target.value || null })}>
                <option value="">desde ya</option>
                {meses.map((m) => <option key={m} value={m}>desde {nombreMes(m)}</option>)}
              </select>
              <select value={so.hasta || ''} style={{ padding: '3px 6px' }} onChange={(e) => actualizar(so.id, { hasta: e.target.value || null })}>
                <option value="">sin fin</option>
                {meses.filter((m) => !so.desde || m >= so.desde).map((m) => <option key={m} value={m}>hasta {nombreMes(m)}</option>)}
              </select>
              <button className="btn sm ghost" style={{ padding: '0 4px', textDecoration: 'underline' }} onClick={() => duplicar(so)}>Cambiar desde…</button>
              <span style={{ marginLeft: 'auto' }}>
                le llegan <b>{fEur(p.alSocio)}</b>{!nomina && <> (con {fEur(p.iva)} de IVA, que se recupera)</>} · coste real <b>{fEur(p.costeReal)}</b>
              </span>
            </div>
          </div>
        );
      })}
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
      {d.margen !== undefined && <div className="tip-r"><span>Margen sin IVA</span><span>{fEur(d.margen)}</span></div>}
      {d.hacienda > 0 && <div className="tip-r"><span>Pago a Hacienda{d.sociedades > 0 ? ` (${fEur(d.sociedades)} de Sociedades)` : ''}</span><span>−{fEur(d.hacienda)}</span></div>}
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
        <h2 style={{ margin: 0 }}>Ajustes puntuales <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>sin IVA</span></h2>
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
