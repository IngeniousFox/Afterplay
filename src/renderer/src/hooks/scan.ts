import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ScanReport } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Escaneo de carpetas del modo "Scan your folders" (Add Game). Las carpetas
// elegidas se recuerdan en la config de la máquina: escanear es algo que se
// repite cada vez que instalas algo, y volver a señalarlas cada vez sería el
// peaje que haría que nadie lo usara dos veces.
export const useScanFolders = (): UseQueryResult<string[], Error> =>
  useQuery({
    queryKey: queryKeys.scan.folders,
    queryFn: () => window.api.scan.getFolders(),
    staleTime: Infinity,
  });

export const useSetScanFolders = (): UseMutationResult<string[], Error, string[], unknown> =>
  useInvalidatingMutation(
    (folders: string[]) => window.api.scan.setFolders(folders),
    [
      queryKeys.scan.folders,
      // Cambiar las carpetas cambia el resultado: el main ya está reenganchando
      // su vigilancia, y esto pide la foto nueva sin esperar a su aviso.
      queryKeys.scan.results,
    ],
  );

// El resultado del escaneo ya NO es algo que haya que pedir: el main lo
// mantiene en una caché en disco (scan/cache.ts) que un vigilante refresca
// solo cuando aparece o desaparece una carpeta (scan/watcher.ts). Así que
// esto se comporta como cualquier otra query normal — se lee al montar y es
// instantáneo — y `rescan()` queda como la vía de escape manual.
export const useScanResults = (): UseQueryResult<ScanReport, Error> & {
  rescan: () => void;
  isRescanning: boolean;
  rescanError: Error | null;
} => {
  const queryClient = useQueryClient();
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<Error | null>(null);

  const query = useQuery({
    queryKey: queryKeys.scan.results,
    queryFn: () => window.api.scan.cached(),
    // Releer SIEMPRE al montar, aunque haya datos: la suscripción de abajo
    // solo existe con el paso abierto, así que lo que el vigilante encuentre
    // con el modal cerrado —el caso normal: instalas y LUEGO abres Add
    // Game— no invalidó nada. Con staleTime infinito eso se enseñaba con la
    // foto vieja. Releer es leer la caché del main: instantáneo.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  // El vigilante de fondo encontró algo mientras la pantalla estaba abierta.
  // Sin esto habría que cerrar y volver a abrir para verlo, que es justo lo
  // que la vigilancia venía a evitar.
  useEffect(() => {
    return window.api.scan.onChanged(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scan.results });
    });
  }, [queryClient]);

  // Reescaneo forzado. No pasa por refetch() a propósito: son dos cosas
  // distintas —releer la caché es instantáneo, rehacerlo todo tarda
  // segundos— y la pantalla necesita poder distinguirlas para enseñar el
  // "Scanning…" solo en la segunda.
  const rescan = (): void => {
    if (isRescanning) return;
    setIsRescanning(true);
    setRescanError(null);
    void window.api.scan
      .run()
      .then((report) => queryClient.setQueryData(queryKeys.scan.results, report))
      .catch((error: unknown) => {
        // No tragarse el fallo en silencio: un disco desenchufado o un permiso
        // retirado dejaba el spinner parado con la foto vieja, indistinguible
        // de "no encontre nada". La pantalla lo enseña.
        setRescanError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => setIsRescanning(false));
  };

  return { ...query, rescan, isRescanning, rescanError };
};
