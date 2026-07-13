// IGDB sirve cada imagen en varios tamaños a partir de su image_id:
// https://images.igdb.com/igdb/image/upload/t_<tamaño>/<image_id>.webp
// cover_small (90×128) para grids de resultados, cover_big (264×374) para el
// detalle/biblioteca, 1080p para heroes, screenshot_big (889×500) para shots.
export type IgdbImageSize = 'cover_small' | 'cover_big' | 'screenshot_big' | '1080p';

export const igdbImageUrl = (imageId: string, size: IgdbImageSize): string =>
  `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.webp`;
