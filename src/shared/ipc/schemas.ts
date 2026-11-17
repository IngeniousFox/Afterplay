import { z } from 'zod';
import type { DatePrecision, EventDatePrecision, StateEventDatePrecision } from '../dateTypes';
import type {
  AddSpendEventInput,
  AddStateEventInput,
  CreateEmulatorInput,
  CreateGameWithDetailsInput,
  CreateIterationInput,
  CreatePlannedGameInput,
  CredentialsValues,
  GameSource,
  GetSgdbImagesInput,
  PromotePlannedGameInput,
  UpdateGamePatch,
  UpdateIterationPatch,
  UpdateSpendEventPatch,
  UpdateStateEventPatch,
} from '../types';
import type { MergePlaythroughsRequest } from '../playthroughMerge';
import type { PairRequest } from '../sync/status';
import type { CutoverAction } from '../cutover';
import type { DuplicateResolution, RestoreRequestInput } from '../../main/saves/contracts';

// LOS ESQUEMAS DE ENTRADA DEL CONTRATO IPC (AFTERPLAY-2.0.md §15.3).
//
// Cada esquema compuesto lleva su tipo de `shared` pegado con
// `z.ZodType<T, T>`: si el tipo gana o pierde un campo y el esquema no, no
// compila. El tipo sigue siendo la fuente de la verdad que ve el renderer; el
// esquema es lo que el main EJECUTA en el borde.
//
// Los objetos son los de zod por defecto: las claves que no se conocen se
// quitan al validar. La excepción es `games:update`, cuya lista cerrada rechaza
// una clave de más (el handler ya lo hacía con steamAppId) en vez de tragársela.

// Los ids de las entidades son texto (entityIds.ts): UUID o compuestos. Aquí
// solo se exige que haya algo; la forma exacta la comprueba la consulta, que
// es quien sabe a qué tabla apunta.
export const entityId = z.string().min(1);

// ── Fechas y precisiones ────────────────────────────────────────────────────

const datePrecision = z.enum(['year', 'month', 'day']) satisfies z.ZodType<DatePrecision>;
const eventDatePrecision = z.enum([
  'year',
  'month',
  'day',
  'datetime',
]) satisfies z.ZodType<EventDatePrecision>;
const stateEventDatePrecision = z.enum([
  'year',
  'month',
  'day',
  'datetime',
  'unknown',
]) satisfies z.ZodType<StateEventDatePrecision>;

const dateWithPrecision = z.object({ date: z.date(), precision: datePrecision });

const stateEventType = z.enum([
  'started',
  'completed',
  'dropped',
  'on_hold',
  'resting',
  'plan_to_play',
]);
// Lo que se puede ESCRIBIR: el paso por el Plan es `plan_entries`, no un evento.
const writableStateEventType = z.enum(['started', 'completed', 'dropped', 'on_hold', 'resting']);

// ── Juegos ──────────────────────────────────────────────────────────────────

export const gameSource: z.ZodType<GameSource, GameSource> = z.union([
  z.object({ igdbId: z.number() }),
  z.object({ steamAppId: z.number() }),
]);

const gameDetailsFields = {
  endless: z.boolean(),
  isEmulated: z.boolean(),
  iteration: z.object({
    playedPlatform: z.string(),
    origin: z.string(),
    format: z.enum(['digital', 'physical']),
  }),
  hoursPlayed: z.number().nullable(),
  started: dateWithPrecision.nullable(),
  finished: dateWithPrecision.nullable(),
  initialStatus: stateEventType.nullable(),
  note: z.string().nullable(),
  gameNotes: z.string().nullable(),
  moneySpent: z.number().nullable(),
  moneySpentDate: dateWithPrecision.nullable(),
  executablePath: z.string().nullable(),
  coverUrl: z.string().nullable(),
  heroUrl: z.string().nullable(),
  steamGridDbId: z.number().nullable(),
  steamAppIdOverride: z.number().nullable().optional(),
  installDirectory: z.string().nullable(),
  installSizeBytes: z.number().nullable(),
};

export const createGameWithDetailsInput: z.ZodType<
  CreateGameWithDetailsInput,
  CreateGameWithDetailsInput
> = z.object({ source: gameSource, ...gameDetailsFields });

export const createPlannedGameInput: z.ZodType<CreatePlannedGameInput, CreatePlannedGameInput> =
  z.object({
    source: gameSource,
    note: z.string().nullable(),
    gameNotes: z.string().nullable(),
    coverUrl: z.string().nullable(),
    heroUrl: z.string().nullable(),
    steamGridDbId: z.number().nullable(),
  });

export const promotePlannedGameInput: z.ZodType<PromotePlannedGameInput, PromotePlannedGameInput> =
  z.object({ gameId: entityId, ...gameDetailsFields });

// La lista cerrada de campos editables de un juego (F-42). Fuera a propósito:
// steamAppId/steamAppIdManual (su editor es games:setSteamAppId) y todo lo que
// rellenan las pasadas externas.
export const updateGamePatch: z.ZodType<UpdateGamePatch, UpdateGamePatch> = z.strictObject({
  title: z.string().optional(),
  coverUrl: z.string().nullable().optional(),
  heroUrl: z.string().nullable().optional(),
  steamGridDbId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  executablePath: z.string().nullable().optional(),
  installDirectory: z.string().nullable().optional(),
  installSizeBytes: z.number().nullable().optional(),
  endless: z.boolean().optional(),
  isEmulated: z.boolean().optional(),
});

// ── Playthroughs, estados y gasto ───────────────────────────────────────────

const iterationFormat = z.enum(['digital', 'physical']);

export const createIterationInput: z.ZodType<CreateIterationInput, CreateIterationInput> = z.object(
  {
    gameId: entityId,
    label: z.string().nullable().optional(),
    playedPlatform: z.string(),
    origin: z.string(),
    format: iterationFormat.nullable().optional(),
    manualTotalPlayed: z.number().nullable().optional(),
  },
);

export const updateIterationPatch: z.ZodType<UpdateIterationPatch, UpdateIterationPatch> = z.object(
  {
    label: z.string().optional(),
    playedPlatform: z.string().optional(),
    origin: z.string().optional(),
    format: iterationFormat.nullable().optional(),
    manualTotalPlayed: z.number().nullable().optional(),
    extraContent: z.boolean().optional(),
    rating: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .nullable()
      .optional(),
  },
);

export const mergePlaythroughsRequest: z.ZodType<
  MergePlaythroughsRequest,
  MergePlaythroughsRequest
> = z.object({ keepId: entityId, dropId: entityId });

export const addStateEventInput: z.ZodType<AddStateEventInput, AddStateEventInput> = z.object({
  iterationId: entityId,
  type: writableStateEventType,
  occurredAt: z.date().optional(),
  datePrecision: stateEventDatePrecision,
  note: z.string().nullable().optional(),
});

export const updateStateEventPatch: z.ZodType<UpdateStateEventPatch, UpdateStateEventPatch> =
  z.object({
    type: writableStateEventType.optional(),
    occurredAt: z.date().optional(),
    datePrecision: stateEventDatePrecision.optional(),
    note: z.string().nullable().optional(),
  });

export const addSpendEventInput: z.ZodType<AddSpendEventInput, AddSpendEventInput> = z.object({
  gameId: entityId,
  type: z.enum(['purchase', 'ingame_spend']),
  amount: z.number(),
  occurredAt: z.date().optional(),
  datePrecision: eventDatePrecision,
  note: z.string().nullable().optional(),
  playthroughId: entityId.nullable().optional(),
});

export const updateSpendEventPatch: z.ZodType<UpdateSpendEventPatch, UpdateSpendEventPatch> =
  z.object({
    amount: z.number().optional(),
    occurredAt: z.date().optional(),
    datePrecision: eventDatePrecision.optional(),
    note: z.string().nullable().optional(),
  });

// ── Emuladores, imágenes, partidas, ajustes, sync ───────────────────────────

export const createEmulatorInput: z.ZodType<CreateEmulatorInput, CreateEmulatorInput> = z.object({
  name: z.string(),
  executablePath: z.string(),
});

export const getSgdbImagesInput: z.ZodType<GetSgdbImagesInput, GetSgdbImagesInput> = z.union([
  z.object({ title: z.string(), releaseYear: z.number().nullable() }),
  z.object({ sgdbId: z.number() }),
]);

// Las lecturas acotadas de sesiones (F-41): un rango de inicio y una página.
export const sessionsRangeInput = z.object({ from: z.date(), to: z.date() });

export const sessionsPageInput = z.object({
  gameId: entityId.nullable(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(200),
});

export const imageCacheType = z.enum(['covers', 'heroes', 'screenshots', 'achievements']);

export const restoreRequestInput: z.ZodType<RestoreRequestInput, RestoreRequestInput> = z.object({
  gameId: entityId,
  backupId: entityId,
  mode: z.enum(['in-place', 'custom-path', 'export']),
  target: z.string().optional(),
  preview: z.boolean(),
  exact: z.boolean().optional(),
});

export const duplicateResolution: z.ZodType<DuplicateResolution, DuplicateResolution> = z.enum([
  'keep-this-pc',
  'new-identity',
]);

export const timeFormat = z.enum(['12h', '24h']);
export const saveStorageProvider = z.enum(['cloudflare', 's3']);

const nullableString = z.string().nullable();
export const credentialsValues: z.ZodType<CredentialsValues, CredentialsValues> = z.object({
  twitchClientId: nullableString,
  twitchClientSecret: nullableString,
  steamGridDbApiKey: nullableString,
  databaseUrl: nullableString,
  databaseAuthToken: nullableString,
  r2AccountId: nullableString,
  r2Bucket: nullableString,
  r2AccessKeyId: nullableString,
  r2SecretAccessKey: nullableString,
  s3Endpoint: nullableString,
  s3Region: nullableString,
  s3Bucket: nullableString,
  s3AccessKeyId: nullableString,
  s3SecretAccessKey: nullableString,
  s3AddressingMode: nullableString,
  anthropicApiKey: nullableString,
  steamApiKey: nullableString,
  steamUserId64: nullableString,
  raUsername: nullableString,
  raApiKey: nullableString,
});

export const pairRequest: z.ZodType<PairRequest, PairRequest> = z.object({
  hubUrl: z.string(),
  code: z.string(),
});

// PUENTE 1.x → L3: lo que la persona contesta durante el corte (shared/cutover.ts).
export const cutoverAction: z.ZodType<CutoverAction, CutoverAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('wait') }),
  z.object({ type: z.literal('retry') }),
  z.object({
    type: z.literal('submit-pairing'),
    hubUrl: z.string().max(2048),
    code: z.string().max(256),
  }),
]);
