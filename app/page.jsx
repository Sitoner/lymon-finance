'use client';
import dynamic from 'next/dynamic';

// La app usa location.hash y localStorage al arrancar: se pinta solo en el navegador
const App = dynamic(() => import('../web/src/App.jsx'), { ssr: false, loading: () => <div className="empty">Cargando…</div> });

export default function Inicio() {
  return <App />;
}
