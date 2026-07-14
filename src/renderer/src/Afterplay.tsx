import { useState } from 'react';
import { TooltipProvider } from './components/ui/tooltip';
import { GameDetail } from './screens/GameDetail';
import { Library } from './screens/Library';

// Shell raíz de la app. Navegación Library <-> GameDetail por estado local,
// no por router — el rail de navegación lateral y el routing de verdad
// (SPEC 10.6) llegan con el Bloque 3A, esto es solo lo que 2G necesita para
// poder abrir el detalle de un juego.
const Afterplay = (): React.JSX.Element => {
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  return (
    <TooltipProvider>
      {selectedGameId === null ? (
        <Library onSelectGame={setSelectedGameId} />
      ) : (
        <GameDetail gameId={selectedGameId} onBack={() => setSelectedGameId(null)} />
      )}
    </TooltipProvider>
  );
};

export default Afterplay;
