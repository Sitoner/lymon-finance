// Login con Google (OpenID Connect, flujo «authorization code» con PKCE)
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const certificados = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const COOKIE_FLUJO = 'lymon_oauth';

export function configurado() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.LYMON_SECRET);
}

// URL de vuelta: la del propio despliegue (http://localhost:3000 en local, el dominio de Vercel en producción)
export const urlVuelta = (request) => new URL('/api/auth/google/callback', request.url).toString();

export function iniciar(request, email) {
  const state = randomBytes(24).toString('base64url');
  const verificador = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: urlVuelta(request),
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: createHash('sha256').update(verificador).digest('base64url'),
    code_challenge_method: 'S256',
    login_hint: email,
    hd: email.split('@')[1],
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${params}`, flujo: `${state}.${verificador}` };
}

// Cambia el código por el id_token, lo verifica con las claves de Google y devuelve el email (verificado)
export async function completar(request, code, verificador) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: urlVuelta(request),
      grant_type: 'authorization_code',
      code_verifier: verificador,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(data.error_description || data.error || 'Google no ha devuelto la identidad');
  const { payload } = await jwtVerify(data.id_token, certificados, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  if (!payload.email || payload.email_verified !== true) throw new Error('La cuenta de Google no tiene el email verificado');
  return String(payload.email).toLowerCase();
}
