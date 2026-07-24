import { useState } from 'react';

// "Adjusting state when a prop changes" (react.dev) — al reabrir un modal
// hay que volver a partir de los valores actuales de fuera, con useState en
// vez de un efecto para no disparar un render en cascada. Compartido por
// ChangeCoverModal y EditNotesModal, que repetían el mismo wasOpen/setWasOpen
// a mano con solo el reset propio cambiando.
export const useResetOnOpen = (open: boolean, resetFn: () => void): void => {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) resetFn();
  }
};
