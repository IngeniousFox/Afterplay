import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { contract } from '../../../shared/ipc/contract';

// LA BARRERA DEL CONTRATO IPC (AFTERPLAY-2.0.md §15.3, exit de la fase 7:
// "todo el IPC pasa por el contrato").
//
// Lee el TEXTO de src/main y src/preload —no importa nada de ellos— y falla si:
//   · alguien vuelve a hablar con `ipcMain`, `ipcRenderer` o `webContents.send`
//     fuera de los dos ficheros que implementan el contrato;
//   · un canal usado en el código no existe en el contrato, o existe pero de
//     otra clase (un `invoke` que en el contrato es un evento…);
//   · una entrada del contrato queda huérfana: sin manejador en el main, sin
//     llamada en el preload, o un evento que nadie emite o nadie escucha.

const SRC = resolve(import.meta.dirname, '../../..');

// Los únicos ficheros que pueden tocar la API cruda de Electron.
const HELPERS = new Set(['main/ipc/contractHandlers.ts', 'preload/ipc.ts']);

const listSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

type Source = { file: string; text: string };

const read = (area: 'main' | 'preload'): Source[] =>
  listSources(join(SRC, area)).map((path) => ({
    file: relative(SRC, path).replace(/\\/g, '/'),
    text: stripComments(readFileSync(path, 'utf8')),
  }));

const mainSources = read('main');
const preloadSources = read('preload');
const allSources = [...mainSources, ...preloadSources];

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /\bipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(/, what: 'ipcMain.handle/on' },
  { pattern: /\bipcRenderer\s*\.\s*(invoke|send|sendSync|on|once)\s*\(/, what: 'ipcRenderer' },
  { pattern: /\bwebContents\s*\.\s*send\s*\(/, what: 'webContents.send' },
  { pattern: /\.sender\s*\.\s*send\s*\(/, what: 'event.sender.send' },
  { pattern: /\bhandleDb\s*\(/, what: 'handleDb' },
];

describe('contrato IPC: la barrera', () => {
  it('ningún fichero fuera de los dos ayudantes habla con Electron IPC a mano', () => {
    const offenders: string[] = [];
    for (const { file, text } of allSources) {
      if (HELPERS.has(file)) continue;
      for (const { pattern, what } of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file}: ${what}`);
      }
    }
    assert.deepEqual(offenders, [], 'usa handle/on/emit (main) o invoke/send/subscribe (preload)');
  });

  it('los ayudantes sí existen donde la barrera los espera', () => {
    const files = new Set(allSources.map((source) => source.file));
    for (const helper of HELPERS) assert.ok(files.has(helper), `${helper} falta`);
  });
});

// Los canales con comillas que se pasan como primer argumento (o segundo, en
// `emit(destino, 'canal', …)`) a cada ayudante.
const channelsUsed = (sources: Source[], callee: string, argumentIndex: 0 | 1): Set<string> => {
  const found = new Set<string>();
  const leading = argumentIndex === 0 ? '' : '[^,()]+,\\s*';
  // Alcanza llamadas con genéricos o partidas en varias líneas por prettier.
  const pattern = new RegExp(`(?<![\\w.])${callee}\\s*(?:<[^>]*>)?\\(\\s*${leading}'([^']+)'`, 'g');
  for (const { file, text } of sources) {
    if (HELPERS.has(file)) continue;
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return found;
};

const channelsOfKind = (kind: 'invoke' | 'send' | 'event'): string[] =>
  Object.entries(contract)
    .filter(([, entry]) => entry.kind === kind)
    .map(([channel]) => channel);

const union = (...sets: Set<string>[]): Set<string> => new Set(sets.flatMap((set) => [...set]));

describe('contrato IPC: cada canal usado existe, y con su clase', () => {
  const usedHandle = channelsUsed(mainSources, 'handle', 0);
  const usedOn = channelsUsed(mainSources, 'on', 0);
  const usedEmit = union(
    channelsUsed(mainSources, 'emit', 1),
    channelsUsed(mainSources, 'forwardToWindow', 0),
    channelsUsed(mainSources, 'forwardToWindowAndOverlay', 0),
    channelsUsed(mainSources, 'sendToOverlay', 0),
  );
  const usedInvoke = channelsUsed(preloadSources, 'invoke', 0);
  const usedSend = channelsUsed(preloadSources, 'send', 0);
  const usedSubscribe = channelsUsed(preloadSources, 'subscribe', 0);

  const unknownOrWrongKind = (used: Set<string>, kind: string): string[] =>
    [...used]
      .filter((channel) => (contract as Record<string, { kind: string }>)[channel]?.kind !== kind)
      .sort();

  it('el main solo registra y emite canales de su clase', () => {
    assert.deepEqual(unknownOrWrongKind(usedHandle, 'invoke'), []);
    assert.deepEqual(unknownOrWrongKind(usedOn, 'send'), []);
    assert.deepEqual(unknownOrWrongKind(usedEmit, 'event'), []);
  });

  it('el preload solo llama y escucha canales de su clase', () => {
    assert.deepEqual(unknownOrWrongKind(usedInvoke, 'invoke'), []);
    assert.deepEqual(unknownOrWrongKind(usedSend, 'send'), []);
    assert.deepEqual(unknownOrWrongKind(usedSubscribe, 'event'), []);
  });

  const missing = (expected: string[], used: Set<string>): string[] =>
    expected.filter((channel) => !used.has(channel)).sort();

  it('ninguna entrada del contrato queda huérfana', () => {
    assert.deepEqual(
      missing(channelsOfKind('invoke'), usedHandle),
      [],
      'invoke sin handle() en el main',
    );
    assert.deepEqual(
      missing(channelsOfKind('invoke'), usedInvoke),
      [],
      'invoke sin llamada en el preload',
    );
    assert.deepEqual(missing(channelsOfKind('send'), usedOn), [], 'send sin on() en el main');
    assert.deepEqual(
      missing(channelsOfKind('send'), usedSend),
      [],
      'send sin llamada en el preload',
    );
    assert.deepEqual(missing(channelsOfKind('event'), usedEmit), [], 'evento que el main no emite');
    assert.deepEqual(
      missing(channelsOfKind('event'), usedSubscribe),
      [],
      'evento que el preload no escucha',
    );
  });
});
