import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { DataChanged } from '../../../shared/ipc/dataChanged';
import { queryKeysForChange } from './domainQueryKeys';

// EL ÚNICO OYENTE DE 'data:changed' (AFTERPLAY-2.0.md §15.4, F-39). Se monta
// UNA vez por ventana (la principal en Afterplay.tsx, el HUD en OverlayHud) y
// sustituye a lo que había: `useWatcherSync`, el oyente propio del overlay, el
// refresco de bajadas del sync y la invalidación a mano de cada mutación.
//
// El main avisa tras cada transacción confirmada (mutaciones, watcher) y tras
// cada página de bajada del sync; el aviso llega a las dos ventanas porque
// cada una tiene su propio QueryClient. Con `staleTime: Infinity` en casi todas
// las consultas, esto es lo único que las pone al día.
//
// `shouldRefetch` es el telón del overlay (OVERLAY.md §9.1, "oculto = coste
// cero"): devolviendo false las consultas solo se MARCAN como viejas
// (`refetchType: 'none'`) y las barre la apertura del HUD.
export const createDataChangedInvalidator =
  (queryClient: QueryClient, shouldRefetch: () => boolean = () => true) =>
  (change: DataChanged): void => {
    const refetchType = shouldRefetch() ? 'active' : 'none';
    for (const queryKey of queryKeysForChange(change)) {
      void queryClient.invalidateQueries({ queryKey, refetchType });
    }
  };

export const useDataChangedSync = (shouldRefetch?: () => boolean): void => {
  const queryClient = useQueryClient();
  // Por ref y no como dependencia: volver a suscribirse en cada cambio del
  // telón no aporta nada y abriría un hueco entre dos suscripciones.
  const shouldRefetchRef = useRef(shouldRefetch);
  useEffect(() => {
    shouldRefetchRef.current = shouldRefetch;
  }, [shouldRefetch]);

  useEffect(
    () =>
      window.api.dataChanged.onChanged(
        createDataChangedInvalidator(queryClient, () => shouldRefetchRef.current?.() ?? true),
      ),
    [queryClient],
  );
};
