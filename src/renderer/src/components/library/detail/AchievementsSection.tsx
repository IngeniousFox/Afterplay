import { ChevronDown, Eye, EyeOff, Lock, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, TimeFormat } from '../../../../../shared/types';
import { useGameAchievements, useRefreshGameAchievements } from '../../../hooks/achievements';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { useTimeFormat } from '../../../hooks/settings';
import {
  isRare,
  percentLabel,
  rarityAccent,
  sortForDisplay,
  ULTRA_RARE,
  ULTRA_VIOLET,
} from '../../../lib/achievements';
import { AMBER, GREEN } from '../../../lib/colors';
import { formatByPrecision } from '../../../lib/format';
import { revealClass, revealStyle } from '../../../lib/styles';

type AchievementsSectionProps = {
  gameId: number;
};

// Cuántos se pintan plegada. Un juego puede tener 200 logros y la ficha no es
// una lista de logros: enseña lo tuyo y deja ver el resto a quien lo pida.
const COLLAPSED_COUNT = 12;

// ── El anillo de progreso ───────────────────────────────────────────────────
// La cifra del gabinete: cuánto del juego es tuyo, dibujándose al entrar
// (afterplay-ring-in en main.css). SVG y no conic-gradient porque el trazo
// redondeado y el glow del extremo solo salen bien con stroke.

const RING_SIZE = 76;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_RADIUS;

const ProgressRing = ({
  percent,
  complete,
}: {
  percent: number;
  complete: boolean;
}): React.JSX.Element => {
  const color = complete ? AMBER : GREEN;
  return (
    <div className="relative flex-none" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,.07)"
          strokeWidth={RING_STROKE}
        />
        {percent > 0 && (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: RING_C * (1 - percent / 100),
              ['--afterplay-ring-c' as string]: `${RING_C}`,
              animation: 'afterplay-ring-in 1s cubic-bezier(.22,1,.36,1) 150ms backwards',
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[17px] font-extrabold tabular-nums" style={{ color }}>
          {percent}%
        </span>
      </div>
    </div>
  );
};

// ── Las medallas ────────────────────────────────────────────────────────────
// Tus tres conseguidos MÁS RAROS, como piezas de vitrina: redondos (a
// diferencia de los iconos cuadrados de la lista — son medallas, no filas).
// La viveza sale de lo FÍSICO, no del neón: brillo especular arriba, sombra
// profunda debajo y un pelín de crecida al pasar el ratón — una chapa
// esmaltada, no un rótulo luminoso. El color de rareza solo asoma cuando la
// medalla lo ha ganado (raro/ultra); una del 40% va con aro neutro, porque
// teñir de verde lo corriente era justo lo que sobraba.

const RarestMedal = ({ entry }: { entry: AchievementEntry }): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const rare = isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);
  return (
    <div className="flex w-13 flex-col items-center gap-1" title={entry.displayName}>
      <div
        className="relative h-11 w-11 overflow-hidden rounded-full transition-transform duration-200 hover:scale-[1.08]"
        style={{
          boxShadow: `inset 0 0 0 1.5px ${rare ? `${accent}99` : 'rgba(255,255,255,.22)'}, inset 0 1px 0 rgba(255,255,255,.28), 0 5px 12px rgba(0,0,0,.5)`,
        }}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={14} className="text-muted-foreground/40" />
          </div>
        )}
        {/* El especular de la esquina: la luz del techo sobre el esmalte. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.22), transparent 45%)',
          }}
        />
      </div>
      {entry.globalPercent !== null && (
        <span
          className="text-[9.5px] font-bold tabular-nums"
          style={rare ? { color: accent } : { color: 'var(--muted-foreground)' }}
        >
          {percentLabel(entry.globalPercent)}
        </span>
      )}
    </div>
  );
};

// ── La cabecera-vitrina ─────────────────────────────────────────────────────
// La sección ya no arranca con un rótulo y dos números sueltos: arranca con
// una pieza — anillo de progreso, el marcador grande, los contadores de
// rareza y las medallas de tus rarezas. El trofeo de agua y el aliento de
// color en la esquina son los que hacen que se sienta gabinete y no tabla.

const TrophyCase = ({
  unlockedCount,
  total,
  percent,
  rareCount,
  ultraCount,
  medals,
  onRefresh,
  refreshing,
}: {
  unlockedCount: number;
  total: number;
  percent: number;
  rareCount: number;
  ultraCount: number;
  medals: AchievementEntry[];
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element => {
  const complete = percent === 100;
  return (
    <div
      className="relative overflow-hidden rounded-[16px] border border-white/[0.08] px-5 py-4"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07)',
      }}
    >
      {/* El trofeo de agua, medio recortado a propósito — filigrana, no
          rótulo. En BLANCO: el color ya lo ponen el anillo y las medallas, y
          teñir también el fondo era pasarse de verde. */}
      <Trophy
        aria-hidden
        size={150}
        strokeWidth={1.25}
        className="pointer-events-none absolute -right-7 -bottom-12 -rotate-8 text-white"
        style={{ opacity: 0.04 }}
      />

      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3">
        <ProgressRing percent={percent} complete={complete} />

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-extrabold tracking-[.2em] text-muted-foreground">
              ACHIEVEMENTS
            </span>
            {/* Volver a preguntarle a Steam por ESTE juego. Vive junto al
                rótulo y no como acción destacada porque casi nunca hace
                falta: los juegos que juegas se refrescan solos al cerrar la
                sesión. Es para lo que no se refresca solo — un endless o un
                early access que ha añadido logros en un parche, o un juego
                que no lanzas desde aquí. */}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title={
                refreshing
                  ? 'Checking Steam for new achievements…'
                  : 'Re-fetch this game’s achievements from Steam'
              }
              aria-label="Refresh achievements"
              className="flex h-5.5 w-5.5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
            </button>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[27px] leading-none font-extrabold tabular-nums text-foreground">
              {unlockedCount}
            </span>
            <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">
              / {total}
            </span>
          </div>
          <div className="mt-1.75 flex flex-wrap items-center gap-1.5">
            {complete && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: `${AMBER}1f`, color: AMBER }}
              >
                <Sparkles size={9} />
                COMPLETED
              </span>
            )}
            {/* Los raros como medalla aparte: en una lista de 40 logros,
                haber sacado 3 que casi nadie tiene es de lo que se presume. */}
            {rareCount > 0 && (
              <span
                className="flex items-center gap-1 rounded-full px-1.75 py-0.5 text-[10px] font-bold"
                style={{ background: `${AMBER}1a`, color: AMBER }}
                title={`${rareCount} rare achievement${rareCount === 1 ? '' : 's'} unlocked (under 10% of players)`}
              >
                <Sparkles size={9} />
                {rareCount} rare
              </span>
            )}
            {ultraCount > 0 && (
              <span
                className="flex items-center gap-1 rounded-full px-1.75 py-0.5 text-[10px] font-bold"
                style={{ background: `${ULTRA_VIOLET}1a`, color: ULTRA_VIOLET }}
                title={`${ultraCount} ultra rare (under ${ULTRA_RARE}% of players)`}
              >
                <Sparkles size={9} />
                {ultraCount} ultra
              </span>
            )}
          </div>
        </div>

        {medals.length > 0 && (
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <span className="text-[9px] font-extrabold tracking-[.18em] text-muted-foreground/70">
              RAREST UNLOCKED
            </span>
            <div className="flex gap-2">
              {medals.map((entry) => (
                <RarestMedal key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* La barra vive DENTRO de la vitrina (es su suelo), con marcas de
          cuarto para que el ojo sepa leer el 37% sin pensarlo. */}
      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${percent}%`,
            background: complete
              ? `linear-gradient(90deg, ${GREEN}, ${AMBER})`
              : `linear-gradient(90deg, ${GREEN}99, ${GREEN})`,
          }}
        />
        {[25, 50, 75].map((tick) => (
          <span
            key={tick}
            aria-hidden
            className="absolute inset-y-0 w-px bg-black/40"
            style={{ left: `${tick}%` }}
          />
        ))}
      </div>
    </div>
  );
};

// ── La lista ────────────────────────────────────────────────────────────────

// Los iconos viven en el CDN de Steam y el CSP solo deja cargar imágenes por
// afterplay-image:, así que pasan por la MISMA caché que las carátulas. Se
// resuelve por fila: solo se descargan los que llegas a mirar.
const AchievementIcon = ({
  entry,
  unlocked,
}: {
  entry: AchievementEntry;
  unlocked: boolean;
}): React.JSX.Element => {
  const remoteUrl = (unlocked ? entry.iconUrl : (entry.iconGrayUrl ?? entry.iconUrl)) ?? null;
  const src = useImageSrc(remoteUrl, 'achievements');
  const rare = unlocked && isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);

  return (
    <div className="relative flex-none">
      {/* Aro de luz solo en los conseguidos raros: es el "toma ya" de la
          lista, y si se lo pusiéramos a todos dejaría de significar nada. */}
      {rare && (
        <div
          aria-hidden
          className="absolute -inset-0.5 rounded-[13px] opacity-55 blur-[4px]"
          style={{ background: accent }}
        />
      )}
      <div
        className={`relative h-13 w-13 overflow-hidden rounded-[12px] transition-all duration-300 ${
          unlocked ? '' : 'opacity-35 grayscale'
        }`}
        style={{
          boxShadow: unlocked
            ? `inset 0 0 0 1px ${rare ? `${accent}80` : 'rgba(255,255,255,.14)'}`
            : 'inset 0 0 0 1px var(--border)',
        }}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={17} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
    </div>
  );
};

// La descripción, con el spoiler de los ocultos. Un oculto ya conseguido no
// tiene nada que esconder; uno pendiente se tapa pero se puede destapar de un
// clic — la decisión de hacerse spoiler es tuya, no de la app.
const AchievementDescription = ({
  entry,
  unlocked,
}: {
  entry: AchievementEntry;
  unlocked: boolean;
}): React.JSX.Element | null => {
  const [revealed, setRevealed] = useState(false);

  if (!entry.hidden || unlocked) {
    if (!entry.description) return null;
    return (
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground/75">
        {entry.description}
      </p>
    );
  }

  // Sin descripción que revelar (juego que tu Steam no ha cacheado): se dice,
  // en vez de ofrecer un botón que no haría nada.
  if (!entry.description) {
    return (
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground/45 italic">
        Hidden achievement
      </p>
    );
  }

  if (revealed) {
    return (
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground/75">
        {entry.description}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="group/reveal mt-1 flex items-center gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground/45 italic transition-colors duration-150 hover:text-muted-foreground"
    >
      {/* Dos iconos apilados con grid (no con márgenes negativos): el ojo
          tachado por defecto, el abierto al pasar — y el texto no se mueve. */}
      <span className="grid flex-none place-items-center">
        <EyeOff
          size={11}
          className="col-start-1 row-start-1 transition-opacity duration-150 group-hover/reveal:opacity-0"
        />
        <Eye
          size={11}
          className="col-start-1 row-start-1 opacity-0 transition-opacity duration-150 group-hover/reveal:opacity-100"
        />
      </span>
      Hidden — click to reveal
    </button>
  );
};

const AchievementRow = ({
  entry,
  timeFormat,
}: {
  entry: AchievementEntry;
  timeFormat: TimeFormat;
}): React.JSX.Element => {
  const unlocked = entry.unlockedAt !== null;
  const percent = entry.globalPercent;
  const rare = isRare(percent);
  const accent = rarityAccent(percent);

  return (
    <div
      className={`group/ach relative flex items-start gap-3.5 overflow-hidden rounded-[14px] border px-3.5 py-3 transition-colors duration-200 ${
        unlocked
          ? 'border-white/8 bg-white/[0.035] hover:bg-white/[0.055]'
          : 'border-dashed border-white/[0.07] bg-white/[0.008] hover:bg-white/[0.02]'
      }`}
      // El lavado de color, SOLO en los raros: si cada fila conseguida se
      // tiñera de verde, la lista entera sería un neón y el raro dejaría de
      // destacar. Lo común va en cristal neutro; el color se gana. Los
      // pendientes van con borde discontinuo — huecos del gabinete, no filas.
      style={
        unlocked && rare
          ? { background: `linear-gradient(90deg, ${accent}0e, rgba(255,255,255,.02) 55%)` }
          : undefined
      }
    >
      {/* Filo de color a la izquierda en los conseguidos: la misma gramática
          que la barra de estado de la tarjeta del modo TV. Sin glow — es un
          filo, no un tubo de neón; el raro lo lleva algo más encendido. */}
      {unlocked && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px]"
          style={{ background: accent, opacity: rare ? 0.85 : 0.55 }}
        />
      )}

      <AchievementIcon entry={entry} unlocked={unlocked} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[13px] font-bold ${
              unlocked ? 'text-foreground' : 'text-muted-foreground/80'
            }`}
          >
            {entry.displayName}
          </span>

          {/* El porcentaje va en TODOS los que lo tengan, no solo en los
              raros: saber que un logro lo tiene el 80% de la gente también es
              información (y hace que el 2% de al lado se lea como lo que es).
              Los comunes van apagados, los raros con su color y su chispa. */}
          {percent !== null && (
            <span
              className="flex flex-none items-center gap-1 rounded-full px-1.75 py-0.5 text-[10px] font-bold tabular-nums"
              style={
                rare
                  ? { background: `${accent}1f`, color: accent }
                  : { color: 'var(--muted-foreground)', opacity: 0.6 }
              }
              title={`${percent.toFixed(1)}% of players have this`}
            >
              {rare && <Sparkles size={8} />}
              {percentLabel(percent)}
            </span>
          )}
        </div>

        <AchievementDescription entry={entry} unlocked={unlocked} />

        {/* La fecha es la mitad de la gracia: un logro con fecha es un
            recuerdo, sin ella es una casilla. Pero solo se enseña como fecha
            si es de fiar — si vino del arrastre masivo de un crack, decir
            "12:33 de hoy" sería inventarse un momento que no existió.
            El verde queda en el trofecito: una línea entera verde POR FILA
            multiplicada por toda la lista era la mitad del neón. */}
        {entry.unlockedAt && (
          <div className="mt-1.25 flex items-center gap-1.5 text-[10.5px] font-semibold text-muted-foreground/85">
            <Trophy
              size={10}
              className="flex-none"
              style={{ color: entry.dateReliable ? GREEN : 'var(--muted-foreground)' }}
            />
            {entry.dateReliable
              ? formatByPrecision(entry.unlockedAt, 'datetime', timeFormat)
              : 'Unlocked · date unknown'}
            {/* De dónde nos consta. Solo cuando NO es la vía normal: que un
                logro venga de Steam no es noticia; que venga del emulador de
                un juego pirata ('local') o de RetroAchievements ('RA') sí
                explica por qué está ahí. */}
            {!entry.sources.includes('steam') &&
              (entry.sources.includes('emu') || entry.sources.includes('ra')) && (
                <span className="ml-0.5 rounded px-1 py-0.5 text-[9px] font-bold tracking-[.06em] text-muted-foreground/60 uppercase">
                  {entry.sources.includes('emu') ? 'local' : 'RA'}
                </span>
              )}
          </div>
        )}
      </div>

      {!unlocked && <Lock size={12} className="mt-1 flex-none text-muted-foreground/30" />}
    </div>
  );
};

// Los logros de un juego en su ficha. No se pinta nada si el juego no está en
// Steam o si su catálogo no se ha traído: una sección vacía con "0 logros" en
// un juego de PS2 emulado sería ruido, no información.
export const AchievementsSection = ({
  gameId,
}: AchievementsSectionProps): React.JSX.Element | null => {
  const { data } = useGameAchievements(gameId);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const { refresh, refreshing } = useRefreshGameAchievements(gameId);
  const [expanded, setExpanded] = useState(false);

  if (!data || data.entries.length === 0) return null;

  // UN SOLO ORDEN, plegada y expandida (lib/achievements.ts): conseguidos
  // primero, recientes arriba, no fiables detrás, pendientes al final.
  // Expandir solo AÑADE al final — nada se reordena bajo el cursor.
  const sorted = sortForDisplay(data.entries);
  const unlockedCount = sorted.filter((entry) => entry.unlockedAt !== null).length;
  const percent = Math.round((unlockedCount / sorted.length) * 100);
  const rareUnlocked = sorted.filter(
    (entry) => entry.unlockedAt !== null && isRare(entry.globalPercent),
  );
  const ultraCount = rareUnlocked.filter(
    (entry) => (entry.globalPercent as number) < ULTRA_RARE,
  ).length;

  // Las medallas de la vitrina: tus tres conseguidos más raros.
  const medals = sorted
    .filter((entry) => entry.unlockedAt !== null && entry.globalPercent !== null)
    .sort((a, b) => (a.globalPercent as number) - (b.globalPercent as number))
    .slice(0, 3);

  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_COUNT);
  const hiddenCount = sorted.length - visible.length;

  return (
    <div className="mt-7.5">
      <div className={revealClass} style={revealStyle(0)}>
        <TrophyCase
          unlockedCount={unlockedCount}
          total={sorted.length}
          percent={percent}
          rareCount={rareUnlocked.length - ultraCount}
          ultraCount={ultraCount}
          medals={medals}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {visible.map((entry, index) => (
          <div
            key={entry.id}
            className={revealClass}
            // El escalonado solo en las primeras: con la lista expandida a 200
            // filas, un delay por fila tardaría segundos en acabar de entrar.
            style={revealStyle(Math.min(index + 1, 7))}
          >
            <AchievementRow entry={entry} timeFormat={timeFormat} />
          </div>
        ))}
      </div>

      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="group/more mt-2 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-input bg-white/[0.02] py-2.25 text-[12px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-white/[0.05] hover:text-foreground"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
};
