import { useEffect, useState } from 'react';

// ¿Está la página SIENDO PINTADA ahora mismo? Es la señal de visibilidad del
// propio Chromium (document.visibilityState), y en Windows cubre un caso que
// el canal del main (window:visible-change) no ve: la ventana TOTALMENTE
// TAPADA por otras. Chromium trae detección nativa de oclusión — una ventana
// completamente cubierta pasa a 'hidden' aunque no esté ni minimizada ni
// oculta, que es exactamente "la app lleva toda la tarde detrás del
// navegador". Minimizada y en bandeja también reportan 'hidden', así que
// esta señal sola cubre las tres formas de "nadie puede verla".
//
// Complementa al canal del main, no lo sustituye: aquél responde en frío al
// arrancar (una app nacida en la bandeja no pasa por ningún evento) y no
// depende de que la detección de oclusión esté activa.
export const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const onChange = (): void => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
};
