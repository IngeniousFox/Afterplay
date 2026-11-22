import { Clock, House, LibraryBig, ListOrdered } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';

const TABS = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/library', label: 'Library', Icon: LibraryBig, end: false },
  { to: '/plan', label: 'Plan', Icon: ListOrdered, end: false },
  { to: '/sessions', label: 'Sessions', Icon: Clock, end: false },
];

// Barra de pestañas fija abajo. No es la navegación del escritorio encogida:
// aquí manda el pulgar (§3.1 — móvil de verdad, sin perseguir la paridad).
//
// Mide 64 px más la zona segura inferior: el `env(safe-area-inset-bottom)` la
// separa de la barra de gestos del iPhone. El body reserva ese mismo alto
// (index.css). La pestaña activa va en Phosphor; las demás en Dust.
export const TabBar = (): React.JSX.Element => (
  <nav
    aria-label="Main"
    className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cabinet pb-[env(safe-area-inset-bottom)]"
  >
    <div className="mx-auto flex h-16 max-w-lg">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
              isActive ? 'text-phosphor' : 'text-dust active:text-bone',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={22} strokeWidth={isActive ? 2.1 : 1.7} aria-hidden="true" />
              <span className="text-micro font-medium">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  </nav>
);
