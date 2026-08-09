import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Square } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { beatTimer, fetchActiveTimer, stopTimer } from '../api';
import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { formatElapsed } from '../lib/format';
import { Cover } from './Cover';

// ~1 por minuto (REMOTO.md §7.4). Una sesión de tres horas son 180 peticiones,
// nada frente a las 100.000 diarias del plan gratuito. El watcher del
// escritorio late cada ~5s porque puede; aquí sería quemar peticiones sin
// ganar nada.
const BEAT_MS = 60_000;

// La barra del cronómetro en marcha, encima de las pestañas.
//
// Va en el armazón y no dentro de una pantalla a propósito: un cronómetro
// corriendo tiene que verse estés donde estés, y sobre todo tiene que poder
// PARARSE desde donde estés. Si viviera en la ficha del juego, pararlo
// obligaría a volver a buscarlo.
export const TimerBar = (): React.JSX.Element | null => {
  const queryClient = useQueryClient();

  const timer = useQuery({
    queryKey: ['timer'],
    queryFn: fetchActiveTimer,
    // Se refresca sola de vez en cuando: el cronómetro puede haberlo parado el
    // otro móvil, o el escritorio puede haberla cerrado por llevar horas muda.
    refetchInterval: BEAT_MS,
  });

  const active = timer.data ?? null;
  const sessionId = active?.sessionId ?? null;

  // El latido. Vive aquí y no en la pantalla del juego porque tiene que seguir
  // latiendo con la app en cualquier sección.
  //
  // Ojo con lo que el latido NO es: un techo. Los navegadores móviles
  // suspenden las pestañas de fondo sin piedad, así que esto se va a parar
  // mientras sigues jugando. No pasa nada — al pulsar "parar" manda el parar y
  // se registra el tiempo entero (§7.5). El latido solo decide cuando nunca
  // llegaste a pararlo.
  useEffect(() => {
    if (sessionId === null) return;

    const beat = (): void => {
      void beatTimer(sessionId)
        .then(({ alive }) => {
          // El escritorio la cerró por abandono: que la barra se entere sola
          // en vez de seguir contando una sesión que ya no existe.
          if (!alive) void queryClient.invalidateQueries({ queryKey: ['timer'] });
        })
        .catch(() => {
          // Un latido perdido no es nada: el siguiente llega en un minuto, y
          // si no llega ninguno, el umbral de abandono del escritorio hace su
          // trabajo. Molestar aquí con un error sería ruido.
        });
    };

    const id = setInterval(beat, BEAT_MS);
    return () => clearInterval(id);
  }, [sessionId, queryClient]);

  const stop = useMutation({
    mutationFn: (id: number) => stopTimer(id),
    onSuccess: () => {
      // Todo lo que acaba de cambiar: la sesión ya cuenta horas.
      void queryClient.invalidateQueries({ queryKey: ['timer'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
  });

  const seconds = useLiveSeconds(active?.startedAt ?? null);
  if (!active) return null;

  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-border bg-[#0a0b0a]/95 backdrop-blur-lg"
      // Justo encima de la barra de pestañas, respetando el notch inferior.
      style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}
    >
      <div
        className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2"
        style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
      >
        <Link to={`/game/${active.gameId}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Cover url={active.coverUrl} title={active.gameTitle} className="w-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-bold">{active.gameTitle}</div>
            <div className="text-[15px] font-extrabold text-primary tabular-nums">
              {formatElapsed(seconds)}
            </div>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => stop.mutate(active.sessionId)}
          disabled={stop.isPending}
          aria-label="Stop the timer"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full border"
          style={{
            color: '#e85d72',
            borderColor: '#e85d7255',
            background: '#e85d7218',
          }}
        >
          {stop.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Square size={15} fill="currentColor" />
          )}
        </button>
      </div>
    </div>
  );
};
