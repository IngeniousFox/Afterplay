// P3 · Playthroughs, estados y gasto (CONSULTAS.md §4). Léase antes
// `../README.md`.
//
// Las entradas son las compartidas con ids de texto (`AddStateEventInput<string>`,
// `UpdateStateEventPatch<string>`, `AddSpendEventInput<string>`…, en
// `src/shared/`): con texto ya no admiten 'plan_to_play', admiten la precisión
// 'unknown' y el gasto puede colgar de un playthrough. La moneda de los gastos
// es `DEFAULT_CURRENCY` de `common/`.

export { createIteration, deleteIteration, updateIteration } from './playthroughs';
export {
  addStateEvent,
  deleteStateEvent,
  getAllStateEvents,
  updateStateEvent,
} from './stateEvents';
export { addSpendEvent, deleteSpendEvent, getAllSpendEvents, updateSpendEvent } from './spend';
export {
  PlaythroughMergeError,
  findConcurrentActivePlaythroughs,
  isPlaythroughMergeError,
  mergePlaythroughs,
  type ActivePlaythrough,
  type MergePlaythroughsInput,
  type MergePlaythroughsResult,
  type PlaythroughMergeErrorCode,
} from './merge';
