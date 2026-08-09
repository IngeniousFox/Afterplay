import { Check, Hourglass, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../api';
import { formatHours } from '../../lib/format';
import { DetailCard } from './primitives';

type TierKey = 'main' | 'extra' | 'completionist';

const MAIN = '#2bb6a6';
const EXTRA = '#3f7fe0';
const COMPLETIONIST = '#2fdc7e';

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

// Cada tramo como tile con su color: el alcanzado se enciende y lleva un
// check; el seleccionado se realza y el resto se atenúa, para inspeccionar uno
// sin perder la referencia de los otros dos.
const TierTile = ({
  tierKey,
  color,
  label,
  value,
  reached,
  active,
  dimmed,
  onToggle,
}: {
  tierKey: TierKey;
  color: string;
  label: string;
  value: string;
  reached: boolean;
  active: boolean;
  dimmed: boolean;
  onToggle: (key: TierKey) => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={() => onToggle(tierKey)}
    className="flex-1 rounded-[10px] border px-1.5 py-2.25 text-center transition-[opacity,box-shadow,border-color] duration-150"
    style={{
      opacity: dimmed ? 0.4 : 1,
      ...(reached || active
        ? { borderColor: `${color}5c`, background: `${color}17` }
        : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }),
      ...(active ? { boxShadow: `0 0 0 1px ${color}59, 0 0 14px ${color}33` } : {}),
    }}
  >
    <div className="mb-1.25 flex items-center justify-center gap-1">
      {reached ? (
        <Check size={10} color={color} strokeWidth={3.5} />
      ) : (
        <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: color }} />
      )}
      <span
        className="text-[9px] font-bold tracking-[.04em]"
        style={{ color: reached || active ? color : 'var(--muted-foreground)' }}
      >
        {label}
      </span>
    </div>
    <div
      className="text-[13px] font-extrabold tabular-nums"
      style={{ color: reached || active ? color : 'var(--foreground)' }}
    >
      {value}
    </div>
  </button>
);

// El detalle que sustituye al resumen mientras hay un tramo elegido: su
// nombre, sus horas y cuánto falta (o cuánto te pasaste).
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
      className="flex-none text-[11px] font-semibold whitespace-nowrap tabular-nums"
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

type Props = {
  game: GameDetail;
  // El marcador compara contra el playthrough ELEGIDO, no contra el total: es
  // lo que hace que cambiar de playthrough arriba mueva la marca aquí. Para un
  // endless no hay playthroughs que comparar, así que son las horas totales.
  markerHours: number;
  markerScope: 'playthrough' | 'total';
};

// Barra de 3 tramos (main / main+extra / 100%) con un marcador vertical en tus
// horas. Portada de HowLongToBeatCard.tsx.
//
// Lo único que cambia respecto al escritorio es el gesto: allí los tramos y
// los tiles comparten HOVER, y en un móvil el hover no existe. Aquí se toca
// para fijar un tramo y se vuelve a tocar para soltarlo — mismo intercambio
// resumen⇄detalle, distinto dedo.
export const HowLongToBeat = ({ game, markerHours, markerScope }: Props): React.JSX.Element => {
  const [activeTier, setActiveTier] = useState<TierKey | null>(null);

  const main = game.hltbMain ?? 0;
  const extra = game.hltbMainExtras ?? 0;
  const completionist = game.hltbCompletionist ?? 0;

  // Sin match de HLTB. El hueco se queda en vez de desaparecer: que la sección
  // no exista no explica por qué no existe.
  if (main === 0 && extra === 0 && completionist === 0) {
    return (
      <DetailCard>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/[0.04] text-muted-foreground/50">
            <Hourglass size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold text-foreground">How long to beat</div>
            <div className="text-[11.5px] text-muted-foreground">No confident match yet</div>
          </div>
        </div>
      </DetailCard>
    );
  }

  // Escala al MAYOR de los tres datos conocidos, no siempre a completionist.
  // HLTB no siempre trae los tres, y un dato ausente llega como 0: si fuera
  // justo completionist el que falta (el caso más común), escalar contra él
  // daría un denominador falso de 1h — los segmentos se salen del 100% y el
  // marcador se clava en el borde. Con el mayor de los tres, main+extra suman
  // como mucho 100% y el marcador cae donde toca.
  const scale = Math.max(main, extra, completionist, 1);
  const segMain = (main / scale) * 100;
  const segExtra = (Math.max(0, extra - main) / scale) * 100;
  // Resto hasta 100, no un tercer cálculo independiente: sumar tres divisiones
  // en coma flotante podía quedarse una fracción de píxel corta de 100, y ese
  // hueco contra la esquina redondeada se veía como una barra cortada.
  const segComp = Math.max(0, 100 - segMain - segExtra);
  const markerPct = Math.max(0, Math.min(100, (markerHours / scale) * 100));

  // Sin horas propias la card es una estimación pura: no hay marcador que
  // poner ni tramo alcanzado, y decir "0h" sería ruido.
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

  const tiers = [
    { key: 'main' as const, threshold: main },
    { key: 'extra' as const, threshold: extra },
    { key: 'completionist' as const, threshold: completionist },
  ].filter((tier) => tier.threshold > 0);

  // El próximo hito sin alcanzar: de él sale el "quedan Xh" que se ve por
  // defecto, sin tener que tocar nada.
  const nextTier = hasOwnHours
    ? (tiers.find((tier) => tier.threshold > markerHours) ?? null)
    : null;
  const activeDetail = activeTier ? tiers.find((tier) => tier.key === activeTier) : undefined;

  const toggle = (key: TierKey): void => setActiveTier((current) => (current === key ? null : key));

  return (
    <DetailCard>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13.5px] font-bold text-foreground">How long to beat</span>
        {activeDetail ? (
          <HeaderDetail
            color={TIER_COLOR[activeDetail.key]}
            label={TIER_LABEL[activeDetail.key]}
            threshold={activeDetail.threshold}
            markerHours={hasOwnHours ? markerHours : null}
          />
        ) : hasOwnHours && nextTier ? (
          <span
            className="flex-none text-[11px] font-semibold whitespace-nowrap tabular-nums"
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
        className={`mt-0.5 text-[11.5px] text-muted-foreground ${hasOwnHours ? 'mb-6.5' : 'mb-4'}`}
      >
        {!hasOwnHours
          ? 'Estimated times for this game'
          : markerScope === 'playthrough'
            ? "Marker shows this playthrough's hours"
            : "Marker shows what you've played"}
      </div>

      <div className="relative mb-4">
        {hasOwnHours && (
          <>
            {/* El marcador entra el último y "aterriza" desde arriba: sin eso,
                la barra se anima pero el dato propio —lo único TUYO de esta
                card— aparece ya puesto.
                translateX(-50%) para que la etiqueta quede centrada sobre su
                posición; en los extremos se clampa el left para que no se
                salga de la card en 375px. */}
            <div
              className="absolute -top-5 rounded-md border border-white/14 px-1.5 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap text-foreground tabular-nums shadow-[0_4px_10px_rgba(0,0,0,.4)]"
              style={{
                left: `${Math.min(92, Math.max(8, markerPct))}%`,
                transform: 'translateX(-50%)',
                background: '#1d211f',
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
                zIndex: 2,
              }}
            />
          </>
        )}
        <div
          className="flex h-3.5 overflow-hidden rounded-[5px] bg-white/5"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.4)' }}
        >
          {[
            { key: 'main' as const, width: segMain, background: MAIN },
            { key: 'extra' as const, width: segExtra, background: EXTRA },
            { key: 'completionist' as const, width: segComp, background: COMPLETIONIST },
          ].map((segment, index) => {
            const isActive = activeTier === segment.key;
            const isDimmed = activeTier !== null && !isActive;
            return (
              <div
                key={segment.key}
                onClick={() => toggle(segment.key)}
                className="transition-[opacity,filter] duration-150"
                style={{
                  width: `${segment.width}%`,
                  background: segment.background,
                  opacity: isDimmed ? 0.4 : 1,
                  filter: isActive ? 'brightness(1.25)' : 'none',
                  boxShadow: isActive ? `inset 0 0 10px ${segment.background}99` : 'none',
                  // Esquinas exteriores a juego con el contenedor: aunque
                  // quede un resto de imprecisión, el hueco que se vea está
                  // redondeado igual, no cuadrado contra una esquina redonda.
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
          active={activeTier === 'main'}
          dimmed={activeTier !== null && activeTier !== 'main'}
          onToggle={toggle}
        />
        <TierTile
          tierKey="extra"
          color={EXTRA}
          label="+ EXTRA"
          value={formatHours(extra)}
          reached={reachedTier === 'extra' || reachedTier === 'completionist'}
          active={activeTier === 'extra'}
          dimmed={activeTier !== null && activeTier !== 'extra'}
          onToggle={toggle}
        />
        <TierTile
          tierKey="completionist"
          color={COMPLETIONIST}
          label="100%"
          value={formatHours(completionist)}
          reached={reachedTier === 'completionist'}
          active={activeTier === 'completionist'}
          dimmed={activeTier !== null && activeTier !== 'completionist'}
          onToggle={toggle}
        />
      </div>
    </DetailCard>
  );
};
