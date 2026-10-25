// Sesión firmada en una cookie (JWT HS256). Se usa en proxy.js y en las rutas de la API.
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE = 'lymon_sesion';
export const DURACION = 30 * 24 * 3600; // 30 días

// Única cuenta de Google con acceso
export const emailPermitido = () => (process.env.LYMON_EMAIL || 'apastor@lymon.es').toLowerCase();

// Solo en `next dev`: LYMON_DEV_SIN_LOGIN=1 entra sin Google (para probar en local). En Vercel no tiene efecto.
export const sinLogin = () => process.env.NODE_ENV === 'development' && process.env.LYMON_DEV_SIN_LOGIN === '1';

function clave() {
  const s = process.env.LYMON_SECRET;
  return s && s.length >= 32 ? new TextEncoder().encode(s) : null;
}

export async function crearSesion(email) {
  const k = clave();
  if (!k) throw new Error('Falta configurar LYMON_SECRET (mínimo 32 caracteres).');
  return new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${DURACION}s`).sign(k);
}

// Devuelve el email de la sesión, o null si no hay sesión válida
export async function verificarSesion(token) {
  if (sinLogin()) return emailPermitido();
  const k = clave();
  if (!k || !token) return null;
  try {
    const { payload } = await jwtVerify(token, k, { algorithms: ['HS256'] });
    return payload.email === emailPermitido() ? payload.email : null;
  } catch {
    return null;
  }
}

export const opcionesCookie = (maxAge = DURACION) => ({
  httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge,
});
