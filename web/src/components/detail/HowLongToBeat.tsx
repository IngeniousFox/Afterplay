import { Check, Hourglass } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../api';
import { cn } from '../../lib/cn';
import { formatHours } from '../../lib/format';
import { Figure } from '../Figure';
import { chartGroup, growY } from '../fx/chart';
import { useInView } from '../fx/viewport';
import { SectionLabel } from './primitives';

type TierKey = 'main' | 'extra' | 'completionist';

const TIER_LABEL: Record<TierKey, string> = {
  main: 'Main Story',
  extra: '+ Extra',
  completionist: '100%',
};

// Cuántos segmentos tiene el medidor. El medidor HLTB de Fósforo es una fila de
// barritas (como un VU), encendidas en Phosphor hasta tus horas.
const SEGMENTS = 48;

type Props = {
  game: GameDetail;
  // El marcador compara contra el playthrough ELEGIDO, no contra el total: es
  // lo que hace que cambiar de playthrough arriba mueva la marca aquí. Para un
  // endless no hay playthroughs que comparar, así que son las horas totales.
  markerHours: number;
  markerScope: 'playthrough' | 'total';
};

// How long to beat: tres tramos (main / main+extra / 100%) y tus horas sobre
// ellos. Se toca un tramo para fijarlo y ver cuánto falta para él (o cuánto te
// pasaste); se vuelve a tocar para soltarlo.
export const HowLongToBeat = ({ game, markerHours, markerScope }: Props): React.JSX.Element => {
  const [activeTier, setActiveTier] = useState<TierKey | null>(null);
  // El medidor se rellena la primera vez que entra en la vista.
  const { observe, inView } = useInView();

  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;

  // Sin match de HLTB. El hueco se queda en vez de desaparecer: que la sección
  // no exista no explica por qué no existe.
  if (main === 0 && extra === 0 && completionist === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-3">
        <Hourglass size={18} className="shrink-0 text-dust" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-semibold text-bone">How long to beat</div>
          <div className="text-small text-dust">No confident match yet</div>
        </div>
      </div>
    );
  }

  // Escala al MAYOR de los tres datos conocidos, no siempre a completionist.
  // HLTB no siempre trae los tres, y un dato ausente llega como 0: si fuera
  // justo completionist el que falta (el caso más común), escalar contra él
  // daría un denominador falso de 1h. Con el mayor de los tres, el marcador
  // cae donde toca.
  const scale = Math.max(main, extra, completionist, 1);
  const markerPct = Math.max(0, Math.min(100, (markerHours / scale) * 100));

  // Sin horas propias la sección es una estimación pura: no hay marcador que
  // poner ni tramo alcanzado, y decir "0h" sería ruido.
  const hasOwnHours = markerHours > 0;

  const tiers = [
    { key: 'main' as const, threshold: main },
    { key: 'extra' as const, threshold: extra },
    { key: 'completionist' as const, threshold: completionist },
  ].filter((tier) => tier.threshold > 0);

  const reached = (key: TierKey): boolean => {
    const tier = tiers.find((candidate) => candidate.key === key);
    return hasOwnHours && tier !== undefined && markerHours >= tier.threshold;
  };

  // El próximo hito sin alcanzar: de él sale el "quedan Xh" que se ve por
  // defecto, sin tener que tocar nada. Y el último alcanzado, para decirlo.
  const nextTier = hasOwnHours
    ? (tiers.find((tier) => tier.threshold > markerHours) ?? null)
    : null;
  const lastReached = hasOwnHours
    ? ([...tiers].reverse().find((tier) => markerHours >= tier.threshold) ?? null)
    : null;
  const activeDetail = activeTier ? tiers.find((tier) => tier.key === activeTier) : undefined;

  const toggle = (key: TierKey): void => setActiveTier((current) => (current === key ? null : key));

  // La frase de abajo: el tramo fijado si lo hay; si no, lo que dice el
  // marcador por sí solo.
  const note = ((): React.ReactNode => {
    if (activeDetail) {
      const diff = hasOwnHours ? activeDetail.threshold - markerHours : null;
      return (
        <>
          {TIER_LABEL[activeDetail.key]} takes about {formatHours(activeDetail.threshold)}
          {diff !== null && Math.abs(diff) >= 1 / 60 && (
            <>
              {diff > 0
                ? `, ${formatHours(diff)} to go.`
                : `, you are ${formatHours(-diff)} past it.`}
            </>
          )}
        </>
      );
    }
    if (!hasOwnHours) return null;
    if (lastReached) {
      return (
        <>
          <span className="font-semibold text-phosphor">{formatHours(markerHours)}</span>
          {lastReached.key === 'completionist'
            ? ', past the 100% estimate.'
            : `, already past the ${TIER_LABEL[lastReached.key]} estimate of ${formatHours(lastReached.threshold)}.`}
        </>
      );
    }
    if (nextTier) {
      return (
        <>
          <span className="font-semibold text-phosphor">{formatHours(markerHours)}</span> played,{' '}
          {formatHours(nextTier.threshold - markerHours)} to {TIER_LABEL[nextTier.key]}.
        </>
      );
    }
    return null;
  })();

  const filled = hasOwnHours ? Math.round((markerPct / 100) * SEGMENTS) : 0;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>How long to beat</SectionLabel>
        <span className="text-micro text-dust">HowLongToBeat</span>
      </div>
      <p className="mt-0.5 text-small text-dust">
        {!hasOwnHours
          ? 'Estimated times for this game'
          : markerScope === 'playthrough'
            ? "Marker shows this playthrough's hours"
            : "Marker shows what you've played"}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(['main', 'extra', 'completionist'] as const).map((key) => {
          const threshold = key === 'main' ? main : key === 'extra' ? extra : completionist;
          const active = activeTier === key;
          const done = reached(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={active}
              disabled={threshold === 0}
              className={cn(
                'flex min-h-16 flex-col items-start rounded-sm border px-2.5 py-2 text-left',
                'transition-[transform,scale,background-color,border-color,opacity] duration-150 active:scale-[.97] motion-reduce:active:scale-100',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor disabled:opacity-40',
                active
                  ? 'border-phosphor bg-phosphor-tint'
                  : done
                    ? 'border-line-strong bg-raised'
                    : 'border-line bg-panel',
                activeTier !== null && !active && 'opacity-60',
              )}
            >
              <span className="flex items-center gap-1 text-micro text-dust">
                {done && <Check size={12} className="text-phosphor" aria-hidden="true" />}
                {TIER_LABEL[key]}
              </span>
              <Figure
                value={threshold > 0 ? formatHours(threshold) : '—'}
                className={cn('mt-0.5 text-[30px] leading-8', done ? 'text-phosphor' : 'text-bone')}
              />
            </button>
          );
        })}
      </div>

      {/* El medidor: una barrita por segmento, encendida hasta tus horas, y una
          marca fina en cada tramo. Al entrar en la vista las encendidas suben
          desde la base una detrás de otra, como un VU que se llena. */}
      <div
        ref={observe}
        data-inview={inView || undefined}
        className={cn(chartGroup, 'relative mt-3')}
        aria-hidden="true"
      >
        <div className="flex h-5 gap-[2px]">
          {Array.from({ length: SEGMENTS }, (_, index) => (
            <span
              key={index}
              className={cn(
                'flex-1 rounded-xs',
                index < filled ? cn('bg-phosphor shadow-glow-bar', growY) : 'bg-bone/10',
              )}
              style={index < filled ? { animationDelay: `${index * 16}ms` } : undefined}
            />
          ))}
        </div>
        {tiers.map((tier) => (
          <span
            key={tier.key}
            className={cn(
              'absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full',
              activeTier === tier.key ? 'bg-phosphor' : 'bg-bone/60',
            )}
            style={{ left: `${Math.min(99.5, (tier.threshold / scale) * 100)}%` }}
          />
        ))}
      </div>

      {note && (
        <p className="mt-3 flex items-start gap-2 rounded-sm border border-phosphor/30 bg-phosphor-tint px-3 py-2.5 text-small text-bone">
          {lastReached && !activeDetail && (
            <Check size={15} className="mt-0.5 shrink-0 text-phosphor" aria-hidden="true" />
          )}
          <span>{note}</span>
        </p>
      )}
    </section>
  );
};
