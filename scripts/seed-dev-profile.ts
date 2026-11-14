import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  DEV_RESOURCE_PREFIXES,
  isDevResourceName,
  isValidProfileName,
  profileFolderName,
} from '../src/main/lib/devProfileRules';
import { LOCAL_DATABASE_FILE } from '../src/main/db/v2/importer/appData';
import { DATABASE_CREDENTIAL_KEYS, ENV_BY_CREDENTIAL_KEY } from '../src/shared/credentialKeys';

// Siembra un PERFIL DE DESARROLLO (lib/devProfile.ts) con una copia de tus
// datos reales, para poder trastear sin tocar la app instalada.
//
//   npm run dev:v2:seed                          -> primera vez
//   npm run dev:v2:seed -- --force               -> volver a copiar la base (datos frescos)
//   npm run dev:v2:seed -- --from C:\ruta\copia.db
//   npm run dev:v2:seed -- --keys-file C:\ruta\afterplay-keys.json
//   npm run dev:v2:seed -- --keys-file C:\ruta\afterplay-keys.json --bucket afterplay2-test
//   npm run dev:v2:seed -- --empty               -> sin base: la app arranca vacía
//
// LA BASE 2.0 SALE DE LA COPIA 1.x. El script deja la copia como
// Afterplay.db y BORRA la Afterplay2.db que tuviera el perfil: en el siguiente
// `npm run dev:v2` la app no encuentra base 2.0 e importa esa copia
// (db/v2/appDb.ts, solo en el perfil de desarrollo). Así una base 2.0 creada
// con un esquema anterior se rehace con --force sin tocar nada a mano.
//
// QUÉ COPIA
//   - La base: la copia de seguridad más reciente de la app instalada
//     (userData/backups/Afterplay-*.db). Son copias completas y autónomas
//     (VACUUM INTO), y eso es justo lo que hace falta: la base EN USO no se
//     toca jamás — tiene a su lado los ficheros del motor de sync, y abrirla
//     o copiarla a medias es la receta de la corrupción que ya nos pasó.
//     Al no llevar esos ficheros, la copia nace SIN vínculo con ninguna remota.
//   - config.json, la caché de escaneo y el estado de RetroAchievements.
//   - Con --keys-file, las claves de CONSULTA (IGDB, SteamGridDB, Steam,
//     RetroAchievements, Anthropic) de un fichero exportado desde los Ajustes
//     de la app instalada (API & Sync -> Export keys). Se deja en la carpeta
//     del perfil el mismo fichero SIN las claves de la base remota ni las del
//     bucket; la app lo importa en su siguiente arranque y lo borra
//     (credentials.ts, importDroppedKeysFile).
//
//     Por qué así y no copiando credentials.json: se probó. Los valores van
//     cifrados por Electron y la copia, aun llevándose su `Local State`, no
//     descifra en la carpeta del perfil. El export es el camino que la app ya
//     tiene para llevar claves de una instalación a otra.
//
// QUÉ NO COPIA, A PROPÓSITO
//   - Las credenciales de la base remota y del bucket de partidas. El perfil
//     trabaja sobre una copia; esas dos se ponen a mano en los Ajustes del
//     perfil, apuntando a recursos de DESARROLLO (y aunque se pegaran las de
//     producción, devProfileRules.ts no las deja usar).
//   - machine-saves.json: el perfil tiene que ser OTRA máquina a ojos del
//     bucket. Con la identidad copiada, dos instalaciones compartirían carpeta
//     y cada una podaría las copias de la otra.
//   - Las cachés de imágenes (cientos de MB): se vuelven a bajar solas.
//   - Las copias locales de partidas y las copias de seguridad de la base.

const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--from', '--keys-file', '--bucket'];
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | null => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const optionValues = new Set(VALUE_OPTIONS.map(option).filter((value) => value !== null));
const profile = args.find((arg) => !arg.startsWith('--') && !optionValues.has(arg)) ?? 'v2';

const fail = (message: string): never => {
  console.error(`\n[seed] ${message}\n`);
  process.exit(1);
};

if (!isValidProfileName(profile)) fail(`"${profile}" no vale como nombre de perfil.`);

const appData = process.env.APPDATA;
if (!appData) fail('No encuentro %APPDATA%: este script es para Windows.');

const sourceDir = join(appData as string, 'Afterplay');
const targetDir = join(appData as string, profileFolderName(profile));
const force = flag('--force');
const keysFile = option('--keys-file');
const devBucket = option('--bucket');

if (!existsSync(sourceDir)) fail(`No existe la carpeta de datos de la app instalada: ${sourceDir}`);
if (keysFile !== null && !existsSync(keysFile)) fail(`No existe el fichero de claves: ${keysFile}`);
if (devBucket !== null && keysFile === null)
  fail('--bucket solo tiene sentido junto a --keys-file.');
if (devBucket !== null && !isDevResourceName(devBucket)) {
  fail(
    `"${devBucket}" no es un nombre de bucket de desarrollo (tiene que empezar por ${DEV_RESOURCE_PREFIXES.join(' / ')}).`,
  );
}

mkdirSync(targetDir, { recursive: true });

// ¿Está abierto el perfil? Electron mantiene `lockfile` cogido mientras vive.
const lockfile = join(targetDir, 'lockfile');
if (existsSync(lockfile)) {
  try {
    rmSync(lockfile);
  } catch {
    fail(
      `El perfil "${profile}" está abierto. Ciérralo (Quit en su bandeja) y vuelve a lanzar esto.`,
    );
  }
}

// ── La base ────────────────────────────────────────────────────────────────

const newestBackup = (): string => {
  const backupsDir = join(sourceDir, 'backups');
  if (!existsSync(backupsDir)) {
    return fail('La app instalada no tiene copias de seguridad todavía. Haz una desde Ajustes.');
  }
  const candidates = readdirSync(backupsDir)
    .filter((name) => /^Afterplay-.*\.db$/.test(name))
    .map((name) => ({
      path: join(backupsDir, name),
      mtime: statSync(join(backupsDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    return fail('No hay ninguna copia Afterplay-*.db en backups/. Haz una desde Ajustes.');
  }
  return candidates[0].path;
};

const targetDb = join(targetDir, 'Afterplay.db');
// Los ficheros que el motor de sync deja junto a la base. Si se quedaran los
// de una base anterior al lado de la copia nueva, no cuadrarían con ella.
const SIDECARS = ['-wal', '-shm', '-info', '-changes', '-wal-revert'];
// La base 2.0 del perfil. Se borra siempre que cambia la 1.x, para que la app
// la vuelva a importar en vez de seguir con una que ya no le corresponde.
const targetDbV2 = join(targetDir, LOCAL_DATABASE_FILE);
const removeDatabases = (): void => {
  for (const suffix of ['', ...SIDECARS]) rmSync(`${targetDb}${suffix}`, { force: true });
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${targetDbV2}${suffix}`, { force: true });
};

const seedDatabase = (): void => {
  const sourceDb = option('--from') ?? newestBackup();
  if (!existsSync(sourceDb)) fail(`No existe la copia indicada: ${sourceDb}`);

  // Lo único que NUNCA puede ser el origen: la base en uso.
  if (join(sourceDir, 'Afterplay.db').toLowerCase() === sourceDb.toLowerCase()) {
    fail('Esa es la base EN USO de la app instalada. Usa una copia de seguridad.');
  }

  removeDatabases();
  copyFileSync(sourceDb, targetDb);

  const sizeMb = (statSync(targetDb).size / 1024 / 1024).toFixed(1);
  console.log(`[seed] base: ${sourceDb}`);
  console.log(`[seed]    -> ${targetDb} (${sizeMb} MB)`);
  console.log(`[seed] base 2.0: se importará de esa copia al arrancar (${LOCAL_DATABASE_FILE})`);

  writeFileSync(
    join(targetDir, 'dev-profile.json'),
    JSON.stringify(
      {
        profile,
        seededAt: new Date().toISOString(),
        sourceDb,
        sourceDbModifiedAt: statSync(sourceDb).mtime,
      },
      null,
      2,
    ),
  );
};

if (flag('--empty')) {
  // Dejar el perfil SIN base: la app 2.0 crea una vacía al arrancar, como un
  // PC nuevo. (Antes servía para bajarla de una remota de Turso; el
  // escritorio 2.0 ya no sincroniza con Turso, R-14.)
  removeDatabases();
  console.log('[seed] base: perfil vaciado; la app arrancará con una base 2.0 vacía');
} else if (!existsSync(targetDb) || force) {
  seedDatabase();
} else if (keysFile !== null) {
  console.log('[seed] base: se deja la que ya tiene el perfil (--force para una copia fresca)');
} else {
  fail(
    `El perfil "${profile}" ya tiene una base. Para sustituirla por una copia fresca: --force\n` +
      '       (se pierde lo que hayas trasteado en el perfil; tus datos reales no se tocan).',
  );
}

// ── Las claves de consulta ─────────────────────────────────────────────────

// Todo lo que abre TUS datos en un servicio externo, frente a lo que solo
// consulta un catálogo público. Se decide por el campo interno y se traduce
// al nombre con el que viaja en el fichero exportado.
const databaseKeys = new Set<string>(DATABASE_CREDENTIAL_KEYS);
const WRITE_ENV_NAMES = new Set(
  Object.entries(ENV_BY_CREDENTIAL_KEY)
    .filter(([key]) => databaseKeys.has(key) || key.startsWith('r2') || key.startsWith('s3'))
    .map(([, envName]) => envName),
);
const KNOWN_ENV_NAMES = new Set(Object.values(ENV_BY_CREDENTIAL_KEY));
// Con --bucket, las credenciales del ALMACENAMIENTO sí viajan —mismo servidor,
// mismas llaves— pero con el nombre del bucket cambiado por el de desarrollo.
// Las de la base remota, nunca.
const STORAGE_ENV_NAMES = new Set(
  Object.entries(ENV_BY_CREDENTIAL_KEY)
    .filter(([key]) => key.startsWith('r2') || key.startsWith('s3'))
    .map(([, envName]) => envName),
);
const BUCKET_ENV_NAMES = new Set([ENV_BY_CREDENTIAL_KEY.r2Bucket, ENV_BY_CREDENTIAL_KEY.s3Bucket]);

if (keysFile !== null) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(keysFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    parsed = fail('El fichero de claves no es el JSON que escribe "Export keys".');
  }
  const source = (
    typeof parsed.keys === 'object' && parsed.keys !== null ? parsed.keys : parsed
  ) as Record<string, unknown>;

  const keys: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string' || value.trim() === '' || !KNOWN_ENV_NAMES.has(name)) continue;
    if (devBucket !== null && STORAGE_ENV_NAMES.has(name)) {
      keys[name] = BUCKET_ENV_NAMES.has(name) ? devBucket : value;
      continue;
    }
    if (WRITE_ENV_NAMES.has(name)) {
      skipped.push(name);
      continue;
    }
    keys[name] = value;
  }
  if (devBucket !== null)
    console.log(`[seed] almacenamiento: mismas credenciales, bucket "${devBucket}"`);

  if (Object.keys(keys).length === 0) fail('Ese fichero no trae ninguna clave de consulta.');

  // Mismo nombre y misma forma que el export: es lo que la app busca en su
  // carpeta de datos al arrancar. Solo los NOMBRES salen por pantalla.
  writeFileSync(
    join(targetDir, 'afterplay-keys.json'),
    JSON.stringify({ afterplayKeys: 1, exportedAt: new Date().toISOString(), keys }, null, 2),
  );
  console.log(`[seed] claves que el perfil importará al arrancar: ${Object.keys(keys).join(', ')}`);
  console.log(`[seed] claves dejadas fuera, a propósito: ${skipped.join(', ') || 'ninguna'}`);
  console.log(`[seed] ya puedes borrar el fichero exportado: ${keysFile}`);
} else if (!existsSync(join(targetDir, 'credentials.json'))) {
  console.log(
    '[seed] claves: el perfil no tiene ninguna. Ver --keys-file, o ponlas en sus Ajustes.',
  );
}

// ── Lo demás ───────────────────────────────────────────────────────────────

for (const name of ['config.json', 'scan-cache.json', 'ra-state.json']) {
  const from = join(sourceDir, name);
  const to = join(targetDir, name);
  if (!existsSync(from) || existsSync(to)) continue;
  copyFileSync(from, to);
  console.log(`[seed] ${name}: copiado`);
}

console.log(
  `\n[seed] listo. Arráncalo con: npm run dev:v2${profile === 'v2' ? '' : ` (perfil ${profile})`}`,
);
console.log('[seed] el bucket de desarrollo se pone en los Ajustes del perfil.\n');
