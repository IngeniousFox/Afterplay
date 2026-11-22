import { Check, Flame, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatSessionDuration } from '../../../shared/sessionDuration';
import type { SessionClosedEvent } from '../../../shared/types';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { celebrate, GlowText, Ticker } from '../components/fx';
import { formatHours } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import { quickStatusOptions, STATUS_META, STATUS_TO_STATE_TYPE } from '../lib/gameStatus';
import { TV_MODAL_SWALLOW, useTvButtons } from './tvInput';
import { TvFocusLayer } from './focus';
import { TV_CELEBRATE_DELAY_MS, TV_LONG_SESSION_SEC, TV_TICKER_MS } from './styles';
import { TvButton, TvCoverArt, TvFigure } from './tvUi';

// El cierre de sesión, versión sofá (BIG-PICTURE.md §5.4): el mismo remate
// que el toast de escritorio — duración, total, récord y los botones rápidos
// de estado del Loop (§6) — pero como panel centrado a escala TV y SIN campo
// de nota (teclear es de escritorio; el hint lo recuerda). No se va solo:
// un panel modal con mando se descarta con B o con Continue, sin cuenta
// atrás que te meta prisa desde la otra punta del salón.
//
// "El mismo remate" es literal donde importa: la duración la formatea
// shared/sessionDuration y los desenlaces los da quickStatusOptions
// (lib/gameStatus). Las dos reglas estaban copiadas aquí a mano, así que el
// sofá y el escritorio podían acabar contando el mismo cierre de sesión de
// dos maneras sin que nada lo cantara — no se ven nunca a la vez.

export const TvSessionPanel = ({
  event,
  onClose,
}: {
  event: SessionClosedEvent;
  onClose: () => void;
}): React.JSX.Element => {
  const [marked, setMarked] = useState<PastStatusKey | null>(null);
  const addStateEvent = useAddStateEvent();
  const heroSrc = useImageSrc(event.heroUrl, 'heroes');

  // B descarta el panel — registrado en la pila de botones, así que gana al
  // "atrás" de navegación de la pantalla de debajo mientras esté abierto.
  useTvButtons({ ...TV_MODAL_SWALLOW, b: onClose });

  const markState = async (key: PastStatusKey): Promise<void> => {
    if (marked !== null || addStateEvent.isPending) return;
    try {
      await addStateEvent.mutateAsync({
        iterationId: event.iterationId,
        type: STATUS_TO_STATE_TYPE[key],
        occurredAt: new Date(),
        datePrecision: 'datetime',
      });
    } catch {
      // Mismo aviso que el StatusPicker de TvGameDetail: `marked` sigue en
      // null (no se miente diciendo que se guardó), pero antes el botón se
      // quedaba sin hacer nada visible. Un panel de cierre de sesión es un
      // sitio típico para "marcar como pasado".
      toast.error('Could not save the status.');
      return;
    }
    setMarked(key);
    if (key === 'beaten') celebrate('beaten');
  };

  // EL REMATE: la duración entra contando y, cuando aterriza, las chispas
  // salen de ella — las de récord si es tu sesión más larga con el juego,
  // las de sesión si pasó de una hora (styles.ts: TV_LONG_SESSION_SEC). Una
  // vez por panel; si se cierra antes, no hay chispas.
  const durationRef = useRef<HTMLSpanElement>(null);
  const kind = event.isLongest
    ? 'record'
    : event.durationSec >= TV_LONG_SESSION_SEC
      ? 'session'
      : null;
  useEffect(() => {
    if (kind === null) return undefined;
    const timer = setTimeout(
      () => celebrate(kind, { origin: durationRef.current }),
      TV_CELEBRATE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [kind]);

  return (
    <TvFocusLayer>
      <div className="absolute inset-0 z-30 flex items-center justify-center">
        <div
          className="absolute inset-0 animate-[fade-in_220ms_var(--ease-out)_both] bg-scrim"
          onClick={onClose}
        />
        {/* El panel de tvpwa-tv-menus.png: Overlay con sombra de modal, la
            carátula a la izquierda y la duración enorme en Phosphor. No se
            cierra solo: B o Continue. */}
        <div className="relative w-[44em] max-w-[90vw] animate-dialog-in overflow-hidden rounded-md border border-line-strong bg-overlay shadow-modal">
          {heroSrc && (
            <>
              <img
                src={heroSrc}
                alt=""
                className="absolute inset-y-0 right-0 h-full w-[60%] object-cover opacity-30"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-overlay)_45%,rgb(36_44_49/0.6)_100%)]" />
            </>
          )}

          <div className="relative flex gap-[1.6em] px-[1.8em] py-[1.7em]">
            <TvCoverArt
              game={{ title: event.gameTitle, coverUrl: event.coverUrl }}
              className="w-[8.2em] flex-none self-start border border-line-strong shadow-lift"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-[0.7em]">
              <div className="flex items-center gap-[0.45em] text-[1.05em] text-dust">
                <Timer className="size-[1em]" />
                Session ended
              </div>
              <div className="-mt-[0.3em] font-display text-[2em] leading-tight font-bold text-bone">
                {event.gameTitle}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-[0.6em]">
                <span ref={durationRef} className="text-[5em]">
                  <Ticker
                    value={event.durationSec}
                    format={(seconds) => formatSessionDuration(Math.round(seconds))}
                    duration={TV_TICKER_MS}
                    render={(seconds) => (
                      <GlowText flicker>
                        <TvFigure
                          value={formatSessionDuration(Math.round(seconds))}
                          className="text-phosphor"
                          unitClassName="text-[0.6em] font-bold text-phosphor"
                        />
                      </GlowText>
                    )}
                  />
                </span>
                <span className="text-[1.05em] text-dust tabular-nums">
                  · {formatHours(event.totalHours)} total
                </span>
              </div>

              {event.isLongest && (
                <div className="flex items-center gap-[0.5em] self-start rounded-md border border-phosphor/40 bg-phosphor-tint px-[0.9em] py-[0.5em] text-[1.05em] font-semibold text-phosphor">
                  <Flame className="size-[1em] flex-none" />
                  Your longest session with this game
                </div>
              )}

              {marked !== null ? (
                <div className="mt-[0.3em] flex items-center gap-[0.8em]">
                  <div className="flex items-center gap-[0.5em] rounded-md border border-line-strong bg-raised px-[0.9em] py-[0.55em] text-[1.05em] font-semibold text-bone">
                    <Check className="size-[1em] text-success" />
                    Marked as {STATUS_META[marked].label}
                  </div>
                  <div className="flex-1" />
                  {/* La salida sigue AQUI tras marcar: sin este boton, un
                      usuario de solo raton quedaba encerrado. autoFocus: los
                      botones de estado acaban de desmontarse y el foco quedo
                      suelto. */}
                  <TvButton
                    label="Continue"
                    variant="primary"
                    autoFocus
                    silent
                    onSelect={onClose}
                  />
                </div>
              ) : (
                <div className="mt-[0.3em] flex items-center gap-[0.8em]">
                  {quickStatusOptions(event.endless).map((key) => {
                    const meta = STATUS_META[key];
                    return (
                      <TvButton
                        key={key}
                        label={meta.label}
                        icon={<meta.Icon className="size-[0.9em]" />}
                        onSelect={() => void markState(key)}
                      />
                    );
                  })}
                  <div className="flex-1" />
                  <TvButton
                    label="Continue"
                    variant="primary"
                    autoFocus
                    silent
                    onSelect={onClose}
                  />
                </div>
              )}

              <div className="text-[0.95em] text-dust">
                You can write the session note from your desk.
              </div>
            </div>
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};
