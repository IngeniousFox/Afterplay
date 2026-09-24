import { lazy } from 'react';

// Este módulo solo exporta componentes para conservar Fast Refresh. Los
// árboles siguen siendo dinámicos: cada ventana descarga solo el que usa.
export const Afterplay = lazy(() => import('./Afterplay'));
export const OverlayHud = lazy(() =>
  import('./overlay/OverlayHud').then((module) => ({ default: module.OverlayHud })),
);
