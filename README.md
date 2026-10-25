# Lymon Finanzas

App para seguir la caja, los ingresos (MRR) y la previsión de Lymon. Sustituye al Excel «PLANTILLA LANZADERA control de caja» y a la «Previsión de Caja y Gastos».

Next.js + Postgres, desplegada en Vercel. Solo entra **apastor@lymon.es**, con su cuenta de Google.

## Cierre de mes

1. **Importar Revolut** → sube el CSV de Revolut del mes.
2. **Movimientos** → categoriza lo que no se haya reconocido solo.
3. **Importar Beel** → sube `facturas_items_….xlsx` de Beel.
4. **Panel / Flujo de caja** → comprueba que el saldo coincide con Revolut (✓) y compáralo con la **Previsión**.

## Puesta en marcha en Vercel (una sola vez)

1. **Repositorio privado en GitHub.** `seed/` tiene datos financieros reales: el repositorio tiene que ser privado.
2. **Vercel › Add New › Project** → importa el repositorio. No hace falta cambiar nada del build.
3. **Base de datos:** en el proyecto, **Storage › Create Database › Neon (Postgres)**, región **Frankfurt (eu-central-1)**. Vercel añade solo la variable `DATABASE_URL`.
4. **Google:** en [Google Cloud Console](https://console.cloud.google.com/) › APIs y servicios:
   - **Pantalla de consentimiento de OAuth**: tipo **Interno** (si lymon.es es Google Workspace) o Externo.
   - **Credenciales › Crear credenciales › ID de cliente de OAuth › Aplicación web**, con estos **URI de redireccionamiento autorizados**:
     - `https://TU-DOMINIO.vercel.app/api/auth/google/callback` (y el de tu dominio propio si le pones uno)
     - `http://localhost:3000/api/auth/google/callback` (para local)
5. **Vercel › Settings › Environment Variables** (ver `.env.example`):
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: los del paso anterior.
   - `LYMON_SECRET`: clave aleatoria para firmar la sesión. Genera una con
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - `LYMON_EMAIL`: `apastor@lymon.es`
6. **Pasar los datos:** copia la `DATABASE_URL` de Neon (Vercel › Storage › tu base › `.env.local`) en tu `.env.local` y ejecuta `npm run migrar`. Copia todo `data/lymon.db` (la versión local antigua) a Postgres y comprueba que cuadra.
7. **Redeploy** en Vercel para que coja las variables. Entra en la URL con Google.

## Trabajar en local

- `npm install` y `npm run dev` → http://localhost:3000.
- Sin `DATABASE_URL`, usa un Postgres embebido en `data/pglite` (`npm run migrar` lo llena con `data/lymon.db`). Con `DATABASE_URL` en `.env.local` trabajas contra la base de Vercel: ojo, son los datos reales.
- `LYMON_DEV_SIN_LOGIN=1` en `.env.local` entra sin Google (solo en `npm run dev`; en Vercel no tiene efecto).

## Datos

- Todo está en Postgres (Neon). Copia de seguridad: «Descargar copia en Excel» en la app; Neon además guarda historial para restaurar.
- `seed/` contiene los datos históricos sacados del Excel (enero–agosto 2026). `npm run seed -- --force` borra la base de datos y la vuelve a cargar desde ahí.
- `npm run check` comprueba que los cálculos coinciden con las cifras del Excel original (en un Postgres temporal en memoria).
