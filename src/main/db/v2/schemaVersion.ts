// Versión del esquema 2.0 que escribe este build (§8.7). Sube con cada
// migración que afecte a tablas sincronizadas. Vive aparte de appDb.ts (que
// importa Electron) para que la usen también el hub y los tests.
export const APP_SCHEMA_VERSION = 1;
