import { Check, Info, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
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
        <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: color }} />
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
}: HowLongToBeatCardProps): React.JSX.Element | null => {
  // Antes del early return de abajo: un hook nunca puede ser condicional.
  const [hoveredTier, setHoveredTier] = useState<TierKey | null>(null);

  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;
  if (main === 0 && extra === 0 && completionist === 0) return null;

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

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-bold text-foreground">How long to beat</div>

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
