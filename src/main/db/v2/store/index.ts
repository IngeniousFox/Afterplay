// La puerta única de escritura de la base 2.0 (AFTERPLAY-2.0.md §8.6). Es el
// único sitio, junto con el futuro motor de sync (`src/main/sync/`), que
// escribe en tablas sincronizadas; lo vigila `__tests__/writeBarrier.test.ts`.

export { WriteStore, type WriteStoreOptions } from './store';
export { alive, whereAlive } from './alive';
export { StoreError, isStoreError, type StoreErrorCode } from './errors';
export { SESSION_FIELDS_ANY_DEVICE, type ForeignWrite, type ForeignWriteRule } from './owner';
export type {
  CreateOutcome,
  CreateResult,
  CreateValues,
  DataColumnOf,
  LocalDb,
  PatchResult,
  PatchValues,
  RemoveResult,
  RowOf,
  RowRef,
  StoreChange,
  StoreChangeListener,
} from './types';
