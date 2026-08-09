// Todo lo que el Worker recibe de fuera. Ninguna de estas variables tiene
// valor por defecto a propósito: si falta una, la petición falla cerrado (ver
// tenants.ts y access.ts) en vez de caer en un camino "razonable".
export type Env = {
  // JSON con el mapa email -> credenciales de Turso (§5.1). Es UN secreto de
  // Worker con dos entradas; si algún día sois cinco, esto se muda a KV sin
  // tocar nada más. Forma:
  //   {"alguien@x.com": {"url": "libsql://...", "authToken": "..."}}
  TENANTS?: string;

  // Cloudflare Access (§5.2 regla 4). El dominio del equipo y el AUD de la
  // aplicación protegida; sin los dos, no se valida nada y no se entra.
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // IGDB, vía Twitch. El Worker es el ÚNICO que habla con IGDB (§6.4): estas
  // claves son secretos y meterlas en el bundle de la PWA sería publicarlas.
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;

  // ── Solo desarrollo ──────────────────────────────────────────────────────
  // Estas tres viven ÚNICAMENTE en .dev.vars, que está en el .gitignore y que
  // wrangler no despliega nunca. Ese es justo el mecanismo de seguridad: el
  // camino permisivo no puede existir en producción porque depende de un
  // fichero que no llega allí. No basta con "acordarse" de no ponerlas.
  ENVIRONMENT?: string;
  DEV_EMAIL?: string;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

export const isDevelopment = (env: Env): boolean => env.ENVIRONMENT === 'development';
