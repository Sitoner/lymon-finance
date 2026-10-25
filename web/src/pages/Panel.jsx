import { ResponsiveContainer, ComposedChart, LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Kpi, Leyenda, Tip, useColores, ejeEur, delAnioSeries } from '../ui.jsx';
import { fEur, fMes, fMesLargo, fNum, mesActual } from '../format.js';

const GRUPOS_GASTO = ['Producción', 'Marketing', 'Personal', 'Generales'];

export default function Panel({ datos, ir, anio }) {
  const c = useColores();
  const cf = delAnioSeries(datos.cashflow, anio);
  const ing = delAnioSeries(datos.ingresos, anio);
  const pv = datos.prevision && { ...datos.prevision, filas: datos.prevision.filas.filter((f) => Number(f.mes.slice(0, 4)) === anio) };
  if (!cf.meses.length) return <div className="empty">No hay movimientos en {anio}.</div>;
  const hoy = mesActual();
  const cerradosAnio = cf.meses.filter((m) => m < hoy);
  // Si el año no tiene meses cerrados (p. ej. un año futuro), se usa el último mes con datos
  const cerrados = cerradosAnio.length ? cerradosAnio : cf.meses.slice(-1);
  const iU = cf.meses.indexOf(cerrados[cerrados.length - 1]);
  const iA = iU - 1;
  const iMrr = ing.meses.length - 1;
  const enCurso = cf.meses.includes(hoy);

  // Serie de caja: real + previsión del Excel + proyección desde el último mes real
  const filasPv = Object.fromEntries((pv?.filas || []).map((f) => [f.mes, f]));
  const todosMeses = [...new Set([...cf.meses.filter((m) => m < hoy), ...(pv?.filas || []).map((f) => f.mes)])].sort();
  const serieCaja = todosMeses.map((m) => {
    const i = cf.meses.indexOf(m);
    const real = i >= 0 && m < hoy ? cf.saldoFin[i] : null;
    const f = filasPv[m];
    return {
      mes: m,
      real,
      // la previsión arranca en el último mes real, para que la línea continúe
      prevision: f ? f.caja : m === (datos.prevision?.ultimoMesReal) ? real : null,
    };
  });

  const serieFlujo = cf.meses.map((m, i) => ({ mes: m, cobros: cf.cobros[i], pagos: -cf.pagos[i], neto: cf.neto[i] }));
  const serieMrr = ing.meses.map((m, i) => ({ mes: m, mrr: ing.mrr[i], cuentas: ing.cuentas[i] }));
  const cfG = cf;
  const serieGastos = cfG.meses.map((m, i) => {
    const o = { mes: m };
    for (const g of GRUPOS_GASTO) o[g] = -cfG.desglose.filter((d) => d.tipo === 'Pagos' && d.grupo === g).reduce((a, d) => a + d.valores[i], 0);
    return o;
  });
  const colGasto = [c['series-1'], c['series-2'], c['series-3'], c['series-4']];

  const varCaja = iA >= 0 ? cf.saldoFin[iU] - cf.saldoFin[iA] : null;
  const varMrr = iMrr > 0 ? ing.mrr[iMrr] - ing.mrr[iMrr - 1] : null;
  const descuadre = cf.descuadre[iU];
  const ejeX = { dataKey: 'mes', tickFormatter: fMes, tick: { fill: c['text-2'], fontSize: 12 }, axisLine: { stroke: c.border }, tickLine: false };
  const ejeY = { tickFormatter: ejeEur, tick: { fill: c['text-3'], fontSize: 12 }, axisLine: false, tickLine: false, width: 44 };
  const rejilla = <CartesianGrid vertical={false} stroke={c.grid} />;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Panel</h1>
          <div className="sub">Último mes cerrado: <b>{fMesLargo(cerrados[cerrados.length - 1])}</b>{enCurso && <> · {fMesLargo(hoy)} en curso</>}</div>
        </div>
        <div className="row">
          <button className="btn pri" onClick={() => ir('caja', { importar: 'revolut' })}>Importar Revolut</button>
          <button className="btn" onClick={() => ir('ingresos', { importar: 'beel' })}>Importar Beel</button>
        </div>
      </div>

      {datos.pendientes > 0 && (
        <div className="alert warn">
          <div><b>{datos.pendientes} movimientos sin categoría</b>Cuentan en la caja pero no en el desglose por categorías.</div>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => ir('movimientos', { pendientes: true })}>Categorizar</button>
        </div>
      )}
      {descuadre !== null && descuadre !== undefined && Math.abs(descuadre) > 0.01 && (
        <div className="alert bad">
          <div><b>El saldo no cuadra con Revolut en {fMesLargo(cf.meses[iU])}</b>Revolut dice {fEur(cf.saldoBanco[iU])} y la app calcula {fEur(cf.saldoFin[iU])} (diferencia {fEur(descuadre)}). Probablemente falta importar algún extracto anterior.</div>
        </div>
      )}

      <div className="grid g-4">
        <Kpi label={`Caja a fin de ${fMesLargo(cf.meses[iU]).split(' ')[0].toLowerCase()}`} value={fEur(cf.saldoFin[iU])}
          foot={varCaja !== null && `${varCaja >= 0 ? '▲' : '▼'} ${fEur(Math.abs(varCaja))} vs mes anterior`} tono={varCaja >= 0 ? 'up' : 'down'} />
        <Kpi label={`MRR ${fMes(ing.meses[iMrr])}`} value={fEur(ing.mrr[iMrr])}
          foot={varMrr !== null && `${varMrr >= 0 ? '▲' : '▼'} ${fEur(Math.abs(varMrr))} · ARPA ${fEur(ing.arpa[iMrr])}`} tono={varMrr >= 0 ? 'up' : 'down'} />
        <Kpi label="Clientes recurrentes" value={fNum(ing.cuentas[iMrr])}
          foot={`${ing.locales?.[iMrr] ? `${ing.locales[iMrr]} locales · ` : ''}+${ing.nuevas[iMrr]} altas · −${ing.bajas[iMrr]} bajas en ${fMes(ing.meses[iMrr])}`} />
        <Kpi label="Runway" value={cf.runway[iU] === null ? 'Rentable' : `${fNum(cf.runway[iU])} meses`} tono={cf.runway[iU] !== null && cf.runway[iU] < 6 ? 'down' : ''}
          foot={cf.runway[iU] === null ? `Sin quema en los últimos 3 meses` : `Quema media 3 meses: ${fEur(cf.burn3[iU])}/mes · fin de caja: ${fMesLargo(cf.finCaja[iU]).toLowerCase()} ${cf.finCaja[iU].slice(0, 4)}`} />
      </div>

      <div className="card">
        <div className="chart-title">
          <h2>Saldo de caja</h2>
          <Leyenda items={[
            { label: 'Real (fin de mes)', color: c['series-1'] },
            { label: 'Previsión (simulador)', color: c['series-1'], dash: true },
          ]} />
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={serieCaja} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {rejilla}
            <XAxis {...ejeX} />
            <YAxis {...ejeY} />
            <ReferenceLine y={0} stroke={c['text-3']} />
            <Tooltip content={<Tip series={[{ key: 'real', label: 'Real' }, { key: 'prevision', label: 'Previsión' }]} />} />
            <Line dataKey="real" stroke={c['series-1']} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: c['series-1'] }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="prevision" stroke={c['series-1']} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="chart-title">
            <h2>Cobros y pagos</h2>
            <Leyenda items={[{ label: 'Cobros', color: c['series-1'] }, { label: 'Pagos', color: c['series-2'] }]} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={serieFlujo} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
              {rejilla}
              <XAxis {...ejeX} />
              <YAxis {...ejeY} />
              <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<Tip series={[{ key: 'cobros', label: 'Cobros', color: c['series-1'] }, { key: 'pagos', label: 'Pagos', color: c['series-2'] }, { key: 'neto', label: 'Neto (incl. otros)' }]} />} />
              <Bar dataKey="cobros" fill={c['series-1']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="pagos" fill={c['series-2']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="kpi-foot">No incluye IVA, préstamos ni aportaciones o repagos a socios (están en Otros cobros/pagos).</div>
        </div>

        <div className="card">
          <div className="chart-title"><h2>MRR (ingresos recurrentes mensuales)</h2></div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={serieMrr} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {rejilla}
              <XAxis {...ejeX} />
              <YAxis {...ejeY} />
              <Tooltip content={<Tip series={[{ key: 'mrr', label: 'MRR' }, { key: 'cuentas', label: 'Clientes', fmt: fNum }]} />} />
              <Line dataKey="mrr" stroke={c['series-1']} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: c['series-1'] }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="chart-title">
          <h2>Gastos por grupo</h2>
          <Leyenda items={GRUPOS_GASTO.map((g, i) => ({ label: g, color: colGasto[i] }))} />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={serieGastos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            {rejilla}
            <XAxis {...ejeX} />
            <YAxis {...ejeY} />
            <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<Tip series={GRUPOS_GASTO.map((g, i) => ({ key: g, label: g, color: colGasto[i] })).reverse()} />} />
            {GRUPOS_GASTO.map((g, i) => (
              <Bar key={g} dataKey={g} stackId="g" fill={colGasto[i]} stroke={c.surface} strokeWidth={1}
                radius={i === GRUPOS_GASTO.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
