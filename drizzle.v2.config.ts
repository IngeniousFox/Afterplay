import { defineConfig } from 'drizzle-kit';

// Configuración de drizzle-kit para el esquema 2.0 (AFTERPLAY-2.0.md §7),
// separada de la de la 1.x (`drizzle.config.ts`), que sigue intacta.
//
// Solo sirve para GENERAR migraciones (`npm run db:v2:generate`), que no
// necesita conectarse a ninguna base: por eso no lleva `dbCredentials` ni
// apunta a ningún fichero real. La base 2.0 la migra la propia app al abrirla.
//
// Hasta que la 2.0 se publique no hay ninguna base 2.0 instalada, así que
// `drizzle-v2/` debe tener una sola migración inicial: si el esquema cambia
// antes de publicar, se borra y se vuelve a generar.
export default defineConfig({
  out: './drizzle-v2',
  schema: './src/main/db/v2/schema.ts',
  dialect: 'sqlite',
});
