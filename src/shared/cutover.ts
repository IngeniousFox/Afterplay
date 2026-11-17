// PUENTE 1.x → L3: el estado del corte 1.x → 2.0 que el proceso principal le
// cuenta a la interfaz (AFTERPLAY-2.0.md §19.6). Va con el orquestador
// (`src/main/migration/cutover.ts`) cuando se borre en la tanda L3.
//
// Sin electron ni red: lo usan main, preload y renderer.
//
// CÓMO SE USA DESDE LA PANTALLA
//   · `cutover:getState` da el estado actual al abrir la ventana; después
//     llegan los cambios por el evento `cutover:state`.
//   · Mientras `kind` no sea `idle` ni `done`, NO se enseña la biblioteca: la
//     base 2.0 puede no existir todavía y las consultas fallarían.
//   · El usuario contesta con `cutover:action`. Cada estado dice qué acciones
//     admite (`actions`); una acción que no toca al estado actual se ignora.
//
// ESTADOS (todos llevan `kind`; los textos que trae el estado ya vienen en
// inglés para mostrarse tal cual, como el resto de la interfaz):
//
//   idle              No hay corte pendiente: la app arranca normal.
//   checking          Hablando con la base compartida (reclamar el corte, leer
//                     el estado de los demás PCs). Sin acciones.
//   question-lagging  LA ÚNICA PREGUNTA del corte (§19.6 paso 2): otros PCs
//                     tienen cambios sin subir. Acciones: `wait` (volver a
//                     comprobar ya; también se comprueba solo cada 30 s) y
//                     `continue` (migrar igualmente; lo suyo se recuperará
//                     después desde su copia local). Un dispositivo con
//                     `self: true` es ESTE PC: tiene cambios de la 1.x que
//                     nunca llegaron a la base compartida y continuar los
//                     descarta (la copia local queda en backups/).
//   waiting-devices   Justo tras reclamar, los demás PCs aún no han confirmado
//                     que ya son de solo lectura (§19.3.1 `seenCutoverAt`).
//                     Se les da un margen (unos minutos) antes de preguntar.
//                     `devices` son los nombres de los que faltan. Sin acciones.
//   importing         `reading-remote`: leyendo la base compartida (Turso,
//                     la fuente de verdad, §19.5). `importing`: copiando e
//                     importando. Bloquea el proceso principal unos segundos: no esperes más cambios hasta
//                     que acabe. Sin acciones.
//   needs-pairing     Hace falta unir este PC a un hub con una dirección y un
//                     código de un solo uso (el primer PC de una persona, o un
//                     secreto de alta caducado). Acción: `submit-pairing`.
//                     `hubUrl` viene rellena si ya se conoce. `error` es el
//                     fallo del último intento. Con `canRetrySecret`, la
//                     acción `retry` repite el emparejado automático.
//   pairing           Emparejando. Sin acciones.
//   seeding           El primer PC sube su biblioteca al hub (§19.7).
//                     `rowsLeft`/`rowsTotal` miden lo que falta; `problem` es
//                     la frase del motor si va parado (cuota agotada, sin
//                     red…): se reanuda solo. Sin acciones.
//   finishing         Pidiendo el secreto de alta y marcando el corte como
//                     hecho. Sin acciones.
//   waiting-other     Otro PC está migrando ahora mismo. Se vuelve a mirar solo
//                     cada pocos segundos. Sin acciones.
//   pulling           Un PC que no migra baja todo del hub. `rowsLocal` crece
//                     al bajar; `problem` como en `seeding`. Sin acciones.
//   local-migration   Pasos locales de este PC (instalaciones, ubicaciones de
//                     restauración, índice de partidas). Sin acciones.
//   error             Algo falló; la acción `retry` lo vuelve a intentar desde
//                     donde quedó. Si el fallo fue al importar,
//                     la base 2.0 ya se borró y el reclamo se soltó: la 1.x
//                     sigue como estaba (§19.9).
//   done              Corte terminado en este PC: se puede enseñar la
//                     biblioteca.

/** Cuánto sin informar convierte a otro PC en "rezagado" (§19.6 paso 2). */
export const CUTOVER_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface CutoverLaggingDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly reason: 'pending-changes' | 'stale' | 'not-confirmed' | 'never-reported';
  /** Este mismo PC: sus cambios de la 1.x sin subir se perderían si se continúa. */
  readonly self: boolean;
  /** Último informe de ese PC (ms), para "no ha sincronizado desde X". */
  readonly lastReportAt: number;
  readonly pendingChanges: number;
}

export type CutoverErrorCode =
  | 'bridge-missing' // ninguna 1.8 ha creado `app_meta`: hay que actualizar la 1.x antes
  | 'bridge-failed' // no se pudo hablar con la base compartida (red, credenciales…)
  | 'import-blocked' // la 1.x tiene algo pendiente (buzón del móvil, sesiones sin latido…)
  | 'import-failed' // la importación o su validación fallaron
  | 'database-failed' // no se pudo abrir la base 2.0
  | 'finish-failed' // no se pudo marcar el corte como hecho
  | 'not-owner' // el reclamo del corte ya no es de este PC
  | 'local-migration-failed'
  | 'unexpected';

export type CutoverState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | {
      readonly kind: 'question-lagging';
      readonly devices: readonly CutoverLaggingDevice[];
      /** Una comprobación en curso (tras `wait`). */
      readonly rechecking: boolean;
    }
  | { readonly kind: 'waiting-devices'; readonly devices: readonly string[] }
  | { readonly kind: 'importing'; readonly phase: 'reading-remote' | 'importing' }
  | {
      readonly kind: 'needs-pairing';
      readonly reason: 'first-pc' | 'secret-expired' | 'secret-failed';
      readonly hubUrl: string | null;
      readonly error: string | null;
      readonly canRetrySecret: boolean;
    }
  | { readonly kind: 'pairing' }
  | {
      readonly kind: 'seeding';
      readonly rowsLeft: number;
      readonly rowsTotal: number;
      readonly problem: string | null;
    }
  | { readonly kind: 'finishing' }
  | {
      readonly kind: 'waiting-other';
      readonly deviceName: string;
      /** Desde cuándo migra (ms). */
      readonly since: number;
    }
  | {
      readonly kind: 'pulling';
      readonly rowsLocal: number;
      readonly problem: string | null;
    }
  | { readonly kind: 'local-migration' }
  | {
      readonly kind: 'error';
      readonly code: CutoverErrorCode;
      readonly message: string;
    }
  | { readonly kind: 'done' };

export type CutoverStateKind = CutoverState['kind'];

/** Lo que contesta la persona (canal `cutover:action`). */
export type CutoverAction =
  | { readonly type: 'continue' }
  | { readonly type: 'wait' }
  | { readonly type: 'retry' }
  | { readonly type: 'submit-pairing'; readonly hubUrl: string; readonly code: string };

/** ¿Debe la pantalla tapar la biblioteca con la de migración? */
export const cutoverBlocksLibrary = (state: CutoverState): boolean =>
  state.kind !== 'idle' && state.kind !== 'done';
