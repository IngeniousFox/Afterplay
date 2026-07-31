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
//
// Pero el valor de verdad se PIDE al montar, no solo se escucha: los avisos
// del main salen únicamente cuando la visibilidad CAMBIA, y una app que
// arranca directa a la bandeja (login item) nace oculta sin disparar ningún
// evento — el hook se quedaba en su "true" por defecto y el modo ambiente
// se encendía con la app metida en el tray.
export const useWindowVisible = (): boolean => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // La respuesta a la consulta viaja por otro canal que los avisos, así
    // que podría llegar DESPUÉS de un cambio real ocurrido entre medias y
    // pisarlo con una foto vieja. Si ya habló un evento, la foto se descarta:
    // el evento siempre es más reciente que el estado que retrató la consulta.
    let eventSeen = false;
    const unsubscribe = window.api.window.onVisibleChange((value) => {
      eventSeen = true;
      setVisible(value);
    });
    void window.api.window.isVisible().then((value) => {
      if (!eventSeen) setVisible(value);
    });
    return unsubscribe;
  }, []);

  return visible;
};
