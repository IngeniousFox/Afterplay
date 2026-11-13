// Datos SINTÉTICOS con el volumen real medido el 2026-11-13 (§20.1.1).
// Deterministas (PRNG con semilla): el banco y el DO generan lo mismo.
// Nada sale de datos personales: títulos "Game 0001", ids derivados del índice.
import type { SyncedTableName } from './schema';

export const VOLUME = {
  games: 1011,
  playthroughs: 1014,
  sessions: 278,
  state_events: 1280,
  achievements: 40452,
} as const;

export type TransitRow = {
  table: SyncedTableName;
  id: string;
  created: string;
  deleted: string | null;
  fields: Record<string, unknown>;
  clocks: Record<string, string>;
};

// Reloj HLC de §8.2: <ms 13>-<contador 4>-<dispositivo>
export const clock = (ms: number, counter = 0, device = 'dev001') =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${device}`;

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = (n: number, w = 5) => String(n).padStart(w, '0');
// Ids con forma de UUID (36 caracteres), para que el tamaño de índice sea realista.
const uuidish = (kind: string, n: number) =>
  `0194c2f0-${kind.padEnd(4, '0').slice(0, 4)}-7${pad(n % 1000, 3)}-8000-${pad(n, 12)}`;

export const gameId = (i: number) => uuidish('game', i);
export const playthroughId = (i: number) => uuidish('ptpt', i);

const BASE_MS = Date.UTC(2019, 0, 1);
const NOW_MS = Date.UTC(2026, 10, 13);

export function* syntheticRows(only?: SyncedTableName): Generator<TransitRow> {
  const rnd = mulberry32(42);
  const at = (i: number, total: number) => BASE_MS + Math.floor(((NOW_MS - BASE_MS) * i) / total);

  if (!only || only === 'games')
    for (let i = 0; i < VOLUME.games; i++) {
      const ms = at(i, VOLUME.games);
      yield {
        table: 'games',
        id: gameId(i),
        created: clock(ms),
        deleted: null,
        fields: {
          title: `Synthetic Game ${pad(i, 4)} ${['Saga', 'Odyssey', 'Tactics', 'Remastered'][i % 4]}`,
          igdbId: 100000 + i,
          steamAppId: i % 3 === 0 ? null : 200000 + i,
          coverOverride: i % 10 === 0 ? `https://images.example.invalid/cover/${i}.jpg` : null,
          notes: i % 7 === 0 ? 'Nota sintética de prueba '.repeat(3) : null,
          endless: i % 25 === 0 ? 1 : 0,
          addedAt: ms,
          promotedAt: i % 9 === 0 ? ms + 86400000 : null,
          saveKey: String(100000 + i),
        },
        clocks: {},
      };
    }

  if (!only || only === 'playthroughs')
    for (let i = 0; i < VOLUME.playthroughs; i++) {
      // 3 juegos con un segundo playthrough
      const g = i < VOLUME.games ? i : i - VOLUME.games;
      const ms = at(g, VOLUME.games) + 3600000;
      yield {
        table: 'playthroughs',
        id: playthroughId(i),
        created: clock(ms),
        deleted: null,
        fields: {
          gameId: gameId(g),
          playedPlatform: ['pc', 'switch', 'ps5'][i % 3],
          origin: 'owned',
          format: 'digital',
          manualHours: rnd() < 0.33 ? Math.round(rnd() * 800) / 10 : null,
          rating: i % 4 === 0 ? 1 + (i % 5) : null,
        },
        clocks: {},
      };
    }

  if (!only || only === 'state_events') {
    const types = ['started', 'completed', 'dropped', 'on_hold', 'resting'];
    for (let i = 0; i < VOLUME.state_events; i++) {
      const p = i % VOLUME.playthroughs;
      const round = Math.floor(i / VOLUME.playthroughs);
      const ms = at(p % VOLUME.games, VOLUME.games) + (round + 1) * 86400000 * 3;
      yield {
        table: 'state_events',
        id: uuidish('evnt', i),
        created: clock(ms),
        deleted: null,
        fields: {
          playthroughId: playthroughId(p),
          type: round === 0 ? 'started' : types[1 + Math.floor(rnd() * 4)],
          occurredAt: ms,
          datePrecision: rnd() < 0.2 ? 'unknown' : 'day',
          deviceId: 'dev001',
        },
        clocks: {},
      };
    }
  }

  if (!only || only === 'sessions')
    for (let i = 0; i < VOLUME.sessions; i++) {
      const p = Math.floor(rnd() * 120); // concentradas en pocos playthroughs
      const ms = NOW_MS - Math.floor(rnd() * 500) * 86400000;
      const dur = 600 + Math.floor(rnd() * 3 * 3600);
      yield {
        table: 'sessions',
        id: uuidish('sess', i),
        created: clock(ms),
        deleted: null,
        fields: {
          playthroughId: playthroughId(p),
          deviceId: i % 2 ? 'dev001' : 'dev002',
          startedBy: 'watcher',
          source: 'measured',
          startedAt: ms,
          endedAt: ms + dur * 1000,
          durationSec: dur,
          datePrecision: 'datetime',
          lastSeenAt: ms + dur * 1000,
          closedBy: 'owner',
        },
        clocks: {},
      };
    }

  if (!only || only === 'achievements') {
    // 40.452 logros repartidos en ~600 juegos (unos 67 por juego).
    let n = 0;
    for (let g = 0; n < VOLUME.achievements; g++) {
      const count = Math.min(30 + ((g * 37) % 75), VOLUME.achievements - n);
      for (let k = 0; k < count; k++, n++) {
        const ms = at(g % VOLUME.games, VOLUME.games) + 7200000;
        const apiName = `ACH_${pad(k, 3)}_SYNTH`;
        const gid = gameId(g % VOLUME.games);
        yield {
          table: 'achievements',
          id: `${gid}:steam:${apiName}`,
          created: clock(ms),
          deleted: null,
          fields: {
            gameId: gid,
            source: 'steam',
            apiName,
            displayName: `Synthetic achievement ${k}`,
            description: `Do the synthetic thing number ${k} in a synthetic way.`,
            iconUrl: `https://cdn.example.invalid/apps/${200000 + g}/${'a'.repeat(40)}.jpg`,
            iconGrayUrl: `https://cdn.example.invalid/apps/${200000 + g}/${'b'.repeat(40)}.jpg`,
            hidden: k % 11 === 0 ? 1 : 0,
            globalPercent: Math.round(rnd() * 1000) / 10,
            sortIndex: k,
          },
          clocks: {},
        };
      }
    }
  }
}
