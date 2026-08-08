import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { GREEN } from '../../../lib/colors';
import type { CarouselSlide } from './carouselSlides';
import { slideKey } from './carouselSlides';

// En ms — el mismo número gobierna la clase Tailwind (duration-200) de abajo
// y el setTimeout que espera a que la animación de salida termine antes de
// desmontar de verdad. Una constante, no dos números sueltos que se puedan
// desincronizar si alguien cambia uno y se olvida del otro.
const CLOSE_DURATION_MS = 200;

// `fill-mode-forwards` en las dos ramas de cierre NO es decorativo, arregla un
// parpadeo real al cerrar: tw-animate-css compila `animate-out` con
// `animation-fill-mode: none` por defecto, así que al terminar la animación el
// elemento vuelve de golpe a opacidad 1 / escala 1. Como el desmontaje lo
// gobierna un setTimeout independiente del reloj de la animación, si esta
// acaba aunque sea un fotograma antes se repinta el lightbox entero a plena
// opacidad justo antes de desaparecer. Con forwards, el estado final se
// mantiene hasta que React lo desmonta. (Las primitivas de ui/ no lo
// necesitan: base-ui desmonta escuchando el fin de la animación, no con un
// temporizador.)
const CLOSING_ANIM = 'animate-out fill-mode-forwards';

type ScreenshotLightboxProps = {
  slides: CarouselSlide[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

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

// El reproductor. `autoplay=1` porque llegar aquí es un clic explícito en un
// botón de play: nadie abre esto sin querer ver el tráiler. Y
// youtube-nocookie.com, que es el único dominio que el CSP deja pasar (ver
// index.html) — el youtube.com normal está bloqueado a propósito.
const LightboxTrailer = ({
  videoId,
  name,
}: {
  videoId: string;
  name: string | null;
}): React.JSX.Element => (
  <iframe
    key={videoId}
    src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
    title={name ?? 'Trailer'}
    allow="autoplay; encrypted-media; fullscreen"
    allowFullScreen
    className="block aspect-video max-h-[74vh] w-full border-0 duration-200 animate-in fade-in-0"
  />
);

const Thumb = ({
  slide,
  active,
  onClick,
}: {
  slide: CarouselSlide;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element | null => {
  const src = useImageSrc(slide.kind === 'trailer' ? slide.poster : slide.url, 'screenshots');
  // El propio DOM node, para poder llevarlo a la vista cuando se vuelve el
  // activo (ver el scrollIntoView de abajo, en ScreenshotLightbox) — clicar
  // una miniatura ya visible no lo necesita, pero cambiar de slide con las
  // flechas SÍ: sin esto, en un juego con 26 capturas la miniatura activa
  // podía quedar fuera de la tira, invisible.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  if (!src) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="relative h-12.5 w-21 flex-none cursor-pointer overflow-hidden rounded-lg border-2 transition-[opacity,box-shadow] duration-150 hover:opacity-100"
      style={{
        borderColor: active ? GREEN : 'transparent',
        opacity: active ? 1 : 0.5,
        boxShadow: active ? `0 0 12px ${GREEN}4d` : 'none',
      }}
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
      {/* Sin esto, la miniatura del tráiler es indistinguible de una captura
          más en la tira de abajo. */}
      {slide.kind === 'trailer' && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45">
          <Play size={13} fill="#fff" className="text-white" />
        </span>
      )}
    </button>
  );
};

// Lightbox a pantalla completa (SPEC 10.7 / prototipo) — flechas laterales,
// miniaturas abajo, contador. Cierra al clicar el fondo o la X, con una
// animación de salida (fade del fondo entero + zoom-out de la imagen) antes
// de desmontar de verdad — antes ni siquiera tenía entrada animada, ambas
// van a la vez.
export const ScreenshotLightbox = ({
  slides,
  index,
  onIndexChange,
  onClose,
}: ScreenshotLightboxProps): React.JSX.Element => {
  const current = slides[index];
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
        closing ? `${CLOSING_ANIM} fade-out-0` : 'animate-in fade-in-0'
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
          onIndexChange(Math.min(slides.length - 1, index + 1));
        }}
        disabled={index >= slides.length - 1}
        className="absolute top-1/2 right-5.5 z-10 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-[rgba(20,22,21,.7)] transition-colors hover:border-white/28 hover:bg-white/10 disabled:opacity-30 disabled:hover:border-white/14 disabled:hover:bg-[rgba(20,22,21,.7)]"
      >
        <ChevronRight size={24} />
      </button>

      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-275 overflow-hidden rounded-[14px] border border-white/14 shadow-[0_30px_90px_rgba(0,0,0,.6)] duration-200 ${
          closing ? `${CLOSING_ANIM} zoom-out-95` : 'animate-in zoom-in-95'
        }`}
      >
        {current?.kind === 'trailer' ? (
          <LightboxTrailer videoId={current.videoId} name={current.name} />
        ) : (
          current && <LightboxImage url={current.url} />
        )}
      </div>

      {/* Ancho tope + scroll horizontal — SIN esto, la tira crecía tanto como
          hicieran falta miniaturas y con una ficha bien cargada (26 capturas,
          medido en vivo) se salía por los dos lados de la pantalla, con las
          últimas miniaturas invisibles fuera del viewport. max-w-275 es el
          mismo ancho que la imagen grande de arriba, así que la tira nunca
          es más ancha que lo que tiene encima. El padding lateral (px-1) da
          hueco a que el borde+sombra del activo no se recorte contra el
          borde del scroll; py-1 hace lo mismo en vertical. */}
      <div
        onClick={(event) => event.stopPropagation()}
        className="mt-4.5 flex w-full max-w-275 items-center gap-2.5 overflow-x-auto px-1 py-1"
      >
        {slides.map((slide, i) => (
          <Thumb
            key={slideKey(slide)}
            slide={slide}
            active={i === index}
            onClick={() => onIndexChange(i)}
          />
        ))}
      </div>
      <div className="mt-3 text-[12.5px] text-muted-foreground tabular-nums">
        {index + 1} / {slides.length}
      </div>
    </div>
  );
};
