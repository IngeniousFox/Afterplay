import { toast } from 'sonner';
import { useRefreshGameEverything } from './external';
import type { GameFullRefreshResult } from '../../../shared/types';

// El gesto "actualízalo TODO" de UN juego, entero: la llamada, el parte y los
// avisos. Vivía dentro de ActionBar.tsx, que es la barra de la ficha de
// BIBLIOTECA — y los planeados tienen la suya propia (screens/PlanGameDetail),
// que no pasa por esa barra, además de su fila en el Plan. O sea que su única
// vía para ponerse al día era refrescar la biblioteca entera: minutos para
// actualizar uno. Aquí lo comparten los TRES sitios sin duplicar ni la lógica
// ni el texto. El botón fantasma de la fila vive en
// components/RefreshGameButton.tsx: separados porque un fichero que exporta
// componentes no puede exportar también hooks
// (react-refresh/only-export-components).

// Qué entró de verdad en el refresco completo, en una frase.
//
// Se enumera lo que SÍ llegó y no lo que faltó, a propósito: aquí terminar a
// medias es lo normal (un juego de consola no tiene nada de Steam, HLTB no
// reconoce a los muy raros) y una lista de "no pudo con esto, ni con esto"
// leería como un fallo cada vez que se pulsa un botón que funciona bien.
export const describeRefresh = (result: GameFullRefreshResult): string => {
  const got: string[] = [];
  // 'adopted' cuenta, y cuenta MÁS que un 'updated': es el juego que estaba
  // dado de alta solo con Steam y acaba de estrenar ficha ENTERA de IGDB —
  // título, carátula, sinopsis, sagas, notas y fecha de golpe (adoptIgdb.ts).
  // Aquí solo se miraba === 'updated', así que el refresco que más cambia era
  // justo el que decía "nada nuevo" cuando además HLTB no lo reconocía y
  // SteamSpy no traía datos.
  if (result.igdb === 'adopted') got.push('its whole IGDB entry');
  else if (result.igdb === 'updated') got.push('ratings, summary and release date');
  if (result.hltb === 'updated') got.push('how long to beat');
  if (result.steamSpy === 'updated') got.push('Steam tags and reviews');
  if (result.achievements === 'queued') got.push('achievements');
  if (got.length === 0) return 'Nothing new came back — everything is kept as it was.';
  const list =
    got.length === 1 ? got[0] : `${got.slice(0, -1).join(', ')} and ${got[got.length - 1]}`;
  return `Updated ${list}.`;
};

export const useRefreshGame = (
  gameId: number,
  title: string,
): { refresh: () => void; refreshing: boolean } => {
  const refreshEverything = useRefreshGameEverything();

  const refresh = (): void => {
    refreshEverything.mutate(gameId, {
      onSuccess: (result) => {
        if (!result) {
          toast.error("This game isn't in the library anymore.");
          return;
        }
        // El appid recién encontrado es LA noticia, y se dice como tal: es lo
        // que acaba de abrirle a este juego sus etiquetas, sus reseñas y sus
        // logros, que hasta hoy la app daba por imposibles.
        if (result.steam === 'found') {
          toast.success('Found this game on Steam', { description: describeRefresh(result) });
          return;
        }
        // Y su gemela: el juego que vivía con los datos provisionales de la
        // tienda y acaba de entrar en el catálogo de IGDB. Es lo más gordo que
        // le puede pasar a una ficha (cambia de fuente entera), así que se
        // cuenta como titular y no escondido en la lista de abajo. No compite
        // con la rama de arriba: adoptar solo corre si YA había appid
        // (refreshGame.ts), así que en una adopción steam vale 'had-it'.
        if (result.igdb === 'adopted') {
          toast.success('Found this game on IGDB', { description: describeRefresh(result) });
          return;
        }
        toast.success(`${title} refreshed`, { description: describeRefresh(result) });
      },
      // Solo salta si falla el viaje entero: cada fuente se cae sola por
      // dentro y eso ya lo cuenta el parte de arriba.
      onError: () => toast.error("Couldn't refresh — data kept as it was."),
    });
  };

  return { refresh, refreshing: refreshEverything.isPending };
};
