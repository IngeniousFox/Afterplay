import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionCloseReason } from '../../shared/types';
import {
  buildSessionFinalized,
  getSessionFinalizationPolicy,
  isMeaningfulSession,
  SESSION_EPILOGUE_MIN_DURATION_SEC,
} from './finalizationPolicy';

type TestSession = {
  id: number;
  iterationId: number;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  note: string | null;
};

const session = (durationSec: number, note: string | null = null): TestSession => ({
  id: 7,
  iterationId: 11,
  startedAt: new Date('2026-07-30T10:00:00Z'),
  endedAt: new Date('2026-07-30T11:00:00Z'),
  durationSec,
  note,
});

describe('session finalization policy', () => {
  it('only considers short sessions meaningful when they carry intent', () => {
    assert.equal(
      isMeaningfulSession(session(SESSION_EPILOGUE_MIN_DURATION_SEC - 1), 'process_exit'),
      false,
    );
    assert.equal(isMeaningfulSession(session(30, 'Boss defeated'), 'process_exit'), true);
    assert.equal(isMeaningfulSession(session(30), 'terminal_state'), true);
  });

  it('notifies and backs up a normal process exit', () => {
    const finalized = buildSessionFinalized(session(3600), 'process_exit', 5);
    assert.deepEqual(getSessionFinalizationPolicy(finalized), {
      createEpilogue: true,
      notify: true,
      scheduleBackup: true,
    });
  });

  it('keeps manual and terminal closes quiet until process exit', () => {
    for (const reason of ['manual_stop', 'terminal_state'] satisfies SessionCloseReason[]) {
      const finalized = buildSessionFinalized(session(3600), reason, 5);
      assert.deepEqual(getSessionFinalizationPolicy(finalized), {
        createEpilogue: true,
        notify: false,
        scheduleBackup: false,
      });
    }
  });

  it('keeps technical closes silent and out of the epilogue inbox', () => {
    for (const reason of ['lock', 'suspend', 'startup_recovery'] satisfies SessionCloseReason[]) {
      const finalized = buildSessionFinalized(session(3600), reason, 5);
      assert.deepEqual(getSessionFinalizationPolicy(finalized), {
        createEpilogue: false,
        notify: false,
        scheduleBackup: false,
      });
    }
  });

  it('backs up an assigned completed emulator session without notifying', () => {
    const finalized = buildSessionFinalized(session(3600), 'emulator_assignment', 5);
    assert.deepEqual(getSessionFinalizationPolicy(finalized), {
      createEpilogue: true,
      notify: false,
      scheduleBackup: true,
    });
  });

  it('rejects an open session', () => {
    assert.throws(
      () => buildSessionFinalized({ ...session(3600), endedAt: null }, 'process_exit', 5),
      /sigue abierta/,
    );
  });
});
