# Afterplay en el móvil — cómo arrancarlo

La PWA vive en `web/`. Su API y, en producción, quien la sirve (un solo origen,
cero CORS) es el Worker del hub, en `hub/worker/`. La web móvil 1.x (`worker/`,
sobre Turso) salió de la rama `v2`: sigue en `main` mientras viva la 1.8.

Diseño y decisiones: `docs/AFTERPLAY-2.0.md`.

Antes de arrancar por primera vez: `npm install` en `web/` y en `hub/worker/`
(trae `wrangler`), y `npm run build` en `web/` (el hub sirve `web/dist`).

---

## Contra el hub 2.0 (fase 5)

La PWA habla con el hub en `/api/v2` (`hub/worker`), que en producción también la
sirve (`assets` en `hub/worker/wrangler.jsonc`, construida con `npm run build`).

- `npm run dev` (en `web/`): `/api` va al `wrangler dev` del hub de al lado
  (`hub/worker`, puerto 8787, con `ENVIRONMENT=development` y `DEV_EMAIL` en su
  `.dev.vars`).
- `npm run dev:pwa:hub` (en la raíz): `/api` va al hub de DESARROLLO desplegado
  (`afterplay-dev-hub`) como anfitrión, sin Access. Vite lee el token de
  `hub/worker/.dev.vars.admin-token` (`HUB_ADMIN_TOKEN=...`, el mismo que usa
  `npm run hub:dev`) y lo pone en la cabecera al reenviar; el navegador nunca lo
  ve. Abre http://localhost:5173.

Para desplegar el hub de DESARROLLO: `npm run deploy:dev` en `hub/worker/`.
