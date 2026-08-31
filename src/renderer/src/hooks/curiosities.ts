import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  CuriositiesStatus,
  CuriosityActivityEvent,
  CuriositySummary,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';

// Curiosidades de juego: se generan UNA vez por juego en el main (ver
// main/curiosities) y aquí solo se leen. staleTime Infinity porque solo
// cambian cuando el main avisa por 'curiosities:activity' — y ese aviso ya
// invalida (useCuriositiesActivitySync), no hace falta refetchear por
// mount/focus.
export const useCuriosities = (): UseQueryResult<CuriositySummary[], Error> =>
  useQuery({
    queryKey: queryKeys.curiosities.all,
    queryFn: () => window.api.curiosities.getAll(),
    staleTime: Infinity,
  });

export const useCuriositiesStatus = (): UseQueryResult<CuriositiesStatus, Error> =>
  useQuery({
    queryKey: queryKeys.curiosities.status,
    queryFn: () => window.api.curiosities.getStatus(),
    staleTime: Infinity,
  });

export const useRunCuriositiesBackfill = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation({ mutationFn: () => window.api.curiosities.runBackfill() });

type CuriositiesProgress = Extract<CuriosityActivityEvent, { kind: 'progress' }>;

// EL refresco de las queries de curiosidades, montado UNA vez en la raíz de la
// app (Afterplay.tsx): la generación ocurre de fondo —alta de un juego,
// backfill— estés en la pantalla que estés, así que el aviso tiene que
// escucharse fuera de Ajustes para que el modo ambiente vea las nuevas.
//
// SIN estado de React a propósito, partido del hook de abajo por lo mismo que
// la familia de logros (useAchievementsActivitySync): un backfill emite un
// evento por juego —cientos en una biblioteca de verdad— y guardar progreso
// AQUÍ metía un setState en el componente raíz con cada uno, o sea volver a
// ejecutar el cuerpo de Afterplay entero cientos de veces por una barra que
// solo pinta la tarjeta de Ajustes. (El árbol de debajo se salva porque el
// compilador de React memoiza su JSX, pero el trabajo de más no.)
//
// Y montarlo en los dos sitios costaba además una invalidación DOBLE por
// evento con Ajustes abierto: el segundo invalidateQueries cancela el refetch
// que acaba de lanzar el primero y lo relanza — dos viajes de IPC para la
// misma respuesta.
export const useCuriositiesActivitySync = (): void => {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      window.api.curiosities.onActivity(() => {
        // Invalidar el prefijo entero cubre también el status (queryKeys).
        queryClient.invalidateQueries({ queryKey: queryKeys.curiosities.all });
      }),
    [queryClient],
  );
};

// El progreso en vivo, para quien lo quiera pintar (la tarjeta de Ajustes).
// Solo estado: la invalidación la lleva el hook de arriba desde la raíz.
export const useCuriositiesActivity = (): CuriositiesProgress | null => {
  const [progress, setProgress] = useState<CuriositiesProgress | null>(null);

  useEffect(() => {
    return window.api.curiosities.onActivity((event) => {
      if (event.kind === 'progress') setProgress(event);
    });
  }, []);

  return progress;
};
