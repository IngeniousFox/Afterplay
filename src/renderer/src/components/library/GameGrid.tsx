import type { GameListItem } from '../../../../shared/types';
import { GameCard } from './GameCard';

type GameGridProps = {
  games: GameListItem[];
  onSelectGame: (id: number) => void;
};

// SPEC 10.6 — auto-fill con mínimo 196px por card y 20px de gap.
export const GameGrid = ({ games, onSelectGame }: GameGridProps): React.JSX.Element => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-5">
    {games.map((game) => (
      <GameCard key={game.id} game={game} onSelect={() => onSelectGame(game.id)} />
    ))}
  </div>
);
