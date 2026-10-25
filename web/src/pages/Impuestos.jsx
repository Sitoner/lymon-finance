import { useState } from 'react';
import { api } from '../api.js';
import { Stat } from '../ui.jsx';
import { fEur, fMesLargo } from '../format.js';

const fFechaLarga = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const nombreTrim = (t) => `${t.slice(-1)}.º trimestre`;

export default function Impuestos({ datos, recargar, avisar, anio }) {
  const [imp, setImp] = useState(datos.impuestos);
  if (!imp || !imp.trimestres.length) return <div className="empty">Todavía no hay datos de impuestos.</div>;

  const trims = imp.trimestres.filter((t) => Number(t.trimestre.slice(0, 4)) === anio);
  const proximo = imp.trimestres.find((t) => t.estado === 'pendiente');
  const enCurso = imp.trimestres.find((t) => t.estado === 'en curso');
  const atrasados = imp.trimestres.filter((t) => t.estado === 'sin pago en el banco');

  async function marcar(t, pagado) {
    try { setImp(await api.put(`/api/impuestos/${t.trimestre}`, { pagado })); recargar(); } catch (e) { avisar(e.message, true); }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Impuestos</h1>
          <div className="sub">
            Lo que tendréis que pagar a Hacienda por el IVA (modelo 303) y por las retenciones de IRPF de las facturas de los socios (modelo 111).
            Se calcula con tus facturas de Beel y los movimientos del banco, con el IVA e IRPF de cada categoría.
          </div>
        </div>
      </div>

      <div className="grid g-4">
        <Stat label="Próximo pago a Hacienda" value={proximo ? fEur(proximo.total) : '—'}>
          {proximo ? <span>{nombreTrim(proximo.trimestre)} · vence el {fFechaLarga(proximo.vence)}</span> : <span>No hay pagos pendientes</span>}
        </Stat>
        <Stat label="Acumulado del trimestre en curso" value={enCurso ? fEur(enCurso.total) : '—'}>
          {enCurso && <span>{nombreTrim(enCurso.trimestre)} hasta hoy · se paga el {fFechaLarga(enCurso.vence)}</span>}
        </Stat>
        <Stat label="Saldo en el banco" value={fEur(imp.saldo)}><span>según el último extracto importado</span></Stat>
        <Stat label="Caja libre de impuestos" value={fEur(imp.cajaLibre)} tono={imp.cajaLibre < 0 ? 'neg' : ''}>
          <span>saldo − {fEur(imp.pendiente)} pendientes con Hacienda</span>
        </Stat>
      </div>

      {atrasados.length > 0 && (
        <div className="alert warn">
          <div>
            <b>No encuentro en Revolut el pago de {atrasados.map((t) => nombreTrim(t.trimestre).replace('.º trimestre', 'T')).join(', ')}</b>
            Si se pagaron desde otra cuenta o los adelantaron los socios, márcalos como pagados. Si no, ese importe sigue pendiente con Hacienda (no está restado en la caja libre).
          </div>
        </div>
      )}

      {enCurso && enCurso.compensarSiguiente < 0 && (
        <div className="alert ok">
          <div><b>Tenéis IVA a compensar: {fEur(-enCurso.compensarSiguiente)}</b>Habéis pagado más IVA del que habéis cobrado (sobre todo por el IVA de las facturas de los socios). Se descuenta en los siguientes trimestres; en el 4.º trimestre se puede pedir la devolución.</div>
        </div>
      )}

      {[...trims].reverse().map((t) => (
        <div key={t.trimestre} className="card">
          <div className="chart-title">
            <h2 style={{ margin: 0 }}>
              {nombreTrim(t.trimestre)} {t.trimestre.slice(0, 4)}
              <span className="muted" style={{ fontWeight: 400 }}> · {t.meses.map((m) => fMesLargo(m)).join(', ')}</span>
            </h2>
            <div className="row">
              <span className={`badge ${t.estado === 'pagado' ? 'ok' : t.estado === 'sin pago en el banco' ? 'bad' : 'warn'}`}>
                {t.estado === 'pagado' ? (t.pagadoFuera && !t.pagadoBanco ? 'pagado (fuera del banco)' : `pagado · ${fEur(t.pagadoBanco)}`) : t.estado === 'en curso' ? 'en curso' : t.estado === 'pendiente' ? `vence el ${fFechaLarga(t.vence)}` : 'sin pago en el banco'}
              </span>
              {t.estado === 'sin pago en el banco' && <button className="btn sm" onClick={() => marcar(t, true)}>Marcar como pagado</button>}
              {t.pagadoFuera && <button className="btn sm ghost" onClick={() => marcar(t, false)}>Desmarcar</button>}
            </div>
          </div>
          <div className="grid g-2" style={{ gap: 24, marginTop: 6 }}>
            <div>
              <div className="section-t"><span>IVA · modelo 303</span></div>
              <div className="tip-r" style={{ padding: '4px 0' }}><span>IVA cobrado en tus facturas</span><span>{fEur(t.repercutido)}</span></div>
              <div className="tip-r" style={{ padding: '4px 0' }}><span>IVA pagado en tus gastos</span><span>−{fEur(t.soportado)}</span></div>
              {t.compensarAnterior < 0 && <div className="tip-r" style={{ padding: '4px 0' }}><span>A compensar de trimestres anteriores</span><span>−{fEur(-t.compensarAnterior)}</span></div>}
              <div className="tip-r" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', marginTop: 4, fontWeight: 650 }}>
                <span style={{ color: 'var(--text)' }}>{t.ivaTrimestre + t.compensarAnterior < 0 ? 'A compensar' : 'A pagar'}</span>
                <span>{t.ivaTrimestre + t.compensarAnterior < 0 ? fEur(-(t.ivaTrimestre + t.compensarAnterior)) : fEur(t.ivaPagar)}</span>
              </div>
            </div>
            <div>
              <div className="section-t"><span>Retenciones IRPF · modelo 111</span></div>
              <div className="tip-r" style={{ padding: '4px 0' }}><span>IRPF retenido a los socios</span><span>{fEur(t.retenciones)}</span></div>
              <div className="kpi-foot">Es la parte que descontáis de sus facturas (p. ej. 7 % de 2.500 € = 175 €): la empresa se la queda, pero hay que ingresarla.</div>
              <div className="tip-r" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', marginTop: 8, fontWeight: 650 }}>
                <span style={{ color: 'var(--text)' }}>A pagar</span><span>{fEur(t.retenciones)}</span>
              </div>
            </div>
          </div>
          <div className="tip-r" style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, fontWeight: 700 }}>
            <span style={{ color: 'var(--text)' }}>Total a Hacienda {t.estado === 'en curso' ? '(acumulado hasta hoy)' : ''}</span><span>{fEur(t.total)}</span>
          </div>
        </div>
      ))}
      {!trims.length && <div className="empty">No hay trimestres de {anio}.</div>}
      <div className="kpi-foot">
        Es una estimación para que no os pille por sorpresa: la declaración oficial la hace vuestra gestoría. El IVA cobrado sale de las facturas de Beel; el pagado y las retenciones, de los movimientos del banco según el IVA e IRPF de cada categoría (revísalos en «Categorías e IVA»).
      </div>
    </div>
  );
}
