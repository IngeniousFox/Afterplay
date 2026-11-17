// MODO SOLO LECTURA DEL PUENTE 1.8 (AFTERPLAY-2.0 §19.3, §19.3.1).
//
// Cuando la 2.0 reclama el corte de una biblioteca deja una fila `cutover` en
// app_meta (en cualquier estado: migrating o done). Desde ese momento esta
// biblioteca ya no es de la 1.x y la 1.8 deja de escribir en ella: lo que
// escribiera ahora se perdería o, peor, pisaría lo que la 2.0 acaba de migrar.
//
// Sin imports de electron ni de la conexión, a propósito: el estado es del
// módulo y lo leen el guardia de getDb(), el watcher, el drenado del buzón y
// las pasadas de fondo sin arrastrar db/index.
//
// EL GUARDIA CENTRAL es guardDb(): envuelve la instancia de drizzle que
// devuelve getDb() y hace que insert/update/delete/transaction/batch lancen
// ReadOnlyError mientras dure el modo. Las escrituras de dentro de una
// transacción van por el `tx` de su callback, y a ese solo se llega pasando
// por transaction(), que ya está cerrada. Lo que NO pasa por aquí es el motor
// de sync (pull/push van por $client) y la publicación del propio
// device_status, que usa la conexión sin envolver a propósito.

export type CutoverInfo = {
  state: 'migrating' | 'done';
  deviceId: string | null;
  deviceName: string | null;
  appVersion: string | null;
  at: number | null;
};

export const READ_ONLY_CODE = 'LIBRARY_MIGRATED';

// El texto que enseña el banner (y el mensaje de ReadOnlyError). La interfaz de
// la 1.x está en inglés.
export const READ_ONLY_MESSAGE = 'This library has moved to Afterplay 2';

export class ReadOnlyError extends Error {
  readonly code = READ_ONLY_CODE;
  constructor() {
    super(READ_ONLY_MESSAGE);
    this.name = 'ReadOnlyError';
  }
}

export const isReadOnlyError = (error: unknown): error is ReadOnlyError =>
  error instanceof ReadOnlyError ||
  (error instanceof Error && (error as { code?: unknown }).code === READ_ONLY_CODE);

let cutover: CutoverInfo | null = null;
const listeners = new Set<(info: CutoverInfo | null) => void>();

export const isReadOnly = (): boolean => cutover !== null;
export const getCutover = (): CutoverInfo | null => cutover;

// Quien llama (el ciclo de sync y el arranque) pasa lo que acaba de leer de
// app_meta. `null` levanta el modo: la 2.0 puede soltar un corte que falló
// (DELETE ... state = 'migrating'), y entonces la biblioteca vuelve a ser de
// la 1.x.
export const setCutover = (info: CutoverInfo | null): void => {
  const changed =
    (cutover === null) !== (info === null) || (cutover && info && cutover.state !== info.state);
  cutover = info;
  if (changed) for (const listener of listeners) listener(info);
};

export const onCutoverChange = (listener: (info: CutoverInfo | null) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const assertWritable = (): void => {
  if (cutover) throw new ReadOnlyError();
};

// Solo para los tests.
export const resetReadOnlyForTests = (): void => {
  cutover = null;
  listeners.clear();
};

// Los métodos de escritura del query builder de drizzle. `run` NO está: lo usan
// PRAGMA y VACUUM INTO (la copia de seguridad), que no tocan datos de usuario.
const WRITE_METHODS: ReadonlySet<PropertyKey> = new Set([
  'insert',
  'update',
  'delete',
  'transaction',
  'batch',
]);

export const guardDb = <T extends object>(db: T): T =>
  new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (!WRITE_METHODS.has(prop)) return bound;
      return (...args: unknown[]) => {
        assertWritable();
        return bound(...args);
      };
    },
  });
