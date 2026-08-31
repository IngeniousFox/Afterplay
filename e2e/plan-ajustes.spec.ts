import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CredentialsValues, PromotePlannedGameInput } from '../src/shared/types';
import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { SeedGame } from './sandbox';

// PLAN TO PLAY Y AJUSTES — dos pantallas sin relación entre sí, en el mismo
// fichero porque así se repartió la zona del E2E.
//
// LO QUE BLINDA cada bloque:
//  - Plan to play: que la lista SOLO trae planeados (games:getPlanned filtra
//    en el propio SQL, no en el renderer — un filtro roto ahí colaría
//    biblioteca entera en esta pantalla); que "Up next" es de verdad quien
//    decide el orden (splitPlanSections, lib/plan.ts) y no un accidente del
//    orden de inserción; y que promocionar un planeado (promotePlannedGame.ts)
//    es una ACTUALIZACIÓN del mismo id, no un borrar-y-recrear — así que el
//    historial (el 'plan_to_play' de cuando se planeó) tiene que seguir ahí.
//  - Ajustes: que guardar una clave desde el formulario (CredentialsSection)
//    de verdad llega a credentials.json (settings:setCredentials) y no solo
//    al estado local del formulario; y que exportar/importar (el traslado a
//    otro PC) hace un ROUND-TRIP real — no solo que el botón no revienta.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: la app entera es real (Electron compilado,
// SQLite real con las migraciones del repo, IPC real) — lo único de mentira
// es el contenido de la biblioteca, que aquí se siembra a mano en vez de
// venir de e2e/seed.ts (ver el porqué justo debajo de UP_NEXT_SEED).
//
// CICATRIZ QUE ESTO DESTAPÓ, DE FIXTURE Y NO DE PRODUCCIÓN: e2e/seed.ts trae
// "Behind the Frame: The Finest Scenery" con un comentario que dice "PLANEADO
// normal, sin fijar" pero el dato que va justo debajo SÍ trae `pinnedAt`
// puesto (2026-08-06T13:50) — viene de una copia real de la biblioteca del
// dueño (scripts/gen-e2e-seed.ts vuelca planPinnedAt tal cual esté en su BD),
// así que probablemente lo fijó y el comentario a mano no se actualizó. Se
// comprobó en caliente con un test desechable: los TRES planeados del seed
// por defecto salen fijados en Up next, y la cola queda vacía. Eso hace
// imposible escribir aquí "un fijado sale arriba, uno sin fijar se queda
// abajo" contra ese seed — así que los tests 2 y 3 siembran su PROPIA
// biblioteca mínima (vía launchAfterplay({ games }), el patrón que ya
// contempla e2e/fixtures.ts) en vez de tocar e2e/seed.ts, que no está en la
// zona de este cambio.
test.describe('Plan to play', () => {
  test('lista los tres planeados del seed y ningún juego de la biblioteca', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    await goTo(page, '/plan');

    await expect(page.getByText('Octopath Traveler', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Chrono Trigger', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Behind the Frame: The Finest Scenery', { exact: true }).first(),
    ).toBeVisible();

    // Los ONCE juegos del seed son planeados o de biblioteca, nunca las dos
    // cosas — así que si algo de esto se viera aquí sería la query
    // (games:getPlanned) trayendo de más, no un filtro de UI mal puesto.
    await expect(page.getByText("Assassin's Creed II", { exact: true })).toHaveCount(0);
    await expect(page.getByText('Terraria', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Alan Wake', { exact: true })).toHaveCount(0);
    await expect(page.getByText('007 First Light', { exact: true })).toHaveCount(0);
  });
});

// Biblioteca mínima para los dos tests de orden de Up next: dos fijados con
// fechas de pin DISTINTAS (para poder afirmar quién va primero) y uno sin
// fijar. releaseYear en el pasado a propósito — isUnreleased() (releaseDate.ts)
// solo tiene releaseYear para decidir cuando no hay releaseDate explícita
// (que este sembrado no pone), y un "sin salir" caería en el horizonte
// plegado en vez de en la cola normal, rompiendo la comparación de orden.
const UP_NEXT_SEED: SeedGame[] = [
  {
    title: 'E2E Plan Alpha',
    planned: true,
    pinnedAt: new Date('2026-01-01T00:00:00.000Z'),
    releaseYear: 2015,
    playthroughs: [
      {
        events: [
          { type: 'plan_to_play', at: new Date('2025-12-01T00:00:00.000Z'), precision: 'day' },
        ],
      },
    ],
  },
  {
    title: 'E2E Plan Beta',
    planned: true,
    pinnedAt: new Date('2026-01-02T00:00:00.000Z'),
    releaseYear: 2016,
    playthroughs: [
      {
        events: [
          { type: 'plan_to_play', at: new Date('2025-12-02T00:00:00.000Z'), precision: 'day' },
        ],
      },
    ],
  },
  {
    title: 'E2E Plan Gamma',
    planned: true,
    releaseYear: 2017,
    playthroughs: [
      {
        events: [
          { type: 'plan_to_play', at: new Date('2025-12-03T00:00:00.000Z'), precision: 'day' },
        ],
      },
    ],
  },
];

test.describe('Plan to play — Up next', () => {
  test('los fijados salen arriba y ordenados por cuándo se fijaron; el que no está fijado se queda en la cola', async () => {
    const { app, window: page, sandbox } = await launchAfterplay({ games: UP_NEXT_SEED });
    try {
      await goTo(page, '/plan');

      // Dos secciones reales de la pantalla (PlanToPlay.tsx): "UP NEXT" y,
      // con al menos un fijado, la cola se rotula "THE REST".
      const upNextSection = page.locator('section', { hasText: 'UP NEXT' });
      const queueSection = page.locator('section', { hasText: 'THE REST' });

      await expect(upNextSection.getByText('E2E Plan Alpha', { exact: true })).toBeVisible();
      await expect(upNextSection.getByText('E2E Plan Beta', { exact: true })).toBeVisible();
      // El no fijado NO está en Up next — la propia sección no lo contiene.
      await expect(upNextSection.getByText('E2E Plan Gamma', { exact: true })).toHaveCount(0);

      // Y sí está en la cola, no fijado tampoco ahí.
      await expect(queueSection.getByText('E2E Plan Gamma', { exact: true })).toBeVisible();
      await expect(queueSection.getByText('E2E Plan Alpha', { exact: true })).toHaveCount(0);

      // Orden DENTRO de Up next: Alpha se fijó el 1-ene, Beta el 2-ene —
      // splitPlanSections (lib/plan.ts) ordena por planPinnedAt ascendente,
      // así que Alpha tiene que pintarse más arriba que Beta.
      const alphaBox = await upNextSection
        .getByText('E2E Plan Alpha', { exact: true })
        .boundingBox();
      const betaBox = await upNextSection.getByText('E2E Plan Beta', { exact: true }).boundingBox();
      expect(alphaBox).not.toBeNull();
      expect(betaBox).not.toBeNull();
      expect(alphaBox!.y).toBeLessThan(betaBox!.y);
    } finally {
      await app.close().catch(() => {});
      sandbox.cleanup();
    }
  });

  test('fijar o soltar un pin desde la fila mueve el juego de estantería y cambia el orden', async () => {
    const { app, window: page, sandbox } = await launchAfterplay({ games: UP_NEXT_SEED });
    try {
      await goTo(page, '/plan');

      const upNextSection = page.locator('section', { hasText: 'UP NEXT' });
      const queueSection = page.locator('section', { hasText: 'THE REST' });
      // La fila entera de un juego: el único elemento ".group" de PlanRow
      // (mismo hook de Tailwind que usan sus botones fantasma para
      // group-hover) que contiene el título exacto — así el botón de pin, que
      // vive DENTRO de esa fila, queda acotado a ESE juego y no al primero
      // que aparezca con ese nombre de botón en toda la pantalla.
      const rowFor = (title: string): Locator => page.locator('.group').filter({ hasText: title });

      // Fijar Gamma desde la cola. En este momento es el ÚNICO planeado sin
      // fijar, así que "Pin to Up next" (el aria-label de PinButton) es un
      // botón sin ambigüedad en toda la pantalla.
      await rowFor('E2E Plan Gamma').getByRole('button', { name: 'Pin to Up next' }).click();

      await expect(upNextSection.getByText('E2E Plan Gamma', { exact: true })).toBeVisible();
      await expect(queueSection.getByText('E2E Plan Gamma', { exact: true })).toHaveCount(0);

      // Aterriza el ÚLTIMO de los tres: un pin nuevo lleva la marca de AHORA
      // (useSetPlanPinned, hooks/games.ts), la más reciente de las tres.
      const betaBox1 = await upNextSection
        .getByText('E2E Plan Beta', { exact: true })
        .boundingBox();
      const gammaBox1 = await upNextSection
        .getByText('E2E Plan Gamma', { exact: true })
        .boundingBox();
      expect(betaBox1!.y).toBeLessThan(gammaBox1!.y);

      // Soltar Alpha (el primero de los tres fijados ahora): sale de Up next
      // y cae en la cola; Beta y Gamma mantienen su orden relativo.
      await rowFor('E2E Plan Alpha').getByRole('button', { name: 'Remove from Up next' }).click();

      await expect(upNextSection.getByText('E2E Plan Alpha', { exact: true })).toHaveCount(0);
      await expect(queueSection.getByText('E2E Plan Alpha', { exact: true })).toBeVisible();

      const betaBox2 = await upNextSection
        .getByText('E2E Plan Beta', { exact: true })
        .boundingBox();
      const gammaBox2 = await upNextSection
        .getByText('E2E Plan Gamma', { exact: true })
        .boundingBox();
      expect(betaBox2!.y).toBeLessThan(gammaBox2!.y);
    } finally {
      await app.close().catch(() => {});
      sandbox.cleanup();
    }
  });
});

// Todos los campos que promotePlannedGame.ts necesita más allá de `gameId` —
// el mismo Omit<CreateGameWithDetailsInput,'source'> que manda el modal de
// "Add to library" (AddGameModal.tsx), pero llamado directo por `api` en vez
// de rellenar el formulario: el modal en modo promote salta a la búsqueda si
// el planeado no tiene igdbId (y el seed no lo pone — ver sandbox.ts), así
// que ejercitar el formulario de verdad exigiría antes buscar en IGDB, que es
// justo la parte que este test NO quiere probar. La cadena renderer->preload
// ->IPC->main sigue siendo la de verdad; lo que se salta es solo el relleno a
// golpe de ratón de un formulario de catorce campos.
const PROMOTE_INPUT: Omit<PromotePlannedGameInput, 'gameId'> = {
  endless: false,
  isEmulated: false,
  iteration: { playedPlatform: 'PC (Microsoft Windows)', origin: 'Purchased', format: 'digital' },
  hoursPlayed: null,
  started: null,
  finished: null,
  initialStatus: null,
  note: null,
  gameNotes: null,
  moneySpent: null,
  moneySpentDate: null,
  executablePath: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  installDirectory: null,
  installSizeBytes: null,
};

test.describe('Plan to play — promocionar', () => {
  test('promocionar un planeado lo saca del Plan, lo mete en la biblioteca y conserva su historial', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    const target = await page.evaluate(async () => {
      const planned = await globalThis.api.games.getPlanned();
      const game = planned.find((candidate) => candidate.title === 'Octopath Traveler');
      if (!game) throw new Error('el seed por defecto no trae "Octopath Traveler"');
      return { id: game.id };
    });

    // ANTES: está en el Plan y NO en la biblioteca — el contraste que hace
    // que "después" signifique algo.
    const before = await page.evaluate(async (gameId) => {
      const [planned, library] = await Promise.all([
        globalThis.api.games.getPlanned(),
        globalThis.api.games.getAll(),
      ]);
      return {
        inPlan: planned.some((game) => game.id === gameId),
        inLibrary: library.some((game) => game.id === gameId),
      };
    }, target.id);
    expect(before.inPlan).toBe(true);
    expect(before.inLibrary).toBe(false);

    const promoted = await page.evaluate(
      async ({ gameId, input }) => {
        return globalThis.api.games.promote({ gameId, ...input });
      },
      { gameId: target.id, input: PROMOTE_INPUT },
    );
    // El id NO cambia (promotePlannedGame.ts actualiza la fila, no la
    // recrea) — es la garantía de que lo de abajo mide el MISMO juego.
    expect(promoted.id).toBe(target.id);
    expect(promoted.planned).toBe(false);

    const after = await page.evaluate(async (gameId) => {
      const [planned, library, detail] = await Promise.all([
        globalThis.api.games.getPlanned(),
        globalThis.api.games.getAll(),
        globalThis.api.games.getById(gameId),
      ]);
      return {
        inPlan: planned.some((game) => game.id === gameId),
        inLibrary: library.some((game) => game.id === gameId),
        // games:getAll ya filtra planned=false en el propio SQL
        // (getGames.ts) — estar en esta lista ES la prueba de planned=false,
        // sin que el canal tenga que traer el campo.
        hasPlanToPlayEvent: detail?.stateHistory.some((event) => event.type === 'plan_to_play'),
      };
    }, target.id);

    expect(after.inPlan).toBe(false);
    expect(after.inLibrary).toBe(true);
    expect(after.hasPlanToPlayEvent).toBe(true);
  });
});

// ── AJUSTES ──────────────────────────────────────────────────────────────
//
// LO QUE BLINDA: que la sección de credenciales (CredentialsSection.tsx) no
// es un formulario mudo — guardar desde la UI llega de verdad a
// credentials.json (settings:setCredentials) y exportar/importar hace un
// viaje de ida y vuelta real por un fichero en disco, no solo "el botón no
// revienta".
//
// Se usa Anthropic como campo de pruebas (una sola clave, opcional, y NO
// está entre las garantizadas de .env.test — CREDENCIALES GARANTIZADAS del
// encargo): así el valor de partida es indiferente, el test escribe su
// propio marcador y comprueba que ESE marcador es el que vuelve.
const settingsButton = (page: Page): Locator => page.getByRole('button', { name: 'Settings' });

test.describe('Ajustes — conexiones', () => {
  test('la pestaña de Connections enseña el badge de un servicio ya configurado', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;

    await settingsButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Connections' }).click();

    // El sandbox SIEMPRE deja algo en twitchClientId/Secret — reales de
    // .env.test si existe, o el relleno de PLACEHOLDER_CREDENTIALS si no
    // (sandbox.ts) — así que la fila de IGDB tiene que leer "Configured" sin
    // condicionar el test a que exista .env.test.
    const igdbRow = dialog.getByRole('button', { name: /IGDB/ });
    await expect(igdbRow.getByText('Configured', { exact: true })).toBeVisible();
  });

  test('guardar una credencial nueva desde el formulario se aplica de verdad (settings.getCredentials)', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    const marker = `e2e-anthropic-${Date.now()}`;

    await settingsButton(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();

    // Anthropic empieza cerrado (el acordeón solo abre uno a la vez, y
    // ninguno arranca abierto sin el spotlight de IGDB del primer arranque) —
    // al abrirlo, su input de API KEY es el ÚNICO <input> de todo el modal.
    await dialog.getByRole('button', { name: 'Anthropic' }).click();
    const input = dialog.locator('input');
    await expect(input).toHaveCount(1);
    await input.fill(marker);

    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(dialog.getByText('Saved — applied immediately')).toBeVisible();

    // La prueba de verdad NO es el toast: es leer la credencial por el
    // mismo canal (settings:getCredentials) que usa cualquier otra parte de
    // la app, sin pasar por la caché de React Query del formulario.
    const saved = await page.evaluate(() => globalThis.api.settings.getCredentials());
    expect(saved.anthropicApiKey).toBe(marker);
  });
});

test.describe('Ajustes — exportar / importar claves', () => {
  test('exportar a una carpeta e importar desde el fichero hace un round-trip completo', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    // Sin diálogo nativo (Playwright no puede pilotar el picker del SO): se
    // llama a settings.exportCredentials/importCredentials directos, tal
    // como pide el encargo — son los mismos dos canales IPC que
    // CredentialsSection.tsx usa tras la elección de carpeta/fichero.
    const exportDir = mkdtempSync(join(tmpdir(), 'afterplay-e2e-keys-'));
    try {
      const marker = `e2e-roundtrip-${Date.now()}`;

      const before = await page.evaluate(() => globalThis.api.settings.getCredentials());
      // Se manda el objeto ENTERO (spread de `before`) y no solo el campo
      // tocado: settings:setCredentials (main/config/credentials.ts) REEMPLAZA
      // las catorce claves con lo que reciba — un campo que falte en el
      // input se guarda como null. Mandar solo { anthropicApiKey } habría
      // borrado sin querer el resto de credenciales del sandbox (incluidas
      // las de IGDB, reales si hay .env.test).
      const withMarker: CredentialsValues = { ...before, anthropicApiKey: marker };
      await page.evaluate((input) => globalThis.api.settings.setCredentials(input), withMarker);

      const confirmedSet = await page.evaluate(() => globalThis.api.settings.getCredentials());
      expect(confirmedSet.anthropicApiKey).toBe(marker);

      const exportedPath = await page.evaluate(
        (dir) => globalThis.api.settings.exportCredentials(dir),
        exportDir,
      );

      // El fichero en disco lleva el marcador, con el nombre de variable de
      // entorno que ENV_BY_CREDENTIAL_KEY dice (credentialKeys.ts) — la
      // forma exacta que exportCredentialsTo escribe.
      const onDisk = JSON.parse(readFileSync(exportedPath, 'utf-8')) as {
        keys: Record<string, string>;
      };
      expect(onDisk.keys.ANTHROPIC_API_KEY).toBe(marker);

      // Se BORRA el marcador antes de importar — si no, "el import trajo el
      // valor correcto" podría ser en realidad "nunca se había ido".
      const withoutMarker: CredentialsValues = { ...before, anthropicApiKey: null };
      await page.evaluate((input) => globalThis.api.settings.setCredentials(input), withoutMarker);
      const cleared = await page.evaluate(() => globalThis.api.settings.getCredentials());
      expect(cleared.anthropicApiKey).toBeNull();

      const importResult = await page.evaluate(
        (path) => globalThis.api.settings.importCredentials(path),
        exportedPath,
      );
      expect(importResult.imported).toBeGreaterThan(0);
      expect(importResult.values.anthropicApiKey).toBe(marker);

      // Y el canal normal de lectura lo confirma — el round-trip completo:
      // guardado -> exportado -> borrado -> importado -> de vuelta.
      const after = await page.evaluate(() => globalThis.api.settings.getCredentials());
      expect(after.anthropicApiKey).toBe(marker);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
