import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { vacuumInto } from './backupCore';
import { removeSidecars, sweepStraySidecars } from './sidecars';

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
// después de runMigrations() en el arranque, con el criterio de todo lo
// accesorio del arranque: si falla, se avisa por consola y la app sigue
// igual — no es motivo para no arrancar.
export const runDailyBackup = async (): Promise<void> => {
  const dir = getBackupsDir();
  mkdirSync(dir, { recursive: true });

  // Antes del "¿ya está la de hoy?": la limpieza tiene que correr aunque hoy
  // no toque copia, o el día que la app se abre por segunda vez no se barre
  // nada — y hay días en que se abre veinte veces y ninguna es la primera.
  sweepStraySidecars(dir, BACKUP_PREFIX);

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
    const backupPath = join(dir, name);
    try {
      unlinkSync(backupPath);
    } catch (error) {
      console.warn(`[backup] no se pudo borrar la copia antigua ${name}:`, error);
    }
    // Y sus acompañantes: si la copia se va, lo que iba con ella no pinta nada.
    removeSidecars(backupPath);
  }
};
