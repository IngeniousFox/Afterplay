import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CutoverState, CutoverStateKind } from '../../../../shared/cutover';
import {
  agoText,
  checkPairingInput,
  cutoverStepIndex,
  describeCutover,
  errorKeepsOldData,
  laggingReason,
  seedingFraction,
  seedingProgress,
} from '../cutoverView';

// El copy de la pantalla de migración: cada estado tiene texto, ninguno usa
// jerga interna y los pasos siguen el camino normal del primer PC.

const device = {
  deviceId: 'd',
  deviceName: 'PC',
  reason: 'pending-changes' as const,
  self: false,
  lastReportAt: 0,
  pendingChanges: 3,
};

const ALL: CutoverState[] = [
  { kind: 'checking' },
  { kind: 'question-lagging', devices: [device], rechecking: false },
  { kind: 'importing', phase: 'reading-remote' },
  { kind: 'importing', phase: 'importing' },
  { kind: 'needs-pairing', reason: 'first-pc', hubUrl: null, error: null, canRetrySecret: false },
  {
    kind: 'needs-pairing',
    reason: 'secret-expired',
    hubUrl: null,
    error: null,
    canRetrySecret: false,
  },
  { kind: 'pairing' },
  { kind: 'seeding', rowsLeft: 1, rowsTotal: 2, problem: null },
  { kind: 'finishing' },
  { kind: 'waiting-other', deviceName: 'X', since: 0 },
  { kind: 'waiting-devices', devices: ['PC-B', 'PC-C'] },
  { kind: 'pulling', rowsLocal: 5, problem: null },
  { kind: 'local-migration' },
];

describe('describeCutover', () => {
  it('da título y texto a cada estado, sin jerga interna', () => {
    for (const state of ALL) {
      const copy = describeCutover(state);
      assert.ok(copy.title.length > 0 && copy.body.length > 0, state.kind);
      assert.doesNotMatch(`${copy.title} ${copy.body}`, /cutover|\bhub\b|turso|cdc/i, state.kind);
    }
  });

  it('el error enseña el mensaje de main', () => {
    const copy = describeCutover({ kind: 'error', code: 'unexpected', message: 'Boom.' });
    assert.equal(copy.body, 'Boom.');
    assert.equal(copy.busy, false);
  });
});

describe('cutoverStepIndex', () => {
  it('sigue el camino del primer PC y calla en los demás', () => {
    const index = (kind: CutoverStateKind): number | null =>
      cutoverStepIndex(ALL.find((state) => state.kind === kind)!);
    assert.deepEqual(
      (['checking', 'importing', 'needs-pairing', 'seeding', 'finishing'] as const).map(index),
      [0, 1, 2, 3, 4],
    );
    assert.equal(index('waiting-other'), null);
    assert.equal(index('waiting-devices'), 0);
    assert.equal(index('pulling'), null);
  });
});

describe('progreso', () => {
  it('cuenta lo subido y da la fracción', () => {
    assert.equal(seedingProgress(300, 1200), '900 of 1,200 items uploaded');
    assert.equal(seedingFraction(300, 1200), 0.75);
    assert.equal(seedingFraction(0, 0), null);
    assert.equal(seedingProgress(0, 0), null);
    assert.equal(seedingFraction(5, 2), 0);
  });
});

describe('laggingReason y agoText', () => {
  it('avisa de que continuar descarta lo de este PC', () => {
    assert.match(laggingReason({ ...device, self: true }, 0), /3 changes never reached.*discards/);
  });

  it('dice desde cuándo no informa un PC', () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal(
      laggingReason({ ...device, reason: 'stale', lastReportAt: 0 }, 3 * day),
      'Has not checked in since 3 days ago.',
    );
    assert.match(laggingReason({ ...device, reason: 'not-confirmed' }, 0), /not confirmed/);
    assert.match(laggingReason({ ...device, reason: 'never-reported' }, 0), /never reported/);
    assert.equal(agoText(0, 90 * 60 * 1000), '2 hours ago');
    assert.equal(agoText(0, 10 * 1000), 'moments ago');
  });
});

describe('errorKeepsOldData', () => {
  it('solo promete lo que el estado garantiza', () => {
    assert.equal(errorKeepsOldData('import-failed'), true);
    assert.equal(errorKeepsOldData('finish-failed'), false);
  });
});

describe('checkPairingInput', () => {
  it('pide dirección válida y código', () => {
    assert.deepEqual(checkPairingInput('https://a.example/', ' 12 '), {
      ok: true,
      hubUrl: 'https://a.example',
      code: '12',
    });
    assert.equal(checkPairingInput('', '12').ok, false);
    assert.equal(checkPairingInput('https://a.example', '  ').ok, false);
    const bad = checkPairingInput('http://a.example', '12');
    assert.equal(bad.ok, false);
    assert.ok(!bad.ok && bad.urlMessage !== null);
  });
});
