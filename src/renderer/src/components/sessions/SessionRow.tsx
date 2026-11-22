import {
  Flame,
  Hourglass,
  Medal,
  Monitor,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Moment } from '../../../../shared/memory/moments';
import type { SessionWithGame } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { humanizeSpan } from '../../lib/dateMath';
import { formatElapsed, formatHours, formatTime } from '../../lib/format';
import { chartGroup, GlowText, growX, Odometer, useInView, VuMeter } from '../fx';
import { GameCover } from '../GameCover';
import { iconButtonClass } from '../shell/controls';
import { Figure } from './Figure';
import { SessionAchievements, type SessionAchievementEntry } from './SessionAchievements';
import { useSessionDevice } from '../../hooks/sessionDevice';
import { SessionNote } from './SessionNote';
import type { AchievementId } from '../../../../shared/entityIds';

type SessionRowProps = {
  session: SessionWithGame;
  // La etiqueta del DÍA en la columna de la izquierda ("Sun" / "Nov 22"), solo
  // en la primera fila de cada día: el resto del día cuelga de ella, que es lo
  // que agrupa el historial por días dentro de cada tramo. null = misma fecha
  // que la fila de arriba.
  day: { weekday: string | null; date: string } | null;
  // Abrir UN logro concreto en la ficha (LOGROS-REDISENO §1): la pantalla
  // pone la navegación; la fila solo dice cuál se pulsó.
  onOpenAchievement?: (achievementId: AchievementId) => void;
  // Duración de la sesión más larga del filtro activo — la fila lleva un
  // medidor proporcional bajo su duración, así el ojo compara duraciones sin
  // leer un solo número. 0 = sin medidor.
  maxDurationSec?: number;
  // ¿Es LA sesión más larga del filtro? — llamita al lado de la duración.
  isRecord?: boolean;
  // Los momentos señalados que esta sesión causó (AFTERPLAY-LOOP.md §5).
  moments?: Moment[];
  // Los trofeos que cayeron EN esta sesión (LOGROS-IDEAS.md §2.1).
  achievements?: SessionAchievementEntry[];
  // Papelera (abre la confirmación de la vista dueña). Solo en sesiones
  // CERRADAS — una en vivo se para con Stop, no se borra (el watcher la
  // reabriría al ciclo siguiente).
  onDelete?: () => void;
};

// Cada tipo de momento con su voz: icono, color y cómo se dice. Clases
// literales para que Tailwind las encuentre; el rojo queda para lo que está en
// marcha, así que el récord va en Phosphor como la cifra clave que es.
const momentBadge = (moment: Moment): { Icon: LucideIcon; className: string; label: string } => {
  switch (moment.type) {
    case 'first_session':
      return {
        Icon: Sparkles,
        className: 'border-st-beaten/35 bg-st-beaten/8 text-st-beaten',
        label: 'First session',
      };
    case 'return':
      return {
        Icon: Undo2,
        className: 'border-tube/35 bg-tube/8 text-tube',
        label: `Back after ${humanizeSpan(moment.awayDays)}`,
      };
    case 'longest_session':
      return {
        Icon: Flame,
        className: 'border-phosphor/40 bg-phosphor-tint text-phosphor',
        label: 'Longest session yet',
      };
    case 'hours_milestone':
      return {
        Icon: Hourglass,
        className: 'border-phosphor/40 bg-phosphor-tint text-phosphor',
        label: `Crossed ${moment.hours}h total`,
      };
    case 'sessions_milestone':
      return {
        Icon: Medal,
        className: 'border-st-resting/35 bg-st-resting/8 text-st-resting',
        label: `Session #${moment.count}`,
      };
  }
};

// Una fila del historial de Sessions (concepto Fósforo, sessions.png): día,
// juego, de qué hora a qué hora y en qué PC, duración en cifra grande y la nota
// de la sesión. Los momentos y los trofeos cuelgan bajo el juego. Se pinta
// dentro del panel de su tramo; las filas se separan con una línea.
export const SessionRow = ({
  session,
  day,
  onOpenAchievement,
  maxDurationSec = 0,
  isRecord = false,
  moments = [],
  achievements = [],
  onDelete,
}: SessionRowProps): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  // §10.8: una abierta en otro PC es "Playing on PC-A", y con más de un
  // dispositivo conocido cada fila dice en cuál se jugó.
  const device = useSessionDevice(session);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const ownLive = isLive && !device.remote;
  // El medidor de duración crece desde la izquierda la primera vez que la
  // fila entra en pantalla (un observador compartido para todas las filas).
  const { observe: observeMeter, inView: meterInView } = useInView();

  // La franja horaria solo existe con hora de verdad: una manual de "un día"
  // o de "un mes" no tiene inicio ni fin que contar.
  const hasClock = session.datePrecision === 'datetime';
  const start = hasClock ? formatTime(session.startedAt, timeFormat) : null;
  const end = hasClock && session.endedAt !== null ? formatTime(session.endedAt, timeFormat) : null;

  // Las vivas no llevan medidor (su duración aún crece).
  const fillPct =
    !isLive && maxDurationSec > 0
      ? Math.max(3, ((session.durationSec ?? 0) / maxDurationSec) * 100)
      : 0;

  return (
    <div
      className={cn(
        'group/session relative flex items-start gap-4 border-t border-line px-4 py-3.5 first:border-t-0',
        ownLive && 'bg-live/6',
        day !== null && 'border-line-strong first:border-line',
      )}
    >
      {/* El día. Vacío en las filas que comparten fecha con la de arriba. */}
      <div className="w-14 flex-none pt-0.5">
        {day && (
          <>
            {day.weekday && <div className="text-micro text-dust">{day.weekday}</div>}
            <div className="text-small font-semibold text-bone tabular-nums">{day.date}</div>
          </>
        )}
      </div>

      <GameCover
        url={session.coverUrl}
        className="h-14 w-10.5 flex-none overflow-hidden rounded-sm border border-line bg-raised"
        iconSize={15}
      />

      <div className="grid min-w-0 flex-1 gap-x-8 gap-y-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="text-body font-semibold text-bone">{session.gameTitle}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-dust">
            {start && (
              <span className="tabular-nums">
                {start} to{' '}
                {end ?? (
                  <span className={cn('font-semibold', ownLive ? 'text-live' : 'text-tube')}>
                    now
                  </span>
                )}
              </span>
            )}
            {session.isManual && (
              <span className="rounded-sm border border-line-strong px-1.5 text-micro font-semibold text-dust">
                Manual
              </span>
            )}
            {device.deviceTag !== null && !device.remote && (
              <span className="inline-flex items-center gap-1">
                <Monitor aria-hidden size={12} className="flex-none" />
                {device.deviceTag}
              </span>
            )}
          </div>
          {/* Abierta en OTRO PC: anillo Tube hueco y su nombre; sin señal, todo
              en gris con el triángulo (el icono lleva el significado, no solo
              el color). Envuelve en vez de truncar: es información. */}
          {device.remote && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small font-semibold">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  device.noSignal === null ? 'text-tube' : 'text-dust',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-2 flex-none rounded-full border-2',
                    device.noSignal === null ? 'border-tube' : 'border-dust',
                  )}
                />
                Playing on {device.deviceName}
              </span>
              {device.noSignal !== null && (
                <span className="inline-flex items-center gap-1 text-dust">
                  <TriangleAlert aria-hidden size={13} className="flex-none" />
                  {device.noSignal}
                </span>
              )}
            </div>
          )}
          {/* Los momentos de la sesión (§5): la fila cuenta qué pasó, no solo
              cuánto duró. */}
          {moments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {moments.map((moment) => {
                const { Icon, className, label } = momentBadge(moment);
                return (
                  <span
                    key={`${moment.type}-${moment.sessionId}`}
                    className={cn(
                      'flex items-center gap-1 rounded-sm border px-1.5 py-px text-micro font-semibold',
                      className,
                    )}
                  >
                    <Icon aria-hidden size={11} className="flex-none" />
                    {label}
                  </span>
                );
              })}
            </div>
          )}
          <SessionAchievements entries={achievements} onOpen={onOpenAchievement} />
        </div>

        {/* Diario de sesión, igual que en la ficha del juego: si escribiste
            "dónde lo dejé" al cerrar, aquí se lee y se corrige. */}
        <div className="min-w-0 lg:[&>*:first-child]:mt-0">
          <SessionNote sessionId={session.id} note={session.note} />
        </div>
      </div>

      <div className="flex w-26 flex-none flex-col items-end pt-0.5">
        {isLive ? (
          <span className="flex items-center gap-2">
            {/* El LED vivo: el punto late y un anillo se expande desde él. */}
            {ownLive && (
              <span aria-hidden className="relative inline-flex size-2 flex-none">
                <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
                <span className="relative size-2 animate-led-live rounded-full bg-live motion-reduce:animate-none" />
              </span>
            )}
            {/* Odometer: solo ruedan los dígitos que cambian. Respira como el
                cronómetro de Now playing: es lo que está vivo. */}
            <GlowText
              breathe={ownLive}
              className="font-display text-[24px] leading-none font-bold text-phosphor"
            >
              <Odometer value={formatElapsed(liveSeconds)} />
            </GlowText>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            {/* La más larga del filtro activo. */}
            {isRecord && (
              <Flame aria-label="Longest session" size={15} className="flex-none text-phosphor" />
            )}
            <Figure
              value={formatHours((session.durationSec ?? 0) / 3600)}
              className="text-[26px] text-bone"
            />
          </span>
        )}
        {/* En marcha, en el sitio del medidor baila un VU: la sesión suena. */}
        {ownLive && <VuMeter tone="live" className="mt-2" />}
        {fillPct > 0 && (
          <span
            ref={observeMeter}
            aria-hidden
            data-inview={meterInView || undefined}
            className={cn(
              chartGroup,
              'mt-2 block h-0.5 w-20 overflow-hidden rounded-full bg-bone/8',
            )}
          >
            <span
              className={cn('block h-full bg-phosphor/70', growX)}
              style={{ width: `${fillPct}%` }}
            />
          </span>
        )}
      </div>

      <div className="w-8 flex-none">
        {onDelete && !isLive && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete session"
            title="Delete session"
            className={cn(
              iconButtonClass,
              'size-8 opacity-0 group-hover/session:opacity-100 hover:bg-live/10 hover:text-live focus-visible:opacity-100',
            )}
          >
            <Trash2 aria-hidden size={15} />
          </button>
        )}
      </div>
    </div>
  );
};
