// Pliega acentos/diacríticos (é, ñ, ü...) a su letra base y quita la
// puntuación, para que buscar "pokemon" encuentre "Pokémon" y "portal 2"
// encuentre "Portal: 2" — sin esto, el usuario tenía que teclear la tilde
// exacta y el separador exacto del título, y ninguno de los dos es algo que
// se recuerde letra a letra. normalize('NFD') separa cada letra acentuada en
// base + marca combinante, y el replace se queda solo con la base; es la
// forma estándar de deshacer un acento sin mapear carácter a carácter (é->e,
// ñ->n, ü->u...). Apóstrofos fuera del todo (así "baldurs gate" encuentra
// "Baldur's Gate" sin más), separadores (: - – — /) a espacio (así "half
// life" encuentra "Half-Life"), el resto de puntuación también a espacio.
// Los números se dejan tal cual: en un título SÍ distinguen ("Fallout 4" de
// "Fallout"), a diferencia de la puntuación. Mismo problema, y misma forma de
// resolverlo, que normalizeTitle en main/lib/titleMatch.ts — pero un fichero
// aparte y no compartido: ese vive en el proceso main y no hace folding de
// acentos (una decisión ya afinada para el matching contra HLTB/SteamGridDB
// que no toca esta petición), así que reescribirlo aquí es más simple y más
// seguro que empezar a cruzar esa frontera por una función de seis líneas.
const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[:\-–—/]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Filtro de texto compartido por las columnas de nav, el modal de asignar
// sesión y la biblioteca de TV.
export const filterByTitle = <T extends { title: string }>(items: T[], search: string): T[] => {
  const query = normalizeForSearch(search);
  return query ? items.filter((item) => normalizeForSearch(item.title).includes(query)) : items;
};
