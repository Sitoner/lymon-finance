import { cookies } from 'next/headers';
import { manejar } from '../../../server/api.js';
import { COOKIE, verificarSesion } from '../../../server/sesion.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// proxy.js ya exige sesión; se vuelve a comprobar aquí por si la ruta se sirve sin pasar por él
async function atender(request, { params }) {
  if (!(await verificarSesion((await cookies()).get(COOKIE)?.value))) {
    return Response.json({ error: 'La sesión ha caducado. Vuelve a entrar.' }, { status: 401 });
  }
  return manejar(request, (await params).ruta);
}

export { atender as GET, atender as POST, atender as PUT, atender as PATCH, atender as DELETE };
