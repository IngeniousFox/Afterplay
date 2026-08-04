import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Los ficheros que SQLite deja AL LADO de una base de datos en modo WAL. La
// copia hereda el modo del original, así que VACUUM INTO no escribe un
// fichero: escribe uno y deja estos dos de propina, y la rotación de las
// copias diarias —que filtra por .db— nunca los veía. Resultado observado en
// una instalación real: seis -wal de julio sin su .db, uno por cada copia ya
// rotada, ahí para siempre.
//
// Aparte de backupCore.ts a propósito: aquí no se importa ni electron ni la
// base de datos, solo fs. Así esto se puede ejecutar y comprobar contra una
// carpeta de mentira sin levantar la app entera.
export const SIDECAR_SUFFIXES = ['-wal', '-shm'];

const unlinkQuietly = (filePath: string): void => {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (error) {
    console.warn(`[backup] no se pudo borrar ${filePath}:`, error);
  }
};

// Borra los sidecars VACÍOS de una copia. VACUUM INTO produce por definición
// un fichero con todo ya confirmado, no a medias en el WAL: por eso salen de
// 0 bytes y borrarlos no puede perder una página.
//
// Uno con contenido sería otra cosa —ahí sí sería parte de la copia— y por
// eso se avisa y se deja en paz en vez de borrarlo igualmente: si algún día
// pasa, quiero enterarme por consola y no descubrirlo restaurando.
export const removeEmptySidecars = (dbPath: string): void => {
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecar = `${dbPath}${suffix}`;
    if (!existsSync(sidecar)) continue;
    try {
      if (statSync(sidecar).size > 0) {
        console.warn(`[backup] ${sidecar} no está vacío — lo dejo, es parte de la copia`);
        continue;
      }
      unlinkSync(sidecar);
    } catch (error) {
      console.warn(`[backup] no se pudo borrar ${sidecar}:`, error);
    }
  }
};

// Los de una copia que se va: aquí sin mirar el tamaño, porque el .db ya no
// va a estar y un WAL suelto no sirve para nada aunque tenga contenido.
export const removeSidecars = (dbPath: string): void => {
  for (const suffix of SIDECAR_SUFFIXES) unlinkQuietly(`${dbPath}${suffix}`);
};

// La basura ya sembrada, la de antes de que removeEmptySidecars corriera
// solo tras cada copia. Se van los huérfanos (su .db ya rotó: no acompañan a
// nada) y los vacíos que siguen teniendo dueño. Sin esto, una carpeta que ya
// tiene seis -wal de julio los arrastra para siempre.
export const sweepStraySidecars = (dir: string, prefix: string): void => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const suffix = SIDECAR_SUFFIXES.find((candidate) => name.endsWith(candidate));
    if (!suffix) continue;

    const owner = join(dir, name.slice(0, -suffix.length));
    if (existsSync(owner)) removeEmptySidecars(owner);
    else unlinkQuietly(join(dir, name));
  }
};
