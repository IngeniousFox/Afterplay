import { Flame, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import type { AchievementEntry, GameDetail, Session, TimeFormat } from '../../../../shared/types';
import { useSessionDevice } from '../../hooks/sessionDevice';
import { useGameAchievements } from '../../hooks/achievements';
import { useTimeFormat } from '../../hooks/settings';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
} from '../../lib/format';
import { allSessions } from '../../lib/sessions';
import { useTvFocusable } from '../focusContext';
import { cn } from '@/lib/utils';
import {
  tvFocusHalo,
  tvFocusMotion,
  tvLabelClass,
  tvPanelClass,
  tvRevealClass,
  tvRevealStyle,
} from '../styles';
import { TvFigure } from '../tvUi';
import type { SessionId } from '../../../../shared/entityIds';

// El historial COMPLETO de sesiones en la ficha TV — la paridad de sofá del
// SessionHistoryList de escritorio, en lectura absoluta: métricas arriba en
// una línea y todas las sesiones (también la que está corriendo ahora mismo)
// en una lista que el stick recorre. Lo que el usuario echaba de menos aquí
// era el FIN de cada sesión, no solo el inicio: la flecha '→ 23:45' junto a
// la fecha cierra ese hueco.

// Fila de sesión, con el lenguaje de SessionRowTv (TvGameDetail): enfocable
// solo para que el stick recorra y la lista haga scroll (sin onSelect — el
// motor silencia A sobre ella), y la luz del foco SIEMPRE dentro de la fila
// (fondo suave + anillo interior), porque la lista recorta cualquier halo.
// La fila además ES su propia barra: el relleno proporcional a la duración
// vive detrás del texto — leer la lista es leer el histograma.
const DetailSessionRow = ({
  session,
  index,
  nowMs,
  maxDurationSec,
  timeFormat,
  achievements,
}: {
  session: Session;
  index: number;
  // La hora del contador en vivo — el hook vive en el padre (una sola
  // llamada, regla de hooks) y cada fila abierta resta su propio inicio: con
  // dos PCs jugando el mismo juego hay dos abiertas (§10.4).
  nowMs: number;
  maxDurationSec: number;
  timeFormat: TimeFormat;
  // Los logros que cayeron EN esta sesión (LOGROS-IDEAS.md §2.1).
  achievements: AchievementEntry[];
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({});
  const live = session.endedAt === null;
  const liveSeconds = Math.max(0, (nowMs - session.startedAt.getTime()) / 1000);
  // §10.8: abierta en otro PC = "Playing on PC-A"; y con más de un dispositivo
  // conocido cada fila dice dónde se jugó.
  const device = useSessionDevice(session);
  const durationSec = session.durationSec ?? 0;
  // La llama solo corona una sesión CERRADA que de verdad tocó el techo —
  // con todo a cero no hay récord que celebrar (el clamp a 1 lo garantiza).
  const isRecord = !live && durationSec > 0 && durationSec === maxDurationSec;
  const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);
  const note = session.note?.trim() ?? '';
  // La cascada de entrada solo para las primeras filas: a partir de ahí los
  // retardos ya no se leen como cascada y solo retrasarían el scroll.
  const reveal = index < 8;

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex items-center gap-[1.2em] border-b border-line px-[0.8em] py-[0.7em]',
        tvFocusMotion,
        live ? 'bg-live/10' : 'bg-transparent',
        focused && ['bg-raised', tvFocusHalo],
        reveal && tvRevealClass,
      )}
      style={reveal ? tvRevealStyle(index) : undefined}
    >
      <div className="min-w-0 flex-[1.3]">
        <div className="font-bold text-bone">
          {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
          {/* La hora de FIN: solo existe con endedAt y precisión datetime. */}
          {endTime && (
            <span className="ml-[0.5em] font-semibold text-dust tabular-nums">→ {endTime}</span>
          )}
        </div>
        <div
          className={cn('mt-[0.1em] text-[0.92em] font-semibold', live ? 'text-live' : 'text-dust')}
        >
          {live ? (
            <span className="inline-flex items-center gap-[0.4em]">
              <span aria-hidden className="inline-block size-[0.55em] rounded-full bg-live" />
              {device.remote ? `Playing on ${device.deviceName}` : 'Live now'}
            </span>
          ) : session.isManual ? (
            'Manual'
          ) : (
            'Tracked'
          )}
          {!live && device.deviceTag !== null && ` · ${device.deviceTag}`}
          {device.noSignal !== null && (
            <span className="ml-[0.6em] text-phosphor">{device.noSignal}</span>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-[0.4em]">
        {isRecord && <Flame className="size-[1.2em] text-phosphor" />}
        <TvFigure
          value={live ? formatElapsed(liveSeconds) : formatHours(durationSec / 3600)}
          className={cn('text-[1.7em]', live && 'text-phosphor')}
        />
      </div>
      <div className="flex min-w-0 flex-[1.5] flex-col gap-[0.35em]">
        {/* Los logros de la sesión. */}
        {achievements.length > 0 && (
          <div className="flex items-center gap-[0.4em] text-[0.92em] font-semibold text-phosphor">
            <Trophy className="size-[1.1em] flex-none" />
            {achievements.length === 1
              ? achievements[0].displayName
              : `${achievements.length} achievements`}
          </div>
        )}
        {note.length > 0 && (
          <div className="border-l-2 border-phosphor pl-[0.6em] text-[0.92em] leading-snug text-bone">
            “{note}”
          </div>
        )}
      </div>
    </div>
  );
};

export const TvDetailSessions = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  // Los logros por sesión (LOGROS-IDEAS.md §2.1) — mismo cruce que el
  // historial de escritorio: el main ya los colgó de su sesión, aquí solo se
  // indexan por sessionId.
  const { data: achievementsData } = useGameAchievements(game.id);
  const achievementsBySession = useMemo(() => {
    const map = new Map<SessionId, AchievementEntry[]>();
    for (const entry of achievementsData?.entries ?? []) {
      if (entry.sessionId === null || entry.unlockedAt === null) continue;
      const list = map.get(entry.sessionId) ?? [];
      list.push(entry);
      map.set(entry.sessionId, list);
    }
    return map;
  }, [achievementsData]);

  // TODAS las sesiones de todas las vueltas, de nueva a vieja — también la
  // abierta: en el sofá es justo la que más interesa ver correr.
  const sessions = useMemo(() => allSessions(game), [game]);
  // Solo las CERRADAS opinan en las métricas: la viva aún no tiene duración
  // honesta que sumar ni con la que competir.
  const closed = useMemo(() => sessions.filter((session) => session.endedAt !== null), [sessions]);
  const totalSec = closed.reduce((sum, session) => sum + (session.durationSec ?? 0), 0);
  const longestSec = closed.reduce((max, session) => Math.max(max, session.durationSec ?? 0), 0);
  const avgSec = closed.length > 0 ? totalSec / closed.length : 0;
  // Clamp a 1 para que la comparación del récord nunca dependa de un cero.
  const maxDurationSec = Math.max(1, longestSec);

  // Como mucho hay UNA abierta por dispositivo (§10.4), así que el hook del
  // contador se llama una única vez aquí, anclado a la abierta más antigua, y
  // las filas reciben la hora y restan su propio inicio — jamás un hook de
  // contador dentro del map.
  const liveStartedAt = useMemo(() => {
    const open = sessions.filter((session) => session.endedAt === null);
    return open.length === 0
      ? null
      : new Date(Math.min(...open.map((session) => session.startedAt.getTime())));
  }, [sessions]);
  const liveSeconds = useLiveTimer(liveStartedAt);
  const nowMs = liveStartedAt === null ? 0 : liveStartedAt.getTime() + liveSeconds * 1000;

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[1em] text-dust">
        No sessions yet.
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Resumen en cifras antes del detalle, separadas por líneas finas. */}
      <div
        className={cn(
          'mx-[0.6em] mb-[0.6em] flex flex-none flex-wrap items-stretch gap-y-[0.4em]',
          tvPanelClass,
          tvRevealClass,
        )}
        style={tvRevealStyle(0)}
      >
        {[
          { label: 'Played', value: formatHours(totalSec / 3600), accent: true },
          { label: 'Longest', value: formatHours(longestSec / 3600), accent: false },
          { label: 'Average', value: formatHours(avgSec / 3600), accent: false },
          { label: 'Sessions', value: String(sessions.length), accent: false },
        ].map((item, i) => (
          <div
            key={item.label}
            className={cn('flex-1 px-[1.2em] py-[0.7em]', i > 0 && 'border-l border-line')}
          >
            <div className={tvLabelClass}>{item.label}</div>
            <TvFigure
              value={item.value}
              className={cn(
                'mt-[0.2em] block text-[1.8em]',
                item.accent ? 'text-phosphor' : 'text-bone',
              )}
            />
          </div>
        ))}
      </div>

      {/* El mismo par de colchones que la pestaña de logros: padding mayor
          que el fundido (1.4em) para que la última fila pueda salir de
          debajo, y scroll-padding para que el conductor de scroll del foco
          no la alinee a ras del borde — justo bajo el degradado. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-[0.6em] pt-[0.6em] pb-[1.8em]"
        style={{
          scrollbarWidth: 'none',
          scrollPaddingTop: '0.6em',
          scrollPaddingBottom: '1.6em',
        }}
      >
        <div className="flex flex-col">
          {sessions.map((session, index) => (
            <DetailSessionRow
              key={session.id}
              session={session}
              index={index}
              nowMs={nowMs}
              maxDurationSec={maxDurationSec}
              timeFormat={timeFormat}
              achievements={achievementsBySession.get(session.id) ?? []}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
