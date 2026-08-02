import { Clock3, Flame, ScrollText, Timer } from 'lucide-react';
import { useMemo } from 'react';
import type { GameDetail, Session, TimeFormat } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
  pluralize,
} from '../../lib/format';
import { useTvFocusable } from '../focusContext';
import { tvRevealClass, tvRevealStyle } from '../styles';

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
  liveSeconds,
  maxDurationSec,
  timeFormat,
}: {
  session: Session;
  index: number;
  // Contador de la única sesión viva posible — el hook vive en el padre
  // (una sola llamada, regla de hooks) y aquí solo llega el número.
  liveSeconds: number;
  maxDurationSec: number;
  timeFormat: TimeFormat;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({});
  const live = session.endedAt === null;
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
      className={`relative overflow-hidden rounded-[0.45em] px-[0.7em] py-[0.5em] transition-[background-color,box-shadow] duration-150 ${
        reveal ? tvRevealClass : ''
      }`}
      style={{
        ...(reveal ? tvRevealStyle(index) : undefined),
        // La viva viste el verde de la casa aunque nadie la enfoque: es el
        // único elemento de la lista que está PASANDO ahora mismo.
        ...(live
          ? {
              background: focused ? 'rgba(47,220,126,.1)' : 'rgba(47,220,126,.06)',
              boxShadow: focused
                ? 'inset 0 0 0 1px rgba(47,220,126,.6)'
                : 'inset 0 0 0 1px rgba(47,220,126,.4)',
            }
          : focused
            ? {
                background: 'rgba(133,163,214,.09)',
                boxShadow: 'inset 0 0 0 1px rgba(133,163,214,.32)',
              }
            : undefined),
      }}
    >
      {/* El relleno proporcional: mínimo un 3% para que hasta la sesión más
          corta deje traza, y el canto derecho marcado para que el ojo pueda
          comparar longitudes entre filas. La viva no lleva barra — su
          longitud aún se está escribiendo. */}
      {!live && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${Math.max(3, (durationSec / maxDurationSec) * 100)}%`,
            background: 'linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.01))',
            borderRight: '1.5px solid rgba(255,255,255,.14)',
          }}
        />
      )}
      <div className="relative flex items-baseline justify-between gap-[0.6em] text-[0.68em]">
        <span className="min-w-0 truncate font-bold text-foreground/85">
          {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
          {/* La hora de FIN, que el escritorio ya enseñaba y aquí faltaba:
              solo existe con endedAt y precisión datetime (el helper decide). */}
          {endTime && (
            <span className="ml-[0.5em] font-semibold text-white/40 tabular-nums">→ {endTime}</span>
          )}
        </span>
        <span
          className="flex flex-none items-center gap-[0.35em] font-semibold tabular-nums"
          style={{ color: live ? '#2fdc7e' : 'rgba(133,163,214,.85)' }}
        >
          {isRecord && (
            <Flame
              className="h-[1.05em] w-[1.05em]"
              style={{ color: '#e85d72', filter: 'drop-shadow(0 0 0.4em rgba(232,93,114,.5))' }}
            />
          )}
          {formatElapsed(live ? liveSeconds : durationSec)}
        </span>
      </div>
      <div
        className="relative mt-[0.1em] text-[0.55em] font-semibold"
        style={{ color: live ? '#2fdc7e' : 'var(--muted-foreground)' }}
      >
        {live ? 'Live now' : session.isManual ? 'Manual' : 'Tracked'}
      </div>
      {/* La nota en su color de recuerdo, con el lomo ámbar como hairline de
          boxShadow (la regla de la casa: nada de px fuera de ahí). */}
      {note.length > 0 && (
        <div
          className="relative mt-[0.25em] pl-[0.6em] text-[0.62em] leading-snug italic"
          style={{ color: '#b7bdb8', boxShadow: 'inset 2px 0 0 #e3b24a55' }}
        >
          “{note}”
        </div>
      )}
    </div>
  );
};

export const TvDetailSessions = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  // TODAS las sesiones de todas las vueltas, de nueva a vieja — también la
  // abierta: en el sofá es justo la que más interesa ver correr.
  const sessions = useMemo(
    () =>
      game.iterations
        .flatMap((iteration) => iteration.sessions)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
    [game],
  );
  // Solo las CERRADAS opinan en las métricas: la viva aún no tiene duración
  // honesta que sumar ni con la que competir.
  const closed = useMemo(() => sessions.filter((session) => session.endedAt !== null), [sessions]);
  const totalSec = closed.reduce((sum, session) => sum + (session.durationSec ?? 0), 0);
  const longestSec = closed.reduce((max, session) => Math.max(max, session.durationSec ?? 0), 0);
  const avgSec = closed.length > 0 ? totalSec / closed.length : 0;
  // Clamp a 1 para que la división de la barra nunca explote con una
  // biblioteca de duraciones a cero.
  const maxDurationSec = Math.max(1, longestSec);

  // Como mucho hay UNA sesión abierta (el watcher solo vigila un proceso a
  // la vez), así que el hook del contador se llama una única vez aquí y las
  // filas reciben el número — jamás un hook dentro del map.
  const liveStartedAt = useMemo(
    () => sessions.find((session) => session.endedAt === null)?.startedAt ?? null,
    [sessions],
  );
  const liveSeconds = useLiveTimer(liveStartedAt);

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[0.75em] text-muted-foreground">
        No sessions yet.
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Las cuatro métricas en una línea, cada una con su color de la casa:
          azul de sesiones, verde de tiempo, rojo de récords, violeta de
          ratios — el resumen antes del detalle. */}
      <div
        className={`flex flex-none flex-wrap items-center gap-x-[0.7em] gap-y-[0.25em] pb-[0.6em] text-[0.72em] font-semibold text-white/70 ${tvRevealClass}`}
        style={tvRevealStyle(0)}
      >
        <span className="flex items-center gap-[0.4em]">
          <ScrollText className="h-[1.05em] w-[1.05em]" style={{ color: '#85a3d6' }} />
          <span className="text-[#85a3d6] tabular-nums">
            {pluralize(sessions.length, 'session')}
          </span>
        </span>
        <span className="text-white/25">·</span>
        <span className="flex items-center gap-[0.4em]">
          <Clock3 className="h-[1.05em] w-[1.05em]" style={{ color: '#2fdc7e' }} />
          <span className="text-[#2fdc7e] tabular-nums">{formatHours(totalSec / 3600)}</span>
          <span className="text-white/40">played</span>
        </span>
        <span className="text-white/25">·</span>
        <span className="flex items-center gap-[0.4em]">
          <Flame className="h-[1.05em] w-[1.05em]" style={{ color: '#e85d72' }} />
          <span className="text-[#e85d72] tabular-nums">{formatHours(longestSec / 3600)}</span>
          <span className="text-white/40">longest</span>
        </span>
        <span className="text-white/25">·</span>
        <span className="flex items-center gap-[0.4em]">
          <Timer className="h-[1.05em] w-[1.05em]" style={{ color: '#7c86c8' }} />
          <span className="text-[#7c86c8] tabular-nums">{formatHours(avgSec / 3600)}</span>
          <span className="text-white/40">avg</span>
        </span>
      </div>

      {/* El mismo par de colchones que la pestaña de logros: padding mayor
          que el fundido (1.4em) para que la última fila pueda salir de
          debajo, y scroll-padding para que el conductor de scroll del foco
          no la alinee a ras del borde — justo bajo el degradado. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto pb-[1.8em]"
        style={{
          scrollbarWidth: 'none',
          scrollPaddingTop: '0.35em',
          scrollPaddingBottom: '1.6em',
        }}
      >
        <div className="flex flex-col gap-[0.2em]">
          {sessions.map((session, index) => (
            <DetailSessionRow
              key={session.id}
              session={session}
              index={index}
              liveSeconds={liveSeconds}
              maxDurationSec={maxDurationSec}
              timeFormat={timeFormat}
            />
          ))}
        </div>
      </div>
      {/* El fundido inferior: la lista muere a transparente como pista de
          que hay más historia debajo del pliegue. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.4em] bg-gradient-to-t from-black/60 to-transparent"
      />
    </div>
  );
};
