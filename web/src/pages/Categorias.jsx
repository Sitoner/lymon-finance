import { useState } from 'react';
import { api } from '../api.js';

const TIPOS_IVA = [0, 4, 10, 21];

export default function Categorias({ cats, recargar, avisar }) {
  const [nueva, setNueva] = useState(null);
  const grupos = [...new Set(cats.map((c) => `${c.tipo}|${c.grupo}`))];

  async function cambiar(c, campos) {
    try { await api.patch(`/api/categorias/${c.id}`, campos); await recargar(); } catch (e) { avisar(e.message, true); }
  }
  async function crear() {
    try {
      await api.post('/api/categorias', nueva);
      setNueva(null);
      await recargar();
      avisar('Categoría creada');
    } catch (e) { avisar(e.message, true); }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Categorías</h1>
          <div className="sub">
            El % de IVA sirve para quitar el IVA de los importes del banco al compararlos con la previsión (que va sin IVA) y para calcular el IVA soportado.
            Los proveedores extranjeros (Google, Meta, la mayoría de SaaS) suelen facturar sin IVA. El IRPF es la retención que se descuenta en las facturas de autónomos (p. ej. honorarios de socios, 7 % o 15 %): se ingresa a Hacienda cada trimestre con el modelo 111. Es el único sitio donde se configuran: en el flujo de caja los movimientos van tal cual, con su IVA dentro.
          </div>
        </div>
        <button className="btn" onClick={() => setNueva(nueva ? null : { tipo: 'Pagos', grupo: 'Generales', subgrupo: '', iva: 21 })}>+ Categoría</button>
      </div>

      {nueva && (
        <div className="card row">
          <select value={`${nueva.tipo}|${nueva.grupo}`} onChange={(e) => { const [tipo, grupo] = e.target.value.split('|'); setNueva({ ...nueva, tipo, grupo }); }}>
            {grupos.map((k) => <option key={k} value={k}>{k.replace('|', ' · ')}</option>)}
          </select>
          <input type="text" placeholder="Nombre (p. ej. Anthropic)" value={nueva.subgrupo} onChange={(e) => setNueva({ ...nueva, subgrupo: e.target.value })} />
          <label className="row" style={{ gap: 6 }}>IVA
            <select value={nueva.iva} onChange={(e) => setNueva({ ...nueva, iva: Number(e.target.value) })}>
              {TIPOS_IVA.map((t) => <option key={t} value={t}>{t} %</option>)}
            </select>
          </label>
          <button className="btn pri" disabled={!nueva.subgrupo.trim()} onClick={crear}>Crear</button>
        </div>
      )}

      <div className="tbl-wrap">
        <table className="pivot">
          <thead><tr><th>Categoría</th><th className="n">Movimientos</th><th className="n">IVA incluido</th><th className="n" title="Retención de IRPF que se descuenta en la factura (autónomos). Se ingresa a Hacienda con el modelo 111.">IRPF retenido</th></tr></thead>
          <tbody>
            {grupos.map((g) => {
              const [tipo, grupo] = g.split('|');
              return [
                <tr key={g} className="grp"><td colSpan={4}>{tipo} · {grupo}</td></tr>,
                ...cats.filter((c) => c.tipo === tipo && c.grupo === grupo).map((c) => (
                  <tr key={c.id} className="sub">
                    <td>{c.subgrupo}</td>
                    <td className="n muted">{c.usos || '–'}</td>
                    <td className="n">
                      <select value={c.iva ?? 0} onChange={(e) => cambiar(c, { iva: Number(e.target.value) })}>
                        {[...new Set([...TIPOS_IVA, c.iva ?? 0])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t} %</option>)}
                      </select>
                    </td>
                    <td className="n">
                      {c.tipo === 'Pagos' ? (
                        <select value={c.irpf ?? 0} onChange={(e) => cambiar(c, { irpf: Number(e.target.value) })}>
                          {[...new Set([0, 7, 15, 19, c.irpf ?? 0])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t} %</option>)}
                        </select>
                      ) : <span className="muted">–</span>}
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
