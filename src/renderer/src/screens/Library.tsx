import { useNavigate } from 'react-router-dom';
import { GameListScreen } from '../components/library/GameListScreen';
import { useGames } from '../hooks/games';

export const Library = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [], isLoading, isError, refetch } = useGames();

  return (
    <GameListScreen
      title="Library"
      subtitle="Click a cover to view details"
      emptyTitle="No games yet"
      emptyText="Add your first game to start tracking it."
      loadingText="Loading your library…"
      errorText="Something went wrong loading your library. Try again in a moment."
      games={games}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      scrollKey="library"
      onSelectGame={(id) => navigate(`/games/${id}`)}
    />
  );
};
