import { lazy } from 'react';

// Separados del objeto router para que estas fronteras lazy tengan HMR.
// Importar este módulo no carga todavía ninguna pantalla del modo TV.
export const BigPictureLayout = lazy(() =>
  import('./BigPictureLayout').then((module) => ({ default: module.BigPictureLayout })),
);
export const TvHome = lazy(() => import('./TvHome').then((module) => ({ default: module.TvHome })));
export const TvLibrary = lazy(() =>
  import('./TvLibrary').then((module) => ({ default: module.TvLibrary })),
);
export const TvGameDetail = lazy(() =>
  import('./TvGameDetail').then((module) => ({ default: module.TvGameDetail })),
);
export const TvJourney = lazy(() =>
  import('./TvJourney').then((module) => ({ default: module.TvJourney })),
);
