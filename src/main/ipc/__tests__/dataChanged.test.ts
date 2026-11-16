import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOMAINS, TABLE_DOMAINS, dataChangedFromTables } from '../../../shared/ipc/dataChanged';
import { registry } from '../../db/v2/registry';
import { syncTables } from '../../sync/tables';

// El mapa tabla -> dominios del aviso único 'data:changed' (§15.4). Vive en
// shared/ para que el renderer comparta los dominios, pero se vigila aquí
// porque es donde se conoce el registro de tablas: una tabla sincronizada
// nueva sin dominio dejaría la pantalla con datos viejos tras un sync (F-39).

describe('TABLE_DOMAINS', () => {
  it('cubre TODAS las tablas sincronizadas, y ninguna que no lo sea', () => {
    const synced = syncTables.map((table) => table.name).sort();
    assert.deepEqual(Object.keys(TABLE_DOMAINS).sort(), synced);
    for (const name of Object.keys(TABLE_DOMAINS)) {
      assert.equal(registry[name as keyof typeof registry].synced, true, name);
    }
  });

  it('cada tabla pertenece al menos a un dominio, y todos existen', () => {
    for (const [table, domains] of Object.entries(TABLE_DOMAINS)) {
      assert.ok(domains.length > 0, table);
      for (const domain of domains) assert.ok(DOMAINS.includes(domain), `${table}: ${domain}`);
    }
  });

  it('ningún dominio queda sin tabla (no hay dominios fantasma)', () => {
    const used = new Set(Object.values(TABLE_DOMAINS).flat());
    assert.deepEqual(
      DOMAINS.filter((domain) => !used.has(domain)),
      [],
    );
  });
});

describe('dataChangedFromTables', () => {
  it('junta los dominios de las tablas avisadas, sin repetir y en el orden de DOMAINS', () => {
    const change = dataChangedFromTables(
      ['spend_events', 'games', 'sessions', 'game_metadata'],
      { spend_events: ['s1'], games: ['g1'], game_metadata: ['g1', 'g2'], sessions: ['x1'] },
      'local',
    );
    assert.deepEqual(change.domains, ['games', 'sessions', 'spend']);
    assert.equal(change.origin, 'local');
    assert.deepEqual(change.ids, { games: ['g1', 'g2'], sessions: ['x1'], spend: ['s1'] });
  });

  it('sin ids no lleva el campo', () => {
    assert.equal(dataChangedFromTables(['devices'], {}, 'sync').ids, undefined);
  });

  it('una tabla desconocida (hub más nuevo que la app) avisa de todo', () => {
    const change = dataChangedFromTables(['games', 'tabla_del_futuro'], {}, 'sync');
    assert.deepEqual(change.domains, [...DOMAINS]);
  });
});
