import { and, asc, eq, sql } from 'drizzle-orm';
import type { CreateEmulatorInput, Emulator } from '../../../../../shared/dto';
import { emulatorInstalls, emulators } from '../../schema';
import { alive } from '../../store';
import { liveEmulator, type QueryContext } from '../common';

// Emuladores (sustituyen a `db/queries/emulators/**` de la 1.x; CONSULTAS.md
// §1.2 "Emulator", §2.2 y §3.3).
//
// En la 2.0 el emulador (`emulators`, dato del usuario) y su ruta
// (`emulator_installs`, una por dispositivo, dueño ese dispositivo) van por
// separado: la ruta de un PC no sirve en otro. El DTO `Emulator` sigue
// llevando `executablePath`, que es el de ESTE PC, para que el renderer no
// cambie.

/**
 * Los emuladores vivos con la ruta de este PC, por nombre sin distinguir
 * mayúsculas (y por creación a igualdad). Un emulador sin instalación aquí
 * sale con `executablePath = ''` (R-08): en la fase 2, con un solo PC, no
 * pasa; tiparlo `string | null` es de la fase 4.
 */
export function getEmulators(ctx: QueryContext): Emulator<string>[] {
  const rows = ctx.db
    .select({
      id: emulators.id,
      name: emulators.name,
      executablePath: emulatorInstalls.executablePath,
    })
    .from(emulators)
    // La instalación de un emulador que ya se filtra vivo: `alive` a secas.
    // Condición en el ON para que el LEFT no se vuelva INNER.
    .leftJoin(
      emulatorInstalls,
      and(
        eq(emulatorInstalls.emulatorId, emulators.id),
        eq(emulatorInstalls.deviceId, ctx.deviceId),
        alive(emulatorInstalls),
      ),
    )
    .where(liveEmulator())
    .orderBy(sql`${emulators.name} collate nocase`, asc(emulators.syncCreated), asc(emulators.id))
    .all();
  return rows.map((row) => ({ ...row, executablePath: row.executablePath ?? '' }));
}

/**
 * Registra un emulador y su ruta en ESTE PC, en una transacción (§3.3).
 * Devuelve el DTO. Un `StoreError` de la puerta (p. ej. nombre vacío que no
 * pasa la validación) se propaga sin dejar nada a medias.
 */
export function createEmulator(ctx: QueryContext, input: CreateEmulatorInput): Emulator<string> {
  return ctx.store.transaction((): Emulator<string> => {
    const { id } = ctx.store.create('emulators', { name: input.name });
    ctx.store.create('emulator_installs', {
      emulatorId: id,
      deviceId: ctx.deviceId,
      executablePath: input.executablePath,
    });
    return { id, name: input.name, executablePath: input.executablePath };
  });
}

/**
 * Borra (lápida) un emulador. La puerta marca en la misma operación sus
 * instalaciones (de todos los PCs) y sus sesiones SIN asignar, abiertas
 * incluidas (como la 1.x, que las borraba): sin emulador ni juego no son
 * nada. Las ya asignadas se quedan con su `emulatorId` (registro `keep`:
 * son tiempo jugado). `true` si lo ha borrado; `false` si no existía o ya
 * tenía lápida.
 */
export function deleteEmulator(ctx: QueryContext, emulatorId: string): boolean {
  return ctx.store.transaction((): boolean => {
    const row = ctx.db
      .select({ syncDeleted: emulators.syncDeleted })
      .from(emulators)
      .where(eq(emulators.id, emulatorId))
      .get();
    if (!row || row.syncDeleted !== null) return false;
    ctx.store.remove('emulators', emulatorId);
    return true;
  });
}
