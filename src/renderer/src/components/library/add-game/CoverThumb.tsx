import type { ImageCacheType } from '../../../../../shared/types';
import { useImageSrc } from '../../../hooks/useImageSrc';

type CoverThumbProps = {
  url: string | null;
  alt: string;
  className: string;
  // 'covers' por defecto (carátulas) — el CoverPicker (SPEC 4.6) también lo
  // reutiliza con 'heroes' para las candidatas de hero, mismo componente,
  // solo cambia a qué caché local apunta.
  type?: ImageCacheType;
};

// Las carátulas de IGDB son URLs remotas (https://images.igdb.com/...) — el
// CSP de la app solo permite 'self' | data: | afterplay-image:, así que un
// <img src> directo a esa URL siempre sale roto. Hace falta pasarlas por
// useImageSrc (cachea local + sirve por el protocolo propio), y al ser un
// hook necesita su propio componente por cada carátula de la lista.
export const CoverThumb = ({
  url,
  alt,
  className,
  type = 'covers',
}: CoverThumbProps): React.JSX.Element | null => {
  const src = useImageSrc(url, type);
  if (!src) return null;
  return <img src={src} loading="lazy" alt={alt} className={className} />;
};
