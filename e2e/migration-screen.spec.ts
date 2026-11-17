import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { CutoverAction, CutoverState } from '../src/shared/cutover';
import { expect, test } from './fixtures';

// LA PANTALLA DE MIGRACIÓN 1.x → 2.0, de verdad y entera.
//
// Un test no puede correr un corte real (necesita Turso y otro PC), así que
// usa el gancho e2e del main (src/main/migration/cutoverE2eHook.ts): fuerza el
// estado que la ventana ve y recoge las acciones que ella manda. El gancho
// solo existe con AFTERPLAY_E2E_USER_DATA puesta, o sea, aquí.

type Hook = {
  force(state: CutoverState | null): void;
  actions: CutoverAction[];
};

const SHOTS = join(process.cwd(), 'test-results', 'migration-screen');

const force = (app: ElectronApplication, state: CutoverState | null): Promise<void> =>
  app.evaluate((_electron, next) => {
    (globalThis as unknown as { __afterplayE2ECutover: Hook }).__afterplayE2ECutover.force(next);
  }, state);

const actions = (app: ElectronApplication): Promise<CutoverAction[]> =>
  app.evaluate(
    () => (globalThis as unknown as { __afterplayE2ECutover: Hook }).__afterplayE2ECutover.actions,
  );

// El estado forzado ANTES de cargar: así se prueba la puerta tal como actúa al
// arrancar (getState), no solo el evento.
const gateWith = async (
  app: ElectronApplication,
  window: Page,
  state: CutoverState,
): Promise<void> => {
  await force(app, state);
  await window.reload();
  await expect(window.getByTestId('migration-screen')).toBeVisible();
};

const shot = async (window: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  await window.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const gamesLink = (window: Page): Locator =>
  window.getByRole('link', { name: 'Games', exact: true });

test.describe('pantalla de migración', () => {
  test('la puerta enseña la pantalla en lugar de la biblioteca', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await expect(gamesLink(window)).toBeVisible();

    await gateWith(app, window, { kind: 'importing', phase: 'importing' });

    await expect(window.getByRole('heading', { name: 'Copying your library' })).toBeVisible();
    await expect(gamesLink(window)).toHaveCount(0);
    await expect(window.getByText("Assassin's Creed II")).toHaveCount(0);
    // Los textos para personas no usan la jerga interna.
    const text = await window.getByTestId('migration-screen').innerText();
    expect(text).not.toMatch(/cutover|hub|turso|cdc/i);
    await shot(window, 'importing');
  });

  test('los cambios de estado llegan por evento y siguen el camino', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await gateWith(app, window, { kind: 'checking' });
    await expect(window.getByRole('heading', { name: 'Getting ready' })).toBeVisible();

    await force(app, { kind: 'seeding', rowsLeft: 300, rowsTotal: 1200, problem: null });
    await expect(window.getByRole('heading', { name: 'Uploading your library' })).toBeVisible();
    await expect(window.getByText('900 of 1,200 items uploaded')).toBeVisible();
    await expect(window.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    );
    await shot(window, 'seeding');

    await force(app, {
      kind: 'seeding',
      rowsLeft: 300,
      rowsTotal: 1200,
      problem: 'The sync service paused uploads for today.',
    });
    await expect(window.getByText(/paused uploads for today/)).toBeVisible();
    await expect(window.getByText(/picks up again by itself/)).toBeVisible();

    await force(app, { kind: 'waiting-other', deviceName: 'Desk PC', since: Date.now() });
    await expect(
      window.getByRole('heading', { name: 'Another PC is moving your library' }),
    ).toBeVisible();
    await expect(window.getByText(/Desk PC started at/)).toBeVisible();
  });

  test('la pregunta de los PCs rezagados manda wait y continue', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await gateWith(app, window, {
      kind: 'question-lagging',
      rechecking: false,
      devices: [
        {
          deviceId: 'd-self',
          deviceName: 'Study PC',
          reason: 'pending-changes',
          self: true,
          lastReportAt: Date.now(),
          pendingChanges: 12,
        },
        {
          deviceId: 'd-other',
          deviceName: 'Laptop',
          reason: 'stale',
          self: false,
          lastReportAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
          pendingChanges: 0,
        },
      ],
    });

    await expect(window.getByText('Study PC (this PC)')).toBeVisible();
    await expect(window.getByText(/12 changes never reached the sync service/)).toBeVisible();
    await expect(window.getByText('Laptop', { exact: true })).toBeVisible();
    await expect(window.getByText('Has not checked in since 3 days ago.')).toBeVisible();
    await shot(window, 'question-lagging');

    await window.getByRole('button', { name: 'Wait for them' }).click();
    await window.getByRole('button', { name: 'Continue anyway' }).click();
    await expect.poll(() => actions(app)).toEqual([{ type: 'wait' }, { type: 'continue' }]);

    // Una comprobación en curso: se avisa y los botones se apagan.
    await force(app, {
      kind: 'question-lagging',
      rechecking: true,
      devices: [
        {
          deviceId: 'd-other',
          deviceName: 'Laptop',
          reason: 'pending-changes',
          self: false,
          lastReportAt: Date.now(),
          pendingChanges: 1,
        },
      ],
    });
    await expect(window.getByText('Checking again…')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Wait for them' })).toBeDisabled();
  });

  test('el formulario de emparejado valida y manda submit-pairing', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await gateWith(app, window, {
      kind: 'needs-pairing',
      reason: 'first-pc',
      hubUrl: null,
      error: null,
      canRetrySecret: false,
    });

    const connect = window.getByRole('button', { name: 'Connect' });
    await expect(connect).toBeDisabled();
    await shot(window, 'needs-pairing');

    const address = window.getByLabel('SYNC SERVICE ADDRESS');
    await address.fill('http://example.com');
    await expect(window.getByRole('alert')).toContainText('https://');
    await window.getByLabel('ONE-TIME CODE').fill('ABCD-1234');
    await expect(connect).toBeDisabled();

    await address.fill('https://sync.example.com/');
    await expect(window.getByRole('alert')).toHaveCount(0);
    await expect(connect).toBeEnabled();
    await connect.click();

    await expect
      .poll(() => actions(app))
      .toEqual([{ type: 'submit-pairing', hubUrl: 'https://sync.example.com', code: 'ABCD-1234' }]);
  });

  test('el error enseña el mensaje y Try again manda retry', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await gateWith(app, window, {
      kind: 'error',
      code: 'import-failed',
      message: "Couldn't copy your library.",
    });

    await expect(window.getByText("Couldn't copy your library.")).toBeVisible();
    await expect(window.getByText('Your Afterplay 1 library has not been changed.')).toBeVisible();
    await shot(window, 'error');

    await window.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => actions(app)).toEqual([{ type: 'retry' }]);

    // Un fallo que no promete nada sobre la 1.x no lo dice.
    await force(app, { kind: 'error', code: 'finish-failed', message: 'Could not finish.' });
    await expect(window.getByText('Could not finish.')).toBeVisible();
    await expect(window.getByText(/has not been changed/)).toHaveCount(0);
  });

  test('al terminar (done) aparece la biblioteca', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await gateWith(app, window, { kind: 'finishing' });
    await expect(gamesLink(window)).toHaveCount(0);

    await force(app, { kind: 'done' });

    await expect(window.getByTestId('migration-screen')).toHaveCount(0);
    await expect(gamesLink(window)).toBeVisible();
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();
  });
});
