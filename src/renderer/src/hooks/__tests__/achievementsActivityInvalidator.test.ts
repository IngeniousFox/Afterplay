import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueryClient } from '@tanstack/react-query';
import type { AchievementActivityEvent } from '../../../../shared/types';
import { createAchievementsActivityInvalidator } from '../achievements';
import { queryKeys } from '../queryKeys';

// LA REGLA DE INVALIDACIÓN DE LOGROS, probada sin montar React — que es
// justamente por lo que está exportada aparte del hook (ver su comentario).
//
// Vale la pena tenerla aquí porque hay DOS ventanas viviendo de ella: la app y
// el HUD del overlay, que hasta ahora llevaba una copia a mano que no
// distinguía una pasada de sincronización de un desbloqueo suelto. Lo que se
// fija abajo es exactamente lo que esa copia rompía: durante una pasada solo se
// refresca la ficha del juego recién sincronizado, y el barrido ancho lo hace
// UNA vez el 'progress' final.
//
// Sin QueryClient de verdad: lo único que hay que observar son las llamadas a
// invalidateQueries (qué prefijo y con qué refetchType), y un doble hace eso
// sin arrastrar caché, ni observadores, ni tiempo.

type Invalidation = { key: readonly unknown[]; refetchType: string | undefined };

const spyClient = (): { client: QueryClient; calls: Invalidation[] } => {
  const calls: Invalidation[] = [];
  const client = {
    invalidateQueries: (filters: { queryKey: readonly unknown[]; refetchType?: string }) => {
      calls.push({ key: filters.queryKey, refetchType: filters.refetchType });
      return Promise.resolve();
    },
  } as unknown as QueryClient;
  return { client, calls };
};

const progress = (running: boolean): AchievementActivityEvent => ({
  kind: 'progress',
  running,
  done: 0,
  total: 0,
  failed: 0,
  currentTitle: null,
});

const synced = (gameId: number): AchievementActivityEvent => ({
  kind: 'synced',
  gameId,
  catalogCount: 0,
  unlockedCount: 0,
});

const ALL = queryKeys.achievements.all;

describe('createAchievementsActivityInvalidator', () => {
  it("un 'synced' suelto refresca el prefijo entero de logros", () => {
    const { client, calls } = spyClient();
    const invalidate = createAchievementsActivityInvalidator(client);

    invalidate(synced(7));

    assert.deepEqual(calls, [{ key: ALL, refetchType: 'active' }]);
  });

  it("dentro de una pasada, cada 'synced' marca lo global y solo refresca SU juego", () => {
    const { client, calls } = spyClient();
    const invalidate = createAchievementsActivityInvalidator(client);

    invalidate(progress(true));
    invalidate(synced(7));
    invalidate(synced(9));

    assert.deepEqual(calls, [
      { key: ALL, refetchType: 'none' },
      { key: queryKeys.achievements.game(7), refetchType: 'active' },
      { key: ALL, refetchType: 'none' },
      { key: queryKeys.achievements.game(9), refetchType: 'active' },
    ]);
  });

  it("el 'progress' final cierra la racha: un solo barrido, y el siguiente suelto vuelve a serlo", () => {
    const { client, calls } = spyClient();
    const invalidate = createAchievementsActivityInvalidator(client);

    invalidate(progress(true));
    invalidate(synced(7));
    calls.length = 0;

    invalidate(progress(false));
    invalidate(synced(9));

    assert.deepEqual(calls, [
      { key: ALL, refetchType: 'active' },
      { key: ALL, refetchType: 'active' },
    ]);
  });

  it('con el knob en falso (telón del overlay bajado) se marca todo y no se pide nada', () => {
    const { client, calls } = spyClient();
    const invalidate = createAchievementsActivityInvalidator(client, () => false);

    invalidate(synced(7));
    invalidate(progress(true));
    invalidate(synced(9));
    invalidate(progress(false));

    assert.deepEqual(calls, [
      { key: ALL, refetchType: 'none' },
      { key: ALL, refetchType: 'none' },
      { key: queryKeys.achievements.game(9), refetchType: 'none' },
      { key: ALL, refetchType: 'none' },
    ]);
  });

  // El motivo de que el knob sea una función y no un booleano: el telón sube y
  // baja a mitad de pasada, y enterarse NO puede costar un invalidador nuevo —
  // el nuevo empezaría con passRunning en falso y volvería a barrer ancho por
  // cada juego, que es el coste que esta regla existe para quitar.
  it('el knob se pregunta en cada evento, y cambiarlo no pierde la pasada en curso', () => {
    const { client, calls } = spyClient();
    let visible = false;
    const invalidate = createAchievementsActivityInvalidator(client, () => visible);

    invalidate(progress(true));
    invalidate(synced(7));
    visible = true;
    invalidate(synced(9));

    assert.deepEqual(calls, [
      { key: ALL, refetchType: 'none' },
      { key: queryKeys.achievements.game(7), refetchType: 'none' },
      { key: ALL, refetchType: 'none' },
      { key: queryKeys.achievements.game(9), refetchType: 'active' },
    ]);
  });
});
