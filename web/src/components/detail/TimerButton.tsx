import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, Play, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, fetchActiveTimer, startTimer } from '../../api';
import type { StateType } from '../../api';
import { cn } from '../../lib/cn';
import { formatHours } from '../../lib/format';
import { statusOf } from '../../lib/status';
import { ghostButtonClass, primaryButtonClass, statusTextClass } from '../../lib/styles';
import { Cover } from '../Cover';
import { Led } from '../Figure';
import { Sheet } from '../Sheet';

// Empezar a cronometrar ESTE juego (REMOTO.md §7).
//
// Existe porque jugar en una Switch o una PS5 es hoy invisible para la app: no
// hay proceso que vigilar. Y el cronómetro pide móvil por definición — estás
// en el sofá con el mando de la consola, no te vas a levantar al PC para darle
// a empezar.
//
// Lo que abre es una sesión NORMAL: cuenta en el heatmap, las rachas y los
// momentos igual que cualquier otra. El botón de la ficha abre una hoja que lo
// confirma con el juego delante; el arranque de verdad es el de la hoja.
export const TimerButton = ({
  gameId,
  gameTitle,
  coverUrl,
  state,
  totalHours,
  className,
}: {
  gameId: string;
  gameTitle: string;
  coverUrl: string | null;
  state: StateType | null;
  totalHours: number;
  className?: string;
}): React.JSX.Element | null => {
  const queryClient = useQueryClient();
  const timer = useQuery({ queryKey: ['timer'], queryFn: fetchActiveTimer });
  const [open, setOpen] = useState(false);

  const start = useMutation({
    mutationFn: () => startTimer(gameId),
    // LA MISMA lista que al parar (TimerBar), porque arrancar cambia lo mismo:
    // no abre solo una sesión — si el playthrough no estaba en marcha, escribe
    // además su 'started' en el mismo batch (queries/timer.ts). O sea que el
    // juego pasa de Unplayed/On Hold a Playing, sube su sessionCount y aparece
    // el bloque `live` del resumen.
    //
    // Sin esto, con staleTime de 30 s y sin refetch al navegar por dentro del
    // router, volver a la portada dentro de esos 30 s la enseñaba SIN la tarjeta
    // de "jugando ahora" y con el juego contado como Unplayed, mientras la barra
    // de abajo ya contaba.
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['timer'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['game', gameId] });
    },
  });

  // Con el cronómetro ya en marcha —en este juego o en otro— no se ofrece otro:
  // la barra de abajo ya lo enseña y es donde se para. Dos sesiones vivas a la
  // vez serían horas contadas dos veces.
  if (timer.data) return null;

  const status = statusOf(state);
  const close = (): void => {
    if (start.isPending) return;
    start.reset();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(primaryButtonClass, className)}
      >
        <Play size={15} fill="currentColor" aria-hidden="true" />
        Start timer
      </button>

      {open && (
        <Sheet title="Start a session" onClose={close}>
          <div className="flex items-center gap-3 rounded-md border border-line bg-panel p-3">
            <Cover url={coverUrl} title={gameTitle} className="w-11" />
            <div className="min-w-0 flex-1">
              <div className="text-body font-semibold text-bone">{gameTitle}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-small text-dust">
                <Led state={state} />
                <span className={statusTextClass(state)}>{status.label}</span>
                {totalHours > 0 && <span>· {formatHours(totalHours)} played</span>}
              </div>
            </div>
          </div>

          <p className="mt-3 flex items-start gap-2 text-small text-dust">
            <Info size={15} className="mt-0.5 shrink-0 text-tube" aria-hidden="true" />
            For consoles and anything Afterplay can&apos;t see running. Counts as a normal session.
          </p>

          {/* Los choques llegan como 409 con su frase ("ese juego se está jugando
              en PC-A", "ya hay un cronómetro en marcha"). Son cosas que se pueden
              entender y resolver, así que se dicen tal cual en vez de con un "algo
              ha ido mal". */}
          {start.isError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-sm border border-live/45 bg-live/8 px-3 py-2.5"
            >
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-live" aria-hidden="true" />
              <span className="text-small text-bone">
                {start.error instanceof ApiFailure
                  ? start.error.message
                  : `Couldn't start a timer for ${gameTitle}.`}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => start.mutate()}
            disabled={start.isPending}
            aria-busy={start.isPending}
            className={cn(primaryButtonClass, 'mt-4 w-full')}
          >
            {start.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              !start.isError && <Play size={15} fill="currentColor" aria-hidden="true" />
            )}
            {start.isError ? 'Try again' : 'Start timer'}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={start.isPending}
            className={cn(ghostButtonClass, 'mt-1 w-full')}
          >
            Cancel
          </button>
        </Sheet>
      )}
    </>
  );
};
