import { useSyncExternalStore } from 'react';

// Si el navegador cree que hay red (`navigator.onLine` y los eventos
// online/offline). Es solo un aviso: `onLine` a true no garantiza que el hub
// conteste, y las pantallas siguen diciendo sus propios errores.
const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
