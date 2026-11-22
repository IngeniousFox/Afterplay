import type { Page } from '@playwright/test';
import { expect, goTo, test } from './fixtures';
import type { GameId } from '../src/shared/entityIds';

// LOS GESTOS DE LA BIBLIOTECA, EN LA UI REAL.
//
// Lo que blindan estos ocho tests es la mitad de la app que más se toca:
// cambiar el estado de un juego (con su guarda contra duplicados en el log,
// la regla de SPEC 4.5 que existía por un bug real de "Playing" repetido),
// el botón Play que no debe ofrecer nada que no pueda cumplir, un borrado
// que exige teclear el nombre para no perder una biblioteca por un clic, el
// buscador y los filtros de Library, la paleta de Ctrl K, y que la ficha de un juego con dos
// playthroughs los enseñe los DOS — no solo el último, que es la trampa fácil
// de una vista "sencilla".
//
// REAL: la app entera (main + preload + renderer), el binario compilado
// (out/main), SQLite con las migraciones de verdad — cada clic pasa por el
// mismo camino que en la instalación del dueño. Cambiar de estado o borrar un
// juego se comprueba además con `globalThis.api.games.getById/getAll`, la
// misma llamada que hace la UI: si un canal de IPC se renombrara, esto se
// pondría rojo igual que un botón que dejara de responder.
//
// DOBLE: nada de red. Los ocho juegos de la biblioteca (los tres planeados
// viven aparte, en /plan) y su historial salen enteros de e2e/seed.ts, así
// que qué estado tiene cada uno ANTES de tocar nada es un dato conocido, no
// una suposición — está documentado ahí, no repetido de memoria aquí.
//
// Los ids no se dan por buenos por el orden de inserción: cada test busca el
// suyo por título con `idOf`, así que si el seed cambia de orden el test
// sigue encontrando el juego que le toca en vez de abrir el que ya no es.
const idOf = async (page: Page, title: string): Promise<GameId> => {
  const games = await page.evaluate(() => globalThis.api.games.getAll());
  const found = games.find((game) => game.title === title);
  if (!found) throw new Error(`el seed no trae "${title}" — revisa e2e/seed.ts`);
  return found.id;
};

test.describe('biblioteca', () => {
  test('cambiar de estado desde StatusCard escribe un evento nuevo en el log', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    // Halls of Torment es ENDLESS y su único evento sembrado es 'resting'
    // (ver seed.ts): un endless nunca "termina", así que pasar a Playing
    // reutiliza su único contenedor en vez de abrir un playthrough nuevo —
    // justo el camino de StatusCard que NO crea iteración (needsNewIteration
    // solo se dispara si el último es terminal Y el destino es 'playing', y
    // 'resting' no es terminal).
    const gameId = await idOf(page, 'Halls of Torment');
    await goTo(page, `/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Halls of Torment' })).toBeVisible();

    // Estado de partida: el banner dice "Resting" y el dropdown ya trae
    // seleccionado "Rest" (STATUS_ITEM_LABEL de 'resting'), que es lo que
    // deja el evento sembrado.
    await expect(page.getByText('Resting', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Rest', exact: true }).click();
    await page.getByText('Mark as Playing', { exact: true }).click();
    await page.getByRole('button', { name: 'Save status' }).click();

    // El banner cambia de color y de texto solo cuando la mutation resolvió
    // y react-query refrescó `game` — esperar a ESE hecho, no a un tiempo
    // inventado.
    await expect(page.getByText('Playing', { exact: true }).first()).toBeVisible();

    // Y lo que de verdad importa: el log CRECIÓ (append-only, SPEC 4.5), no
    // se sobrescribió el evento sembrado. Si StatusCard mutara el estado en
    // vez de añadir un evento, esto seguiría en 1.
    const detail = await page.evaluate(
      (id) => globalThis.api.games.getById(id).then((game) => (game ? game.stateHistory : null)),
      gameId,
    );
    expect(detail).not.toBeNull();
    const events = detail as { type: string }[];
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['resting', 'started']),
    );

    const refreshed = await page.evaluate((id) => globalThis.api.games.getById(id), gameId);
    expect(refreshed?.currentState).toBe('started');
  });

  test('guardar el mismo estado sin nota queda bloqueado (isNoOp)', async ({ afterplay }) => {
    const { window: page } = afterplay;

    // Alan Wake está 'dropped' (started y dropped el mismo día, seed.ts): el
    // dropdown nace con "Drop" ya elegido porque coincide con el estado
    // actual, así que sin tocar nada `pending === currentKey` y el botón
    // debe nacer bloqueado — el bug real que esta regla evita era pulsar
    // "Save status" varias veces sobre el mismo estado y llenar el log de
    // eventos idénticos.
    const gameId = await idOf(page, 'Alan Wake');
    await goTo(page, `/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alan Wake' })).toBeVisible();

    const saveButton = page.getByRole('button', { name: 'Save status' });
    await expect(saveButton).toBeDisabled();

    // Con una nota SÍ hay algo que guardar (progreso, "seguí otro rato"),
    // aunque el estado elegido sea el mismo — es el contraste que demuestra
    // que el bloqueo es por "estado+nota", no solo por "estado".
    await page.getByPlaceholder('Add a note (e.g. Chapter 3)…').fill('lo he vuelto a intentar');
    await expect(saveButton).toBeEnabled();
  });

  test('el botón Play está deshabilitado sin executablePath', async ({ afterplay }) => {
    const { window: page } = afterplay;

    // Ningún juego del seed trae executablePath (llega solo por Edit o por
    // el escaneo de carpeta) — Terraria vale igual que cualquier otro, pero
    // es el que más horas manuales lleva, así que si algún día el seed le
    // pone un exe "por comodidad" este test lo nota.
    const gameId = await idOf(page, 'Terraria');
    await goTo(page, `/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Terraria' })).toBeVisible();

    const playButton = page.getByRole('button', { name: 'Play' });
    await expect(playButton).toBeDisabled();
    await expect(playButton).toHaveAttribute('title', 'Not installed on this PC');
  });

  test('borrar exige teclear el nombre exacto (sin distinguir mayúsculas) y el juego desaparece', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const gameId = await idOf(page, '112 Operator');
    await goTo(page, `/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: '112 Operator' })).toBeVisible();

    await page.getByTitle('Delete game').click();
    const confirmInput = page.getByPlaceholder('112 Operator');
    await expect(confirmInput).toBeVisible();

    const deleteButton = page.getByRole('button', { name: 'Delete forever' });

    // Cualquier otra cosa, incluido el nombre a medias, no vale.
    await confirmInput.fill('112 Operat');
    await expect(deleteButton).toBeDisabled();

    // canDelete compara en minúsculas (case-insensitive) pero no toca
    // espacios ni símbolos — este es justo el caso que lo demuestra: mismo
    // texto, mayúsculas distintas.
    await confirmInput.fill('112 operator');
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    // El borrado navega solo (onDeleted = onBack en GameDetailRoute) — se
    // espera al hash, no a un timeout.
    await page.waitForFunction(() => globalThis.location.hash === '#/games');

    const titles = await page.evaluate(() =>
      globalThis.api.games.getAll().then((games) => games.map((game) => game.title)),
    );
    expect(titles).not.toContain('112 Operator');
  });

  test('el buscador de Library filtra la rejilla por parte del título', async ({ afterplay }) => {
    const { window: page } = afterplay;
    await goTo(page, '/games');

    // Desde Fósforo la búsqueda y los filtros de la antigua columna viven en
    // la propia Library: las aserciones van ancladas a su rejilla.
    const grid = page.getByTestId('library-grid');
    await expect(grid.getByText('Terraria', { exact: true })).toBeVisible();

    // "torment" es un fragmento que solo aparece en un título de los ocho de
    // biblioteca (los tres planeados no viven aquí) — filterByTitle pliega
    // acentos y separa mayúsculas, así que basta con minúsculas.
    await page.getByPlaceholder('Filter by title…').fill('torment');

    await expect(grid.getByText('Halls of Torment', { exact: true })).toBeVisible();
    await expect(grid.getByText('Terraria', { exact: true })).toHaveCount(0);
    await expect(grid.getByText("Assassin's Creed II", { exact: true })).toHaveCount(0);

    // El recuento grande dice cuántos se ven de cuántos hay.
    await expect(page.getByText('of 8 games', { exact: true })).toBeVisible();
  });

  test('filtrar por estado reduce la rejilla a los juegos que corresponden', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    await goTo(page, '/games');
    const grid = page.getByTestId('library-grid');

    // Dropped, según el seed: Alan Wake (started+dropped el mismo día) y The
    // Legend of Zelda: Link's Awakening (started -> on_hold -> dropped, el
    // evento más reciente manda). Terraria y Assassin's Creed II no lo están.
    const filters = page.getByRole('complementary', { name: 'Filters' });
    await filters.getByRole('button', { name: /^Dropped \d/ }).click();

    await expect(grid.getByText('Alan Wake', { exact: true })).toBeVisible();
    await expect(
      grid.getByText("The Legend of Zelda: Link's Awakening", { exact: true }),
    ).toBeVisible();
    await expect(grid.getByText('Terraria', { exact: true })).toHaveCount(0);
    await expect(grid.getByText("Assassin's Creed II", { exact: true })).toHaveCount(0);

    // Los filtros sobreviven a abrir una ficha y volver: la vista vive en el
    // armazón, como antes vivía en la columna.
    await grid.getByText('Alan Wake', { exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alan Wake' })).toBeVisible();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(grid.getByText('Terraria', { exact: true })).toHaveCount(0);
    await expect(grid.getByRole('button', { name: /^Alan Wake\./ })).toBeFocused();
  });

  test('Ctrl K abre la paleta y salta a la ficha de un juego', async ({ afterplay }) => {
    const { window: page } = afterplay;

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Jump to a game' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('terra');
    await expect(palette.getByRole('option', { name: /Terraria/ })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { level: 1, name: 'Terraria' })).toBeVisible();
    await expect(palette).toHaveCount(0);
  });

  test("la ficha de Assassin's Creed II pinta sus DOS playthroughs", async ({ afterplay }) => {
    const { window: page } = afterplay;

    // El caso que un sembrado de "un juego, un playthrough limpio" no puede
    // ejercitar: dos recorridos con horas manuales distintas (23h y 23h30m,
    // seed.ts) — si PlaythroughPanel solo enseñara el último, esto pasaría
    // igual con un juego de un solo playthrough, que es justo lo que no
    // queremos.
    const gameId = await idOf(page, "Assassin's Creed II");
    await goTo(page, `/games/${gameId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: "Assassin's Creed II" }),
    ).toBeVisible();

    await expect(page.getByText('Playthrough', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^#1\s+23h$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^#2\s+23h 30m$/ })).toBeVisible();
  });
});
