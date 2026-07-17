import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { withDbAccess } from '.';
import { vacuumInto } from './backupCore';

// Botón "Back up now" de Ajustes — copia a demanda en la carpeta que elija
// el usuario, sin el límite de 5 ni la regla de "una al día" de
// dailyBackup.ts (a propósito: el usuario la pidió explícitamente como vía
// de escape aparte). A diferencia de la diaria (que corre en el arranque,
// antes de que exista ninguna concurrencia real), esta puede dispararse en
// cualquier momento de una sesión ya en marcha — por eso pasa por
// withDbAccess(), igual que el resto de accesos fuera del arranque.
//
// Nombre con fecha Y hora (no solo fecha) porque, a diferencia de la
// diaria, aquí no hay ningún criterio de "ya se hizo hoy" que evite un
// choque de nombres si se pulsa el botón dos veces seguidas.
export const createManualBackup = async (directory: string): Promise<string> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(directory, `Afterplay-backup-${timestamp}.db`);

  if (existsSync(filePath)) {
    throw new Error('Ya existe una copia con ese nombre — inténtalo de nuevo en un momento.');
  }

  await withDbAccess(() => vacuumInto(filePath));
  return filePath;
};
