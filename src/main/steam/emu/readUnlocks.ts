import type { EmuUnlock } from './parsers';
import { findEmuFilesForGame } from './locations';

// Los desbloqueos de emulador de UN juego, fundidos de todas las fuentes que
// existan en este PC (un juego puede tener fichero de más de un crack si se
// reinstaló con otro repack). Regla de fusión: si el mismo logro aparece en
// varios, gana la fecha más TEMPRANA con fecha real — la misma regla que usa
// la lectura de la ficha entre fuentes steam/emu (getGameAchievements).
export const readEmuUnlocksForGame = (
  appId: number,
  executablePath: string | null,
): { unlocks: EmuUnlock[]; emus: string[] } => {
  const files = findEmuFilesForGame(appId, executablePath);
  const merged = new Map<string, EmuUnlock>();
  const emus = new Set<string>();

  for (const file of files) {
    let parsed: EmuUnlock[];
    try {
      parsed = file.parse(file.filePath);
    } catch (error) {
      // Un fichero corrupto o a medio escribir (el juego puede estar
      // escribiéndolo AHORA) no tumba la lectura de los demás.
      console.warn(`[steam] no se pudo leer ${file.filePath} (sigo sin el):`, error);
      continue;
    }
    if (parsed.length > 0) emus.add(file.emu);

    for (const unlock of parsed) {
      const existing = merged.get(unlock.apiName);
      if (!existing) {
        merged.set(unlock.apiName, unlock);
        continue;
      }
      // Preferir siempre una fecha real a un null, y entre fechas, la primera.
      if (
        unlock.unlockedAt &&
        (!existing.unlockedAt || unlock.unlockedAt.getTime() < existing.unlockedAt.getTime())
      ) {
        merged.set(unlock.apiName, unlock);
      }
    }
  }

  return { unlocks: [...merged.values()], emus: [...emus] };
};
