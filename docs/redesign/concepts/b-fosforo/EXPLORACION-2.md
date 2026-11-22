# Fósforo: segunda ronda de exploración (normas comunes)

El usuario ha elegido la dirección B "Fósforo". Ahora hay que cubrir con ella TODO lo visual de la app,
pantalla a pantalla y estado a estado, antes de implementar. Lee primero:
- `README.md` (paleta, tipografía, estructura) y mira los PNG de esta carpeta (home, library, detail,
  sessions, plan, settings, tv, pwa): son la referencia de estilo, y tu trabajo tiene que parecer de la misma mano.
- `../BRIEF-COMUN.md` (datos de ejemplo y reglas de diseño).
- `build.mjs` exporta sus piezas: `G` (catálogo de portadas), `ST`/`STN` (estados), `cv(k)` portada,
  `bn(k)` banner, `dot`, `chip`, `ic`/`icf` iconos, `doc(title, body)`, `shell(title, activeTab, inner)`
  (ventana con barra superior y "Now playing" abajo), `hm`, `FONTS`, `np`, `logoSvg`.
  Impórtalas con `import { ... } from './build.mjs'` (no ejecuta su build al importarse).

## Cómo trabajar
- La app es SOLO modo oscuro.
- NO modifiques `build.mjs`, `styles.css`, `render.mjs`, `README.md` ni los PNG/HTML existentes: hay otras
  personas trabajando en esta carpeta a la vez. Si te falta un juego en `G`, defínelo en tu propio fichero.
- Crea solo ficheros con tu prefijo (te lo da tu encargo), por ejemplo para el prefijo `x`:
  - `build-x.mjs` genera tus HTML;
  - `x.css` lleva tus estilos y se carga DESPUÉS de `styles.css` (añade el `<link>` al HTML que generes;
    `doc()` mete `styles.css`; puedes envolver o insertar tu `<link>` en el body);
  - `render-x.mjs` es copia de `render.mjs` con tu lista de capturas y SIN ejecutar `build.mjs`
    (ejecuta el tuyo);
  - `x-<pantalla>.html/.png`;
  - `README-x.md`.
- Escritorio a 1600×1000; TV a 1920×1080; tableros de móvil a 1920×1100 con 4 teléfonos como en `pwa.png`.
  Modales y avisos se muestran sobre la pantalla que les corresponde, atenuada.
- Para saber QUÉ contiene cada pantalla, lee el código actual que te indique tu encargo, y lee
  `docs/AFTERPLAY-2.0.md` §15.7 (lo que la 2.0 añade: dispositivos, sync, instalaciones). Hay que respetar
  todo lo que la pantalla muestra y hace hoy (no quitar funciones), pero con libertad total de estructura.
- Calidad: rejilla y alineación, jerarquía clara, cifras en Big Shoulders, UI en Barlow, ámbar solo donde
  importa, texto mínimo 12px, contraste AA, nada truncado que sea informativo, sin eyebrows en mayúsculas.
- Mira TÚ cada PNG con Read y corrige antes de terminar.
- `README-x.md` en español: por pantalla, qué muestra, cómo se estructura y las decisiones visuales y de
  interacción (hover, foco, animación) que haya que respetar al implementar.
- Nada de git, no abras %APPDATA%, no instales paquetes.
- Termina con un informe corto: ficheros y dudas.
