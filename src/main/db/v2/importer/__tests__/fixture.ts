import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { DEFAULT_SEED } from '../../../../../../e2e/seed';
import { openTestDb } from '../../__tests__/helpers';
import type { LocalDatabase } from '../../connection';

// Bases 1.x SINTÉTICAS para los tests del importador: el esquema real de la
// 1.x (sus migraciones de `drizzle/`) en memoria, y filas inventadas. Nunca
// datos personales.

export const DAY = 86_400_000;
/** 2024-01-01T00:00:00Z. */
export const T = Date.UTC(2024, 0, 1);

export class LegacyDb {
  readonly client = new DatabaseSync(':memory:');

  constructor() {
    migrate(drizzle({ client: this.client }), { migrationsFolder: 'drizzle' });
  }

  /** Inserta una fila y devuelve su id. Las columnas omitidas toman su DEFAULT. */
  insert(table: string, values: Record<string, SQLInputValue>): number {
    const columns = Object.keys(values);
    const result = this.client
      .prepare(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      )
      .run(...columns.map((c) => values[c]));
    return Number(result.lastInsertRowid);
  }

  game(values: Record<string, SQLInputValue> = {}): number {
    return this.insert('games', { title: 'Juego', addedAt: T, ...values });
  }

  iteration(gameId: number, values: Record<string, SQLInputValue> = {}): number {
    return this.insert('iterations', {
      gameId,
      label: 'Playthrough 1',
      playedPlatform: 'PC',
      origin: 'Purchased',
      format: 'digital',
      ...values,
    });
  }

  event(
    iterationId: number,
    type: string,
    occurredAt: number,
    values: Record<string, SQLInputValue> = {},
  ): number {
    return this.insert('state_events', {
      iterationId,
      type,
      occurredAt,
      datePrecision: 'day',
      ...values,
    });
  }

  session(
    iterationId: number | null,
    startedAt: number,
    hours: number,
    values: Record<string, SQLInputValue> = {},
  ): number {
    const durationSec = Math.round(hours * 3600);
    return this.insert('sessions', {
      iterationId,
      startedAt,
      endedAt: startedAt + durationSec * 1000,
      durationSec,
      lastHeartbeatAt: startedAt + durationSec * 1000,
      startedBy: 'watcher',
      datePrecision: 'datetime',
      ...values,
    });
  }

  close(): void {
    this.client.close();
  }
}

export function openTarget(): LocalDatabase {
  return openTestDb({ wall: () => Date.UTC(2027, 0, 1) });
}

/**
 * La semilla de los e2e (`e2e/seed.ts`), escrita en una base 1.x igual que la
 * siembra `e2e/sandbox.ts` (que es asíncrona y no se exporta).
 */
export function seedDefault(db: LegacyDb): void {
  const checked = Date.UTC(2026, 0, 1);
  for (const [index, seed] of DEFAULT_SEED.entries()) {
    const gameId = db.game({
      title: seed.title,
      planned: seed.planned ? 1 : 0,
      planPinnedAt: seed.pinnedAt?.getTime() ?? null,
      endless: seed.endless ? 1 : 0,
      isEmulated: seed.isEmulated ? 1 : 0,
      notes: seed.notes ?? null,
      releaseYear: seed.releaseYear ?? null,
      genres: seed.genres ? JSON.stringify(seed.genres) : null,
      hltbMain: seed.hltb?.main ?? null,
      hltbMainExtras: seed.hltb?.extras ?? null,
      hltbCompletionist: seed.hltb?.completionist ?? null,
      addedAt: seed.addedAt?.getTime() ?? checked,
      promotedAt: seed.promotedAt?.getTime() ?? null,
      steamAppId: seed.steamAppId === undefined ? 1_000_000 + index : seed.steamAppId,
      steamAppIdCheckedAt: checked,
      ratingsCheckedAt: checked,
      steamSpyCheckedAt: checked,
    });
    const playthroughs = seed.playthroughs?.length ? seed.playthroughs : [{}];
    let linked: { session: number; iteration: number } | null = null;
    for (const [position, play] of playthroughs.entries()) {
      const iteration = db.iteration(gameId, {
        label: play.label ?? `Playthrough ${position + 1}`,
        playedPlatform: play.platform ?? 'Steam',
        manualTotalPlayed: play.manualHours ?? null,
      });
      for (const s of play.sessions ?? []) {
        linked = {
          session: db.session(iteration, s.at.getTime(), s.hours, { isManual: s.manual ? 1 : 0 }),
          iteration,
        };
      }
      for (const e of play.events ?? [])
        db.event(iteration, e.type, e.at.getTime(), { datePrecision: e.precision ?? 'day' });
    }
    if (seed.achievements) {
      const { total, unlocked, source = 'steam' } = seed.achievements;
      for (let position = 0; position < total; position++) {
        const achievement = db.insert('achievements', {
          gameId,
          apiName: `E2E_ACH_${position}`,
          displayName: `Logro ${position + 1}`,
          description: `Descripcion ${position + 1}`,
          sortIndex: position,
          globalPercent: Math.min(99, 2 + position * 3),
        });
        if (position < unlocked) {
          const link = position < 2 ? linked : null;
          db.insert('achievement_unlocks', {
            achievementId: achievement,
            unlockedAt: checked + position * 3_600_000,
            source,
            sessionId: link?.session ?? null,
            iterationId: link?.iteration ?? null,
          });
        }
      }
    }
  }
}
