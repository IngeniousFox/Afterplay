import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';

// PRESUPUESTO DE BUNDLE — el equivalente aquí a presupuestos.test.ts.
//
// Se mide en BYTES y no en milisegundos a propósito: los bytes son
// deterministas y los ms del arranque de Electron no lo son. Si un chunk se
// pasa, el build FALLA en vez de engordar en silencio, que es exactamente
// como se llegó a los 4,55 MB de un solo trozo sin que nadie se enterara.
//
// Los topes llevan holgura sobre lo medido (ver los números en cada uno) para
// que un componente nuevo no rompa el build por 2 KB. Si te topas con uno:
// NO subas el número sin mirar antes qué ha entrado — casi siempre es una
// librería pesada colada en el arranque, y la respuesta es un import
// dinámico en su pantalla, no un presupuesto más alto.
const BUDGETS: { match: RegExp; maxKB: number; what: string }[] = [
  // El chunk de ENTRADA: lo pagan LAS DOS ventanas (app y overlay) antes de
  // pintar nada. Medido 253,75 KB. Aquí solo deberían vivir React, react-dom,
  // react-query y la TitleBar — si crece, es que algo se ha importado de
  // forma estática en main.tsx y ha arrastrado media app con él.
  { match: /^assets\/index-[^/]+\.js$/, maxKB: 300, what: 'chunk de entrada (main.tsx)' },
  // Medido 587,09 KB después de separar rutas, editor, lector Markdown y
  // controles de Ajustes (antes 1626,47 KB). Margen del 11%, no espacio para
  // volver a colar el editor o una pantalla completa en el arranque.
  { match: /^assets\/Afterplay-[^/]+\.js$/, maxKB: 650, what: 'arbol de escritorio' },
  // El HUD del overlay, que nace con un juego ya corriendo. Medido 36,02 KB.
  { match: /^assets\/OverlayHud-[^/]+\.js$/, maxKB: 80, what: 'HUD del overlay' },
];

// Entrada + Afterplay + TODOS sus imports estáticos, cada chunk una vez.
// Medido 915,37 KB: index 253,92 + Afterplay 587,09 + useLiveTimer 74,36.
// Medir solo Afterplay permitiría esconder una regresión en un chunk común.
// Los imports dinámicos quedan fuera: se pagan al usar su pantalla/editor.
const DESKTOP_STARTUP_MAX_KB = 1000;
const AFTERPLAY_MODULE = resolve('src/renderer/src/Afterplay.tsx');

const bundleBudget = (): Plugin => ({
  name: 'afterplay-bundle-budget',
  generateBundle(_options, bundle) {
    for (const [fileName, out] of Object.entries(bundle)) {
      if (out.type !== 'chunk') continue;
      const budget = BUDGETS.find((b) => b.match.test(fileName));
      if (!budget) continue;
      const kb = Buffer.byteLength(out.code) / 1000;
      if (kb > budget.maxKB) {
        this.error(
          `Presupuesto de bundle superado: ${budget.what} (${fileName}) ocupa ` +
            `${kb.toFixed(2)} kB, tope ${budget.maxKB} kB. Mira QUE ha entrado antes de subir el tope ` +
            `(electron.vite.config.ts, BUDGETS).`,
        );
      }
    }

    const startupChunks = new Set<string>();
    const includeStaticImports = (fileName: string): void => {
      if (startupChunks.has(fileName)) return;
      const chunk = bundle[fileName];
      if (!chunk || chunk.type !== 'chunk') return;
      startupChunks.add(fileName);
      for (const imported of chunk.imports) includeStaticImports(imported);
    };
    for (const [fileName, chunk] of Object.entries(bundle)) {
      if (chunk.type !== 'chunk') continue;
      if (
        chunk.isEntry ||
        (chunk.facadeModuleId !== null && resolve(chunk.facadeModuleId) === AFTERPLAY_MODULE)
      ) {
        includeStaticImports(fileName);
      }
    }
    let startupBytes = 0;
    for (const fileName of startupChunks) {
      const chunk = bundle[fileName];
      if (chunk.type === 'chunk') startupBytes += Buffer.byteLength(chunk.code);
    }
    const startupKB = startupBytes / 1000;
    if (startupKB > DESKTOP_STARTUP_MAX_KB) {
      this.error(
        `Presupuesto de arranque de escritorio superado: ${startupKB.toFixed(2)} kB ` +
          `en ${startupChunks.size} chunks estáticos, tope ${DESKTOP_STARTUP_MAX_KB} kB. ` +
          `Revisa los imports de ${[...startupChunks].join(', ')} antes de subir el tope.`,
      );
    }
  },
});

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      // MINIFICAR. Parece que sobra decirlo en un build de producción, pero no:
      // electron-vite fuerza `minify: false` en su preset del renderer
      // (electronRendererConfigPresetPlugin), así que sin esta línea la app se
      // publicaba con el bundle SIN minificar. Costaba 4550,31 kB de JS y
      // 243,02 kB de CSS; con esto, 2080,49 kB y 193,78 kB. Un 54% del
      // arranque eran nombres largos, espacios y comentarios de node_modules.
      //
      // De paso, esto es lo que hace que react-router pese lo que debe: la
      // 7.18 publica los MISMOS ficheros en dist/development y dist/production
      // (byte a byte), y sus 219 KB de avisos de desarrollo solo desaparecen
      // cuando el `process.env.NODE_ENV` que Vite ya sustituye deja el código
      // muerto y el minificador se lo lleva. Sin minify no se lo llevaba nadie.
      minify: 'esbuild',
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      tailwindcss(),
      bundleBudget(),
    ],
  },
});
