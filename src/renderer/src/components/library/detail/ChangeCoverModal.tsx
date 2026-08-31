import { Image, Save } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useUpdateGame } from '../../../hooks/games';
import { useResetOnOpen } from '../../../hooks/useResetOnOpen';
import type { CoverPickerTarget } from '../add-game/CoverPicker';
import { CoverPicker } from '../add-game/CoverPicker';
import { ModalFooter, ModalShell } from '../../ui/modal-shell';
import { ImagesField } from '../add-game/ImagesField';
import { VIOLET } from '../../../lib/colors';

type ChangeCoverModalProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Modal dedicado exclusivamente a elegir carátula/hero — no pasa por el
// modal de editar juego. Se abre siempre en la vista "ambas a la vista",
// clicar una abre el CoverPicker, elegir vuelve aquí, y "Save changes"
// guarda directo (mismo principio de 2F-bis: un modal, cambia de
// contenido, no se apila).
export const ChangeCoverModal = ({
  game,
  open,
  onOpenChange,
}: ChangeCoverModalProps): React.JSX.Element => {
  const updateGame = useUpdateGame();
  const [coverUrl, setCoverUrl] = useState(game.coverUrl);
  const [heroUrl, setHeroUrl] = useState(game.heroUrl);
  const [steamGridDbId, setSteamGridDbId] = useState(game.steamGridDbId);
  const [pickerTarget, setPickerTarget] = useState<CoverPickerTarget | null>(null);

  useResetOnOpen(open, () => {
    setCoverUrl(game.coverUrl);
    setHeroUrl(game.heroUrl);
    setSteamGridDbId(game.steamGridDbId);
    setPickerTarget(null);
  });

  const handleClose = (): void => {
    if (updateGame.isPending) return;
    // El componente NO se desmonta al cerrar (solo su contenido, que vive en
    // el portal del Dialog), así que sin esto el banner de un guardado
    // fallido reaparecería tal cual en la próxima apertura — mismo motivo que
    // el deleteIteration.reset() de IterationSection.
    updateGame.reset();
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    // Sin este try/catch la promesa rechazada se quedaba sin dueño
    // (ModalFooter.onSubmit está tipado `() => void`) y el fallo no se veía
    // por ningún sitio: el botón volvía de "Saving…" a "Save changes", el
    // modal seguía abierto con la carátula nueva a la vista, y al cerrar la
    // ficha seguía con la de antes. Ahora el rechazo se recoge y el banner de
    // abajo lo cuenta, como en Edit Game / Add Game.
    try {
      await updateGame.mutateAsync({ id: game.id, patch: { coverUrl, heroUrl, steamGridDbId } });
    } catch (error) {
      console.error('[change-cover] fallo guardando la caratula:', error);
      return;
    }
    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Change cover / hero"
      icon={Image}
      color={VIOLET}
      widthClass="w-160"
      maxHClass="max-h-[80vh]"
      footer={
        <ModalFooter
          onCancel={handleClose}
          onSubmit={handleSave}
          submitting={updateGame.isPending}
          submitLabel="Save changes"
          submittingLabel="Saving…"
          icon={<Save size={16} />}
        />
      }
    >
      {pickerTarget !== null ? (
        <CoverPicker
          target={pickerTarget}
          igdbId={game.igdbId}
          title={game.title}
          releaseYear={game.releaseYear}
          steamGridDbId={steamGridDbId}
          onSelect={(url) => {
            if (pickerTarget === 'cover') setCoverUrl(url);
            else setHeroUrl(url);
            setPickerTarget(null);
          }}
          onCancel={() => setPickerTarget(null)}
        />
      ) : (
        <>
          <ImagesField
            coverUrl={coverUrl}
            heroUrl={heroUrl}
            onPick={setPickerTarget}
            steamGridDbId={steamGridDbId}
            onSteamGridDbIdChange={setSteamGridDbId}
          />

          {updateGame.error && !updateGame.isPending && (
            <div className="mt-5 rounded-[10px] border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
              Couldn&apos;t save the images — {updateGame.error.message}
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
};
