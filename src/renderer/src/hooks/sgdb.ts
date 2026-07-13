import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { GetSgdbImagesInput, SgdbImages } from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Grids/heroes/logos de SteamGridDB para el CoverPicker (SPEC 4.6). Igual
// que el detalle de IGDB, no cambia durante la sesión de uso.
export const useSgdbImages = (input: GetSgdbImagesInput): UseQueryResult<SgdbImages, Error> =>
  useQuery({
    queryKey: queryKeys.sgdb.images(input),
    queryFn: () => window.api.sgdb.getImages(input),
    staleTime: Infinity,
  });
