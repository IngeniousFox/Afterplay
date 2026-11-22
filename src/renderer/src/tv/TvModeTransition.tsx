import { useEffect, useState } from 'react';
import { useBigPicture } from '../hooks/useBigPicture';
import { BRAND_NAME } from '../../../shared/branding';
import { TvLogo } from './TvChrome';

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
        className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-inset"
        style={{ animation: 'afterplay-tv-outro-veil-full 720ms ease-in-out both' }}
      >
        <TvWordmark style={{ animation: 'afterplay-tv-outro-mark 720ms ease-in-out both' }} />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[80] flex flex-col items-center justify-center bg-inset bg-[radial-gradient(50%_40%_at_50%_46%,rgb(255_179_71/0.07),transparent_70%)]"
      style={{ animation: 'afterplay-tv-intro-veil 1650ms ease-in-out both' }}
    >
      <TvWordmark
        style={{ animation: 'afterplay-tv-intro-mark 1650ms cubic-bezier(.22,1,.36,1) both' }}
      />
      {/* La línea de fósforo que se abre bajo la marca. */}
      <div
        className="mt-[1.6vh] h-[2px] w-[clamp(120px,16vw,260px)] origin-center rounded-full bg-[linear-gradient(90deg,transparent,var(--color-phosphor),transparent)] shadow-glow-bar"
        style={{ animation: 'afterplay-tv-intro-line 1650ms cubic-bezier(.22,1,.36,1) both' }}
      />
    </div>
  );
};

// La marca de Fósforo: la pantalla con el Play en Phosphor y "Afterplay" en
// Big Shoulders. Las animaciones de main.css mueven el tracking: aquí se
// arranca en 0.
const TvWordmark = ({ style }: { style: React.CSSProperties }): React.JSX.Element => (
  <div
    className="flex items-center gap-[0.35em] font-display text-[clamp(32px,5vh,64px)] leading-none font-bold text-bone"
    style={style}
  >
    <TvLogo className="size-[1em]" />
    {BRAND_NAME}
  </div>
);
