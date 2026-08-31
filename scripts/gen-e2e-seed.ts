import { writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

// EL GENERADOR DE LA BIBLIOTECA DE PRUEBA, A PARTIR DE UNA REAL.
//
// Uso: tsx scripts/gen-e2e-seed.ts <ruta a un .db de Afterplay>
// Escribe e2e/seed.ts, que SI se commitea. Este script no corre en la suite:
// se ejecuta a mano cuando haga falta refrescar la muestra.
//
// POR QUE NO INVENTARSE LOS DATOS. La primera siembra E2E eran tres juegos a
// ojo ("Hollow Knight E2E" con 27 horas) y se quedaba corta justo donde esta
// app es dificil: todo lo que se ve en pantalla —estado, horas, fechas— se
// DERIVA de un log de eventos, y un juego con un playthrough limpio no
// ejercita ni una de las decisiones peliagudas. La biblioteca real, en
// cambio, tiene Assassin's Creed II con DOS playthroughs, uno fechado "2021"
// a secas y otro con dia exacto, y horas manuales distintas en cada uno.
// Escenarios asi no se le ocurren a nadie de memoria: se cogen prestados.
//
// QUE SE COGE Y QUE NO. Una muestra CURADA, no la biblioteca entera: se eligen
// a mano los titulos que representan cada forma distinta (abajo, con el
// porque de cada uno). Meter los 1.001 juegos y sus 39.881 logros haria que
// cada test pagase segundos de siembra para mirar tres filas, y ademas
// convertiria el repositorio en una copia de la biblioteca personal del dueno.
// Se recortan tambien las sesiones (las 6 primeras) y los logros (a decenas).
//
// LOS DATOS SON REALES pero no son secretos: titulos, anos, appids publicos de
// Steam y cuantas horas se jugo a que. Nada de credenciales, rutas locales ni
// notas personales (las notas NO se copian, ver mas abajo).
const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('uso: tsx scripts/gen-e2e-seed.ts <ruta al .db>');
  process.exit(1);
}

// La muestra curada. El comentario de cada uno es lo que aporta al sembrado:
// si alguien quita uno, sabe que forma se esta quedando sin cubrir.
const WANTED: { title: string; why: string }[] = [
  {
    title: "Assassin's Creed II",
    why: 'DOS playthroughs, con precision de fecha distinta y horas propias',
  },
  { title: 'Strange Horticulture', why: 'dos playthroughs Y sesiones medidas de verdad' },
  { title: '007 First Light', why: 'el mas jugado: 20 sesiones medidas (se recortan a 6)' },
  { title: 'Halls of Torment', why: 'muchos logros y a medio sacar (500/223 reales)' },
  { title: 'Terraria', why: 'logros ademas de horas; juego largo de biblioteca' },
  { title: '112 Operator', why: 'ENDLESS: sin final, nunca cuenta como backlog' },
  { title: "The Legend of Zelda: Link's Awakening", why: 'EMULADO y sin appid de Steam' },
  { title: 'Alan Wake', why: 'ABANDONADO (dropped): el desenlace que no es "terminado"' },
  { title: 'Octopath Traveler', why: 'PLANEADO y fijado en Up next' },
  { title: 'Chrono Trigger', why: 'PLANEADO y fijado: hacen falta dos para probar el orden' },
  { title: 'Behind the Frame: The Finest Scenery', why: 'PLANEADO normal, sin fijar' },
];

const SESSION_CAP = 6;
const ACH_TOTAL_CAP = 24;

type Row = Record<string, unknown>;

const iso = (value: unknown): string | null =>
  typeof value === 'number' ? new Date(value).toISOString() : null;

const main = async (): Promise<void> => {
  const client = createClient({ url: `file:${SOURCE}` });
  const q = async (sql: string, args: unknown[] = []): Promise<Row[]> =>
    (await client.execute({ sql, args: args as never[] })).rows as unknown as Row[];

  const parts: string[] = [];

  for (const { title, why } of WANTED) {
    const [game] = await q(
      `select id, title, planned, planPinnedAt, endless, isEmulated, steamAppId,
              releaseYear, genres, hltbMain, hltbMainExtras, hltbCompletionist
       from games where title = ? limit 1`,
      [title],
    );
    if (!game) {
      console.warn(`[seed] no encontrado, se salta: ${title}`);
      continue;
    }

    const iterations = await q(
      `select id, label, playedPlatform, origin, format, manualTotalPlayed
       from iterations where gameId = ? order by id`,
      [game.id],
    );

    const plays: string[] = [];
    for (const it of iterations) {
      const events = await q(
        `select type, occurredAt, datePrecision from state_events
         where iterationId = ? order by occurredAt`,
        [it.id],
      );
      const sessions = await q(
        `select startedAt, durationSec, isManual from sessions
         where iterationId = ? order by startedAt limit ${SESSION_CAP}`,
        [it.id],
      );

      const eventLines = events.map(
        (e) =>
          `        { type: '${String(e.type)}', at: new Date('${iso(e.occurredAt)}'), precision: '${String(e.datePrecision)}' },`,
      );
      const sessionLines = sessions.map((s) => {
        const hours = Math.round(((s.durationSec as number) / 3600) * 100) / 100;
        return `        { at: new Date('${iso(s.startedAt)}'), hours: ${hours}${s.isManual ? ', manual: true' : ''} },`;
      });

      plays.push(
        [
          '      {',
          `        label: ${JSON.stringify(it.label)},`,
          `        platform: ${JSON.stringify(it.playedPlatform)},`,
          `        origin: ${JSON.stringify(it.origin)},`,
          it.format ? `        format: ${JSON.stringify(it.format)},` : null,
          it.manualTotalPlayed !== null ? `        manualHours: ${it.manualTotalPlayed},` : null,
          eventLines.length ? `        events: [\n${eventLines.join('\n')}\n        ],` : null,
          sessionLines.length
            ? `        sessions: [\n${sessionLines.join('\n')}\n        ],`
            : null,
          '      },',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    const [ach] = await q(
      `select count(distinct a.id) total, count(distinct u.achievementId) unlocked
       from achievements a left join achievement_unlocks u on u.achievementId = a.id
       where a.gameId = ?`,
      [game.id],
    );
    const total = Number(ach?.total ?? 0);
    const unlocked = Number(ach?.unlocked ?? 0);
    // Se conserva la PROPORCION real, recortada: lo que importa de una vitrina
    // de logros es que este a medias, no que tenga quinientos.
    const seedTotal = total > 0 ? Math.min(total, ACH_TOTAL_CAP) : 0;
    const seedUnlocked = total > 0 ? Math.round((unlocked / total) * seedTotal) : 0;

    const genres = game.genres ? (JSON.parse(String(game.genres)) as string[]) : null;

    parts.push(
      [
        `  // ${why}`,
        '  {',
        `    title: ${JSON.stringify(game.title)},`,
        game.planned ? '    planned: true,' : null,
        game.planPinnedAt ? `    pinnedAt: new Date('${iso(game.planPinnedAt)}'),` : null,
        game.endless ? '    endless: true,' : null,
        game.isEmulated ? '    isEmulated: true,' : null,
        `    steamAppId: ${game.steamAppId === null ? 'null' : game.steamAppId},`,
        game.releaseYear ? `    releaseYear: ${game.releaseYear},` : null,
        genres?.length ? `    genres: ${JSON.stringify(genres)},` : null,
        game.hltbMain || game.hltbMainExtras || game.hltbCompletionist
          ? `    hltb: { main: ${game.hltbMain ?? 'null'}, extras: ${game.hltbMainExtras ?? 'null'}, completionist: ${game.hltbCompletionist ?? 'null'} },`
          : null,
        seedTotal > 0
          ? `    achievements: { total: ${seedTotal}, unlocked: ${seedUnlocked} },`
          : null,
        plays.length ? `    playthroughs: [\n${plays.join('\n')}\n    ],` : null,
        '  },',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const header = `import type { SeedGame } from './sandbox';

// LA BIBLIOTECA DE PRUEBA DE LOS TESTS E2E.
//
// GENERADO por scripts/gen-e2e-seed.ts a partir de una copia de la biblioteca
// real del dueno. No se edita a mano: si hace falta otra forma, se anade el
// titulo a WANTED en el generador y se vuelve a lanzar.
//
// POR QUE DATOS REALES: en esta app todo lo que se ve —estado, horas, fechas—
// se DERIVA de un log de eventos, y un sembrado inventado a ojo (un juego, un
// playthrough limpio) no ejercita ninguna de las decisiones dificiles. Aqui
// hay dos playthroughs con precision de fecha distinta, horas tecleadas
// conviviendo con sesiones medidas, un emulado sin appid, un abandonado, un
// endless y dos planeados fijados en Up next. Cada juego lleva escrito para
// que esta.
//
// Son datos reales pero no secretos: titulos, anos, appids publicos y horas.
// Sin notas personales, sin rutas locales, sin credenciales.
export const DEFAULT_SEED: SeedGame[] = [
`;

  writeFileSync('e2e/seed.ts', `${header}${parts.join('\n')}\n];\n`, 'utf-8');
  client.close();
  console.log(`[seed] e2e/seed.ts escrito con ${parts.length} juegos`);
};

void main();
