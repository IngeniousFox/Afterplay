import { cn } from '../../../lib/utils';
import { Check, Hourglass, Info, PartyPopper, RefreshCw } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { toast } from 'sonner';
import type { GameDetail } from '../../../../../shared/types';
import { useRefreshGameHltb } from '../../../hooks/hltb';
import { formatHours } from '../../../lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';

type HowLongToBeatCardProps = {
  game: GameDetail;
  // El marcador compara contra el playthrough elegido en el dropdown de al
  // lado (GameDetail resuelve cuál es y pasa sus horas aquí) — para un
  // endless no hay playthroughs que comparar entre sí, así que ahí siempre
  // son las horas totales del juego. 0 = todavía no se ha jugado (la ficha
  // del Plan): entonces la card es solo una estimación, sin marcador.
  markerHours: number;
  markerScope: 'playthrough' | 'total';
  // Stats tiene espacio para tratar la comparación como una pieza narrativa
  // completa. La ficha y Plan conservan la versión compacta del sidebar.
  variant?: 'compact' | 'dossier';
};

type TierKey = 'main' | 'extra' | 'completionist';

const MAIN = '#2bb6a6';
const EXTRA = '#3f7fe0';
const COMPLETIONIST = '#2fdc7e';
// Cortas a propósito: es el texto que aparece en la cabecera al pasar el
// ratón por un tramo, y esta card vive en un sidebar estrecho. "100%
// Completionist" era la más larga de las tres y, junto al resto del texto de
// la cabecera ("· 25h · 3h to go"), saltaba a dos líneas ahí — eso empujaba
// la barra hacia abajo, el ratón dejaba de estar sobre el tramo, el hover se
// cancelaba, la cabecera volvía a una línea, la barra subía... bucle de
// parpadeo infinito. whitespace-nowrap en el punto de uso es la defensa
// real; esto reduce además la probabilidad de que haga falta.
const TIER_LABEL: Record<TierKey, string> = {
  main: 'Main Story',
  extra: '+ Extra',
  completionist: '100%',
};
const TIER_COLOR: Record<TierKey, string> = {
  main: MAIN,
  extra: EXTRA,
  completionist: COMPLETIONIST,
};

// Cada tramo como tile con su propio color — el mismo lenguaje que los tiles
// de Playthrough (borde y fondo teñidos, etiqueta diminuta, número gordo). El
// alcanzado se enciende y lleva un check; el que está bajo el ratón (aquí o
// en la propia barra — sincronizados, mismo lenguaje que Status Breakdown)
// se realza y el resto se atenúa, para inspeccionar un tramo sin perder la
// referencia de los otros dos.
const TierTile = ({
  tierKey,
  color,
  label,
  value,
  reached,
  hovered,
  dimmed,
  onHover,
}: {
  tierKey: TierKey;
  color: string;
  label: string;
  value: string;
  reached: boolean;
  hovered: boolean;
  dimmed: boolean;
  onHover: (key: TierKey | null) => void;
}): React.JSX.Element => (
  <div
    onMouseEnter={() => onHover(tierKey)}
    onMouseLeave={() => onHover(null)}
    className="flex-1 rounded-[10px] border px-2 py-2.25 text-center transition-[opacity,box-shadow,border-color] duration-150"
    style={{
      opacity: dimmed ? 0.4 : 1,
      ...(reached || hovered
        ? { borderColor: `${color}5c`, background: `${color}17` }
        : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }),
      ...(hovered ? { boxShadow: `0 0 0 1px ${color}59, 0 0 14px ${color}33` } : {}),
    }}
  >
    <div className="mb-1.25 flex items-center justify-center gap-1">
      {reached ? (
        <Check size={10} color={color} strokeWidth={3.5} />
      ) : (
        <span className="size-2 flex-none rounded-[2px]" style={{ background: color }} />
      )}
      <span
        className="text-[9.5px] font-bold tracking-[.06em]"
        style={{ color: reached || hovered ? color : 'var(--muted-foreground)' }}
      >
        {label}
      </span>
    </div>
    <div
      className="text-[13.5px] font-extrabold tabular-nums"
      style={{ color: reached || hovered ? color : 'var(--foreground)' }}
    >
      {value}
    </div>
  </div>
);

// SPEC 10.7 / prototipo — barra de 3 tramos (main/main+extra/100%) + marcador
// vertical con las horas propias como posición relativa. Rediseño: los tramos
// crecen al entrar, el marcador aterriza encima con halo, los tres datos de
// referencia son tiles de su color con el alcanzado encendido, y ahora barra
// y tiles comparten hover (mismo lenguaje que Status Breakdown): pasar el
// ratón por cualquiera de los dos resalta ese tramo, atenúa el resto y saca
// en la cabecera cuánto falta (o cuánto se pasó) para llegar a él. Sin
// interacción, la cabecera ya adelanta sola cuánto queda para el próximo
// hito — no hace falta ni pasar el ratón para saber dónde estás.
export const HowLongToBeatCard = ({
  game,
  markerHours,
  markerScope,
  variant = 'compact',
}: HowLongToBeatCardProps): React.JSX.Element => {
  // Antes del early return de abajo: un hook nunca puede ser condicional.
  const [hoveredTier, setHoveredTier] = useState<TierKey | null>(null);
  const refresh = useRefreshGameHltb();

  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  const hasNoTimes = main === 0 && extra === 0 && completionist === 0;

  // SIN match de HLTB (todavía) — la card antes desaparecía entera aquí, y
  // con ella su botón de refrescar: un juego que no encontró match en el
  // alta (título raro, recién salido, demasiado nicho) se quedaba SIN
  // FORMA de volver a intentarlo, porque el único sitio donde vivía ese
  // botón era una card que él mismo hacía invisible. Este hueco se queda
  // en vez de desaparecer, con el mismo botón que la card completa.
  if (hasNoTimes) {
    return (
      <div
        className={cn(
          'rounded-[14px] px-5 py-4.5',
          'border border-border bg-card',
          variant === 'dossier'
            ? cn(
                'afterplay-game-hltb-empty',
                'rounded-[15px] relative overflow-hidden',
                'border border-white/[0.08]',
                '[background:radial-gradient(circle_at_0%_0%,rgba(43,182,166,0.04),transparent_35%),radial-gradient(circle_at_100%_100%,rgba(63,127,224,0.035),transparent_37%),var(--card)]',
                'shadow-[inset_0_1px_rgba(255,255,255,0.03)]',
              )
            : '',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 flex-none items-center justify-center rounded-full bg-white/[0.04] text-muted-foreground/50">
            <Hourglass size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold text-foreground">How long to beat</div>
            <div className="text-xs text-muted-foreground">No confident match yet</div>
          </div>
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate(game.id, {
                onSuccess: (times) => {
                  if (times) toast.success('Times found on HowLongToBeat.');
                  else toast.info('HowLongToBeat still has no confident match for this game.');
                },
                onError: () => toast.error('Could not reach HowLongToBeat.'),
              });
            }}
            title="Fetch times from HowLongToBeat"
            aria-label="Fetch times from HowLongToBeat"
            className="flex size-7 flex-none items-center justify-center rounded-full text-muted-foreground/60 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
          >
            <RefreshCw size={13} className={refresh.isPending ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>
    );
  }

  // Escala la barra al mayor de los tres datos que SÍ conocemos — no siempre
  // a completionist. HLTB no siempre trae los tres tiempos; un dato que
  // falta llega como 0 igual que uno genuinamente 0, y si fuera justo
  // completionist el que falta (el caso más común: main+extra sí, 100% no),
  // escalar contra él da un denominador falso de 1h — los segmentos se
  // salen del 100% (el bug real: nada de verde, marcador siempre al borde).
  // Con el mayor de los tres, main+extra suman como mucho 100% y el
  // marcador cae donde toca de verdad.
  const scale = Math.max(main, extra, completionist, 1);
  const segMain = (main / scale) * 100;
  const segExtra = (Math.max(0, extra - main) / scale) * 100;
  // Resto hasta 100, no su propio cálculo independiente: segMain y segExtra
  // ya vienen de divisiones en coma flotante, y sumar un TERCER cálculo
  // igual de independiente (completionist - extra) / scale podía quedarse
  // una fracción de píxel corto de 100 sin que ninguno de los tres "hiciera
  // nada mal" por separado. Ese hueco, contra la esquina redondeada del
  // contenedor (overflow-hidden), se veía como si la barra terminara cortada
  // en vez de redonda — el fix real es garantizar la suma exacta, no el
  // propio valor de este tramo.
  const segComp = Math.max(0, 100 - segMain - segExtra);
  const markerPct = Math.max(0, Math.min(100, (markerHours / scale) * 100));

  // Sin horas propias (ficha del Plan) la card es una estimación pura: no hay
  // marcador que poner ni tramo que dar por alcanzado, y decir "0h" sería
  // ruido — el juego no es que se haya jugado cero, es que aún no toca.
  const hasOwnHours = markerHours > 0;
  const reachedTier: TierKey | null = !hasOwnHours
    ? null
    : completionist > 0 && markerHours >= completionist
      ? 'completionist'
      : extra > 0 && markerHours >= extra
        ? 'extra'
        : main > 0 && markerHours >= main
          ? 'main'
          : null;

  // El próximo hito sin alcanzar (el primer umbral, con datos, mayor que tus
  // horas) — de él sale el "quedan Xh" que se ve por defecto sin tocar nada,
  // igual que Genre Spread siempre adelanta "mostly X" o Status Breakdown el
  // total a la derecha.
  const tiers: { key: TierKey; threshold: number }[] = (
    [
      { key: 'main', threshold: main },
      { key: 'extra', threshold: extra },
      { key: 'completionist', threshold: completionist },
    ] satisfies { key: TierKey; threshold: number }[]
  ).filter((tier) => tier.threshold > 0);
  const nextTier = hasOwnHours
    ? (tiers.find((tier) => tier.threshold > markerHours) ?? null)
    : null;

  const hoveredDetail =
    hoveredTier && tiers.some((tier) => tier.key === hoveredTier)
      ? tiers.find((tier) => tier.key === hoveredTier)
      : undefined;

  if (variant === 'dossier') {
    const dossierTiers = [
      { key: 'main' as const, threshold: main },
      { key: 'extra' as const, threshold: extra },
      { key: 'completionist' as const, threshold: completionist },
    ];
    const dossierSegments = [
      { key: 'main' as const, width: segMain, color: MAIN },
      { key: 'extra' as const, width: segExtra, color: EXTRA },
      { key: 'completionist' as const, width: segComp, color: COMPLETIONIST },
    ];

    return (
      <div
        className={cn(
          'afterplay-game-hltb-dossier',
          'rounded-[15px] relative overflow-hidden px-5.5 py-5.25',
          'border border-white/[0.08]',
          '[background:radial-gradient(circle_at_0%_0%,rgba(43,182,166,0.04),transparent_35%),radial-gradient(circle_at_100%_100%,rgba(63,127,224,0.035),transparent_37%),var(--card)]',
          'shadow-[inset_0_1px_rgba(255,255,255,0.03)]',
          'before:absolute before:top-[0] before:right-[8%] before:left-[8%] before:h-[1px]',
          'before:[background:linear-gradient(90deg,transparent,#2bb6a6,#3f7fe0,#2fdc7e,transparent)]',
          "before:content-[''] before:opacity-[0.4]",
        )}
      >
        <div className="afterplay-game-hltb-header flex items-start justify-between gap-4.5">
          <div className="flex flex-col">
            <span className="afterplay-game-hltb-kicker flex items-center gap-1.25 text-[10px] font-black tracking-[0.14em] text-[#2bb6a6]">
              <Hourglass size={11} /> PACE COMPARISON
            </span>
            <strong className="mt-1 text-[18px] font-black tracking-[-0.02em] text-foreground">
              You vs HowLongToBeat
            </strong>
            <small className="mt-0.5 text-[11.5px] text-white/[0.43]">
              Your real playtime against the community&apos;s landmarks
            </small>
          </div>
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate(game.id, {
                onSuccess: (times) => {
                  if (times) toast.success('Times updated from HowLongToBeat.');
                  else
                    toast.info('HowLongToBeat has no confident match — times kept as they were.');
                },
                onError: () => toast.error('Could not reach HowLongToBeat.'),
              });
            }}
            title="Re-fetch times from HowLongToBeat"
            aria-label="Refresh times"
            className={cn(
              'afterplay-game-hltb-refresh',
              'flex size-7 flex-none items-center justify-center rounded-[8px] text-white/[0.42]',
              'border border-white/[0.075] bg-white/[0.025]',
              '[&:is(:hover,:focus-visible)]:border-[rgba(43,182,166,0.3)]',
              '[&:is(:hover,:focus-visible)]:bg-[rgba(43,182,166,0.07)] [&:is(:hover,:focus-visible)]:text-[#2bb6a6]',
              '[&:is(:hover,:focus-visible)]:transform-[rotate(14deg)]',
              '[transition:color_180ms_ease,border-color_180ms_ease,background-color_180ms_ease,transform_240ms_cubic-bezier(0.22,1,0.36,1)]',
              'motion-reduce:animate-none motion-reduce:transition-none',
            )}
          >
            <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div className="afterplay-game-hltb-stage [@media(width<=760px)]:grid-cols-[minmax(0,1fr)] mt-4.75 grid grid-cols-[190px_minmax(0,_1fr)] gap-6.25">
          <div
            className={cn(
              'afterplay-game-hltb-you',
              'relative flex min-w-0 flex-col justify-center pt-2.25 pr-5.5 pb-2.25 pl-0.5',
              'border-r border-r-white/[0.065]',
              '[@media(width<=760px)]:pt-[5px] [@media(width<=760px)]:pr-[0] [@media(width<=760px)]:pb-[17px]',
              '[@media(width<=760px)]:pl-[0] [@media(width<=760px)]:border-r-0 [@media(width<=760px)]:border-b',
              '[@media(width<=760px)]:border-b-white/[0.065]',
            )}
          >
            <span className="afterplay-game-hltb-you-label [&_i]:bg-(--primary) [&_i]:shadow-[0_0_5px_rgba(47,220,126,0.28)] flex items-center gap-1.5 text-[10px] font-black tracking-[0.13em] text-white/[0.39]">
              <i className="size-1.5 rounded-[50%]" /> YOUR TIME
            </span>
            <strong className="mt-1.25 text-[41px] leading-none font-[950] tracking-[-0.055em] text-foreground">
              {hasOwnHours ? formatHours(markerHours) : '—'}
            </strong>
            <small className="mt-1 text-[11px] text-white/[0.43]">
              {markerScope === 'total' ? 'across every playthrough' : 'in this playthrough'}
            </small>

            <div
              className={cn(
                'afterplay-game-hltb-verdict',
                'mt-3.25 flex min-h-10 flex-col justify-center rounded-[8px] px-2.25 py-2',
                'border border-white/[0.055] bg-white/[0.02]',
                '[&>span]:text-[10.5px] [&>span]:font-black [&>span]:leading-[1.25] [&>span]:tracking-[0.09em]',
                '[&>span]:whitespace-normal',
              )}
            >
              {hoveredDetail ? (
                <HeaderDetail
                  color={TIER_COLOR[hoveredDetail.key]}
                  label={TIER_LABEL[hoveredDetail.key]}
                  threshold={hoveredDetail.threshold}
                  markerHours={hasOwnHours ? markerHours : null}
                />
              ) : hasOwnHours && nextTier ? (
                <>
                  <span style={{ color: TIER_COLOR[nextTier.key] }}>
                    {formatHours(nextTier.threshold - markerHours)} TO GO
                  </span>
                  <small className="mt-0.25 text-[10.5px] text-white/[0.44]">
                    until {TIER_LABEL[nextTier.key]}
                  </small>
                </>
              ) : hasOwnHours && reachedTier === 'completionist' ? (
                <>
                  <span style={{ color: COMPLETIONIST }}>ALL TARGETS CLEARED</span>
                  <small className="mt-0.25 text-[10.5px] text-white/[0.44]">
                    {formatHours(markerHours - completionist)} beyond 100%
                  </small>
                </>
              ) : (
                <small className="mt-0.25 text-[10.5px] text-white/[0.44]">
                  Community targets ready
                </small>
              )}
            </div>
          </div>

          <div className="afterplay-game-hltb-race min-w-0">
            <div className="afterplay-game-hltb-race-head flex items-baseline justify-between gap-2.5">
              <span className="text-[10px] font-black tracking-[0.13em] text-white/[0.46]">
                THE PACE LINE
              </span>
              <small className="text-[10px] text-white/[0.39]">
                {formatHours(scale)} community ceiling
              </small>
            </div>

            <div className="afterplay-game-hltb-track-wrap relative mx-1.75 mt-11.75 mb-0">
              {hasOwnHours && (
                <div
                  className={cn(
                    'afterplay-game-hltb-marker',
                    'absolute -top-5 z-3 h-8.75 w-0.5',
                    'bg-(--foreground) shadow-[0_0_0_2px_rgba(12,14,13,0.78),0_0_6px_rgba(255,255,255,0.24)]',
                    'transform-[translateX(-1px)]',
                    '[&_em]:border [&_em]:border-white/[0.11] [&_em]:bg-[#202421]',
                    '[&_em]:shadow-[0_4px_9px_rgba(0,0,0,0.27)] [&_em]:transform-[translate(-50%,-100%)] [&_i]:border',
                    '[&_i]:border-[rgba(12,14,13,0.85)] [&_i]:bg-(--foreground)',
                    '[&_i]:shadow-[0_0_4px_rgba(255,255,255,0.28)]',
                    '[&.is-beyond_em]:right-[0] [&.is-beyond_em]:left-[auto] [&.is-beyond_em]:text-(--primary)',
                    '[&.is-beyond_em]:transform-[translate(1px,-100%)]',
                    'animate-[afterplay-game-hltb-marker-in_560ms_cubic-bezier(0.22,1,0.36,1)_520ms_backwards]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                    markerHours > scale ? 'is-beyond' : '',
                  )}
                  style={{ left: `${markerPct}%` }}
                >
                  <em className="absolute -top-0.25 left-[50%] rounded-[5px] px-1.5 py-1 text-[8.5px] font-[950] tracking-[0.09em] text-foreground not-italic">
                    {markerHours > scale ? 'BEYOND' : 'YOU'}
                  </em>
                  <i className="absolute -right-0.5 -bottom-0.25 size-1.5 rounded-[50%]" />
                </div>
              )}
              <div
                className={cn(
                  'afterplay-game-hltb-track',
                  'flex h-3.5 overflow-hidden rounded-[99px]',
                  'bg-white/[0.035] shadow-[inset_0_2px_5px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,255,255,0.025)]',
                  '[&>span]:[--tier-color:var(--primary)]',
                  '[&>span]:[background:linear-gradient(180deg,color-mix(in_srgb,var(--tier-color)_88%,white),var(--tier-color))]',
                  '[&>span]:shadow-[inset_-1px_0_rgba(10,12,11,0.45)] [&>span]:origin-left',
                  '[&>span]:[transition:opacity_170ms_ease,filter_180ms_ease]',
                  '[&>span]:animate-[afterplay-game-hltb-track-in_700ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
                  '[&>span.is-hovered]:filter-[brightness(1.08)_saturate(1.06)]',
                  'motion-reduce:[&>span]:animate-none motion-reduce:[&>span]:transition-none',
                )}
              >
                {dossierSegments.map((segment, index) => {
                  const isHovered = hoveredTier === segment.key;
                  return (
                    <span
                      key={segment.key}
                      onMouseEnter={() => setHoveredTier(segment.key)}
                      onMouseLeave={() => setHoveredTier(null)}
                      className={`block h-full ${isHovered ? 'is-hovered' : ''}`}
                      style={
                        {
                          '--tier-color': segment.color,
                          width: `${segment.width}%`,
                          opacity: hoveredTier !== null && !isHovered ? 0.28 : 1,
                          animationDelay: `${index * 110}ms`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </div>
            </div>

            <div className="afterplay-game-hltb-milestones mt-4.75 grid grid-cols-3 gap-2">
              {dossierTiers.map((tier) => {
                const color = TIER_COLOR[tier.key];
                const available = tier.threshold > 0;
                const reached = available && hasOwnHours && markerHours >= tier.threshold;
                const isHovered = hoveredTier === tier.key;
                return (
                  <div
                    key={tier.key}
                    tabIndex={available ? 0 : -1}
                    role="group"
                    aria-label={`${TIER_LABEL[tier.key]}, ${available ? formatHours(tier.threshold) : 'no estimate'}${reached ? ', reached' : ''}`}
                    onMouseEnter={() => available && setHoveredTier(tier.key)}
                    onMouseLeave={() => setHoveredTier(null)}
                    onFocus={() => available && setHoveredTier(tier.key)}
                    onBlur={() => setHoveredTier(null)}
                    className={cn(
                      'afterplay-game-hltb-milestone',
                      'relative grid min-h-17.5 min-w-0 grid-cols-[30px_minmax(0,_1fr)] items-center gap-2 rounded-[9px]',
                      'p-2.25',
                      '[--tier-color:var(--primary)] border border-white/[0.055] outline-none bg-white/[0.018]',
                      '[&.is-reached:not(:where(.is-hovered,:hover,:focus-visible))]:border-[color-mix(in_srgb,var(--tier-color)_23%,rgba(255,255,255,0.04))]',
                      '[&.is-reached:not(:where(.is-hovered,:hover,:focus-visible))]:bg-[color-mix(in_srgb,var(--tier-color)_6%,rgba(255,255,255,0.015))]',
                      '[&.is-hovered]:z-[2]',
                      '[&.is-hovered]:border-[color-mix(in_srgb,var(--tier-color)_40%,rgba(255,255,255,0.06))]',
                      '[&.is-hovered]:bg-[color-mix(in_srgb,var(--tier-color)_10%,rgba(255,255,255,0.015))]',
                      '[&.is-hovered]:shadow-[0_8px_18px_rgba(0,0,0,0.16)] [&.is-hovered]:transform-[translateY(-2px)]',
                      '[&.is-missing]:pointer-events-none [&.is-missing]:opacity-[0.48] [&.is-missing]:filter-[grayscale(1)]',
                      '[&:is(:hover,:focus-visible)]:z-[2]',
                      '[&:is(:hover,:focus-visible)]:border-[color-mix(in_srgb,var(--tier-color)_40%,rgba(255,255,255,0.06))]',
                      '[&:is(:hover,:focus-visible)]:bg-[color-mix(in_srgb,var(--tier-color)_10%,rgba(255,255,255,0.015))]',
                      '[&:is(:hover,:focus-visible)]:shadow-[0_8px_18px_rgba(0,0,0,0.16)]',
                      '[&:is(:hover,:focus-visible)]:transform-[translateY(-2px)]',
                      '[transition:opacity_180ms_ease,transform_250ms_cubic-bezier(0.22,1,0.36,1),border-color_180ms_ease,background-color_180ms_ease,box-shadow_220ms_ease]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                      reached ? 'is-reached' : '',
                      isHovered ? 'is-hovered' : '',
                      available ? '' : 'is-missing',
                    )}
                    style={{ '--tier-color': color } as CSSProperties}
                  >
                    <span
                      className={cn(
                        'afterplay-game-hltb-milestone-icon',
                        'flex size-7.5 items-center justify-center rounded-[8px] text-(--tier-color)',
                        'border border-[color-mix(in_srgb,var(--tier-color)_28%,transparent)]',
                        'bg-[color-mix(in_srgb,var(--tier-color)_8%,transparent)]',
                        '[&_i]:bg-(--tier-color) [&_i]:shadow-[0_0_4px_color-mix(in_srgb,var(--tier-color)_26%,transparent)]',
                      )}
                    >
                      {reached ? (
                        <Check size={12} strokeWidth={3.5} />
                      ) : (
                        <i className="size-1.5 rounded-[2px]" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <small className="truncate text-[9.5px] font-[850] text-white/[0.45]">
                        {TIER_LABEL[tier.key]}
                      </small>
                      <strong className="mt-0.5 text-[14px] font-black text-foreground">
                        {available ? formatHours(tier.threshold) : '—'}
                      </strong>
                    </span>
                    <em className="absolute right-2 bottom-1.5 text-[8px] font-[950] tracking-[0.08em] text-(--tier-color) not-italic opacity-[0.72]">
                      {reached ? 'CLEARED' : available ? 'TARGET' : 'NO DATA'}
                    </em>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-foreground">How long to beat</span>
          {/* Volver a preguntarle a HLTB por este juego. Estos tiempos se
              piden UNA vez, en el alta, y no los refresca nada más — y sí se
              mueven: la media de un juego recién salido se asienta con los
              meses, y sube cuando el juego recibe contenido grande. Discreto
              porque casi nunca hace falta; imprescindible cuando sí. */}
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate(game.id, {
                onSuccess: (times) => {
                  if (times) toast.success('Times updated from HowLongToBeat.');
                  else
                    toast.info('HowLongToBeat has no confident match — times kept as they were.');
                },
                onError: () => toast.error('Could not reach HowLongToBeat.'),
              });
            }}
            title="Re-fetch times from HowLongToBeat"
            aria-label="Refresh times"
            className="flex size-5.5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
          >
            <RefreshCw size={11} className={refresh.isPending ? 'animate-spin' : undefined} />
          </button>
        </div>

        {/* Cabecera de la derecha: por defecto adelanta cuánto falta para el
            próximo hito (o el aplauso final si ya te pasaste el 100%); al
            pasar el ratón por un tramo/tile concreto, ese dato manda —
            mismo intercambio resumen⇄detalle de Status Breakdown. */}
        {hoveredDetail ? (
          <HeaderDetail
            color={TIER_COLOR[hoveredDetail.key]}
            label={TIER_LABEL[hoveredDetail.key]}
            threshold={hoveredDetail.threshold}
            markerHours={hasOwnHours ? markerHours : null}
          />
        ) : hasOwnHours && nextTier ? (
          <span
            className="flex-none text-[11.5px] font-semibold whitespace-nowrap tabular-nums"
            style={{ color: TIER_COLOR[nextTier.key] }}
          >
            {formatHours(nextTier.threshold - markerHours)} to {TIER_LABEL[nextTier.key]}
          </span>
        ) : hasOwnHours && reachedTier === 'completionist' ? (
          <span
            className="flex flex-none items-center gap-1 rounded-lg border px-2 py-0.75 text-[10.5px] font-bold whitespace-nowrap"
            style={{
              color: COMPLETIONIST,
              borderColor: `${COMPLETIONIST}3d`,
              background: `${COMPLETIONIST}14`,
            }}
          >
            <PartyPopper size={11} />
            100% complete
          </span>
        ) : null}
      </div>

      <div
        className={`mt-0.5 flex items-center gap-1.25 text-xs text-muted-foreground ${hasOwnHours ? 'mb-6.5' : 'mb-4'}`}
      >
        {!hasOwnHours ? (
          <span>Estimated times for this game</span>
        ) : markerScope === 'playthrough' ? (
          <>
            <span>Marker shows this playthrough&apos;s hours</span>
            <Tooltip>
              <TooltipTrigger>
                <Info size={12} />
              </TooltipTrigger>
              <TooltipContent>
                Switch playthroughs in the dropdown below to see how each one compares to these
                times.
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <span>Marker shows what you&apos;ve played</span>
        )}
      </div>

      <div className="relative mb-4.5">
        {hasOwnHours && (
          <>
            {/* El marcador entra el último (delay > que el crecido de los
                tramos) y "aterriza" desde arriba: sin eso, la barra se anima
                pero el dato propio —lo único que es TUYO en esta card—
                aparece ya puesto. */}
            <div
              className="absolute -top-5 rounded-md border border-input px-1.5 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap text-foreground tabular-nums shadow-[0_4px_10px_rgba(0,0,0,.4)]"
              style={{
                left: `${markerPct}%`,
                background: '#1d211f',
                animation: 'afterplay-drop-in 420ms ease-out 620ms both',
                // Los tramos de la barra llevan `transform` para su animación
                // de crecido, y un transform crea contexto de apilado propio:
                // sin un z-index explícito aquí, el marcador (posicionado,
                // pero con z-index auto) se pinta POR DEBAJO de ellos y
                // desaparece.
                zIndex: 2,
              }}
            >
              {formatHours(markerHours)}
            </div>
            <div
              className="absolute -top-1 rounded-sm bg-white"
              style={{
                left: `${markerPct}%`,
                width: 3,
                height: 22,
                // Halo blanco además del contorno oscuro: separa el marcador
                // del tramo que tenga debajo, sea del color que sea.
                boxShadow: '0 0 0 2px rgba(13,15,14,.85), 0 0 12px rgba(255,255,255,.5)',
                animation: 'afterplay-drop-in 420ms ease-out 620ms both',
                zIndex: 2,
              }}
            />
          </>
        )}
        <div
          className="flex h-3.5 overflow-hidden rounded-[5px] bg-white/5"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.4)' }}
        >
          {(
            [
              { key: 'main' as const, width: segMain, background: MAIN },
              { key: 'extra' as const, width: segExtra, background: EXTRA },
              { key: 'completionist' as const, width: segComp, background: COMPLETIONIST },
            ] satisfies { key: TierKey; width: number; background: string }[]
          ).map((segment, index) => {
            const isHovered = hoveredTier === segment.key;
            const isDimmed = hoveredTier !== null && !isHovered;
            return (
              <div
                key={segment.key}
                onMouseEnter={() => setHoveredTier(segment.key)}
                onMouseLeave={() => setHoveredTier(null)}
                className="transition-[opacity,filter] duration-150"
                style={{
                  width: `${segment.width}%`,
                  background: segment.background,
                  transformOrigin: 'left',
                  opacity: isDimmed ? 0.4 : 1,
                  filter: isHovered ? 'brightness(1.25)' : 'none',
                  boxShadow: isHovered ? `inset 0 0 10px ${segment.background}99` : 'none',
                  // Escalonado: los tramos se encadenan de izquierda a
                  // derecha como si la barra se fuera llenando.
                  animation: `afterplay-grow-x 520ms ease-out ${index * 110}ms both`,
                  // Esquinas exteriores redondeadas a juego con el contenedor
                  // (rounded-[5px]): el primer tramo por la izquierda, el
                  // último por la derecha — así, aunque quede un resto de
                  // imprecisión de coma flotante, el hueco que se vea ahí
                  // está redondeado igual que el contenedor, no cuadrado
                  // contra una esquina redonda.
                  borderTopLeftRadius: index === 0 ? 5 : 0,
                  borderBottomLeftRadius: index === 0 ? 5 : 0,
                  borderTopRightRadius: index === 2 ? 5 : 0,
                  borderBottomRightRadius: index === 2 ? 5 : 0,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <TierTile
          tierKey="main"
          color={MAIN}
          label="MAIN"
          value={formatHours(main)}
          reached={reachedTier !== null}
          hovered={hoveredTier === 'main'}
          dimmed={hoveredTier !== null && hoveredTier !== 'main'}
          onHover={setHoveredTier}
        />
        <TierTile
          tierKey="extra"
          color={EXTRA}
          label="+ EXTRA"
          value={formatHours(extra)}
          reached={reachedTier === 'extra' || reachedTier === 'completionist'}
          hovered={hoveredTier === 'extra'}
          dimmed={hoveredTier !== null && hoveredTier !== 'extra'}
          onHover={setHoveredTier}
        />
        <TierTile
          tierKey="completionist"
          color={COMPLETIONIST}
          label="100%"
          value={formatHours(completionist)}
          reached={reachedTier === 'completionist'}
          hovered={hoveredTier === 'completionist'}
          dimmed={hoveredTier !== null && hoveredTier !== 'completionist'}
          onHover={setHoveredTier}
        />
      </div>
    </div>
  );
};

// El detalle que sustituye al resumen por defecto mientras hay un tramo bajo
// el ratón: nombre del hito, sus horas, y si tienes horas propias, cuánto
// falta o cuánto te pasaste — sin horas propias (Plan to Play) se queda solo
// en el dato de HLTB, no hay delta que dar.
const HeaderDetail = ({
  color,
  label,
  threshold,
  markerHours,
}: {
  color: string;
  label: string;
  threshold: number;
  markerHours: number | null;
}): React.JSX.Element => {
  const diff = markerHours === null ? null : threshold - markerHours;
  return (
    <span
      className="flex-none text-[11.5px] font-semibold whitespace-nowrap tabular-nums"
      style={{ color }}
    >
      {label} · {formatHours(threshold)}
      {diff !== null && Math.abs(diff) >= 1 / 60 && (
        <span className="opacity-70">
          {' · '}
          {diff > 0 ? `${formatHours(diff)} to go` : `+${formatHours(-diff)} past`}
        </span>
      )}
    </span>
  );
};
