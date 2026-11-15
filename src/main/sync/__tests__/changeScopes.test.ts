import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_SCOPES, SYNC_TABLE_SCOPES, scopesForTables } from '../../../shared/sync/changeScopes';
import { registry } from '../../db/v2/registry';
import { syncTables } from '../tables';

// El mapa tabla -> ámbitos de interfaz (§15.4). Vive en shared/ para que el
// renderer lo use, pero se vigila aquí porque es donde se conoce el registro de
// tablas: una tabla sincronizada nueva sin ámbito dejaría la pantalla con datos
// viejos tras un sync.

describe('SYNC_TABLE_SCOPES', () => {
  it('cubre TODAS las tablas sincronizadas, y ninguna que no lo sea', () => {
    const synced = syncTables.map((table) => table.name).sort();
    assert.deepEqual(Object.keys(SYNC_TABLE_SCOPES).sort(), synced);
    for (const name of Object.keys(SYNC_TABLE_SCOPES)) {
      assert.equal(registry[name as keyof typeof registry].synced, true, name);
    }
  });

  it('cada tabla refresca al menos un ámbito, y todos existen', () => {
    for (const [table, scopes] of Object.entries(SYNC_TABLE_SCOPES)) {
      assert.ok(scopes.length > 0, table);
      for (const scope of scopes) assert.ok(ALL_SCOPES.includes(scope), `${table}: ${scope}`);
    }
  });
});

describe('scopesForTables', () => {
  it('junta los ámbitos de las tablas avisadas, sin repetir', () => {
    const scopes = scopesForTables(['sessions', 'games', 'achievement_unlocks']);
    assert.deepEqual([...scopes].sort(), ['achievements', 'games', 'sessions']);
  });

  it('sin tablas no hay nada que refrescar', () => {
    assert.equal(scopesForTables([]).size, 0);
  });

  it('una tabla desconocida (hub más nuevo que la app) refresca todo', () => {
    assert.equal(scopesForTables(['games', 'tabla_del_futuro']).size, ALL_SCOPES.length);
  });
});
