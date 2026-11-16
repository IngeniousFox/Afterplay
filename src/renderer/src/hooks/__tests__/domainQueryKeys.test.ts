import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueryClient } from '@tanstack/react-query';
import { DOMAINS, type DataChanged } from '../../../../shared/ipc/dataChanged';
import { DOMAIN_QUERY_KEYS, queryKeysForChange, queryKeysForDomains } from '../domainQueryKeys';
import { createDataChangedInvalidator } from '../useDataChangedSync';
import { queryKeys } from '../queryKeys';
import { spendQueryOptions } from '../spend';
import { sessionsQueryOptions } from '../sessions';
import { stateEventsQueryOptions } from '../stateEvents';

// Del aviso 'data:changed' del main a las claves de consulta (§15.4, E-22). Sin
// QueryClient de verdad: lo que importa es QUÉ prefijos se invalidan, y un
// doble lo observa sin arrastrar caché ni tiempo.

/** ¿Esta consulta (su clave) queda bajo alguno de los prefijos invalidados? */
const covers = (keys: readonly (readonly unknown[])[], queryKey: readonly unknown[]): boolean =>
  keys.some((prefix) => prefix.every((part, index) => queryKey[index] === part));

// Las consultas que lee la pantalla de Estadísticas (screens/Stats.tsx).
const STATS_QUERIES = {
  games: queryKeys.games.all,
  plannedGames: queryKeys.games.planned,
  sessions: sessionsQueryOptions.queryKey,
  spend: spendQueryOptions.queryKey,
  stateEvents: stateEventsQueryOptions.queryKey,
} as const;

describe('DOMAIN_QUERY_KEYS', () => {
  it('cubre TODOS los dominios, cada uno con al menos una consulta', () => {
    assert.deepEqual(Object.keys(DOMAIN_QUERY_KEYS).sort(), [...DOMAINS].sort());
    for (const domain of DOMAINS) assert.ok(DOMAIN_QUERY_KEYS[domain].length > 0, domain);
  });

  it('spend, sessions, games, playthroughs y stateEvents refrescan las Estadísticas', () => {
    const touching = ['spend', 'sessions', 'games', 'playthroughs', 'stateEvents'] as const;
    for (const domain of touching) {
      assert.ok(
        covers(queryKeysForDomains([domain]), STATS_QUERIES.games),
        `${domain} debería refrescar la lista de juegos de Estadísticas`,
      );
    }
    assert.ok(covers(queryKeysForDomains(['spend']), STATS_QUERIES.spend));
    assert.ok(covers(queryKeysForDomains(['sessions']), STATS_QUERIES.sessions));
    assert.ok(covers(queryKeysForDomains(['stateEvents']), STATS_QUERIES.stateEvents));
    // Y el Plan (Backlog flow) cuelga de ['games'].
    assert.ok(covers(queryKeysForDomains(['games']), STATS_QUERIES.plannedGames));
  });

  it('un dominio ajeno no toca las Estadísticas', () => {
    const keys = queryKeysForDomains(['memories', 'curiosities', 'radar']);
    assert.ok(!covers(keys, STATS_QUERIES.spend));
    assert.ok(!covers(keys, STATS_QUERIES.sessions));
  });
});

describe('queryKeysForChange', () => {
  it('junta las claves de los dominios avisados, sin repetir', () => {
    const change: DataChanged = { domains: ['sessions', 'games', 'spend'], origin: 'local' };
    const keys = queryKeysForChange(change);
    assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, keys.length);
    assert.deepEqual(keys, [queryKeys.games.all, queryKeys.sessions.all, queryKeys.spend.all]);
  });

  it('sin dominios no hay nada que refrescar', () => {
    assert.deepEqual(queryKeysForChange({ domains: [], origin: 'sync' }), []);
  });
});

describe('createDataChangedInvalidator', () => {
  type Call = { queryKey: readonly unknown[]; refetchType: unknown };
  const recorder = (): { client: QueryClient; calls: Call[] } => {
    const calls: Call[] = [];
    const client = {
      invalidateQueries: (filters: Call) => {
        calls.push({ queryKey: filters.queryKey, refetchType: filters.refetchType });
        return Promise.resolve();
      },
    } as unknown as QueryClient;
    return { client, calls };
  };

  it('E-22: un gasto que llega por sync invalida el gasto y los juegos (Estadísticas)', () => {
    const { client, calls } = recorder();
    createDataChangedInvalidator(client)({ domains: ['spend'], origin: 'sync' });
    const invalidated = calls.map((call) => call.queryKey);
    assert.ok(covers(invalidated, STATS_QUERIES.spend));
    assert.ok(covers(invalidated, STATS_QUERIES.games));
    assert.ok(calls.every((call) => call.refetchType === 'active'));
  });

  it('con el telón del overlay bajado solo marca las consultas, no las pide', () => {
    const { client, calls } = recorder();
    createDataChangedInvalidator(client, () => false)({ domains: ['sessions'], origin: 'watcher' });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((call) => call.refetchType === 'none'));
  });
});
