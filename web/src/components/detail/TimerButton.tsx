import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { ApiFailure, fetchActiveTimer, startTimer } from '../../api';
import { GREEN } from '../../lib/status';

// Empezar a cronometrar ESTE juego (REMOTO.md §7).
//
// Existe porque jugar en una Switch o una PS5 es hoy invisible para la app: no
// hay proceso que vigilar. Y el cronómetro pide móvil por definición — estás
// en el sofá con el mando de la consola, no te vas a levantar al PC para darle
// a empezar.
//
// Lo que abre es una sesión NORMAL: cuenta en el heatmap, las rachas y los
// momentos igual que cualquier otra.
export const TimerButton = ({
  gameId,
  gameTitle,
}: {
  gameId: number;
  gameTitle: string;
}): React.JSX.Element | null => {
  const queryClient = useQueryClient();
  const timer = useQuery({ queryKey: ['timer'], queryFn: fetchActiveTimer });

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

  return (
    <div>
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-[14px] border py-3.5 text-[13.5px] font-bold"
        style={{ color: GREEN, borderColor: `${GREEN}4d`, background: `${GREEN}14` }}
      >
        {start.isPending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Play size={15} fill="currentColor" />
        )}
        Start a session
      </button>

      <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
        For consoles and anything Afterplay can&apos;t see running. Counts as a normal session.
      </p>

      {/* Los choques llegan como 409 con su frase: ya hay una sesión abierta,
          el playthrough está cerrado, el juego no tiene ninguno. Todos son
          cosas que se pueden entender y resolver, así que se dicen tal cual en
          vez de con un "algo ha ido mal". */}
      {start.isError && (
        <div className="mt-2 flex items-start gap-2 rounded-[11px] border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5">
          <AlertTriangle size={13} className="mt-0.5 flex-none text-destructive" />
          <span className="text-[11.5px] leading-relaxed text-muted-foreground">
            {start.error instanceof ApiFailure
              ? start.error.message
              : `No se pudo empezar a cronometrar ${gameTitle}.`}
          </span>
        </div>
      )}
    </div>
  );
};
