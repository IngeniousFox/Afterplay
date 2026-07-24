import { Image, Save } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useUpdateGame } from '../../../hooks/games';
import type { CoverPickerTarget } from '../add-game/CoverPicker';
import { CoverPicker } from '../add-game/CoverPicker';
import { ModalFooter, ModalShell } from '../../ui/modal-shell';
import { ImagesField } from '../add-game/ImagesField';

const VIOLET = '#7c86c8';

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

  // "Adjusting state when a prop changes" (react.dev) — al reabrir el modal
  // hay que volver a partir de los valores actuales del juego, con
  // useState en vez de un efecto para no disparar un render en cascada.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCoverUrl(game.coverUrl);
      setHeroUrl(game.heroUrl);
      setSteamGridDbId(game.steamGridDbId);
      setPickerTarget(null);
    }
  }

  const handleClose = (): void => {
    if (updateGame.isPending) return;
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    await updateGame.mutateAsync({ id: game.id, patch: { coverUrl, heroUrl, steamGridDbId } });
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
        <ImagesField
          coverUrl={coverUrl}
          heroUrl={heroUrl}
          onPick={setPickerTarget}
          steamGridDbId={steamGridDbId}
          onSteamGridDbIdChange={setSteamGridDbId}
        />
      )}
    </ModalShell>
  );
};
