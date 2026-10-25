import { NextResponse } from 'next/server';
import { COOKIE_FLUJO, configurado, iniciar } from '../../../../server/google.js';
import { emailPermitido, opcionesCookie } from '../../../../server/sesion.js';

export const dynamic = 'force-dynamic';

// Manda a la pantalla de Google; el state y el verificador PKCE quedan en una cookie de 10 minutos
export async function GET(request) {
  if (!configurado()) return NextResponse.redirect(new URL('/login?error=config', request.url));
  const { url, flujo } = iniciar(request, emailPermitido());
  const res = NextResponse.redirect(url);
  res.cookies.set(COOKIE_FLUJO, flujo, opcionesCookie(600));
  return res;
}
