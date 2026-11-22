import { Gamepad2, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { GameMedia, SagaEntry } from '../../api';
import { cn } from '../../lib/cn';
import { formatHours } from '../../lib/format';
import { iconButtonClass } from '../../lib/styles';
import { statusOf } from '../../lib/status';
import { SectionLabel } from './primitives';

// El visor a pantalla completa.
//
// Tres cosas que le faltaban y que en un móvil no son adorno:
//
//  · El fondo seguía scrolleando por debajo. Se bloquea el <body> mientras
//    está abierto y se repone al cerrar — guardando el valor anterior en vez
//    de asumir que era `visible`, para no pisar el de otro.
//  · No se podía pasar a la siguiente. La tira usa scroll-snap nativo: el
//    gesto es el del sistema, con su inercia y su rebote, en vez de un
//    arrastre reimplementado que nunca se siente igual.
//  · No se sabía dónde estabas. Contador arriba y puntos abajo, los dos
//    derivados de la posición real del scroll.
const Lightbox = ({
  images,
  startIndex,
  onClose,
}: {
  images: string[];
  startIndex: number;
  onClose: () => void;
}): React.JSX.Element => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Arrancar en la que se tocó. `instant` porque un desplazamiento animado
  // desde la primera hasta la séptima al abrir se ve como un fallo.
  useEffect(() => {
    const track = trackRef.current;
    if (track) track.scrollTo({ left: startIndex * track.clientWidth, behavior: 'instant' });
  }, [startIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-inset/95" role="dialog" aria-modal="true">
      <div className="flex flex-none items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <span className="text-small font-semibold text-dust tabular-nums">
          {index + 1} / {images.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cn(iconButtonClass, 'border border-line-strong text-bone')}
        >
          <X size={18} />
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget;
          const next = Math.round(track.scrollLeft / track.clientWidth);
          if (next !== index) setIndex(next);
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((url) => (
          <div
            key={url}
            className="flex w-full flex-none snap-center items-center justify-center p-3"
          >
            <img src={url} alt="" className="max-h-full max-w-full rounded-md object-contain" />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <div className="flex flex-none items-center justify-center gap-1.5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {images.map((url, dotIndex) => (
            <span
              key={url}
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none',
                dotIndex === index ? 'w-4 bg-phosphor' : 'w-1.5 bg-bone/30',
              )}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
};

// ── Capturas y tráiler ─────────────────────────────────────────────────────

// Carrusel horizontal con scroll nativo y snap. En el escritorio hay flechas
// porque hay ratón; aquí el gesto es el dedo, así que las flechas serían dos
// dianas ocupando sitio para hacer lo que el scroll ya hace mejor.
export const ScreenshotsSection = ({ media }: { media: GameMedia }): React.JSX.Element | null => {
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (media.screenshots.length === 0 && media.videoId === null) return null;

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <SectionLabel>Media</SectionLabel>
        {media.videoId && (
          <a
            href={`https://www.youtube.com/watch?v=${media.videoId}`}
            target="_blank"
            rel="noreferrer"
            className="-my-3 inline-flex min-h-11 items-center gap-1.5 px-1 text-small font-semibold text-tube"
          >
            <Play size={12} fill="currentColor" aria-hidden="true" />
            Trailer
          </a>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max snap-x snap-mandatory gap-2">
          {media.screenshots.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setOpenAt(index)}
              aria-label={`Open screenshot ${index + 1}`}
              className="w-64 flex-none snap-start overflow-hidden rounded-md border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                className="block aspect-video w-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>

      {openAt !== null && (
        <Lightbox images={media.screenshots} startIndex={openAt} onClose={() => setOpenAt(null)} />
      )}
    </section>
  );
};

// ── La saga ────────────────────────────────────────────────────────────────

// Los capítulos de la saga, cruzados con tu biblioteca. El cruce es lo que la
// hace útil: la lista de secuelas la da cualquier web, pero "de estos ocho,
// cuatro los terminaste y tres ni los tienes" solo la cuenta tu propia base.
export const SagaSection = ({
  entries,
  currentGameId,
}: {
  entries: SagaEntry[];
  currentGameId: string;
}): React.JSX.Element | null => {
  // Un solo capítulo es este mismo juego: no es una saga, es un juego suelto.
  if (entries.length <= 1) return null;

  const owned = entries.filter((entry) => entry.libraryId !== null).length;

  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between">
        <SectionLabel>Saga</SectionLabel>
        <span className="text-small text-dust tabular-nums">
          {owned} of {entries.length} in your library
        </span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2.5">
          {entries.map((entry) => {
            const status = statusOf(entry.currentState);
            const isCurrent = entry.libraryId === currentGameId;
            const inLibrary = entry.libraryId !== null;

            const tile = (
              <>
                <div className="relative aspect-3/4 w-full overflow-hidden rounded-sm border border-line bg-raised">
                  {entry.coverUrl ? (
                    <img
                      src={entry.coverUrl}
                      alt={entry.title}
                      loading="lazy"
                      className={`h-full w-full object-cover ${
                        // Los que NO tienes se quedan apagados: la sección
                        // cuenta tu relación con la saga, y un juego que no
                        // has tocado no puede verse igual que uno que sí.
                        inLibrary ? 'brightness-90' : 'brightness-[.45] grayscale'
                      }`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-raised">
                      <Gamepad2 size={18} className="text-dust/60" aria-hidden="true" />
                    </div>
                  )}
                  {inLibrary && (
                    <div
                      className="absolute inset-x-0 bottom-0 h-0.75"
                      style={{ background: status.color }}
                    />
                  )}
                  {isCurrent && (
                    <div className="absolute inset-0 rounded-sm ring-2 ring-phosphor ring-inset" />
                  )}
                </div>
                <div
                  className={cn(
                    'mt-1.5 text-small leading-tight font-semibold',
                    inLibrary ? 'text-bone' : 'text-dust',
                  )}
                >
                  {entry.title}
                </div>
                <div className="mt-0.5 text-micro text-dust tabular-nums">
                  {entry.releaseYear ?? '—'}
                  {entry.totalHours > 0 && ` · ${formatHours(entry.totalHours)}`}
                  {entry.planned && ' · Plan'}
                </div>
              </>
            );

            return entry.libraryId !== null && !isCurrent ? (
              <Link key={entry.igdbId} to={`/game/${entry.libraryId}`} className="w-24 flex-none">
                {tile}
              </Link>
            ) : (
              <div key={entry.igdbId} className="w-24 flex-none">
                {tile}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
