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
import { floatingPanelClass } from '../../lib/styles';
import { StatCard } from './StatCard';

type BadgeSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
};

type GameBadgesProps = {
  totalHours: number;
  totalSpent: number;
  longestSessionSec: number;
  longestStreakDays: number;
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
  // Night Owl y Weekend Warrior. Solo cerradas (las abiertas no tienen
  // duración aún).
  let totalSec = 0;
  let nightSec = 0;
  let weekendSec = 0;
  for (const session of sessions) {
    if (session.endedAt === null) continue;
    const seconds = session.durationSec ?? 0;
    totalSec += seconds;
    const hour = session.startedAt.getHours();
    if (hour >= 22 || hour < 6) nightSec += seconds;
    const day = session.startedAt.getDay();
    if (day === 0 || day === 6) weekendSec += seconds;
  }

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
      criteria: 'Play over a third of your time starting between 22:00 and 06:00.',
      Icon: Moon,
      color: '#7c86c8',
      earned: totalSec > 0 && nightSec / totalSec >= 0.35,
    },
    {
      key: 'weekend-warrior',
      label: 'Weekend Warrior',
      criteria: 'Play over 60% of your time on weekends.',
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

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="text-[14px] font-bold text-foreground">Trophy cabinet</div>
        <div className="text-[11.5px] text-muted-foreground tabular-nums">
          {earnedCount} of {badges.length} unlocked
        </div>
      </div>

      <div className="flex flex-1 flex-wrap content-center gap-2">
        {badges.map((badge) => (
          <div key={badge.key} className="group/badge relative">
            <div
              className="flex items-center gap-1.75 rounded-[10px] border px-2.75 py-2"
              style={
                badge.earned
                  ? { background: `${badge.color}1f`, borderColor: `${badge.color}59` }
                  : {
                      background: 'rgba(255,255,255,.02)',
                      borderColor: 'var(--input)',
                      opacity: 0.4,
                      filter: 'grayscale(1)',
                    }
              }
            >
              <badge.Icon
                size={14}
                color={badge.earned ? badge.color : 'var(--muted-foreground)'}
              />
              <span
                className="text-[12px] font-bold"
                style={{ color: badge.earned ? badge.color : 'var(--muted-foreground)' }}
              >
                {badge.label}
              </span>
            </div>
            <div
              className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max max-w-52 -translate-x-1/2 rounded-[9px] border ${floatingPanelClass} px-2.75 py-1.75 text-center text-[11.5px] text-muted-foreground group-hover/badge:block`}
            >
              {badge.criteria}
            </div>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
