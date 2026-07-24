import { useState } from 'react';
import type { Year } from './YearPicker';

type PagedYear = {
  page: number;
  // Sentido de la última navegación (1 = adelante, -1 = atrás) — decide de
  // qué lado entra la animación de la página nueva, para que se note hacia
  // dónde te mueves y no sea un fade plano.
  direction: 1 | -1;
  goToPage: (next: number) => void;
};

// Paginación con sentido de dirección + reinicio automático al cambiar de
// año — compartido por CompletedGallery y HltbCompareList, que repetían
// exactamente este mismo estado. El caller sigue calculando su propio
// totalPages/currentPage (acotado a los datos que tenga, no algo que este
// hook pueda saber) y solo le pasa `page` para el cálculo.
export const usePagedYear = (year: Year): PagedYear => {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  // Cambiar de año reinicia la página — ajuste durante el render (mismo
  // patrón wasOpen de ChangeCoverModal/useResetOnOpen), sin useEffect.
  const [prevYear, setPrevYear] = useState<Year>(year);
  if (prevYear !== year) {
    setPrevYear(year);
    setPage(0);
  }

  const goToPage = (next: number): void => {
    setDirection(next > page ? 1 : -1);
    setPage(next);
  };

  return { page, direction, goToPage };
};
