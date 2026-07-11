import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { mkdirSync } from 'fs';
import { join } from 'path';

// Mirrors Electron's app.getPath('userData') (main/index.ts sets app.setName
// to 'Afterplay'). This is dev-only tooling run from a plain terminal, not
// inside Electron, so it can't call app.getPath() itself — %APPDATA% is the
// Windows equivalent. Not cross-platform, but neither is the developer's
// machine right now; the shipped app itself resolves this correctly per-OS.
const userDataPath = join(process.env.APPDATA!, 'Afterplay');
mkdirSync(userDataPath, { recursive: true });

export default defineConfig({
  out: './drizzle',
  schema: './src/main/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(userDataPath, 'Afterplay.db'),
  },
});
