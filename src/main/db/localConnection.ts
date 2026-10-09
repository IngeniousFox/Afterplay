import { existsSync } from 'fs';

// Cómo abrir Afterplay.db cuando NO hay sync (arranque sin red, Turso que no
// contesta a tiempo, o sin remoto configurado). Vive aparte de db/index.ts por
// lo mismo que migrationSync.ts: es una DECISIÓN, y se prueba sin electron.
//
// ── LA CICATRIZ (24-sep y 5-oct de 2026) ────────────────────────────────────
//
// Dos veces el sync se quedó bloqueado para siempre con
//
//   unable to checkpoint synced portion of WAL: ... wal_max_frame: 21599 ...
//   watermark=113169
//
// El push seguía funcionando (va antes en el ciclo) y por eso nada parecía
// roto, pero NINGÚN pull volvió a completar: lo escrito desde el móvil u otro
// PC dejó de llegar, y el WAL creció hasta los 89 MB. La primera vez se
// arregló reescribiendo -info a mano; la segunda, reconstruyendo la base
// desde Turso. Lo que lo provocaba, medido sobre copias:
//
//   1. El motor de sync vuelca el WAL al fichero principal (checkpoint) pero
//      CONSERVA sus frames: le hacen falta para deshacer lo local antes de
//      aplicar un pull. En -info apunta hasta dónde llega lo sincronizado
//      (revert_since_wal_watermark).
//   2. Una conexión SIN sync —la de "sigo en local" de toda la vida— no sabe
//      nada de eso. Ve un WAL volcado entero y, por la regla de siempre de
//      SQLite, lo REINICIA en la primera escritura. Medido: 15.490 frames a 3
//      en cuanto el arranque escribe lo primero (logros, watcher...).
//   3. -info sigue apuntando al frame 113.169 de un WAL que ya no existe. El
//      checkpoint que el motor hace antes de cada pull ya no puede cumplirse
//      nunca, y cada ciclo falla igual.
//
// O sea: bastaba UN arranque en el que Turso tardase más de 4 s en contestar
// (una base dormida despertando; la descarga entera de la base real tarda
// 4,3 s) para romper el sync sin que nadie hubiera tocado nada.
//
// El arreglo es no abrir NUNCA un fichero con metadatos de sync sin el motor
// de sync delante. El paquete tiene un modo para exactamente esto: `url` como
// función que devuelve null crea la conexión con el motor pero con el sync
// "en pausa" (push/pull lanzan "url is empty - sync is paused"). Medido con la
// misma secuencia que rompía la base: el WAL queda intacto, cero peticiones
// de red, y cada escritura offline entra sola en la cola de CDC para subirse
// al reconectar. La reconexión sigue siendo la de siempre (attemptSyncUpgrade
// cierra esta y abre la de sync), ahora sobre un fichero coherente.
//
// Lo que queda con la conexión simple: un fichero que nunca sincronizó (sin
// -info). Ahí no hay marca de agua que romper.

// Un fichero "de sync" es uno que el motor ya gestiona: el principal Y su
// -info. Solo el -info no cuenta: son satélites huérfanos de una base borrada
// a mano, y el modo diferido sobre un principal que no existe se niega a
// arrancar ("main DB file doesn't exists, but metadata is") — eso ya lo
// resuelve connectWithSync cuando vuelve la red.
export const hasSyncMetadata = (dbPath: string): boolean =>
  existsSync(dbPath) && existsSync(`${dbPath}-info`);

export type LocalConnectionOptions = {
  path: string;
  clientName: string;
  url?: () => null;
};

export const localConnectionOptions = (dbPath: string): LocalConnectionOptions =>
  hasSyncMetadata(dbPath)
    ? { path: dbPath, clientName: 'afterplay', url: () => null }
    : { path: dbPath, clientName: 'afterplay' };

// El fallo de arriba, reconocido por su mensaje. No se arregla reintentando
// —cada ciclo choca con la misma marca de agua—, así que Ajustes lo cuenta
// con otras palabras que un corte de red.
const WAL_OUT_OF_STEP_HINT = 'unable to checkpoint synced portion of wal';

export const isWalOutOfStep = (message: string): boolean =>
  message.toLowerCase().includes(WAL_OUT_OF_STEP_HINT);
