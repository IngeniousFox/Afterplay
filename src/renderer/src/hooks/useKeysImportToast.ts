import { useEffect } from 'react';
import { toast } from 'sonner';

// EL AVISO DEL CAMINO AUTOMATICO DE LAS CLAVES.
//
// Dejas afterplay-keys.json en la carpeta de datos, abres la app y ella lo
// importa sola (ver importDroppedKeysFile en main/config/credentials.ts).
// Eso pasa entero en el arranque, antes de que exista esta ventana, y el
// fichero desaparece después (se renombra a .imported.bak) — sin este aviso
// el gesto es completamente mudo: ni sabes si entró, ni si el fichero estaba
// mal escrito.
//
// No se pregunta al montar, sino cuando la ventana está DE VERDAD en
// pantalla: el splash la retiene hasta que la biblioteca tiene contenido
// (useStartupContentSignal), así que un toast disparado en el montaje se
// gastaría detrás del splash. Y si la app arrancó a la bandeja (login item),
// la noticia espera en el main hasta que abras la ventana. El main la
// entrega UNA vez, así que preguntar de más no puede duplicar el aviso.
const TOAST_DURATION_MS = 10_000;

export const useKeysImportToast = (): void => {
  useEffect(() => {
    let announced = false;

    const announce = async (): Promise<void> => {
      if (announced) return;
      announced = true;
      const result = await window.api.settings.getStartupKeysImport();
      if (!result) return;

      if (result.ok) {
        toast.success(`Imported ${result.imported} API ${result.imported === 1 ? 'key' : 'keys'}`, {
          description: 'Read from the keys file you left in the app folder.',
          duration: TOAST_DURATION_MS,
        });
      } else {
        // El fichero sigue donde lo dejaste: el main no lo retira cuando
        // falla, justo para que se pueda corregir y reintentar.
        toast.error("Couldn't import the keys file", {
          description: result.message,
          duration: TOAST_DURATION_MS,
        });
      }
    };

    const unsubscribe = window.api.window.onVisibleChange((visible) => {
      if (visible) void announce();
    });
    // Y la consulta en frío, por si la ventana ya estaba visible antes de que
    // este hook se montara — el aviso de cambio solo sale cuando algo CAMBIA
    // (misma lección que useWindowVisible).
    void window.api.window.isVisible().then((visible) => {
      if (visible) void announce();
    });

    return unsubscribe;
  }, []);
};
