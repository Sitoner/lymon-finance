import { Component, useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Panel from './pages/Panel.jsx';
import Caja from './pages/Caja.jsx';
import Ingresos from './pages/Ingresos.jsx';
import Prevision from './pages/Prevision.jsx';
import Movimientos from './pages/Movimientos.jsx';
import Facturas from './pages/Facturas.jsx';
import Categorias from './pages/Categorias.jsx';
import Impuestos from './pages/Impuestos.jsx';
import { Icono } from './iconos.jsx';

// [id, nombre, componente, sección del menú]
const PAGINAS = [
  ['panel', 'Panel', Panel, 'Análisis'],
  ['caja', 'Flujo de caja', Caja, 'Análisis'],
  ['ingresos', 'Ingresos y MRR', Ingresos, 'Análisis'],
  ['prevision', 'Previsión', Prevision, 'Análisis'],
  ['impuestos', 'Impuestos', Impuestos, 'Análisis'],
  ['movimientos', 'Movimientos', Movimientos, 'Datos'],
  ['facturas', 'Facturas', Facturas, 'Datos'],
  ['categorias', 'Categorías e IVA', Categorias, 'Datos'],
];
const SECCIONES = [...new Set(PAGINAS.map((p) => p[3]))];

export default function App() {
  const [pagina, setPagina] = useState(() => location.hash.slice(1).split('?')[0] || 'panel');
  const [datos, setDatos] = useState(null);
  const [cats, setCats] = useState([]);
  const [toast, setToast] = useState(null);
  const [filtro, setFiltro] = useState({}); // filtros que una página pasa a otra (p. ej. ver movimientos de un mes)
  const [menu, setMenu] = useState(false); // menú abierto en móvil
  const [anioElegido, setAnioElegido] = useState(() => { try { return Number(localStorage.getItem('anio')) || null; } catch { return null; } });

  // Años con datos (movimientos, facturas o previsión)
  const anios = datos ? [...new Set([
    ...datos.cashflow.meses, ...datos.ingresos.meses, ...(datos.prevision?.filas || []).map((x) => x.mes),
  ].map((m) => Number(m.slice(0, 4))))].sort() : [];
  const anioActual = new Date().getFullYear();
  const anio = anios.includes(anioElegido) ? anioElegido : anios.includes(anioActual) ? anioActual : anios[anios.length - 1];
  const cambiarAnio = (a) => { setAnioElegido(a); try { localStorage.setItem('anio', String(a)); } catch { /* sin almacenamiento */ } };

  const recargar = useCallback(async () => {
    const [r, c] = await Promise.all([api.get('/api/resumen'), api.get('/api/categorias')]);
    setDatos(r);
    setCats(c);
  }, []);

  useEffect(() => { recargar().catch((e) => avisar(e.message, true)); }, [recargar]);
  useEffect(() => {
    const f = () => setPagina(location.hash.slice(1).split('?')[0] || 'panel');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  function avisar(texto, error = false) {
    setToast({ texto, error });
    setTimeout(() => setToast(null), error ? 6000 : 3000);
  }
  async function salir() {
    await api.post('/api/logout').catch(() => {});
    location.href = '/login';
  }
  function ir(p, f = {}) {
    setFiltro(f);
    location.hash = p;
    setPagina(p);
    setMenu(false);
    window.scrollTo(0, 0);
  }

  const actual = PAGINAS.find((p) => p[0] === pagina) || PAGINAS[0];
  const Actual = actual[2];
  const usuario = datos?.usuario || '';
  return (
    <div className={`app ${menu ? 'menu-abierto' : ''}`}>
      <header className="topbar">
        <button className="topbar-btn" onClick={() => setMenu(true)} aria-label="Abrir menú"><Icono nombre="menu" size={22} /></button>
        <img src="/marca/lymon-logo.webp" alt="Lymon" className="topbar-logo" />
        <span className="topbar-t">{actual[1]}</span>
      </header>
      <div className="velo" onClick={() => setMenu(false)} />
      <nav className="side">
        <div className="side-head">
          <img src="/marca/lymon-logo.webp" alt="Lymon" className="logo" />
          <span className="producto">Finanzas</span>
          <button className="side-cerrar" onClick={() => setMenu(false)} aria-label="Cerrar menú"><Icono nombre="cerrar" size={20} /></button>
        </div>
        {anios.length > 0 && (
          <div className="anio">
            <button disabled={anios.indexOf(anio) <= 0} onClick={() => cambiarAnio(anios[anios.indexOf(anio) - 1])} title="Año anterior">‹</button>
            <b>{anio}</b>
            <button disabled={anios.indexOf(anio) >= anios.length - 1} onClick={() => cambiarAnio(anios[anios.indexOf(anio) + 1])} title="Año siguiente">›</button>
          </div>
        )}
        <div className="side-nav">
          {SECCIONES.map((s) => (
            <div key={s} className="side-sec">
              <div className="side-sec-t">{s}</div>
              {PAGINAS.filter((p) => p[3] === s).map(([id, nombre]) => (
                <button key={id} className={`nav ${pagina === id ? 'on' : ''}`} onClick={() => ir(id)} aria-current={pagina === id ? 'page' : undefined}>
                  <Icono nombre={id} />
                  <span className="nav-t">{nombre}</span>
                  {id === 'movimientos' && datos?.pendientes > 0 && <span className="nav-badge" title="Sin categoría">{datos.pendientes}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="side-foot">
          <a className="nav" href="/api/exportar"><Icono nombre="descargar" /><span className="nav-t">Copia en Excel</span></a>
          {datos?.ultimaImportacion && <span className="side-nota">Última importación: {datos.ultimaImportacion.fecha.slice(0, 16)}</span>}
          <div className="yo">
            <span className="avatar">{usuario.slice(0, 2).toUpperCase() || '··'}</span>
            <span className="yo-mail" title={usuario}>{usuario}</span>
            <button className="yo-salir" onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión"><Icono nombre="salir" /></button>
          </div>
        </div>
      </nav>
      <main className="main">
        {datos ? (
          <ProtegerPagina key={pagina + anio}>
            <Actual key={anio} anio={anio} datos={datos} cats={cats} recargar={recargar} avisar={avisar} ir={ir} filtro={filtro} />
          </ProtegerPagina>
        ) : (
          <div className="empty">Cargando…</div>
        )}
      </main>
      {toast && <div className={`toast ${toast.error ? 'err' : ''}`}>{toast.texto}</div>}
    </div>
  );
}

// Si una página falla al pintarse, se muestra un aviso con el error en vez de la pantalla en blanco/negro
class ProtegerPagina extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('Error en la página:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="alert bad" style={{ marginTop: 20 }}>
        <div>
          <b>Algo ha fallado al mostrar esta página</b>
          Suele pasar si la app se actualizó mientras la tenías abierta: recarga la página.
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{String(this.state.error?.message || this.state.error)}</div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => location.reload()}>Recargar</button>
        </div>
      </div>
    );
  }
}
