import { useEffect, useRef, useState } from 'react';

// EL ATERRIZAJE EN UNA FILA, CON PARPADEO DORADO.
//
// La coreografía es siempre la misma: primero la fila se lleva a la vista y
// DESPUÉS empieza el destello — un parpadeo fuera de pantalla se gasta sin que
// nadie lo vea, y al llegar desde otra pantalla la ficha se abre arriba del
// todo. Lo usan el historial de sesiones (aviso de cierre) y la sección de
// logros (pulsar un trofeo de una sesión).
//
// LA CICATRIZ. Esto vivía copiado en las dos filas y las dos arrastraban el
// mismo fallo: `flashing` subía a true y NO volvía a bajar nunca. Como el
// navegador solo arranca una animación cuando la clase APARECE, pedir el mismo
// logro dos veces seguidas no parpadeaba la segunda vez (la clase seguía
// puesta desde la primera) — y solo "se arreglaba" pasando por otro logro,
// porque esa era otra fila con su propio estado a cero. De ahí las dos piezas
// de abajo: el rearme en dos fotogramas y la retirada de la clase al acabar.

// La clase y los fotogramas comparten nombre en main.css: 1.1s x 2.
const FLASH_CLASS = 'afterplay-flash-gold';

// Margen para que el desplazamiento haya llegado (o casi) antes del primer
// pulso; si no, el destello se gasta mientras la fila todavía entra en pantalla.
const SCROLL_SETTLE_MS = 450;

type FlashLanding = {
  rowRef: React.RefObject<HTMLDivElement | null>;
  // Se concatena en el className de la fila.
  flashClass: string;
  // Se pasa tal cual al onAnimationEnd de la fila.
  onAnimationEnd: (event: React.AnimationEvent<HTMLDivElement>) => void;
};

// `consume` vacía la petición pendiente (consumeSessionFlash /
// consumeAchievementFlash): se espera estable, como lo son las dos.
export const useFlashLanding = (flash: boolean, consume: () => void): FlashLanding => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!flash) return;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    let frame = 0;
    const timer = setTimeout(() => {
      // Dos fotogramas —bajar la clase, pintar, subirla— y no un simple
      // "ponerla": una fila que acaba de parpadear ya la tiene puesta, y
      // volver a ponerla no relanza nada.
      setFlashing(false);
      frame = requestAnimationFrame(() => {
        setFlashing(true);
        // Consumir CUANDO EL DESTELLO YA HA ARRANCADO, ni antes ni fuera: al
        // consumir, `flash` vuelve a false y eso limpia este efecto — hacerlo
        // en el temporizador mataba el fotograma de aquí (cancelAnimationFrame
        // de la limpieza) y no parpadeaba nada. El primer test de aterrizaje
        // nació cazando justo esto.
        consume();
      });
    }, SCROLL_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [flash, consume]);

  return {
    rowRef,
    flashClass: flashing ? FLASH_CLASS : '',
    onAnimationEnd: (event) => {
      // Solo la del destello: los eventos de animación BURBUJEAN y una fila
      // puede llevar hijos animados.
      if (event.animationName !== FLASH_CLASS) return;
      setFlashing(false);
    },
  };
};
