import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueryClient } from '@tanstack/react-query';
import { createSyncChangeInvalidator, queryKeysForTables } from '../syncChanges';
import { queryKeys } from '../queryKeys';

// Del aviso del main ("el sync cambió estas tablas") a las claves de consulta
// que existen. Sin QueryClient de verdad: lo que importa es QUÉ prefijos se
// invalidan, y un doble lo observa sin arrastrar caché ni tiempo.

describe('queryKeysForTables', () => {
  it('una descarga de sesiones refresca sesiones y la lista de juegos (horas, última vez)', () => {
    assert.deepEqual(queryKeysForTables(['sessions']), [
      queryKeys.sessions.all,
      queryKeys.games.all,
    ]);
  });

  it('las tablas de un mismo ámbito no repiten la clave', () => {
    assert.deepEqual(queryKeysForTables(['games', 'plan_entries', 'playthroughs']), [
      queryKeys.games.all,
    ]);
  });

  it('cada familia de la interfaz tiene su tabla', () => {
    const expect = (table: string, key: readonly unknown[]): void => {
      assert.ok(
        queryKeysForTables([table]).some((candidate) => candidate === key),
        `${table} debería refrescar ${JSON.stringify(key)}`,
      );
    };
    expect('state_events', queryKeys.stateEvents.all);
    expect('spend_events', queryKeys.spend.all);
    expect('emulators', queryKeys.emulators.all);
    expect('save_backups', queryKeys.saves.all);
    expect('achievement_catalogs', queryKeys.achievements.all);
    expect('achievement_unlocks', queryKeys.achievements.all);
    expect('game_curiosities', queryKeys.curiosities.all);
    expect('generated_memories', queryKeys.memories.all);
    expect('radar_games', queryKeys.radar.all);
    expect('external_checks', queryKeys.external.status);
  });

  it('una tabla desconocida refresca todo', () => {
    assert.ok(queryKeysForTables(['tabla_del_futuro']).length >= 10);
  });
});

describe('createSyncChangeInvalidator', () => {
  it('invalida cada familia afectada y ninguna más', () => {
    const calls: (readonly unknown[])[] = [];
    const client = {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => {
        calls.push(filters.queryKey);
        return Promise.resolve();
      },
    } as unknown as QueryClient;

    createSyncChangeInvalidator(client)(['achievement_unlocks']);

    assert.deepEqual(calls, [queryKeys.achievements.all]);
  });
});
