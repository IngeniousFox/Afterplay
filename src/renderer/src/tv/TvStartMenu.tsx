import { BookOpenText, Home, LibraryBig, LogOut, Power } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { requestExitBigPicture } from '../hooks/useBigPicture';
import { TV_MODAL_SWALLOW, useTvButtons } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable } from './focusContext';
import { useCrtReveal } from '../components/fx';
import { tvFocusHalo, tvFocusMotion } from './styles';
import { TvLogo } from './TvChrome';

// Las entradas llegan escalonadas DESPUÉS de que el panel se encienda
// (CrtReveal, 300 ms): 55 ms entre una y otra, deslizando desde el lomo.
// Con reduced motion, solo fundido (la distancia es una variable).
const MENU_ITEM_DELAY_MS = 140;
const MENU_ITEM_STEP_MS = 55;
const menuItemStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${MENU_ITEM_DELAY_MS + index * MENU_ITEM_STEP_MS}ms`,
});

// El menú del modo (BIG-PICTURE.md §5.6): Start en cualquier pantalla TV.
// Cinco entradas y ni una más — un menú de tele se recorre entero de un
// vistazo o no es un menú de tele. Cada entrada lleva su color de identidad
// en el chip del icono: el menú se lee por colores antes que por palabras,
// que es como se lee un mando a tres metros.

const MenuItem = ({
  icon: Icon,
  label,
  danger = false,
  autoFocus = false,
  revealIndex = 0,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  // Quit Afterplay: en Live, la única entrada roja.
  danger?: boolean;
  autoFocus?: boolean;
  revealIndex?: number;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // Toda entrada del menú cierra el menú, y ese cierre ya suena
      // (popLayer) — el confirmar encima apilaba dos gestos contradictorios.
      data-tv-sound="none"
      className={cn(
        'flex w-full items-center gap-[0.75em] rounded-md border border-transparent px-[0.5em] py-[0.45em] text-left text-[1.3em] font-semibold',
        tvFocusMotion,
        'animate-[afterplay-tv-menu-item_260ms_var(--ease-out)_both] [--menu-x:-0.8em] motion-reduce:[--menu-x:0px]',
        danger ? 'text-live' : 'text-bone',
        focused && ['border-phosphor bg-phosphor-tint', tvFocusHalo, !danger && 'text-phosphor'],
      )}
      style={menuItemStyle(revealIndex)}
    >
      <span
        className={cn(
          'flex size-[1.75em] flex-none items-center justify-center rounded-sm border',
          focused ? 'border-phosphor/50 bg-phosphor/15' : 'border-line-strong bg-raised',
        )}
      >
        <Icon className="size-[0.85em]" />
      </span>
      {label}
    </button>
  );
};

export const TvStartMenu = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const navigate = useNavigate();
  // Modal de verdad: mientras el menu esta abierto, los botones contextuales
  // no atraviesan hacia la pantalla de debajo (B y Start los maneja el
  // goBack del shell, que mira menuOpen antes que la pila).
  useTvButtons(TV_MODAL_SWALLOW);
  // El panel se ENCIENDE como un tubo (CrtReveal 'panel': línea que se abre
  // en vertical con un destello).
  const panelRef = useCrtReveal<HTMLDivElement>('panel');
  const go = (path: string): void => {
    navigate(path);
    onClose();
  };

  return (
    <TvFocusLayer>
      {/* Velo + panel lateral de 600 px (a 1080p) que se enciende como un
          tubo en 300 ms: el contenido de detrás se intuye, que el menú es un
          aparte y no otra pantalla. */}
      <div className="absolute inset-0 z-30 flex" onClick={onClose}>
        <div className="absolute inset-0 animate-[fade-in_220ms_var(--ease-out)_both] bg-scrim" />
        <div
          ref={panelRef}
          className="relative flex h-full w-[25em] flex-col gap-[0.5em] border-r border-line bg-panel bg-(image:--scan) px-[1.3em] pt-[2.4em] shadow-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-[0.9em] flex items-center gap-[0.55em] px-[0.3em]">
            <span
              aria-hidden
              className="size-[0.5em] rounded-full bg-phosphor shadow-[0_0_10px_var(--color-phosphor)]"
            />
            <span className="font-display text-[1.75em] leading-none font-bold text-bone">
              Big Picture
            </span>
          </div>
          <MenuItem icon={Home} label="Home" autoFocus revealIndex={0} onSelect={() => go('/tv')} />
          <MenuItem
            icon={LibraryBig}
            label="Library"
            revealIndex={1}
            onSelect={() => go('/tv/library')}
          />
          <MenuItem
            icon={BookOpenText}
            label="Journey"
            revealIndex={2}
            onSelect={() => go('/tv/journey')}
          />
          <div className="mx-[0.3em] my-[0.6em] h-px bg-line-strong" />
          <MenuItem
            icon={LogOut}
            label="Exit Big Picture"
            revealIndex={3}
            onSelect={() => {
              onClose();
              requestExitBigPicture();
            }}
          />
          <MenuItem
            icon={Power}
            label="Quit Afterplay"
            danger
            revealIndex={4}
            onSelect={() => window.api.window.quitApp()}
          />
          {/* La firma al pie. */}
          <div className="mt-auto flex items-center gap-[0.5em] px-[0.3em] pb-[1.4em]">
            <TvLogo className="size-[1.05em]" />
            <span className="font-display text-[1.3em] leading-none font-bold text-bone">
              Afterplay
            </span>
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};
