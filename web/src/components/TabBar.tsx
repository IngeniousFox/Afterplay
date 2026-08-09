import { Bookmark, CalendarRange, Home, Library } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/library', label: 'Library', Icon: Library, end: false },
  { to: '/plan', label: 'Plan', Icon: Bookmark, end: false },
  { to: '/sessions', label: 'Sessions', Icon: CalendarRange, end: false },
];

// Barra de pestañas fija abajo. No es la navegación del escritorio encogida:
// allí hay columnas laterales porque hay 1400px y un ratón; aquí manda el
// pulgar (§3.1 — móvil de verdad, sin perseguir la paridad).
//
// El `env(safe-area-inset-bottom)` es lo que la separa de la barra de gestos
// del iPhone; sin él, el último píxel de la pestaña queda debajo del indicador
// y no se puede tocar.
export const TabBar = (): React.JSX.Element => (
  <nav
    className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#0a0b0a]/95 backdrop-blur-lg"
    style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
  >
    <div className="mx-auto flex max-w-lg">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
              <span className="text-[10px] font-bold tracking-wide">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  </nav>
);
