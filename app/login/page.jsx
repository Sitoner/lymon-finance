const ERRORES = {
  cuenta: 'Esa cuenta de Google no tiene acceso a Lymon Finanzas.',
  cancelado: 'Se canceló el acceso con Google.',
  caducado: 'El intento de acceso ha caducado. Vuelve a probar.',
  google: 'Google no ha podido confirmar la cuenta. Vuelve a probar.',
  config: 'Falta configurar el login con Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y LYMON_SECRET).',
};

export default async function Login({ searchParams }) {
  const { error } = await searchParams;
  return (
    <div className="login">
      <div className="card login-card">
        <div className="brand"><span className="brand-dot" />Lymon Finanzas</div>
        {error && <div className="alert bad">{ERRORES[error] || 'No se ha podido entrar.'}</div>}
        <a className="btn pri" href="/api/auth/google">Entrar con Google</a>
      </div>
    </div>
  );
}
