import { Plus, Search, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { usePendingSessions } from '../../hooks/sessions';
import { preloadStatsRoute } from '../../lib/statsRoute';
import {
  buttonSize,
  focusRing,
  focusRingInset,
  iconButtonClass,
  kbdClass,
  primaryButtonClass,
} from './controls';
import { SyncLed } from './SyncLed';

// LA BARRA SUPERIOR DE 56 PX (Fósforo: home.png, library.png).
//
// Logo y pestañas a la izquierda; a la derecha la búsqueda (Ctrl K abre la
// paleta), el LED de sync, Add game y el engranaje de Ajustes. Sustituye al
// rail lateral y a la columna fija de juegos. El engranaje lleva a la página
// de Ajustes.
//
// Cabe en la ventana mínima de la app (1000 px, mainWindow.ts): por debajo de
// 1280 px la búsqueda se queda en "Search" y Add game en su icono, con su
// nombre en aria-label y en el tooltip.

type Tab = { to: string; label: string };

const TABS: Tab[] = [
  { to: '/home', label: 'Home' },
  { to: '/games', label: 'Library' },
  { to: '/plan', label: 'Plan' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/stats', label: 'Stats' },
];

// El logotipo del concepto: una pantalla con el triángulo de Play.
const Logo = (): React.JSX.Element => (
  <svg aria-hidden width="26" height="26" viewBox="0 0 26 26" fill="none" className="flex-none">
    <rect x="1" y="3" width="24" height="18" rx="4" className="stroke-phosphor" strokeWidth="2" />
    <path d="M10.5 8.2v7.6l6.2-3.8z" className="fill-phosphor" />
    <path d="M8 24h10" className="stroke-phosphor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const TopBar = ({
  onOpenSyncSettings,
  onOpenPalette,
  onAddGame,
}: {
  onOpenSyncSettings: () => void;
  onOpenPalette: () => void;
  onAddGame: () => void;
}): React.JSX.Element => {
  // Sesiones de emulador sin asignar: la cifra ámbar junto a Sessions
  // (EMULADORES.md §6). Estática, sin pulso: es atención pasiva.
  const { data: pendingSessions = [] } = usePendingSessions();
  const pendingCount = pendingSessions.length;

  return (
    <header
      data-testid="app-topbar"
      className="relative z-20 flex h-14 flex-none items-center gap-4 border-b border-line bg-cabinet pr-4 pl-5"
    >
      <NavLink
        to="/home"
        aria-label="Afterplay"
        className={cn('flex flex-none items-center gap-2.5 rounded-sm', focusRing)}
      >
        <Logo />
        <span className="font-display text-[26px] leading-none font-bold text-bone">Afterplay</span>
      </NavLink>

      <nav aria-label="Main" className="flex h-full flex-none items-stretch">
        {TABS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            onPointerEnter={to === '/stats' ? preloadStatsRoute : undefined}
            onFocus={to === '/stats' ? preloadStatsRoute : undefined}
            className={cn(
              'group relative flex items-center gap-1.5 px-3 text-body font-medium text-dust transition-colors duration-150 hover:text-bone aria-[current=page]:text-bone',
              focusRingInset,
            )}
          >
            {label}
            {to === '/sessions' && pendingCount > 0 && (
              <span
                title={`${pendingCount} pending ${pendingCount === 1 ? 'session' : 'sessions'}`}
                className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-phosphor px-1 font-display text-micro font-bold text-ink"
              >
                <span className="sr-only">, pending: </span>
                {pendingCount}
              </span>
            )}
            <span
              aria-hidden
              className="absolute inset-x-3 bottom-0 hidden h-0.5 rounded-full bg-phosphor shadow-glow-bar group-aria-[current=page]:block"
            />
          </NavLink>
        ))}
      </nav>

      <span className="min-w-0 flex-1" />

      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts="Control+K"
        aria-label="Search your library"
        className={cn(
          'flex h-8.5 min-w-0 flex-none items-center gap-2.5 rounded-sm border border-line-strong bg-inset pr-1.5 pl-3 text-small text-dust transition-colors duration-150 hover:border-line-hover hover:text-bone xl:w-85',
          focusRing,
        )}
      >
        <Search aria-hidden size={15} className="flex-none" />
        <span className="hidden flex-1 text-left xl:inline">Search your library</span>
        <span className="xl:hidden">Search</span>
        <kbd className={kbdClass}>Ctrl K</kbd>
      </button>

      <SyncLed onOpenSettings={onOpenSyncSettings} />

      <button
        type="button"
        onClick={onAddGame}
        aria-label="Add game"
        title="Add game"
        className={cn(primaryButtonClass, buttonSize.md, 'max-xl:w-8.5 max-xl:px-0')}
      >
        <Plus aria-hidden size={16} />
        <span className="max-xl:hidden">Add game</span>
      </button>

      {/* Ajustes es una página (/settings): el engranaje es un enlace y se
          queda encendido mientras estás en cualquiera de sus secciones. */}
      <NavLink
        to="/settings"
        aria-label="Settings"
        title="Settings"
        className={cn(
          iconButtonClass,
          'aria-[current=page]:bg-raised aria-[current=page]:text-phosphor',
        )}
      >
        <Settings aria-hidden size={18} />
      </NavLink>
    </header>
  );
};
