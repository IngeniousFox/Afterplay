import { Eye, EyeOff, Lock, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, TimeFormat } from '../../../../../shared/types';
import { useGameAchievements } from '../../../hooks/achievements';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { useTimeFormat } from '../../../hooks/settings';
import { AMBER, GREEN } from '../../../lib/colors';
import { formatByPrecision } from '../../../lib/format';
import { revealClass, revealStyle } from '../../../lib/styles';
import { SectionLabel } from './SectionLabel';

type AchievementsSectionProps = {
  gameId: number;
};

// Cuántos se pintan plegada. Un juego puede tener 200 logros y la ficha no es
// una lista de logros: enseña lo tuyo y deja ver el resto a quien lo pida.
const COLLAPSED_COUNT = 12;

// Escalones de rareza, con los cortes de la propia Steam. Por debajo del 10%
// un logro ya es poco común; por debajo del 5% es de los que se presumen.
const RARE = 10;
const ULTRA_RARE = 5;

const rarityColor = (percent: number): string => (percent < ULTRA_RARE ? '#e0a3ff' : AMBER);

// Un decimal solo cuando aporta: "48%" se lee mejor que "47.6%", pero en un
// logro del 0.4% el decimal ES la noticia.
const percentLabel = (percent: number): string =>
  percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;

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
  const rare = unlocked && entry.globalPercent !== null && entry.globalPercent < RARE;

  return (
    <div className="relative flex-none">
      {/* Aro de luz solo en los conseguidos raros: es el "toma ya" de la
          lista, y si se lo pusiéramos a todos dejaría de significar nada. */}
      {rare && (
        <div
          aria-hidden
          className="absolute -inset-0.5 rounded-[11px] opacity-60 blur-[3px]"
          style={{ background: rarityColor(entry.globalPercent as number) }}
        />
      )}
      <div
        className={`relative h-12 w-12 overflow-hidden rounded-[10px] border transition-all duration-300 ${
          unlocked ? 'border-white/12' : 'border-border opacity-40 grayscale'
        }`}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={16} className="text-muted-foreground/40" />
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
  const rare = percent !== null && percent < RARE;

  return (
    <div
      className={`group/ach relative flex items-start gap-3 overflow-hidden rounded-[12px] border px-3 py-2.75 transition-colors duration-200 ${
        unlocked
          ? 'border-white/8 bg-white/[0.035] hover:bg-white/[0.055]'
          : 'border-border/50 bg-white/[0.012] hover:bg-white/[0.025]'
      }`}
    >
      {/* Filo de color a la izquierda en los conseguidos: la misma gramática
          que la barra de estado de la tarjeta del modo TV. */}
      {unlocked && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px]"
          style={{ background: rare ? rarityColor(percent as number) : GREEN, opacity: 0.7 }}
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
              Los comunes van apagados, los raros con su color. */}
          {percent !== null && (
            <span
              className="flex-none rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
              style={
                rare
                  ? { background: `${rarityColor(percent)}1f`, color: rarityColor(percent) }
                  : { color: 'var(--muted-foreground)', opacity: 0.65 }
              }
              title={`${percent.toFixed(1)}% of players have this`}
            >
              {percentLabel(percent)}
            </span>
          )}
        </div>

        <AchievementDescription entry={entry} unlocked={unlocked} />

        {/* La fecha es la mitad de la gracia: un logro con fecha es un
            recuerdo, sin ella es una casilla. Pero solo se enseña como fecha
            si es de fiar — si vino del arrastre masivo de un crack, decir
            "12:33 de hoy" sería inventarse un momento que no existió. */}
        {entry.unlockedAt && (
          <div
            className="mt-1.25 flex items-center gap-1.5 text-[10.5px] font-semibold"
            style={{ color: entry.dateReliable ? GREEN : 'var(--muted-foreground)' }}
          >
            <Trophy size={10} className="flex-none" />
            {entry.dateReliable
              ? formatByPrecision(entry.unlockedAt, 'datetime', timeFormat)
              : 'Unlocked · date unknown'}
            {/* De dónde nos consta. Solo cuando NO es la vía normal: que un
                logro venga de Steam no es noticia, que venga del emulador de
                un juego pirata sí explica por qué está ahí. */}
            {!entry.sources.includes('steam') && entry.sources.includes('emu') && (
              <span className="ml-0.5 rounded px-1 py-0.5 text-[9px] font-bold tracking-[.06em] text-muted-foreground/60 uppercase">
                local
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
  const [expanded, setExpanded] = useState(false);

  if (!data || data.entries.length === 0) return null;

  // Los conseguidos, más recientes arriba: lo que acabas de sacar es lo que
  // quieres ver al abrir la ficha. Los pendientes, en el orden de Steam.
  //
  // Los de fecha NO fiable van detrás de todos los fechados, por muy "de hoy"
  // que parezcan: su fecha es la del rescate, y dejarlos arriba desplazaría a
  // los que sí tienen un momento real detrás.
  const unlocked = data.entries
    .filter((entry) => entry.unlockedAt !== null)
    .sort((a, b) => {
      if (a.dateReliable !== b.dateReliable) return a.dateReliable ? -1 : 1;
      return (b.unlockedAt as Date).getTime() - (a.unlockedAt as Date).getTime();
    });
  const locked = data.entries.filter((entry) => entry.unlockedAt === null);
  const percent = Math.round((unlocked.length / data.entries.length) * 100);
  const rareCount = unlocked.filter(
    (entry) => entry.globalPercent !== null && entry.globalPercent < RARE,
  ).length;

  // UN SOLO ORDEN, plegada y expandida: conseguidos primero. Antes la versión
  // plegada repartía huecos entre las dos mitades y al expandir la lista se
  // reordenaba entera bajo el cursor — un salto desagradable y la sensación
  // de que las filas se movían solas. Ahora expandir solo AÑADE al final.
  const sorted = [...unlocked, ...locked];
  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_COUNT);
  const hiddenCount = sorted.length - visible.length;

  return (
    <div className="mt-7.5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SectionLabel>ACHIEVEMENTS</SectionLabel>
          {/* Los raros como medalla aparte: en una lista de 40 logros, haber
              sacado 3 que casi nadie tiene es la parte de la que se presume. */}
          {rareCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full px-1.75 py-0.5 text-[10px] font-bold"
              style={{ background: `${AMBER}1a`, color: AMBER }}
              title={`${rareCount} rare achievement${rareCount === 1 ? '' : 's'} (under ${RARE}% of players)`}
            >
              <Sparkles size={9} />
              {rareCount} rare
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[19px] leading-none font-extrabold tabular-nums text-foreground">
            {unlocked.length}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground tabular-nums">
            / {data.entries.length}
          </span>
          {data.unlocksSyncedAt && (
            <span
              className="ml-1 text-[12px] font-bold tabular-nums"
              style={{ color: percent === 100 ? AMBER : GREEN }}
            >
              {percent}%
            </span>
          )}
        </div>
      </div>

      {/* Barra de progreso: con un brillo al final del relleno, que es lo que
          la hace parecer viva en vez de un rectángulo pintado. */}
      <div className="relative mb-3 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${percent}%`,
            background:
              percent === 100
                ? `linear-gradient(90deg, ${GREEN}, ${AMBER})`
                : `linear-gradient(90deg, ${GREEN}99, ${GREEN})`,
            boxShadow: percent > 0 ? `0 0 8px ${GREEN}66` : undefined,
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {visible.map((entry, index) => (
          <div
            key={entry.id}
            className={revealClass}
            // El escalonado solo en las primeras: con la lista expandida a 200
            // filas, un delay por fila tardaría segundos en acabar de entrar.
            style={revealStyle(Math.min(index, 6))}
          >
            <AchievementRow entry={entry} timeFormat={timeFormat} />
          </div>
        ))}
      </div>

      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 w-full rounded-[10px] border border-input bg-white/[0.02] py-2 text-[12px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-white/[0.05] hover:text-foreground"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
};
