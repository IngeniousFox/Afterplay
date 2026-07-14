import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useImageSrc } from '../../../hooks/useImageSrc';

type ScreenshotLightboxProps = {
  screenshots: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

const LightboxImage = ({ url }: { url: string }): React.JSX.Element | null => {
  const src = useImageSrc(url, 'screenshots');
  if (!src) return null;
  return <img src={src} alt="" className="block h-full max-h-[74vh] w-full object-cover" />;
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
    <div
      onClick={onClick}
      className="h-12.5 w-21 flex-none cursor-pointer overflow-hidden rounded-lg border-2"
      style={{ borderColor: active ? '#2fdc7e' : 'transparent', opacity: active ? 1 : 0.5 }}
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
    </div>
  );
};

// Lightbox a pantalla completa (SPEC 10.7 / prototipo) — flechas laterales,
// miniaturas abajo, contador. Cierra al clicar el fondo o la X.
export const ScreenshotLightbox = ({
  screenshots,
  index,
  onIndexChange,
  onClose,
}: ScreenshotLightboxProps): React.JSX.Element => (
  <div
    onClick={onClose}
    className="fixed inset-0 z-220 flex flex-col items-center justify-center px-17.5 py-10 backdrop-blur-md"
    style={{ background: 'rgba(4,6,5,.9)' }}
  >
    <button
      type="button"
      onClick={onClose}
      className="absolute top-5.5 right-6.5 z-10 flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/14"
      style={{ background: 'rgba(20,22,21,.7)' }}
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
      className="absolute top-1/2 left-5.5 z-10 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 disabled:opacity-30"
      style={{ background: 'rgba(20,22,21,.7)' }}
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
      className="absolute top-1/2 right-5.5 z-10 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 disabled:opacity-30"
      style={{ background: 'rgba(20,22,21,.7)' }}
    >
      <ChevronRight size={24} />
    </button>

    <div
      onClick={(event) => event.stopPropagation()}
      className="w-full max-w-275 overflow-hidden rounded-[14px] border border-white/14 shadow-[0_30px_90px_rgba(0,0,0,.6)]"
    >
      <LightboxImage url={screenshots[index]} />
    </div>

    <div onClick={(event) => event.stopPropagation()} className="mt-4.5 flex items-center gap-2.5">
      {screenshots.map((url, i) => (
        <Thumb key={url} url={url} active={i === index} onClick={() => onIndexChange(i)} />
      ))}
    </div>
    <div className="mt-3 text-[12.5px] text-muted-foreground tabular-nums">
      {index + 1} / {screenshots.length}
    </div>
  </div>
);
