import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './queryKeys';

// El watcher del main (Bloque 3) escribe sesiones directamente en la DB, sin
// pasar por ninguna mutation del renderer, así que el caché de ['games'] no se
// enteraría por su cuenta. Aquí nos suscribimos al aviso IPC que el main emite
// tras cada arranque/cierre de sesión e invalidamos ['games'] — que cascada
// por prefijo a ['games', id] — para que biblioteca y detalle se refresquen en
// tiempo real (card a "PLAYING", horas recalculadas al cerrar, etc.).
export const useWatcherSync = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.watcher.onGamesChanged(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      // El watcher también crea/cierra sesiones directo en la DB — la vista
      // de Sesiones (Bloque 5A) necesita el mismo aviso que games.all.
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    });
  }, [queryClient]);
};
