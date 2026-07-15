import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AddGameModal } from '../components/library/AddGameModal';
import { GameGrid } from '../components/library/GameGrid';
import { usePlannedGames } from '../hooks/games';

// Sección Plan to Play — el mismo aspecto que Library (grid + botón de Add
// game), pero sobre la lista de juegos planeados: todo lo que se añade aquí
// nace con el estado especial Plan to Play (modo 'plan' del modal) y no
// aparece en ninguna otra parte de la app hasta pasarlo a la biblioteca.
export const PlanToPlay = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [], isLoading, isError } = usePlannedGames();
  const [addModalOpen, setAddModalOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mb-6.5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
            Plan to play
          </h1>
          <p className="mt-1.25 text-[13.5px] text-muted-foreground">
            Games you want to play someday — move them to your library when the day comes
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex flex-none items-center gap-2 rounded-[10px] px-4.5 py-4.5 text-sm font-bold text-[#08120c] shadow-[0_4px_14px_rgba(47,220,126,0.22)]"
          style={{ background: 'linear-gradient(135deg, #2fdc7e, #16a35a)' }}
        >
          <Plus size={16} />
          Add game
        </Button>
      </div>

      <AddGameModal open={addModalOpen} onOpenChange={setAddModalOpen} mode="plan" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your plan…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">
          Something went wrong loading your plan. Try again in a moment.
        </p>
      ) : games.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-24 text-center">
          <p className="text-sm font-semibold text-foreground">Nothing planned yet</p>
          <p className="text-xs text-muted-foreground">
            Add a game you want to play someday — it won&apos;t clutter your library.
          </p>
        </div>
      ) : (
        <GameGrid games={games} onSelectGame={(id) => navigate(`/plan/${id}`)} />
      )}
    </div>
  );
};
