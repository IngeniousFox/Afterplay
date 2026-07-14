import { useNavigate, useParams } from 'react-router-dom';
import { GameDetail } from './GameDetail';

// GameDetail no sabe nada de router — este wrapper traduce el :id de la URL
// y el "volver" a navegación, así el componente sigue siendo reutilizable.
export const GameDetailRoute = (): React.JSX.Element => {
  const { id } = useParams();
  const navigate = useNavigate();
  return <GameDetail gameId={Number(id)} onBack={() => navigate('/games')} />;
};
