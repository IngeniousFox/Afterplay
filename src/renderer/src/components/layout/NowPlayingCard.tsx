import { Joystick, Square } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameListItem, PendingSession, SessionWithGame } from '../../../../shared/types';
import { useDeviceContext } from '../../hooks/devices';
import { useGames } from '../../hooks/games';
import { useCloseSession, useOpenSessions, usePendingSessions } from '../../hooks/sessions';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { AMBER, GREEN } from '../../lib/colors';
import { formatElapsed } from '../../lib/format';
import { canStopLiveSession, isOwnLiveSession } from '../../../../shared/liveSession';
import { GameCover } from '../GameCover';
import { AssignSessionModal } from '../sessions/AssignSessionModal';
import { useSessionDevice } from '../../hooks/sessionDevice';
import type { GameId } from '../../../../shared/entityIds';

// Lo que estás jugando AHORA, anclado al fondo de la columna de navegación —
// que vive en RootLayout, así que la tarjeta te acompaña por toda la app.
//
// Antes esto solo existía como una etiqueta "LIVE" dentro de una fila de la
// lista: en cuanto te ibas a Stats, a Ajustes o a otra sección, la partida en
// curso desaparecía de la vista. Y dentro de una biblioteca de 300 juegos, esa
// etiqueta había que ir a buscarla.
//
// Sin nada en marcha NO se pinta: un hueco fijo con "lo último jugado" sería
// peaje de espacio permanente a cambio de información que ya está en la lista.

type LiveEntry =
  | { kind: 'game'; startedAt: Date; game: GameListItem; session: SessionWithGame | null }
  // Sesión de emulador todavía sin asignar: está viva y estás jugando ALGO,
  // pero no hay juego, ni carátula, ni título — solo el emulador. Se enseña
  // igualmente porque es el empujón natural para asignarla (si no, se queda
  // en la bandeja de pendientes y no te enteras).
  | { kind: 'pending'; startedAt: Date; session: PendingSession };

export const NowPlayingCard = (): React.JSX.Element | null => {
  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useOpenSessions();
  const { data: pending = [] } = usePendingSessions();
  const [assigning, setAssigning] = useState<PendingSession | null>(null);
  const { thisDeviceId } = useDeviceContext();

  // La sesión abierta de cada juego, para poder pararla desde aquí sin ir a
  // su ficha (GameListItem sabe que está vivo, pero no con qué sesión). Con
  // dos abiertas (una por PC, §10.4) manda la de ESTE PC, que es la que la
  // tarjeta puede parar; así coincide con el `liveSince` del juego.
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

  const entries: LiveEntry[] = [
    ...games
      .filter((game) => game.isLive && game.liveSince !== null)
      .map((game): LiveEntry => ({
        kind: 'game',
        startedAt: game.liveSince as Date,
        game,
        session: openSessionByGame.get(game.id) ?? null,
      })),
    ...pending
      .filter((session) => session.endedAt === null)
      .map((session): LiveEntry => ({ kind: 'pending', startedAt: session.startedAt, session })),
  ].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  // La guarda mira TAMBIÉN el modal: cerrar el emulador con "Assign" abierto
  // le pone endedAt a la pendiente, `entries` se vaciaba y la tarjeta devolvía
  // null llevándose por delante a su hijo — el modal desaparecía con la
  // búsqueda a medias y sin decir nada, saltándose incluso su propia guarda de
  // "no cerrar con la asignación en vuelo" (AssignSessionModal). Sin nada vivo
  // Y sin modal abierto sí se despinta, que es el trato de siempre.
  if (entries.length === 0 && !assigning) return null;

  // La más reciente manda; el resto se resume en un "+N" discreto en vez de
  // apilar tarjetas y comerse la lista.
  const [current, ...rest] = entries;

  return (
    <>
      {entries.length > 0 && (
        <div className="flex-none border-t border-border">
          {current.kind === 'game' ? (
            <GameEntry entry={current} extra={rest.length} />
          ) : (
            <PendingEntry
              entry={current}
              extra={rest.length}
              onAssign={() => setAssigning(current.session)}
            />
          )}
        </div>
      )}

      {assigning && (
        <AssignSessionModal
          session={assigning}
          open
          onOpenChange={(open) => {
            if (!open) setAssigning(null);
          }}
          // Crear el juego desde aquí abriría el Add Game por encima de la
          // columna, que es otra pantalla — para eso está la bandeja de
          // pendientes de la vista de Sesiones, con su flujo completo.
          onAddNewGame={() => setAssigning(null)}
        />
      )}
    </>
  );
};

// Cabecera común: puntito verde pulsante + "NOW PLAYING" + cuántas más hay.
const Header = ({
  extra,
  color,
  label = 'NOW PLAYING',
}: {
  extra: number;
  color: string;
  label?: string;
}): React.JSX.Element => (
  <div className="flex items-center gap-1.5">
    <span
      className="h-1.5 w-1.5 flex-none rounded-full"
      style={{ background: color, animation: 'afterplay-pulse-dot 1.4s infinite' }}
    />
    <span className="text-[9.5px] font-extrabold tracking-[.11em]" style={{ color }}>
      {label}
    </span>
    {extra > 0 && (
      <span className="text-[9.5px] font-bold text-muted-foreground">+{extra} more</span>
    )}
  </div>
);

const GameEntry = ({
  entry,
  extra,
}: {
  entry: Extract<LiveEntry, { kind: 'game' }>;
  extra: number;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const closeSession = useCloseSession();
  const elapsed = useLiveTimer(entry.startedAt);
  const heroSrc = useImageSrc(entry.game.heroUrl, 'heroes');
  const { thisDeviceId } = useDeviceContext();
  // §10.8: abierta en otro PC = "Playing on PC-A", sin Stop salvo cronómetro, y
  // "No signal for X" si lleva más de 3 minutos callada. Sin la sesión (aún no
  // cargó la lista) se usa el dispositivo que dice el propio juego.
  const device = useSessionDevice(
    entry.session ?? {
      deviceId: entry.game.liveDeviceId ?? thisDeviceId ?? '',
      startedAt: entry.startedAt,
      endedAt: null,
      lastHeartbeatAt: null,
      isManual: false,
    },
  );
  const canStop = entry.session !== null && canStopLiveSession(entry.session, thisDeviceId);
  const session = entry.session;

  return (
    <div className="relative overflow-hidden">
      {/* Hero de fondo tras un velo — mismo lenguaje que la ficha y que el
          aviso de cierre: la tarjeta lleva la identidad del juego, no es un
          recuadro genérico con un texto dentro. */}
      {heroSrc && (
        <>
          <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(15,17,16,.96) 0%, rgba(15,17,16,.9) 55%, rgba(15,17,16,.62) 100%)',
            }}
          />
        </>
      )}

      <div className="relative flex items-center gap-2.75 px-3.5 py-3">
        <button
          type="button"
          onClick={() => navigate(`/games/${entry.game.id}`)}
          title="Open game"
          className="flex-none transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-0.5"
        >
          <GameCover
            url={entry.game.coverUrl}
            className="h-13 w-9.5 overflow-hidden rounded-[7px] border border-white/15 shadow-[0_6px_16px_rgba(0,0,0,.45)]"
            iconSize={14}
          />
        </button>

        <div className="min-w-0 flex-1">
          <Header
            extra={extra}
            color={device.noSignal !== null ? AMBER : GREEN}
            label={device.remote ? `PLAYING ON ${device.deviceName.toUpperCase()}` : undefined}
          />
          <button
            type="button"
            onClick={() => navigate(`/games/${entry.game.id}`)}
            className="mt-0.5 block max-w-full truncate text-left text-[13px] font-bold text-foreground hover:underline"
          >
            {entry.game.title}
          </button>
          <div className="mt-0.25 text-[14px] font-extrabold tabular-nums" style={{ color: GREEN }}>
            {formatElapsed(elapsed)}
          </div>
          {device.noSignal !== null && (
            <div className="mt-0.5 text-[11px] font-semibold" style={{ color: AMBER }}>
              {device.noSignal}
            </div>
          )}
        </div>

        {/* Parar sin tener que navegar hasta la ficha, que es lo que obligaba
            a hacer hasta ahora. Solo si conocemos su sesión abierta, y si se
            puede parar desde este PC: una sesión de otro PC no, salvo que sea
            un cronómetro (§10.8). */}
        {session !== null && canStop && (
          <button
            type="button"
            onClick={() => closeSession.mutate({ id: session.id, endedAt: new Date() })}
            disabled={closeSession.isPending}
            title="Stop session"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-input bg-white/[0.04] text-muted-foreground transition-colors duration-150 hover:border-destructive/45 hover:text-destructive disabled:opacity-50"
            aria-label="Stop session"
          >
            <Square size={13} fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
};

const PendingEntry = ({
  entry,
  extra,
  onAssign,
}: {
  entry: Extract<LiveEntry, { kind: 'pending' }>;
  extra: number;
  onAssign: () => void;
}): React.JSX.Element => {
  const elapsed = useLiveTimer(entry.startedAt);

  return (
    // En ámbar y no en verde: el ámbar es el color de "pendiente" en toda la
    // app (rachas, gasto, sesiones sin asignar), y esto lo está — se está
    // midiendo tiempo que todavía no pertenece a ningún juego.
    <div className="flex items-center gap-2.75 px-3.5 py-3" style={{ background: `${AMBER}0d` }}>
      <div
        className="flex h-13 w-9.5 flex-none items-center justify-center rounded-[7px]"
        style={{ background: `${AMBER}1a` }}
      >
        <Joystick size={17} color={AMBER} />
      </div>

      <div className="min-w-0 flex-1">
        <Header extra={extra} color={AMBER} />
        <div className="mt-0.5 truncate text-[13px] font-bold text-foreground">
          {entry.session.emulatorName}
        </div>
        <div className="mt-0.25 text-[14px] font-extrabold tabular-nums" style={{ color: AMBER }}>
          {formatElapsed(elapsed)}
        </div>
      </div>

      <button
        type="button"
        onClick={onAssign}
        className="flex-none rounded-[8px] border px-2.5 py-1.5 text-[11px] font-bold transition-colors duration-150"
        style={{ borderColor: `${AMBER}55`, color: AMBER }}
      >
        Assign
      </button>
    </div>
  );
};
