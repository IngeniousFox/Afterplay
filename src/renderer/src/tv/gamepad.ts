// La lectura del mando (BIG-PICTURE.md §7.1). Web Gamepad API a pelo, sin
// librerías: Chromium expone los mandos con mapping "standard" — Xbox
// garantizado, y DualShock/DualSense/Switch Pro casi siempre también, así
// que vienen gratis. Un pad sin mapping estándar se ignora (v1) y se deja
// constancia en consola.
//
// El bucle corre SOLO con el modo TV activo (lo arranca/para
// BigPictureLayout): en escritorio un mando conectado no cuesta ni un frame.
//
// Detalles que hacen que se sienta a consola y no a demo:
//   · Flancos: un botón dispara al BAJAR, no mientras se mantiene.
//   · Repetición direccional: mantener una dirección repite (400ms el
//     primer eco, 130ms los siguientes) — recorrer una parrilla larga no
//     exige ametrallar el D-pad.
//   · Stick izquierdo digitalizado con histéresis (entra a 0.35, suelta a
//     0.25): sin ella, el borde de la zona muerta tiembla y dispara doble.
//   · TODO input despierta al modo ambiente (evento 'afterplay:activity',
//     ver useIdle) — y si el ambiente estaba puesto, la pulsación se
//     CONSUME: despertar el salvapantallas no puede activar nada debajo.

import { setTvInputDevice } from './inputDevice';

export type TvDirection = 'up' | 'down' | 'left' | 'right';
export type TvButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'view' | 'start';
// repeat marca los ECOS de mantener una dirección pulsada: el motor de foco
// hace scroll instantáneo en ellos (smooth no alcanza a un repeat de 130ms
// y al soltar te arrastraba de golpe el deslizamiento acumulado).
export type TvInputAction =
  { type: 'move'; dir: TvDirection; repeat?: boolean } | { type: 'button'; button: TvButton };

// Índices del mapping estándar del W3C.
const BUTTONS: readonly [number, TvButton][] = [
  [0, 'a'],
  [1, 'b'],
  [2, 'x'],
  [3, 'y'],
  [4, 'lb'],
  [5, 'rb'],
  [6, 'lt'],
  [7, 'rt'],
  [8, 'view'],
  [9, 'start'],
];
const DPAD: readonly [number, TvDirection][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

const STICK_PRESS = 0.35;
const STICK_RELEASE = 0.25;
const REPEAT_FIRST_MS = 400;
const REPEAT_NEXT_MS = 130;

// El input que despierta al salvapantallas se traga (BIG-PICTURE.md §5.5).
const isAmbientShowing = (): boolean => document.querySelector('[data-afterplay-ambient]') !== null;

const bumpActivity = (): void => {
  window.dispatchEvent(new CustomEvent('afterplay:activity'));
};

let warnedNonStandard = false;

const pickPad = (): Gamepad | null => {
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue;
    if (pad.mapping === 'standard') return pad;
    if (!warnedNonStandard) {
      warnedNonStandard = true;
      console.warn(
        `[tv] mando "${pad.id}" sin mapping estándar — ignorado en v1 (BIG-PICTURE.md §7.1)`,
      );
    }
  }
  return null;
};

// Arranca el bucle y devuelve la función que lo para — contrato de cleanup
// de useEffect, como todos los onX del preload.
export const startGamepadLoop = (onAction: (action: TvInputAction) => void): (() => void) => {
  const pressedButtons = new Set<number>();
  // Estado de la dirección mantenida (D-pad o stick, la que sea): una sola a
  // la vez, la última que entró manda.
  let held: { dir: TvDirection; nextAt: number } | null = null;
  let stickEngaged: TvDirection | null = null;
  let raf = 0;

  const deliver = (action: TvInputAction): void => {
    bumpActivity();
    // La leyenda del pie cambia a glifos de mando en cuanto el mando habla.
    setTvInputDevice('gamepad');
    // Despertar el salvapantallas consume la pulsación entera.
    if (isAmbientShowing()) return;
    onAction(action);
  };

  const pressDirection = (dir: TvDirection, now: number): void => {
    held = { dir, nextAt: now + REPEAT_FIRST_MS };
    deliver({ type: 'move', dir });
  };

  const loop = (): void => {
    const now = performance.now();
    const pad = pickPad();

    if (pad) {
      // Botones por flanco de bajada.
      for (const [index, button] of BUTTONS) {
        const isDown = pad.buttons[index]?.pressed ?? false;
        const wasDown = pressedButtons.has(index);
        if (isDown && !wasDown) {
          pressedButtons.add(index);
          deliver({ type: 'button', button });
        } else if (!isDown && wasDown) {
          pressedButtons.delete(index);
        }
      }

      // Dirección activa este frame: D-pad primero, stick después.
      let dir: TvDirection | null = null;
      for (const [index, direction] of DPAD) {
        if (pad.buttons[index]?.pressed) {
          dir = direction;
          break;
        }
      }
      if (dir === null) {
        const x = pad.axes[0] ?? 0;
        const y = pad.axes[1] ?? 0;
        const magnitudeX = Math.abs(x);
        const magnitudeY = Math.abs(y);
        // Histéresis: para ENTRAR hace falta pasar de 0.35; para mantenerse
        // basta 0.25. El eje dominante decide la dirección.
        const threshold = stickEngaged ? STICK_RELEASE : STICK_PRESS;
        if (magnitudeX >= threshold || magnitudeY >= threshold) {
          let candidate: TvDirection =
            magnitudeX >= magnitudeY ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
          // CAMBIAR de dirección con el stick sujeto exige más que un empate:
          // cerca de los 45º el ruido del sensor alterna qué eje "gana" frame
          // a frame, y sin este margen salían moves en zigzag a ritmo de rAF
          // (cada cambio resetea la repetición). Robar el eje pide umbral de
          // ENTRADA y un 30% de ventaja sobre el eje que venía mandando.
          if (stickEngaged !== null && candidate !== stickEngaged) {
            const horizontalHeld = stickEngaged === 'left' || stickEngaged === 'right';
            const heldMagnitude = horizontalHeld ? magnitudeX : magnitudeY;
            const newMagnitude = horizontalHeld ? magnitudeY : magnitudeX;
            const sameAxis =
              (horizontalHeld && (candidate === 'left' || candidate === 'right')) ||
              (!horizontalHeld && (candidate === 'up' || candidate === 'down'));
            if (!sameAxis && (newMagnitude < STICK_PRESS || newMagnitude < heldMagnitude * 1.3)) {
              candidate = stickEngaged;
            }
          }
          dir = candidate;
        }
        stickEngaged = dir;
      } else {
        stickEngaged = null;
      }

      if (dir === null) {
        held = null;
      } else if (held === null || held.dir !== dir) {
        pressDirection(dir, now);
      } else if (now >= held.nextAt) {
        held.nextAt = now + REPEAT_NEXT_MS;
        deliver({ type: 'move', dir, repeat: true });
      }
    } else {
      pressedButtons.clear();
      held = null;
      stickEngaged = null;
    }

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
};
