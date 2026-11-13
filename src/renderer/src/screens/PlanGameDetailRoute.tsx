import { useNavigate, useParams } from 'react-router-dom';
import { parseEntityId } from '../../../shared/entityIds';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { PlanGameDetail } from './PlanGameDetail';

// Mismo papel que GameDetailRoute: traducir la URL a props para que la
// pantalla no sepa nada de router. Al promocionar, el juego deja de existir
// en /plan — su nueva casa es la ficha normal de la biblioteca.
export const PlanGameDetailRoute = (): React.JSX.Element => {
  const { id } = useParams();
  const navigate = useNavigate();
  const gameId = parseEntityId(id);
  // Mismo final que GameDetailRoute con un id ilegible.
  if (gameId === null) {
    return (
      <QueryStatePlaceholder
        isLoading={false}
        errorText="Couldn't load this game."
        backLabel="Back to plan"
        onBack={() => navigate('/plan', { viewTransition: true })}
      />
    );
  }
  return (
    <PlanGameDetail
      gameId={gameId}
      // viewTransition — mismo cross-fade nativo que GameDetailRoute, mismo
      // motivo (ver el comentario allí).
      onBack={() => navigate('/plan', { viewTransition: true })}
      onPromoted={() => navigate(`/games/${id}`)}
    />
  );
};
