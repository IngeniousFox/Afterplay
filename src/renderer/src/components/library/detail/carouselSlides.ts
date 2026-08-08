// Las piezas del carril de material audiovisual de la ficha, compartidas por
// el carrusel y el lightbox. En su propio archivo y no junto a uno de los dos
// componentes: mezclar componentes y funciones sueltas en el mismo módulo
// rompe el fast refresh (react-refresh/only-export-components), y aquí
// además ninguno de los dos es el dueño natural de esto.

// Lo que puede haber en el carril: el tráiler (siempre el primero, si lo hay)
// y las capturas.
export type CarouselSlide =
  | { kind: 'trailer'; videoId: string; name: string | null; poster: string }
  | { kind: 'shot'; url: string };

// La miniatura del tráiler sale de YouTube, pero NO se pide desde el
// renderer: pasa por useImageSrc como cualquier captura, así que la descarga
// el main y se sirve por afterplay-image:. Dos ventajas de un tiro — el CSP
// de img-src no hay que tocarlo, y la miniatura queda cacheada en disco.
export const trailerPoster = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export const slideKey = (slide: CarouselSlide): string =>
  slide.kind === 'trailer' ? `trailer:${slide.videoId}` : slide.url;
