import { invoke, send, subscribe } from '../ipc';
import type { CutoverAction, CutoverState } from '../../shared/cutover';

// PUENTE 1.x → L3. El corte 1.x → 2.0 (estados y acciones: shared/cutover.ts).
export const cutoverApi = {
  getState: (): Promise<CutoverState> => invoke('cutover:getState'),
  act: (action: CutoverAction): void => send('cutover:action', action),
  onState: (callback: (state: CutoverState) => void): (() => void) =>
    subscribe('cutover:state', callback),
};
