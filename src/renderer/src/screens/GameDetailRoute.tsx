import { useNavigate, useParams } from 'react-router-dom';
import { parseEntityId } from '../../../shared/entityIds';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { GameDetail } from './GameDetail';

// GameDetail no sabe nada de router — este wrapper traduce el :id de la URL
// y el "volver" a navegación, así el componente sigue siendo reutilizable.
export const GameDetailRoute = (): React.JSX.Element => {
  const { id } = useParams();
  const navigate = useNavigate();
  const gameId = parseEntityId(id);
  // Un id ilegible no casa con ninguna fila: el mismo final que la ficha de
  // un juego que ya no existe (GameDetail sin datos), sin pedir nada.
  if (gameId === null) {
    return (
      <QueryStatePlaceholder
        isLoading={false}
        errorText="Couldn't load this game."
        backLabel="Back to library"
        onBack={() => navigate('/games', { viewTransition: true })}
      />
    );
  }
  return (
    <GameDetail
      gameId={gameId}
      // viewTransition: envuelve el cambio de ruta en
      // document.startViewTransition() — el navegador hace un cross-fade
      // nativo entre el estado anterior y el nuevo en vez del corte seco de
      // siempre. Solo afecta a lo que REALMENTE cambia entre las dos capturas
      // (aquí, el contenido principal): NavRail y MiddleColumn son idénticos
      // en ambas, así que se funden consigo mismos sin parpadeo — no hace
      // falta aislar nada con view-transition-name a mano.
      onBack={() => navigate('/games', { viewTransition: true })}
      onMovedToPlan={() => navigate(`/plan/${id}`, { viewTransition: true })}
    />
  );
};
