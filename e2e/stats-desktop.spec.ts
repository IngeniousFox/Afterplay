import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { SeedGame } from './sandbox';
import { DEFAULT_SEED } from './seed';

test.describe('Stats de escritorio', () => {
  test('abre con hero, récords y capítulos visuales sin barra fija', async ({
    afterplay,
  }, testInfo) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    await expect(window.locator('.afterplay-stats-hero')).toBeVisible();
    await expect(window.getByText('ALL TIME // ARCHIVE')).toBeVisible();
    await expect(window.getByRole('heading', { name: 'How the time moved' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'The games that defined it' })).toBeVisible();
    await expect(window.getByText('GAMES TRACKED')).toBeVisible();
    await expect(window.getByText('TOTAL PLAYTIME')).toBeVisible();
    await expect(window.getByRole('navigation', { name: 'Stats chapters' })).toHaveCount(0);

    const records = window.getByRole('region', { name: 'Archive records' });
    await expect(records.getByText('Longest session', { exact: true })).toBeVisible();
    await expect(records.getByText('Hottest day', { exact: true })).toBeVisible();
    await expect(records.getByText('Peak month', { exact: true })).toBeVisible();
    await expect(records.getByText('Finish line', { exact: true })).toBeVisible();

    await window.waitForTimeout(800);
    await window.screenshot({ path: testInfo.outputPath('stats-redesign.png'), fullPage: false });

    const hours = window.getByText('Hours per month', { exact: true });
    await hours.evaluate((element) =>
      element.closest('.afterplay-stat-card')?.scrollIntoView({ block: 'start' }),
    );
    await expect(hours).toBeInViewport();
    await expect(window.locator('.afterplay-category-card')).toHaveCount(3);
    await expect(window.locator('.afterplay-streak-orbit')).toBeVisible();
    const inspectedBar = window
      .locator('.afterplay-category-card')
      .first()
      .locator('.afterplay-category-column:not(.is-empty)')
      .first();
    await inspectedBar.hover();
    await expect(inspectedBar).toHaveClass(/is-active/);
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-rhythm.png'),
      fullPage: false,
    });

    const spent = window.getByText('Spent per month', { exact: true });
    await spent.evaluate((element) =>
      element.closest('.afterplay-stat-card')?.scrollIntoView({ block: 'center' }),
    );
    await expect(spent).toBeInViewport();
    await window.waitForTimeout(300);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-rhythm-lower.png'),
      fullPage: false,
    });

    const genre = window.getByText('Genre Spread', { exact: true });
    await genre.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(genre).toBeInViewport();
    await expect(window.locator('.afterplay-genre-row')).toHaveCount(6);
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-games.png'),
      fullPage: false,
    });

    const completed = window.locator('.afterplay-completed-button').first();
    await completed.evaluate((element) =>
      element.closest('.afterplay-stat-card')?.scrollIntoView({ block: 'center' }),
    );
    await expect(completed).toBeInViewport();
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-completed.png'),
      fullPage: false,
    });

    const milestones = window.getByRole('heading', { name: 'The cabinet' });
    await milestones.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(milestones).toBeInViewport();
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-milestones.png'),
      fullPage: false,
    });

    const pace = window.getByRole('heading', { name: 'How you actually play' });
    await pace.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(pace).toBeInViewport();
    await expect(window.locator('.afterplay-hltb-summary')).toBeVisible();
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-pace.png'),
      fullPage: false,
    });

    const backlog = window.getByRole('heading', {
      name: 'What entered, what left, what waits',
    });
    await backlog.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(backlog).toBeInViewport();
    await expect(window.locator('.afterplay-backlog-flow-stat')).toHaveCount(3);
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('stats-redesign-backlog.png'),
      fullPage: false,
    });

    const debt = window.locator('.afterplay-debt-card');
    await debt.scrollIntoViewIfNeeded();
    await expect(debt).toBeInViewport();
    await expect(window.getByText('PACE FORECAST')).toBeVisible();
    await window.waitForTimeout(450);
    await debt.screenshot({ path: testInfo.outputPath('stats-redesign-debt.png') });

    const age = window.locator('.afterplay-age-card');
    await age.scrollIntoViewIfNeeded();
    await expect(age).toBeInViewport();
    await expect(age.locator('.afterplay-age-era')).toHaveCount(4);
    const firstEra = age.locator('.afterplay-age-era').first();
    await firstEra.hover();
    await expect(firstEra).toHaveAttribute('data-active', 'true');
    await window.waitForTimeout(380);
    await age.screenshot({ path: testInfo.outputPath('stats-redesign-game-age.png') });
  });

  test('los números de capítulo no invaden los títulos', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    const headings = window.locator('.afterplay-stats-chapter-heading');
    await expect(headings).toHaveCount(5);
    const collisions = await headings.evaluateAll((elements) =>
      elements.flatMap((element, index) => {
        const number = element.querySelector('.afterplay-stats-chapter-number');
        const title = element.querySelector('h2');
        if (!number || !title) return [`chapter ${index + 1}: missing geometry`];
        const numberBox = number.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        return numberBox.right <= titleBox.left ? [] : [`chapter ${index + 1}: overlap`];
      }),
    );
    expect(collisions).toEqual([]);

    await headings.last().evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(
      window.getByRole('heading', { name: 'What entered, what left, what waits' }),
    ).toBeInViewport();
  });

  test('el movimiento anual comparte el nuevo lenguaje visual', async ({ afterplay }, testInfo) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    await window.getByRole('button', { name: 'All Time', exact: true }).click();
    await window.getByRole('button', { name: '2026', exact: true }).click();

    const movement = window.locator('.afterplay-movement-card');
    await movement.scrollIntoViewIfNeeded();
    await expect(movement).toBeInViewport();
    await expect(movement.locator('.afterplay-movement-stage')).toBeVisible();
    await expect(movement.locator('.afterplay-movement-side')).toHaveCount(2);
    await window.waitForTimeout(1_200);
    await movement.screenshot({ path: testInfo.outputPath('stats-backlog-movement.png') });
  });

  test('Session length conserva un gráfico compacto junto a seis comparaciones HLTB', async ({}, testInfo) => {
    const durationHours = [
      ...Array.from({ length: 39 }, () => 0.25),
      ...Array.from({ length: 32 }, () => 0.65),
      ...Array.from({ length: 17 }, () => 1.25),
      ...Array.from({ length: 4 }, () => 2.5),
    ];
    const games: SeedGame[] = Array.from({ length: 6 }, (_, gameIndex) => ({
      title: `Pace sample ${gameIndex + 1}`,
      releaseYear: 2020 + gameIndex,
      hltb: { main: 8 + gameIndex * 2 },
      playthroughs: [
        {
          manualHours: gameIndex === 0 ? 0 : 5 + gameIndex * 3,
          sessions:
            gameIndex === 0
              ? durationHours.map((hours, sessionIndex) => ({
                  at: new Date(
                    Date.UTC(
                      2026,
                      sessionIndex % 6,
                      1 + (sessionIndex % 27),
                      8 + (sessionIndex % 10),
                    ),
                  ),
                  hours,
                }))
              : undefined,
          events: [
            { type: 'started', at: new Date('2026-01-01T09:00:00.000Z'), precision: 'day' },
            { type: 'completed', at: new Date('2026-08-20T18:00:00.000Z'), precision: 'day' },
          ],
        },
      ],
    }));
    const launched = await launchAfterplay({ games });

    try {
      const { window } = launched;
      await goTo(window, '/stats');

      const pace = window.getByRole('heading', { name: 'How you actually play' });
      await pace.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect(pace).toBeInViewport();

      const hltb = window.locator('.afterplay-hltb-card');
      const sessionLength = window.locator('.afterplay-session-length-card.is-overview');
      await expect(hltb.locator('.afterplay-hltb-row')).toHaveCount(6);
      await expect(sessionLength.locator('.afterplay-session-insights > div')).toHaveCount(3);
      await expect(sessionLength.getByText('0h 39m', { exact: true })).toBeVisible();
      await expect(sessionLength.getByText('77%', { exact: true })).toBeVisible();
      await expect(sessionLength.getByText('2h 30m', { exact: true })).toBeVisible();

      const longSessions = sessionLength.getByRole('group', { name: /2–4h, 4 sessions/ });
      await longSessions.hover();
      await expect(sessionLength.locator('.afterplay-session-focus')).toContainText('INSPECTING');
      await expect(sessionLength.locator('.afterplay-session-focus')).toContainText('2–4h');
      await expect(longSessions).toHaveClass(/is-active/);

      const geometry = await sessionLength.evaluate((card) => {
        const cardBox = card.getBoundingClientRect();
        const stageBox = card.querySelector('.afterplay-session-stage')?.getBoundingClientRect();
        const insightsBox = card
          .querySelector('.afterplay-session-insights')
          ?.getBoundingClientRect();
        return {
          cardHeight: cardBox.height,
          stageHeight: stageBox?.height ?? 0,
          stageInsideCard: Boolean(
            stageBox && stageBox.top >= cardBox.top && stageBox.bottom <= cardBox.bottom,
          ),
          insightsBelowChart: Boolean(stageBox && insightsBox && insightsBox.top > stageBox.bottom),
        };
      });
      expect(geometry.cardHeight).toBeGreaterThan(450);
      expect(geometry.stageHeight).toBeGreaterThanOrEqual(148);
      expect(geometry.stageHeight).toBeLessThanOrEqual(152);
      expect(geometry.cardHeight).toBeGreaterThan(geometry.stageHeight * 3);
      expect(geometry.stageInsideCard).toBe(true);
      expect(geometry.insightsBelowChart).toBe(true);

      await sessionLength.locator('.afterplay-chart-heading').hover();
      await window.waitForTimeout(700);
      await window.screenshot({
        path: testInfo.outputPath('stats-session-length-capped.png'),
        fullPage: false,
      });
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });

  test('Backlog flow conserva las tres historias con totales muy descompensados', async ({}, testInfo) => {
    // Replica la forma de una biblioteca importada en bloque: Library y Plan
    // saltan casi de golpe, mientras Completed conserva años de actividad.
    // Las cifras son menores que las reales para mantener rápido el test,
    // pero respetan aproximadamente la misma desproporción.
    const libraryGames: SeedGame[] = Array.from({ length: 34 }, (_, index) => {
      const completedAt = new Date(Date.UTC(2021 + Math.floor(index / 3), (index * 4) % 12, 15));
      const startedAt = new Date(completedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
      const isCompleted = index < 14;
      const isStarted = index >= 14 && index < 32;
      const paceSessions =
        index === 14
          ? Array.from({ length: 10 }, (_, sessionIndex) => ({
              at: new Date(Date.UTC(2026, 5, 26 + sessionIndex * 7)),
              hours: 9.6,
            }))
          : undefined;
      return {
        title: `Flow library ${index + 1}`,
        addedAt: new Date('2026-09-01T12:00:00.000Z'),
        releaseYear: 1998 + (index % 28),
        hltb: { main: index >= 32 ? 3.5 : 10 },
        playthroughs: isCompleted
          ? [
              {
                events: [
                  { type: 'started', at: startedAt, precision: 'day' },
                  { type: 'completed', at: completedAt, precision: 'day' },
                ],
              },
            ]
          : isStarted
            ? [
                {
                  events: [
                    {
                      type: 'started',
                      at: new Date('2026-01-15T12:00:00.000Z'),
                      precision: 'day',
                    },
                  ],
                  sessions: paceSessions,
                },
              ]
            : undefined,
      };
    });
    const plannedGames: SeedGame[] = Array.from({ length: 67 }, (_, index) => ({
      title: `Flow plan ${index + 1}`,
      planned: true,
      addedAt: new Date('2026-09-01T12:00:00.000Z'),
      releaseYear: 1990 + (index % 36),
      hltb: { main: 110 },
    }));
    const launched = await launchAfterplay({ games: [...libraryGames, ...plannedGames] });

    try {
      const { window } = launched;
      await goTo(window, '/stats');
      const backlog = window.locator('.afterplay-backlog-flow-card');
      await backlog.scrollIntoViewIfNeeded();
      await expect(backlog).toBeInViewport();

      await expect(window.getByText('OWN SCALE · EACH LANE')).toBeVisible();
      await expect(window.locator('[data-flow-lane]')).toHaveCount(3);
      await expect(window.getByText('+34 bulk add')).toBeVisible();
      await expect(window.getByText('+67 bulk add')).toBeVisible();

      const lineHeights = await window
        .locator('[data-flow-series]')
        .evaluateAll((paths) => paths.map((path) => (path as SVGGraphicsElement).getBBox().height));
      expect(lineHeights).toHaveLength(3);
      for (const height of lineHeights) expect(height).toBeGreaterThan(35);

      await window.waitForTimeout(650);
      await backlog.screenshot({ path: testInfo.outputPath('stats-backlog-imbalanced.png') });

      const debt = window.locator('.afterplay-debt-card');
      await debt.scrollIntoViewIfNeeded();
      await expect(debt.getByText('7,377', { exact: true })).toBeVisible();
      await expect(debt.getByText('2', { exact: true })).toBeVisible();
      await expect(debt.getByText('67', { exact: true })).toBeVisible();
      const debtGeometry = await debt.evaluate((card) => {
        const hero = card.querySelector('.afterplay-debt-hero')?.getBoundingClientRect();
        const total = card.querySelector('.afterplay-debt-total')?.getBoundingClientRect();
        const forecast = card.querySelector('.afterplay-debt-forecast')?.getBoundingClientRect();
        const sources = Array.from(card.querySelectorAll('.afterplay-debt-source')).map((source) =>
          source.getBoundingClientRect(),
        );
        return {
          totalFits: Boolean(hero && total && total.right <= hero.right + 1),
          sourcesFit: Boolean(
            forecast && sources.every((source) => source.right <= forecast.right + 1),
          ),
        };
      });
      expect(debtGeometry).toEqual({ totalFits: true, sourcesFit: true });
      await debt.screenshot({ path: testInfo.outputPath('stats-debt-large.png') });
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });

  test('Completed sube ligeramente sin crecer y Hall of Fame responde con suavidad', async ({
    afterplay,
  }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    const completed = window.locator('.afterplay-completed-button').first();
    await completed.scrollIntoViewIfNeeded();
    await completed.hover();
    const readCompletedMotion = (): Promise<{
      scaleX: number;
      scaleY: number;
      translateY: number;
      coverScaleX: number;
      coverScaleY: number;
    }> =>
      completed.evaluate((element) => {
        const matrixFor = (target: Element): DOMMatrixReadOnly => {
          const transform = getComputedStyle(target).transform;
          return transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
        };
        const button = matrixFor(element);
        const cover = element.querySelector('.afterplay-completed-cover');
        const coverMatrix = cover ? matrixFor(cover) : new DOMMatrixReadOnly();
        return {
          scaleX: button.a,
          scaleY: button.d,
          translateY: button.f,
          coverScaleX: coverMatrix.a,
          coverScaleY: coverMatrix.d,
        };
      });
    await expect
      .poll(async () => (await readCompletedMotion()).translateY, { timeout: 2_000 })
      .toBeLessThan(-1);
    const completedMotion = await readCompletedMotion();
    expect(completedMotion.scaleX).toBeCloseTo(1, 2);
    expect(completedMotion.scaleY).toBeCloseTo(1, 2);
    expect(completedMotion.translateY).toBeLessThan(-1);
    expect(completedMotion.translateY).toBeGreaterThan(-3);
    expect(completedMotion.coverScaleX).toBeCloseTo(1, 2);
    expect(completedMotion.coverScaleY).toBeCloseTo(1, 2);

    const fame = window.locator('.afterplay-fame-medallion').first();
    await fame.scrollIntoViewIfNeeded();
    await fame.hover();
    const readFameMotion = (): Promise<{ translateY: number; iconTransform: string }> =>
      fame.evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        const matrix =
          transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
        const icon = element.querySelector('.afterplay-fame-icon');
        return {
          translateY: matrix.f,
          iconTransform: icon ? getComputedStyle(icon).transform : 'none',
        };
      });
    await expect
      .poll(async () => (await readFameMotion()).translateY, { timeout: 2_000 })
      .toBeLessThan(-2);
    const fameMotion = await readFameMotion();
    expect(fameMotion.translateY).toBeLessThan(-2);
    expect(fameMotion.iconTransform).not.toBe('none');
  });

  test('el líder del hero abre su juego', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    await window.locator('button.afterplay-stats-leader[aria-label="Open Terraria"]').click();
    await expect(window).toHaveURL(/#\/games\/\d+$/);
  });

  test('Almost There conserva una composición potente con varios juegos', async ({}, testInfo) => {
    // Variante desechable del seed: no toca la biblioteca real ni modifica
    // el seed canónico. Solo acerca tres catálogos existentes al 100% para
    // poder verificar el bloque que la muestra normal no alcanza a pintar.
    const unlockedByTitle = new Map([
      ['007 First Light', 22],
      ['Strange Horticulture', 15],
      ['Halls of Torment', 20],
    ]);
    const games = DEFAULT_SEED.map((game) => {
      const unlocked = unlockedByTitle.get(game.title);
      return unlocked === undefined || !game.achievements
        ? game
        : { ...game, achievements: { ...game.achievements, unlocked } };
    });
    const launched = await launchAfterplay({ games });

    try {
      const { window } = launched;
      await goTo(window, '/stats');
      const almostThere = window.getByText('Almost there', { exact: true });
      await almostThere.evaluate((element) =>
        element.closest('.afterplay-almost-section')?.scrollIntoView({ block: 'center' }),
      );
      await expect(almostThere).toBeInViewport();
      await expect(window.locator('.afterplay-almost-card')).toHaveCount(3);
      await window.waitForTimeout(500);
      await window.screenshot({
        path: testInfo.outputPath('stats-redesign-almost-there.png'),
        fullPage: false,
      });
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });
});
