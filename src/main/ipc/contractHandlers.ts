import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { contract, type Contract } from '../../shared/ipc/contract';
import type {
  ArgsOut,
  ArgsSchema,
  EventArgs,
  EventChannelOf,
  InvokeChannelOf,
  ResultOf,
  SendChannelOf,
} from '../../shared/ipc/define';

// EL LADO DEL MAIN DEL CONTRATO IPC (AFTERPLAY-2.0.md §15.3).
//
// `handle`, `on` y `emit` son las únicas puertas de `ipcMain` y de
// `webContents.send` de todo el main. Cada una toma el canal del contrato, así
// que el manejador recibe los argumentos con el tipo que el contrato dice, y
// la entrada se VALIDA en el borde, antes de que el cuerpo del manejador
// la vea: un renderer con un bug (o un contenido que no debería estar ahí) no
// llega a una consulta con un id que no es texto o un parche con claves que no
// existen.

type InvokeChannel = InvokeChannelOf<Contract>;
type SendChannel = SendChannelOf<Contract>;
type EventChannel = EventChannelOf<Contract>;

/** La entrada de un canal no cumple su esquema. Nombra el canal y el campo. */
export class IpcValidationError extends Error {
  constructor(
    readonly channel: string,
    detail: string,
  ) {
    super(`IPC "${channel}": invalid arguments (${detail})`);
    this.name = 'IpcValidationError';
  }
}

/**
 * Valida los argumentos de una llamada contra el esquema de su canal y
 * devuelve los ya limpios. Lanza `IpcValidationError` si no cuadran.
 */
export const parseIpcArgs = (
  channel: InvokeChannel | SendChannel,
  args: readonly unknown[],
): unknown[] => {
  const schema: ArgsSchema = contract[channel].input;
  const result = schema.safeParse(args);
  if (result.success) return result.data as unknown[];
  const detail = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `argument ${issue.path.join('.')}` : 'arguments';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  throw new IpcValidationError(channel, detail);
};

/**
 * Un `ipcRenderer.invoke` con su respuesta. Si la entrada no cumple el
 * contrato, el `invoke` del renderer se rechaza con un error que nombra el
 * canal y el manejador no llega a ejecutarse.
 */
export const handle = <C extends InvokeChannel>(
  channel: C,
  fn: (
    event: IpcMainInvokeEvent,
    ...args: ArgsOut<Contract[C]>
  ) => ResultOf<Contract[C]> | Promise<ResultOf<Contract[C]>>,
): void => {
  ipcMain.handle(channel, (event, ...rawArgs: unknown[]) => {
    const args = parseIpcArgs(channel, rawArgs) as ArgsOut<Contract[C]>;
    return fn(event, ...args);
  });
};

/**
 * Un `ipcRenderer.send`, sin respuesta. Quien manda no espera nada, así que
 * una entrada que no cumple el contrato se registra y se ignora.
 */
export const on = <C extends SendChannel>(
  channel: C,
  fn: (event: IpcMainEvent, ...args: ArgsOut<Contract[C]>) => void,
): void => {
  ipcMain.on(channel, (event, ...rawArgs: unknown[]) => {
    let args: ArgsOut<Contract[C]>;
    try {
      args = parseIpcArgs(channel, rawArgs) as ArgsOut<Contract[C]>;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return;
    }
    fn(event, ...args);
  });
};

/** Lo único que `emit` necesita de un destino: `webContents` o `event.sender`. */
export type EmitTarget = Pick<WebContents, 'send'>;

/** Un aviso del main al renderer, con la carga que el contrato dice. */
export const emit = <C extends EventChannel>(
  target: EmitTarget,
  channel: C,
  ...args: EventArgs<Contract[C]>
): void => {
  target.send(channel, ...args);
};
