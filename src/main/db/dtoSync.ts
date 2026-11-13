import type * as Dto from '../../shared/dto';
import type {
  emulatorsTable,
  gamesTable,
  iterationsTable,
  saveBackupsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from './schema';
import type { GamePatch } from './writeTypes';

// ── QUE LOS TIPOS PROPIOS Y LAS TABLAS NO SE SEPAREN ───────────────────────
//
// shared/dto.ts declara a mano la forma de las entidades para que el renderer
// no dependa del esquema (F-42). El precio de declararlas a mano es que
// podrían desincronizarse en silencio: añadir una columna y olvidar el tipo
// propio, o cambiar un enum en uno solo de los dos lados. Este fichero lo
// impide: compara, EN LOS DOS SENTIDOS, cada tipo propio con el inferido de su
// tabla. Si difieren, `npm run typecheck:node` falla en la línea de la
// entidad y el mensaje nombra la entidad y los campos que no casan, p. ej.:
//
//   Type 'true' is not assignable to type
//   '{ entidad: "GameRow"; camposDistintos: "summary"; }'.
//
// Solo tipos: nada de esto existe en ejecución ni se importa desde ningún
// sitio (tsc lo comprueba porque tsconfig.node incluye src/main/**).

// Igualdad por asignabilidad en los dos sentidos. Con los tuplas se evita
// que las uniones se distribuyan y comparen miembro a miembro.
type MismoTipo<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Los campos que sobran en un lado, faltan en el otro o tienen tipo distinto.
// Un campo opcional frente a uno obligatorio también sale aquí: indexar un
// opcional añade `undefined` a su tipo.
type CamposDistintos<Propio, Tabla> = {
  [K in keyof Propio | keyof Tabla]: K extends keyof Propio
    ? K extends keyof Tabla
      ? MismoTipo<Propio[K], Tabla[K]> extends true
        ? never
        : K
      : K
    : K;
}[keyof Propio | keyof Tabla];

type Coinciden<Nombre extends string, Propio, Tabla> = [CamposDistintos<Propio, Tabla>] extends [
  never,
]
  ? MismoTipo<Propio, Tabla> extends true
    ? true
    : { entidad: Nombre; error: 'la forma completa no coincide' }
  : { entidad: Nombre; camposDistintos: CamposDistintos<Propio, Tabla> };

// Para los inputs del IPC no se pide igualdad (son subconjuntos cerrados a
// propósito), pero sí que lo que manda el renderer se pueda escribir tal cual
// en la tabla: si una columna cambia de tipo, el input tiene que acompañarla.
// Y que no traiga claves que la tabla no tiene (la asignabilidad sola las
// dejaría pasar).
type CabeEn<Nombre extends string, Input, Destino> = [Exclude<keyof Input, keyof Destino>] extends [
  never,
]
  ? [Input] extends [Destino]
    ? true
    : { input: Nombre; error: 'no se puede escribir tal cual en su tabla' }
  : { input: Nombre; camposQueLaTablaNoTiene: Exclude<keyof Input, keyof Destino> };

export const entidadesSincronizadas: {
  gameRow: Coinciden<'GameRow', Dto.GameRow, typeof gamesTable.$inferSelect>;
  iteration: Coinciden<'Iteration', Dto.Iteration, typeof iterationsTable.$inferSelect>;
  session: Coinciden<'Session', Dto.Session, typeof sessionsTable.$inferSelect>;
  stateEvent: Coinciden<'StateEvent', Dto.StateEvent, typeof stateEventsTable.$inferSelect>;
  spendEvent: Coinciden<'SpendEvent', Dto.SpendEvent, typeof spendEventsTable.$inferSelect>;
  emulator: Coinciden<'Emulator', Dto.Emulator, typeof emulatorsTable.$inferSelect>;
  saveBackupRow: Coinciden<
    'SaveBackupRow',
    Dto.SaveBackupRow,
    typeof saveBackupsTable.$inferSelect
  >;
} = {
  gameRow: true,
  iteration: true,
  session: true,
  stateEvent: true,
  spendEvent: true,
  emulator: true,
  saveBackupRow: true,
};

export const inputsEscribibles: {
  updateGamePatch: CabeEn<'UpdateGamePatch', Dto.UpdateGamePatch, GamePatch>;
  // label se completa en el main antes del insert (nextPlaythroughLabel).
  createIteration: CabeEn<
    'CreateIterationInput',
    Dto.CreateIterationInput & { label: string },
    typeof iterationsTable.$inferInsert
  >;
  updateIteration: CabeEn<
    'UpdateIterationPatch',
    Dto.UpdateIterationPatch,
    Partial<typeof iterationsTable.$inferInsert>
  >;
  addStateEvent: CabeEn<
    'AddStateEventInput',
    Dto.AddStateEventInput,
    typeof stateEventsTable.$inferInsert
  >;
  addSpendEvent: CabeEn<
    'AddSpendEventInput',
    Dto.AddSpendEventInput,
    typeof spendEventsTable.$inferInsert
  >;
  createEmulator: CabeEn<
    'CreateEmulatorInput',
    Dto.CreateEmulatorInput,
    typeof emulatorsTable.$inferInsert
  >;
} = {
  updateGamePatch: true,
  createIteration: true,
  updateIteration: true,
  addStateEvent: true,
  addSpendEvent: true,
  createEmulator: true,
};
