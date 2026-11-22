import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

// AJUSTES -> SYNC, sin hub.
//
// El sync 2.0 no existe en un test E2E (src/main/lib/e2e.ts + SyncRuntime): ni
// arranca, ni deja emparejar, ni hay hub contra el que hacerlo. Lo que sí se
// puede comprobar con la app de verdad es la parte que no depende de uno: que
// la tarjeta sale en su estado "sin emparejar", que la dirección se valida
// mientras se escribe (https obligatorio salvo localhost) y que el proceso
// principal se niega a emparejar. NUNCA se empareja: el botón queda apagado y
// la llamada directa por IPC la rechaza el main antes de tocar la red.

test.describe('sync en Ajustes', () => {
  test('sin emparejar, valida la dirección del hub y no deja emparejar en un test', async ({
    afterplay,
  }) => {
    const { window, sandbox } = afterplay;

    await window.getByRole('link', { name: 'Settings', exact: true }).click();
    const dialog = window.getByTestId('settings-page');
    await dialog.getByRole('link', { name: 'Sync', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Sync', exact: true })).toBeVisible();

    // La tarjeta, en su estado de fábrica.
    await expect(dialog.getByText('Not paired.')).toBeVisible();
    // El formulario nace plegado: no añade campos de texto a la sección.
    await expect(dialog.getByPlaceholder('https://your-hub.example')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Pair this PC…' }).click();
    await expect(dialog.getByText('Sync is turned off in this session.')).toBeVisible();
    const address = dialog.getByPlaceholder('https://your-hub.example');
    await expect(address).toHaveValue('');
    // Un campo vacío no se estrena en rojo.
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // http fuera de localhost: la dirección lleva el token del dispositivo.
    await address.fill('http://hub.example.com');
    await expect(dialog.getByRole('alert')).toContainText('must start with https://');
    // Algo que ni siquiera es una dirección.
    await address.fill('not a url');
    await expect(dialog.getByRole('alert')).toContainText('not a valid address');
    // Lo válido: https, y http solo en la propia máquina.
    await address.fill('https://hub.example.com');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await address.fill('http://localhost:8787');
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // Con dirección y código válidos el botón sigue apagado: en E2E no se empareja.
    await dialog.getByPlaceholder('Code from the web app').fill('ABCD-1234');
    await expect(dialog.getByRole('button', { name: 'Pair', exact: true })).toBeDisabled();

    // El main lo confirma: sin sync disponible y sin emparejado.
    const status = await window.evaluate(() => globalThis.api.sync.getStatus());
    expect(status.available).toBe(false);
    expect(status.paired).toBe(false);
    expect(status.hubUrl).toBeNull();
    // Y si alguien lo intentara por IPC, se rechaza antes de salir a la red
    // (dirección reservada .invalid: no resuelve nunca).
    const attempt = await window.evaluate(() =>
      globalThis.api.sync.pair({ hubUrl: 'https://hub.invalid', code: 'ABCD-1234' }),
    );
    expect(attempt.ok).toBe(false);

    // Nada del sync llega a las credenciales del sandbox.
    const credentialsPath = join(sandbox.userDataDir, 'credentials.json');
    expect(existsSync(credentialsPath)).toBe(true);
    const stored = readFileSync(credentialsPath, 'utf-8');
    expect(stored).not.toContain('syncHub');
  });
});
