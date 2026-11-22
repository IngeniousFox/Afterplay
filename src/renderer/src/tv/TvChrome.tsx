import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSyncStatus } from '../hooks/sync';

// El marco fijo del modo TV en Fósforo: logotipo, las pestañas de las tres
// salas (Home, Library, Journey — las del código; Plan y Sessions no existen
// en TV) y, a la derecha, el estado de sync y el reloj.
//
// Las pestañas NO entran en el motor de foco: el mando se mueve entre salas
// con el menú Start y con B, como hasta ahora (la navegación no cambia). Aquí
// dicen dónde estás y, con ratón, también son botones.

export const TvLogo = ({ className }: { className?: string }): React.JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 26 26"
    fill="none"
    className={cn('size-[1.25em] flex-none', className)}
  >
    <rect x="1" y="3" width="24" height="18" rx="4" className="stroke-phosphor" strokeWidth="2" />
    <path d="M10.5 8.2v7.6l6.2-3.8z" className="fill-phosphor" />
    <path d="M8 24h10" className="stroke-phosphor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ROOMS = [
  { path: '/tv', label: 'Home' },
  { path: '/tv/library', label: 'Library' },
  { path: '/tv/journey', label: 'Journey' },
] as const;

// La sala de una ruta: la ficha de juego vive dentro de Library.
const roomOf = (pathname: string): string => {
  if (pathname.startsWith('/tv/library') || pathname.startsWith('/tv/game')) return '/tv/library';
  if (pathname.startsWith('/tv/journey')) return '/tv/journey';
  return '/tv';
};

// Solo lectura del estado que ya publica el main (como SyncLed de escritorio).
// Sin sync emparejado no se pinta nada.
const TvSyncStatus = (): React.JSX.Element | null => {
  const { data: status } = useSyncStatus();
  if (status === undefined || !status.available || !status.paired) return null;
  const tone =
    status.disabledReason !== null
      ? { label: 'Sync off', dot: 'border-2 border-dust' }
      : status.problem
        ? status.problem.code === 'network'
          ? { label: 'Offline', dot: 'border-2 border-dust' }
          : { label: 'Sync error', dot: 'bg-live' }
        : status.running
          ? { label: 'Syncing', dot: 'bg-tube' }
          : { label: 'Synced', dot: 'bg-tube shadow-[0_0_8px_var(--color-tube)]' };
  return (
    <span className="flex items-center gap-[0.45em] text-[0.92em] text-dust">
      <span aria-hidden className={cn('size-[0.45em] flex-none rounded-full', tone.dot)} />
      {tone.label}
    </span>
  );
};

export const TvHeader = ({
  pathname,
  clock,
  dimmed,
}: {
  pathname: string;
  clock: string;
  // Con el teclado en pantalla o un panel encima, el marco se atenúa.
  dimmed?: boolean;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const room = roomOf(pathname);
  return (
    <header
      className={cn(
        'relative flex h-[3.4em] flex-none items-center gap-[2.4em] px-[4vw] transition-opacity duration-200',
        dimmed && 'opacity-35',
      )}
    >
      <span className="flex items-center gap-[0.45em]">
        <TvLogo />
        <span className="font-display text-[1.45em] leading-none font-bold text-bone">
          Afterplay
        </span>
      </span>
      <nav aria-label="Big Picture" className="flex items-center gap-[0.4em]">
        {ROOMS.map((entry) => {
          const active = entry.path === room;
          return (
            <button
              key={entry.path}
              type="button"
              onClick={() => void navigate(entry.path)}
              aria-current={active ? 'page' : undefined}
              // Moverse de sala suena por el cambio de pantalla, no aquí.
              data-tv-sound="none"
              className={cn(
                'relative h-[1.9em] rounded-sm px-[0.85em] text-[1.04em] font-medium outline-hidden transition-colors duration-150',
                active
                  ? 'bg-raised text-bone after:absolute after:inset-x-0 after:-bottom-[0.1em] after:h-[0.12em] after:rounded-full after:bg-phosphor after:shadow-glow-bar'
                  : 'text-dust hover:text-bone',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>
      <span className="ml-auto flex items-center gap-[1.4em]">
        <TvSyncStatus />
        <span className="text-[0.95em] font-medium text-dust tabular-nums">{clock}</span>
      </span>
    </header>
  );
};
