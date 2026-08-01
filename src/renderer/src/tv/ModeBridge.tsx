import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useBigPicture } from '../hooks/useBigPicture';

// El puente entre el estado de Big Picture (que vive en el MAIN) y el router
// (que vive aquí). Es la única pieza montada SIEMPRE dentro del router, en
// los dos árboles (escritorio y /tv) — ver router.tsx: sin ella, nadie
// escucharía el F11 estando en escritorio ni sabría a qué pantalla volver al
// salir del modo.
//
// La ruta de escritorio se recuerda al entrar y se restaura al salir
// (BIG-PICTURE.md §3): F11 en mitad de una ficha te devuelve a ESA ficha,
// no a la biblioteca genérica.
export const ModeBridge = (): React.JSX.Element => {
  const active = useBigPicture();
  const location = useLocation();
  const navigate = useNavigate();
  const desktopRouteRef = useRef('/games');

  const inTv = location.pathname.startsWith('/tv');

  // Memoria de la última ruta de ESCRITORIO pisada — se apunta en efecto (y
  // no durante el render) para no escribir refs mientras React pinta.
  useEffect(() => {
    if (!inTv) desktopRouteRef.current = location.pathname + location.search;
  }, [inTv, location.pathname, location.search]);

  useEffect(() => {
    if (active && !inTv) navigate('/tv');
    else if (!active && inTv) navigate(desktopRouteRef.current || '/games');
  }, [active, inTv, navigate]);

  return <Outlet />;
};
