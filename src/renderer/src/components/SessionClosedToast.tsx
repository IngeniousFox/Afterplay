import { Check, Clock3, Flame, NotebookPen, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatSessionDuration } from '../../../shared/sessionDuration';
import type { SessionClosedEvent } from '../../../shared/types';
import { useGameAchievements } from '../hooks/achievements';
import { useSetSessionNote } from '../hooks/sessions';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { percentLabel } from '../lib/achievements';
import { celebrateCompletion } from '../lib/celebrate';
import { formatHours } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import { quickStatusOptions, STATUS_META, STATUS_TO_STATE_TYPE } from '../lib/gameStatus';
import { requestAchievementFlash } from '../lib/achievementFlash';
import { expandClass } from '../lib/styles';
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
    if (key === 'beaten') celebrateCompletion();
  };

  return (
    <div
      className={cn(
        // `afterplay-toast` es el gancho del arreglo de alto de Sonner en
        // main.css (el aviso crece cuando llegan los logros).
        'afterplay-toast group/toast relative w-full animate-toast-in overflow-hidden rounded-md border border-line-strong bg-overlay font-sans font-normal shadow-float',
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
              <Figure
                value={formatSessionDuration(event.durationSec)}
                className="text-[40px] text-phosphor [text-shadow:var(--shadow-glow-text)]"
                unitClassName="text-phosphor/75"
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
          <div className="flex items-center gap-2 rounded-sm border border-phosphor/25 bg-phosphor-tint px-3 py-2 text-small font-semibold text-phosphor">
            <Flame aria-hidden size={14} className="flex-none" />
            Your longest session with this game
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
            <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
              {[...sessionAchievements]
                .sort(
                  (a, b) =>
                    (a.globalPercent ?? Number.POSITIVE_INFINITY) -
                    (b.globalPercent ?? Number.POSITIVE_INFINITY),
                )
                .slice(0, 6)
                .map((entry) => (
                  <AchievementMiniIcon
                    key={entry.id}
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
                ))}
            </span>
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
              className={cn(secondaryButtonClass, buttonSize.md)}
            >
              <NotebookPen aria-hidden size={14} />
              Add note
            </button>
            <button
              type="button"
              onClick={onOpenGame}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              Open game
            </button>
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

      {/* Cuenta atrás de 3 px. Se pinta solo mientras el toast se pueda ir
          solo: tras guardar, el cierre lo controla el propio guardado y una
          barra corriendo ahí sería mentira. Se para con el ratón encima o con
          el foco dentro, igual que el propio Sonner. */}
      {!saved && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.75 bg-bone/8">
          <div
            className="afterplay-toast-countdown h-full origin-left animate-[afterplay-grow-x_var(--afterplay-toast-duration,15s)_linear_reverse_forwards] bg-phosphor shadow-glow-bar group-focus-within/toast:[animation-play-state:paused] group-hover/toast:[animation-play-state:paused]"
            style={{ '--afterplay-toast-duration': `${durationMs}ms` } as React.CSSProperties}
          />
        </div>
      )}
    </div>
  );
};
