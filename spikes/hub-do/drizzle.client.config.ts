import { defineConfig } from 'drizzle-kit';

// Migraciones del "escritorio": SOLO el esquema compartido, driver libsql.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle/client',
});
