# Afterplay en el móvil — cómo arrancarlo

La web son **dos mitades** que viven en este repo:

- `worker/` — la API de solo lectura sobre Turso, y en producción también quien
  sirve la PWA (un solo origen, cero CORS).
- `web/` — la PWA en sí.

Diseño y decisiones: `REMOTO.md`, en la carpeta de documentos del proyecto.

---

## Verlo (lo normal)

Una sola orden. El Worker sirve la app ya construida **y** la API, que es
exactamente lo que se despliega:

```bash
cd worker
npm run dev
```

→ http://localhost:8787

Si has tocado algo de `web/src`, reconstruye antes (el Worker sirve `web/dist`,
no las fuentes):

```bash
cd web && npm run build
```

## Tocar la interfaz (con recarga en caliente)

Dos terminales. Vite sirve la PWA con HMR y manda `/api` al Worker de al lado,
así que el navegador sigue viendo un solo origen igual que en producción.

```bash
cd worker && npm run dev
```

```bash
cd web && npm run dev
```

→ http://localhost:5173

## Verlo en el móvil de verdad

Los dos servidores escuchan solo en localhost por defecto. Para que el móvil
llegue, hay que abrirlos a la red local (y estar en la misma wifi):

```bash
cd worker && npm run dev:lan
```

→ `http://<la-ip-de-tu-pc>:8787` desde el móvil.

La IP sale con `ipconfig`. Ojo: el firewall de Windows suele preguntar la
primera vez, y hay que decirle que sí para redes privadas.

---

## Antes de arrancar por primera vez

```bash
cd worker && npm install
cd ../web && npm install && npm run build
```

Y hace falta `worker/.dev.vars` con las credenciales de la base de **pruebas**.
Ese fichero está en el `.gitignore` y wrangler no lo despliega nunca: que
`ENVIRONMENT=development` viva solo ahí es lo que impide que el modo permisivo
de `access.ts` exista en producción.

```
ENVIRONMENT=development
DEV_EMAIL=tu@email.com
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

`DEV_EMAIL` tiene que coincidir con el inquilino que resuelve `tenants.ts`, o
la API responde 403 — ni en local se entra sin decir quién eres.

## Comprobar que va

```bash
curl http://localhost:8787/api/health
```

Devuelve el **nombre** de la base conectada (nunca el token). Si ahí pone
`afterplay-test-...`, estás donde tienes que estar.
