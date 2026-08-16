import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo, /api va al `wrangler dev` de al lado. Así el navegador ve
    // UN SOLO origen igual que en producción (donde el mismo Worker sirve la
    // PWA y la API, ver worker/wrangler.jsonc): sin esto habría que montar
    // CORS con credenciales solo para el modo dev, o sea probar una cosa
    // distinta de la que se despliega.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Lo consume el Worker como assets estáticos (assets.directory apunta
    // aquí). Un solo `dist` que se despliega con el propio Worker.
    outDir: 'dist',
    emptyOutDir: true,

    // EL CÓDIGO PARTIDO EN TROZOS, y no por estética: esto es una PWA que se
    // abre con datos, que se redespliega cada vez que se toca una pantalla, y
    // cuyo primer pintado (la Home) no necesita ni la ficha ni el Plan ni
    // Sessions — esos van en chunks lazy() desde src/App.tsx y aquí solo se
    // decide dónde viven las librerías.
    //
    // Medido sobre el build real (todo junto eran 521 kB / 160,7 kB gzip que
    // se descargaban ENTEROS para pintar la Home):
    //
    //   eager   index.js (armazón + Home + Library) 21,9 kB  (  7,1 kB gzip)
    //           vendor.js ........................ 333,1 kB  (109,0 kB gzip)
    //   lazy    GameDetailScreen.js ............... 40,2 kB  (  9,9 kB gzip)
    //           markdown.js (solo con la ficha) .. 106,7 kB  ( 31,5 kB gzip)
    //           PlanScreen.js ..................... 17,7 kB  (  5,2 kB gzip)
    //           SessionsScreen.js .................. 3,8 kB  (  1,6 kB gzip)
    //
    // El primer pintado baja de 160,7 a 116,5 kB gzip (-27%). Y en cada
    // redespliegue la caché sigue mandando: tocar una pantalla mueve su chunk
    // (1,6-9,9 kB gzip), no los 160,5 kB de cuando todo era un fichero.
    //
    // POR QUÉ MARKDOWN VA APARTE del chunk de la ficha: son 37,6 kB gzip que
    // solo usa components/detail/sections.tsx y que no cambian nunca; si
    // vivieran dentro de GameDetailScreen.js, cada retoque de la ficha los
    // volvería a bajar enteros.
    //
    // OJO con `includeDependenciesRecursively` (por defecto true): con él, el
    // grupo markdown capturaba también las dependencias de react-markdown —
    // REACT incluido—, así que index.js y vendor.js importaban del chunk
    // markdown y sus 37,6 kB gzip se precargaban SIEMPRE, ficha o no ficha.
    // Con false el grupo captura solo lo que casa con el test, react se queda
    // en vendor y markdown.js solo lo pide quien lo usa: la ficha.
    //
    // Lo que se probó y NO sirvió, para que nadie lo repita: `target:
    // 'es2022'` deja el JS EXACTAMENTE igual (el código fuente ya es moderno y
    // rolldown no estaba degradando nada) y engorda el CSS de Tailwind de
    // 33,4 kB a 35,0 kB.
    rolldownOptions: {
      output: {
        // `codeSplitting` es el nombre nuevo de `advancedChunks` (mismo
        // formato); el viejo ya avisaba de deprecado en cada build.
        codeSplitting: {
          groups: [
            {
              name: 'markdown',
              test: /node_modules[\\/](micromark|mdast|hast|unist|unified|vfile|remark|react-markdown|property-information)/,
              includeDependenciesRecursively: false,
            },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
});
