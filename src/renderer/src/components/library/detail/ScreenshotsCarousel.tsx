import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useIgdbDetails } from '../../../hooks/igdb';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { ScreenshotLightbox } from './ScreenshotLightbox';

type ScreenshotsCarouselProps = {
  igdbId: number;
};

const SLIDE_WIDTH = 300;
const SLIDE_GAP = 14;

const ScreenshotSlide = ({
  url,
  onClick,
}: {
  url: string;
  onClick: () => void;
}): React.JSX.Element | null => {
  const src = useImageSrc(url, 'screenshots');
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-42.5 w-75 flex-none overflow-hidden rounded-[11px] border border-border hover:border-input"
    >
      <img src={src} alt="" className="block h-full w-full object-cover" />
    </button>
  );
};

// SPEC 10.7 / prototipo — tira horizontal de screenshots (IGDB) con flechas
// prev/next + puntos, clic abre el lightbox a pantalla completa.
export const ScreenshotsCarousel = ({
  igdbId,
}: ScreenshotsCarouselProps): React.JSX.Element | null => {
  const { data } = useIgdbDetails(igdbId);
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const screenshots = data?.screenshots ?? [];

  if (screenshots.length === 0) return null;

  const trackX = -(index * (SLIDE_WIDTH + SLIDE_GAP));

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[.13em] text-muted-foreground">
          SCREENSHOTS
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
            disabled={index <= 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-input bg-white/[0.03] disabled:opacity-35"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setIndex((current) => Math.min(screenshots.length - 1, current + 1))}
            disabled={index >= screenshots.length - 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-input bg-white/[0.03] disabled:opacity-35"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[11px]">
        <div
          className="flex gap-3.5 transition-transform duration-320 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ transform: `translateX(${trackX}px)` }}
        >
          {screenshots.map((url, i) => (
            <ScreenshotSlide
              key={url}
              url={url}
              onClick={() => {
                setIndex(i);
                setLightboxOpen(true);
              }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3.5 flex items-center justify-center gap-1.75">
        {screenshots.map((url, i) => (
          <div
            key={url}
            onClick={() => setIndex(i)}
            className="h-1.75 w-1.75 cursor-pointer rounded-full"
            style={{ background: i === index ? '#2fdc7e' : 'rgba(255,255,255,.2)' }}
          />
        ))}
      </div>

      {lightboxOpen && (
        <ScreenshotLightbox
          screenshots={screenshots}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};
