import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { RadarGame } from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// El radar de secuelas (PLAN-TO-PLAY.md §4) — entregas anunciadas de tus
// sagas que aún no tienes. La pasada corre SOLA una vez por semana en el
// main; aquí solo se leen sus descubrimientos.
//
// staleTime largo: esto cambia como mucho una vez por semana, y cuando cambia
// el main avisa por su canal (useRadarActivity, más abajo) e invalida.
export const useRadarGames = (): UseQueryResult<RadarGame[], Error> =>
  useQuery({
    queryKey: queryKeys.radar.all,
    queryFn: () => window.api.radar.list(),
    staleTime: 10 * 60 * 1000,
  });

// Descartar una entrega que no te interesa. Para siempre — hasta que la
// recuperes desde la propia fila.
export const useDismissRadarGame = (): UseMutationResult<boolean, Error, number, unknown> =>
  useInvalidatingMutation(
    (igdbId: number) => window.api.radar.dismiss(igdbId),
    [queryKeys.radar.all],
  );

// La suscripción única, montada en la raíz (Afterplay.tsx). UN toast agrupado
// por pasada — nunca uno por juego: enterarte de tres secuelas la misma
// semana es una noticia, no tres. Y la primera pasada de la vida no avisa de
// nada (el main ni siquiera emite): sembraría docenas de golpe el primer día,
// que es spam y no noticias. Mismo patrón de backfill-mudo/vivo-avisa que ya
// usan los logros.
export const useRadarActivity = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.radar.onActivity((event) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.radar.all });
      if (event.discovered <= 0) return;
      toast.success(
        event.discovered === 1
          ? 'A new entry in one of your sagas'
          : `${event.discovered} new entries in your sagas`,
        { description: "They're waiting in On the horizon, at the bottom of your plan." },
      );
    });
  }, [queryClient]);
};
