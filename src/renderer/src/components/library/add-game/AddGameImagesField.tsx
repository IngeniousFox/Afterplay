import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { IgdbSearchResult } from '../../../../../shared/types';
import { useIgdbDetails } from '../../../hooks/igdb';
import type { CoverPickerTarget } from './CoverPicker';
import { ImagesField } from './ImagesField';
import type { AddGameFormValues } from './types';

type AddGameImagesFieldProps = {
  selected: IgdbSearchResult;
  onPick: (target: CoverPickerTarget) => void;
};

// Conecta el ImagesField genérico al formulario de Add Game: la carátula
// cae de vuelta al resultado de búsqueda mientras no haya elección propia,
// y en cuanto llega el detalle de IGDB se rellena solo la primera
// candidata de hero si el usuario todavía no ha elegido ninguna — sin esto
// se guardaría heroUrl null salvo que entrara al picker a mano.
export const AddGameImagesField = ({
  selected,
  onPick,
}: AddGameImagesFieldProps): React.JSX.Element => {
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const coverUrl = useWatch({ control, name: 'coverUrl' });
  const heroUrl = useWatch({ control, name: 'heroUrl' });
  const steamGridDbId = useWatch({ control, name: 'steamGridDbId' });
  const detail = useIgdbDetails(selected.igdbId);

  useEffect(() => {
    if (heroUrl === null && detail.data?.heroes[0]) {
      setValue('heroUrl', detail.data.heroes[0]);
    }
  }, [heroUrl, detail.data, setValue]);

  return (
    <ImagesField
      coverUrl={coverUrl ?? selected.coverUrl}
      heroUrl={heroUrl}
      onPick={onPick}
      steamGridDbId={steamGridDbId}
      onSteamGridDbIdChange={(id) => setValue('steamGridDbId', id)}
    />
  );
};
