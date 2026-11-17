import type { CutoverAction, CutoverState } from '../../shared/cutover';
import { isE2E } from '../lib/e2e';
import { forwardToWindow } from '../windows/forward';

// PUENTE 1.x → L3: se va con el orquestador (`cutover.ts`).
//
// EL GANCHO E2E DE LA PANTALLA DE MIGRACIÓN. Un test no puede correr un corte
// real (necesita Turso y otro PC), así que este gancho deja que un test FUERCE
// el estado que la ventana ve y OBSERVE las acciones que la ventana manda, sin
// tocar el orquestador.
//
// POR QUÉ NO PUEDE DISPARARSE FUERA DE UN E2E: `createCutoverE2eHook` devuelve
// `null` salvo que `isE2E()` sea cierto (la palanca AFTERPLAY_E2E_USER_DATA,
// que se lee una vez al cargar main y solo la pone Playwright; ver
// lib/e2e.ts). Sin ella no existe ni el objeto ni su entrada en `globalThis`,
// y el IPC contesta exactamente lo de siempre. No hay canal nuevo en el
// contrato: el test habla con este objeto por `app.evaluate` (el proceso
// main), nunca desde el renderer.
//
// Mientras hay un estado forzado, las acciones NO llegan al orquestador (aquí
// no habría ninguno): se anotan en `actions` y el test las lee.

export interface CutoverE2eHook {
  /** Fuerza el estado (`null` lo suelta) y se lo cuenta a la ventana. */
  force(state: CutoverState | null): void;
  /** El estado forzado, si lo hay. */
  readonly state: CutoverState | null;
  /** Las acciones que mandó la ventana mientras había estado forzado. */
  readonly actions: CutoverAction[];
}

const KEY = '__afterplayE2ECutover';

export const createCutoverE2eHook = (current: () => CutoverState): CutoverE2eHook | null => {
  if (!isE2E()) return null;
  const send = forwardToWindow('cutover:state');
  const hook: CutoverE2eHook = {
    state: null,
    actions: [],
    force(next) {
      (hook as { state: CutoverState | null }).state = next;
      send(next ?? current());
    },
  };
  (globalThis as Record<string, unknown>)[KEY] = hook;
  return hook;
};
