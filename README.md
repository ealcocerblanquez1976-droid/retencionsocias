# MIA Sant Cugat · Supabase + Vercel

La app de seguimiento de socias MIA de Curves Sant Cugat, fuera de Claude.

- **Vercel** sirve la web (`public/`).
- **Supabase** guarda los datos (tabla `docs`) y gestiona el login del equipo.
- `public/shim.js` traduce la base de datos que usaba la app en Claude a Supabase, así la app es la misma.

## Puesta en marcha (una sola vez)

### 1. Supabase
1. Crea un proyecto en <https://supabase.com> (región **EU West / Frankfurt o Irlanda**).
2. **SQL Editor** → pega `supabase/schema.sql` → **Run**.
3. **Authentication → Providers → Email**: desactiva *Allow new users to sign up* (solo entra quien des de alta tú).
4. **Authentication → Users → Add user** para ti y cada entrenadora (email + contraseña; marca *Auto confirm*).
5. **Project Settings → API**: copia *Project URL* y la clave *anon public*. (La *service_role* NO se usa nunca aquí.)

### 2. GitHub
Sube esta carpeta a un repositorio **privado** (o deja que Claude la suba si conectas GitHub).

### 3. Vercel
1. *Add New → Project* → importa el repo.
2. *Environment Variables*:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = clave anon public
3. *Deploy*. El build (`node scripts/build-config.mjs`) genera `config.js` con esas dos variables.
4. En Supabase → **Authentication → URL Configuration** pon la URL de Vercel como *Site URL*.

### 4. Pasar los datos (el día del cambio)
1. En la app MIA de Claude, como **Eva**: pestaña *Informe* → **Exportar datos** → guarda el `.json`.
2. En la web de Vercel abre `/importar`, entra, sube el `.json` → **Importar**.
3. No subas nunca ese `.json` a GitHub (lleva datos de socias; `.gitignore` ya lo excluye).

## Qué cambia respecto a la versión de Claude
- Hay que entrar con email y contraseña (botón *Salir* abajo a la derecha).
- Las **sugerencias de respuesta y traducciones automáticas con Claude** no están: los mensajes base y el resto funcionan igual.
- La sincronización con OSE y WhatsApp (que hace Claude cada hora) debe apuntar a Supabase el día del cambio.

## Estructura
```
public/index.html      app (misma que en Claude) + carga de shim
public/shim.js         API tipo Firestore → Supabase (+ login y tiempo real)
public/importar.html   importación única del export
public/vendor/         supabase-js 2 (MIT)
scripts/build-config.mjs  genera public/config.js desde las variables de Vercel
supabase/schema.sql    tabla, seguridad (RLS) y tiempo real
```
