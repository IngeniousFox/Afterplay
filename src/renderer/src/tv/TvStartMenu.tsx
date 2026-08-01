import { BookOpenText, Home, LibraryBig, LogOut, Power } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { requestExitBigPicture } from '../hooks/useBigPicture';
import { TV_MODAL_SWALLOW, useTvButtons } from './tvInput';
import { BLUE, GREEN, TEAL, VIOLET } from '../lib/colors';
import { TvFocusLayer } from './focus';
import { useTvFocusable } from './focusContext';
import { tvRevealClass, tvRevealStyle } from './styles';

// El menú del modo (BIG-PICTURE.md §5.6): Start en cualquier pantalla TV.
// Cinco entradas y ni una más — un menú de tele se recorre entero de un
// vistazo o no es un menú de tele. Cada entrada lleva su color de identidad
// en el chip del icono: el menú se lee por colores antes que por palabras,
// que es como se lee un mando a tres metros.

// El rojo de peligro de la casa (mismo hex que usa 'dropped') — aquí como
// acento de "Quit", no como estado de juego.
const DANGER = '#e85d72';

const MenuItem = ({
  icon: Icon,
  label,
  accent,
  autoFocus = false,
  revealIndex = 0,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  accent: string;
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
      className={`relative flex w-full items-center gap-[0.75em] rounded-[0.55em] px-[0.7em] py-[0.5em] text-left text-[1em] font-bold transition-[background-color,color,translate] duration-200 ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(revealIndex),
        ...(focused
          ? {
              // Degradado que nace en el chip y muere hacia la derecha: el
              // color señala DE DÓNDE viene la selección, no inunda la fila.
              background: `linear-gradient(90deg, ${accent}24, ${accent}08 70%, transparent)`,
              color: accent,
              translate: '0.3em 0',
            }
          : { color: 'var(--muted-foreground)' }),
      }}
    >
      {/* El chip del icono: caja tintada siempre visible (el menú tiene alma
          también en reposo) que al enfocar se enciende con su halo. */}
      <span
        className="flex h-[1.9em] w-[1.9em] flex-none items-center justify-center rounded-[0.45em] transition-[background-color,box-shadow] duration-200"
        style={
          focused
            ? {
                background: `${accent}2b`,
                boxShadow: `inset 0 0 0 1px ${accent}66, 0 0 0.9em ${accent}40`,
              }
            : {
                background: 'rgba(255,255,255,.05)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.09)',
              }
        }
      >
        <Icon size={22} className="h-[1.05em] w-[1.05em]" />
      </span>
      {label}
      {focused && (
        <>
          {/* Anillo interior que respira + barrido de luz DENTRO del marco:
              la fila enfocada está viva, no solo pintada. */}
          <span
            aria-hidden
            className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.55em]"
            style={{ boxShadow: `inset 0 0 0 2px ${accent}59` }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.55em]"
          >
            <span
              className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[45%]"
              style={{
                background:
                  'linear-gradient(105deg, transparent, rgba(255,255,255,.13), transparent)',
              }}
            />
          </span>
        </>
      )}
    </button>
  );
};

export const TvStartMenu = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const navigate = useNavigate();
  // Modal de verdad: mientras el menu esta abierto, los botones contextuales
  // no atraviesan hacia la pantalla de debajo (B y Start los maneja el
  // goBack del shell, que mira menuOpen antes que la pila).
  useTvButtons(TV_MODAL_SWALLOW);
  const go = (path: string): void => {
    navigate(path);
    onClose();
  };

  return (
    <TvFocusLayer>
      {/* Velo + panel lateral izquierdo: el contenido de detrás se intuye,
          que el menú es un aparte y no otra pantalla. */}
      <div className="absolute inset-0 z-30 flex" onClick={onClose}>
        {/* Sin backdrop-blur: el velo entra con fade y el blur no muestrea
            hasta acabar la animación — el fondo "se oscurecía de golpe". */}
        <div className="animate-in fade-in-0 absolute inset-0 bg-black/65 duration-250" />
        <div
          className="animate-in slide-in-from-left-8 fade-in-0 relative flex h-full w-[19em] flex-col gap-[0.35em] bg-[#0f1110]/95 px-[1.2em] pt-[3em] duration-300"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Hairline de luz verde en el canto superior: la firma de color
              del modo, dicha en un pelo de luz y no en un border plano. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${GREEN}55, transparent)` }}
          />
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-px"
            style={{
              background:
                'linear-gradient(180deg, transparent, rgba(255,255,255,.16) 30%, rgba(255,255,255,.16) 70%, transparent)',
            }}
          />
          <div className="mb-[1.2em] flex items-center gap-[0.6em] px-[0.7em]">
            <span
              aria-hidden
              className="afterplay-tv-ring h-[0.4em] w-[0.4em] rounded-full"
              style={{ background: GREEN, boxShadow: `0 0 0.6em ${GREEN}99` }}
            />
            <span className="text-[0.75em] font-extrabold tracking-[.22em] text-muted-foreground/60">
              BIG PICTURE
            </span>
          </div>
          <MenuItem
            icon={Home}
            label="Home"
            accent={GREEN}
            autoFocus
            revealIndex={0}
            onSelect={() => go('/tv')}
          />
          <MenuItem
            icon={LibraryBig}
            label="Library"
            accent={BLUE}
            revealIndex={1}
            onSelect={() => go('/tv/library')}
          />
          <MenuItem
            icon={BookOpenText}
            label="Journey"
            accent={VIOLET}
            revealIndex={2}
            onSelect={() => go('/tv/journey')}
          />
          {/* Separador de luz: gradiente que se apaga en los extremos, como
              el hairline del canto — nada de rayas planas de lado a lado. */}
          <div
            className="my-[0.6em] h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent)',
            }}
          />
          <MenuItem
            icon={LogOut}
            label="Exit Big Picture"
            accent={TEAL}
            revealIndex={3}
            onSelect={() => {
              onClose();
              requestExitBigPicture();
            }}
          />
          <MenuItem
            icon={Power}
            label="Quit Afterplay"
            accent={DANGER}
            revealIndex={4}
            onSelect={() => window.api.window.quitApp()}
          />
          {/* Pie de panel: el wordmark en pequeño, con su puntito de vida —
              la firma discreta de quién es esta casa. */}
          <div className={`mt-auto pb-[1.15em] ${tvRevealClass}`} style={tvRevealStyle(5)}>
            <div
              className="mx-[0.7em] h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,.1), transparent)',
              }}
            />
            <div className="mt-[0.95em] flex items-center justify-center gap-[0.55em]">
              <span
                aria-hidden
                className="afterplay-tv-glow h-[0.3em] w-[0.3em] rounded-full"
                style={{ background: GREEN, boxShadow: `0 0 0.5em ${GREEN}99` }}
              />
              <span className="text-[0.58em] font-extrabold tracking-[.34em] text-muted-foreground/50">
                AFTERPLAY
              </span>
            </div>
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};
