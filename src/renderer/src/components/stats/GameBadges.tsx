import { cn } from '../../lib/utils';
import {
  CalendarDays,
  Clock,
  Crown,
  Flame,
  Gift,
  Moon,
  Repeat,
  Swords,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { hasMeasuredDuration } from '../../lib/sessionStats';
import { floatingPanelClass } from '../../lib/styles';
import { StatCard } from './StatCard';

type BadgeSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  // Hace falta para descartarlas: una fila manual con precisión de mes o año
  // se guarda a las 00:00 del día 1, así que ni su hora ni su día de la
  // semana existieron — ver el filtro del reparto de abajo.
  isManual: boolean;
};

type GameBadgesProps = {
  totalHours: number;
  totalSpent: number;
  // La sesión MEDIDA más larga, con el mismo predicado que todo lo demás de
  // aquí: "a single session of 4 hours or more" habla de una sentada, y una
  // fila manual de 60h con precisión de año no lo es. La card "Session
  // records" de la misma pantalla sí las cuenta a propósito — ahí la
  // pregunta es "cuál es la sesión más larga registrada", no "qué te
  // tragaste de un tirón", así que los dos números pueden no coincidir.
  longestSessionSec: number;
  longestStreakDays: number;
  // Sesiones MEDIDAS, contadas con el mismo predicado que el reparto de
  // abajo (hasMeasuredDuration): el criterio del trofeo Regular dice
  // literalmente "tracked sessions", así que una fila manual no cuenta.
  sessionCount: number;
  // ¿Tiene al menos un Completed en su historial? (no el estado actual —
  // un Beaten rejugado y ahora Playing sigue teniendo el logro).
  beaten: boolean;
  hltbCompletionist: number | null;
  sessions: BadgeSession[];
};

type Badge = {
  key: string;
  label: string;
  // Criterio en texto — el tooltip lo enseña tanto ganado como bloqueado,
  // para que se sepa qué hay que hacer.
  criteria: string;
  Icon: LucideIcon;
  color: string;
  earned: boolean;
};

// Vitrina de logros PERSONALES del juego — no logros del juego en sí, sino
// de tu relación con él (maratones, rachas, madrugadas...). Los bloqueados
// se enseñan apagados con su criterio en el tooltip: coleccionables, no
// decoración. Todo sale de datos ya presentes en la pantalla.
export const GameBadges = ({
  totalHours,
  totalSpent,
  longestSessionSec,
  longestStreakDays,
  sessionCount,
  beaten,
  hltbCompletionist,
  sessions,
}: GameBadgesProps): React.JSX.Element => {
  // Reparto de segundos jugados por franja de arranque de la sesión — para
  // Night Owl y Weekend Warrior. Solo tiempo MEDIDO (SPEC 8.1 regla 1;
  // hasMeasuredDuration descarta además las abiertas, que no tienen duración
  // aún). Sin el filtro de manuales, una fila histórica con precisión de año
  // regalaba los dos trofeos desde su 1 de enero a las 00:00 —domingo y
  // madrugada de relleno— mientras "When do you play it?", que sí filtra y
  // recibe el MISMO array, no pintaba ni un segundo ese domingo.
  let totalSec = 0;
  let nightSec = 0;
  let weekendSec = 0;
  for (const session of sessions) {
    if (!hasMeasuredDuration(session)) continue;
    const seconds = session.durationSec ?? 0;
    totalSec += seconds;
    const hour = session.startedAt.getHours();
    if (hour >= 22 || hour < 6) nightSec += seconds;
    const day = session.startedAt.getDay();
    if (day === 0 || day === 6) weekendSec += seconds;
  }

  // `criteria` y `earned` son el mismo trato contado dos veces: uno para el
  // usuario y otro para la máquina. Tocar el umbral sin tocar la frase deja
  // un logro que dice una cosa y hace otra — pasó con Night Owl, que anunciaba
  // "más de un tercio" mientras exigía el 35%. Van pegados por eso.
  const badges: Badge[] = [
    {
      key: 'beaten',
      label: 'Beaten',
      criteria: 'Complete the game at least once.',
      Icon: Trophy,
      color: '#e3b24a',
      earned: beaten,
    },
    {
      key: 'centurion',
      label: 'Centurion',
      criteria: 'Reach 100 hours of total playtime.',
      Icon: Clock,
      color: '#e3b24a',
      earned: totalHours >= 100,
    },
    {
      key: 'marathoner',
      label: 'Marathoner',
      criteria: 'Play a single session of 4 hours or more.',
      Icon: Flame,
      color: '#e85d72',
      earned: longestSessionSec >= 4 * 3600,
    },
    {
      key: 'devoted',
      label: 'Devoted',
      criteria: 'Play 7 days in a row.',
      Icon: CalendarDays,
      color: '#2fdc7e',
      earned: longestStreakDays >= 7,
    },
    {
      key: 'regular',
      label: 'Regular',
      criteria: 'Log 50 tracked sessions.',
      Icon: Repeat,
      color: '#85a3d6',
      earned: sessionCount >= 50,
    },
    {
      key: 'completionist',
      label: 'Completionist',
      criteria: "Beat it with more hours than HowLongToBeat's 100% time.",
      Icon: Crown,
      color: '#e3b24a',
      earned: beaten && hltbCompletionist !== null && totalHours >= hltbCompletionist,
    },
    {
      key: 'night-owl',
      label: 'Night Owl',
      criteria: 'Play 35% or more of your time starting between 22:00 and 06:00.',
      Icon: Moon,
      color: '#7c86c8',
      earned: totalSec > 0 && nightSec / totalSec >= 0.35,
    },
    {
      key: 'weekend-warrior',
      label: 'Weekend Warrior',
      criteria: 'Play 60% or more of your time on weekends.',
      Icon: Swords,
      color: '#2fdc7e',
      earned: totalSec > 0 && weekendSec / totalSec >= 0.6,
    },
    {
      key: 'free-ride',
      label: 'Free Ride',
      criteria: 'Play 20+ hours without spending a cent.',
      Icon: Gift,
      color: '#85a3d6',
      earned: totalHours >= 20 && totalSpent === 0,
    },
  ];

  const earnedCount = badges.filter((badge) => badge.earned).length;
  const earnedPct = (earnedCount / badges.length) * 100;

  return (
    <StatCard
      className={cn(
        'afterplay-game-badges',
        'relative flex h-full flex-col overflow-visible',
        'border-white/[0.075] shadow-[inset_0_1px_rgba(255,255,255,0.025)]',
        '[background:radial-gradient(circle_at_8%_0%,rgba(227,178,74,0.06),transparent_32%),var(--card)]',
      )}
    >
      <div className="afterplay-game-card-heading mb-4.25 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-foreground">Trophy cabinet</span>
          <small className="text-[10.5px] text-white/[0.34]">
            Milestones from your relationship with this game
          </small>
        </div>
        <div className="afterplay-game-badges-score flex items-baseline text-[10px] font-bold text-white/[0.32]">
          <strong className="text-[24px] leading-none font-[950] text-[#e3b24a]">
            {earnedCount}
          </strong>
          <span>/ {badges.length}</span>
        </div>
      </div>

      <div
        className={cn(
          'afterplay-game-badges-progress',
          'mx-0 -mt-1.5 mb-4.25 h-0.5 overflow-hidden rounded-[99px]',
          'bg-white/[0.045]',
          '[&_i]:[background:linear-gradient(90deg,#e3b24a,#2fdc7e)]',
          '[&_i]:shadow-[0_0_12px_rgba(227,178,74,0.25)] [&_i]:origin-left',
          '[&_i]:animate-[afterplay-game-run-in_750ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
          'motion-reduce:[&_i]:animate-none motion-reduce:[&_i]:transition-none',
        )}
        aria-hidden="true"
      >
        <i className="block h-full rounded-[inherit]" style={{ width: `${earnedPct}%` }} />
      </div>

      <div
        className={cn(
          'afterplay-game-badges-grid',
          'grid grid-cols-3 gap-2',
          '[@media(1040px<width<=1120px)]:grid-cols-[repeat(2,minmax(0,1fr))]',
          '[@media(760px<width<=1040px)]:grid-cols-[repeat(3,minmax(0,1fr))]',
          '[@media(width<=760px)]:grid-cols-[repeat(2,minmax(0,1fr))]',
        )}
      >
        {badges.map((badge) => (
          <div
            key={badge.key}
            tabIndex={0}
            role="group"
            className={cn(
              'afterplay-game-badge group/badge',
              'relative grid min-h-15 min-w-0 grid-cols-[34px_minmax(0,_1fr)] items-center gap-2.25 overflow-visible',
              'rounded-[10px] p-2.25',
              '[--badge-color:var(--primary)] border border-white/[0.055] outline-none bg-white/[0.02]',
              '[&.is-earned:not(:where(:hover,:focus-visible))]:border-[color-mix(in_srgb,var(--badge-color)_22%,rgba(255,255,255,0.045))]',
              '[&.is-earned:not(:where(:hover,:focus-visible))]:[background:linear-gradient(135deg,color-mix(in_srgb,var(--badge-color)_7%,transparent),rgba(255,255,255,0.017))]',
              '[&.is-locked:not(:where(:hover,:focus-visible))]:opacity-[0.44]',
              '[&.is-locked:not(:where(:hover,:focus-visible))]:filter-[grayscale(0.9)]',
              '[&:is(:hover,:focus-visible)]:z-[4]',
              '[&:is(:hover,:focus-visible)]:border-[color-mix(in_srgb,var(--badge-color)_40%,rgba(255,255,255,0.08))]',
              '[&:is(:hover,:focus-visible)]:bg-[color-mix(in_srgb,var(--badge-color)_9%,rgba(255,255,255,0.02))]',
              '[&:is(:hover,:focus-visible)]:shadow-[0_12px_24px_rgba(0,0,0,0.24)]',
              '[&:is(:hover,:focus-visible)]:opacity-[1] [&:is(:hover,:focus-visible)]:filter-none',
              '[&:is(:hover,:focus-visible)]:transform-[translateY(-3px)]',
              '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1),border-color_200ms_ease,background-color_200ms_ease,box-shadow_240ms_ease]',
              'motion-reduce:animate-none motion-reduce:transition-none',
              badge.earned ? 'is-earned' : 'is-locked',
            )}
            style={{ '--badge-color': badge.color } as CSSProperties}
            aria-label={`${badge.label}: ${badge.earned ? 'unlocked' : 'locked'}. ${badge.criteria}`}
          >
            <span
              className={cn(
                'afterplay-game-badge-medallion',
                'relative flex size-8.5 items-center justify-center rounded-[50%] text-(--badge-color)',
                'border border-[color-mix(in_srgb,var(--badge-color)_28%,transparent)]',
                'bg-[color-mix(in_srgb,var(--badge-color)_10%,rgba(0,0,0,0.25))]',
                'group-[:is(:hover,:focus-visible)]/badge:shadow-[0_0_18px_color-mix(in_srgb,var(--badge-color)_20%,transparent)]',
                'group-[:is(:hover,:focus-visible)]/badge:transform-[rotate(-6deg)_scale(1.08)]',
                '[transition:transform_320ms_cubic-bezier(0.22,1,0.36,1),box-shadow_220ms_ease]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
            >
              <badge.Icon size={16} />
            </span>
            <div className="afterplay-game-badge-copy flex min-w-0 flex-col gap-0.5">
              <strong className="truncate text-[10.5px] font-extrabold text-foreground">
                {badge.label}
              </strong>
              <small className="text-[7px] font-black tracking-[0.09em] text-(--badge-color)">
                {badge.earned ? 'UNLOCKED' : 'LOCKED'}
              </small>
            </div>
            <i
              className={cn(
                'afterplay-game-badge-glint',
                'absolute top-0 bottom-0 left-[-45%] w-[32%]',
                '[background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)]',
                'transform-[skewX(-16deg)] opacity-[0]',
                'group-[&.is-earned:hover]/badge:opacity-[1]',
                'group-[&.is-earned:hover]/badge:animate-[afterplay-game-badge-glint_700ms_ease-out_both]',
                'group-[&.is-earned:focus-visible]/badge:opacity-[1]',
                'group-[&.is-earned:focus-visible]/badge:animate-[afterplay-game-badge-glint_700ms_ease-out_both]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
              aria-hidden="true"
            />
            <div
              className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-54 -translate-x-1/2 rounded-[9px] border ${floatingPanelClass} px-2.75 py-1.75 text-center text-[11.5px] text-muted-foreground group-hover/badge:block group-focus/badge:block`}
            >
              {badge.criteria}
            </div>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
