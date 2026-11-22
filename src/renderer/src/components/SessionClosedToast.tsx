import { Check, Clock3, Flame, NotebookPen, Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatSessionDuration } from '../../../shared/sessionDuration';
import type { SessionClosedEvent } from '../../../shared/types';
import { useGameAchievements } from '../hooks/achievements';
import { useSetSessionNote } from '../hooks/sessions';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { percentLabel } from '../lib/achievements';
import { formatHours } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import { quickStatusOptions, STATUS_META, STATUS_TO_STATE_TYPE } from '../lib/gameStatus';
import { requestAchievementFlash } from '../lib/achievementFlash';
import { expandClass } from '../lib/styles';
import { celebrate, GlowText, pressClass, PressButton, Stagger, Ticker } from './fx';
import { Figure } from './sessions/Figure';
import {
  buttonSize,
  focusRing,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './shell/controls';
import { GameCover } from './GameCover';
import { AchievementMiniIcon } from './sessions/SessionAchievements';

// El aviso de "acabas de cerrar X": duración, total acumulado y —lo que de
// verdad importa— el sitio donde escribir el diario de sesión EN CALIENTE.
//
// Nunca es un modal, y esa decisión es el diseño entero: los cierres suelen
// pasar con la app en la bandeja, así que un diálogo por cierre significaría
// volver a la app y encontrarte una cola de interrogatorios pendientes. Aquí
// no se pregunta, se OFRECE: el toast se retira solo, no bloquea nada, y la
// nota se puede escribir igual (o corregir) después desde la fila de la
// sesión, que es su sitio de verdad.
//
// Se ve como una FICHA del juego, no como un mensaje de sistema: hero de
// fondo tras un velo y carátula al lado, el mismo lenguaje visual que
// GameBanner y HeroBanner. Tiene que llamar la atención — es el remate de
// haber estado jugando, no una notificación de que algo se ha guardado.
//
// Rock and roll: entra ENCENDIÉNDOSE como un tubo (power-on), la duración
// cuenta hasta su valor como un marcador, el récord se enciende con bloom,
// destello y chispas, los trofeos que llegan entran uno a uno con un brillo,
// y la cuenta atrás es un haz que se va consumiendo con la punta al rojo.

// El récord se celebra cuando el aviso ya está encendido (el power-on dura
// 760 ms): las chispas salen de una banda que se ve, no de un tubo a medias.
const RECORD_AT_MS = 620;

// Las cifras intermedias del conteo, redondeadas a segundos enteros.
const durationText = (seconds: number): string => formatSessionDuration(Math.round(seconds));

type SessionClosedToastProps = {
  event: SessionClosedEvent;
  toastId: string | number;
  durationMs: number;
  onOpenGame: () => void;
};

// AFTERPLAY-LOOP.md §6 — el estado rápido vive AQUÍ y no en una bandeja de
// pendientes: si el toast se va sin pulsar, no queda nada esperándote — el
// estado se cambia desde la ficha como toda la vida. QUÉ desenlaces se
// ofrecen lo decide quickStatusOptions (lib/gameStatus), compartido con el
// panel del modo TV: es el mismo gesto en dos pieles y estaba copiado.

export const SessionClosedToast = ({
  event,
  toastId,
  durationMs,
  onOpenGame,
}: SessionClosedToastProps): React.JSX.Element => {
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  // El campo de la nota se abre con Add note, EN SU SITIO (sin modal) — y
  // nunca solo: robar el foco al llegar pausaría la cuenta atrás para siempre.
  const [noteOpen, setNoteOpen] = useState(false);
  // Estado rápido ya elegido en este toast (null = sin tocar). Se queda a la
  // vista como acuse de recibo — el toast sigue su cuenta atrás normal, que
  // marcar el desenlace no te roba el hueco de escribir la nota.
  const [marked, setMarked] = useState<PastStatusKey | null>(null);
  const setSessionNote = useSetSessionNote();
  const addStateEvent = useAddStateEvent();
  const heroSrc = useImageSrc(event.heroUrl, 'heroes');
  const recordRef = useRef<HTMLDivElement | null>(null);

  // Un récord: chispas desde su banda, una vez por aviso. El destello de la
  // propia banda es CSS (abajo), con el mismo retraso.
  useEffect(() => {
    if (!event.isLongest) return undefined;
    const timer = setTimeout(
      () => celebrate('record', { origin: recordRef.current }),
      RECORD_AT_MS,
    );
    return () => clearTimeout(timer);
  }, [event.isLongest]);
  // Partida en cifra y unidad para pintar el número grande y la "m" pequeña
  // sin que el conjunto parezca texto plano.

  // Los trofeos de ESTA sesión, llegando EN VIVO al aviso (LOGROS-IDEAS.md
  // §2.2): el cierre dispara la sincronización del juego, que tarda un par
  // de segundos — menos de lo que vive el toast. La query es la misma de la
  // ficha (cacheada, invalidada desde la raíz con cada 'synced'), así que
  // cuando el main termina, la banda aparece sola debajo de la duración: el
  // resumen de la noche completándose delante de ti.
  const { data: achievementsData } = useGameAchievements(event.gameId);
  const sessionAchievements = (achievementsData?.entries ?? []).filter(
    (entry) => entry.sessionId === event.sessionId && entry.unlockedAt !== null,
  );
  const rarestPercent = sessionAchievements.reduce<number | null>(
    (rarest, entry) =>
      entry.globalPercent !== null && (rarest === null || entry.globalPercent < rarest)
        ? entry.globalPercent
        : rarest,
    null,
  );

  const save = async (): Promise<void> => {
    if (!note.trim() || setSessionNote.isPending) return;
    try {
      await setSessionNote.mutateAsync({ id: event.sessionId, note });
    } catch {
      // Antes esto no se atrapaba en ningún sitio: la nota escrita se perdía
      // como una promesa rechazada sin dueño, y el input se quedaba tal cual
      // sin decir que el guardado no había funcionado — y encima la cuenta
      // atrás del toast seguía corriendo, así que hasta podía cerrarse solo
      // llevándose la nota sin dejar ni rastro.
      toast.error('Could not save the note.');
      return;
    }
    setSaved(true);
    // Un respiro para que se vea el acuse de recibo antes de irse — cerrar
    // en seco deja la duda de si se guardó.
    setTimeout(() => toast.dismiss(toastId), 900);
  };

  const markState = async (key: PastStatusKey): Promise<void> => {
    if (marked !== null || addStateEvent.isPending) return;
    try {
      // La puerta de siempre (§6): addStateEvent garantiza el invariante de
      // un-activo-por-juego, y su cierre de sesión abierta aquí no encuentra
      // ninguna — la sesión acaba de cerrarse.
      await addStateEvent.mutateAsync({
        iterationId: event.iterationId,
        type: STATUS_TO_STATE_TYPE[key],
        occurredAt: new Date(),
        datePrecision: 'datetime',
      });
    } catch {
      // Fallo al escribir (DB ocupada, lo que sea): el botón sigue ahí y se
      // puede reintentar — o marcarlo después desde la ficha, como siempre.
      // El toast.error es lo que faltaba: TvSessionPanel ya lo hace para
      // este mismo fallo, y aquí se quedaba mudo — el clic parecía no haber
      // hecho nada.
      toast.error('Could not save the status.');
      return;
    }
    setMarked(key);
    // Terminarte un juego es EL momento del ciclo — el confeti está para esto.
    if (key === 'beaten') celebrate('beaten');
  };

  return (
    <div
      className={cn(
        // `afterplay-toast` es el gancho del arreglo de alto de Sonner en
        // main.css (el aviso crece cuando llegan los logros).
        'afterplay-toast group/toast relative w-full origin-center animate-power-on overflow-hidden rounded-md border border-line-strong bg-overlay font-sans font-normal shadow-float motion-reduce:animate-fade-in',
      )}
    >
      {/* Zona héroe: el banner del juego tras un velo que lo funde con el
          panel, y las líneas de escaneo. Da identidad al aviso sin comerse la
          legibilidad. */}
      {heroSrc && (
        <div aria-hidden className="absolute inset-0">
          <img src={heroSrc} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-r from-overlay/97 via-overlay/92 to-overlay/70" />
        </div>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-(image:--scan)" />

      <div className="relative flex flex-col gap-3 px-4 pt-4 pb-4.5">
        <div className="flex items-start gap-3.5">
          <button
            type="button"
            onClick={onOpenGame}
            title="Open game"
            aria-label={`Open ${event.gameTitle}`}
            className={cn(
              'flex-none rounded-sm transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
              focusRing,
            )}
          >
            <GameCover
              url={event.coverUrl}
              className="h-17 w-12.5 overflow-hidden rounded-sm border border-line-strong shadow-lift"
              iconSize={16}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-small text-dust">
              <Clock3 aria-hidden size={13} />
              Session ended
            </div>
            <button
              type="button"
              onClick={onOpenGame}
              className={cn(
                'mt-0.5 block max-w-full rounded-xs text-left text-lead font-semibold text-bone hover:underline underline-offset-2',
                focusRing,
              )}
            >
              {event.gameTitle}
            </button>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <Ticker
                value={event.durationSec}
                format={durationText}
                duration={1100}
                render={(seconds) => (
                  <Figure
                    value={durationText(seconds)}
                    className="text-[40px] text-phosphor [text-shadow:var(--shadow-glow-text)]"
                    unitClassName="text-phosphor/75"
                  />
                )}
              />
              <span className="text-small text-dust">· {formatHours(event.totalHours)} total</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => toast.dismiss(toastId)}
            aria-label="Dismiss"
            title="Dismiss"
            className={cn(iconButtonClass, 'size-7.5 -mt-1 -mr-1.5')}
          >
            <X aria-hidden size={15} />
          </button>
        </div>

        {/* El récord es LA noticia cuando pasa: se lleva su propia banda. */}
        {event.isLongest && (
          <div
            ref={recordRef}
            className="relative isolate flex items-center gap-2 overflow-hidden rounded-sm border border-phosphor/25 bg-phosphor-tint px-3 py-2 text-small font-semibold text-phosphor"
          >
            {/* El destello: la banda entera se enciende en ámbar y se apaga. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 animate-[press-flash_900ms_var(--ease-out)_620ms_both] bg-[radial-gradient(ellipse_at_20%_50%,rgb(255_226_180/0.55),rgb(255_179_71/0.25)_45%,transparent_80%)]"
            />
            <Flame
              aria-hidden
              size={14}
              className="flex-none drop-shadow-[0_0_6px_rgb(255_179_71/0.8)]"
            />
            <GlowText flicker className="[animation-delay:520ms]">
              Your longest session with this game
            </GlowText>
          </div>
        )}

        {/* Los trofeos de la noche, llegando EN VIVO: la sync corre al cerrar
            y esta banda aparece (expandClass) en cuanto el main los cuelga de
            la sesión, mientras el toast sigue en pantalla. Banda en Tube
            (información); el aro de rareza va en cada icono. */}
        {sessionAchievements.length > 0 && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-sm border border-tube/25 bg-tube/8 px-3 py-1.5 text-tube',
              expandClass,
            )}
            title={
              rarestPercent !== null
                ? `Rarest: ${percentLabel(rarestPercent)} of players`
                : undefined
            }
          >
            <Trophy aria-hidden size={14} className="flex-none" />
            <span className="flex-none text-small font-semibold">
              {sessionAchievements.length === 1
                ? 'Achievement unlocked'
                : `${sessionAchievements.length} achievements`}
            </span>
            {/* Llegan uno a uno, saltando a su sitio con un brillo Tube que
                se apaga. Se reparte otra vez si la sync trae más. */}
            <Stagger
              variant="pop"
              step={70}
              replayKey={sessionAchievements.length}
              className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1"
            >
              {[...sessionAchievements]
                .sort(
                  (a, b) =>
                    (a.globalPercent ?? Number.POSITIVE_INFINITY) -
                    (b.globalPercent ?? Number.POSITIVE_INFINITY),
                )
                .slice(0, 6)
                .map((entry, index) => (
                  <span key={entry.id} className="relative flex-none">
                    <AchievementMiniIcon
                      entry={{
                        achievementId: entry.id,
                        displayName: entry.displayName,
                        iconUrl: entry.iconUrl,
                        globalPercent: entry.globalPercent,
                      }}
                      // Pulsar el trofeo lleva a SU logro, no a la ficha a
                      // secas (LOGROS-REDISENO §1): se pide el parpadeo y se
                      // reutiliza el mismo onOpenGame del toast, que ya navega
                      // y lo descarta.
                      onOpen={(achievementId) => {
                        requestAchievementFlash(achievementId);
                        onOpenGame();
                      }}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-0.5 animate-[press-flash_900ms_var(--ease-out)_both] rounded-[7px] shadow-[0_0_0_1px_rgb(95_211_224/0.8),0_0_12px_rgb(95_211_224/0.7)]"
                      style={{ animationDelay: `${index * 70 + 120}ms` }}
                    />
                  </span>
                ))}
            </Stagger>
          </div>
        )}

        {saved ? (
          <div className="flex items-center gap-2 rounded-sm border border-st-beaten/30 bg-st-beaten/8 px-3 py-2 text-small font-semibold text-st-beaten">
            <Check aria-hidden size={14} />
            Saved — you&apos;ll see it when you come back.
          </div>
        ) : noteOpen ? (
          <div className={cn('flex items-center gap-2', expandClass)}>
            {/* Se enfoca porque lo has pedido tú (Add note). Mientras tiene el
                foco, la cuenta atrás se para: si escribes, el aviso espera. */}
            <input
              autoFocus
              value={note}
              onChange={(changeEvent) => setNote(changeEvent.target.value)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === 'Enter') void save();
                if (keyEvent.key === 'Escape') toast.dismiss(toastId);
              }}
              placeholder="Where did you leave off?"
              aria-label="Session note"
              className="h-9 min-w-0 flex-1 rounded-sm border border-edge bg-inset/85 px-3 text-body font-normal text-bone outline-hidden placeholder:text-dust focus:border-phosphor focus:shadow-focus-field"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={!note.trim() || setSessionNote.isPending}
              className={cn(primaryButtonClass, 'size-9 px-0')}
              aria-label="Save note"
            >
              <Check aria-hidden size={16} />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className={cn(secondaryButtonClass, buttonSize.md, pressClass)}
            >
              <NotebookPen aria-hidden size={14} />
              Add note
            </button>
            <PressButton
              burst="phosphor"
              onClick={onOpenGame}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              Open game
            </PressButton>
          </div>
        )}

        {/* Estado rápido (AFTERPLAY-LOOP.md §6): "¿y cómo acabó?" como oferta,
            no como pregunta que persigue. Tras pulsar, el acuse ocupa el sitio
            de los chips con el color del estado — y el toast sigue su cuenta
            atrás normal: marcar el desenlace no roba el hueco de la nota. */}
        {marked !== null ? (
          <div
            className="flex items-center gap-2 rounded-sm border px-3 py-2 text-small font-semibold"
            style={{
              color: STATUS_META[marked].color,
              borderColor: `${STATUS_META[marked].color}40`,
              background: `${STATUS_META[marked].color}14`,
            }}
          >
            <Check aria-hidden size={14} className="flex-none" />
            Marked as {STATUS_META[marked].label}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-small text-dust">How did it end?</span>
            {quickStatusOptions(event.endless).map((key) => {
              const meta = STATUS_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void markState(key)}
                  disabled={addStateEvent.isPending}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-inset/60 px-2.5 text-small font-semibold text-bone',
                    'transition-[background-color,border-color] duration-150 ease-out hover:border-line-hover hover:bg-raised disabled:opacity-50',
                    focusRing,
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 flex-none rounded-full"
                    style={{ background: meta.color }}
                  />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cuenta atrás de 3 px: un HAZ que se consume. Se pinta solo mientras
          el toast se pueda ir solo: tras guardar, el cierre lo controla el
          propio guardado y una barra corriendo ahí sería mentira. Se para con
          el ratón encima o con el foco dentro, igual que el propio Sonner.

          El haz entero se desliza hacia la izquierda (transform, sin
          repintar) y el aviso, con su overflow-hidden, lo va recortando: la
          punta, al rojo blanco, se come la barra de derecha a izquierda. Es
          información (cuánto queda), así que corre también con reduced
          motion. */}
      {!saved && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.75 bg-bone/8">
          <div
            className="afterplay-toast-countdown relative h-full animate-[afterplay-burn_var(--afterplay-toast-duration,15s)_linear_forwards] group-focus-within/toast:[animation-play-state:paused] group-hover/toast:[animation-play-state:paused]"
            style={{ '--afterplay-toast-duration': `${durationMs}ms` } as React.CSSProperties}
          >
            <div className="h-full bg-linear-to-r from-phosphor/45 via-phosphor/85 to-phosphor shadow-glow-bar" />
            <div className="absolute inset-y-0 right-0 w-8 bg-linear-to-r from-transparent to-[rgb(255_236_200)] shadow-[0_0_10px_2px_rgb(255_179_71/0.75)]" />
          </div>
        </div>
      )}
    </div>
  );
};
