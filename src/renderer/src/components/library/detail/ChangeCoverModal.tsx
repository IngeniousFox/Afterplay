import { Save, X } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useUpdateGame } from '../../../hooks/games';
import type { CoverPickerTarget } from '../add-game/CoverPicker';
import { CoverPicker } from '../add-game/CoverPicker';
import { Dialog, DialogContent } from '../../ui/dialog';
import { ImagesField } from '../add-game/ImagesField';

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
      setPickerTarget(null);
    }
  }

  const handleClose = (): void => {
    if (updateGame.isPending) return;
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    await updateGame.mutateAsync({ id: game.id, patch: { coverUrl, heroUrl } });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] w-160 max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:max-w-[calc(100%-2rem)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5.5 py-4.5">
          <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">
            Change cover / hero
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5.5 py-5">
          {pickerTarget !== null ? (
            <CoverPicker
              target={pickerTarget}
              igdbId={game.igdbId}
              title={game.title}
              releaseYear={game.releaseYear}
              onSelect={(url) => {
                if (pickerTarget === 'cover') setCoverUrl(url);
                else setHeroUrl(url);
                setPickerTarget(null);
              }}
              onCancel={() => setPickerTarget(null)}
            />
          ) : (
            <ImagesField coverUrl={coverUrl} heroUrl={heroUrl} onPick={setPickerTarget} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border px-5.5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={updateGame.isPending}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateGame.isPending}
            className="flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2fdc7e,#16a35a)', color: '#08120c' }}
          >
            <Save size={16} />
            <span>{updateGame.isPending ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
