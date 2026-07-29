import { useEffect, useState } from 'react';

// Si la ventana se puede ver de verdad ahora mismo — no minimizada, no en la
// bandeja. El renderer sigue vivo en ambos casos (la app vigila procesos sin
// ventana a propósito), así que esto no se puede deducir de nada dentro del
// propio renderer: lo avisa el main process, que es quien conoce el estado
// real del BrowserWindow.
//
// Por defecto true: para cuando este hook monta, la ventana casi siempre ya
// se enseñó — arrancar en false bloquearía cosas como el modo ambiente un
// instante de más sin motivo.
export const useWindowVisible = (): boolean => {
  const [visible, setVisible] = useState(true);

  useEffect(() => window.api.window.onVisibleChange(setVisible), []);

  return visible;
};
