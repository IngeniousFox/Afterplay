import { existsSync } from 'fs';
import { shell } from 'electron';
import type { LaunchExecutableResult } from '../../shared/types';

// Compartido por "Play" (games:launchExecutable) y "abrir carpeta"
// (games:openInstallDirectory) — el mismo comprobar-existir + shell.openPath
// sirve igual de bien para un .exe que para un directorio (openPath abre
// carpetas en el explorador del sistema en vez de intentar "ejecutarlas"),
// así que ambos botones reusan exactamente este resultado en vez de repetir
// el guard dos veces.
export const openPathResult = async (path: string): Promise<LaunchExecutableResult> => {
  if (!existsSync(path)) {
    return { ok: false, reason: 'missing' };
  }
  const error = await shell.openPath(path);
  if (error) {
    return { ok: false, reason: 'error', message: error };
  }
  return { ok: true };
};
