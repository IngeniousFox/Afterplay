import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase } from '../src/main/db/v2/connection';
import { LOCAL_DATABASE_FILE } from '../src/main/db/v2/importer/appData';
import { createQueryContext } from '../src/main/db/v2/queries/common/context';
import { ensureThisDevice } from '../src/main/db/v2/queries/common/device';
import {
  seedCatalog,
  seedCheck,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  seedUnlock,
} from '../src/main/db/v2/queries/common/__tests__/fixtures';
import type { AchievementSource, UnlockOrigin } from '../src/main/db/v2/schema';
import { SYNC_CREDENTIAL_KEYS } from '../src/shared/credentialKeys';
import type { CredentialsValues, SaveStorageProvider } from '../src/shared/types';
import { credentialsForSandbox } from './credentials';
import { DEFAULT_SEED } from './seed';

// LA CARPETA DE DATOS DESECHABLE DE CADA TEST E2E.
//
// Un test de extremo a extremo arranca la app DE VERDAD, y una app de verdad
// escribe: su base, sus credenciales, sus copias, su caché de imágenes, su
// config. Aquí se le fabrica un mundo entero de mentira en %TEMP% para que
// todo eso caiga ahí y se borre al terminar — la instalación del dueño ni se
// entera (el gate de src/main/lib/e2e.ts, que se enciende con la MISMA
// variable que trae esta carpeta, apaga la importación del .env).
//
// LA BASE SE SIEMBRA DESDE FUERA: la base 2.0 (Afterplay2.db) con las
// migraciones REALES del repo (drizzle-v2/) y escrita POR LA PUERTA, con los
// mismos `seed*` que los tests de las consultas 2.0
// (src/main/db/v2/queries/common/__tests__/fixtures.ts). Así un test no
// depende de la red ni del alta por IGDB para tener biblioteca, y una
// migración que rompa el esquema tumba estos tests antes que la app de nadie.
//
// EL DISPOSITIVO: la base 2.0 sabe qué filas son de ESTE PC (sesiones,
// instalaciones, desbloqueos del emulador) por su `deviceId`, que la app saca
// de machine-saves.json. El sandbox inventa uno, siembra con él y lo deja
// escrito en ese fichero, así que la app arranca siendo el PC dueño de todo
// lo sembrado. Sin eso las sesiones serían "de otro dispositivo" y la app no
// podría ni cerrarlas.
//
// LOS IDS son de texto (UUIDv7) y cambian en cada sandbox: un test no escribe
// ids a mano, los busca por título con `gameIdOf` (§20.3.1 de
// docs/AFTERPLAY-2.0.md).
//
// LAS CREDENCIALES salen de .env.test y de ningún otro sitio (ver
// e2e/credentials.ts: la lista blanca es lo que hace segura toda esta
// carpeta). Se escriben en el credentials.json del sandbox con
// `encrypted: false` — el formato que credentials.ts ya contempla cuando
// safeStorage no está disponible—, así la app las lee por su camino normal,
// sin ninguna rama especial para tests.
//
// Si no hay .env.test, se escriben dos claves de IGDB inservibles: no es
// capricho, es que sin ninguna la app abre Ajustes sola en el primer arranque
// (el armazón de escritorio lo hace cuando faltan las de IGDB) y todos los tests empezarían
// con un modal delante. Con ellas la app se comporta como una instalación
// configurada, y los tests que necesiten red se saltan solos.

export type Sandbox = {
  userDataDir: string;
  dbPath: string;
  // El id de cada juego sembrado, por título.
  gameIds: ReadonlyMap<string, string>;
  cleanup: () => void;
};

/** El id de un juego sembrado. Lanza si el título no está: el sembrado cambió. */
export const gameIdOf = (sandbox: Sandbox, title: string): string => {
  const id = sandbox.gameIds.get(title);
  if (!id) throw new Error(`el sembrado no tiene "${title}"`);
  return id;
};

// UN JUEGO DE LA BIBLIOTECA DE PRUEBA.
//
// La forma sale de la biblioteca REAL del dueno (ver e2e/seed.ts y el
// generador scripts/gen-e2e-seed.ts): un modelo inventado a ojo se queda
// corto justo donde duele. El ejemplo que lo demuestra es Assassin's Creed II
// -- DOS playthroughs, uno fechado "2021" a secas y otro con dia exacto, con
// horas manuales distintas en cada uno --: un sembrado de un playthrough por
// juego no puede montar eso, y es justo el caso que rompe las derivaciones
// (que ano se lleva las horas, cual es el estado de AHORA).
//
// Los EVENTOS y las SESIONES van como listas por lo mismo: en esta app el
// estado, las horas y las fechas NO se guardan, se DERIVAN del log, asi que
// el sembrado tiene que poder escribir la historia entera.
export type SeedGame = {
  title: string;
  // Plan to Play: vive solo en /plan, fuera de Library/Sessions/Stats/watcher.
  planned?: boolean;
  // "Up next" (PLAN-TO-PLAY.md 2.2): prioridad fijada a mano.
  pinnedAt?: Date;
  // Sin final posible (Minecraft): oculta "Complete", nunca es backlog.
  endless?: boolean;
  // Sin .exe que vigilar; sus sesiones llegan por asignacion manual.
  isEmulated?: boolean;
  // null = no esta en Steam (retro emulado). Sin poner, se inventa uno. En los
  // dos casos se marca como "ya comprobado" para que los barridos de fondo del
  // arranque no tengan nada que buscar: un test no debe esperar a la red ni
  // tocarla.
  steamAppId?: number | null;
  releaseYear?: number | null;
  genres?: string[];
  // Los tres tramos de HowLongToBeat, que alimentan la Deuda del Backlog.
  hltb?: { main?: number | null; extras?: number | null; completionist?: number | null };
  notes?: string | null;
  addedAt?: Date;
  // Cuando paso de Plan a biblioteca: la segunda referencia del papeleo (ver
  // isAddedAtArtifact), sin la cual los eventos de un promote pasan por jugada.
  promotedAt?: Date;
  // Los playthroughs. Sin esto un juego de la biblioteca nace con uno vacio
  // (lo que crea el alta de verdad), que es la forma de un juego "intacto". Un
  // PLANEADO no tiene ninguno en la 2.0 (el Plan es `plan_entries`): de los
  // suyos solo cuenta el evento 'plan_to_play', que pasa a ser su fecha de
  // entrada en el Plan.
  playthroughs?: SeedPlaythrough[];
  // Logros SINTETICOS: se generan `total` definiciones y se desbloquean las
  // `unlocked` primeras. Las cifras salen de juegos reales pero recortadas --
  // sembrar los 39.881 logros de la biblioteca real en cada test seria pagar
  // segundos por arranque para pintar una barra de progreso. 'emu' es un logro
  // de Steam visto por el emulador de ESTE PC (origen `emu@<deviceId>`).
  achievements?: { total: number; unlocked: number; source?: 'steam' | 'emu' | 'ra' };
};

export type SeedPlaythrough = {
  label?: string;
  platform?: string;
  origin?: string;
  format?: 'digital' | 'physical';
  // Horas TECLEADAS (las que no midio nadie). Se suman a las de las sesiones.
  manualHours?: number | null;
  events?: SeedEvent[];
  sessions?: SeedSession[];
};

export type SeedEvent = { type: SeedStateType; at: Date; precision?: SeedPrecision };
export type SeedSession = { at: Date; hours: number; manual?: boolean };

type SeedStateType = 'started' | 'completed' | 'dropped' | 'on_hold' | 'resting' | 'plan_to_play';
type SeedPrecision = 'year' | 'month' | 'day' | 'datetime';

// El relleno de cuando no hay .env.test: suficiente para que la app se crea
// configurada, inservible para tocar nada de verdad.
const PLACEHOLDER_CREDENTIALS: Partial<CredentialsValues> = {
  twitchClientId: 'e2e-fake-client-id',
  twitchClientSecret: 'e2e-fake-client-secret',
};

const credentialsFileFor = (overrides: Partial<CredentialsValues> = {}): string => {
  // La 2.0 no abre Turso (R-14): un sandbox con credenciales de la base remota
  // sería un test de algo que ya no existe, y una credencial de producción
  // cerca de un proceso que pulsa botones solo.
  if (overrides.databaseUrl || overrides.databaseAuthToken) {
    throw new Error('An E2E sandbox cannot receive remote database credentials.');
  }
  // Ni el emparejado con un hub de sync: el token abre una biblioteca entera.
  const loose = overrides as Record<string, unknown>;
  if (SYNC_CREDENTIAL_KEYS.some((key) => loose[key])) {
    throw new Error('An E2E sandbox cannot receive sync hub credentials.');
  }
  const fromEnvTest = credentialsForSandbox();
  const values = {
    ...(Object.keys(fromEnvTest).length > 0 ? fromEnvTest : PLACEHOLDER_CREDENTIALS),
    ...overrides,
  };
  return JSON.stringify(
    {
      version: 1,
      // false = valores en claro. Es el camino que credentials.ts ya
      // contempla (safeStorage no disponible), y el único que se puede
      // escribir sin Electron.
      encrypted: false,
      values,
    },
    null,
    2,
  );
};

const APPID_BASE = 1_000_000;
const CHECKED_AT = new Date('2026-01-01T00:00:00Z');

// El catálogo y el origen de cada fuente del sembrado.
const ACHIEVEMENT_SOURCE: Record<'steam' | 'emu' | 'ra', AchievementSource> = {
  steam: 'steam',
  emu: 'steam',
  ra: 'ra',
};

const seedDatabase = (dbPath: string, deviceId: string, games: SeedGame[]): Map<string, string> => {
  const local = openLocalDatabase({
    path: dbPath,
    deviceId,
    migrationsFolder: join(process.cwd(), 'drizzle-v2'),
  });
  const gameIds = new Map<string, string>();
  try {
    const ctx = createQueryContext(local);
    ensureThisDevice(ctx, {
      name: MACHINE_NAME,
      home: homedir(),
      appVersion: '0.0.0-e2e',
      schemaVersion: 1,
      now: new Date(),
    });

    for (const [index, seed] of games.entries()) {
      const declared = seed.playthroughs ?? [];
      // La fecha de entrada en el Plan: la del 'plan_to_play' que traiga, como
      // hace el importador con la 1.x.
      const plannedAt = declared
        .flatMap((play) => play.events ?? [])
        .find((event) => event.type === 'plan_to_play')?.at;
      const addedAt = seed.addedAt ?? CHECKED_AT;
      const steamAppId = seed.steamAppId === undefined ? APPID_BASE + index : seed.steamAppId;

      const gameId = seedGame(ctx, {
        title: seed.title,
        endless: seed.endless ?? false,
        isEmulated: seed.isEmulated ?? false,
        notes: seed.notes ?? null,
        addedAt,
        promotedAt: seed.promotedAt ?? null,
        steamAppId,
        metadata: {
          releaseYear: seed.releaseYear ?? null,
          genres: seed.genres ?? null,
          hltbMain: seed.hltb?.main ?? null,
          hltbMainExtras: seed.hltb?.extras ?? null,
          hltbCompletionist: seed.hltb?.completionist ?? null,
        },
        planned: seed.planned
          ? { plannedAt: plannedAt ?? addedAt, pinnedAt: seed.pinnedAt ?? null }
          : undefined,
      });
      gameIds.set(seed.title, gameId);

      // Los tres "ya preguntado" van puestos para que los barridos de fondo
      // del arranque (appids, notas, etiquetas) no tengan nada que hacer: un
      // test no debe esperar a la red ni tocarla sin pedirlo.
      seedCheck(ctx, {
        gameId,
        source: 'steam_appid',
        status: steamAppId === null ? 'empty' : 'ok',
        checkedAt: CHECKED_AT,
      });
      seedCheck(ctx, { gameId, source: 'igdb_ratings', checkedAt: CHECKED_AT });
      seedCheck(ctx, { gameId, source: 'steam_store', checkedAt: CHECKED_AT });

      // Un planeado no tiene playthroughs; uno de la biblioteca sin ninguno
      // declarado nace con uno vacio, como en el alta de verdad.
      const playthroughs: SeedPlaythrough[] = seed.planned
        ? []
        : declared.length > 0
          ? declared
          : [{}];

      // La sesion de la que colgaran los logros conseguidos (ver mas abajo).
      let linkedSession: { id: string; playthroughId: string } | null = null;

      for (const [position, play] of playthroughs.entries()) {
        const label = play.label ?? null;
        const playthroughId = seedPlaythrough(ctx, {
          gameId,
          // La etiqueta automática ya es "Playthrough N": solo se guarda una
          // propia si es otra.
          customLabel: label === `Playthrough ${position + 1}` ? null : label,
          playedPlatform: play.platform ?? 'Steam',
          origin: play.origin ?? 'Purchased',
          format: play.format ?? 'digital',
          manualHours: play.manualHours ?? null,
        });

        for (const session of play.sessions ?? []) {
          // Se guarda la ULTIMA sesion sembrada, que por orden cronologico es
          // la mas reciente: de ella colgaran los logros (abajo), y asi la
          // fila con trofeos es una de las cinco que el historial ensena sin
          // desplegar. En la app de verdad, lo que se saca con el cronometro
          // en marcha queda atado a su sesion igual que aqui.
          const id = seedSession(ctx, {
            playthroughId,
            startedAt: session.at,
            endedAt: new Date(session.at.getTime() + session.hours * 3_600_000),
            source: session.manual ? 'legacy_manual' : 'measured',
          });
          linkedSession = { id, playthroughId };
        }

        for (const event of play.events ?? []) {
          if (event.type === 'plan_to_play') continue;
          seedStateEvent(ctx, {
            playthroughId,
            type: event.type,
            occurredAt: event.at,
            datePrecision: event.precision ?? 'day',
          });
        }
      }

      if (seed.achievements) {
        const { total, unlocked, source = 'steam' } = seed.achievements;
        const catalogSource = ACHIEVEMENT_SOURCE[source];
        const origin: UnlockOrigin = source === 'emu' ? `emu@${deviceId}` : catalogSource;
        const apiNames = Array.from({ length: total }, (_, position) => `E2E_ACH_${position}`);
        seedCatalog(ctx, {
          gameId,
          source: catalogSource,
          fetchedAt: CHECKED_AT,
          items: apiNames.map((apiName, position) => ({
            apiName,
            displayName: `Logro ${position + 1}`,
            description: `Descripcion del logro ${position + 1}`,
            sortIndex: position,
            // Los primeros, mas raros: asi la vitrina tiene con que ordenar
            // y el filtro de "raros" (rareza < umbral) tiene material.
            globalPercent: Math.min(99, 2 + position * 3),
          })),
        });

        for (const [position, apiName] of apiNames.slice(0, unlocked).entries()) {
          // Los dos primeros se cuelgan de esa sesion (si el juego tiene): asi
          // la fila del historial ensena sus trofeos y se puede pulsar uno
          // para aterrizar en la seccion de logros. Solo dos, para que la fila
          // siga siendo una fila y no un desfile.
          const linked = position < 2 ? linkedSession : null;
          seedUnlock(ctx, {
            gameId,
            apiName,
            source: catalogSource,
            origin,
            unlockedAt: new Date(CHECKED_AT.getTime() + position * 3_600_000),
            sessionId: linked?.id ?? null,
            playthroughId: linked?.playthroughId ?? null,
          });
        }
      }
    }
  } finally {
    local.close();
  }
  return gameIds;
};

// machine-saves.json (src/main/saves/machine.ts): de aquí saca la app su
// `deviceId`. Lo mismo que escribiría ella en el primer arranque, con el id
// del sembrado en vez de uno nuevo.
const MACHINE_NAME = 'E2E-PC';
const machineFileFor = (deviceId: string): string =>
  `${JSON.stringify(
    {
      version: 1,
      machineId: deviceId,
      machineName: MACHINE_NAME,
      home: homedir().replace(/\\/g, '/'),
      identity: null,
      saveLocationOverrides: {},
    },
    null,
    2,
  )}\n`;

export type SandboxOptions = {
  games?: SeedGame[];
  credentials?: Partial<CredentialsValues>;
  saveStorageProvider?: SaveStorageProvider;
};

export const createSandbox = async ({
  games = DEFAULT_SEED,
  credentials = {},
  saveStorageProvider,
}: SandboxOptions = {}): Promise<Sandbox> => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'afterplay-e2e-'));
  const dbPath = join(userDataDir, LOCAL_DATABASE_FILE);
  const deviceId = randomUUID();

  const gameIds = seedDatabase(dbPath, deviceId, games);
  writeFileSync(join(userDataDir, 'machine-saves.json'), machineFileFor(deviceId));
  writeFileSync(join(userDataDir, 'credentials.json'), credentialsFileFor(credentials));
  if (saveStorageProvider) {
    writeFileSync(
      join(userDataDir, 'config.json'),
      JSON.stringify({ saveStorageProvider }, null, 2),
    );
  }

  return {
    userDataDir,
    dbPath,
    gameIds,
    // BEST EFFORT DE VERDAD, no solo en el comentario. `force: true` ignora
    // que el fichero NO EXISTA, pero no que este OCUPADO: en Windows, cerrar
    // la app y borrar su carpeta en el mismo suspiro da EBUSY sobre
    // Afterplay2.db mas o menos una vez de cada veinte — el proceso ya murio
    // pero el handle del driver nativo tarda un pelin mas en soltarse. Eso
    // tumbaba un test YA PASADO, que es la peor forma de rojo: el fallo no
    // esta donde apunta.
    //
    // Se reintenta un par de veces con una pausa corta y, si aun asi se
    // resiste, se calla: lo que quede se lo lleva el `pretest` de la
    // siguiente pasada (scripts/clean-test-temp.ts) o el propio %TEMP%.
    cleanup: () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
          return;
        } catch {
          // 40ms de nada: lo que tarda el handle nativo en soltarse.
          const until = Date.now() + 40;
          while (Date.now() < until) {
            /* espera activa: aqui no hay await posible (cleanup es sincrono) */
          }
        }
      }
    },
  };
};
