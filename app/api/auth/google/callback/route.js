import { NextResponse } from 'next/server';
import { COOKIE_FLUJO, completar } from '../../../../../server/google.js';
import { COOKIE, crearSesion, emailPermitido, opcionesCookie } from '../../../../../server/sesion.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const [state, verificador] = (request.cookies.get(COOKIE_FLUJO)?.value || '').split('.');
  const ir = (destino) => {
    const res = NextResponse.redirect(new URL(destino, request.url));
    res.cookies.set(COOKIE_FLUJO, '', opcionesCookie(0));
    return res;
  };

  if (url.searchParams.get('error')) return ir('/login?error=cancelado');
  const code = url.searchParams.get('code');
  if (!code || !state || url.searchParams.get('state') !== state) return ir('/login?error=caducado');
  let email;
  try {
    email = await completar(request, code, verificador);
  } catch (e) {
    console.error('Login con Google:', e);
    return ir('/login?error=google');
  }
  if (email !== emailPermitido()) return ir('/login?error=cuenta');
  const res = ir('/');
  res.cookies.set(COOKIE, await crearSesion(email), opcionesCookie());
  return res;
}
