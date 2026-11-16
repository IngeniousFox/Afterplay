import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Contract } from '../shared/ipc/contract';
import type {
  ArgsIn,
  EventArgs,
  EventChannelOf,
  InvokeChannelOf,
  ResultOf,
  SendChannelOf,
} from '../shared/ipc/define';

// EL LADO DEL PRELOAD DEL CONTRATO IPC (AFTERPLAY-2.0.md §15.3).
//
// Las únicas tres puertas de `ipcRenderer` de toda la app: `invoke`, `send` y
// `subscribe`. Los nombres de canal y los argumentos salen del contrato
// (shared/ipc/contract.ts), así que escribir mal un canal, mandar los
// argumentos en otro orden o escuchar algo que no es un evento no compila.
//
// El contrato se importa SOLO como tipo: el preload corre sin acceso a
// módulos de node_modules (sandbox), y la validación de la entrada la hace el
// main. Aquí no entra zod.

type InvokeChannel = InvokeChannelOf<Contract>;
type SendChannel = SendChannelOf<Contract>;
type EventChannel = EventChannelOf<Contract>;

export const invoke = <C extends InvokeChannel>(
  channel: C,
  ...args: ArgsIn<Contract[C]>
): Promise<ResultOf<Contract[C]>> => ipcRenderer.invoke(channel, ...args);

export const send = <C extends SendChannel>(channel: C, ...args: ArgsIn<Contract[C]>): void => {
  ipcRenderer.send(channel, ...args);
};

/**
 * Escucha un evento del main. Devuelve la función de limpieza que quita el
 * listener, para encajar con el cleanup de un `useEffect`.
 */
export const subscribe = <C extends EventChannel>(
  channel: C,
  callback: (...args: EventArgs<Contract[C]>) => void,
): (() => void) => {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void =>
    callback(...(args as EventArgs<Contract[C]>));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
