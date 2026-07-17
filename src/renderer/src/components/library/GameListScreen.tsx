import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { accentGradientStyle } from '../../lib/styles';
import { AddGameModal } from './AddGameModal';
import { GameGrid } from './GameGrid';

type GameListScreenProps = {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyText: string;
  loadingText: string;
  errorText: string;
  games: GameListItem[];
  isLoading: boolean;
  isError: boolean;
  // Modo del AddGameModal — 'plan' para Plan to Play, sin especificar
  // (default 'library') para la biblioteca normal.
  modalMode?: 'library' | 'plan';
  onSelectGame: (id: number) => void;
};

// Library y PlanToPlay son la misma pantalla (~90% idéntica: cabecera, botón
// Add game, isLoading/isError/empty, GameGrid) — solo cambian los textos, el
// modo del modal y a dónde navega la grid al seleccionar un juego.
export const GameListScreen = ({
  title,
  subtitle,
  emptyTitle,
  emptyText,
  loadingText,
  errorText,
  games,
  isLoading,
  isError,
  modalMode,
  onSelectGame,
}: GameListScreenProps): React.JSX.Element => {
  const [addModalOpen, setAddModalOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mb-6.5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">{title}</h1>
          <p className="mt-1.25 text-[13.5px] text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="flex flex-none items-center gap-2 rounded-[10px] px-4.5 py-4.5 text-sm font-bold text-[#08120c] shadow-[0_4px_14px_rgba(47,220,126,0.22)]"
          style={{ background: accentGradientStyle.background }}
        >
          <Plus size={16} />
          Add game
        </Button>
      </div>

      <AddGameModal open={addModalOpen} onOpenChange={setAddModalOpen} mode={modalMode} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{loadingText}</p>
      ) : isError ? (
        <p className="text-sm text-destructive">{errorText}</p>
      ) : games.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-24 text-center">
          <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <GameGrid games={games} onSelectGame={onSelectGame} />
      )}
    </div>
  );
};
