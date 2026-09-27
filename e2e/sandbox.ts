import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  achievementsTable,
  achievementUnlocksTable,
  gamesTable,
  iterationsTable,
  sessionsTable,
  stateEventsTable,
} from '../src/main/db/schema';
import type { CredentialsValues, SaveStorageProvider } from '../src/shared/types';
import { credentialsForSandbox } from './credentials';
import { DEFAULT_SEED } from './seed';

// LA CARPETA DE DATOS DESECHABLE DE CADA TEST E2E.
//
// Un test de extremo a extremo arranca la app DE VERDAD, y una app de verdad
// escribe: su base, sus credenciales, sus copias, su caché de imágenes, su
// config. Aquí se le fabrica un mundo entero de mentira en %TEMP% para que
// todo eso caiga ahí y se borre al terminar — la instalación del dueño ni se
// entera, y su base de producción es literalmente inalcanzable (el gate de
// src/main/lib/e2e.ts, que se enciende con la MISMA variable que trae esta
// carpeta, apaga la importación del .env y el sync remoto).
//
// LA BASE SE SIEMBRA DESDE FUERA, con las migraciones REALES del repo (las
// mismas de drizzle/, igual que el andamio de los tests de unidad): así un
// test no depende de la red ni del alta por IGDB para tener biblioteca, y una
// migración que rompa el esquema tumba estos tests antes que la app de nadie.
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
// (NavRail lo hace cuando faltan las de IGDB) y todos los tests empezarían
// con un modal delante. Con ellas la app se comporta como una instalación
// configurada, y los tests que necesiten red se saltan solos.

export type Sandbox = {
  userDataDir: string;
  dbPath: string;
  // Si este sandbox lleva credenciales de Turso (o sea, si el test pidió
  // sync). El arranque lo necesita para decidir si abre esa puerta.
  withRemote: boolean;
  cleanup: () => void;
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
  // null = no esta en Steam (retro emulado). Sin poner, se inventa uno y se
  // marca como "ya comprobado" para que los barridos de fondo del arranque no
  // tengan nada que buscar: un test no debe esperar a la red ni tocarla.
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
  // Los playthroughs. Sin esto el juego nace con uno vacio (lo que crea el
  // alta de verdad), que es la forma de un juego "intacto".
  playthroughs?: SeedPlaythrough[];
  // Logros SINTETICOS: se generan `total` definiciones y se desbloquean las
  // `unlocked` primeras. Las cifras salen de juegos reales pero recortadas --
  // sembrar los 39.881 logros de la biblioteca real en cada test seria pagar
  // segundos por arranque para pintar una barra de progreso.
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

const credentialsFileFor = (
  withRemote: boolean,
  overrides: Partial<CredentialsValues> = {},
): string => {
  if (!withRemote && (overrides.databaseUrl || overrides.databaseAuthToken)) {
    throw new Error(
      'An E2E sandbox cannot receive remote database credentials without withRemote.',
    );
  }
  const fromEnvTest = credentialsForSandbox(withRemote);
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

const seedDatabase = async (dbPath: string, games: SeedGame[]): Promise<void> => {
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle({ client });
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });

    for (const [index, seed] of games.entries()) {
      const [game] = await db
        .insert(gamesTable)
        .values({
          title: seed.title,
          planned: seed.planned ?? false,
          planPinnedAt: seed.pinnedAt ?? null,
          endless: seed.endless ?? false,
          isEmulated: seed.isEmulated ?? false,
          notes: seed.notes ?? null,
          releaseYear: seed.releaseYear ?? null,
          genres: seed.genres ?? null,
          hltbMain: seed.hltb?.main ?? null,
          hltbMainExtras: seed.hltb?.extras ?? null,
          hltbCompletionist: seed.hltb?.completionist ?? null,
          addedAt: seed.addedAt ?? CHECKED_AT,
          promotedAt: seed.promotedAt ?? null,
          steamAppId: seed.steamAppId === undefined ? APPID_BASE + index : seed.steamAppId,
          // Los cuatro "ya preguntado" van puestos para que los barridos de
          // fondo del arranque (appids, notas, etiquetas) no tengan nada que
          // hacer: un test no debe esperar a la red ni tocarla sin pedirlo.
          steamAppIdCheckedAt: CHECKED_AT,
          ratingsCheckedAt: CHECKED_AT,
          steamSpyCheckedAt: CHECKED_AT,
        })
        .returning({ id: gamesTable.id });

      // Sin playthroughs declarados, uno vacio: es lo que crea el alta de
      // verdad, o sea la forma de un juego recien anadido y sin tocar.
      const playthroughs: SeedPlaythrough[] = seed.playthroughs?.length ? seed.playthroughs : [{}];

      // La sesion de la que colgaran los logros conseguidos (ver mas abajo).
      let linkedSession: { id: number; iterationId: number } | null = null;

      for (const [position, play] of playthroughs.entries()) {
        const [iteration] = await db
          .insert(iterationsTable)
          .values({
            gameId: game.id,
            label: play.label ?? `Playthrough ${position + 1}`,
            playedPlatform: play.platform ?? 'Steam',
            origin: play.origin ?? 'Purchased',
            format: play.format ?? 'digital',
            manualTotalPlayed: play.manualHours ?? null,
          })
          .returning({ id: iterationsTable.id });

        // Ni sessions ni state_events llevan gameId: cuelgan de la ITERACION,
        // y de ahi sale el juego. Drizzle ignoraba en silencio un gameId de
        // mas -- lo caza el typecheck de tsconfig.e2e.json.
        for (const session of play.sessions ?? []) {
          const [row] = await db
            .insert(sessionsTable)
            .values({
              iterationId: iteration.id,
              startedAt: session.at,
              endedAt: new Date(session.at.getTime() + session.hours * 3_600_000),
              durationSec: Math.round(session.hours * 3600),
              isManual: session.manual ?? false,
              startedBy: 'watcher',
              datePrecision: 'datetime',
            })
            .returning({ id: sessionsTable.id });
          // Se guarda la ULTIMA sesion sembrada, que por orden cronologico es
          // la mas reciente: de ella colgaran los logros (abajo), y asi la
          // fila con trofeos es una de las cinco que el historial ensena sin
          // desplegar. En la app de verdad, lo que se saca con el cronometro
          // en marcha queda atado a su sesion igual que aqui.
          linkedSession = { id: row.id, iterationId: iteration.id };
        }

        for (const event of play.events ?? []) {
          await db.insert(stateEventsTable).values({
            iterationId: iteration.id,
            type: event.type,
            occurredAt: event.at,
            datePrecision: event.precision ?? 'day',
          });
        }
      }

      if (seed.achievements) {
        const { total, unlocked, source = 'steam' } = seed.achievements;
        const rows = await db
          .insert(achievementsTable)
          .values(
            Array.from({ length: total }, (_, position) => ({
              gameId: game.id,
              apiName: `E2E_ACH_${position}`,
              displayName: `Logro ${position + 1}`,
              description: `Descripcion del logro ${position + 1}`,
              sortIndex: position,
              // Los primeros, mas raros: asi la vitrina tiene con que ordenar
              // y el filtro de "raros" (rareza < umbral) tiene material.
              globalPercent: Math.min(99, 2 + position * 3),
            })),
          )
          .returning({ id: achievementsTable.id });

        for (const [position, row] of rows.slice(0, unlocked).entries()) {
          // Los dos primeros se cuelgan de esa sesion (si el juego tiene): asi
          // la fila del historial ensena sus trofeos y se puede pulsar uno
          // para aterrizar en la seccion de logros. Solo dos, para que la fila
          // siga siendo una fila y no un desfile.
          const linked = position < 2 ? linkedSession : null;
          await db.insert(achievementUnlocksTable).values({
            achievementId: row.id,
            unlockedAt: new Date(CHECKED_AT.getTime() + position * 3_600_000),
            source,
            sessionId: linked?.id ?? null,
            iterationId: linked?.iterationId ?? null,
          });
        }
      }
    }
  } finally {
    client.close();
  }
};

export type SandboxOptions = {
  games?: SeedGame[];
  credentials?: Partial<CredentialsValues>;
  saveStorageProvider?: SaveStorageProvider;
  // SINCRONIZAR CON TURSO: apagado salvo que un test lo pida, y con motivo.
  // Una remota compartida le mete al sandbox juegos que el test no sembró (o
  // sea, tests que dejan de ser deterministas) y se lleva los de mentira
  // puestos para siempre. Quien lo encienda, que apunte a una base
  // DESECHABLE, no a la que usa a mano.
  withRemote?: boolean;
};

export const createSandbox = async ({
  games = DEFAULT_SEED,
  withRemote = false,
  credentials = {},
  saveStorageProvider,
}: SandboxOptions = {}): Promise<Sandbox> => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'afterplay-e2e-'));
  const dbPath = join(userDataDir, 'Afterplay.db');

  await seedDatabase(dbPath, games);
  writeFileSync(join(userDataDir, 'credentials.json'), credentialsFileFor(withRemote, credentials));
  if (saveStorageProvider) {
    writeFileSync(
      join(userDataDir, 'config.json'),
      JSON.stringify({ saveStorageProvider }, null, 2),
    );
  }

  return {
    userDataDir,
    dbPath,
    withRemote,
    // BEST EFFORT DE VERDAD, no solo en el comentario. `force: true` ignora
    // que el fichero NO EXISTA, pero no que este OCUPADO: en Windows, cerrar
    // la app y borrar su carpeta en el mismo suspiro da EBUSY sobre
    // Afterplay.db mas o menos una vez de cada veinte — el proceso ya murio
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
