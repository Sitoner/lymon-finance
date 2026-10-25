import { useRef, useState } from 'react';
import { api } from '../api.js';
import { SelectorCategoria } from '../ui.jsx';
import { CLASES } from './Facturas.jsx';
import { fEur2, fFecha } from '../format.js';

// tipo: 'revolut' (desde Flujo de caja) o 'beel' (desde Ingresos y MRR); onCerrar vuelve a la página
export default function Importar({ cats, recargar, avisar, ir, tipo: tipoFijo, onCerrar }) {
  const [prev, setPrev] = useState(null); // { tipo, archivos, filas }
  const [verDup, setVerDup] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function subir(tipo, files) {
    if (!files.length) return;
    setCargando(true);
    try {
      let filas = [];
      const saldosMes = {};
      const vistos = new Set();
      for (const file of files) {
        const r = await api.subir(`/api/importar/${tipo}/previsualizar`, file);
        for (const [m, x] of Object.entries(r.saldosMes || {})) if (!saldosMes[m] || x.fecha >= saldosMes[m].fecha) saldosMes[m] = x;
        for (const f of r.filas) {
          const k = f.ext_id || `${f.numero}|${f.concepto}|${f.base}`;
          if (vistos.has(k)) continue; // el mismo movimiento en dos archivos
          vistos.add(k);
          filas.push(f);
        }
      }
      filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
      setPrev({ tipo, archivos: files.map((f) => f.name), filas, saldosMes });
      setVerDup(false);
    } catch (e) { avisar(e.message, true); }
    setCargando(false);
  }

  async function confirmar() {
    setCargando(true);
    try {
      const r = await api.post(`/api/importar/${prev.tipo}/confirmar`, { filas: prev.filas, archivo: prev.archivos.join(', '), saldosMes: prev.saldosMes });
      avisar(`Importados ${r.nuevos} ${prev.tipo === 'revolut' ? 'movimientos' : 'líneas de factura'} (${r.duplicados} ya estaban)`);
      const tipo = prev.tipo;
      setPrev(null);
      await recargar();
      if (tipo === 'revolut' && prev.filas.some((f) => !f.duplicado && !f.tipo)) ir('movimientos', { pendientes: true });
      else onCerrar?.();
    } catch (e) { avisar(e.message, true); }
    setCargando(false);
  }

  const actualizar = (i, cambios) => setPrev((p) => ({ ...p, filas: p.filas.map((f, k) => (k === i ? { ...f, ...cambios } : f)) }));

  if (prev) {
    const nuevas = prev.filas.map((f, i) => ({ ...f, _i: i })).filter((f) => !f.duplicado);
    const dups = prev.filas.filter((f) => f.duplicado);
    const sinCat = nuevas.filter((f) => prev.tipo === 'revolut' && !f.tipo).length;
    const ultimoSaldo = [...prev.filas].reverse().find((f) => f.saldo_banco !== null && f.saldo_banco !== undefined);
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Revisar importación</h1>
            <div className="sub">{prev.archivos.join(', ')}</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setPrev(null)}>Cancelar</button>
            <button className="btn pri" disabled={!nuevas.length || cargando} onClick={confirmar}>Importar {nuevas.length} {prev.tipo === 'revolut' ? 'movimientos' : 'líneas'}</button>
          </div>
        </div>
        <div className="row">
          <span className="badge ok">{nuevas.length} nuevas</span>
          <span className="badge">{dups.length} ya estaban (se ignoran)</span>
          {sinCat > 0 && <span className="badge warn">{sinCat} sin categoría: puedes asignarlas ahora o después</span>}
          {ultimoSaldo && <span className="muted">Saldo final según Revolut: <b>{fEur2(ultimoSaldo.saldo_banco)}</b> el {fFecha(ultimoSaldo.fecha)}</span>}
        </div>
        {prev.tipo === 'revolut' && <div className="muted">Las categorías se sugieren a partir de movimientos anteriores con la misma descripción.</div>}
        {prev.tipo === 'beel' && <div className="muted">El tipo de ingreso se deduce del concepto: «Puesta en marcha» → no recurrente; «Anticipo / monedero» → no cuenta; el resto → recurrente mensual.</div>}

        <div className="tbl-wrap">
          <table>
            <thead>
              {prev.tipo === 'revolut'
                ? <tr><th>Fecha</th><th>Descripción</th><th className="n">Importe</th><th>Categoría</th></tr>
                : <tr><th>Fecha</th><th>Nº</th><th>Cliente</th><th>Concepto</th><th className="n">Base</th><th>Tipo de ingreso</th></tr>}
            </thead>
            <tbody>
              {nuevas.map((f) => prev.tipo === 'revolut' ? (
                <tr key={f._i}>
                  <td>{fFecha(f.fecha)}</td>
                  <td style={{ whiteSpace: 'normal' }}>{f.descripcion}{f.referencia && <div className="muted" style={{ fontSize: 12 }}>{f.referencia}</div>}</td>
                  <td className={`n ${f.importe < 0 ? 'neg' : ''}`}>{fEur2(f.importe)}</td>
                  <td><SelectorCategoria cats={cats} valor={f} onChange={(c) => actualizar(f._i, c)} /></td>
                </tr>
              ) : (
                <tr key={f._i}>
                  <td>{fFecha(f.fecha)}</td>
                  <td>{f.numero}</td>
                  <td>{f.cliente}</td>
                  <td style={{ whiteSpace: 'normal', fontSize: 13 }}>{f.concepto}</td>
                  <td className={`n ${f.base < 0 ? 'neg' : ''}`}>{fEur2(f.base)}</td>
                  <td>
                    <select className={f.clase === 'excluida' ? 'cat vacio' : 'cat'} value={f.clase} onChange={(e) => actualizar(f._i, { clase: e.target.value })}>
                      {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!nuevas.length && <div className="empty">Todo lo de este archivo ya estaba importado.</div>}
        </div>
        {dups.length > 0 && (
          <div>
            <button className="btn sm" onClick={() => setVerDup(!verDup)}>{verDup ? 'Ocultar' : 'Ver'} los {dups.length} que ya estaban</button>
            {verDup && (
              <div className="tbl-wrap" style={{ marginTop: 10 }}>
                <table>
                  <tbody>
                    {dups.map((f, i) => (
                      <tr key={i} className="muted">
                        <td>{fFecha(f.fecha)}</td>
                        <td>{f.descripcion || `${f.numero} · ${f.cliente}`}</td>
                        <td className="n">{fEur2(f.importe ?? f.base)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{tipoFijo === 'beel' ? 'Importar facturas de Beel' : tipoFijo === 'revolut' ? 'Importar extracto de Revolut' : 'Importar mes'}</h1>
          <div className="sub">Sube el archivo tal cual sale {tipoFijo === 'beel' ? 'de Beel' : tipoFijo === 'revolut' ? 'de Revolut' : 'de Revolut y Beel'}. Lo que ya esté importado se detecta y se ignora, así que no pasa nada si un archivo se solapa con otro.</div>
        </div>
        {onCerrar && <button className="btn" onClick={onCerrar}>← Volver</button>}
      </div>
      <div className={tipoFijo ? 'stack' : 'grid g-2'}>
        {tipoFijo !== 'beel' && <Zona titulo="Extracto de Revolut (.csv)" ayuda="Revolut Business › Extractos › Excel/CSV. Puedes subir varios a la vez (por ejemplo, el del mes o el de todo el año)." aceptar=".csv" multiple onArchivos={(f) => subir('revolut', f)} cargando={cargando} />}
        {tipoFijo !== 'revolut' && <Zona titulo="Facturas de Beel (.xlsx)" ayuda="Beel › Facturas › Exportar ítems (facturas_items_….xlsx)" aceptar=".xlsx,.xls,.csv" onArchivos={(f) => subir('beel', f)} cargando={cargando} />}
      </div>
      {!tipoFijo && <div className="card">
        <h2>Cierre de mes, paso a paso</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>Descarga de Revolut el extracto CSV del mes y súbelo aquí.</li>
          <li>Categoriza los movimientos nuevos que no se hayan reconocido solos.</li>
          <li>Exporta de Beel los ítems de factura del mes y súbelos. Revisa que las puestas en marcha estén como «No recurrente».</li>
          <li>Comprueba en el Panel que el saldo coincide con Revolut (✓ en Flujo de caja) y compara con la previsión.</li>
        </ol>
      </div>}
    </div>
  );
}

function Zona({ titulo, ayuda, aceptar, multiple, onArchivos, cargando }) {
  const ref = useRef();
  const [over, setOver] = useState(false);
  return (
    <div className={`drop ${over ? 'over' : ''}`} onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onArchivos([...e.dataTransfer.files]); }}>
      <b>{cargando ? 'Leyendo…' : titulo}</b>
      Arrastra el archivo aquí o haz clic para elegirlo
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{ayuda}</div>
      <input ref={ref} type="file" accept={aceptar} multiple={multiple} hidden onChange={(e) => { onArchivos([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}
