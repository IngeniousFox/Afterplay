import { Joystick, Link2, Lock, Monitor, Square, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { GameListItem, PendingSession, SessionWithGame } from '../../../../shared/types';
import {
  canStopLiveSession,
  isLiveElsewhere,
  isOwnLiveSession,
} from '../../../../shared/liveSession';
import type { GameId } from '../../../../shared/entityIds';
import { useDeviceContext } from '../../hooks/devices';
import { useGames } from '../../hooks/games';
import { useCloseSession, useOpenSessions, usePendingSessions } from '../../hooks/sessions';
import { useSessionDevice, type SessionDeviceInfo } from '../../hooks/sessionDevice';
import { useTimeFormat } from '../../hooks/settings';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { formatElapsed, formatTime } from '../../lib/format';
import { GameCover } from '../GameCover';
import { GlowText } from '../fx/GlowText';
import { PressButton } from '../fx/PressButton';
import { celebrate } from '../fx/sparks';
import { Odometer } from '../fx/Ticker';
import { VuMeter } from '../fx/VuMeter';
import { AssignSessionModal } from '../sessions/AssignSessionModal';
import {
  buttonSize,
  focusRing,
  ghostButtonClass,
  liveButtonClass,
  primaryButtonClass,
} from '../shell/controls';

// "NOW PLAYING", ACOPLADO ABAJO (Fósforo, estados-nowplaying.png).
//
// Una barra de 72 px bajo todas las pantallas de escritorio mientras haya algo
// en marcha; sin nada en marcha NO se pinta y la página recupera el sitio (un
// hueco fijo con "lo último jugado" repetiría lo que ya dice Home). Entra
// «encendiéndose» como un tubo (animate-power-on; con reduced motion es un
// fundido). Mientras corre: el VU meter baila, el cronómetro respira y sus
// dígitos caen al cambiar; parar una sesión de más de una hora suelta chispas.
//
// Lo que enseña y hace es lo de siempre (§10.8, §15.7):
//   · Sesión de este PC: pulso rojo, cronómetro, Stop.
//   · Sesión de otro PC: anillo cian y "on PC-A"; sin Stop (salvo que sea un
//     cronómetro, que cualquier PC puede parar) y dicho con palabras.
//   · Más de 3 min sin señal: todo apagado y "No signal for X".
//   · Emulador sin asignar: tinte ámbar y Assign en lugar de Stop.
//   · Dos a la vez: la de este PC arriba, la otra en una tira de 40 px; con
//     tres o más, la tira suma "+N more".

type LiveEntry =
  | {
      kind: 'game';
      startedAt: Date;
      game: GameListItem;
      session: SessionWithGame | null;
      own: boolean;
    }
  // Sesión de emulador todavía sin asignar: estás jugando ALGO, pero no hay
  // juego, ni carátula, ni título — solo el emulador. Se enseña igual porque
  // es el empujón natural para asignarla.
  | { kind: 'pending'; startedAt: Date; session: PendingSession };

// A partir de aquí, parar la sesión desde la barra se celebra.
const LONG_SESSION_MS = 60 * 60 * 1000;

const rank = (entry: LiveEntry): number => (entry.kind === 'pending' ? 1 : entry.own ? 0 : 2);

export const NowPlayingCard = (): React.JSX.Element | null => {
  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useOpenSessions();
  const { data: pending = [] } = usePendingSessions();
  const [assigning, setAssigning] = useState<PendingSession | null>(null);
  const { thisDeviceId } = useDeviceContext();

  // La sesión abierta de cada juego, para poder pararla desde aquí. Con dos
  // abiertas (una por PC, §10.4) manda la de ESTE PC, que es la que la barra
  // puede parar; así coincide con el `liveSince` del juego.
  const openSessionByGame = new Map<GameId, SessionWithGame>();
  for (const session of sessions) {
    if (session.endedAt !== null) continue;
    const known = openSessionByGame.get(session.gameId);
    if (
      !known ||
      (isOwnLiveSession(session, thisDeviceId) && !isOwnLiveSession(known, thisDeviceId))
    ) {
      openSessionByGame.set(session.gameId, session);
    }
  }

  // La de ESTE PC primero (D-15), luego la del emulador, luego las ajenas; y
  // dentro de cada grupo, la más reciente arriba.
  const entries: LiveEntry[] = [
    ...games
      .filter((game) => game.isLive && game.liveSince !== null)
      .map((game): LiveEntry => {
        const session = openSessionByGame.get(game.id) ?? null;
        return {
          kind: 'game',
          startedAt: game.liveSince as Date,
          game,
          session,
          own: session
            ? isOwnLiveSession(session, thisDeviceId)
            : !isLiveElsewhere(game, thisDeviceId),
        };
      }),
    ...pending
      .filter((session) => session.endedAt === null)
      .map((session): LiveEntry => ({ kind: 'pending', startedAt: session.startedAt, session })),
  ].sort((a, b) => rank(a) - rank(b) || b.startedAt.getTime() - a.startedAt.getTime());

  // La guarda mira TAMBIÉN el modal: cerrar el emulador con "Assign" abierto
  // le pone endedAt a la pendiente y la barra devolvía null llevándose el
  // modal por delante, con la búsqueda a medias. Sin nada vivo Y sin modal
  // abierto sí se despinta.
  if (entries.length === 0 && !assigning) return null;

  const [current, second, ...rest] = entries;

  return (
    <>
      {current && (
        <section
          aria-label="Now playing"
          data-testid="now-playing"
          className="relative flex-none origin-center animate-power-on overflow-hidden border-t border-line bg-panel"
        >
          {/* Zona héroe: líneas de escaneo y el brillo ámbar, solo aquí. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-(image:--scan)" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-(image:--glow-ambient) opacity-50"
          />
          <div className="relative">
            {current.kind === 'game' ? (
              <GameBar entry={current} />
            ) : (
              <PendingBar entry={current} onAssign={() => setAssigning(current.session)} />
            )}
            {second && (
              <SecondStrip
                entry={second}
                more={rest.length}
                onAssign={(session) => setAssigning(session)}
              />
            )}
          </div>
        </section>
      )}

      {assigning && (
        <AssignSessionModal
          session={assigning}
          open
          onOpenChange={(open) => {
            if (!open) setAssigning(null);
          }}
          // Crear el juego desde aquí abriría el Add Game por encima de otra
          // pantalla: para eso está la bandeja de pendientes de Sessions, con
          // su flujo completo.
          onAddNewGame={() => setAssigning(null)}
        />
      )}
    </>
  );
};

// El dispositivo de una entrada, con la misma regla que las filas de sesión:
// sin la sesión todavía cargada se usa el que dice el propio juego.
const useEntryDevice = (entry: Extract<LiveEntry, { kind: 'game' }>): SessionDeviceInfo => {
  const { thisDeviceId } = useDeviceContext();
  return useSessionDevice(
    entry.session ?? {
      deviceId: entry.game.liveDeviceId ?? thisDeviceId ?? '',
      startedAt: entry.startedAt,
      endedAt: null,
      lastHeartbeatAt: null,
      isManual: false,
    },
  );
};

const useSince = (startedAt: Date): string => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  return formatTime(startedAt, timeFormat);
};

// El LED de la barra: pulso rojo aquí, anillo cian hueco en otro PC, gris sin
// señal. El anillo que se expande es decorativo y se apaga con reduced motion.
const LiveLed = ({ tone }: { tone: 'here' | 'remote' | 'silent' }): React.JSX.Element => (
  <span aria-hidden className="relative inline-flex size-2.5 flex-none items-center justify-center">
    {tone === 'here' && (
      <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
    )}
    <span
      className={cn(
        'relative size-2.5 rounded-full',
        tone === 'here' && 'animate-led-live bg-live motion-reduce:animate-none',
        tone === 'remote' && 'border-2 border-tube',
        tone === 'silent' && 'border-2 border-dust',
      )}
    />
  </span>
);

const coverButtonClass = cn(
  'flex-none rounded-xs transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
  focusRing,
);

const GameBar = ({ entry }: { entry: Extract<LiveEntry, { kind: 'game' }> }): React.JSX.Element => {
  const navigate = useNavigate();
  const closeSession = useCloseSession();
  const elapsed = useLiveTimer(entry.startedAt);
  const device = useEntryDevice(entry);
  const { thisDeviceId } = useDeviceContext();
  const since = useSince(entry.startedAt);
  const session = entry.session;
  const canStop = session !== null && canStopLiveSession(session, thisDeviceId);
  const silent = device.noSignal !== null;
  const open = (): void => {
    navigate(`/games/${entry.game.id}`);
  };
  // Una sesión de más de una hora que paras tú se celebra, con chispas que
  // salen de donde estaba Stop (la barra desaparece al cerrar, así que el
  // sitio se mide en el clic). Solo si el cierre sale bien.
  const stop = (closing: SessionWithGame, button: HTMLElement): void => {
    const long = Date.now() - entry.startedAt.getTime() >= LONG_SESSION_MS;
    const origin = button.getBoundingClientRect();
    closeSession.mutate(
      { id: closing.id, endedAt: new Date() },
      {
        onSuccess: () => {
          if (long) celebrate('session', { origin });
        },
      },
    );
  };

  return (
    <div className="flex h-18 items-center gap-4 px-5">
      <button type="button" onClick={open} title="Open game" className={coverButtonClass}>
        <GameCover
          url={entry.game.coverUrl}
          className={cn(
            'h-14 w-10.5 overflow-hidden rounded-xs border border-line-strong bg-raised',
            silent && 'opacity-50 grayscale',
          )}
          iconSize={14}
        />
      </button>

      <div className="min-w-0 flex-[0_1_auto]">
        <button
          type="button"
          onClick={open}
          className={cn(
            'block max-w-full rounded-xs text-left text-lead font-semibold hover:underline underline-offset-2',
            silent ? 'text-dust' : 'text-bone',
            focusRing,
          )}
        >
          {entry.game.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-small text-dust">
          <LiveLed tone={silent ? 'silent' : device.remote ? 'remote' : 'here'} />
          {device.remote ? (
            <span className={cn('inline-flex items-center gap-1', !silent && 'text-tube')}>
              <Monitor aria-hidden size={13} />
              on {device.deviceName}
            </span>
          ) : (
            <span>{thisDeviceId ? `Playing on ${device.deviceName}` : 'Playing on this PC'}</span>
          )}
          <span>· since {since}</span>
          {silent && (
            <span className="inline-flex items-center gap-1 text-bone">
              · <TriangleAlert aria-hidden size={13} className="text-phosphor" />
              {device.noSignal}
            </span>
          )}
        </div>
      </div>

      <VuMeter
        bars={6}
        tone={device.remote ? 'tube' : 'phosphor'}
        active={!silent}
        className={cn('h-7', silent && 'opacity-40')}
      />
      {silent ? (
        <span className="flex-none font-display text-[44px] leading-none font-bold text-dust tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      ) : (
        <GlowText
          breathe
          className="flex-none font-display text-[44px] leading-none font-bold text-phosphor"
        >
          <Odometer value={formatElapsed(elapsed)} />
        </GlowText>
      )}

      {session !== null && canStop ? (
        <PressButton
          burst="live"
          onClick={(event) => stop(session, event.currentTarget)}
          disabled={closeSession.isPending}
          aria-label="Stop session"
          title="Stop session"
          className={cn(liveButtonClass, buttonSize.md)}
        >
          <Square aria-hidden size={12} fill="currentColor" />
          Stop
        </PressButton>
      ) : device.remote ? (
        <span className="flex min-w-0 items-center gap-1.5 text-small text-dust">
          <Lock aria-hidden size={13} className="flex-none" />
          Only {device.deviceName} can stop this session
        </span>
      ) : null}
    </div>
  );
};

const PendingBar = ({
  entry,
  onAssign,
}: {
  entry: Extract<LiveEntry, { kind: 'pending' }>;
  onAssign: () => void;
}): React.JSX.Element => {
  const elapsed = useLiveTimer(entry.startedAt);
  const since = useSince(entry.startedAt);

  return (
    // Ámbar: es el color de "pendiente". Se mide tiempo que todavía no
    // pertenece a ningún juego.
    <div className="flex h-18 items-center gap-4 bg-phosphor-tint px-5">
      <span className="flex h-14 w-10.5 flex-none items-center justify-center rounded-xs border border-phosphor/40 bg-phosphor/10">
        <Joystick aria-hidden size={17} className="text-phosphor" />
      </span>
      <div className="min-w-0 flex-[0_1_auto]">
        <div className="text-lead font-semibold text-bone">{entry.session.emulatorName}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-small text-dust">
          <span aria-hidden className="size-2 flex-none rounded-full bg-phosphor" />
          Emulator session · not assigned to a game yet · since {since}
        </div>
      </div>
      <VuMeter bars={6} className="h-7" />
      <GlowText className="flex-none font-display text-[44px] leading-none font-bold text-phosphor">
        <Odometer value={formatElapsed(elapsed)} />
      </GlowText>
      <button type="button" onClick={onAssign} className={cn(primaryButtonClass, buttonSize.md)}>
        <Link2 aria-hidden size={15} />
        Assign
      </button>
    </div>
  );
};

// La segunda sesión, en una tira de 40 px bajo la barra.
const SecondStrip = ({
  entry,
  more,
  onAssign,
}: {
  entry: LiveEntry;
  more: number;
  onAssign: (session: PendingSession) => void;
}): React.JSX.Element => (
  <div className="flex h-10 animate-np-in items-center gap-3 border-t border-line bg-cabinet/40 px-5 text-small">
    {entry.kind === 'game' ? (
      <GameStripBody entry={entry} />
    ) : (
      <PendingStripBody entry={entry} onAssign={onAssign} />
    )}
    {more > 0 && <span className="flex-none text-dust">+{more} more</span>}
  </div>
);

const GameStripBody = ({
  entry,
}: {
  entry: Extract<LiveEntry, { kind: 'game' }>;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const elapsed = useLiveTimer(entry.startedAt);
  const device = useEntryDevice(entry);
  const silent = device.noSignal !== null;
  return (
    <>
      <GameCover
        url={entry.game.coverUrl}
        className={cn(
          'h-7 w-5.5 flex-none overflow-hidden rounded-xs bg-raised',
          silent && 'opacity-50 grayscale',
        )}
        iconSize={10}
      />
      <LiveLed tone={silent ? 'silent' : device.remote ? 'remote' : 'here'} />
      <span className="flex-none text-dust">Also playing</span>
      <span className="min-w-0 font-semibold text-bone">{entry.game.title}</span>
      {device.remote && (
        <span className="inline-flex flex-none items-center gap-1 text-dust">
          <Monitor aria-hidden size={13} />
          on {device.deviceName}
        </span>
      )}
      {silent && <span className="flex-none text-dust">· {device.noSignal}</span>}
      <span className="flex-none font-display text-[24px] leading-none font-bold text-bone tabular-nums">
        {formatElapsed(elapsed)}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => navigate(`/games/${entry.game.id}`)}
        className={cn(ghostButtonClass, buttonSize.sm)}
      >
        Open game
      </button>
    </>
  );
};

const PendingStripBody = ({
  entry,
  onAssign,
}: {
  entry: Extract<LiveEntry, { kind: 'pending' }>;
  onAssign: (session: PendingSession) => void;
}): React.JSX.Element => {
  const elapsed = useLiveTimer(entry.startedAt);
  return (
    <>
      <Joystick aria-hidden size={15} className="flex-none text-phosphor" />
      <span className="flex-none text-dust">Also running</span>
      <span className="min-w-0 font-semibold text-bone">{entry.session.emulatorName}</span>
      <span className="flex-none text-dust">· not assigned yet</span>
      <span className="flex-none font-display text-[24px] leading-none font-bold text-phosphor tabular-nums">
        {formatElapsed(elapsed)}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => onAssign(entry.session)}
        className={cn(ghostButtonClass, buttonSize.sm)}
      >
        Assign
      </button>
    </>
  );
};
