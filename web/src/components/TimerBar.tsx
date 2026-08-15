import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Square, X } from 'lucide-react';
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

// El tick de 1s vive en su propia hoja. Antes useLiveSeconds estaba en el
// cuerpo de TimerBar y cada segundo re-renderizaba la barra ENTERA — unos 13
// elementos (Link, Cover con su img, dos divs de texto, el botón y su icono
// svg) más la rama del aviso de error — para cambiar UN texto. Esta web no
// lleva el compilador de React (eso es del escritorio), así que la hoja es la
// memoización: mismo DOM y mismas clases, pero el tick re-renderiza 1
// componente con 1 div.
const ElapsedTime = ({ since }: { since: number }): React.JSX.Element => {
  const seconds = useLiveSeconds(since);
  return (
    <div className="text-[15px] font-extrabold text-primary tabular-nums">
      {formatElapsed(seconds)}
    </div>
  );
};

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
    // otro móvil, o la sesión puede haberse cerrado por llevar horas muda. Ese
    // cierre por abandono (§7.4) lo hace el propio Worker AL LEER esto, no
    // solo el barrido de arranque del escritorio, así que esta llamada no es
    // únicamente una lectura: es también lo que recoge el olvido de anoche.
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
          // La sesión ya no está abierta: la paró otro sitio, o el cierre por
          // abandono (§7.4) la recogió en su último latido —lo hace el Worker
          // al leer /api/timer, y el escritorio una vez por arranque—. Sea
          // quien sea, que la barra se entere sola en vez de seguir contando
          // una sesión que ya no existe.
          if (!alive) void queryClient.invalidateQueries({ queryKey: ['timer'] });
        })
        .catch(() => {
          // Un latido perdido no es nada: el siguiente llega en un minuto, y
          // si no llega ninguno, el cierre por abandono (§7.4) la recoge —el
          // Worker al leer /api/timer, el escritorio al arrancar—. Molestar
          // aquí con un error sería ruido.
        });
    };

    const id = setInterval(beat, BEAT_MS);
    return () => clearInterval(id);
  }, [sessionId, queryClient]);

  const stop = useMutation({
    mutationFn: (id: number) => stopTimer(id),
    onSuccess: () => {
      // Todo lo que acaba de cambiar: la sesión ya cuenta horas.
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
    // El cronómetro se relee falle o no. Un parar rechazado con 409 suele
    // significar que esa sesión YA estaba parada (la paraste desde otra
    // pestaña), y sin esto la barra seguía contando una sesión que no existe
    // hasta el refetch del minuto siguiente.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['timer'] });
    },
  });

  // El aviso de un parar fallido pertenece a LA SESIÓN que se intentó parar
  // (stop.variables guarda su id). Si en pantalla aparece OTRO cronómetro
  // —arrancado desde el PC o el otro móvil, recogido por el refetch del
  // minuto— el aviso viejo ya no habla de nada visible y se descarta solo.
  // Sin esto la tira sobrevivía a su sesión: como la frase se elige mirando
  // `active`, el mismo cartel cambiaba solo de "ya estaba parada" a
  // "sigue contando — try again" debajo de un cronómetro sano que nadie
  // había intentado parar, hasta que alguien pulsara la X.
  useEffect(() => {
    if (stop.isError && active !== null && active.sessionId !== stop.variables) {
      stop.reset();
    }
  }, [active, stop]);

  // El armazón sigue en pie sin cronómetro si hay un aviso que leer. No es un
  // capricho: el fallo MÁS común del parar es el 409 "esa sesión ya estaba
  // parada", y ese mismo fallo hace que el refetch de onSettled devuelva null,
  // así que con el `return null` de antes el aviso se montaba y se desmontaba
  // en el mismo parpadeo. El único error que se llegaba a leer era el que
  // dejaba la sesión viva.
  if (!active && !stop.isError) return null;

  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-border bg-[#0a0b0a]/95 backdrop-blur-lg"
      // Justo encima de la barra de pestañas, respetando el notch inferior.
      style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }}
    >
      {active && (
        <div
          className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2"
          style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
        >
          <Link to={`/game/${active.gameId}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Cover url={active.coverUrl} title={active.gameTitle} className="w-8" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-bold">{active.gameTitle}</div>
              <ElapsedTime since={active.startedAt} />
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
      )}

      {/* Un parar que no llegó. El fallo era TOTALMENTE mudo —el botón giraba,
          volvía a su sitio y el contador seguía subiendo—, el mismo defecto
          que el buzón del Plan ya tenía cazado, y aquí pesa más porque el
          parar explícito es la orden que MANDA sobre el latido (§7.5): si se
          pierde y no se dice, se pierde la hora de fin de verdad.

          Del error no se lee el `message`: los TimerError del Worker están en
          español ('esa sesión ya estaba parada') y el fallo de red de api.ts
          también ('No se pudo hablar con Afterplay.'), o sea que pintarlos
          dejaba una frase en español en una interfaz en inglés. Lo que sí se
          mira es si QUEDA cronómetro, porque es lo que cambia el consejo: si
          sigue contando, el parar hay que repetirlo; si ha desaparecido es que
          el Worker ya no ve ninguna sesión viva y no queda nada que parar. Y
          se dice así, "sigue contando aquí", y no "sigue en marcha": con la
          red caída el parar puede haber llegado y haberse perdido solo la
          respuesta, y afirmar el estado del servidor desde aquí sería
          inventárselo.

          La X sigue haciendo falta para el caso SIN otra sesión: el descarte
          automático de arriba solo salta cuando aparece un cronómetro que no
          es el del aviso. Un fallo de red sobre la sesión que sigue en
          pantalla se queda escrito —correctamente— hasta que lo leas o
          reintentes. */}
      {stop.isError && (
        <div className="mx-auto flex max-w-lg items-start gap-2 px-4 py-2">
          <AlertTriangle size={12} className="mt-0.5 flex-none text-destructive" />
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
            {active
              ? "Couldn't stop the timer — it's still counting here. Try again."
              : 'That timer had already stopped, so there was nothing left to stop.'}
          </span>
          <button
            type="button"
            onClick={() => stop.reset()}
            aria-label="Dismiss"
            className="-mt-1 -mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-lg text-muted-foreground"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
