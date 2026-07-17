import type { UseMutationResult } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';

// Botón "Back up now" de Ajustes — no invalida ninguna query, no cambia
// nada visible en la app, solo escribe un fichero fuera de ella.
export const useCreateManualBackup = (): UseMutationResult<string, Error, string, unknown> =>
  useMutation({
    mutationFn: (directory: string) => window.api.backup.createManual(directory),
  });
