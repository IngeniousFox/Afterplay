import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { vacuumInto } from './backupCore';

const MAX_BACKUPS = 5;
const BACKUP_PREFIX = 'Afterplay-';
const BACKUP_SUFFIX = '.db';

const getBackupsDir = (): string => join(app.getPath('userData'), 'backups');

// YYYY-MM-DD como nombre de fichero: el propio nombre hace de "ya se hizo
// hoy" — VACUUM INTO exige que el destino no exista, así que si ya está no
// hay nada que decidir, por muchas veces que se abra la app en el día.
const todaysBackupPath = (): string => {
  const today = new Date().toISOString().slice(0, 10);
  return join(getBackupsDir(), `${BACKUP_PREFIX}${today}${BACKUP_SUFFIX}`);
};

const listBackups = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
        .sort()
    : [];

// Una copia física del .db local al día, sin tocar Turso para nada — para
// el "se me ha ido la pinza con algo y quiero volver a ayer/anteayer" sin
// depender de tener red ni de la ventana de retención de Turso. Corre justo
// después de runMigrations() en el arranque, con el mismo criterio que el
// seed: si falla, se avisa por consola y la app sigue igual — no es motivo
// para no arrancar.
export const runDailyBackup = async (): Promise<void> => {
  const dir = getBackupsDir();
  mkdirSync(dir, { recursive: true });

  const filePath = todaysBackupPath();
  if (existsSync(filePath)) return;

  try {
    await vacuumInto(filePath);
    console.log(`[backup] copia diaria creada: ${filePath}`);
  } catch (error) {
    console.warn('[backup] no se pudo crear la copia diaria:', error);
    return;
  }

  const backups = listBackups(dir);
  const toDelete = backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS));
  for (const name of toDelete) {
    try {
      unlinkSync(join(dir, name));
    } catch (error) {
      console.warn(`[backup] no se pudo borrar la copia antigua ${name}:`, error);
    }
  }
};
