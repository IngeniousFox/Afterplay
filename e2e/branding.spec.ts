import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSplashHtml, SPLASH_SIZE } from '../src/main/splash/splashHtml';
import { expect, test } from './fixtures';

test.describe('identidad de Afterplay', () => {
  test('la luciérnaga abre Ajustes con ratón y teclado', async ({ afterplay }, testInfo) => {
    const { window } = afterplay;
    await expect(window.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    const settings = window.getByTitle('Settings', { exact: true });
    const image = settings.locator('img');
    await expect(image).toBeVisible();
    expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(512);
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.screenshot({ path: testInfo.outputPath('settings-firefly.png') });
    await window.screenshot({ path: testInfo.outputPath('library-firefly.png') });

    await settings.click();
    await expect(window.getByRole('dialog')).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await window.keyboard.press('Escape');
    await expect(window.getByRole('dialog')).not.toBeVisible();

    await settings.focus();
    await window.keyboard.press('Enter');
    await expect(window.getByRole('dialog')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await window.emulateMedia({ reducedMotion: 'reduce' });
    await settings.hover();
    expect(await image.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe(
      'none',
    );
    await expect(image).toBeVisible();
  });

  test('la ventana y el favicon ya no se llaman Electron', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await expect(window).toHaveTitle('Afterplay');
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((candidate) => candidate.webContents.getURL().includes('index.html'))
          ?.getTitle(),
      ),
    ).toBe('Afterplay');

    const favicon = await window.locator('link[rel="icon"]').getAttribute('href');
    expect(favicon).toMatch(/icon-.*\.png$/);
    expect(
      await window.evaluate(async () => {
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        const image = new Image();
        image.src = link!.href;
        await image.decode();
        return image.naturalWidth;
      }),
    ).toBeGreaterThanOrEqual(256);
  });

  test('el icono nativo tiene transparencia real y los colores de la luciérnaga', async ({
    afterplay,
  }) => {
    const stats = await afterplay.app.evaluate(
      ({ nativeImage }, path) => {
        const image = nativeImage.createFromPath(path);
        const pixels = image.toBitmap(); // BGRA on Windows.
        let clear = 0;
        let green = 0;
        let gold = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const [b, g, r, a] = pixels.subarray(index, index + 4);
          if (a === 0) clear++;
          if (a > 230 && g > r * 1.5 && g > b * 1.3) green++;
          if (a > 230 && r > 140 && g > 90 && b < g * 0.7 && r > g) gold++;
        }
        return { size: image.getSize(), clear, green, gold, corner: pixels[3] };
      },
      join(process.cwd(), 'resources', 'icon.png'),
    );

    expect(stats.size.width).toBe(stats.size.height);
    expect(stats.size.width).toBeGreaterThanOrEqual(256);
    expect(stats.corner).toBe(0);
    expect(stats.clear).toBeGreaterThan(stats.size.width ** 2 * 0.4);
    expect(stats.green).toBeGreaterThan(1000);
    expect(stats.gold).toBeGreaterThan(1000);
  });

  test('el splash muestra la luciérnaga y el texto TV, incluso sin animaciones', async ({
    afterplay,
  }, testInfo) => {
    const { app } = afterplay;
    // Render the exact production HTML in an extra sandbox window. The real
    // startup is never artificially delayed for a screenshot or a test.
    const html = buildSplashHtml(
      `data:image/png;base64,${readFileSync(join(process.cwd(), 'resources', 'icon.png')).toString(
        'base64',
      )}`,
    );
    const newWindow = app.waitForEvent('window');
    const id = await app.evaluate(
      ({ BrowserWindow }, { html, size }) => {
        const preview = new BrowserWindow({
          ...size,
          frame: false,
          show: false,
          skipTaskbar: true,
          webPreferences: { sandbox: true, backgroundThrottling: false },
        });
        void preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return preview.id;
      },
      { html, size: SPLASH_SIZE },
    );
    const splash = await newWindow;

    try {
      await splash.waitForLoadState('load');
      await expect(splash.getByRole('heading', { name: 'AFTERPLAY' })).toBeVisible();
      expect(
        await splash.locator('.logo').evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth >= 256;
        }),
      ).toBe(true);
      await splash.waitForFunction(
        () => getComputedStyle(document.querySelector('.title')!).opacity === '1',
      );
      await splash.screenshot({ path: testInfo.outputPath('splash-animated.png') });

      await splash.emulateMedia({ reducedMotion: 'reduce' });
      await expect(splash.getByRole('status', { name: 'Loading Afterplay' })).toBeVisible();
      expect(
        await splash.locator('.title').evaluate((element) => ({
          animation: getComputedStyle(element).animationName,
          weight: getComputedStyle(element).fontWeight,
          text: element.textContent,
        })),
      ).toEqual({ animation: 'none', weight: '800', text: 'AFTERPLAY' });
      const title = await splash.locator('.title').boundingBox();
      expect(title!.x).toBeGreaterThan(0);
      expect(title!.x + title!.width).toBeLessThanOrEqual(SPLASH_SIZE.width);
      await splash.screenshot({ path: testInfo.outputPath('splash-reduced-motion.png') });
    } finally {
      await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), id);
    }
  });
});
