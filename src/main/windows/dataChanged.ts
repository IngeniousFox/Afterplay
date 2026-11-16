import { dataChangedFromTables, type DataChanged } from '../../shared/ipc/dataChanged';
import { currentChangeOrigin } from '../lib/changeOrigin';
import { forwardToWindowAndOverlay } from './forward';

// EL EMISOR DEL AVISO DE CAMBIO DE DATOS (AFTERPLAY-2.0.md §15.4, F-39).
//
// Todo lo que cambia datos del renderer sin que el renderer lo haga pasa por
// `broadcastDataChanged`, que lo manda a la ventana principal Y al overlay
// (otra ventana con otro caché). Hay exactamente tres fuentes:
//   · la puerta de escritura, tras cada transacción confirmada
//     (`announceStoreChanges`): mutaciones locales y escrituras del watcher;
//   · el motor de sync, tras cada página de bajada que aplicó algo
//     (`announceSyncChange`).
// Nadie más avisa a mano: una escritura nueva no tiene que acordarse de nada.

const send = forwardToWindowAndOverlay('data:changed');

export const broadcastDataChanged = (change: DataChanged): void => {
  if (change.domains.length === 0) return;
  send(change);
};

/** Lo único que se necesita de la puerta de escritura: oír sus commits. */
interface ChangeSource {
  onChange(
    listener: (change: {
      readonly tables: readonly string[];
      readonly ids: Readonly<Record<string, readonly string[] | undefined>>;
    }) => void,
  ): () => void;
}

/**
 * Un aviso por transacción confirmada de la puerta (ya viene unida por
 * transacción, no por fila). Devuelve la función que quita el oyente.
 */
export const announceStoreChanges = (store: ChangeSource): (() => void) =>
  store.onChange((change) => {
    const ids: Record<string, readonly string[]> = {};
    for (const [table, list] of Object.entries(change.ids)) if (list) ids[table] = list;
    broadcastDataChanged(dataChangedFromTables(change.tables, ids, currentChangeOrigin()));
  });

/** Una página de bajada del sync aplicó filas de estas tablas. */
export const announceSyncChange = (change: {
  readonly tables: readonly string[];
  readonly ids: Readonly<Record<string, readonly string[]>>;
}): void => {
  broadcastDataChanged(dataChangedFromTables(change.tables, change.ids, 'sync'));
};
