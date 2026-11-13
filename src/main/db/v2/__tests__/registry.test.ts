import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { localEntries, registry, syncedEntries, type SyncedTableEntry } from '../registry';
import * as schema from '../schema';

// El test-barrera de §8.6 y la coherencia del registro con el esquema. Si
// alguien añade una tabla, una columna de sync o una clave foránea sin pasar
// por el registro, falla aquí y no en un sync que pierde cambios.

const schemaTables = Object.values<unknown>(schema).filter((value): value is SQLiteTable =>
  is(value, SQLiteTable),
);

const configOf = (table: SQLiteTable): ReturnType<typeof getTableConfig> => getTableConfig(table);

const columnOf = (table: SQLiteTable, name: string): SQLiteColumn | undefined =>
  configOf(table).columns.find((column) => column.name === name);

const primaryKeyColumns = (table: SQLiteTable): string[] => {
  const config = configOf(table);
  const inline = config.columns.filter((column) => column.primary).map((column) => column.name);
  const declared = config.primaryKeys.flatMap((pk) => pk.columns.map((column) => column.name));
  return [...inline, ...declared];
};

type ForeignKeyInfo = { table: string; column: string; parent: string; parentColumn: string };

const foreignKeysOf = (table: SQLiteTable): ForeignKeyInfo[] =>
  configOf(table).foreignKeys.map((fk) => {
    const reference = fk.reference();
    assert.equal(reference.columns.length, 1, 'el esquema 2.0 solo usa claves foráneas simples');
    return {
      table: getTableName(table),
      column: reference.columns[0].name,
      parent: getTableName(reference.foreignTable),
      parentColumn: reference.foreignColumns[0].name,
    };
  });

const allForeignKeys = schemaTables.flatMap(foreignKeysOf);

// Lo que §7.3 exige a toda tabla sincronizada.
const SYNC_COLUMNS = [
  { name: 'id', type: 'text', notNull: true },
  { name: 'syncCreated', type: 'text', notNull: true },
  { name: 'syncUpdated', type: 'text', notNull: true },
  { name: 'syncFields', type: 'text', notNull: true },
  { name: 'syncDeleted', type: 'text', notNull: false },
  { name: 'syncDirty', type: 'integer', notNull: true },
] as const;

describe('registro 2.0: test-barrera (§8.6)', () => {
  it('toda tabla del esquema está en el registro, y al revés', () => {
    const inSchema = schemaTables.map((table) => getTableName(table)).sort();
    const inRegistry = Object.keys(registry).sort();
    assert.deepEqual(inRegistry, inSchema);
    for (const [key, entry] of Object.entries(registry)) {
      assert.equal(entry.name, key, `la clave del registro ${key} no es el nombre SQL`);
      assert.ok(schemaTables.includes(entry.table), `${key}: el objeto no es el del esquema`);
    }
  });

  it('las columnas comunes del esquema son exactamente las de §7.3', () => {
    assert.deepEqual(
      [...schema.SYNC_COLUMN_NAMES].sort(),
      SYNC_COLUMNS.map((column) => column.name).sort(),
    );
  });

  for (const entry of syncedEntries) {
    it(`${entry.name}: lleva las columnas de §7.3 con su tipo`, () => {
      assert.ok(!entry.name.startsWith('local_'), 'una tabla sincronizada no lleva prefijo local_');
      assert.notEqual(entry.dataClass, 'L');
      for (const expected of SYNC_COLUMNS) {
        const column = columnOf(entry.table, expected.name);
        assert.ok(column, `falta ${expected.name}`);
        assert.equal(column.getSQLType(), expected.type, `${expected.name}: tipo`);
        assert.equal(column.notNull, expected.notNull, `${expected.name}: NOT NULL`);
      }
      assert.ok(columnOf(entry.table, 'syncFields')?.hasDefault, 'syncFields sin DEFAULT');
      assert.ok(columnOf(entry.table, 'syncDirty')?.hasDefault, 'syncDirty sin DEFAULT');
      assert.deepEqual(primaryKeyColumns(entry.table), ['id'], 'la clave primaria es id');
    });

    it(`${entry.name}: tiene el índice parcial de syncDirty`, () => {
      const partial = configOf(entry.table).indexes.filter((idx) => {
        const columns = idx.config.columns.map((column) => ('name' in column ? column.name : null));
        return columns.length === 1 && columns[0] === 'syncDirty' && idx.config.where;
      });
      assert.equal(partial.length, 1);
    });

    it(`${entry.name}: sin índices ni restricciones únicas (§7.7, H-4)`, () => {
      const config = configOf(entry.table);
      assert.deepEqual(
        config.indexes.filter((idx) => idx.config.unique).map((idx) => idx.config.name),
        [],
      );
      assert.equal(config.uniqueConstraints.length, 0);
      assert.deepEqual(
        config.columns.filter((column) => column.isUnique).map((column) => column.name),
        [],
      );
    });
  }

  for (const entry of localEntries) {
    it(`${entry.name}: tabla local sin columnas de sync ni claves foráneas`, () => {
      assert.ok(entry.name.startsWith('local_'), 'una tabla local lleva prefijo local_');
      assert.equal(entry.dataClass, 'L');
      assert.equal(entry.id.kind, 'local');
      const names = configOf(entry.table).columns.map((column) => column.name);
      for (const syncColumn of SYNC_COLUMNS) {
        if (syncColumn.name === 'id') continue;
        assert.ok(!names.includes(syncColumn.name), `${syncColumn.name} en una tabla local`);
      }
      assert.equal(configOf(entry.table).foreignKeys.length, 0);
    });
  }
});

// Comprobación en tiempo de compilación: `syncedTable` conserva los tipos de
// fila de Drizzle (si degeneraran a `any`, `Equal` daría false y no compilaría).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const rowTypes: [
  Equal<schema.SessionRow['startedBy'], schema.SessionStartedBy>,
  Equal<schema.SessionRow['playthroughId'], string | null>,
  Equal<schema.GameRow['addedAt'], Date>,
  Equal<schema.GameRow['syncFields'], schema.SyncFields>,
  Equal<schema.GameRow['syncDirty'], boolean>,
  Equal<schema.GameRow['id'], string>,
  Equal<schema.AchievementUnlockRow['origin'], schema.UnlockOrigin>,
  Equal<schema.StateEventRow['datePrecision'], schema.StateEventDatePrecision>,
] = [true, true, true, true, true, true, true, true];

describe('registro 2.0: tipos de fila', () => {
  it('las tablas sincronizadas conservan los tipos de Drizzle', () => {
    assert.ok(rowTypes.every(Boolean));
  });
});

describe('registro 2.0: forma del id y dueño', () => {
  for (const entry of syncedEntries) {
    it(`${entry.name}: las partes del id existen`, () => {
      if (entry.id.kind !== 'deterministic' && entry.id.kind !== 'composite') return;
      assert.ok(entry.id.parts.length > 0);
      const fallback = entry.id.kind === 'deterministic' ? entry.id.fallback : undefined;
      for (const part of entry.id.parts) {
        if (!('column' in part)) continue;
        const column = columnOf(entry.table, part.column);
        assert.ok(column, `${part.column} no existe`);
        if (!fallback) {
          assert.ok(column.notNull, `${part.column} forma el id y debería ser NOT NULL`);
        }
      }
    });

    it(`${entry.name}: dueño solo en la clase O`, () => {
      if (entry.dataClass !== 'O') {
        assert.equal(entry.owner, undefined);
        return;
      }
      assert.ok(entry.owner, 'una tabla O necesita dueño');
      assert.ok(columnOf(entry.table, entry.owner.column)?.notNull, 'el dueño es obligatorio');
      assert.ok(
        allForeignKeys.some(
          (fk) =>
            fk.table === entry.name && fk.column === entry.owner?.column && fk.parent === 'devices',
        ),
        'el dueño apunta a devices',
      );
    });
  }

  it('los dispositivos no se borran', () => {
    assert.equal(registry.devices.deletable, false);
  });
});

describe('registro 2.0: hijos y referencias frente a las claves foráneas', () => {
  const entryByName = new Map<string, SyncedTableEntry>(
    syncedEntries.map((entry) => [entry.name, entry]),
  );

  it('todas las claves foráneas apuntan al id de una tabla sincronizada', () => {
    for (const fk of allForeignKeys) {
      assert.ok(entryByName.has(fk.parent), `${fk.table}.${fk.column} -> ${fk.parent}`);
      assert.equal(fk.parentColumn, 'id', `${fk.table}.${fk.column}`);
    }
  });

  it('toda clave foránea es hijo o referencia de su padre', () => {
    for (const fk of allForeignKeys) {
      const parent = entryByName.get(fk.parent);
      assert.ok(parent);
      const covered = [...parent.children, ...parent.references].some(
        (link) => link.table === fk.table && link.column === fk.column,
      );
      assert.ok(covered, `${fk.table}.${fk.column} -> ${fk.parent} no está en el registro`);
    }
  });

  it('todo hijo o referencia corresponde a una clave foránea declarada', () => {
    for (const parent of syncedEntries) {
      for (const link of [...parent.children, ...parent.references]) {
        assert.ok(
          allForeignKeys.some(
            (fk) =>
              fk.table === link.table && fk.column === link.column && fk.parent === parent.name,
          ),
          `${parent.name}: ${link.table}.${link.column} sin clave foránea`,
        );
        assert.ok(link.why.length > 0, `${parent.name}: ${link.table}.${link.column} sin motivo`);
      }
    }
  });

  it('una misma columna no es a la vez hijo sin condición y referencia', () => {
    for (const parent of syncedEntries) {
      for (const child of parent.children) {
        const alsoReference = parent.references.some(
          (ref) => ref.table === child.table && ref.column === child.column,
        );
        if (alsoReference) {
          assert.ok(
            child.onlyWhereNull,
            `${child.table}.${child.column}: hijo y referencia necesitan una condición que los separe`,
          );
        }
      }
    }
  });

  it('los hijos condicionados y las referencias que anulan usan columnas que admiten null', () => {
    for (const parent of syncedEntries) {
      for (const child of parent.children) {
        if (!child.onlyWhereNull) continue;
        const table = entryByName.get(child.table);
        assert.ok(table);
        const column = columnOf(table.table, child.onlyWhereNull);
        assert.ok(column && !column.notNull, `${child.table}.${child.onlyWhereNull}`);
      }
      for (const ref of parent.references) {
        if (ref.onParentDelete !== 'nullify') continue;
        const table = entryByName.get(ref.table);
        assert.ok(table);
        const column = columnOf(table.table, ref.column);
        assert.ok(column && !column.notNull, `${ref.table}.${ref.column} no se puede anular`);
      }
    }
  });

  it('el registro va de padre a hijo', () => {
    const order = Object.keys(registry);
    for (const fk of allForeignKeys) {
      assert.ok(
        order.indexOf(fk.parent) < order.indexOf(fk.table),
        `${fk.parent} debería ir antes que ${fk.table}`,
      );
    }
  });

  it('ninguna clave foránea lleva acciones (§7.7)', () => {
    for (const table of schemaTables) {
      for (const fk of configOf(table).foreignKeys) {
        assert.ok([undefined, 'no action'].includes(fk.onDelete), `${fk.getName()}: ON DELETE`);
        assert.ok([undefined, 'no action'].includes(fk.onUpdate), `${fk.getName()}: ON UPDATE`);
      }
    }
  });

  it('borrar un juego alcanza sus playthroughs, eventos y sesiones', () => {
    // El árbol completo, para que un cambio en él sea una decisión visible.
    const reach = (name: string): string[] => {
      const entry = entryByName.get(name);
      assert.ok(entry);
      return entry.children.flatMap((child) => [
        `${child.table}.${child.column}${child.onlyWhereNull ? ` (si ${child.onlyWhereNull} es null)` : ''}`,
        ...reach(child.table),
      ]);
    };
    assert.deepEqual(reach('games'), [
      'playthroughs.gameId',
      'state_events.playthroughId',
      'sessions.playthroughId',
      'plan_entries.gameId',
      'spend_events.gameId',
      'game_installs.gameId',
      'achievement_unlocks.gameId',
    ]);
    assert.deepEqual(reach('emulators'), [
      'emulator_installs.emulatorId',
      'sessions.emulatorId (si playthroughId es null)',
    ]);
  });
});
