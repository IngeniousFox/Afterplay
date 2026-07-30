import { Outlet } from 'react-router-dom';
import { useSessionClosedToast } from '../../hooks/useSessionClosedToast';
import { SessionEpilogueDialogHost } from '../sessions/SessionEpilogueDialog';
import { MiddleColumn } from './MiddleColumn';
import { NavRail } from './NavRail';

// SPEC 10.6 — shell raíz: rail lateral + columna de juegos (común a las 3
// secciones, ver MiddleColumn) + el resto de la ventana para la sección
// activa, cada una dueña de su propio scroll interno.
export const RootLayout = (): React.JSX.Element => {
  // Aviso de cierre de juego. Aquí y no en Afterplay.tsx porque necesita
  // navigate (llevarte a la ficha), y eso solo existe dentro del router.
  useSessionClosedToast();

  return (
    <div className="flex h-full">
      <NavRail />
      <MiddleColumn />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      <SessionEpilogueDialogHost />
    </div>
  );
};
