import type {
  AddSpendEventInput,
  AddStateEventInput,
  CreateIterationInput,
  UpdateIterationPatch,
} from '../../../../../shared/dto';
import type { UpdateSpendEventPatch, UpdateStateEventPatch } from '../../../../../shared/types';
import type { StateEventDatePrecision, StateEventType } from '../../schema';

// Las entradas de P3 sobre el esquema 2.0.
//
// Los tipos de `src/shared/` no se tocan desde aquí (CONSULTAS.md §4), pero
// tres de ellos no pueden expresar el 2.0 tal cual. Se definen en esta carpeta
// como "cambio pedido" para el cambio final (P9), con la forma exacta que
// debería tener el tipo compartido:
//
// - `datePrecision` de los eventos de estado gana 'unknown' (R-07): es lo que
//   escribe un alta o una promoción sin fecha. `AddStateEventInput` y
//   `UpdateStateEventPatch` siguen con `EventDatePrecision`.
// - `type` de los eventos de estado PIERDE 'plan_to_play' en la escritura
//   (§1.2: ya no existe como fila). El DTO de lectura lo conserva solo como
//   valor sintético del Plan, así que aquí se usa el enumerado del esquema.
// - El gasto puede indicar `playthroughId` (opcional, como en la tabla 2.0).
//
// Con ids de texto: son las entradas tal como llegarán del IPC tras el cambio.

/** `CreateIterationInput` con ids de texto. Sin cambios de forma. */
export type CreatePlaythroughInput = CreateIterationInput<string>;

/** `UpdateIterationPatch`. Sin cambios de forma. */
export type UpdatePlaythroughPatch = UpdateIterationPatch;

/**
 * `AddStateEventInput<string>` con el tipo del 2.0 (sin 'plan_to_play') y la
 * precisión con 'unknown'. Cambio pedido a `shared/dto.ts`.
 */
export type AddStateEventInputV2 = Omit<AddStateEventInput<string>, 'type' | 'datePrecision'> & {
  type: StateEventType;
  datePrecision: StateEventDatePrecision;
};

/**
 * `UpdateStateEventPatch` con el tipo del 2.0 y la precisión con 'unknown'.
 * Cambio pedido a `shared/types.ts`.
 */
export type UpdateStateEventPatchV2 = Omit<UpdateStateEventPatch, 'type' | 'datePrecision'> & {
  type?: StateEventType;
  datePrecision?: StateEventDatePrecision;
};

/**
 * `AddSpendEventInput<string>` más el playthrough opcional. Cambio pedido a
 * `shared/dto.ts` (campo opcional nuevo: los DTO solo ganan cosas en la fase 2).
 */
export type AddSpendEventInputV2 = AddSpendEventInput<string> & {
  playthroughId?: string | null;
};

/** `UpdateSpendEventPatch`. Sin cambios de forma. */
export type UpdateSpendEventPatchV2 = UpdateSpendEventPatch;
