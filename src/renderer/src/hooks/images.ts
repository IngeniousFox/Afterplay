import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ImageCacheUsage, ImageRedownloadEvent } from '../../../shared/types';
import { queryKeys } from './queryKeys';

type CleanResult = { files: number; bytes: number; usage: ImageCacheUsage };

// El peso de la caché en disco. staleTime Infinity: solo cambia por los dos
// botones de la tarjeta (que ya invalidan) o por descargas de fondo, y ahí
// unos megas de diferencia no justifican volver a recorrer cuatro carpetas
// con miles de ficheros cada vez que se abre Ajustes.
export const useImageCacheUsage = (): UseQueryResult<ImageCacheUsage, Error> =>
  useQuery({
    queryKey: queryKeys.images.usage,
    queryFn: () => window.api.images.getUsage(),
    staleTime: Infinity,
  });

// Borra lo prescindible. La respuesta ya trae el estado nuevo de la caché,
// así que se siembra en la query en vez de pedirla otra vez.
export const useCleanUnusedImages = (): UseMutationResult<CleanResult, Error, void, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => window.api.images.cleanUnused(),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.images.usage, result.usage),
  });
};

// Devuelve cuántas imágenes entraron en la pasada; el progreso llega por
// useImageRedownloadActivity.
export const useRedownloadImages = (): UseMutationResult<number, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.images.redownload() });

// El progreso en vivo de la redescarga, para la tarjeta de Ajustes. Al
// terminar invalida el peso: se han reescrito todos los ficheros y alguno
// puede haber cambiado de tamaño.
export const useImageRedownloadActivity = (): ImageRedownloadEvent | null => {
  const [progress, setProgress] = useState<ImageRedownloadEvent | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.images.onRedownloadActivity((event) => {
      setProgress(event);
      if (!event.running) queryClient.invalidateQueries({ queryKey: queryKeys.images.usage });
    });
  }, [queryClient]);

  return progress;
};
