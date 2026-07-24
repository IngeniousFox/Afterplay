import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { useIgdbDetails } from '../../../hooks/igdb';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { ScreenshotLightbox } from './ScreenshotLightbox';
import { SectionLabel } from './SectionLabel';

type ScreenshotsCarouselProps = {
  igdbId: number;
};

const SLIDE_WIDTH = 300;
const SLIDE_GAP = 14;
const GREEN = '#2fdc7e';
// Cuántas placas de esqueleto mientras se resuelve el detalle de IGDB — no
// se sabe todavía cuántas screenshots hay de verdad, así que es un número
// fijo que llena la fila visible (mismo criterio que CoverPicker con sus 8/4
// de sobra), no un intento de adivinar el total real.
const SKELETON_COUNT = 3;
const slideShellClass = 'h-42.5 w-75 flex-none rounded-[11px] border border-border';

const pagerButtonClass =
  'flex h-7 w-7 items-center justify-center rounded-[7px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

const ScreenshotSlide = ({
  url,
  onClick,
}: {
  url: string;
  onClick: () => void;
}): React.JSX.Element => {
  const src = useImageSrc(url, 'screenshots');
  return (
    <button
      type="button"
      onClick={onClick}
      // group + hover:-translate-y — mismo lenguaje que las carátulas de
      // Completed (Stats): la fila entera "levanta" al pasar el ratón, no
      // solo cambia de color, para que se sienta clicable de verdad.
      className={`group/shot relative overflow-hidden transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_10px_28px_rgba(0,0,0,.45)] ${slideShellClass}`}
    >
      {/* useImageSrc resuelve por IPC (caché local o descarga) — mientras no
          hay src, un esqueleto propio con el tamaño exacto de la miniatura,
          no null: devolver null quitaba el hueco de la fila entera (las
          demás capturas se corrían a la izquierda) y esta aparecía de golpe
          más tarde en medio del carril, en vez de rellenarse en su sitio. */}
      {src ? (
        <>
          <img
            src={src}
            alt=""
            className="block h-full w-full scale-100 object-cover transition-transform duration-300 group-hover/shot:scale-107"
          />
          {/* Degradado inferior sutil: sin él la captura es un rectángulo
              plano pegado al borde; con él gana algo de profundidad incluso
              en reposo, y sirve de fondo para el icono de ampliar. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 opacity-0 transition-opacity duration-200 group-hover/shot:opacity-100"
            style={{ background: 'linear-gradient(180deg, transparent, rgba(6,7,6,.55))' }}
          />
          <div
            className="absolute right-2.25 bottom-2.25 flex h-7 w-7 items-center justify-center rounded-[8px] border border-white/14 opacity-0 transition-opacity duration-200 group-hover/shot:opacity-100"
            style={{ background: 'rgba(10,11,10,.72)' }}
          >
            <Maximize2 size={12} />
          </div>
        </>
      ) : (
        <div className="h-full w-full animate-pulse bg-white/[0.06]" />
      )}
    </button>
  );
};

// SPEC 10.7 / prototipo — tira horizontal de screenshots (IGDB) con flechas
// prev/next + puntos, clic abre el lightbox a pantalla completa. Rediseño:
// las carátulas levantan y hacen zoom sutil al pasar el ratón (con un icono
// de ampliar que aclara que se puede abrir a pantalla completa, antes
// implícito), el contador junto a las flechas dice en qué captura estás, y
// los puntos de abajo son ahora una píldora que crece en el activo en vez de
// puntos sueltos indistinguibles.
export const ScreenshotsCarousel = ({
  igdbId,
}: ScreenshotsCarouselProps): React.JSX.Element | null => {
  const { data, isLoading } = useIgdbDetails(igdbId);
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const screenshots = data?.screenshots ?? [];

  // Mientras se resuelve el detalle de IGDB todavía no se sabe si el juego
  // tiene screenshots — antes la sección entera no existía hasta que la
  // respuesta llegaba, y aparecía de golpe (y si no tenía ninguna, ni
  // siquiera eso: la sección nunca aparecía, sin diferencia visible entre
  // "cargando" y "no tiene"). Con el esqueleto, "cargando" se ve.
  if (isLoading) {
    return (
      <div className="mt-7.5">
        {/* Misma fila "flex items-center justify-between" que la cabecera
            real, con un hueco invisible a la derecha del mismo alto que los
            botones de flecha (h-7): sin él, esta cabecera (solo texto, más
            baja) crecía de golpe al terminar de cargar y empujaba la fila de
            imágenes hacia abajo — el salto que se notaba. */}
        <div className="mb-3.25 flex items-center justify-between">
          <SectionLabel>SCREENSHOTS</SectionLabel>
          <div className="h-7" />
        </div>
        <div className="flex gap-3.5">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} className={`animate-pulse bg-white/[0.06] ${slideShellClass}`} />
          ))}
        </div>
      </div>
    );
  }

  if (screenshots.length === 0) return null;

  const trackX = -(index * (SLIDE_WIDTH + SLIDE_GAP));

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 flex items-center justify-between">
        <SectionLabel>SCREENSHOTS</SectionLabel>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {index + 1}/{screenshots.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index <= 0}
              aria-label="Previous screenshot"
              className={pagerButtonClass}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setIndex((current) => Math.min(screenshots.length - 1, current + 1))}
              disabled={index >= screenshots.length - 1}
              aria-label="Next screenshot"
              className={pagerButtonClass}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* -my-2 py-2 (solo vertical, no -m-2): overflow-hidden aquí es solo
          para esconder horizontalmente las capturas que no caben a los lados
          del carril — pero al ser la altura EXACTA de una miniatura, el
          hover:-translate-y-1 de ScreenshotSlide se salía por arriba y el
          propio borde del recorte se comía el borde/esquina superior de la
          miniatura levantada. El padding da el margen vertical que faltaba
          para que quepa el levantado sin recortarse; el margen negativo (solo
          arriba/abajo) lo compensa para que el carril no baje ni empuje lo de
          debajo — un -m-2 a secas habría tirado también de los lados y
          desplazado/ensanchado el carril hacia la izquierda sin querer. */}
      <div className="-my-2 overflow-hidden rounded-[11px] py-2">
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

      {screenshots.length > 1 && (
        <div className="mt-3.5 flex items-center justify-center gap-1.5">
          {screenshots.map((url, i) => {
            const active = i === index;
            return (
              <button
                key={url}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to screenshot ${i + 1}`}
                className="h-1.75 cursor-pointer rounded-full transition-[width,background-color,box-shadow] duration-200"
                style={{
                  width: active ? 18 : 7,
                  background: active ? GREEN : 'rgba(255,255,255,.2)',
                  boxShadow: active ? `0 0 8px ${GREEN}80` : 'none',
                }}
              />
            );
          })}
        </div>
      )}

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
