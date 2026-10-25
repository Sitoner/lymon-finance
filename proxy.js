// Todo pide sesión salvo la pantalla de entrada y el login con Google
import { NextResponse } from 'next/server';
import { COOKIE, verificarSesion } from './server/sesion.js';

export async function proxy(request) {
  if (await verificarSesion(request.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'La sesión ha caducado. Vuelve a entrar.' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!login|api/auth/|_next/static|_next/image|favicon.ico).*)'],
};
