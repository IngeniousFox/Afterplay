// ADÓNDE VUELVES al salir de una ficha (modo TV): las pantallas se
// desmontan al navegar (key por ruta en el layout), así que sin esto abrir
// un juego desde una búsqueda te devolvía a una Library recién nacida —
// filtro en All, query vacía, scroll arriba. Cada pantalla GUARDA su sitio
// en el momento de abrir la ficha (un handler, no un unmount — solo el
// viaje a la ficha merece billete de vuelta) y lo RECUERDA una única vez al
// remontar: el recall es una lectura pura (segura con el doble render de
// StrictMode) y el forget vive en un efecto de montaje, así que la
// siguiente visita "de cero" nace limpia.
//
// Nivel de módulo a propósito: el modo TV es una sola instancia y esto es
// estado efímero de navegación, no datos — no toca stores ni DB. Al salir
// del Big Picture, el layout llama a forgetAllTvMemory(): las memorias son
// de la sesión de sofá, no del proceso.

export type LibrarySnapshot = {
  filterIndex: number;
  query: string;
  scrollTop: number;
  focusGameId: number;
};

export type HomeSnapshot = {
  scrollTop: number;
  // null = se abrió desde el hero (Details): se restaura el scroll y el
  // foco vuelve al Play de siempre.
  focusGameId: number | null;
};

let library: LibrarySnapshot | null = null;
let home: HomeSnapshot | null = null;
let journeyPage: number | null = null;

export const rememberLibrary = (snapshot: LibrarySnapshot): void => {
  library = snapshot;
};
export const recallLibrary = (): LibrarySnapshot | null => library;
export const forgetLibrary = (): void => {
  library = null;
};

export const rememberHome = (snapshot: HomeSnapshot): void => {
  home = snapshot;
};
export const recallHome = (): HomeSnapshot | null => home;
export const forgetHome = (): void => {
  home = null;
};

export const rememberJourneyPage = (page: number): void => {
  journeyPage = page;
};
export const recallJourneyPage = (): number | null => journeyPage;
export const forgetJourneyPage = (): void => {
  journeyPage = null;
};

export const forgetAllTvMemory = (): void => {
  forgetLibrary();
  forgetHome();
  forgetJourneyPage();
};
