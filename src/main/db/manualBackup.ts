import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { vacuumInto } from './backupCore';

// Botón "Back up now" de Ajustes — copia a demanda en la carpeta que elija
// el usuario, sin el límite de 5 ni la regla de "una al día" de
// dailyBackup.ts (a propósito: el usuario la pidió explícitamente como vía
// de escape aparte). A diferencia de la diaria (que corre en el arranque,
// antes de que exista ninguna concurrencia real), esta puede dispararse en
// cualquier momento de una sesión ya en marcha. La base 2.0 es una sola
// conexión síncrona, así que no hace falta ningún candado propio aquí encima;
// su único llamador es ipc/backup.ts.
//
// Nombre con fecha Y hora (no solo fecha) porque, a diferencia de la
// diaria, aquí no hay ningún criterio de "ya se hizo hoy" que evite un
// choque de nombres si se pulsa el botón dos veces seguidas.
//
// Y con "manual" en el nombre, no "backup": el usuario elige la carpeta y
// nada le impide elegir la de las automáticas (userData/backups). Ahí dentro
// las dos familias tienen que distinguirse a simple vista y por patrón —
// dailyBackup solo reconoce las suyas por el sello AAAA-MM-DD_HH-mm—, porque
// mientras compartieron pinta esta copia se colaba en el censo de las
// automáticas y le rompía el intervalo y la rotación.
export const createManualBackup = async (directory: string): Promise<string> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(directory, `Afterplay2-manual-${timestamp}.db`);

  if (existsSync(filePath)) {
    throw new Error('Ya existe una copia con ese nombre — inténtalo de nuevo en un momento.');
  }

  await vacuumInto(filePath);
  return filePath;
};
