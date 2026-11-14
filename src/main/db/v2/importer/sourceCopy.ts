import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Copia consistente de una base 1.x antes de leerla (scripts/import-1x-to-v2.ts).
//
// Revisión (sospecha sobre el script): antes se copiaba solo el `.db`. Si el
// origen es una base en WAL con su `-wal` al lado (las copias de backups/ las
// hace la app con `VACUUM INTO` y son un solo fichero, pero `--from` acepta
// cualquiera), lo confirmado que aún vivía en el `-wal` se perdía en silencio.
//
// Ahora se copian el `.db` y, si existen, su `-wal` y su `-journal` (el `-shm`
// no: es un índice del `-wal` que SQLite reconstruye al abrir), se comprueba
// que el origen no cambió mientras se copiaba, y de esa copia literal se saca
// con `VACUUM INTO` una copia de un solo fichero, coherente, que es la que se
// lee. No se abre el origen, ni siquiera en solo lectura: abrir una base en WAL
// puede crear ficheros `-shm`/`-wal` a su lado, y el script promete no tocar
// nada junto al origen.

/** Acompañantes del `.db` que llevan datos confirmados (o por deshacer). */
const SIDE_FILES = ['-wal', '-journal'] as const;
/** Todo lo que SQLite puede dejar junto a una base. */
const ALL_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;

/** Tamaño y fecha del origen y sus acompañantes: si cambian al copiar, la copia no vale. */
function fingerprint(path: string): string {
  return ['', ...SIDE_FILES]
    .map((suffix) => {
      const file = `${path}${suffix}`;
      if (!existsSync(file)) return `${suffix}:-`;
      const s = statSync(file);
      return `${suffix}:${s.size}:${s.mtimeMs}`;
    })
    .join('|');
}

/** Borra una base y lo que SQLite deja a su lado. */
export function removeDatabaseFiles(path: string): void {
  for (const suffix of ALL_SUFFIXES) rmSync(`${path}${suffix}`, { force: true });
}

/**
 * Copia `from` (con su `-wal`/`-journal`) a `raw` y deja en `copy` una copia
 * consistente de un solo fichero. `raw` y sus acompañantes se borran al
 * terminar; `copy` no debe existir.
 */
export function copySourceConsistently(from: string, raw: string, copy: string): void {
  const before = fingerprint(from);
  try {
    copyFileSync(from, raw);
    for (const suffix of SIDE_FILES) {
      if (existsSync(`${from}${suffix}`)) copyFileSync(`${from}${suffix}`, `${raw}${suffix}`);
    }
    if (fingerprint(from) !== before) {
      throw new Error(
        'El origen ha cambiado mientras se copiaba: usa una copia que no esté en uso.',
      );
    }
    // La copia literal es nuestra: abrirla aplica su `-wal` (o deshace su
    // `-journal`) y `VACUUM INTO` la deja en un solo fichero coherente.
    const db = new DatabaseSync(raw);
    try {
      db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
    } finally {
      db.close();
    }
  } finally {
    removeDatabaseFiles(raw);
  }
}
