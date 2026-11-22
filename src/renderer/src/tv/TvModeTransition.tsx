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
// «ROCK AND ROLL»: entrar es ENCENDER LA TELE (1650 ms, lo que tarda la
// tramoya de verdad). Negro; una línea horizontal que se abre desde el
// centro; un destello que la abre en vertical hasta llenar la pantalla;
// scanlines que se asientan; y la marca que se enciende a chispazos, como el
// attract mode de una recreativa, con «Big Picture» parpadeando debajo.
// Salir es APAGARLA (720 ms): la pantalla se recoge en una línea, la línea en
// un punto, y el velo se retira.
//
// Todo es transform y opacity (keyframes afterplay-tv-* en main.css). La
// cortina se retira al ACABAR su animación (animationend del velo), así que
// si se pausa — las capturas de movimiento la congelan fotograma a
// fotograma — espera; un temporizador de respaldo la quita igualmente si la
// animación no llegara a correr.
//
// Reduced motion: sin línea, destello ni chispazos; la marca entra y sale
// con un fundido y el velo se retira igual.

type Phase = 'idle' | 'entering' | 'leaving';

const ENTER_MS = 1_650;
const LEAVE_MS = 720;
const FALLBACK_MS = 4_000;

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
    const timer = setTimeout(
      () => setPhase('idle'),
      (phase === 'entering' ? ENTER_MS : LEAVE_MS) + FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'idle') return null;

  // Solo la animación del propio velo cierra la cortina (las de dentro
  // también burbujean animationend).
  const onVeilEnd = (event: React.AnimationEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) setPhase('idle');
  };

  if (phase === 'leaving') {
    return (
      <div
        data-tv-curtain="leave"
        onAnimationEnd={onVeilEnd}
        className="pointer-events-none fixed inset-0 z-[80] overflow-hidden bg-inset animate-[afterplay-tv-outro-veil-full_720ms_ease-in-out_both]"
      >
        {/* La pantalla que se apaga: luz que se recoge en línea y en punto. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_50%,rgb(255_240_214/0.95),rgb(255_179_71/0.45)_55%,transparent_80%)] animate-[afterplay-tv-power-off_720ms_var(--ease-in-out)_both] motion-reduce:hidden"
        />
      </div>
    );
  }

  return (
    <div
      data-tv-curtain="enter"
      onAnimationEnd={onVeilEnd}
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden bg-inset bg-[radial-gradient(50%_40%_at_50%_46%,rgb(255_179_71/0.08),transparent_70%)] animate-[afterplay-tv-intro-veil_1650ms_linear_both]"
    >
      {/* 1. El destello que abre la línea en vertical hasta la pantalla. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(75%_65%_at_50%_50%,rgb(255_240_214/0.85),rgb(255_179_71/0.3)_60%,transparent_90%)] animate-[afterplay-tv-power-flash_1650ms_var(--ease-out)_both] motion-reduce:hidden"
      />
      {/* 2. Las scanlines del tubo recién encendido, que se asientan. */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-[4px] -bottom-[16px] bg-[repeating-linear-gradient(0deg,rgb(255_222_176/0.11)_0_1px,transparent_1px_3px)] animate-[afterplay-tv-power-scan_1650ms_linear_both] motion-reduce:hidden"
      />
      {/* 3. La línea horizontal: aparece en el centro y se abre a lo ancho. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-[linear-gradient(90deg,transparent,rgb(255_222_176)_12%,#fffaf0_50%,rgb(255_222_176)_88%,transparent)] shadow-[0_0_24px_rgb(255_179_71/0.9),0_0_80px_rgb(255_179_71/0.5)] animate-[afterplay-tv-power-line_1650ms_var(--ease-out)_both] motion-reduce:hidden"
      />

      {/* 4. La marca, encendiéndose a chispazos (attract mode). */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4vh]">
        <div className="flex items-center gap-[0.35em] font-display text-[clamp(32px,5.4vh,72px)] leading-none font-bold text-bone [text-shadow:0_0_2px_rgb(255_179_71/0.55),0_0_30px_rgb(255_179_71/0.45)] animate-[afterplay-tv-attract_1650ms_linear_both] motion-reduce:animate-[afterplay-tv-intro-calm_1650ms_ease-out_both]">
          <TvLogo className="size-[1em] drop-shadow-[0_0_10px_rgb(255_179_71/0.7)]" />
          {BRAND_NAME}
        </div>
        <div className="font-display text-[clamp(16px,2.4vh,32px)] leading-none font-semibold text-phosphor [text-shadow:0_0_16px_rgb(255_179_71/0.6)] animate-[afterplay-tv-attract-caption_1650ms_linear_both] motion-reduce:animate-[afterplay-tv-intro-calm_1650ms_ease-out_both]">
          Big Picture
        </div>
      </div>
    </div>
  );
};
