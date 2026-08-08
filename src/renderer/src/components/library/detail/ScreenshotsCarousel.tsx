import { ChevronLeft, ChevronRight, Maximize2, Play } from 'lucide-react';
import { useState } from 'react';
import { useIgdbDetails } from '../../../hooks/igdb';
import { useImageSrc } from '../../../hooks/useImageSrc';
import type { CarouselSlide } from './carouselSlides';
import { slideKey, trailerPoster } from './carouselSlides';
import { ScreenshotLightbox } from './ScreenshotLightbox';
import { SectionLabel } from './SectionLabel';
import { GREEN } from '../../../lib/colors';

type ScreenshotsCarouselProps = {
  igdbId: number;
};

const SLIDE_WIDTH = 300;
const SLIDE_GAP = 14;
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

// El tráiler, como una diapositiva más y SIEMPRE la primera.
//
// Sección propia no, y no es pereza: el tráiler y las capturas son lo mismo
// —material audiovisual del juego, que se mira en grande— y separarlos habría
// dejado dos carriles seguidos con el mismo aspecto y un cabecero cada uno.
// Aquí entra donde ya estaba el gesto ("clic para verlo grande") y la primera
// posición es la suya: si hay tráiler, es lo que quieres ver antes.
//
// La miniatura es la de YouTube, pero resuelta por useImageSrc como cualquier
// captura — la baja el main y la sirve por afterplay-image:. Se ve en el
// carril con el mismo lenguaje que las demás; lo único que la distingue es el
// botón de play y la píldora.
const TrailerSlide = ({
  slide,
  onClick,
}: {
  slide: Extract<CarouselSlide, { kind: 'trailer' }>;
  onClick: () => void;
}): React.JSX.Element => {
  const src = useImageSrc(slide.poster, 'screenshots');
  return (
    <button
      type="button"
      onClick={onClick}
      title={slide.name ?? 'Trailer'}
      className={`group/shot relative overflow-hidden transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_10px_28px_rgba(0,0,0,.45)] ${slideShellClass}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          // La miniatura de YouTube (hqdefault) viene en 4:3 con bandas
          // negras arriba y abajo; object-cover sobre un hueco 16:9 se las
          // come y deja solo la imagen, que es justo lo que se quiere.
          className="block h-full w-full scale-100 object-cover transition-transform duration-300 group-hover/shot:scale-107"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/[0.06]" />
      )}
      {/* Velo constante y no solo en hover, a diferencia de las capturas: por
          debajo hay una miniatura de YouTube, más clara y ruidosa que una
          captura de IGDB, y sin él ni el play ni la píldora se leen. */}
      <div className="pointer-events-none absolute inset-0 bg-black/30 transition-colors duration-200 group-hover/shot:bg-black/15" />
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        <span
          className="flex h-13 w-13 items-center justify-center rounded-full border transition-transform duration-200 group-hover/shot:scale-110"
          style={{
            background: 'rgba(10,11,10,.62)',
            borderColor: `${GREEN}88`,
            boxShadow: `0 0 22px ${GREEN}44`,
          }}
        >
          {/* ml-0.5: un triángulo centrado geométricamente se ve descentrado
              dentro de un círculo — el peso visual tira a la izquierda. */}
          <Play size={20} fill={GREEN} className="ml-0.5" style={{ color: GREEN }} />
        </span>
      </div>
      <span
        className="pointer-events-none absolute top-2.25 left-2.25 rounded-[6px] border px-1.75 py-0.75 text-[9.5px] font-bold tracking-[.08em]"
        style={{
          background: 'rgba(10,11,10,.72)',
          borderColor: `${GREEN}55`,
          color: GREEN,
        }}
      >
        TRAILER
      </span>
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

  // El tráiler primero y las capturas detrás. Un juego puede tener tráiler y
  // ninguna captura (o al revés), así que la sección existe si hay CUALQUIERA
  // de las dos cosas.
  const trailer = data?.trailer ?? null;
  const slides: CarouselSlide[] = [
    ...(trailer
      ? [
          {
            kind: 'trailer' as const,
            videoId: trailer.videoId,
            name: trailer.name,
            poster: trailerPoster(trailer.videoId),
          },
        ]
      : []),
    ...(data?.screenshots ?? []).map((url) => ({ kind: 'shot' as const, url })),
  ];

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

  if (slides.length === 0) return null;

  const trackX = -(index * (SLIDE_WIDTH + SLIDE_GAP));

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 flex items-center justify-between">
        {/* El rótulo cambia si hay tráiler: "SCREENSHOTS" sobre un carril
            cuya primera pieza es un vídeo no describe lo que hay debajo. */}
        <SectionLabel>{trailer ? 'TRAILER & SCREENSHOTS' : 'SCREENSHOTS'}</SectionLabel>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {index + 1}/{slides.length}
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
              onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))}
              disabled={index >= slides.length - 1}
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
          {slides.map((slide, i) => {
            const open = (): void => {
              setIndex(i);
              setLightboxOpen(true);
            };
            return slide.kind === 'trailer' ? (
              <TrailerSlide key={slideKey(slide)} slide={slide} onClick={open} />
            ) : (
              <ScreenshotSlide key={slideKey(slide)} url={slide.url} onClick={open} />
            );
          })}
        </div>
      </div>

      {slides.length > 1 && (
        <div className="mt-3.5 flex items-center justify-center gap-1.5">
          {slides.map((slide, i) => {
            const active = i === index;
            return (
              <button
                key={slideKey(slide)}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={
                  slide.kind === 'trailer' ? 'Go to trailer' : `Go to screenshot ${i + 1}`
                }
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
          slides={slides}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};
