import { expect, goTo, test } from './fixtures';

// E-22 (AFTERPLAY-2.0.md §17.3, F-39): "Un cambio de gasto llega por sync con
// la pantalla de estadísticas abierta" → "La pantalla se actualiza sin
// reiniciar".
//
// LO QUE ESTE TEST PUEDE Y NO PUEDE PROBAR. El motor de sync no existe en un
// E2E (src/main/lib/e2e.ts: ni arranca ni hay hub), así que la bajada real no
// se puede provocar aquí; esa mitad la prueba hub/convergence/__tests__/
// dataChanged.test.ts (dos clientes y hub reales: el motor del que recibe avisa
// del dominio `spend`). Lo que sí se puede probar con la app de verdad es el
// resto de la cadena: un cambio de gasto que el renderer NO hizo con sus
// mutaciones (se escribe llamando al IPC a pelo, sin ningún gancho de
// invalidación) llega al main, la puerta de escritura confirma, el main manda
// 'data:changed' y la pantalla de Estadísticas, ya abierta, cambia su total sin
// recargar. Es exactamente el camino que sigue un gasto bajado por sync a
// partir de que el motor avisa.

const parseMoney = (text: string): number => {
  // El contador anima con un rebote: de paso puede enseñar un importe negativo.
  const match = /€(-?\d+(?:\.\d+)?)/.exec(text);
  if (!match) throw new Error(`no hay un importe en "${text}"`);
  return Number(match[1]);
};

test.describe('E-22: la pantalla de estadísticas se actualiza sola', () => {
  test('un gasto que no pasa por las mutaciones del renderer cambia el total sin recargar', async ({
    afterplay,
  }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    const metric = window.locator('.afterplay-stats-metric', { hasText: 'TOTAL SPENT' });
    await expect(metric).toBeVisible();
    // El contador anima de 0 al valor: se espera a que se asiente.
    let before = 0;
    await expect
      .poll(async () => {
        const first = parseMoney(await metric.innerText());
        await window.waitForTimeout(450);
        const second = parseMoney(await metric.innerText());
        before = second;
        return first === second;
      })
      .toBe(true);

    // Marca en la propia página: si algo recargara la ventana, desaparecería.
    await window.evaluate(() => {
      (globalThis as unknown as { __notReloaded: boolean }).__notReloaded = true;
    });

    const added = 1234.5;
    await window.evaluate(async (amount) => {
      const [game] = await globalThis.api.games.getAll();
      await globalThis.api.spend.add({
        gameId: game.id,
        type: 'purchase',
        amount,
        occurredAt: new Date('2025-02-01T00:00:00Z'),
        datePrecision: 'day',
        note: null,
      });
    }, added);

    // La pantalla, sin tocar nada, enseña el total nuevo.
    await expect
      .poll(async () => parseMoney(await metric.innerText()), { timeout: 10_000 })
      .toBeCloseTo(before + added, 2);
    expect(
      await window.evaluate(
        () => (globalThis as unknown as { __notReloaded?: boolean }).__notReloaded,
      ),
    ).toBe(true);
  });
});
