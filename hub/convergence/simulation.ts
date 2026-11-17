// Simulación aleatoria para las propiedades de convergencia (§17.2): secuencias
// de escrituras locales (por las consultas reales), cortes de red, reconexiones,
// sincronizaciones y paso del tiempo sobre 3 clientes y un hub. Reproducible:
// todo sale de un generador con semilla.

import { isGameWriteError } from '../../src/main/db/v2/queries/games/errors';
import { createGameWithDetails } from '../../src/main/db/v2/queries/games/createGameWithDetails';
import { createPlannedGame } from '../../src/main/db/v2/queries/games/createPlannedGame';
import { promotePlannedGame } from '../../src/main/db/v2/queries/games/promotePlannedGame';
import { getGames } from '../../src/main/db/v2/queries/library/getGames';
import { getGameById } from '../../src/main/db/v2/queries/library/getGameById';
import { getPlannedGames } from '../../src/main/db/v2/queries/library/getPlannedGames';
import {
  createIteration,
  deleteIteration,
  updateIteration,
} from '../../src/main/db/v2/queries/playthroughs/playthroughs';
import { addSpendEvent } from '../../src/main/db/v2/queries/playthroughs/spend';
import {
  addStateEvent,
  deleteStateEvent,
} from '../../src/main/db/v2/queries/playthroughs/stateEvents';
import { applyRefreshGameResult } from '../../src/main/db/v2/queries/external/refreshGame';
import { readExternalSnapshot } from '../../src/main/db/v2/queries/external/snapshot';
import { getAllSessions } from '../../src/main/db/v2/queries/sessions/read';
import { closeSession } from '../../src/main/db/v2/queries/sessions/close';
import { deleteSession, updateSessionNote } from '../../src/main/db/v2/queries/sessions/edit';
import { startGameSession } from '../../src/main/db/v2/queries/sessions/start';
import {
  createInput,
  enrichment,
  planInput,
  promoteInput,
  EUR,
} from '../../src/main/db/v2/queries/games/__tests__/helpers';
import { isStoreError } from '../../src/main/db/v2/store';
import { removeGame, setCoverOverride, setNotes } from './actions';
import { HOUR_MS, MINUTE_MS, World, type Client } from './harness';

/** mulberry32: pequeño, rápido y suficiente para repartir operaciones. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(items.length)];
  }
}

/** Los juegos de IGDB que se reparten los PCs: pocos, para que choquen a menudo. */
const IGDB_POOL = [7001, 7002, 7003, 7004, 7005, 7006];

export interface SimulationOptions {
  seed: number;
  steps: number;
  /** Número de clientes (3 en las propiedades del arnés). */
  clients?: number;
  /**
   * Además, relojes de pared que se adelantan por encima de la tolerancia del
   * hub (§8.2) y luego se corrigen: ejerce el rechazo `clock_ahead` y la
   * recuperación del motor con datos aleatorios.
   */
  clockFaults?: boolean;
}

export interface SimulationResult {
  world: World;
  /** Rastro de operaciones (para reproducir y diagnosticar). */
  trace: string[];
  /** Cuántas escrituras de dominio salieron adelante (no rechazadas por una regla esperada). */
  writes: number;
}

/** Rechazos legítimos de las reglas de dominio: una operación al azar puede no ser aplicable. */
const isExpectedRejection = (error: unknown): boolean =>
  isStoreError(error) || isGameWriteError(error);

export async function runSimulation(options: SimulationOptions): Promise<SimulationResult> {
  const rng = new Rng(options.seed);
  // Los límites del hub cambian por ejecución: lotes pequeños fuerzan varias
  // subidas y bajadas por ciclo (paginación, §8.4).
  const limits = rng.chance(0.5)
    ? { pushMaxRows: 2 + rng.int(8), pullPageRows: 2 + rng.int(8) }
    : undefined;
  const world = new World({ hub: limits ? { limits } : {} });
  const trace: string[] = [
    `semilla ${options.seed}`,
    `límites ${JSON.stringify(limits ?? 'por defecto')}`,
  ];
  const clients: Client[] = [];
  const skews = new Map<string, number>();
  /** Clientes con el reloj de pared adelantado a propósito. */
  const ahead = new Set<Client>();
  for (let i = 0; i < (options.clients ?? 3); i++) {
    // Desfase de reloj dentro de la tolerancia del hub (10 min): es el
    // escenario normal de PCs que no están a la misma hora.
    const skewMs = (rng.int(9) - 4) * MINUTE_MS;
    clients.push(await world.addClient('abcdefgh'[i], { skewMs }));
    skews.set('abcdefgh'[i], skewMs);
    trace.push(`cliente ${'abcdefgh'[i]} desfase ${skewMs / MINUTE_MS} min`);
  }

  const open = new Map<string, string[]>(); // sesiones que este PC dejó abiertas
  let writes = 0;
  let titleCounter = 0;

  const libraryIds = (c: Client): string[] => getGames(c.ctx).map((g) => g.id);
  const anyGameId = (c: Client): string | undefined => rng.pick(libraryIds(c));

  /** Una operación de dominio sobre `c`. Devuelve su nombre, o null si no era aplicable. */
  const domainOp = (c: Client): string | null => {
    const roll = rng.int(100);
    if (roll < 14) {
      const igdbId = rng.pick(IGDB_POOL)!;
      const title = `Juego ${igdbId} (${c.name}${titleCounter++})`;
      createGameWithDetails(
        c.ctx,
        createInput({
          source: { igdbId },
          gameNotes: rng.chance(0.5) ? `notas ${c.name}${titleCounter}` : null,
        }),
        enrichment({ igdbId, title, hltbMain: rng.int(60) }),
        EUR,
      );
      return `addGame ${igdbId}`;
    }
    if (roll < 20) {
      const igdbId = rng.pick(IGDB_POOL)!;
      createPlannedGame(
        c.ctx,
        planInput({ source: { igdbId } }),
        enrichment({ igdbId, title: `Plan ${igdbId} ${c.name}` }),
      );
      return `planGame ${igdbId}`;
    }
    if (roll < 24) {
      const planned = getPlannedGames(c.ctx);
      const target = rng.pick(planned);
      if (!target) return null;
      promotePlannedGame(c.ctx, promoteInput(target.id));
      return `promote ${target.id.slice(0, 8)}`;
    }
    if (roll < 32) {
      const id = anyGameId(c);
      if (!id) return null;
      setNotes(c, id, rng.chance(0.2) ? null : `nota ${c.name}${titleCounter++}`);
      return `notes ${id.slice(0, 8)}`;
    }
    if (roll < 36) {
      const id = anyGameId(c);
      if (!id) return null;
      setCoverOverride(
        c,
        id,
        rng.chance(0.3) ? null : `https://covers.invented/${c.name}${titleCounter++}.jpg`,
      );
      return `cover ${id.slice(0, 8)}`;
    }
    if (roll < 40) {
      const id = anyGameId(c);
      if (!id) return null;
      removeGame(c, id);
      return `deleteGame ${id.slice(0, 8)}`;
    }
    if (roll < 52) {
      const id = anyGameId(c);
      if (!id) return null;
      const session = startGameSession(c.ctx, id, 'watcher');
      if (!session) return null;
      open.set(c.name, [...(open.get(c.name) ?? []), session.id]);
      return `startSession ${id.slice(0, 8)}`;
    }
    if (roll < 62) {
      const mine = open.get(c.name) ?? [];
      const sessionId = rng.pick(mine);
      if (!sessionId) return null;
      open.set(
        c.name,
        mine.filter((s) => s !== sessionId),
      );
      world.advance(rng.int(3 * 60) * MINUTE_MS); // tiempo real: el de todos los relojes a la vez
      closeSession(c.ctx, sessionId, { endedAt: c.ctx.now(), closedBy: 'owner' });
      return `closeSession ${sessionId.slice(0, 8)}`;
    }
    if (roll < 66) {
      const id = anyGameId(c);
      if (!id) return null;
      createIteration(c.ctx, { gameId: id, playedPlatform: 'PC', origin: 'Purchased' });
      return `addPlaythrough ${id.slice(0, 8)}`;
    }
    if (roll < 70) {
      const id = anyGameId(c);
      const iteration = id ? getGameById(c.ctx, id)?.iterations[0] : undefined;
      if (!iteration) return null;
      updateIteration(c.ctx, iteration.id, { playedPlatform: rng.pick(['PC', 'Switch', 'PS5'])! });
      return `editPlaythrough ${iteration.id.slice(0, 8)}`;
    }
    if (roll < 72) {
      const id = anyGameId(c);
      const iteration = id ? rng.pick(getGameById(c.ctx, id)?.iterations ?? []) : undefined;
      if (!iteration) return null;
      deleteIteration(c.ctx, iteration.id);
      return `deletePlaythrough ${iteration.id.slice(0, 8)}`;
    }
    if (roll < 78) {
      const id = anyGameId(c);
      const iteration = id ? rng.pick(getGameById(c.ctx, id)?.iterations ?? []) : undefined;
      if (!iteration) return null;
      addStateEvent(c.ctx, {
        iterationId: iteration.id,
        type: rng.pick(['started', 'completed', 'dropped', 'on_hold'] as const)!,
        datePrecision: 'day',
      });
      return `stateEvent ${iteration.id.slice(0, 8)}`;
    }
    if (roll < 80) {
      const id = anyGameId(c);
      const event = id ? rng.pick(getGameById(c.ctx, id)?.stateHistory ?? []) : undefined;
      if (!event) return null;
      deleteStateEvent(c.ctx, event.id);
      return `deleteStateEvent ${event.id.slice(0, 8)}`;
    }
    if (roll < 85) {
      const id = anyGameId(c);
      if (!id) return null;
      addSpendEvent(c.ctx, {
        gameId: id,
        type: 'purchase',
        amount: rng.int(60) + 0.99,
        datePrecision: 'day',
      });
      return `spend ${id.slice(0, 8)}`;
    }
    if (roll < 90) {
      const session = rng.pick(getAllSessions(c.ctx));
      if (!session) return null;
      updateSessionNote(c.ctx, session.id, `nota ${c.name}${titleCounter++}`);
      return `sessionNote ${session.id.slice(0, 8)}`;
    }
    if (roll < 94) {
      const session = rng.pick(getAllSessions(c.ctx).filter((s) => s.endedAt !== null));
      if (!session) return null;
      deleteSession(c.ctx, session.id);
      return `deleteSession ${session.id.slice(0, 8)}`;
    }
    if (roll < 98) {
      const id = anyGameId(c);
      const snapshot = id ? readExternalSnapshot(c.ctx, id) : null;
      if (!snapshot) return null;
      applyRefreshGameResult(c.ctx, snapshot, {
        hltb: { hltbMain: rng.int(80), hltbMainExtras: null, hltbCompletionist: null },
      });
      return `refresh ${snapshot.gameId.slice(0, 8)}`;
    }
    return null;
  };

  for (let step = 0; step < options.steps; step++) {
    const kind = rng.int(100);
    const client = world.clients[rng.int(world.clients.length)];
    let label: string;
    if (kind < 55) {
      let done: string | null;
      try {
        done = domainOp(client);
      } catch (error) {
        if (!isExpectedRejection(error)) {
          trace.push(`${client.name}: ERROR inesperado en una escritura: ${String(error)}`);
          throw Object.assign(error as Error, { trace });
        }
        done = `rechazada (${(error as Error).message.slice(0, 60)})`;
        label = `${client.name}: ${done}`;
        trace.push(`${step} ${label}`);
        continue;
      }
      if (done) writes++;
      label = `${client.name}: ${done ?? 'no aplicable'}`;
    } else if (kind < 78) {
      const result = await client.sync();
      label = `${client.name}: sync ${result.status} pushed=${result.pushed} applied=${result.applied}${client.online ? '' : ' (sin red)'}`;
    } else if (kind < 86) {
      client.cut();
      label = `${client.name}: corte de red`;
    } else if (kind < 92) {
      client.restore();
      label = `${client.name}: red de vuelta`;
    } else if (options.clockFaults && kind < 94) {
      if (ahead.has(client)) {
        // El usuario corrige la hora del sistema.
        client.wall.set(world.hubTime.now + skews.get(client.name)!);
        ahead.delete(client);
        label = `${client.name}: reloj corregido`;
      } else {
        client.wall.advance(HOUR_MS + rng.int(48 * 60) * MINUTE_MS);
        ahead.add(client);
        label = `${client.name}: reloj adelantado`;
      }
    } else if (kind < 99) {
      const ms = rng.int(90 * 60) * 1000 + 1000;
      world.advance(ms);
      label = `tiempo +${Math.round(ms / 1000)} s`;
    } else {
      // El hub vuelve de una restauración: sube la época y todos lo reenvían todo (§8.4).
      world.hub.bumpEpoch();
      label = 'hub: nueva época';
    }
    trace.push(`${step} ${label}`);
  }

  // Al final, todos con red y a sincronizar hasta que no quede nada.
  for (const client of world.clients) {
    client.restore();
    if (ahead.has(client)) client.wall.set(world.hubTime.now + skews.get(client.name)!);
  }
  trace.push('— fin: red restaurada en todos —');
  return { world, trace, writes };
}
