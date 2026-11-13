import type { AchievementSource } from '../schema';
import type { LegacyAchievement, LegacyGame, LegacyUnlock } from './source';

// De qué fuente es cada logro del catálogo 1.x (§7.4, nota 4 del MAPA).
//
// La tabla `achievements` de la 1.x mezcla Steam y RetroAchievements sin
// columna de fuente. El único sitio donde el código de hoy las separa es
// `setSteamAppId.ts` (al cambiar el appid borra el catálogo Steam y deja el de
// RA): es de RA si tiene un desbloqueo `ra`, si su icono está en
// `media.retroachievements.org/Badge/`, o si el juego tiene `raGameId` y el
// `apiName` es numérico (RA usa su id numérico como apiName, ver
// `src/main/ra/sync.ts`); todo lo demás es de Steam.
//
// Aquí se aplica ese MISMO criterio, pero separando la evidencia de la regla:
// - Evidencia de RA: desbloqueo `ra` o icono de RA.
// - Evidencia de Steam: desbloqueo `steam` o `emu` (los emuladores de Steam
//   hablan con los apiName de Steam), o un icono que no es de RA (los de Steam
//   vienen de su CDN).
// - Con evidencia de un solo lado, esa es la fuente.
// - Con evidencia de los DOS lados, no se puede saber con certeza: se cuenta
//   como conflicto y no se adivina. Para no dejar desbloqueos sin su logro, el
//   logro va al catálogo de cada fuente que pidan sus desbloqueos.
// - Sin evidencia (sin icono y sin desbloqueos), se aplica la regla de
//   `setSteamAppId.ts` tal cual y se cuenta aparte, para que se vea cuántas
//   filas dependen solo de ella.

const RA_ICON_PREFIX = 'https://media.retroachievements.org/Badge/';
const NUMERIC = /^\d+$/;

export type ClassificationBasis = 'evidence' | 'rule' | 'conflict';

export interface ClassifiedAchievement {
  readonly achievement: LegacyAchievement;
  /** Catálogos en los que entra (uno salvo conflicto). */
  readonly sources: readonly AchievementSource[];
  readonly basis: ClassificationBasis;
}

/** Fuente del catálogo que corresponde a un desbloqueo 1.x según su origen. */
export const catalogSourceOfUnlock = (source: SqlUnlockSource): AchievementSource =>
  source === 'ra' ? 'ra' : 'steam';

type SqlUnlockSource = 'steam' | 'emu' | 'ra';

export function classifyAchievements(
  achievements: readonly LegacyAchievement[],
  unlocks: readonly LegacyUnlock[],
  gamesById: ReadonlyMap<number, LegacyGame>,
): ClassifiedAchievement[] {
  const unlockSources = new Map<number, Set<AchievementSource>>();
  for (const unlock of unlocks) {
    const id = unlock.achievementId as number;
    const set = unlockSources.get(id) ?? new Set<AchievementSource>();
    set.add(catalogSourceOfUnlock(unlock.source as SqlUnlockSource));
    unlockSources.set(id, set);
  }

  return achievements.map((achievement) => {
    const fromUnlocks = unlockSources.get(achievement.id as number) ?? new Set();
    const icon = typeof achievement.iconUrl === 'string' ? achievement.iconUrl : null;
    const raEvidence = fromUnlocks.has('ra') || (icon !== null && icon.startsWith(RA_ICON_PREFIX));
    const steamEvidence =
      fromUnlocks.has('steam') ||
      (icon !== null && icon !== '' && !icon.startsWith(RA_ICON_PREFIX));

    if (raEvidence && steamEvidence) {
      // Al catálogo de cada fuente que pidan sus desbloqueos; si ninguno lo
      // pide (el conflicto viene solo del icono), al de la regla de hoy.
      const sources: AchievementSource[] =
        fromUnlocks.size > 0 ? [...fromUnlocks].sort() : [ruleSource(achievement, gamesById)];
      return { achievement, sources, basis: 'conflict' };
    }
    if (raEvidence) return { achievement, sources: ['ra'], basis: 'evidence' };
    if (steamEvidence) return { achievement, sources: ['steam'], basis: 'evidence' };
    return { achievement, sources: [ruleSource(achievement, gamesById)], basis: 'rule' };
  });
}

/** La regla de `setSteamAppId.ts` sin evidencia: RA si el juego tiene raGameId y el apiName es numérico. */
function ruleSource(
  achievement: LegacyAchievement,
  gamesById: ReadonlyMap<number, LegacyGame>,
): AchievementSource {
  const game = gamesById.get(achievement.gameId as number);
  return game?.raGameId != null && NUMERIC.test(String(achievement.apiName)) ? 'ra' : 'steam';
}
