import axios from 'axios';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Descarga el binario de ludusavi que Afterplay empaqueta
// (PARTIDAS-GUARDADAS.md §6.2). Corre en build time, nunca en la app: el
// .exe viaja dentro del paquete y se ejecuta desde resources/ sin copiarse
// jamás a userData, así que actualizar Afterplay ES actualizar ludusavi.
//
// Las tres cosas que Hydra no hace y que aquí son el motivo de que exista
// este script:
//   1. Verificar el SHA256 contra el hash FIJADO en ludusavi.lock.json. No
//      publican SHA256SUMS, pero la API de GitHub expone assets[].digest y
//      coincide. Si no cuadra, la build FALLA — nunca se empaqueta un
//      binario que no sea exactamente el revisado.
//   2. Comprobar por versión+hash, no por existencia. El clásico
//      `if (existsSync(dir)) return;` es justo el bug de Hydra: subes la
//      versión del lock y te quedas con el binario viejo para siempre.
//   3. Smoke test (`--smoke`) antes de publicar. Ludusavi está en 0.x sin
//      garantía de estabilidad de CLI y ha roto cosas ~1 vez al año (0.23
//      quitó --merge/--update, 0.26 cambió la interpretación de rutas, 0.27
//      el formato del registro). No basta con que el binario arranque: se
//      hace un ciclo completo y se verifica cada cosa de la que depende la
//      app (ver smokeTest).
//
// Uso:
//   npm run ludusavi:fetch                  descarga/actualiza si hace falta
//   npm run ludusavi:fetch -- --check       ¿hay versión nueva publicada?
//   npm run ludusavi:fetch -- --smoke       la prueba de humo
//   npm run ludusavi:fetch -- --bump 0.32.0 reescribe el lock con los datos
//                                           reales de esa release de GitHub
//
// Subir de versión son cuatro órdenes:
//   0) --check        (¿hay algo nuevo? si no, se acabó)
//   1) --bump X.Y.Z   (actualiza version + tamaños + hashes)
//   2) (sin flags)    (descarga y verifica)
//   3) --smoke        (comprueba que la CLI no ha cambiado)
// Y si el paso 3 falla, NO se publica: se arregla src/main/saves primero.
//
// Nada de esto es obligatorio para trabajar: el lock fija una versión que ya
// funciona, así que quien no toque esto sigue compilando exactamente igual
// dentro de un año.

type LockFile = {
  version: string;
  repo: string;
  assets: Record<'binary' | 'legal', { name: string; size: number; sha256: string }>;
};

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');
const targetDir = join(projectRoot, 'ludusavi');
const exePath = join(targetDir, 'ludusavi.exe');
// Marcador de lo que hay instalado AHORA en targetDir. Es lo que permite
// comprobar por versión y no por existencia (punto 2 de arriba).
const markerPath = join(targetDir, '.fetched.json');

const lock = JSON.parse(readFileSync(join(projectRoot, 'ludusavi.lock.json'), 'utf-8')) as LockFile;

// El tipo va en la VARIABLE y no solo en el retorno de la flecha: es la
// única forma de que TypeScript trate `fail(...)` como un corte de flujo y
// estreche los tipos después de llamarla (con la anotación solo en la
// flecha, sigue creyendo que la ejecución continúa).
const fail: (message: string) => never = (message) => {
  console.error(`[ludusavi] ${message}`);
  process.exit(1);
};

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

const download = async (assetName: string): Promise<Buffer> => {
  const url = `https://github.com/${lock.repo}/releases/download/v${lock.version}/${assetName}`;
  console.log(`[ludusavi] descargando ${assetName}...`);
  const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
};

// Node no trae descompresor y el binario solo se empaqueta desde Windows
// (la función de partidas es Windows-only: rutas, registro y el propio
// .exe). Expand-Archive viene de serie con PowerShell, así que sale gratis
// y evita meter una dependencia más solo para la build.
const expandZip = (zipPath: string, destination: string): void => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destination}' -Force`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) fail(`no se pudo descomprimir ${zipPath}`);
};

const fetchAsset = async (kind: 'binary' | 'legal', destination: string): Promise<void> => {
  const asset = lock.assets[kind];
  const buffer = await download(asset.name);

  if (buffer.byteLength !== asset.size) {
    fail(`${asset.name}: tamaño ${buffer.byteLength}, esperado ${asset.size}. Build abortada.`);
  }
  const digest = sha256(buffer);
  if (digest !== asset.sha256) {
    fail(`${asset.name}: SHA256 ${digest}, esperado ${asset.sha256}. Build abortada.`);
  }
  console.log(`[ludusavi] ${asset.name} verificado (${asset.size} bytes)`);

  const zipPath = join(targetDir, asset.name);
  mkdirSync(destination, { recursive: true });
  writeFileSync(zipPath, buffer);
  expandZip(zipPath, destination);
  rmSync(zipPath, { force: true });
};

const isUpToDate = (): boolean => {
  if (!existsSync(exePath) || !existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as {
      version?: string;
      sha256?: string;
    };
    // El hash del marcador es el del ZIP descargado, no el del .exe: es el
    // que está fijado en el lock y el que de verdad identifica la release.
    return marker.version === lock.version && marker.sha256 === lock.assets.binary.sha256;
  } catch {
    return false;
  }
};

// Ejecuta ludusavi contra la carpeta de config de la prueba y devuelve el
// JSON. Mismas reglas que runLudusavi() en el main: flags globales delante,
// ruta de config absoluta, y el veredicto lo da el JSON — NUNCA el exit code.
const runForSmoke = (configDir: string, args: string[]): Record<string, unknown> => {
  const result = spawnSync(
    exePath,
    ['--config', configDir, '--no-manifest-update', ...args, '--no-cloud-sync'],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return fail(
      `\`${args.join(' ')}\` no devolvió JSON parseable.\n  stdout: ${result.stdout.slice(0, 300)}\n  stderr: ${result.stderr?.slice(0, 300)}`,
    );
  }
};

// Prueba de humo: NO comprueba que el binario "arranque", comprueba que
// sigue hablando exactamente el mismo idioma que src/main/saves da por
// supuesto. Ludusavi está en 0.x sin garantía de estabilidad de CLI y ha
// roto cosas ~1 vez al año (0.23 quitó --merge/--update, 0.26 cambió la
// interpretación de rutas, 0.27 el formato del registro), así que un
// `--version` que responde no demuestra nada.
//
// Hace un ciclo completo sobre archivos de mentira, en una carpeta temporal,
// y verifica UNA POR UNA las seis cosas de las que depende la app. Si una
// versión nueva rompe cualquiera, la release falla aquí y no en el PC de
// nadie.
const smokeTest = (): void => {
  console.log('[ludusavi] smoke test...');

  const version = spawnSync(exePath, ['--version'], { encoding: 'utf-8' });
  if (version.status !== 0 || !version.stdout.includes(lock.version)) {
    fail(`--version no devolvió ${lock.version} (salida: ${version.stdout.trim()})`);
  }

  const root = join(tmpdir(), `afterplay-ludusavi-smoke-${process.pid}`);
  const configDir = join(root, 'cfg');
  const live = join(root, 'live', 'Saves');
  const backups = join(root, 'backups');
  const redirected = join(root, 'otro-destino');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(live, { recursive: true });
  mkdirSync(configDir, { recursive: true });

  const slash = (path: string): string => path.replace(/\\/g, '/');
  const GAME = 'Afterplay Smoke Test';
  // El mismo config que escribe saves/config.ts, con las dos piezas
  // opcionales que hay que ejercitar por separado. Se compone por secciones
  // en vez de concatenar texto al final: los redirects y los toggles van
  // DENTRO de su bloque, y pegarlos detrás daría un YAML que ludusavi
  // descarta en silencio (que es exactamente lo que pasó la primera vez).
  const writeConfig = (options: { redirects?: boolean; toggledRegistry?: boolean } = {}): void =>
    writeFileSync(
      join(configDir, 'config.yaml'),
      [
        '---',
        'manifest:',
        '  enable: false',
        'release:',
        '  check: false',
        'roots: []',
        ...(options.redirects
          ? [
              'redirects:',
              '  - kind: restore',
              `    source: "${slash(live)}"`,
              `    target: "${slash(redirected)}"`,
            ]
          : []),
        'backup:',
        `  path: "${slash(backups)}"`,
        '  format:',
        '    chosen: zip',
        '  retention:',
        '    full: 3',
        '    differential: 5',
        'restore:',
        `  path: "${slash(backups)}"`,
        ...(options.toggledRegistry
          ? ['  toggledRegistry:', `    ${GAME}:`, '      HKEY_CURRENT_USER: false']
          : []),
        'customGames:',
        `  - name: ${GAME}`,
        '    files:',
        `      - "${slash(live)}"`,
      ].join('\n'),
    );

  try {
    writeFileSync(join(live, 'slot1.sav'), 'version uno');
    writeConfig();

    // 1. Backup en formato zip, con la salida por juego que espera
    // toScannedGame().
    const first = runForSmoke(configDir, ['backup', '--api', '--force', GAME]);
    const games = first.games as Record<string, { files?: Record<string, unknown> }> | undefined;
    if (!games?.[GAME]?.files) fail('backup --api ya no devuelve games[juego].files');
    if (!existsSync(join(backups, GAME, 'mapping.yaml'))) fail('el backup no generó mapping.yaml');

    // 2. Preview de cambios: es lo que alimenta el indicador de la ficha.
    const preview = runForSmoke(configDir, ['backup', '--preview', '--api', '--force', GAME]);
    const changed = (preview.overall as { changedGames?: Record<string, number> } | undefined)
      ?.changedGames;
    if (!changed || typeof changed.same !== 'number') {
      fail('backup --preview --api ya no devuelve overall.changedGames');
    }

    // 3. Diferenciales: los zips -diff cuelgan de su completo en children[],
    // y de ahí sale la cadena que se baja de R2 para restaurar.
    writeFileSync(join(live, 'slot1.sav'), 'version dos, mas larga');
    runForSmoke(configDir, ['backup', '--api', '--force', GAME]);
    const mapping = parse(readFileSync(join(backups, GAME, 'mapping.yaml'), 'utf-8')) as {
      backups?: { name: string; files?: Record<string, unknown>; children?: { name: string }[] }[];
    };
    const full = mapping.backups?.[0];
    if (!full?.files) fail('mapping.yaml ya no lista los archivos de cada backup');
    if (!full.children?.length) fail('mapping.yaml ya no anida los diferenciales en children[]');

    // 4. Redirects: la pieza de la que depende TODO el destino elegible
    // (§10bis.5) y también restaurar backups de otro PC.
    writeConfig({ redirects: true });
    const restore = runForSmoke(configDir, [
      'restore',
      '--preview',
      '--api',
      '--force',
      '--backup',
      full.name,
      GAME,
    ]);
    const restoreFiles = (
      restore.games as Record<string, { files?: Record<string, { originalPath?: string }> }>
    )?.[GAME]?.files;
    const targets = Object.keys(restoreFiles ?? {});
    if (targets.length === 0) fail('restore --preview --api ya no devuelve la lista de archivos');
    if (!targets.every((target) => slash(target).startsWith(slash(redirected)))) {
      fail(`los redirects ya no reescriben el destino: ${targets.join(', ')}`);
    }
    // 5. El par "de dónde -> a dónde" que enseña el diálogo de confirmación.
    if (!Object.values(restoreFiles ?? {}).every((file) => file.originalPath)) {
      fail('restore --preview --api ya no incluye originalPath en cada archivo');
    }

    // 6. toggledRegistry: es lo que permite exportar a una carpeta sin
    // escribir en HKCU. No se puede ejercitar sin tocar el registro de
    // verdad, así que se comprueba que la clave siga existiendo en el
    // esquema de config: si la quitan o la renombran, `config show` la
    // devolverá vacía.
    writeConfig({ toggledRegistry: true });
    const shown = spawnSync(
      exePath,
      ['--config', configDir, '--no-manifest-update', 'config', 'show'],
      {
        encoding: 'utf-8',
      },
    );
    if (!shown.stdout.includes('toggledRegistry') || !shown.stdout.includes('HKEY_CURRENT_USER')) {
      fail('el config ya no conserva restore.toggledRegistry (exportar escribiría en el registro)');
    }

    console.log('[ludusavi] smoke test OK — backup, diferenciales, redirects y toggles intactos');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

// Palabras que en unas notas de release de ludusavi suelen significar "algo
// de la CLI ha cambiado". No deciden nada —el veredicto lo da --smoke— pero
// avisan de que toca leerlas antes de subir de versión.
const BREAKING_HINTS = [
  'breaking',
  'removed',
  'renamed',
  'no longer',
  'deprecat',
  'changed the',
  'incompatible',
];

// ¿Hay versión nueva? Es el paso 0 del proceso: contesta "sí/no" sin
// descargar nada ni tocar el lock.
//
//   npm run ludusavi:fetch -- --check
const check = async (): Promise<void> => {
  const { data } = await axios.get<{
    tag_name: string;
    name?: string;
    published_at?: string;
    html_url?: string;
    body?: string;
  }>(`https://api.github.com/repos/${lock.repo}/releases/latest`);

  const latest = data.tag_name.replace(/^v/, '');
  if (latest === lock.version) {
    console.log(`[ludusavi] al día: v${lock.version} es la última publicada.`);
    return;
  }

  const published = data.published_at?.slice(0, 10) ?? 'fecha desconocida';
  console.log(`[ludusavi] hay versión nueva: v${latest} (${published}) — tienes v${lock.version}`);
  if (data.html_url) console.log(`[ludusavi] notas: ${data.html_url}`);

  // Aviso, no bloqueo: lo que decide si se puede subir es el smoke test.
  const flagged = (data.body ?? '')
    .split('\n')
    .filter((line) => BREAKING_HINTS.some((hint) => line.toLowerCase().includes(hint)))
    .slice(0, 8);
  if (flagged.length > 0) {
    console.log('[ludusavi] ojo, en las notas hay líneas que huelen a cambio de CLI:');
    for (const line of flagged) console.log(`    ${line.trim()}`);
  }

  console.log(`[ludusavi] siguiente paso:  npm run ludusavi:fetch -- --bump ${latest}`);
};

// Reescribe el lock con los datos REALES de una versión, sacados de la API de
// GitHub (assets[].digest). Evita el copia-pega a mano de un hash de 64
// caracteres, que es la parte del proceso donde es fácil equivocarse.
//
//   npm run ludusavi:fetch -- --bump 0.32.0
const bump = async (nextVersion: string): Promise<void> => {
  const { data } = await axios.get<{
    assets: { name: string; size: number; digest?: string }[];
  }>(`https://api.github.com/repos/${lock.repo}/releases/tags/v${nextVersion}`);

  const pick = (suffix: string): LockFile['assets']['binary'] => {
    const asset = data.assets.find((candidate) => candidate.name.endsWith(suffix));
    if (!asset) fail(`la release v${nextVersion} no trae ningún asset "${suffix}"`);
    if (!asset!.digest?.startsWith('sha256:')) {
      fail(`el asset ${asset!.name} no publica digest sha256 — habría que calcularlo a mano`);
    }
    return {
      name: asset!.name,
      size: asset!.size,
      sha256: asset!.digest!.slice('sha256:'.length),
    };
  };

  const next: LockFile & { _comment?: string } = {
    ...lock,
    version: nextVersion,
    assets: { binary: pick('-win64.zip'), legal: pick('-legal.zip') },
  };
  writeFileSync(join(projectRoot, 'ludusavi.lock.json'), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`[ludusavi] lock actualizado a v${nextVersion}:`);
  console.log(`  binario: ${next.assets.binary.name} (${next.assets.binary.sha256.slice(0, 16)}…)`);
  console.log('  ahora vuelve a lanzarlo con --smoke para comprobar que la CLI no ha cambiado.');
};

const main = async (): Promise<void> => {
  // --check solo consulta y se va: no descarga ni toca el lock.
  if (process.argv.includes('--check')) {
    await check();
    return;
  }

  // --bump va antes que nada: cambia el lock, y lo que venga después ya
  // trabaja sobre la versión nueva.
  const bumpIndex = process.argv.indexOf('--bump');
  if (bumpIndex !== -1) {
    const nextVersion = process.argv[bumpIndex + 1];
    if (!nextVersion) fail('--bump necesita una versión, p. ej. --bump 0.32.0');
    await bump(nextVersion.replace(/^v/, ''));
    console.log('[ludusavi] vuelve a ejecutar el script para descargar la versión nueva.');
    return;
  }

  if (isUpToDate()) {
    console.log(`[ludusavi] v${lock.version} ya está en ./ludusavi, nada que descargar`);
  } else {
    // Se limpia entero: mezclar restos de una versión con otra es
    // exactamente el tipo de estado a medias que este script existe para
    // evitar.
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });

    await fetchAsset('binary', targetDir);
    if (!existsSync(exePath)) fail('el zip no contenía ludusavi.exe');

    // Obligación legal al redistribuir (§6.4): la MIT de ludusavi y el
    // legal.txt con las licencias de sus dependencias de Rust viajan
    // JUNTO al binario, y Ajustes los enseña desde ahí.
    const legalDir = join(targetDir, 'legal');
    await fetchAsset('legal', legalDir);
    // El zip de la release NO trae la licencia del propio ludusavi (solo
    // las de sus dependencias), así que se baja del tag exacto — un fichero
    // inmutable de un tag no necesita hash fijado como los binarios.
    const license = await axios.get<string>(
      `https://raw.githubusercontent.com/${lock.repo}/v${lock.version}/LICENSE`,
      { responseType: 'text' },
    );
    writeFileSync(join(legalDir, 'ludusavi-LICENSE.txt'), license.data);

    writeFileSync(
      markerPath,
      `${JSON.stringify({ version: lock.version, sha256: lock.assets.binary.sha256 }, null, 2)}\n`,
    );
    console.log(`[ludusavi] v${lock.version} listo en ./ludusavi`);
  }

  if (process.argv.includes('--smoke')) smokeTest();
};

void main().catch((error) => fail(String(error)));
