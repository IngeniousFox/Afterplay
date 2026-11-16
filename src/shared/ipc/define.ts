import type { z } from 'zod';

// LAS PIEZAS CON LAS QUE SE ESCRIBE EL CONTRATO IPC (AFTERPLAY-2.0.md §15.3).
//
// Tres clases de canal, y solo tres:
//   · invoke: del renderer al main con respuesta (`ipcRenderer.invoke`).
//   · send:   del renderer al main sin respuesta (`ipcRenderer.send`).
//   · event:  del main al renderer, un aviso (`webContents.send`).
//
// La ENTRADA de un canal es un esquema de zod de verdad: el main lo ejecuta en
// el borde y rechaza lo que no cuadra. La SALIDA de un invoke y la carga de un
// evento son solo TIPOS: el main es de confianza y validar lo que él mismo
// produce costaría cada vez sin proteger de nada. Por eso se declaran con
// `type<T>()`, un marcador fantasma que no existe en ejecución.
//
// Este fichero solo tiene tipos y tres constructores triviales: lo importa el
// preload (que corre en un sandbox sin `require` de módulos) solo como TIPO,
// así que zod no entra nunca en su bundle.

/** Marcador de tipo: lleva `T` en el sistema de tipos y nada en ejecución. */
export type TypeMarker<T> = { readonly __phantom?: () => T };

export const type = <T>(): TypeMarker<T> => ({});

/** Los argumentos de una llamada, en el mismo orden que `window.api`. */
export type ArgsSchema = z.ZodTuple<readonly z.ZodType[], null>;

export type InvokeEntry = {
  readonly kind: 'invoke';
  readonly input: ArgsSchema;
  readonly output: TypeMarker<unknown>;
};

export type SendEntry = {
  readonly kind: 'send';
  readonly input: ArgsSchema;
};

export type EventEntry = {
  readonly kind: 'event';
  readonly payload: TypeMarker<unknown>;
};

export type ContractEntry = InvokeEntry | SendEntry | EventEntry;

export const invoke = <const I extends ArgsSchema, O>(
  input: I,
  output: TypeMarker<O>,
): { readonly kind: 'invoke'; readonly input: I; readonly output: TypeMarker<O> } => ({
  kind: 'invoke',
  input,
  output,
});

export const send = <const I extends ArgsSchema>(
  input: I,
): { readonly kind: 'send'; readonly input: I } => ({ kind: 'send', input });

export const event = <P>(
  payload: TypeMarker<P>,
): { readonly kind: 'event'; readonly payload: TypeMarker<P> } => ({ kind: 'event', payload });

// ── Tipos derivados de un contrato ──────────────────────────────────────────

type ContractLike = Readonly<Record<string, ContractEntry>>;

type ChannelsOfKind<C extends ContractLike, K extends ContractEntry['kind']> = {
  [Name in keyof C & string]: C[Name]['kind'] extends K ? Name : never;
}[keyof C & string];

export type InvokeChannelOf<C extends ContractLike> = ChannelsOfKind<C, 'invoke'>;
export type SendChannelOf<C extends ContractLike> = ChannelsOfKind<C, 'send'>;
export type EventChannelOf<C extends ContractLike> = ChannelsOfKind<C, 'event'>;

/** Lo que manda quien llama (antes de validar). */
export type ArgsIn<E> = E extends { readonly input: infer I extends z.ZodType }
  ? z.input<I> extends infer A extends readonly unknown[]
    ? A
    : never
  : never;

/** Lo que recibe el manejador (ya validado). */
export type ArgsOut<E> = E extends { readonly input: infer I extends z.ZodType }
  ? z.output<I> extends infer A extends readonly unknown[]
    ? A
    : never
  : never;

export type ResultOf<E> = E extends { readonly output: TypeMarker<infer T> } ? T : never;
export type PayloadOf<E> = E extends { readonly payload: TypeMarker<infer T> } ? T : never;

/**
 * Los argumentos de `webContents.send` para un evento: ninguno si su carga es
 * `void`, y la carga si no.
 */
export type EventArgs<E> = [PayloadOf<E>] extends [void] ? [] : [payload: PayloadOf<E>];
