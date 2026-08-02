import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { achievementsTable } from '../../db/schema';

// Escribir el achievements.json que a Goldberg/GSE le falta (LOGROS.md §7.2).
//
// El porqué, descubierto con el 007 de esta biblioteca: Goldberg solo REGISTRA
// un desbloqueo si el logro está en su catálogo local (steam_settings/
// achievements.json). Muchos repacks no lo incluyen — el juego pide
// "desbloquea X", el emulador no encuentra X en ninguna lista, y lo tira.
// Resultado real: horas de juego, carpeta de partidas llena, y CERO logros
// grabados. No es que no los sacaras: es que nadie los estaba apuntando.
//
// Afterplay ya tiene ese catálogo (lo trajo de la API de Steam), así que
// puede dárselo al emulador. Es lo mismo que hacen los "fixes" de la
// comunidad de Hydra, hecho en local y con nuestros propios datos.
//
// Reglas de prudencia — esto ESCRIBE en la carpeta de un juego, que no es
// terreno de la app, así que lo hace con el mínimo pie posible:
//   · Solo en carpetas steam_settings que YA EXISTEN (las creó el crack; si
//     no hay ninguna, este juego no usa Goldberg y aquí no se pinta nada).
//   · Nunca pisa un achievements.json existente.
//   · El fichero es un catálogo genérico del juego, sin nada personal.

// Forma EXACTA que genera gen_emu_config, la herramienta oficial de GSE — y
// se copia al pie de la letra a propósito, no "algo parecido":
//
//   · `hidden` va como CADENA "0"/"1", no como número. El emulador lo lee
//     como string; un número puede hacer que su parser reviente y descarte el
//     fichero ENTERO, con lo que volveríamos al punto de partida sin saber
//     por qué.
//   · `icon`/`icongray` se incluyen aunque vayan vacíos: son claves que el
//     emulador espera encontrar. Van en blanco porque los iconos de verdad
//     los pinta Afterplay desde su propia caché — al emulador solo le hacen
//     falta para su overlay, que aquí no se usa.
//
// `name` es el apiName: la clave con la que el juego pide "desbloquea esto".
type GoldbergAchievement = {
  name: string;
  displayName: string;
  description: string;
  hidden: string;
  icon: string;
  icongray: string;
};

const MAX_SCAN_DEPTH = 3;

// Las steam_settings de una carpeta de juego. Búsqueda acotada: los cracks
// las dejan junto al exe, nunca enterradas — y un árbol de mods gigante no
// debe pagarse entero.
const findSteamSettingsDirs = (root: string, depth = 0): string[] => {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(root, entry.name);
    if (entry.name === 'steam_settings') {
      found.push(full);
    } else if (depth < MAX_SCAN_DEPTH) {
      found.push(...findSteamSettingsDirs(full, depth + 1));
    }
  }
  return found;
};

// Escribe el catálogo donde falte. Devuelve cuántos ficheros escribió (0 es
// el caso normal: juego sin Goldberg, o con el catálogo ya puesto).
export const ensureGoldbergCatalog = async (
  gameId: number,
  installDirectory: string | null,
): Promise<number> => {
  if (!installDirectory || !existsSync(installDirectory)) return 0;

  const dirs = findSteamSettingsDirs(installDirectory);
  const missing = dirs.filter((dir) => !existsSync(join(dir, 'achievements.json')));
  if (missing.length === 0) return 0;

  const rows = await getDb()
    .select({
      apiName: achievementsTable.apiName,
      displayName: achievementsTable.displayName,
      description: achievementsTable.description,
      hidden: achievementsTable.hidden,
    })
    .from(achievementsTable)
    .where(eq(achievementsTable.gameId, gameId));
  if (rows.length === 0) return 0;

  const catalog: GoldbergAchievement[] = rows.map((row) => ({
    name: row.apiName,
    displayName: row.displayName,
    description: row.description ?? '',
    hidden: row.hidden ? '1' : '0',
    icon: '',
    icongray: '',
  }));
  const json = `${JSON.stringify(catalog, null, 2)}\n`;

  let written = 0;
  for (const dir of missing) {
    try {
      writeFileSync(join(dir, 'achievements.json'), json);
      written++;
      // Solo ASCII, misma convencion que watcher/watcher.ts.
      console.log(
        `[steam] catalogo de logros escrito para Goldberg: ${join(dir, 'achievements.json')}`,
      );
    } catch (error) {
      // Carpeta protegida o disco de solo lectura: no es motivo para fallar
      // la sync — simplemente ese emulador seguira sin registrar.
      console.warn(`[steam] no se pudo escribir el catalogo en ${dir}:`, error);
    }
  }
  return written;
};
