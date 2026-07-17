import { useNavigate } from 'react-router-dom';
import { GameListScreen } from '../components/library/GameListScreen';
import { usePlannedGames } from '../hooks/games';

// Sección Plan to Play — el mismo aspecto que Library (grid + botón de Add
// game), pero sobre la lista de juegos planeados: todo lo que se añade aquí
// nace con el estado especial Plan to Play (modo 'plan' del modal) y no
// aparece en ninguna otra parte de la app hasta pasarlo a la biblioteca.
export const PlanToPlay = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [], isLoading, isError } = usePlannedGames();

  return (
    <GameListScreen
      title="Plan to play"
      subtitle="Games you want to play someday — move them to your library when the day comes"
      emptyTitle="Nothing planned yet"
      emptyText="Add a game you want to play someday — it won't clutter your library."
      loadingText="Loading your plan…"
      errorText="Something went wrong loading your plan. Try again in a moment."
      games={games}
      isLoading={isLoading}
      isError={isError}
      modalMode="plan"
      onSelectGame={(id) => navigate(`/plan/${id}`)}
    />
  );
};
