import type { Page } from '@playwright/test';
import { expect, goTo, test } from './fixtures';

// EL ATERRIZAJE EN UN LOGRO, DE PUNTA A PUNTA.
//
// El rediseño (LOGROS-REDISENO §1) convirtió los mini-trofeos de una sesión en
// enlaces: pulsar uno lleva a la sección de logros de la ficha, despliega la
// lista si el logro cae más allá del corte y le da un parpadeo dorado. Es una
// coreografía de tres piezas —módulo mensajero, ajuste durante el render y
// animación CSS— y ninguna de las tres se veía desde un test hasta ahora.
//
// LA CICATRIZ QUE BLINDA. Pulsar DOS VECES SEGUIDAS el mismo trofeo solo
// parpadeaba la primera; hacía falta pasar por otro logro para que volviera a
// funcionar. Dos causas, las dos por estado que subía y no volvía a bajar: la
// clase de la animación se quedaba puesta (y el navegador solo arranca una
// animación cuando la clase APARECE, así que volver a ponerla no relanzaba
// nada) y `handledFlash` seguía marcando la petición como atendida. Este test
// hace exactamente eso: mismo trofeo, dos veces, sin pasar por otro.
//
// REAL: la app entera, la fila de verdad y la clase de verdad
// (afterplay-flash-gold, main.css). El seed cuelga los dos primeros logros
// conseguidos de la sesión más reciente de cada juego (e2e/sandbox.ts), que es
// como los ata la app cuando el cronómetro está en marcha — y de la más
// reciente para que la fila con trofeos entre en las cinco que el historial
// enseña sin desplegar.

const idOf = async (page: Page, title: string): Promise<number> => {
  const games = await page.evaluate(() => globalThis.api.games.getAll());
  const found = games.find((game) => game.title === title);
  if (!found) throw new Error(`el seed no trae "${title}" — revisa e2e/seed.ts`);
  return found.id;
};

// La fila que parpadea, por su marca en el DOM. El id del logro se saca de la
// propia fila que se va a pulsar, no de un número escrito a mano.
const flashingRows = (page: Page): ReturnType<Page['locator']> =>
  page.locator('[data-ach].afterplay-flash-gold');

test.describe('aterrizaje en un logro', () => {
  test('pulsar el mismo trofeo dos veces seguidas parpadea LAS DOS VECES', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    // Strange Horticulture: 18 logros (7 conseguidos) y sesiones medidas, así
    // que su historial trae trofeos pulsables.
    const gameId = await idOf(page, 'Strange Horticulture');
    await goTo(page, `/games/${gameId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Strange Horticulture' }),
    ).toBeVisible();

    // El primer trofeo del historial de sesiones. Su aria-label lleva el
    // nombre del logro ("Open achievement: Logro 1"), que es como lo ve quien
    // navega con lector de pantalla.
    const trophy = page.getByRole('button', { name: /^Open achievement:/ }).first();
    await expect(trophy).toBeVisible();

    // ── Primera vez ────────────────────────────────────────────────────────
    await trophy.click();
    // El parpadeo arranca 450ms después del clic (primero la fila se lleva a
    // la vista); esperar al HECHO, no a un tiempo inventado.
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });
    const landed = await flashingRows(page).first().getAttribute('data-ach');
    expect(landed).not.toBeNull();

    // Y la clase se RETIRA al acabar la animación (1.1s x 2). Sin esto, la
    // fila se quedaba marcada para siempre y de ahí venía el fallo.
    await expect(flashingRows(page)).toHaveCount(0, { timeout: 6000 });

    // ── Segunda vez, el MISMO trofeo y sin pasar por otro ──────────────────
    await trophy.click();
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });
    expect(await flashingRows(page).first().getAttribute('data-ach')).toBe(landed);
  });

  test('aterrizar limpia el buscador y despliega la lista, tambien al repetir', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const gameId = await idOf(page, 'Strange Horticulture');
    await goTo(page, `/games/${gameId}`);

    const trophy = page.getByRole('button', { name: /^Open achievement:/ }).first();
    await expect(trophy).toBeVisible();

    await trophy.click();
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });
    await expect(flashingRows(page)).toHaveCount(0, { timeout: 6000 });

    // Con 18 logros hay buscador (SEARCH_THRESHOLD = 12). El de LOGROS, no el
    // de la biblioteca ("Search games…"), que también vive en esta pantalla.
    // Se escribe algo que no puede casar con nada: si el aterrizaje no
    // limpiara la caja, la fila seguiría filtrada fuera y no habría nada que
    // parpadear.
    const search = page.getByPlaceholder('Search achievements…');
    await search.fill('zzzz');
    await expect(flashingRows(page)).toHaveCount(0);

    await trophy.click();
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });
    await expect(search).toHaveValue('');
  });
});

// ── El resto de sitios donde se menciona un logro ──────────────────────────
// El enlace no puede existir solo en las sesiones: si un logro se enseña con
// su cara, se va a él. Estos tests cubren las tres superficies que quedaban —
// la vitrina de la ficha (la pieza destacada y las de "ALSO RARE"), y en
// Stats el hero y el medallero, que además tienen que CRUZAR de pantalla.

test.describe('enlaces desde el resto de superficies', () => {
  test('la pieza destacada de la vitrina lleva a su fila en la lista', async ({ afterplay }) => {
    const { window: page } = afterplay;

    const gameId = await idOf(page, 'Strange Horticulture');
    await goTo(page, `/games/${gameId}`);

    // La vitrina preside con el conseguido más raro; el seed reparte rarezas
    // crecientes (2%, 5%, 8%…), así que el más raro es el primero.
    const featured = page.getByRole('button', { name: /^Find in the list:/ }).first();
    await expect(featured).toBeVisible();
    const label = await featured.getAttribute('aria-label');

    await featured.click();
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });

    // Y la fila que parpadea es la de ESE logro, no otra: se compara el nombre
    // que llevaba la medalla con el que pinta la fila.
    const name = (label ?? '').replace('Find in the list: ', '');
    await expect(flashingRows(page).first()).toContainText(name);
  });

  test('el hero de Stats cruza a la ficha y aterriza en su logro', async ({ afterplay }) => {
    const { window: page } = afterplay;

    // Quién preside el salón de la fama lo dice el main, no una suposición del
    // test: así el día que cambie el seed esto sigue mirando al logro bueno.
    const overview = await page.evaluate(() => globalThis.api.achievements.getOverview(null));
    const star = overview.hallOfFame[0];
    expect(star).toBeTruthy();

    await goTo(page, '/stats');
    const hero = page.getByRole('button', { name: new RegExp(star.displayName) }).first();
    await expect(hero).toBeVisible();
    await hero.click();

    // Cruza de pantalla (la ficha del juego del logro) y aterriza en su fila.
    await expect(page.getByRole('heading', { level: 1, name: star.gameTitle })).toBeVisible();
    await expect(flashingRows(page)).toHaveCount(1, { timeout: 4000 });
    expect(await flashingRows(page).first().getAttribute('data-ach')).toBe(
      String(star.achievementId),
    );
  });
});
