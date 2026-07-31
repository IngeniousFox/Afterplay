import { useEffect, useState } from 'react';
import { useBigPicture } from '../hooks/useBigPicture';

// La cortina del cambio de modo. Entrar en Big Picture mueve MUCHAS piezas a
// la vez — el fullscreen del SO, el salto de ruta, el remonte del árbol — y
// sin cortina se veía la tramoya (el escritorio redimensionándose, la ruta
// cambiando). Esto se monta en Afterplay.tsx, FUERA del router: aparece en
// el MISMO frame en que el estado del main cambia, antes de que nada de lo
// de detrás empiece a moverse.
//
// Entrada: velo negro con la marca respirando (~1.6s, el tiempo que tarda la
// tramoya de verdad). Salida: el mismo velo en corto (~450ms), suficiente
// para tapar el des-fullscreen. Las animaciones viven en main.css
// (afterplay-tv-intro-*).

type Phase = 'idle' | 'entering' | 'leaving';

// El negro de la cortina no es plano: un aliento verdoso apenas perceptible
// tras la marca — la firma de color del modo ya está ahí antes que el modo.
const VEIL_BACKGROUND = 'radial-gradient(ellipse 60% 45% at 50% 44%, #0b110d 0%, #080a09 70%)';

export const TvModeTransition = (): React.JSX.Element | null => {
  const active = useBigPicture();
  const [phase, setPhase] = useState<Phase>('idle');
  // Arrancar la app YA en modo TV (--bigpicture en frío) también merece su
  // cortina: la primera impresión del modo es la marca, no un fogonazo.
  const [previous, setPrevious] = useState<boolean | null>(null);

  if (previous !== active) {
    setPrevious(active);
    setPhase(active ? 'entering' : previous === null ? 'idle' : 'leaving');
  }

  useEffect(() => {
    if (phase === 'idle') return;
    const timer = setTimeout(() => setPhase('idle'), phase === 'entering' ? 1_650 : 720);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'idle') return null;

  if (phase === 'leaving') {
    return (
      <div
        className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center"
        style={{
          background: VEIL_BACKGROUND,
          animation: 'afterplay-tv-outro-veil-full 720ms ease-in-out both',
        }}
      >
        <div
          className="text-[clamp(22px,3.2vh,42px)] font-extrabold text-foreground/90"
          style={{
            // Un aliento de luz mínimo tras la marca de despedida: que el
            // último frame del modo también tenga cuerpo, no solo letras.
            textShadow: '0 0 2em rgba(47,220,126,.14)',
            animation: 'afterplay-tv-outro-mark 720ms ease-in-out both',
          }}
        >
          AFTERPLAY
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[80] flex flex-col items-center justify-center"
      style={{
        background: VEIL_BACKGROUND,
        animation: 'afterplay-tv-intro-veil 1650ms ease-in-out both',
      }}
    >
      <div
        className="text-[clamp(28px,4.2vh,56px)] font-extrabold text-foreground"
        style={{
          textShadow: '0 0 2.4em rgba(47,220,126,.18)',
          animation: 'afterplay-tv-intro-mark 1650ms cubic-bezier(.22,1,.36,1) both',
        }}
      >
        AFTERPLAY
      </div>
      {/* La línea que se abre bajo la marca, ahora con su brillo: la nítida
          delante y una gemela desenfocada detrás, las dos con el MISMO
          keyframe — el halo nace y muere con la línea, sin animación nueva. */}
      <div className="relative mt-[1.2vh] flex items-center justify-center">
        <div
          aria-hidden
          className="absolute h-[2px] w-[clamp(120px,16vw,260px)] origin-center rounded-full blur-[6px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #2fdc7e, transparent)',
            animation: 'afterplay-tv-intro-line 1650ms cubic-bezier(.22,1,.36,1) both',
          }}
        />
        <div
          className="h-[2px] w-[clamp(120px,16vw,260px)] origin-center rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent, #2fdc7e, transparent)',
            boxShadow: '0 0 12px rgba(47,220,126,.5)',
            animation: 'afterplay-tv-intro-line 1650ms cubic-bezier(.22,1,.36,1) both',
          }}
        />
      </div>
    </div>
  );
};
