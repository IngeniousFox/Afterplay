// IGDB sirve cada imagen en varios tamaños a partir de su image_id:
// https://images.igdb.com/igdb/image/upload/t_<tamaño>/<image_id>.webp
// cover_big (264×374) para el detalle/biblioteca/buscador, 1080p para heroes
// (mismo aspect ratio que screenshot_big pero a resolución completa vía el
// escalado de Cloudinary, ver igdb/api.ts). cover_small y screenshot_big
// existieron aquí sin usarse en ningún call site — quitados; si hace falta
// un tamaño más pequeño en el futuro, se puede volver a añadir entonces.
export type IgdbImageSize = 'cover_big' | '1080p';

export const igdbImageUrl = (imageId: string, size: IgdbImageSize): string =>
  `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.webp`;
