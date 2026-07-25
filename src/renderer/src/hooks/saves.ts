import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  RestoreRequestInput,
  RestoreResult,
  SavesActivityEvent,
  SavesBackupResult,
  SavesGameState,
  SavesScanEntry,
  SavesStatus,
} from '../../../shared/types';
import { queryKeys } from './queryKeys';
import { useInvalidatingMutation } from './useInvalidatingMutation';

// Partidas guardadas (PARTIDAS-GUARDADAS.md). Regla de oro que se nota en la
// forma de estos hooks: NADA se restaura solo (§10bis.0) y nada se comprueba
// de fondo (§10bis.4) — no hay refetch por intervalo, ni al enfocar la
// ventana, ni al arrancar. El estado se pide cuando el usuario abre la
// sección Saves de un juego, y punto.

export const useSavesStatus = (): UseQueryResult<SavesStatus, Error> =>
  useQuery({
    queryKey: queryKeys.saves.status,
    queryFn: () => window.api.saves.getStatus(),
    staleTime: Infinity,
  });

// El estado de un juego mezcla nube (índice ya sincronizado, cero red) y
// local (un --preview que no escribe nada). `enabled` deja no pedirlo hasta
// que la sección se abre de verdad.
export const useGameSaves = (
  gameId: number,
  enabled: boolean,
): UseQueryResult<SavesGameState | null, Error> =>
  useQuery({
    queryKey: queryKeys.saves.game(gameId),
    queryFn: () => window.api.saves.getGameState(gameId),
    enabled,
    // Corto y no Infinity: el estado local cambia por debajo (el watcher
    // sube un backup al cerrar sesión) y lo que se enseña aquí es una foto.
    staleTime: 30_000,
  });

// Escaneo completo: caro (segundos) y bajo demanda. Sin caché entre
// aperturas — enseñar resultados de hace una semana como si fueran de ahora
// sería peor que no enseñar nada.
//
// Sí invalida al terminar: el escaneo GUARDA el emparejamiento de los juegos
// que casan (ver el handler), así que las fichas abiertas dejarían de decir
// la verdad.
export const useScanSaves = (): UseMutationResult<SavesScanEntry[], Error, void, unknown> =>
  useInvalidatingMutation(
    () => window.api.saves.scanLibrary(),
    [queryKeys.games.all, queryKeys.saves.all],
  );

export const useSetSaveBackupEnabled = (): UseMutationResult<
  boolean,
  Error,
  { gameId: number; enabled: boolean; ludusaviName?: string },
  unknown
> =>
  useInvalidatingMutation(
    ({
      gameId,
      enabled,
      ludusaviName,
    }: {
      gameId: number;
      enabled: boolean;
      ludusaviName?: string;
    }) => window.api.saves.setEnabled(gameId, enabled, ludusaviName),
    // games.all porque la columna vive en `games`; saves.all porque la
    // sección enseña el estado combinado.
    [queryKeys.games.all, queryKeys.saves.all],
  );

export const useDetectSaves = (): UseMutationResult<string | null, Error, number, unknown> =>
  useInvalidatingMutation(
    (gameId: number) => window.api.saves.detect(gameId),
    [queryKeys.games.all, queryKeys.saves.all],
  );

// Añadir/quitar carpetas propias. En un juego ya detectado se SUMAN a lo que
// ludusavi sabe (incluido su registro), no lo sustituyen.
export const useAddSaveFolder = (): UseMutationResult<
  string | null,
  Error,
  { gameId: number; folder: string },
  unknown
> =>
  useInvalidatingMutation(
    ({ gameId, folder }: { gameId: number; folder: string }) =>
      window.api.saves.addFolder(gameId, folder),
    [queryKeys.games.all, queryKeys.saves.all],
  );

export const useRemoveSaveFolder = (): UseMutationResult<
  boolean,
  Error,
  { gameId: number; folder: string },
  unknown
> =>
  useInvalidatingMutation(
    ({ gameId, folder }: { gameId: number; folder: string }) =>
      window.api.saves.removeFolder(gameId, folder),
    [queryKeys.games.all, queryKeys.saves.all],
  );

export const useBackupNow = (): UseMutationResult<
  SavesBackupResult | null,
  Error,
  number,
  unknown
> =>
  useInvalidatingMutation(
    (gameId: number) => window.api.saves.backupNow(gameId),
    [queryKeys.saves.all],
  );

// Un preview NO cambia nada, así que invalidar tras él solo provocaría un
// refetch inútil justo cuando el usuario está mirando el diálogo. La
// invalidación la hace quien confirma (ver SavesSection).
export const useRestoreSave = (): UseMutationResult<
  RestoreResult,
  Error,
  RestoreRequestInput,
  unknown
> =>
  useInvalidatingMutation((request: RestoreRequestInput) => window.api.saves.restore(request), []);

export const useSetRestoreTarget = (): UseMutationResult<
  void,
  Error,
  { gameId: number; target: string | null },
  unknown
> =>
  useInvalidatingMutation(
    ({ gameId, target }: { gameId: number; target: string | null }) =>
      window.api.saves.setRestoreTarget(gameId, target),
    [queryKeys.saves.all],
  );

// Copia automática en marcha, para el juego que se esté mirando. Dos cosas a
// la vez y por eso vive en un solo hook: enseña la fase en la card y, cuando
// termina, invalida su estado — así la lista de versiones se actualiza sola
// sin cambiar de pantalla ni recargar nada.
//
// Es la ÚNICA suscripción viva de todo el módulo, y solo mientras hay una
// ficha abierta: sigue sin haber comprobaciones de fondo (§10bis.4). Aquí no
// se sondea nada, es el main quien avisa cuando de verdad pasa algo.
const DONE_FLASH_MS = 5000;

export const useSaveBackupActivity = (gameId: number): SavesActivityEvent | null => {
  const queryClient = useQueryClient();
  // El evento ENTERO, no solo la fase: un "no se pudo hacer la copia" sin
  // decir por qué no sirve para nada — ni al usuario ni para diagnosticarlo
  // después.
  const [activity, setActivity] = useState<SavesActivityEvent | null>(null);
  // Saltar de un juego a otro no puede heredar el aviso del anterior. Se
  // limpia AJUSTANDO ESTADO DURANTE EL RENDER (el patrón de react.dev que
  // usa el resto de la app), no dentro del efecto: hacerlo en el efecto
  // pinta primero un fotograma con el aviso del juego equivocado.
  const [seenGameId, setSeenGameId] = useState(gameId);
  if (seenGameId !== gameId) {
    setSeenGameId(gameId);
    setActivity(null);
  }

  useEffect(() => {
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = window.api.saves.onActivity((event) => {
      if (event.gameId !== gameId) return;
      setActivity(event);

      if (event.phase === 'done') {
        queryClient.invalidateQueries({ queryKey: queryKeys.saves.game(gameId) });
        // El "hecho" se retira solo: es un acuse de recibo, no un estado.
        // Dejarlo fijo obligaría a cerrar la ficha para quitarlo de en medio.
        flashTimer = setTimeout(() => setActivity(null), DONE_FLASH_MS);
      }
    });

    return () => {
      clearTimeout(flashTimer);
      unsubscribe();
    };
  }, [gameId, queryClient]);

  return activity;
};

export const useDeleteSaveBackup = (): UseMutationResult<
  boolean,
  Error,
  { backupId: number; gameId: number },
  unknown
> =>
  useInvalidatingMutation(
    ({ backupId, gameId }: { backupId: number; gameId: number }) =>
      window.api.saves.deleteBackup(backupId, gameId),
    [queryKeys.saves.all],
  );
