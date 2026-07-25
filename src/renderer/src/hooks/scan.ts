import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { ScanCandidate } from '../../../shared/types';
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
    [queryKeys.scan.folders],
  );

// El escaneo es caro (recorre el disco y consulta IGDB por cada carpeta) y
// solo pasa cuando se pulsa el botón — pero su RESULTADO se cachea, y eso es
// lo que arregla el camino de vuelta: al elegir un juego y pulsar "Change",
// el paso de escaneo se desmonta; con el resultado en un useState se perdía
// y había que volver a escanearlo todo, repitiendo cada petición a IGDB.
//
// `enabled: false` + `refetch()` es justo eso: nunca se dispara solo, pero
// si ya hay datos en caché para ESTAS carpetas se devuelven al instante. La
// clave incluye la lista de carpetas, así que tocarlas invalida el resultado
// por construcción, sin tener que acordarse de limpiarlo.
export const useScanResults = (
  folders: string[],
): UseQueryResult<ScanCandidate[], Error> & { scan: () => void } => {
  const query = useQuery({
    queryKey: queryKeys.scan.results(folders),
    queryFn: () => window.api.scan.run(folders),
    enabled: false,
    staleTime: Infinity,
    // Media hora de vida: lo suficiente para ir y volver del formulario
    // varias veces, sin quedarse con una foto del disco de anteayer.
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  return { ...query, scan: () => void query.refetch() };
};
