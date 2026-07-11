import { app } from 'electron';
import { drizzle } from 'drizzle-orm/tursodatabase/database';
import { migrate } from 'drizzle-orm/tursodatabase/migrator';
import { join } from 'path';

let dbInstance: ReturnType<typeof drizzle> | null = null;

// Lazy on purpose: app.getPath('userData') depends on app.setName() having
// already run. Since ES module imports are always evaluated before any code
// in the importing file, computing this at module load time (a top-level
// const) would grab the path BEFORE main/index.ts gets a chance to set the
// app name, no matter where that call appears in the file.
export function getDb(): ReturnType<typeof drizzle> {
  if (!dbInstance) {
    dbInstance = drizzle(join(app.getPath('userData'), 'Afterplay.db'));
  }
  return dbInstance;
}

// out/main -> out -> project root -> drizzle. Same relative depth in dev and
// in the packaged app (electron-builder includes the folder by default; it's
// plain text read via fs, so it doesn't need asarUnpack).
export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: join(__dirname, '../../drizzle') });
}
