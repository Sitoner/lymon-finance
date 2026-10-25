import { useState } from 'react';
import { fEur, fMes, fMesLargo, fNum, mesActual } from '../format.js';
import { MesNav, Delta, Stat, useColores, delAnioSeries } from '../ui.jsx';
import Importar from './Importar.jsx';

const TIPOS = [
  ['Cobros', 'cobros'],
  ['Pagos', 'pagos'],
  ['Otros cobros/pagos', 'otros'],
  ['Traspaso', 'traspasos'],
  ['Sin categoría', 'sinCategoria'],
];

const celda = (v, extra = '', key = 't') => <td key={key} className={`n ${v < 0 ? 'neg' : ''} ${extra}`}>{Math.abs(v) < 0.005 ? <span className="muted">–</span> : fEur(v)}</td>;
const suma = (arr) => arr.reduce((a, b) => a + b, 0);

export default function Caja({ datos: datosTodo, ir, anio, cats, recargar, avisar, filtro }) {
  const [importando, setImportando] = useState(filtro?.importar === 'revolut');
  const datos = { ...datosTodo, cashflow: delAnioSeries(datosTodo.cashflow, anio) };
  const cf = datos.cashflow; // siempre por la fecha de Revolut
  const hoy = mesActual();
  const [abiertos, setAbiertos] = useState({});
  const toggle = (k) => setAbiertos((a) => ({ ...a, [k]: !a[k] }));
  const cur = (m) => (m === hoy ? 'cur' : '');
  const [vista, setVista] = useState('mes');
  const cerrados = datos.cashflow.meses.filter((m) => m < hoy);
  const [mes, setMes] = useState(cerrados[cerrados.length - 1] || datos.cashflow.meses[datos.cashflow.meses.length - 1]);
  if (importando) return <Importar tipo="revolut" cats={cats} recargar={recargar} avisar={avisar} ir={ir} onCerrar={() => setImportando(false)} />;
  if (!cf.meses.length) return <div className="empty">No hay movimientos en {anio}. <button className="btn pri" onClick={() => setImportando(true)}>Importar extracto de Revolut</button></div>;

  const bloques = TIPOS.map(([tipo, clave]) => {
    const filas = cf.desglose.filter((d) => d.tipo === tipo);
    if (!filas.length) return null;
    const grupos = [...new Set(filas.map((f) => f.grupo))].map((g) => {
      const subs = filas.filter((f) => f.grupo === g);
      return { grupo: g, subs, valores: cf.meses.map((_, i) => suma(subs.map((s) => s.valores[i]))) };
    });
    return { tipo, clave, grupos, valores: cf[clave] };
  }).filter(Boolean);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Flujo de caja</h1>
          <div className="sub">{vista === 'mes' ? 'Lo que entró y salió en el mes, por categorías. Pulsa una categoría para ver el detalle.' : 'Equivale a la hoja «Cashflow REAL». Pulsa un grupo para desplegarlo y una cifra para ver sus movimientos.'}</div>
        </div>
        <div className="row">
          <button className="btn pri" onClick={() => setImportando(true)}>Importar extracto de Revolut</button>
          <div className="seg">
            <button className={vista === 'mes' ? 'on' : ''} onClick={() => setVista('mes')}>Por mes</button>
            <button className={vista === 'tabla' ? 'on' : ''} onClick={() => setVista('tabla')}>Todos los meses</button>
          </div>
          {vista === 'tabla' && <button className="btn" onClick={() => setAbiertos(Object.fromEntries(bloques.flatMap((b) => b.grupos.map((g) => [b.tipo + g.grupo, true]))))}>Desplegar todo</button>}
          {vista === 'tabla' && <button className="btn" onClick={() => setAbiertos({})}>Plegar</button>}
        </div>
      </div>

      {vista === 'mes' ? <CajaMes cf={cf} mes={cf.meses.includes(mes) ? mes : cf.meses[cf.meses.length - 1]} setMes={setMes} hoy={hoy} ir={ir} /> : (<>
      <div className="tbl-wrap">
        <table className="pivot">
          <thead>
            <tr>
              <th>Concepto</th>
              {cf.meses.map((m) => <th key={m} className={`n ${cur(m)}`}>{fMes(m)}{m === hoy ? ' ·' : ''}</th>)}
              <th className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {(
              <tr className="grp">
                <td>Saldo inicial</td>
                {cf.saldoIni.map((v, i) => celda(v, cur(cf.meses[i]), i))}
                <td />
              </tr>
            )}
            {bloques.map((b) => (
              <Bloque key={b.tipo} b={b} cf={cf} abiertos={abiertos} toggle={toggle} cur={cur} ir={ir} />
            ))}
            <tr className="tot">
              <td>Flujo neto del mes</td>
              {cf.neto.map((v, i) => celda(v, cur(cf.meses[i]), i))}
              {celda(suma(cf.neto))}
            </tr>
            {<>
            <tr className="tot">
              <td>Saldo fin de mes</td>
              {cf.saldoFin.map((v, i) => celda(v, cur(cf.meses[i]), i))}
              <td />
            </tr>
            {cf.saldoBanco.some((v) => v !== null) && (
              <tr className="sub">
                <td>Saldo según Revolut</td>
                {cf.saldoBanco.map((v, i) => (
                  <td key={i} className={`n ${cur(cf.meses[i])}`}>
                    {v === null ? <span className="muted">–</span> : Math.abs(cf.descuadre[i]) > 0.01
                      ? <span className="badge bad" title={`Diferencia ${fEur(cf.descuadre[i])}`}>{fEur(v)}</span>
                      : <span className="badge ok">{fEur(v)} ✓</span>}
                  </td>
                ))}
                <td />
              </tr>
            )}
            <tr className="sub">
              <td>Quema del mes</td>
              {cf.burn.map((v, i) => celda(v, cur(cf.meses[i]), i))}
              <td />
            </tr>
            <tr className="sub">
              <td>Quema media 3 meses</td>
              {cf.burn3.map((v, i) => celda(v, cur(cf.meses[i]), i))}
              <td />
            </tr>
            <tr className="sub">
              <td>Runway (meses)</td>
              {cf.runway.map((v, i) => <td key={i} className={`n ${cur(cf.meses[i])}`}>{v === null ? <span className="muted">Rentable</span> : fNum(v)}</td>)}
              <td />
            </tr>
            <tr className="sub">
              <td>Fin de caja si se repite el mes</td>
              {cf.finCaja.map((m, i) => <td key={i} className={`n ${cur(cf.meses[i])}`}>{m ? `${fMes(m)} ${m.slice(2, 4)}` : <span className="muted">–</span>}</td>)}
              <td />
            </tr>
            </>}
          </tbody>
        </table>
      </div>
      <div className="kpi-foot">Runway como en tu Excel: saldo a fin de mes ÷ quema media de ese mes y los dos anteriores (los meses con beneficio cuentan 0). Si no hay quema, aparece «Rentable». La columna marcada con · es el mes en curso.</div>
      </>)}
    </div>
  );
}

function Bloque({ b, cf, abiertos, toggle, cur, ir }) {
  return (
    <>
      <tr className="grp">
        <td>{b.tipo.toUpperCase()}</td>
        {b.valores.map((v, i) => celda(v, cur(cf.meses[i]), i))}
        {celda(suma(b.valores))}
      </tr>
      {b.grupos.map((g) => {
        const k = b.tipo + g.grupo;
        return (
          <Grupo key={k} g={g} abierto={abiertos[k]} onToggle={() => toggle(k)} cf={cf} cur={cur} ir={ir} />
        );
      })}
    </>
  );
}

function Grupo({ g, abierto, onToggle, cf, cur, ir }) {
  return (
    <>
      <tr className="clic" onClick={onToggle}>
        <td>{abierto ? '▾' : '▸'} {g.grupo}</td>
        {g.valores.map((v, i) => celda(v, cur(cf.meses[i]), i))}
        {celda(suma(g.valores))}
      </tr>
      {abierto && g.subs.map((s) => (
        <tr key={s.subgrupo} className="sub">
          <td>{s.subgrupo}</td>
          {s.valores.map((v, i) => (
            <td key={i} className={`n ${v < 0 ? 'neg' : ''} ${cur(cf.meses[i])}`} style={{ cursor: v ? 'pointer' : 'default' }}
              onClick={() => v && ir('movimientos', { mes: cf.meses[i], q: s.subgrupo === 'Sin categoría' ? '' : s.subgrupo, pendientes: s.subgrupo === 'Sin categoría' })}>
              {Math.abs(v) < 0.005 ? <span className="muted">–</span> : fEur(v)}
            </td>
          ))}
          {celda(s.total)}
        </tr>
      ))}
    </>
  );
}

const COLOR_TIPO = { Cobros: 'series-1', Pagos: 'series-2', 'Otros cobros/pagos': 'text-3', Traspaso: 'text-3', 'Sin categoría': 'series-4' };

function CajaMes({ cf, mes, setMes, hoy, ir }) {
  const c = useColores();
  const [abierto, setAbierto] = useState({});
  const i = cf.meses.indexOf(mes);
  const a = i - 1;
  const ant = (arr) => (a >= 0 ? arr[a] : null);
  const ok = cf.descuadre[i] !== null && cf.descuadre[i] !== undefined ? Math.abs(cf.descuadre[i]) < 0.01 : null;

  const bloques = TIPOS.map(([tipo]) => {
    const filas = cf.desglose.filter((d) => d.tipo === tipo && Math.abs(d.valores[i]) >= 0.005);
    const grupos = [...new Set(filas.map((f) => f.grupo))].map((g) => {
      const subs = filas.filter((f) => f.grupo === g).map((s) => ({ nombre: s.subgrupo, v: s.valores[i] })).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
      return { grupo: g, subs, v: suma(subs.map((s) => s.v)) };
    }).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    return { tipo, grupos, v: suma(grupos.map((g) => g.v)) };
  }).filter((b) => b.grupos.length);
  const max = Math.max(1, ...bloques.flatMap((b) => b.grupos.map((g) => Math.abs(g.v))));

  return (
    <>
      <MesNav meses={cf.meses} valor={mes} onChange={setMes} etiqueta={mes === hoy ? 'en curso' : null} />
      <div className="grid g-4">
        <Stat label="Cobros" value={fEur(cf.cobros[i])}><Delta actual={cf.cobros[i]} anterior={ant(cf.cobros)} /></Stat>
        <Stat label="Pagos" value={fEur(-cf.pagos[i])}><Delta actual={-cf.pagos[i]} anterior={ant(cf.pagos) === null ? null : -ant(cf.pagos)} bueno={-1} /></Stat>
        <Stat label="Flujo neto del mes" value={fEur(cf.neto[i])} tono={cf.neto[i] >= 0 ? 'pos' : 'neg'}>
          {cf.otros[i] ? <span>incluye {fEur(cf.otros[i])} de otros cobros/pagos</span> : <span>Cobros − pagos</span>}
        </Stat>
          <Stat label="Saldo a fin de mes" value={fEur(cf.saldoFin[i])}>
            {ok === true && <span className="up">✓ Cuadra con Revolut</span>}
            {ok === false && <span className="down">✗ Revolut dice {fEur(cf.saldoBanco[i])}</span>}
            {ok === null && <Delta actual={cf.saldoFin[i]} anterior={ant(cf.saldoFin)} pct={false} />}
          </Stat>
      </div>

      <div className="card">
        {bloques.map((b) => (
          <div key={b.tipo} style={{ marginBottom: 14 }}>
            <div className="section-t"><span>{b.tipo}</span><span>{fEur(b.v)}</span></div>
            <div className="bars">
              {b.grupos.map((g) => {
                const k = b.tipo + g.grupo;
                return (
                  <div key={k}>
                    <div className="bar-row clic" onClick={() => setAbierto({ ...abierto, [k]: !abierto[k] })}>
                      <span className="name">{abierto[k] ? '▾' : '▸'} {g.grupo}</span>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${(Math.abs(g.v) / max) * 100}%`, background: c[COLOR_TIPO[b.tipo]] }} /></div>
                      <span className={`val ${g.v < 0 ? 'neg' : 'pos'}`}>{fEur(g.v)}</span>
                    </div>
                    {abierto[k] && g.subs.map((s) => (
                      <div key={s.nombre} className="bar-row sub clic" title="Ver movimientos"
                        onClick={() => ir('movimientos', { mes, q: s.nombre === 'Sin categoría' ? '' : s.nombre, pendientes: s.nombre === 'Sin categoría' })}>
                        <span className="name">{s.nombre}</span>
                        <div className="bar-track" style={{ height: 6 }}><div className="bar-fill" style={{ width: `${(Math.abs(s.v) / max) * 100}%`, background: c[COLOR_TIPO[b.tipo]], opacity: 0.55 }} /></div>
                        <span className="val">{fEur(s.v)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!bloques.length && <div className="empty">Sin movimientos este mes.</div>}
      </div>
      {(
        <div className="kpi-foot">
          Runway: {cf.runway[i] === null ? 'rentable (sin quema en los últimos 3 meses)' : `${fNum(cf.runway[i])} meses con la quema media de los últimos 3 meses (${fEur(cf.burn3[i])}/mes): la caja se acabaría en ${fMesLargo(cf.finCaja[i]).toLowerCase()} ${cf.finCaja[i].slice(0, 4)}`}.
        </div>
      )}
    </>
  );
}
