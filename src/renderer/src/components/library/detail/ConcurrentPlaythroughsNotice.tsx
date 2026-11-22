import { GitMerge, Layers } from 'lucide-react';
import { primaryButtonClass, secondaryButtonClass } from '../../../lib/styles';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConcurrentPlaythroughs, useMergePlaythroughs } from '../../../hooks/iterations';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import type { GameId } from '../../../../../shared/entityIds';

type ConcurrentPlaythroughsNoticeProps = {
  gameId: GameId;
};

const COUNT_WORDS: Record<number, string> = { 2: 'Two', 3: 'Three', 4: 'Four' };

// REPARAR DOS PLAYTHROUGHS EN CURSO (AFTERPLAY-2.0.md §10.7).
//
// Dos PCs sin red pueden abrir cada uno su playthrough del mismo juego, y la
// base no lo puede impedir entre dispositivos. La derivación de estado lo
// tolera (el vigente es el de creación más reciente), pero la ficha lo dice y
// ofrece juntarlos. No se pinta cuando hay uno solo, que es casi siempre.
//
// Se queda el vigente, que es el que ya manda en el estado derivado. Si hubiera
// más de dos, se fusionan todos los demás en él, de uno en uno.
export const ConcurrentPlaythroughsNotice = ({
  gameId,
}: ConcurrentPlaythroughsNoticeProps): React.JSX.Element | null => {
  const { data: active } = useConcurrentPlaythroughs(gameId);
  const merge = useMergePlaythroughs();
  const [open, setOpen] = useState(false);

  if (!active || active.length < 2) return null;

  const keep = active.find((playthrough) => playthrough.current) ?? active[active.length - 1];
  const drops = active.filter((playthrough) => playthrough.id !== keep.id);
  const dropLabels = drops.map((playthrough) => `“${playthrough.label}”`).join(', ');

  const handleOpenChange = (next: boolean): void => {
    if (merge.isPending) return;
    setOpen(next);
  };

  const handleMerge = async (): Promise<void> => {
    for (const drop of drops) {
      const outcome = await merge.mutateAsync({ keepId: keep.id, dropId: drop.id });
      if (!outcome.ok) {
        toast.error(outcome.message);
        setOpen(false);
        return;
      }
    }
    toast.success(`Merged into “${keep.label}”`);
    setOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-phosphor/35 bg-phosphor/[0.06] px-3.5 py-2.5 text-[13px]">
        <span className="flex items-center gap-2 font-semibold text-foreground">
          <Layers size={14} className="flex-none text-phosphor" />
          {COUNT_WORDS[active.length] ?? active.length} playthroughs are in progress
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          Probably started on two PCs at once.
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`ml-auto ${secondaryButtonClass} px-3 py-1.5 text-small`}
        >
          <GitMerge size={13} />
          Merge into {keep.label}
        </button>
      </div>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="w-full max-w-[460px] gap-0 border border-border bg-overlay p-0">
          <div className="flex items-center gap-3 border-b border-border px-5.5 py-5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-sm bg-bone/[0.06]">
              <GitMerge size={16} className="text-foreground" />
            </div>
            <AlertDialogTitle>Merge playthroughs</AlertDialogTitle>
          </div>

          <div className="px-5.5 py-5 text-[13.5px] leading-relaxed text-bone">
            <p>
              Everything in {dropLabels} moves into{' '}
              <span className="font-bold text-foreground">“{keep.label}”</span>: its sessions,
              status events, spending and achievements, plus any hours you entered by hand. Then{' '}
              {dropLabels} is deleted.
            </p>
            <p className="mt-2.5">
              “{keep.label}” keeps its own name, rating and format; those of the deleted one are
              lost. Your total hours don&apos;t change. This can&apos;t be undone.
            </p>
            {merge.isError && (
              <div className="mt-3 text-[12px] text-destructive">
                Couldn&apos;t merge — {merge.error.message}
              </div>
            )}
          </div>

          <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={merge.isPending}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleMerge()}
              disabled={merge.isPending}
              className={primaryButtonClass}
            >
              <GitMerge size={15} />
              {merge.isPending ? 'Merging…' : 'Merge'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
