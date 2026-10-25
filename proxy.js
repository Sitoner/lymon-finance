// Todo pide sesión salvo la pantalla de entrada, el login con Google y los archivos de marca (logo, iconos)
import { NextResponse } from 'next/server';
import { COOKIE, verificarSesion } from './server/sesion.js';

export async function proxy(request) {
  if (await verificarSesion(request.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'La sesión ha caducado. Vuelve a entrar.' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!login|api/auth/|marca/|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
};
