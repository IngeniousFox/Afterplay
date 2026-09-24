# Actualización npm del 24 de septiembre de 2026

Punto de partida: `88f2fd723a13abd47baa2f3bbece7d53d4dc8c3c`, con el árbol de trabajo limpio. Se revisaron los tres proyectos npm: escritorio, `web/` y `worker/`. Las versiones de las tablas son las resueltas en los lockfiles, no el mínimo antiguo de los rangos de `package.json`.

Se actualizaron 49 entradas de dependencias directas entre los tres proyectos y sus dependencias indirectas compatibles. Las instalaciones se resolvieron con las comprobaciones normales de npm, sin `--force` ni `--legacy-peer-deps`. Los manifiestos y lockfiles anteriores, los puntos de control y los logs de cada fase están en `C:\Users\Lara\AppData\Local\Temp\afterplay-deps-20260924-201657`.

TypeScript usa el compilador estable 7.0.2. En la raíz convive con el paquete de compatibilidad `@typescript/typescript6` (envoltorio 6.0.2, API 6.0.3) mediante los alias recomendados por TypeScript: `tsc` ejecuta 7 y las herramientas que importan `typescript`, incluido ESLint, reciben la API compatible. En web y Worker se usa TypeScript 7.0.2 directamente.

Estas son las excepciones deliberadas a las etiquetas `latest` de npm:

| Paquete                     | Versión elegida    | Motivo verificado                                                                                                                                                                                               |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite del escritorio         | 7.3.6              | `electron-vite` 5.0.0, su última versión estable, admite Vite 5/6/7. La compatibilidad con Vite 8 todavía está en una beta de electron-vite. La web sí usa Vite 8.3.1.                                          |
| Plugin React del escritorio | 5.2.0              | La rama 6.1.1 requiere Vite 8. La web sí usa 6.1.1.                                                                                                                                                             |
| ESLint                      | 9.39.5             | `eslint-plugin-react` 7.37.5 declara compatibilidad hasta ESLint 9. npm señala la deprecación de ESLint 9; pasar a 10 exige resolver antes ese plugin.                                                          |
| Drizzle ORM / Kit           | 1.0.0-rc.4, exacta | Es la RC oficial que ya usaba el proyecto. `latest` apunta a versiones 0.x anteriores y `rc5` a compilaciones de desarrollo con hash. Se retiró el `^` para evitar una RC distinta durante un refresco general. |
| Tipos de Node               | 22.20.4            | El entorno de herramientas sigue en Node 22.23.1. Electron 44 incluye Node 24.21.0; los tipos de Node 26 permitirían APIs que ninguno de esos entornos garantiza.                                               |
| Turso Sync                  | 0.7.2, exacta      | Ya era la última estable. La 0.8 está en pre-release y no se incorporó.                                                                                                                                         |

Versiones directas que cambiaron:

| Proyecto | Paquete                     | Antes        | Ahora        |
| -------- | --------------------------- | ------------ | ------------ |
| root     | @anthropic-ai/sdk           | 0.115.0      | 0.128.0      |
| root     | @aws-sdk/client-s3          | 3.1095.0     | 3.1139.0     |
| root     | @base-ui/react              | 1.6.0        | 1.8.0        |
| root     | @libsql/client              | 0.17.4       | 0.18.0       |
| root     | @tailwindcss/vite           | 4.3.2        | 4.3.3        |
| root     | @tanstack/react-query       | 5.101.2      | 5.103.2      |
| root     | @tiptap/core                | 3.28.0       | 3.31.3       |
| root     | @tiptap/extensions          | 3.28.0       | 3.31.3       |
| root     | @tiptap/pm                  | 3.28.0       | 3.31.3       |
| root     | @tiptap/react               | 3.28.0       | 3.31.3       |
| root     | @tiptap/starter-kit         | 3.28.0       | 3.31.3       |
| root     | axios                       | 1.18.1       | 1.20.0       |
| root     | dotenv                      | 17.4.2       | 18.0.3       |
| root     | lucide-react                | 1.23.0       | 1.48.0       |
| root     | react-hook-form             | 7.81.0       | 7.88.0       |
| root     | react-router-dom            | 7.18.1       | 7.18.4       |
| root     | shadcn                      | 4.13.0       | 4.21.0       |
| root     | sonner                      | 2.0.7        | 2.0.8        |
| root     | tailwind-merge              | 3.6.0        | 3.7.0        |
| root     | tailwindcss                 | 4.3.2        | 4.3.3        |
| root     | yaml                        | 2.9.0        | 2.9.1        |
| root     | zod                         | 4.4.3        | 4.6.5        |
| root     | @playwright/test            | 1.62.1       | 1.63.0       |
| root     | @types/node                 | 22.20.0      | 22.20.4      |
| root     | @types/react                | 19.2.17      | 19.3.0       |
| root     | @types/react-dom            | 19.2.3       | 19.3.0       |
| root     | @typescript/native          | nuevo        | 7.0.2        |
| root     | electron                    | 39.8.10      | 44.4.5       |
| root     | eslint                      | 9.39.4       | 9.39.5       |
| root     | eslint-plugin-react-refresh | 0.4.26       | 0.5.7        |
| root     | prettier                    | 3.9.4        | 3.9.9        |
| root     | react                       | 19.2.7       | 19.3.0       |
| root     | react-dom                   | 19.2.7       | 19.3.0       |
| root     | tsx                         | 4.23.0       | 4.23.15      |
| root     | typescript                  | 5.9.3        | 6.0.2        |
| web      | @tanstack/react-query       | 5.101.4      | 5.103.2      |
| web      | axios                       | 1.19.0       | 1.20.0       |
| web      | lucide-react                | 1.30.0       | 1.48.0       |
| web      | react                       | 19.2.8       | 19.3.0       |
| web      | react-dom                   | 19.2.8       | 19.3.0       |
| web      | react-router-dom            | 7.18.2       | 7.18.4       |
| web      | @types/react                | 19.2.18      | 19.3.0       |
| web      | @types/react-dom            | 19.2.4       | 19.3.0       |
| web      | @vitejs/plugin-react        | 6.0.5        | 6.1.1        |
| web      | typescript                  | 5.9.3        | 7.0.2        |
| web      | vite                        | 8.2.1        | 8.3.1        |
| worker   | @cloudflare/workers-types   | 5.20260809.1 | 5.20260924.1 |
| worker   | typescript                  | 5.9.3        | 7.0.2        |
| worker   | wrangler                    | 4.120.0      | 4.138.0      |

Los cambios de adaptación fueron estos:

- Dotenv 18 eliminó `dotenv/config`. `drizzle.config.ts` carga el entorno mediante `config({ quiet: true })`.
- Las definiciones de componentes `lazy` del arranque y del modo TV viven ahora en `WindowRoots.tsx` y `tv/LazyScreens.tsx`, respectivamente. Esto satisface la nueva comprobación de Fast Refresh conservando las fronteras de carga diferida.
- `@tiptap/extensions`, importado directamente por el editor, queda declarado como dependencia directa. Todos los paquetes TipTap resuelven a 3.31.3.
- El `postinstall` prepara Electron con `install-electron`. La recompilación genérica anterior fallaba en una instalación limpia al tratar de compilar SDL sin sus dependencias de desarrollo. SDL usa su instalador de precompilados; `npmRebuild: false` ya existía en la configuración de empaquetado. La nueva prueba `e2e/native-modules.spec.ts` comprueba SDL, libSQL y safeStorage dentro de Electron.
- Las pruebas externas descubrieron un cambio previo de HowLongToBeat: `/init` devuelve solo `token`, sin `hpKey` ni `hpVal`. Se reprodujo la misma respuesta con Axios 1.18.1 y 1.20.0. El cliente acepta el formato actual y conserva el anterior, rechazando tokens inválidos y pares incompletos.
- El empaquetado usa una lista de contenido permitido: `out/`, `drizzle/` y `resources/`, además de `package.json` y las dependencias de producción que añade electron-builder.

La revisión del paquete encontró `worker/.dev.vars` dentro del primer `app.asar` generado y también en el `app.asar` de la instalación anterior. Solo se inspeccionó la presencia del archivo, sin volcar sus valores. El paquete corregido ya no incluye archivos de entorno ni fuentes del Worker/web. **Falta revisar los instaladores distribuidos anteriormente y las credenciales incluidas en ese archivo**; esta tarea no comprobó si aquellos artefactos llegaron a publicarse ni rotó claves.

Verificación:

| Comprobación                                                 | Resultado                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Punto de partida                                             | 1.017 pruebas correctas; compilaciones de escritorio y web correctas                                                     |
| `npm ci` en raíz, web y Worker                               | Correcto desde los lockfiles finales                                                                                     |
| Cinco configuraciones TypeScript + compilación de escritorio | Correcto con `tsc` 7.0.2                                                                                                 |
| Compilación de la PWA                                        | Correcto con Vite 8.3.1                                                                                                  |
| Suite de pruebas de Node/Worker/web                          | 1.018 correctas tras la adaptación de HLTB                                                                               |
| Lint                                                         | Sin errores ni avisos                                                                                                    |
| Suite completa de Electron                                   | 86 pruebas correctas en la última pasada completa (5,5 min, sin reintentos automáticos)                                  |
| Compatibilidad Electron 39 → 44                              | Base sintética conservada, integridad correcta y credencial ficticia anterior descifrada; SDL y libSQL cargan            |
| Sincronización real                                          | `push` y `pull` correctos con Electron 44 sobre `afterplay-test-…`; integridad correcta y cero filas de prueba restantes |
| Paquete Windows x64                                          | Compilado y abierto con perfil desechable; SDL, cifrado y una mutación local correctos                                   |
| Contenido de `app.asar`                                      | Solo contenido de ejecución; ningún archivo `.env` o `.dev.vars` propio                                                  |
| Wrangler 4.138.0                                             | `deploy --dry-run` correcto, sin subida; bundle 431,52 KiB / 93,71 KiB gzip                                              |
| Auditoría npm                                                | Raíz: de 44 avisos (15 altos) a 0; web: 0; Worker: 0                                                                     |

En la primera pasada completa de Electron hubo tres fallos de HLTB, corregidos y vueltos a comprobar contra el servicio real; un fallo en la propia prueba nativa por un `import()` no admitido en la evaluación de Playwright, también corregido; y dos fallos de temporización del Journey. Los dos casos de Journey pasaron aislados con las versiones nuevas y los cinco casos pasaron en una copia del commit original con sus dependencias y Electron 39. No se cambiaron las tolerancias ni la lógica de navegación a partir de un fallo que no se pudo reproducir de forma estable. La última ejecución completa terminó con las 86 pruebas correctas, incluidos ambos casos de Journey.

`npm ls` del Worker muestra tres auxiliares opcionales de Sharp/WASM como `extraneous` en Windows (`@img/sharp-wasm32`, `@emnapi/runtime`, `tslib`). Están registrados como opcionales en el lockfile y aparecen también después de `npm ci` y `npm prune`; no impiden el typecheck, la auditoría ni el ensayo de Wrangler.

El artefacto local está en `dist/win-unpacked/`. No se instaló en el perfil habitual, no se creó una release y no se desplegó el Worker. Las pruebas de datos y UI usaron perfiles temporales; la prueba conectada se limitó a la base identificada expresamente como testing. La carga de SDL se comprobó, pero no se verificó una pulsación física de mando. La validación del ejecutable fue en Windows x64.

Fuentes de compatibilidad consultadas:

- [TypeScript 7 y convivencia con la API 6](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- [Cambios incompatibles de Electron](https://www.electronjs.org/docs/latest/breaking-changes).
- [Metadatos de electron-vite 5.0.0](https://registry.npmjs.org/electron-vite/5.0.0) y [eslint-plugin-react 7.37.5](https://registry.npmjs.org/eslint-plugin-react/7.37.5).
- [Cambios de Dotenv 18](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md).
- [Instalación y precompilados de SDL](https://github.com/kmamal/node-sdl#installation).
- La política `files` se contrastó también con los tipos y comentarios del electron-builder 26.15.3 instalado; la ausencia de archivos privados se verificó sobre el `app.asar` generado.
