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
  },
});
