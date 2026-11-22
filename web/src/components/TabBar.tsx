import { Clock, House, LibraryBig, ListOrdered } from 'lucide-react';
import { useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/cn';
import { SlidingIndicator } from './fx/SlidingIndicator';

const TABS = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/library', label: 'Library', Icon: LibraryBig, end: false },
  { to: '/plan', label: 'Plan', Icon: ListOrdered, end: false },
  { to: '/sessions', label: 'Sessions', Icon: Clock, end: false },
];

// Una pestaña. Al tocarla, el icono se hunde y rebota (scale con muelle) y
// suelta un destello de fósforo detrás (keyframe press-flash, opacidad): cada
// toque monta un destello nuevo (la clave cambia) que se apaga solo. La
// activa lleva el icono con bloom: un halo radial detrás que se funde al
// activarse, más un drop-shadow fijo en el trazo.
const Tab = ({ to, label, Icon, end }: (typeof TABS)[number]): React.JSX.Element => {
  const [taps, setTaps] = useState(0);
  return (
    <NavLink
      to={to}
      end={end}
      onPointerDown={() => setTaps((count) => count + 1)}
      className={({ isActive }) =>
        cn(
          'group/tab flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
          isActive ? 'text-phosphor' : 'text-dust active:text-bone',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'relative isolate flex size-7 items-center justify-center',
              '[transition:scale_320ms_var(--ease-spring)] group-active/tab:scale-[.86] group-active/tab:[transition:scale_80ms_ease-out]',
              'motion-reduce:group-active/tab:scale-100',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute -inset-3 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(255_179_71/0.3),transparent)]',
                'transition-opacity duration-300',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            {taps > 0 && (
              <span
                key={taps}
                aria-hidden="true"
                className="pointer-events-none absolute -inset-4 -z-10 animate-press-flash rounded-full bg-[radial-gradient(closest-side,rgb(255_236_200/0.55),rgb(255_179_71/0.22)_55%,transparent)]"
              />
            )}
            <Icon
              size={22}
              strokeWidth={isActive ? 2.1 : 1.7}
              aria-hidden="true"
              className={cn(isActive && 'drop-shadow-[0_0_5px_rgb(255_179_71/0.65)]')}
            />
          </span>
          <span className="text-micro font-medium">{label}</span>
        </>
      )}
    </NavLink>
  );
};

// Barra de pestañas fija abajo. No es la navegación del escritorio encogida:
// aquí manda el pulgar (§3.1 — móvil de verdad, sin perseguir la paridad).
//
// Mide 64 px más la zona segura inferior: el `env(safe-area-inset-bottom)` la
// separa de la barra de gestos del iPhone. El body reserva ese mismo alto
// (index.css). La pestaña activa va en Phosphor; las demás en Dust, y una raya
// de fósforo arriba se desliza con muelle hasta la activa (SlidingIndicator).
export const TabBar = (): React.JSX.Element => {
  const rowRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cabinet pb-[env(safe-area-inset-bottom)]"
    >
      <div ref={rowRef} className="relative mx-auto flex h-16 max-w-lg">
        {TABS.map((tab) => (
          <Tab key={tab.to} {...tab} />
        ))}
        <SlidingIndicator
          containerRef={rowRef}
          activeKey={pathname}
          inset={26}
          className="-top-px h-0.5 rounded-full bg-phosphor shadow-glow-bar"
        />
      </div>
    </nav>
  );
};
