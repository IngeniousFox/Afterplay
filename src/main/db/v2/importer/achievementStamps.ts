import type { AchievementSource, ExternalCheckSource } from '../schema';

// QUIÉN ESCRIBIÓ LOS DOS SELLOS DE LOGROS DE LA 1.x (§19.5, MAPA-1X nota 4).
//
// La 1.x guarda dos columnas por juego y las escriben dos sincronizaciones
// distintas (confirmado leyendo su código):
//
// - RetroAchievements (`ra/sync.ts`) escribe LAS DOS a la vez con la misma
//   hora (`achievementsSyncedAt = achievementsUnlocksSyncedAt = syncedAt`):
//   en RA catálogo y desbloqueos llegan en la misma respuesta. Lo hace aunque
//   el set no tenga logros.
// - Steam (`steam/syncAchievements.ts`) escribe `achievementsSyncedAt` en
//   cuanto guarda el catálogo, también cuando la respuesta es "no hay logros"
//   (catálogo vacío con rareza vacía), y SOLO DESPUÉS, si el catálogo no está
//   vacío y la API de jugador contesta, `achievementsUnlocksSyncedAt` con la
//   MISMA hora. Sin id de usuario o sin respuesta del jugador no lo toca.
// - `setSteamAppId` pone las dos a null al cambiar el appid.
//
// Así que la 1.x solo guarda "la última vez que alguien escribió cada
// columna". La 2.0 guarda una comprobación por fuente (`external_checks`):
// `steam_achievements`, `steam_unlocks` y `ra_achievements` (esta vale por
// catálogo y desbloqueos). Esta función reparte los dos sellos entre ellas
// con lo que se puede deducir, sin inventar horas:
//
// - Un sello `achievementsSyncedAt` DISTINTO del de desbloqueos (o sin él)
//   solo lo deja Steam (RA siempre escribe los dos): `steam_achievements` con
//   esa hora, `ok` si hay catálogo de Steam y `empty` si no.
// - Un par igual, o el sello de desbloqueos cuando el de catálogo es otro, lo
//   escribió "alguien que escribe los dos": RA (si el juego tiene set) o Steam
//   con desbloqueos (si tiene appid Y catálogo de Steam: sin catálogo Steam no
//   llega a pedir desbloqueos).
// - Si las dos son posibles, la 1.x no guarda con qué fuente fue: AMBIGUO. Se
//   apuntan las fuentes posibles que tienen catálogo (prueba de que contestaron
//   alguna vez) con esa hora, que es una cota superior de la real para la que
//   no fue la última. El catálogo de Steam no prueba que Steam contestara
//   sobre los desbloqueos: `steam_unlocks` puede quedar apuntado por un sello
//   que dejó RA. Se elige así porque es lo inocuo (los desbloqueos de Steam se
//   vuelven a pedir al jugar). Se cuenta en el informe.
// - Lo que ningún escritor de la 1.x deja (desbloqueos más recientes que el
//   catálogo, desbloqueos sin catálogo, un sello de Steam en un juego sin
//   appid…) es ANÓMALO: se aplica la regla anterior a esta (cada sello a las
//   fuentes que el juego tiene) y se cuenta. La validación con consultas
//   comprueba igualmente lo que enseña.
//
// El caso real que obligó a esto: juego con appid y set de RA, catálogo solo
// de RA, desbloqueos 18:20 y catálogo 18:24. RA sincronizó a las 18:20 (los
// dos sellos) y Steam preguntó a las 18:24 y no encontró logros (solo el de
// catálogo). La regla anterior daba `ra_achievements` a las 18:24, y la ficha
// enseñaba 18:24 como "desbloqueos sincronizados", donde la 1.x enseña 18:20.

export interface StampInput {
  /** `achievementsSyncedAt` (ms) o null. */
  readonly syncedAt: number | null;
  /** `achievementsUnlocksSyncedAt` (ms) o null. */
  readonly unlocksSyncedAt: number | null;
  readonly hasSteamKey: boolean;
  readonly hasRaKey: boolean;
  /** Fuentes de las que el juego tiene catálogo tras la clasificación. */
  readonly catalogs: ReadonlySet<AchievementSource>;
}

export interface AttributedCheck {
  readonly source: Extract<
    ExternalCheckSource,
    'steam_achievements' | 'steam_unlocks' | 'ra_achievements'
  >;
  readonly status: 'ok' | 'empty';
  readonly checkedAt: number;
}

/** Cómo se decidió (para el informe). */
export type StampBasis =
  | 'sin sellos'
  | 'cierto'
  | 'ambiguo: Steam o RA escribieron el sello (las dos con su hora)'
  | 'supuesto: Steam con desbloqueos (el set de RA no tiene catálogo)'
  | 'anómalo: ningún escritor de la 1.x lo deja (regla por fuentes)';

export interface StampAttribution {
  readonly checks: readonly AttributedCheck[];
  readonly basis: StampBasis;
  /** Lo que no se pudo representar (p. ej. un sello sin fuente posible). */
  readonly discarded: readonly string[];
}

type BothWriter = 'ra' | 'steamWithUnlocks';

/** Quién pudo escribir los dos sellos a la vez, y con qué certeza. */
function bothWriters(input: StampInput): { writers: BothWriter[]; basis: StampBasis } | null {
  const candidates: BothWriter[] = [];
  if (input.hasRaKey) candidates.push('ra');
  if (input.hasSteamKey && input.catalogs.has('steam')) candidates.push('steamWithUnlocks');
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { writers: candidates, basis: 'cierto' };
  // Las dos son posibles. Sin catálogo de RA, que fuera RA exige un set sin
  // un solo logro, y la 1.x no deja saberlo: se apunta Steam, porque es lo
  // que no cuesta nada si es falso (los desbloqueos de Steam se vuelven a
  // pedir al jugar), mientras que un `ra_achievements` falso en `empty`
  // dejaría ese set sin volver a preguntar nunca. Se cuenta como "supuesto".
  if (!input.catalogs.has('ra')) {
    return {
      writers: ['steamWithUnlocks'],
      basis: 'supuesto: Steam con desbloqueos (el set de RA no tiene catálogo)',
    };
  }
  return {
    writers: candidates,
    basis: 'ambiguo: Steam o RA escribieron el sello (las dos con su hora)',
  };
}

/** La regla anterior: cada sello a las fuentes que el juego tiene (anómalos). */
function bySources(input: StampInput): StampAttribution {
  const checks: AttributedCheck[] = [];
  const discarded: string[] = [];
  const { syncedAt: s, unlocksSyncedAt: u, catalogs } = input;
  if (s !== null) {
    const withCatalog: AttributedCheck['source'][] = [];
    if (catalogs.has('steam')) withCatalog.push('steam_achievements');
    if (catalogs.has('ra')) withCatalog.push('ra_achievements');
    if (withCatalog.length > 0) {
      for (const source of withCatalog) checks.push({ source, status: 'ok', checkedAt: s });
    } else {
      if (input.hasSteamKey)
        checks.push({ source: 'steam_achievements', status: 'empty', checkedAt: s });
      if (input.hasRaKey) checks.push({ source: 'ra_achievements', status: 'empty', checkedAt: s });
      if (!input.hasSteamKey && !input.hasRaKey)
        discarded.push('achievementsSyncedAt sin catálogo ni clave de Steam o RA');
    }
  }
  if (u !== null) {
    if (catalogs.has('steam') || input.hasSteamKey) {
      checks.push({ source: 'steam_unlocks', status: 'ok', checkedAt: u });
    } else if (u !== s) {
      discarded.push('achievementsUnlocksSyncedAt de un juego solo de RA distinto del de catálogo');
    }
  }
  return {
    checks,
    basis: 'anómalo: ningún escritor de la 1.x lo deja (regla por fuentes)',
    discarded,
  };
}

const status = (input: StampInput, source: AchievementSource): 'ok' | 'empty' =>
  input.catalogs.has(source) ? 'ok' : 'empty';

/** Las comprobaciones de `external_checks` que salen de los dos sellos de un juego. */
export function attributeAchievementStamps(input: StampInput): StampAttribution {
  const { syncedAt: s, unlocksSyncedAt: u } = input;
  if (s === null && u === null) return { checks: [], basis: 'sin sellos', discarded: [] };
  // Desbloqueos sin catálogo, o más recientes que él: los dos escritores
  // escriben el de catálogo antes o a la vez (setSteamAppId borra los dos).
  if (s === null || (u !== null && u > s)) return bySources(input);

  const checks: AttributedCheck[] = [];
  const write = (writers: readonly BothWriter[], at: number, catalogAlso: boolean): void => {
    for (const writer of writers) {
      if (writer === 'ra') {
        checks.push({ source: 'ra_achievements', status: status(input, 'ra'), checkedAt: at });
      } else {
        if (catalogAlso) checks.push({ source: 'steam_achievements', status: 'ok', checkedAt: at });
        checks.push({ source: 'steam_unlocks', status: 'ok', checkedAt: at });
      }
    }
  };

  if (u === s) {
    const both = bothWriters(input);
    if (!both) return bySources(input);
    write(both.writers, s, true);
    return { checks, basis: both.basis, discarded: [] };
  }

  // El de catálogo sin el de desbloqueos: Steam sin desbloqueos.
  if (!input.hasSteamKey) return bySources(input);
  checks.push({ source: 'steam_achievements', status: status(input, 'steam'), checkedAt: s });
  if (u === null) return { checks, basis: 'cierto', discarded: [] };
  // El de desbloqueos, anterior: alguien que escribe los dos, en otra pasada.
  const both = bothWriters(input);
  if (!both) return bySources(input);
  write(both.writers, u, false);
  return { checks, basis: both.basis, discarded: [] };
}

/** La hora a la que contestó cada fuente de catálogo, si se sabe. */
export function catalogAnswerAt(
  attribution: StampAttribution,
  source: AchievementSource,
): number | null {
  const check = source === 'steam' ? 'steam_achievements' : 'ra_achievements';
  return attribution.checks.find((c) => c.source === check)?.checkedAt ?? null;
}
