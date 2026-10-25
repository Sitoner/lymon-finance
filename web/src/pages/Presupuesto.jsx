import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Stat, MesNav } from '../ui.jsx';
import { fEur, fMes, fMesLargo, fNum, mesActual } from '../format.js';

const suma = (a) => a.reduce((x, y) => x + (y || 0), 0);
const pctDe = (v, total) => (total ? (v / total) * 100 : 0);

// Estado de una partida de gasto frente a su presupuesto (siempre con texto, no solo color)
function estado(real, presupuesto) {
  if (!presupuesto) return real > 0.5 ? { c: 'bad', t: '✕ Sin presupuesto' } : { c: 'ok', t: '✓ Sin gasto' };
  const r = real / presupuesto;
  if (r > 1.0001) return { c: 'bad', t: `✕ Pasado ${fEur(real - presupuesto)}` };
  if (r >= 0.9) return { c: 'warn', t: '! Al límite' };
  return { c: 'ok', t: '✓ Dentro' };
}

// Aviso principal: si en los últimos meses el gasto supera lo facturado, cuánto se pierde, cuánto aguanta la caja y qué hay que facturar
function AvisoPerdidas({ p, datos }) {
  const { ingreso, gasto, meses } = p.ultimos;
  if (!meses.length || gasto <= ingreso) return null;
  const perdida = gasto - ingreso;
  const cf = datos.cashflow;
  const i = cf.meses.filter((m) => m < mesActual()).length - 1;
  const caja = i >= 0 ? cf.saldoBanco[i] ?? cf.saldoFin[i] : null;
  const runway = i >= 0 ? cf.runway[i] : null;
  const quema = i >= 0 ? -cf.burn3[i] : 0; // lo que baja la cuenta al mes (media 3 meses, con IVA e impuestos)
  // Para cubrir el gasto y además guardar lo que piden las reservas (en % del ingreso)
  const pctReservas = suma(p.partidas.filter((x) => x.tipo === 'reserva' && x.modo === 'pct').map((x) => x.valor));
  const conReservas = pctReservas > 0 && pctReservas < 100 ? gasto / (1 - pctReservas / 100) : null;
  return (
    <div className="alert bad aviso-perdidas">
      <div>
        <b>✕ Estáis gastando más de lo que facturáis</b>
        En los últimos {meses.length} meses ({meses.map(fMes).join(', ')}) el gasto medio ha sido de <b className="inline">{fEur(gasto)} al mes</b> frente
        a {fEur(ingreso)} facturados: perdéis unos <b className="inline">{fEur(perdida)} al mes</b>.
        {caja !== null && runway && quema > 0 && <> En el banco la cuenta baja unos {fEur(quema)} al mes (con IVA e impuestos): con la caja actual ({fEur(caja)}) da para unos <b className="inline">{fNum(runway)} meses</b>.</>}
        <div style={{ marginTop: 6 }}>
          Para no perder dinero hay que facturar al menos <b className="inline">{fEur(gasto)} al mes</b> o bajar el gasto en {fEur(perdida)} al mes
          {conReservas && <>; para cubrir también las reservas del presupuesto ({fNum(pctReservas)} %), <b className="inline">{fEur(conReservas)} al mes</b></>}.
        </div>
      </div>
    </div>
  );
}

export default function Presupuesto({ anio, avisar, datos }) {
  const [p, setP] = useState(null);
  const [vista, setVista] = useState('reparto');

  useEffect(() => {
    let vivo = true;
    setP(null);
    api.get(`/api/presupuesto/${anio}`).then((r) => { if (vivo) setP(r); }).catch((e) => avisar(e.message, true));
    return () => { vivo = false; };
  }, [anio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Todas las escrituras devuelven el presupuesto recalculado
  const guardar = async (metodo, ruta, cuerpo) => {
    try { setP(await api[metodo](`/api/presupuesto/${anio}${ruta}`, cuerpo)); } catch (e) { avisar(e.message, true); }
  };

  if (!p) return <div className="empty">Cargando…</div>;
  const hayReales = p.ingresoReal.some((x) => x !== null);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Presupuesto {anio}</h1>
          <div className="sub">Cuánto del ingreso va a cada cosa y si se está cumpliendo. Importes sin IVA, en el mes al que corresponde cada gasto.</div>
        </div>
        {p.partidas.length > 0 && (
          <div className="seg">
            <button className={vista === 'reparto' ? 'on' : ''} onClick={() => setVista('reparto')}>Reparto</button>
            <button className={vista === 'seguimiento' ? 'on' : ''} onClick={() => setVista('seguimiento')}>Presupuesto vs real</button>
          </div>
        )}
      </div>

      <AvisoPerdidas p={p} datos={datos} />

      {!p.partidas.length ? <Empezar anio={anio} p={p} guardar={guardar} />
        : vista === 'reparto' ? <Reparto anio={anio} p={p} guardar={guardar} />
        : hayReales ? <Seguimiento p={p} />
        : <div className="card empty">Aún no hay meses cerrados de {anio}. El seguimiento empieza en cuanto importes el primer mes (Revolut y Beel).</div>}
    </div>
  );
}

function Empezar({ anio, p, guardar }) {
  return (
    <div className="card empezar">
      <h2>Define el reparto de {anio}</h2>
      <p className="muted">
        Cada partida se lleva un % de lo que facturéis cada mes (o un importe fijo). Si los ingresos suben, cada partida sube con ellos.
        Lo que no se gasta (reservas) es lo que debe sobrar: impuestos, colchón, beneficio.
      </p>
      <div className="row">
        <button className="btn pri" onClick={() => guardar('post', '/plantilla', { origen: 'recomendado' })}>Empezar con el reparto recomendado</button>
        <button className="btn" onClick={() => guardar('post', '/plantilla', { origen: 'historico' })}>Partir del gasto real de los últimos 12 meses</button>
      </div>
      {p.ultimos.meses.length > 0 && <div className="kpi-foot">Recomendado: Personal 45 %, Producción 12 %, Marketing 15 %, Generales 8 %, Reserva de impuestos 10 % y Beneficio 10 %. Podrás cambiarlo todo.</div>}
    </div>
  );
}

// Número que se guarda al salir del campo (o con Enter)
function CampoNum({ valor, onGuardar, sufijo, vacio = false, ancho = 90, ...resto }) {
  const [v, setV] = useState(valor ?? '');
  useEffect(() => setV(valor ?? ''), [valor]);
  const fin = () => {
    const nuevo = v === '' ? (vacio ? null : 0) : Number(v);
    if (nuevo !== valor && (nuevo === null || Number.isFinite(nuevo))) onGuardar(nuevo);
  };
  return (
    <span className="campo">
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={fin} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} style={{ width: ancho }} {...resto} />
      {sufijo && <span className="muted">{sufijo}</span>}
    </span>
  );
}

function Reparto({ anio, p, guardar }) {
  const medio = p.previstoAnual / 12;
  // % de cada partida sobre el ingreso medio previsto (las fijas se convierten a %)
  const pctPartida = (x) => pctDe(x.planAnual / 12, medio);
  const asignado = suma(p.partidas.map(pctPartida));
  const libre = 100 - asignado;
  const editar = (x, cambios) => guardar('patch', `/partidas/${x.id}`, cambios);
  const ingresoHoy = p.ultimos.ingreso;

  // Partidas cuyo gasto actual no cabe en su %: con qué facturación cabría y cuándo se llegaría a ella
  const avisos = p.partidas.filter((x) => x.ingresoNecesario && x.gastoActual > (x.valor / 100) * ingresoHoy).map((x) => {
    const i = p.previsto.findIndex((v) => v >= x.ingresoNecesario);
    return { ...x, cuando: i >= 0 ? `${fMesLargo(p.meses[i]).toLowerCase()} de ${anio}` : null };
  });

  return (
    <>
      <div className="card">
        <div className="chart-title"><h2 style={{ margin: 0 }}>Ingresos previstos {anio}</h2><span className="muted">sin IVA</span></div>
        <div className="ingresos-form">
          <label>MRR en enero<CampoNum valor={p.config.base} sufijo="€/mes" ancho={110} min={0} step={10} onGuardar={(v) => guardar('put', '/ingresos', { ...p.config, base: v })} /></label>
          <label>Crecimiento del MRR<CampoNum valor={p.config.crecimiento} sufijo="€ más cada mes" ancho={90} step={10} onGuardar={(v) => guardar('put', '/ingresos', { ...p.config, crecimiento: v })} /></label>
          <label>Puestas en marcha y otros<CampoNum valor={p.config.puntual} sufijo="€/mes" ancho={90} min={0} step={10} onGuardar={(v) => guardar('put', '/ingresos', { ...p.config, puntual: v })} /></label>
        </div>
        <div className="grid g-4" style={{ marginTop: 14 }}>
          <Stat label={`Facturación prevista ${anio}`} value={fEur(p.previstoAnual)}><span>{fEur(medio)} al mes de media</span></Stat>
          <Stat label="Enero → diciembre" value={`${fEur(p.previsto[0])} → ${fEur(p.previsto[11])}`}><span>al mes</span></Stat>
          <Stat label="Facturación actual" value={ingresoHoy ? fEur(ingresoHoy) : '—'}><span>media de {p.ultimos.meses.map(fMes).join(', ') || '—'}</span></Stat>
          <Stat label="Margen previsto" value={`${fNum(Math.max(0, libre) + suma(p.partidas.filter((x) => x.tipo === 'reserva').map(pctPartida)))} %`} tono={libre < 0 ? 'neg' : ''}>
            <span>reservas + sin asignar</span>
          </Stat>
        </div>
        <div className="kpi-foot">Por defecto salen del MRR real y del crecimiento medio de los últimos 6 meses. Pon aquí vuestro objetivo de {anio}.</div>
      </div>

      <div className="card">
        <div className="chart-title">
          <h2 style={{ margin: 0 }}>Reparto del ingreso</h2>
          <div className="row">
            <button className="btn sm" onClick={() => guardar('post', '/partidas', { nombre: 'Nueva partida', tipo: 'gasto' })}>+ Partida de gasto</button>
            <button className="btn sm" onClick={() => guardar('post', '/partidas', { nombre: 'Nueva reserva', tipo: 'reserva' })}>+ Reserva</button>
            <select className="btn sm" value="" onChange={(e) => {
              const origen = e.target.value;
              if (origen && confirm('Se sustituirán todas las partidas de este año. ¿Seguir?')) guardar('post', '/plantilla', { origen });
            }}>
              <option value="">Rehacer desde…</option>
              <option value="recomendado">el reparto recomendado</option>
              <option value="historico">el gasto real de los últimos 12 meses</option>
            </select>
          </div>
        </div>

        <BarraReparto partidas={p.partidas} pct={pctPartida} libre={libre} />

        <div className="tbl-wrap" style={{ marginTop: 14 }}>
          <table className="ptbl">
            <thead>
              <tr>
                <th>Partida</th><th>Cómo se calcula</th><th>Mín. / máx. al mes</th><th>Categorías</th>
                <th className="n">€/mes medio</th><th className="n">€ en {anio}</th><th className="n" title="Gasto medio de los últimos 3 meses cerrados">Gasto actual</th><th />
              </tr>
            </thead>
            <tbody>
              {p.partidas.map((x) => (
                <tr key={x.id}>
                  <td>
                    <TextoEditable valor={x.nombre} onGuardar={(nombre) => editar(x, { nombre })} />
                    <select className={`tipo-partida ${x.tipo}`} value={x.tipo} onChange={(e) => editar(x, { tipo: e.target.value })}>
                      <option value="gasto">Gasto</option><option value="reserva">Reserva</option>
                    </select>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <CampoNum valor={x.valor} ancho={72} min={0} step={x.modo === 'pct' ? 0.5 : 50} onGuardar={(valor) => editar(x, { valor })} />
                      <select value={x.modo} onChange={(e) => editar(x, { modo: e.target.value })} title={x.modo === 'pct' ? '% de lo facturado cada mes' : 'importe fijo cada mes'}>
                        <option value="pct">% ingreso</option><option value="fijo">€/mes</option>
                      </select>
                    </span>
                  </td>
                  <td>
                    {x.modo === 'pct' ? (
                      <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <CampoNum valor={x.minimo} vacio ancho={72} min={0} step={50} placeholder="mín." onGuardar={(minimo) => editar(x, { minimo })} />
                        <CampoNum valor={x.maximo} vacio ancho={72} min={0} step={50} placeholder="máx." onGuardar={(maximo) => editar(x, { maximo })} />
                      </span>
                    ) : <span className="muted">–</span>}
                  </td>
                  <td>{x.tipo === 'gasto' ? <SelectorCategorias cats={p.categorias} valor={x.categorias} onChange={(categorias) => editar(x, { categorias })} /> : <span className="muted">no es gasto</span>}</td>
                  <td className="n">{fEur(x.planAnual / 12)}</td>
                  <td className="n"><b>{fEur(x.planAnual)}</b></td>
                  <td className="n">{x.gastoActual === null ? <span className="muted">–</span> : <>{fEur(x.gastoActual)}<div className="muted" style={{ fontSize: 12 }}>{fNum(pctDe(x.gastoActual, ingresoHoy))} % hoy</div></>}</td>
                  <td><button className="btn sm ghost" title="Borrar partida" onClick={() => confirm(`¿Borrar «${x.nombre}»?`) && guardar('del', `/partidas/${x.id}`)}>✕</button></td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={4}>
                  Total asignado {fNum(asignado)} %
                  {libre >= 0.05 && <span className="muted" style={{ fontWeight: 400 }}> · sin asignar {fNum(libre)} %</span>}
                  {libre < -0.05 && <span className="neg" style={{ fontWeight: 600 }}> · te pasas {fNum(-libre)} % del ingreso</span>}
                </td>
                <td className="n">{fEur(suma(p.partidas.map((x) => x.planAnual)) / 12)}</td>
                <td className="n">{fEur(suma(p.partidas.map((x) => x.planAnual)))}</td>
                <td /><td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="kpi-foot">
          «% del ingreso» se aplica a lo que se facture cada mes; el mínimo y el máximo lo limitan en € al mes (p. ej. Personal 45 % pero nunca menos de 3.000 €).
          Una partida de gasto se compara con los pagos de sus categorías; las reservas son lo que debe sobrar.
        </div>
      </div>

      {avisos.length > 0 && (
        <div className="alert warn">
          <div>
            <b>Hoy hay partidas que no caben en su porcentaje</b>
            {avisos.map((x) => (
              <div key={x.id} style={{ marginTop: 6 }}>
                <b style={{ display: 'inline' }}>{x.nombre}:</b> gastáis {fEur(x.gastoActual)} al mes ({fNum(pctDe(x.gastoActual, ingresoHoy))} % de lo que facturáis).
                Para que sea el {fNum(x.valor)} %, la facturación tendría que llegar a <b style={{ display: 'inline' }}>{fEur(x.ingresoNecesario)} al mes</b> (hoy {fEur(ingresoHoy)}).
                {x.cuando ? ` Con los ingresos previstos, se llega en ${x.cuando}.` : ` Con los ingresos previstos, no se llega en ${anio}.`}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Barra de 100 % con cada partida (gasto en gris oscuro, reservas en amarillo)
function BarraReparto({ partidas, pct, libre }) {
  const tramos = partidas.map((x) => ({ k: x.id, nombre: x.nombre, v: pct(x), tipo: x.tipo })).filter((t) => t.v > 0.05);
  if (libre > 0.05) tramos.push({ k: 'libre', nombre: 'Sin asignar', v: libre, tipo: 'libre' });
  const total = Math.max(100, suma(tramos.map((t) => t.v)));
  return (
    <div className="reparto">
      <div className="reparto-bar" role="img" aria-label={tramos.map((t) => `${t.nombre} ${fNum(t.v)} %`).join(', ')}>
        {tramos.map((t) => (
          <div key={t.k} className={`reparto-t ${t.tipo}`} style={{ width: `${(t.v / total) * 100}%` }} title={`${t.nombre}: ${fNum(t.v)} %`}>
            {t.v / total >= 0.08 && <><span className="rn">{t.nombre}</span><span className="rv">{fNum(t.v)} %</span></>}
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><i style={{ background: 'var(--seg-gasto)' }} />Gasto</span>
        <span><i style={{ background: 'var(--lymon)' }} />Reserva (lo que debe sobrar)</span>
        {libre > 0.05 && <span><i className="rayado" />Sin asignar</span>}
      </div>
    </div>
  );
}

function TextoEditable({ valor, onGuardar }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return <input type="text" className="nombre-partida" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== valor && onGuardar(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

// Desplegable con casillas: un grupo entero o subgrupos sueltos
function SelectorCategorias({ cats, valor, onChange }) {
  const grupos = [...new Set(cats.map((c) => c.grupo))];
  const cambiar = (clave, on) => onChange(on ? [...valor.filter((v) => v !== clave), clave] : valor.filter((v) => v !== clave));
  const texto = valor.length ? valor.map((v) => v.replace('|', ' › ')).join(', ') : 'Elegir categorías';
  return (
    <details className="cat-picker">
      <summary className={valor.length ? '' : 'vacio'} title={texto}>{texto}</summary>
      <div className="cat-menu">
        {grupos.map((g) => {
          const entero = valor.includes(g);
          return (
            <div key={g} className="cat-g">
              <label className="cat-gt"><input type="checkbox" checked={entero} onChange={(e) => onChange(e.target.checked ? [...valor.filter((v) => !v.startsWith(`${g}|`) && v !== g), g] : valor.filter((v) => v !== g))} />{g} (todo)</label>
              {!entero && cats.filter((c) => c.grupo === g).map((c) => {
                const k = `${g}|${c.subgrupo}`;
                return <label key={k}><input type="checkbox" checked={valor.includes(k)} onChange={(e) => cambiar(k, e.target.checked)} />{c.subgrupo}</label>;
              })}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Seguimiento({ p }) {
  const reales = p.meses.filter((_, i) => p.ingresoReal[i] !== null);
  const hoy = mesActual();
  const [mes, setMes] = useState(reales[reales.length - 1]);
  const [modo, setModo] = useState('mes');
  const idx = modo === 'mes' ? [p.meses.indexOf(mes)] : p.meses.map((_, i) => i).filter((i) => p.ingresoReal[i] !== null);
  const s = (arr) => suma(idx.map((i) => arr?.[i] || 0));

  const ingreso = s(p.ingresoReal);
  const previsto = s(p.previsto);
  const gastos = p.partidas.filter((x) => x.tipo === 'gasto');
  const reservas = p.partidas.filter((x) => x.tipo === 'reserva');
  const gastoReal = suma(gastos.map((x) => s(x.gasto))) + s(p.sinPartida);
  const gastoPres = suma(gastos.map((x) => s(x.flexible)));
  const resultado = ingreso - gastoReal;
  const objetivo = suma(reservas.map((x) => s(x.flexible)));
  const periodo = modo === 'mes' ? fMesLargo(mes).toLowerCase() : `enero–${fMesLargo(reales[reales.length - 1]).toLowerCase()}`;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="seg">
          <button className={modo === 'mes' ? 'on' : ''} onClick={() => setModo('mes')}>Mes</button>
          <button className={modo === 'acum' ? 'on' : ''} onClick={() => setModo('acum')}>Acumulado del año</button>
        </div>
        {modo === 'mes' && <MesNav meses={reales} valor={mes} onChange={setMes} etiqueta={mes === hoy ? 'en curso' : null} />}
      </div>

      <div className="grid g-4">
        <Stat label={`Facturado · ${periodo}`} value={fEur(ingreso)}>
          <span className={ingreso >= previsto ? 'up' : 'down'}>{ingreso >= previsto ? '▲' : '▼'} {fEur(Math.abs(ingreso - previsto))} {ingreso >= previsto ? 'más' : 'menos'} de lo previsto</span>
        </Stat>
        <Stat label="Gasto real" value={fEur(gastoReal)}>
          <span className={gastoReal <= gastoPres ? 'up' : 'down'}>{gastoReal <= gastoPres ? '✓' : '✕'} presupuesto {fEur(gastoPres)}</span>
        </Stat>
        <Stat label="Resultado (lo que sobra)" value={fEur(resultado)} tono={resultado < 0 ? 'neg' : ''}>
          <span className={resultado >= objetivo ? 'up' : 'down'}>{resultado >= objetivo ? '✓' : '✕'} objetivo de reservas {fEur(objetivo)}</span>
        </Stat>
        <Stat label="Gasto sobre lo facturado" value={`${fNum(pctDe(gastoReal, ingreso))} %`} tono={gastoReal > ingreso ? 'neg' : ''}>
          <span>presupuesto: {fNum(pctDe(gastoPres, ingreso))} %</span>
        </Stat>
      </div>

      {resultado < 0 && (
        <div className="alert bad">
          <div><b>✕ En {periodo} se gastó más de lo que se facturó</b>Faltaron {fEur(-resultado)}{modo === 'acum' ? ' en el acumulado del año' : ''}: salieron de la caja. Mira abajo qué partidas se pasaron.</div>
        </div>
      )}

      <div className="card">
        <div className="chart-title">
          <h2 style={{ margin: 0 }}>Por partida · {periodo}</h2>
          <span className="muted">El presupuesto se recalcula con lo facturado de verdad: si se factura más, cada partida tiene más margen.</span>
        </div>
        <div className="pvr">
          <div className="pvr-h"><span>Partida</span><span /><span className="n">Presupuesto</span><span className="n">Real</span><span className="n">Estado</span></div>
          {gastos.map((x) => {
            const pres = s(x.flexible), real = s(x.gasto);
            const e = estado(real, pres);
            return <FilaPvr key={x.id} nombre={x.nombre} pres={pres} real={real} e={e} />;
          })}
          {s(p.sinPartida) > 0.5 && (
            <FilaPvr nombre="Gasto sin partida" nota={p.sinPartidaDetalle.map((d) => d.categoria).join(', ')} pres={0} real={s(p.sinPartida)} e={{ c: 'bad', t: '✕ Asígnalo a una partida' }} />
          )}
          {reservas.length > 0 && (
            <FilaPvr nombre="Reservas (lo que sobra)" nota={reservas.map((x) => x.nombre).join(' + ')} pres={objetivo} real={Math.max(0, resultado)}
              e={resultado >= objetivo ? { c: 'ok', t: '✓ Cumplido' } : resultado > 0 ? { c: 'warn', t: `! Faltan ${fEur(objetivo - resultado)}` } : { c: 'bad', t: '✕ No sobra nada' }} reserva />
          )}
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="pivot">
          <thead>
            <tr><th>Gasto real / presupuesto</th>{reales.map((m) => <th key={m} className="n">{fMes(m)}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td className="muted">Facturado</td>{reales.map((m) => <td key={m} className="n">{fEur(p.ingresoReal[p.meses.indexOf(m)])}</td>)}</tr>
            {gastos.map((x) => (
              <tr key={x.id}>
                <td>{x.nombre}</td>
                {reales.map((m) => {
                  const i = p.meses.indexOf(m);
                  const e = estado(x.gasto[i], x.flexible[i]);
                  return <td key={m} className={`n est-${e.c}`} title={`${fEur(x.gasto[i])} de ${fEur(x.flexible[i])}`}>{x.flexible[i] ? `${fNum(pctDe(x.gasto[i], x.flexible[i]))} %` : fEur(x.gasto[i])}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kpi-foot">Cada celda es el gasto real del mes sobre su presupuesto: <span className="est-ok">verde, dentro</span> · <span className="est-warn">ámbar, entre el 90 y el 100 %</span> · <span className="est-bad">rojo, pasado</span>. Pasa el ratón por encima para ver los euros.</div>
    </>
  );
}

function FilaPvr({ nombre, nota, pres, real, e, reserva }) {
  const ancho = pres ? Math.min(100, (real / pres) * 100) : real ? 100 : 0;
  return (
    <div className="pvr-r">
      <span className="pvr-n">{nombre}{nota && <small>{nota}</small>}</span>
      <span className="bar-track" title={pres ? `${fNum((real / pres) * 100)} % del presupuesto` : ''}>
        <span className={`bar-fill est-bg-${e.c} ${reserva ? 'reserva' : ''}`} style={{ width: `${ancho}%` }} />
      </span>
      <span className="n">{fEur(pres)}</span>
      <span className="n"><b>{fEur(real)}</b></span>
      <span className={`n est-${e.c}`}>{e.t}</span>
    </div>
  );
}
