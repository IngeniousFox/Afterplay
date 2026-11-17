import { Outlet } from 'react-router-dom';
import { useLibraryReadOnly } from '../../hooks/useLibraryReadOnly';
import { useMemoryArrivalToast } from '../../hooks/useMemoryArrivalToast';
import { useSessionClosedToast } from '../../hooks/useSessionClosedToast';
import { MiddleColumn } from './MiddleColumn';
import { NavRail } from './NavRail';

// SPEC 10.6 — shell raíz: rail lateral + columna de juegos (común a las 3
// secciones, ver MiddleColumn) + el resto de la ventana para la sección
// activa, cada una dueña de su propio scroll interno.
export const RootLayout = (): React.JSX.Element => {
  // Aviso de cierre de juego. Aquí y no en Afterplay.tsx porque necesita
  // navigate (llevarte a la ficha), y eso solo existe dentro del router.
  useSessionClosedToast();
  // Aviso de "tu mes ya está contado" (AFTERPLAY-LOOP.md §3.3) — mismo
  // motivo: navega al Journey.
  useMemoryArrivalToast();
  // Puente 1.8: la biblioteca se migró a Afterplay 2 y esta app ya no escribe.
  const libraryReadOnly = useLibraryReadOnly();

  return (
    <div className="flex h-full flex-col">
      {/* Persistente y SIN botón de cerrar a propósito: mientras dure el modo
          solo lectura nada de lo que se haga aquí se guarda, y no se debe poder
          olvidar. */}
      {libraryReadOnly && (
        <div
          role="status"
          data-testid="library-read-only-banner"
          className="shrink-0 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-black"
        >
          This library has moved to Afterplay 2
        </div>
      )}
      <div className="flex min-h-0 flex-1" data-testid="desktop-layout">
        <NavRail />
        <MiddleColumn />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
};
