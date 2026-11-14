// Errores de la puerta de escritura (AFTERPLAY-2.0.md §8.6).
//
// Llevan un `code` estable para que quien llama distinga los casos sin leer
// el texto: por ejemplo, el watcher (fase 4) tendrá que reconocer `deleted`
// cuando su sesión abierta reciba una lápida por sync, y la interfaz querrá
// decir "ya no existe" en vez de mostrar un error genérico.

export type StoreErrorCode =
  /** La tabla no es una tabla sincronizada del registro. */
  | 'unknown_table'
  /** Una clave que no es columna de datos de la tabla (o es una de §7.3). */
  | 'unknown_column'
  /** Valor de tipo equivocado, enumeración fuera de rango, NaN, fecha inválida… */
  | 'invalid_value'
  /** Creación sin una columna NOT NULL, o un null en una columna NOT NULL. */
  | 'incomplete'
  /** El id indicado no coincide con el que dicta el registro (§7.2). */
  | 'id_mismatch'
  /** Ya existe una fila con ese id aleatorio. */
  | 'exists'
  | 'not_found'
  /** La fila tiene lápida: no se parchea (ver `WriteStore.patch`). */
  | 'deleted'
  /** Regla del dueño (§7.1, §7.4): la fila es de otro dispositivo. */
  | 'not_owner'
  /** Columna que forma el id o que dice quién es el dueño. */
  | 'immutable'
  /** La tabla no admite lápidas (`deletable: false`). */
  | 'not_deletable'
  /** Ya hay una sesión propia abierta para el mismo objetivo (§7.7). */
  | 'open_session'
  /**
   * El padre del registro (`children`) al que se engancha la fila tiene
   * lápida: un hijo vivo bajo un padre borrado sería invisible (F-11) pero se
   * subiría y ocuparía sitio (revisión, hallazgo 5).
   */
  | 'parent_deleted'
  /** Uso indebido de `transaction` (asíncrona, o dentro de otra ajena). */
  | 'transaction'
  /**
   * SQLite deshizo la transacción entera por su cuenta (disco lleno, E/S,
   * memoria): la operación en curso ya no puede confirmar nada. El error de
   * SQLite va en `cause` (revisión, hallazgo 4).
   */
  | 'aborted';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

export const isStoreError = (error: unknown, code?: StoreErrorCode): error is StoreError =>
  error instanceof StoreError && (code === undefined || error.code === code);
