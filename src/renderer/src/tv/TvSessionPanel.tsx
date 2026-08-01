import { Check, Flame, Timer } from 'lucide-react';
import { useState } from 'react';
import type { SessionClosedEvent } from '../../../shared/types';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { celebrateCompletion } from '../lib/celebrate';
import { AMBER, GREEN } from '../lib/colors';
import { formatHours } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import { STATUS_META, STATUS_TO_STATE_TYPE } from '../lib/gameStatus';
import { GameCover } from '../components/GameCover';
import { TV_MODAL_SWALLOW, useTvButtons } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable } from './focusContext';

// El cierre de sesión, versión sofá (BIG-PICTURE.md §5.4): el mismo remate
// que el toast de escritorio — duración, total, récord y los botones rápidos
// de estado del Loop (§6) — pero como panel centrado a escala TV y SIN campo
// de nota (teclear es de escritorio; el hint lo recuerda). No se va solo:
// un panel modal con mando se descarta con B o con Continue, sin cuenta
// atrás que te meta prisa desde la otra punta del salón.

const quickStatusOptions = (endless: boolean): PastStatusKey[] =>
  endless ? ['resting'] : ['beaten', 'dropped'];

const splitDuration = (seconds: number): string => {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const PanelButton = ({
  label,
  icon,
  color,
  autoFocus = false,
  silent = false,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  color?: string;
  autoFocus?: boolean;
  // silent: para Continue, que solo cierra — el cierre ya suena (popLayer).
  // Los botones de estado SÍ confirman: marcan de verdad y el panel sigue.
  silent?: boolean;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  const accent = color ?? GREEN;
  return (
    <button
      ref={ref}
      type="button"
      data-tv-sound={silent ? 'none' : undefined}
      onClick={onSelect}
      className="relative flex items-center gap-[0.5em] rounded-full px-[1.1em] py-[0.5em] text-[0.85em] font-bold transition-[background-color,box-shadow,translate] duration-150"
      style={
        focused
          ? {
              // El color del estado, PRESENTE: fondo más denso, anillo más
              // firme y un halo exterior — el botón se enciende, no se marca.
              background: `${accent}2e`,
              color: accent,
              boxShadow: `inset 0 0 0 2px ${accent}8c, 0 0 1.1em ${accent}47`,
              translate: '0 -0.15em',
            }
          : {
              background: 'rgba(0,0,0,.35)',
              color: 'var(--foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)',
            }
      }
    >
      {icon}
      {label}
      {focused && (
        // El latido del foco, fuera del marco solo como sombra (regla de la
        // casa): un halo que respira alrededor de la píldora encendida.
        <span
          aria-hidden
          className="afterplay-tv-ring pointer-events-none absolute -inset-[2px] rounded-full"
          style={{ boxShadow: `0 0 1.2em ${accent}40` }}
        />
      )}
    </button>
  );
};

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
      return;
    }
    setMarked(key);
    if (key === 'beaten') celebrateCompletion();
  };

  return (
    <TvFocusLayer>
      <div className="absolute inset-0 z-30 flex items-center justify-center">
        <div
          className="animate-in fade-in-0 absolute inset-0 bg-black/70 duration-250"
          onClick={onClose}
        />
        {/* El panel nace con el pop de la casa (pequeño-y-sube) en vez de un
            fade plano: es el remate de una sesión, no un diálogo cualquiera. */}
        <div className="afterplay-tv-pop relative w-[28em] overflow-hidden rounded-[0.9em] border border-white/[0.12] bg-[#141614] shadow-[0_2em_5em_rgba(0,0,0,.7)]">
          {heroSrc && (
            <>
              <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(18,20,19,.97) 0%, rgba(18,20,19,.9) 50%, rgba(18,20,19,.72) 100%)',
                }}
              />
            </>
          )}
          {/* Hairline de luz en el canto superior: el borde plano cuenta el
              marco, este pelo de luz cuenta que el panel flota. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)',
            }}
          />

          <div className="relative flex flex-col gap-[0.9em] px-[1.5em] py-[1.3em]">
            <div className="flex items-center gap-[1em]">
              <GameCover
                url={event.coverUrl}
                className="h-[5.2em] w-[3.7em] flex-none overflow-hidden rounded-[0.4em] border border-white/15"
                iconSize={20}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[0.4em] text-[0.62em] font-bold tracking-[.14em] text-muted-foreground">
                  <Timer className="h-[1.1em] w-[1.1em]" />
                  SESSION ENDED
                </div>
                <div className="mt-[0.2em] truncate text-[1.15em] font-extrabold">
                  {event.gameTitle}
                </div>
                <div className="mt-[0.15em] flex items-baseline gap-[0.45em]">
                  {/* La cifra es la protagonista del panel: un aliento de luz
                      verde detrás para que se lea como logro, no como dato. */}
                  <span
                    className="text-[1.5em] leading-none font-extrabold text-primary tabular-nums"
                    style={{ textShadow: `0 0 1.1em ${GREEN}59` }}
                  >
                    {splitDuration(event.durationSec)}
                  </span>
                  <span className="text-[0.75em] text-muted-foreground">
                    · {formatHours(event.totalHours)} total
                  </span>
                </div>
              </div>
            </div>

            {event.isLongest && (
              // La banda de récord, de fiesta: nace con pop, un halo ámbar
              // respira detrás del icono y un barrido de luz la cruza una vez
              // al aparecer. Todo DENTRO del marco (overflow-hidden).
              <div
                className="afterplay-tv-pop relative flex items-center gap-[0.55em] overflow-hidden rounded-[0.5em] px-[0.85em] py-[0.55em] text-[0.8em] font-bold"
                style={{
                  background: `linear-gradient(90deg, ${AMBER}29, ${AMBER}0f)`,
                  color: AMBER,
                  boxShadow: `inset 0 0 0 1px ${AMBER}40`,
                }}
              >
                <span
                  aria-hidden
                  className="afterplay-tv-glow pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse at 10% 50%, ${AMBER}38, transparent 62%)`,
                  }}
                />
                <span
                  aria-hidden
                  className="afterplay-tv-sheen pointer-events-none absolute inset-y-0 left-0 w-[45%]"
                  style={{
                    background: `linear-gradient(105deg, transparent, ${AMBER}3d, transparent)`,
                  }}
                />
                <Flame
                  className="relative h-[1.05em] w-[1.05em] flex-none"
                  style={{ filter: `drop-shadow(0 0 0.45em ${AMBER}aa)` }}
                />
                <span className="relative">Your longest session with this game</span>
              </div>
            )}

            {marked !== null ? (
              <div className="flex items-center gap-[0.6em]">
                {/* El acuse entra con pop: el "hecho" se planta en el panel
                    con el mismo gesto vivo con que nació el panel entero. */}
                <div
                  className="afterplay-tv-pop flex items-center gap-[0.5em] rounded-[0.5em] px-[0.85em] py-[0.5em] text-[0.85em] font-bold"
                  style={{
                    background: `${STATUS_META[marked].color}1f`,
                    color: STATUS_META[marked].color,
                    boxShadow: `inset 0 0 0 1px ${STATUS_META[marked].color}4d`,
                  }}
                >
                  <Check
                    className="h-[1em] w-[1em]"
                    style={{ filter: `drop-shadow(0 0 0.4em ${STATUS_META[marked].color}99)` }}
                  />
                  Marked as {STATUS_META[marked].label}
                </div>
                <div className="flex-1" />
                {/* La salida sigue AQUI tras marcar: sin este boton, un
                    usuario de solo raton quedaba encerrado (el velo cierra,
                    pero que la puerta se vea). autoFocus: los botones de
                    estado acaban de desmontarse y el foco quedo suelto. */}
                <PanelButton label="Continue" autoFocus silent onSelect={onClose} />
              </div>
            ) : (
              <div className="flex items-center gap-[0.6em]">
                {quickStatusOptions(event.endless).map((key) => {
                  const meta = STATUS_META[key];
                  return (
                    <PanelButton
                      key={key}
                      label={meta.label}
                      color={meta.color}
                      icon={<meta.Icon className="h-[1em] w-[1em]" />}
                      onSelect={() => void markState(key)}
                    />
                  );
                })}
                <div className="flex-1" />
                <PanelButton label="Continue" autoFocus silent onSelect={onClose} />
              </div>
            )}

            <div className="text-[0.68em] font-semibold text-muted-foreground/70">
              You can write the session note from your desk.
            </div>
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};
