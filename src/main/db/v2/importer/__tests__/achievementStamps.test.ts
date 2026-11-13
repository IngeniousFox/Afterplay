import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AchievementSource } from '../../schema';
import { attributeAchievementStamps, type AttributedCheck } from '../achievementStamps';

// El reparto de los dos sellos de logros de la 1.x (achievementStamps.ts),
// probado contra una SIMULACIÓN de sus escritores (ra/sync.ts,
// steam/syncAchievements.ts): se generan todas las historias cortas de
// sincronizaciones posibles para cada combinación de claves, se calculan los
// dos sellos como los dejaría la 1.x y se comprueba que el reparto:
// - hace que las dos consultas 2.0 (gameView y la ficha de logros: la más
//   reciente de las fuentes) enseñen EXACTAMENTE los sellos de la 1.x;
// - cuando dice "cierto", no inventa ninguna hora (cada comprobación es la
//   última respuesta real de su fuente);
// - cuando dice "ambiguo" o "supuesto", solo apunta fuentes que contestaron
//   alguna vez y con una hora que no es anterior a la real (cota superior);
// - nunca llama "anómala" a una historia que la 1.x sí puede dejar.

type Step = 'ra' | 'steamEmpty' | 'steamCatalog' | 'steamUnlocks';

interface World {
  readonly steamKey: boolean;
  readonly raKey: boolean;
  /** El juego tiene logros en Steam (si no, Steam contesta "sin logros"). */
  readonly steamHas: boolean;
  /** El set de RA tiene logros (si no, RA no deja catálogo). */
  readonly raHas: boolean;
}

interface Outcome {
  s: number | null;
  u: number | null;
  catalogs: Set<AchievementSource>;
  /** La última respuesta real de cada comprobación 2.0. */
  truth: Partial<Record<AttributedCheck['source'], number>>;
}

function play(world: World, steps: readonly Step[]): Outcome | null {
  const out: Outcome = { s: null, u: null, catalogs: new Set(), truth: {} };
  let t = 1000;
  for (const step of steps) {
    t += 1000;
    if (step === 'ra') {
      if (!world.raKey) return null;
      out.s = t;
      out.u = t;
      if (world.raHas) out.catalogs.add('ra');
      out.truth.ra_achievements = t;
    } else {
      if (!world.steamKey) return null;
      if (step === 'steamEmpty' && world.steamHas) return null;
      if (step !== 'steamEmpty' && !world.steamHas) return null;
      out.s = t;
      out.truth.steam_achievements = t;
      if (step !== 'steamEmpty') out.catalogs.add('steam');
      if (step === 'steamUnlocks') {
        out.u = t;
        out.truth.steam_unlocks = t;
      }
    }
  }
  return out;
}

const latest = (...values: (number | undefined)[]): number | null => {
  const present = values.filter((v): v is number => v !== undefined);
  return present.length ? Math.max(...present) : null;
};

const STEPS: Step[] = ['ra', 'steamEmpty', 'steamCatalog', 'steamUnlocks'];
function* histories(max: number): Generator<Step[]> {
  if (max === 0) return;
  for (const step of STEPS) {
    yield [step];
    for (const rest of histories(max - 1)) yield [step, ...rest];
  }
}

describe('achievementStamps: reparto de los sellos 1.x entre fuentes', () => {
  it('toda historia posible de la 1.x se reparte sin anomalías y enseña lo mismo', () => {
    let cases = 0;
    const bases = new Map<string, number>();
    for (const steamKey of [false, true])
      for (const raKey of [false, true])
        for (const steamHas of [false, true])
          for (const raHas of [false, true])
            for (const steps of histories(4)) {
              const world = { steamKey, raKey, steamHas, raHas };
              const outcome = play(world, steps);
              if (!outcome) continue;
              cases++;
              const attribution = attributeAchievementStamps({
                syncedAt: outcome.s,
                unlocksSyncedAt: outcome.u,
                hasSteamKey: steamKey,
                hasRaKey: raKey,
                catalogs: outcome.catalogs,
              });
              bases.set(attribution.basis, (bases.get(attribution.basis) ?? 0) + 1);
              const at = (source: AttributedCheck['source']): number | undefined =>
                attribution.checks.find((c) => c.source === source)?.checkedAt;
              const label = `${JSON.stringify(world)} ${steps.join(',')}`;

              assert.notEqual(attribution.basis.startsWith('anómalo'), true, label);
              assert.deepEqual(attribution.discarded, [], label);
              // Lo que enseñan las dos consultas 2.0.
              assert.equal(
                latest(at('steam_achievements'), at('ra_achievements')),
                outcome.s,
                `achievementsSyncedAt ${label}`,
              );
              assert.equal(
                latest(at('steam_unlocks'), at('ra_achievements')),
                outcome.u,
                `achievementsUnlocksSyncedAt ${label}`,
              );
              const undecided = attribution.basis !== 'cierto';
              for (const check of attribution.checks) {
                const truth = outcome.truth[check.source];
                // Lo indecidible ("ambiguo", "supuesto"): un catálogo prueba
                // que su fuente contestó alguna vez, pero no que Steam
                // contestara sobre TUS desbloqueos; `steam_unlocks` puede ser
                // de un sello que dejó RA (se cuenta en el informe).
                if (truth === undefined && undecided && check.source === 'steam_unlocks') continue;
                assert.notEqual(truth, undefined, `fuente que nunca contestó: ${label}`);
                if (attribution.basis === 'cierto') {
                  assert.equal(check.checkedAt, truth, `hora inventada: ${label}`);
                } else {
                  assert.ok(check.checkedAt >= (truth as number), `hora anterior: ${label}`);
                }
                // El estado: ok si hay catálogo de esa fuente.
                if (check.source !== 'steam_unlocks') {
                  const source = check.source === 'ra_achievements' ? 'ra' : 'steam';
                  assert.equal(check.status, outcome.catalogs.has(source) ? 'ok' : 'empty', label);
                }
              }
            }
    assert.ok(cases > 100);
    // Las historias que no se pueden decidir existen (y por eso se cuentan).
    assert.ok(
      (bases.get('ambiguo: Steam o RA escribieron el sello (las dos con su hora)') ?? 0) > 0,
    );
  });

  it('el caso real: catálogo solo de RA, desbloqueos 18:20 y catálogo 18:24', () => {
    const s = Date.parse('2026-08-03T18:24:05.260Z');
    const u = Date.parse('2026-08-03T18:20:00.604Z');
    const attribution = attributeAchievementStamps({
      syncedAt: s,
      unlocksSyncedAt: u,
      hasSteamKey: true,
      hasRaKey: true,
      catalogs: new Set(['ra']),
    });
    assert.equal(attribution.basis, 'cierto');
    assert.deepEqual(attribution.checks, [
      { source: 'steam_achievements', status: 'empty', checkedAt: s },
      { source: 'ra_achievements', status: 'ok', checkedAt: u },
    ]);
  });

  it('lo que ningún escritor deja (desbloqueos más recientes que el catálogo) es anómalo y conserva la regla por fuentes', () => {
    const attribution = attributeAchievementStamps({
      syncedAt: 6,
      unlocksSyncedAt: 7,
      hasSteamKey: true,
      hasRaKey: true,
      catalogs: new Set(['steam', 'ra']),
    });
    assert.ok(attribution.basis.startsWith('anómalo'));
    assert.deepEqual(
      attribution.checks.map((c) => [c.source, c.checkedAt]),
      [
        ['steam_achievements', 6],
        ['ra_achievements', 6],
        ['steam_unlocks', 7],
      ],
    );
  });

  it('sin sellos no hay comprobaciones', () => {
    const attribution = attributeAchievementStamps({
      syncedAt: null,
      unlocksSyncedAt: null,
      hasSteamKey: true,
      hasRaKey: true,
      catalogs: new Set(['steam']),
    });
    assert.deepEqual(attribution, { checks: [], basis: 'sin sellos', discarded: [] });
  });
});
