import { createCutoverE2eHook } from '../migration/cutoverE2eHook';
import { dispatchCutoverAction, getCutoverState } from '../migration/cutoverRuntime';
import { handle, on } from './contractHandlers';

// PUENTE 1.x → L3. El corte 1.x → 2.0 visto desde la ventana (§19.6): el
// estado actual, las respuestas de la persona y (por `cutover:state`, que
// emite `cutoverRuntime.ts`) cada cambio. El estado está documentado en
// `shared/cutover.ts`. Sin corte en este arranque contesta `idle`.

export const registerCutoverHandlers = (): void => {
  // Solo existe en un e2e (ver cutoverE2eHook.ts); en producción es `null`.
  const e2e = createCutoverE2eHook(getCutoverState);
  handle('cutover:getState', () => e2e?.state ?? getCutoverState());
  on('cutover:action', (_event, action) => {
    if (e2e?.state) e2e.actions.push(action);
    else dispatchCutoverAction(action);
  });
};
