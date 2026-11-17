import type {
  CutoverErrorCode,
  CutoverLaggingDevice,
  CutoverState,
  CutoverStateKind,
} from '../../../shared/cutover';
import { checkHubUrl } from '../../../shared/sync/hubUrl';

// LA PANTALLA DE MIGRACIÓN, SIN PINTAR NADA: qué texto y qué paso corresponden
// a cada estado del corte 1.x → 2.0 (shared/cutover.ts). Está aparte del
// componente para poder probar el copy con `tsx --test`, sin DOM.
//
// Los textos son para la persona: nada de "corte", "hub", "Turso" ni "CDC".
// Se habla de "tu biblioteca", "tus otros PCs" y "el servicio de sincronización".

/** Los pasos del camino normal del primer PC (D-07: sin preguntas por el medio). */
export const CUTOVER_STEPS = [
  { id: 'check', label: 'Check your PCs' },
  { id: 'copy', label: 'Copy your library' },
  { id: 'connect', label: 'Connect sync' },
  { id: 'upload', label: 'Upload' },
  { id: 'finish', label: 'Finish' },
] as const;

export type CutoverStepId = (typeof CUTOVER_STEPS)[number]['id'];

// Paso resaltado por estado; los que no están (esperar, bajar, error...) no son
// parte del camino del primer PC y no enseñan la lista de pasos.
const STEP_OF_KIND: Partial<Record<CutoverStateKind, CutoverStepId>> = {
  checking: 'check',
  'question-lagging': 'check',
  importing: 'copy',
  'needs-pairing': 'connect',
  pairing: 'connect',
  seeding: 'upload',
  finishing: 'finish',
};

export const cutoverStepIndex = (state: CutoverState): number | null => {
  const id = STEP_OF_KIND[state.kind];
  return id === undefined ? null : CUTOVER_STEPS.findIndex((step) => step.id === id);
};

export interface CutoverCopy {
  readonly title: string;
  readonly body: string;
  /** ¿Hay algo en marcha que merezca un indicador de actividad? */
  readonly busy: boolean;
}

// Errores tras los que la 1.x sigue como estaba (§19.9: la 2.0 nunca escribe en
// ella, y estos fallos ocurren antes de dar nada por terminado).
const UNTOUCHED_CODES: ReadonlySet<CutoverErrorCode> = new Set([
  'bridge-missing',
  'bridge-failed',
  'import-blocked',
  'import-failed',
]);

export const errorKeepsOldData = (code: CutoverErrorCode): boolean => UNTOUCHED_CODES.has(code);

const formatCount = (value: number): string => value.toLocaleString('en-US');

/** "1,200 of 4,800 items uploaded", o `null` si aún no se conoce el total. */
export const seedingProgress = (rowsLeft: number, rowsTotal: number): string | null => {
  if (rowsTotal <= 0) return null;
  const done = Math.max(0, rowsTotal - rowsLeft);
  return `${formatCount(done)} of ${formatCount(rowsTotal)} items uploaded`;
};

/** 0..1, o `null` si no hay total (barra indeterminada). */
export const seedingFraction = (rowsLeft: number, rowsTotal: number): number | null => {
  if (rowsTotal <= 0) return null;
  return Math.min(1, Math.max(0, (rowsTotal - rowsLeft) / rowsTotal));
};

export const pullingProgress = (rowsLocal: number): string | null =>
  rowsLocal > 0 ? `${formatCount(rowsLocal)} items downloaded` : null;

export const describeCutover = (state: CutoverState): CutoverCopy => {
  switch (state.kind) {
    case 'idle':
    case 'done':
      return { title: 'Your library is ready', body: '', busy: false };
    case 'checking':
      return {
        title: 'Getting ready',
        body: 'Checking your other PCs before moving your library to Afterplay 2.',
        busy: true,
      };
    case 'question-lagging':
      return {
        title: 'Some PCs have not caught up',
        body: 'These PCs have changes that never reached the sync service. You can wait for them, or continue now.',
        busy: state.rechecking,
      };
    case 'importing':
      return state.phase === 'reading-remote'
        ? {
            title: 'Reading your library',
            body: 'Fetching the latest version of your library. This only takes a moment.',
            busy: true,
          }
        : {
            title: 'Copying your library',
            body: 'Moving your games, sessions and notes to Afterplay 2. The app may pause for a few seconds.',
            busy: true,
          };
    case 'needs-pairing':
      return {
        title: 'Connect this PC to sync',
        body:
          state.reason === 'first-pc'
            ? 'Afterplay 2 keeps your PCs in step through a sync service. In the phone app, open Add device to get a one-time code.'
            : 'The saved sign-in for the sync service is no longer valid. In the phone app, open Add device to get a new one-time code.',
        busy: false,
      };
    case 'pairing':
      return {
        title: 'Connecting',
        body: 'Linking this PC to the sync service.',
        busy: true,
      };
    case 'seeding':
      return {
        title: 'Uploading your library',
        body: 'Your library is being sent to the sync service so your other PCs and your phone can use it.',
        busy: true,
      };
    case 'finishing':
      return {
        title: 'Almost done',
        body: 'Finishing the move to Afterplay 2.',
        busy: true,
      };
    case 'waiting-other':
      return {
        title: 'Another PC is moving your library',
        body: 'This PC will continue as soon as that one finishes. You do not need to do anything.',
        busy: true,
      };
    case 'pulling':
      return {
        title: 'Downloading your library',
        body: 'Another PC already moved your library. This one is downloading it from the sync service.',
        busy: true,
      };
    case 'local-migration':
      return {
        title: 'Setting up this PC',
        body: 'Linking your game installs, save locations and backups on this PC.',
        busy: true,
      };
    case 'error':
      return { title: 'Something went wrong', body: state.message, busy: false };
  }
};

const pluralChanges = (count: number): string =>
  count === 1 ? '1 change' : `${formatCount(count)} changes`;

/** "3 days ago", "2 hours ago"... `now` viene de fuera para poder probarlo. */
export const agoText = (timestamp: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/** La línea que dice por qué un PC aparece en la pregunta. */
export const laggingReason = (device: CutoverLaggingDevice, now: number): string => {
  if (device.self) {
    const what =
      device.pendingChanges > 0
        ? `${pluralChanges(device.pendingChanges)} never reached`
        : 'Changes never reached';
    return `${what} the sync service. Continuing discards them.`;
  }
  if (device.reason === 'pending-changes') {
    return `${pluralChanges(device.pendingChanges)} not uploaded yet.`;
  }
  return `Has not checked in since ${agoText(device.lastReportAt, now)}.`;
};

export type PairingCheck =
  | { readonly ok: true; readonly hubUrl: string; readonly code: string }
  | { readonly ok: false; readonly urlMessage: string | null };

/**
 * Validación mínima del formulario (la de verdad la hace el main): dirección
 * con la misma regla que Ajustes (https, salvo localhost) y un código no vacío.
 * Los campos vacíos no dan mensaje: solo deshabilitan el botón.
 */
export const checkPairingInput = (hubUrl: string, code: string): PairingCheck => {
  const url = hubUrl.trim() === '' ? null : checkHubUrl(hubUrl);
  const trimmedCode = code.trim();
  if (url?.ok === true && trimmedCode !== '') {
    return { ok: true, hubUrl: url.url, code: trimmedCode };
  }
  return {
    ok: false,
    urlMessage: url !== null && !url.ok ? url.message : null,
  };
};
