import { useEffect, useState } from 'react';

// ¿Esta biblioteca se migró a Afterplay 2? (puente 1.8, AFTERPLAY-2.0 §19.3.)
// El main decide (fila `cutover` en app_meta); aquí solo se refleja. Misma
// receta que useWindowVisible: se pide el valor al montar Y se escucha, y si ya
// habló un evento la respuesta de la consulta se descarta por más vieja.
export const useLibraryReadOnly = (): boolean => {
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let eventSeen = false;
    const unsubscribe = window.api.window.onLibraryReadOnlyChange((value) => {
      eventSeen = true;
      setReadOnly(value);
    });
    void window.api.window.isLibraryReadOnly().then((value) => {
      if (!eventSeen) setReadOnly(value);
    });
    return unsubscribe;
  }, []);

  return readOnly;
};
