// La lectura del mando (BIG-PICTURE.md §7.1). Web Gamepad API a pelo, sin
// librerías: Chromium expone los mandos con mapping "standard" — Xbox
// garantizado, y DualShock/DualSense/Switch Pro casi siempre también, así
// que vienen gratis. Un pad sin mapping estándar se ignora (v1) y se deja
// constancia en consola.
//
// TODOS los mandos conectados valen a la vez, cada uno con su propio estado
// de flancos y repetición: dos personas en el sofá manejan la misma sesión,
// y con dos mandos en la mesa se coge el que caiga más cerca. Mandan por
// turnos, no por hueco: la leyenda del pie habla el idioma del que pulsó
// ÚLTIMO (✕/○ si fue el DualShock, A/B si fue el Xbox).
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

import { padBrandFromId, setTvInputDevice, setTvPadBrand } from './inputDevice';

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

// Uno por id, no uno y ya: con varios mandos conectados, avisar solo del
// primero raro escondía a los demás.
const warnedIds = new Set<string>();

// TODOS los mandos válidos, no el primero que aparezca. Dos personas en el
// sofá con un mando cada una manejan la misma sesión, y una sola persona con
// dos mandos encima de la mesa puede coger cualquiera sin que la app se
// quede casada con el que estaba en el hueco 0.
const standardPads = (): Gamepad[] => {
  const pads: Gamepad[] = [];
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue;
    if (pad.mapping === 'standard') {
      pads.push(pad);
      continue;
    }
    if (!warnedIds.has(pad.id)) {
      warnedIds.add(pad.id);
      console.warn(
        `[tv] mando "${pad.id}" sin mapping estándar — ignorado en v1 (BIG-PICTURE.md §7.1)`,
      );
    }
  }
  return pads;
};

// El estado de flancos y repetición es POR MANDO: si fuera compartido, dos
// mandos se pisarían el "ya estaba pulsado" y el reloj de la repetición —
// mantener una dirección en uno cancelaría la del otro.
type PadState = {
  pressed: Set<number>;
  held: { dir: TvDirection; nextAt: number } | null;
  stickEngaged: TvDirection | null;
};

// Arranca el bucle y devuelve la función que lo para — contrato de cleanup
// de useEffect, como todos los onX del preload.
export const startGamepadLoop = (onAction: (action: TvInputAction) => void): (() => void) => {
  // Un estado por mando conectado, con la clave que da la propia API
  // (pad.index). Se crea al ver el mando por primera vez y se tira cuando
  // desaparece — ver el barrido del final del bucle.
  const states = new Map<number, PadState>();
  // El id del mando que habló ÚLTIMO. La leyenda del pie es de quien acaba
  // de pulsar: si dejas el Xbox y coges el DualShock, la siguiente pulsación
  // cambia A/B por ✕/○ sola. Guardado para no reanalizar el id en cada
  // pulsación — solo cuando cambia de manos.
  let lastSpokenId: string | null = null;
  let raf = 0;

  const deliver = (pad: Gamepad, action: TvInputAction): void => {
    bumpActivity();
    // La leyenda del pie cambia a glifos de mando en cuanto el mando habla.
    setTvInputDevice('gamepad');
    if (pad.id !== lastSpokenId) {
      lastSpokenId = pad.id;
      setTvPadBrand(padBrandFromId(pad.id));
    }
    // Despertar el salvapantallas consume la pulsación entera.
    if (isAmbientShowing()) return;
    onAction(action);
  };

  const pressDirection = (pad: Gamepad, state: PadState, dir: TvDirection, now: number): void => {
    state.held = { dir, nextAt: now + REPEAT_FIRST_MS };
    deliver(pad, { type: 'move', dir });
  };

  // La lectura de UN mando con SU estado — el mismo cuerpo de siempre, ahora
  // parametrizado para poder repetirlo por cada mando conectado.
  const readPad = (pad: Gamepad, state: PadState, now: number): void => {
    // Botones por flanco de bajada.
    for (const [index, button] of BUTTONS) {
      const isDown = pad.buttons[index]?.pressed ?? false;
      const wasDown = state.pressed.has(index);
      if (isDown && !wasDown) {
        state.pressed.add(index);
        deliver(pad, { type: 'button', button });
      } else if (!isDown && wasDown) {
        state.pressed.delete(index);
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
      const threshold = state.stickEngaged ? STICK_RELEASE : STICK_PRESS;
      if (magnitudeX >= threshold || magnitudeY >= threshold) {
        let candidate: TvDirection =
          magnitudeX >= magnitudeY ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
        // CAMBIAR de dirección con el stick sujeto exige más que un empate:
        // cerca de los 45º el ruido del sensor alterna qué eje "gana" frame
        // a frame, y sin este margen salían moves en zigzag a ritmo de rAF
        // (cada cambio resetea la repetición). Robar el eje pide umbral de
        // ENTRADA y un 30% de ventaja sobre el eje que venía mandando.
        if (state.stickEngaged !== null && candidate !== state.stickEngaged) {
          const horizontalHeld = state.stickEngaged === 'left' || state.stickEngaged === 'right';
          const heldMagnitude = horizontalHeld ? magnitudeX : magnitudeY;
          const newMagnitude = horizontalHeld ? magnitudeY : magnitudeX;
          const sameAxis =
            (horizontalHeld && (candidate === 'left' || candidate === 'right')) ||
            (!horizontalHeld && (candidate === 'up' || candidate === 'down'));
          if (!sameAxis && (newMagnitude < STICK_PRESS || newMagnitude < heldMagnitude * 1.3)) {
            candidate = state.stickEngaged;
          }
        }
        dir = candidate;
      }
      state.stickEngaged = dir;
    } else {
      state.stickEngaged = null;
    }

    if (dir === null) {
      state.held = null;
    } else if (state.held === null || state.held.dir !== dir) {
      pressDirection(pad, state, dir, now);
    } else if (now >= state.held.nextAt) {
      state.held.nextAt = now + REPEAT_NEXT_MS;
      deliver(pad, { type: 'move', dir, repeat: true });
    }
  };

  const loop = (): void => {
    const now = performance.now();
    const pads = standardPads();
    const live = new Set<number>();

    for (const pad of pads) {
      live.add(pad.index);
      let state = states.get(pad.index);
      if (!state) {
        state = { pressed: new Set(), held: null, stickEngaged: null };
        states.set(pad.index, state);
      }
      readPad(pad, state, now);
    }

    // Los que ya no están: fuera su estado. Un mando que se queda sin
    // batería con una dirección sujeta no puede dejar su repetición viva —
    // y al volver a conectarse empieza limpio, sin flancos fantasma.
    for (const index of [...states.keys()]) {
      if (!live.has(index)) states.delete(index);
    }

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
};
