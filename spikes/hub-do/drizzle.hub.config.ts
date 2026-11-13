import { defineConfig } from 'drizzle-kit';

// Migraciones del hub: esquema compartido + tablas solo del hub.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'durable-sqlite',
  schema: './src/hub-schema.ts',
  out: './drizzle/hub',
});
