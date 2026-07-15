import { Calendar, Check, ChevronDown, Clock, DollarSign, Gamepad2, Gauge } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useGames } from '../hooks/games';
import { useAllSessions } from '../hooks/sessions';
import { useAllSpendEvents } from '../hooks/spend';
import { formatHours, formatMoney } from '../lib/format';

type Year = 'all' | number;

// Bloque 5B / prototipo (Backlog.html, panel STATS global) — "Games
// Tracked"/"Games Played" según haya año elegido o no, sin año es el total
// exacto de useGames() (misma fuente que Library/detalle); con año, solo
// cuenta sesiones REALES de ese año (getAllSessions ya trae fecha exacta) —
// manualTotalPlayed no tiene fecha propia, así que solo puede sumar al
// total "All Time", nunca a un año concreto (adaptación deliberada: el
// prototipo, con datos de mentira, reparte esas horas a partes iguales
// entre los años del juego, un atajo sin sentido con datos reales).
export const Stats = (): React.JSX.Element => {
  const [selectedYear, setSelectedYear] = useState<Year>('all');
  const [yearMenuOpen, setYearMenuOpen] = useState(false);

  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useAllSessions();
  const { data: spendEvents = [] } = useAllSpendEvents();

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const session of sessions) set.add(session.startedAt.getFullYear());
    for (const event of spendEvents) set.add(event.occurredAt.getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [sessions, spendEvents]);

  const trackedSecondsByGameInYear = useMemo(() => {
    if (selectedYear === 'all') return null;
    const map = new Map<number, number>();
    for (const session of sessions) {
      if (session.startedAt.getFullYear() !== selectedYear) continue;
      map.set(session.gameId, (map.get(session.gameId) ?? 0) + (session.durationSec ?? 0));
    }
    return map;
  }, [sessions, selectedYear]);

  const totalGames =
    selectedYear === 'all'
      ? games.length
      : games.filter((game) => (trackedSecondsByGameInYear?.get(game.id) ?? 0) > 0).length;

  const totalHours =
    selectedYear === 'all'
      ? games.reduce((sum, game) => sum + game.totalHours, 0)
      : [...(trackedSecondsByGameInYear?.values() ?? [])].reduce((sum, sec) => sum + sec, 0) / 3600;

  const totalSpent =
    selectedYear === 'all'
      ? spendEvents.reduce((sum, event) => sum + event.amount, 0)
      : spendEvents
          .filter((event) => event.occurredAt.getFullYear() === selectedYear)
          .reduce((sum, event) => sum + event.amount, 0);

  const costPerHour = totalHours > 0 ? totalSpent / totalHours : null;

  const yearLabel = selectedYear === 'all' ? 'All Time' : String(selectedYear);
  const gamesLabel = selectedYear === 'all' ? 'GAMES TRACKED' : 'GAMES PLAYED';
  const spentLabel = selectedYear === 'all' ? 'TOTAL SPENT' : `SPENT IN ${selectedYear}`;

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              All games
            </h1>
            <p className="mt-1.25 text-[13.5px] text-muted-foreground">
              Library-wide overview · select a game on the left for its own stats
            </p>
          </div>

          <Popover open={yearMenuOpen} onOpenChange={setYearMenuOpen}>
            <PopoverTrigger className="flex flex-none items-center gap-2.25 rounded-[10px] border border-input bg-white/[0.03] px-3.75 py-2.25 text-[13.5px] font-bold text-foreground hover:bg-white/[0.06]">
              <Calendar size={15} />
              <span>{yearLabel}</span>
              <ChevronDown size={15} />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="max-h-65 w-37.5 overflow-y-auto border-input bg-[rgba(23,25,24,.99)] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
            >
              {(['all', ...years] as Year[]).map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => {
                    setSelectedYear(year);
                    setYearMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[8px] px-2.75 py-2.25 text-left text-[13.5px] font-semibold text-foreground hover:bg-white/[0.06]"
                >
                  <span>{year === 'all' ? 'All Time' : year}</span>
                  {year === selectedYear && <Check size={14} className="text-primary" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <MetricCard Icon={Gamepad2} label={gamesLabel} value={String(totalGames)} />
          <MetricCard Icon={Clock} label="TOTAL PLAYTIME" value={formatHours(totalHours)} />
          <MetricCard Icon={DollarSign} label={spentLabel} value={formatMoney(totalSpent)} />
          <MetricCard
            Icon={Gauge}
            label="AVG COST / HOUR"
            value={costPerHour !== null ? formatMoney(costPerHour) : '—'}
          />
        </div>
      </div>
    </div>
  );
};
