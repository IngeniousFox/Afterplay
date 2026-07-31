import { Outlet } from 'react-router-dom';
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

  return (
    <div className="flex h-full">
      <NavRail />
      <MiddleColumn />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
};
