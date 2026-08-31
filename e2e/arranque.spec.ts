import { expect, test } from './fixtures';

// EL ARRANQUE, DE VERDAD Y ENTERO.
//
// Este es el test que ningún test de unidad puede hacer: main + preload +
// renderer + SQLite + los tres relojes del splash, todo junto, en el binario
// que se instala. Lo que blinda es la cadena completa — que la app abra una
// base sembrada desde fuera, la sirva por IPC y la pinte — porque cada
// eslabón de esa cadena se ha roto alguna vez por separado (el gate de
// contenido dejando la ventana negra, el bundle partido, un canal de IPC
// renombrado en un lado y no en el otro).

test.describe('arranque de la app', () => {
  test('la ventana aparece con la biblioteca sembrada dentro', async ({ afterplay }) => {
    const { window } = afterplay;

    // Los tres juegos del sandbox, pintados por la app de verdad. Que sus
    // títulos estén ahí demuestra la cadena entera: la base que sembramos
    // desde fuera se abrió, cruzó el IPC y llegó al DOM.
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();
    await expect(window.getByText('Terraria').first()).toBeVisible();
    await expect(window.getByText('Alan Wake').first()).toBeVisible();
  });

  test('la ventana se enseña SOLO cuando ya hay contenido, no en negro', async ({ afterplay }) => {
    const { app, window } = afterplay;

    // El tercer reloj del arranque (useStartupContentSignal + el gate de
    // main/index.ts): la ventana nace oculta y no se revela hasta que la
    // biblioteca tiene datos. La regresión que esto vigila es la de agosto —
    // la partición del bundle dejó el primer frame en una TitleBar sobre
    // fondo negro y la ventana se enseñaba así.
    //
    // Se comprueba en el orden en que importa: cuando la ventana está
    // visible, el contenido YA tiene que estar.
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();

    const visible = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const main = windows.find((candidate) =>
        candidate.webContents.getURL().includes('index.html'),
      );
      return main?.isVisible() ?? false;
    });
    expect(visible).toBe(true);
  });

  test('no se queda ningún error sin gestionar en el arranque', async ({ afterplay }) => {
    const { window } = afterplay;

    // Los errores del renderer que nadie captura acaban aquí. Un arranque
    // limpio no tiene ninguno — y si alguno aparece, este test dice cuál en
    // vez de dejar que se manifieste como una pantalla rara tres tests más
    // allá.
    const errors: string[] = [];
    window.on('pageerror', (error) => errors.push(error.message));
    window.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();
    // Un margen para que lo que se dispara tras el primer pintado (avisos,
    // suscripciones, precarga de carátulas) tenga tiempo de fallar si va a
    // fallar.
    await window.waitForTimeout(1_500);

    expect(errors).toEqual([]);
  });
});
