// Forma recortada de SGDBImage — solo lo que le hace falta a un picker de
// candidatas (SPEC 4.6): la imagen final, su miniatura, el estilo para poder
// filtrar (blurred/material/white-logo...) y el score de la comunidad para
// ordenar. Nada de autor/nsfw/mime/tags, que no se van a mostrar.
export type SgdbImageCandidate = {
  url: string;
  thumb: string;
  style: string | null;
  score: number;
};

export type SgdbImages = {
  grids: SgdbImageCandidate[];
  heroes: SgdbImageCandidate[];
  logos: SgdbImageCandidate[];
};

// El handler acepta un id ya resuelto (si ya se buscó antes) o título+año
// para resolverlo aquí mismo — así no hace falta un roundtrip de IPC aparte
// solo para el id en el caso más común (justo después de elegir en IGDB).
export type GetSgdbImagesInput = { title: string; releaseYear: number | null } | { sgdbId: number };
