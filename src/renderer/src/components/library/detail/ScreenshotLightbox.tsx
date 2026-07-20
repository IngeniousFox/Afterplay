import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { useImageSrc } from '../../../hooks/useImageSrc';

// En ms — el mismo número gobierna la clase Tailwind (duration-200) de abajo
// y el setTimeout que espera a que la animación de salida termine antes de
// desmontar de verdad. Una constante, no dos números sueltos que se puedan
// desincronizar si alguien cambia uno y se olvida del otro.
const CLOSE_DURATION_MS = 200;

type ScreenshotLightboxProps = {
  screenshots: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

const GREEN = '#2fdc7e';

const LightboxImage = ({ url }: { url: string }): React.JSX.Element | null => {
  const src = useImageSrc(url, 'screenshots');
  if (!src) return null;
  return (
    // key=url: remonta la imagen en cada cambio para relanzar la entrada —
    // sin eso (mismo <img>, solo cambia src) no hay nada que animar.
    <img
      key={url}
      src={src}
      alt=""
      className="block h-full max-h-[74vh] w-full object-cover duration-200 animate-in fade-in-0 zoom-in-98"
    />
  );
};

const Thumb = ({
  url,
  active,
  onClick,
}: {
  url: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element | null => {
  const src = useImageSrc(url, 'screenshots');
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12.5 w-21 flex-none cursor-pointer overflow-hidden rounded-lg border-2 transition-[opacity,box-shadow] duration-150 hover:opacity-100"
      style={{
        borderColor: active ? GREEN : 'transparent',
        opacity: active ? 1 : 0.5,
        boxShadow: active ? `0 0 12px ${GREEN}4d` : 'none',
      }}
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
    </button>
  );
};

// Lightbox a pantalla completa (SPEC 10.7 / prototipo) — flechas laterales,
// miniaturas abajo, contador. Cierra al clicar el fondo o la X, con una
// animación de salida (fade del fondo entero + zoom-out de la imagen) antes
// de desmontar de verdad — antes ni siquiera tenía entrada animada, ambas
// van a la vez.
export const ScreenshotLightbox = ({
  screenshots,
  index,
  onIndexChange,
  onClose,
}: ScreenshotLightboxProps): React.JSX.Element => {
  // Fase de salida: el componente sigue montado (con las clases animate-out
  // puestas) durante CLOSE_DURATION_MS, y solo entonces se llama al onClose
  // real que lo desmonta desde el padre — condicionalmente renderizado
  // (`{lightboxOpen && <ScreenshotLightbox/>}` en ScreenshotsCarousel) como
  // está, no hay forma de animar la salida sin este paso intermedio.
  const [closing, setClosing] = useState(false);

  const startClose = (): void => {
    if (closing) return; // ya en marcha — un segundo click no la reinicia
    setClosing(true);
    setTimeout(onClose, CLOSE_DURATION_MS);
  };

  return (
    <div
      onClick={startClose}
      className={`fixed inset-0 z-220 flex flex-col items-center justify-center px-17.5 py-10 backdrop-blur-md duration-200 ${
        closing ? 'animate-out fade-out-0' : 'animate-in fade-in-0'
      }`}
      style={{ background: 'rgba(4,6,5,.9)' }}
    >
      <button
        type="button"
        onClick={startClose}
        // El fondo va en clase, no en `style` inline: un style inline SIEMPRE
        // gana sobre cualquier clase (por mucho hover: que le pongas), así que
        // hover:bg-white/10 sería letra muerta si el fondo base siguiera en
        // `style`.
        className="absolute top-5.5 right-6.5 z-10 flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/14 bg-[rgba(20,22,21,.7)] transition-colors hover:border-white/28 hover:bg-white/10"
      >
        <X size={18} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onIndexChange(Math.max(0, index - 1));
        }}
        disabled={index <= 0}
        className="absolute top-1/2 left-5.5 z-10 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-[rgba(20,22,21,.7)] transition-colors hover:border-white/28 hover:bg-white/10 disabled:opacity-30 disabled:hover:border-white/14 disabled:hover:bg-[rgba(20,22,21,.7)]"
      >
        <ChevronLeft size={24} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onIndexChange(Math.min(screenshots.length - 1, index + 1));
        }}
        disabled={index >= screenshots.length - 1}
        className="absolute top-1/2 right-5.5 z-10 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-[rgba(20,22,21,.7)] transition-colors hover:border-white/28 hover:bg-white/10 disabled:opacity-30 disabled:hover:border-white/14 disabled:hover:bg-[rgba(20,22,21,.7)]"
      >
        <ChevronRight size={24} />
      </button>

      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-275 overflow-hidden rounded-[14px] border border-white/14 shadow-[0_30px_90px_rgba(0,0,0,.6)] duration-200 ${
          closing ? 'animate-out zoom-out-95' : 'animate-in zoom-in-95'
        }`}
      >
        <LightboxImage url={screenshots[index]} />
      </div>

      <div
        onClick={(event) => event.stopPropagation()}
        className="mt-4.5 flex items-center gap-2.5"
      >
        {screenshots.map((url, i) => (
          <Thumb key={url} url={url} active={i === index} onClick={() => onIndexChange(i)} />
        ))}
      </div>
      <div className="mt-3 text-[12.5px] text-muted-foreground tabular-nums">
        {index + 1} / {screenshots.length}
      </div>
    </div>
  );
};
