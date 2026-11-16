import { z } from 'zod';
import type { DeviceInfo, GameInstallInfo } from '../devices';
import type { ConcurrentPlaythrough, MergePlaythroughsOutcome } from '../playthroughMerge';
import type { SyncStatus } from '../sync/status';
import type { DataChanged } from './dataChanged';
import type {
  AchievementActivityEvent,
  AchievementsOverview,
  AchievementsStatus,
  CollectionGame,
  CredentialsImportResult,
  CredentialsValues,
  CuriositiesStatus,
  CuriosityActivityEvent,
  CuriositySummary,
  DirectoryPickResult,
  Emulator,
  ExternalDataStatus,
  ExternalRefreshEvent,
  GameAchievements,
  GameDetail,
  GameFullRefreshResult,
  GameListItem,
  GameRow,
  GeneratedMemorySummary,
  HltbTimes,
  IgdbGameDetail,
  IgdbSearchResult,
  ImageCacheUsage,
  ImageRedownloadEvent,
  Iteration,
  LaunchExecutableResult,
  MemoriesStatus,
  MemoryActivityEvent,
  OverlayShortcutStatus,
  PendingSession,
  PlannedGameExtras,
  PlannedGameListItem,
  RadarActivityEvent,
  RadarGame,
  RatingsRefreshResult,
  SaveStorageProvider,
  Session,
  SessionClosedEvent,
  SessionUnlock,
  SessionWithGame,
  SgdbImages,
  SpendEvent,
  SpendEventSummary,
  StartupKeysImport,
  StateEvent,
  StateEventSummary,
  StorageMigrationProgress,
  SteamSearchResult,
  SyncFailureInfo,
  TimeFormat,
} from '../types';
import type {
  CloudInventory,
  IdentityCheck,
  InstallIdentityStatus,
  LocalBackupsUsage,
  RecoveryResult,
  RestoreResult,
  SaveBackupsUsage,
  SavesActivityEvent,
  SavesBackupResult,
  SavesGameState,
  SavesQueuedEvent,
  SavesScanEntry,
  SavesStatus,
} from '../../main/saves/contracts';
import type { ScanReport, ScannedFolder } from '../../main/scan/contracts';
import { event, invoke, send, type } from './define';
import {
  addSpendEventInput,
  addStateEventInput,
  createEmulatorInput,
  createGameWithDetailsInput,
  createIterationInput,
  createPlannedGameInput,
  credentialsValues,
  duplicateResolution,
  entityId,
  getSgdbImagesInput,
  imageCacheType,
  mergePlaythroughsRequest,
  pairRequest,
  promotePlannedGameInput,
  restoreRequestInput,
  saveStorageProvider,
  timeFormat,
  updateGamePatch,
  updateIterationPatch,
  updateSpendEventPatch,
  updateStateEventPatch,
} from './schemas';

// EL CONTRATO IPC (AFTERPLAY-2.0.md §15.3, F-38).
//
// UN solo mapa nombre-de-canal → forma. De él salen el API del preload
// (`invoke`/`send`/`subscribe`, tipados), el registro de manejadores del main
// (`handle`/`on`/`emit`, que validan la entrada en el borde) y el test que
// impide volver a escribir una cadena de canal a mano. El orden de los
// argumentos es el de `window.api`: el renderer no sabe que esto existe.
//
// Las entradas son esquemas de zod que se ejecutan; las salidas y las cargas
// de evento son tipos (ver define.ts). Los ids son texto (entityIds.ts).
//
// Un canal nuevo se escribe AQUÍ y en ningún otro sitio: el preload y el main
// no compilan sin él, y el test de la barrera falla si queda huérfano.

const id = entityId;
const none = z.tuple([]);
const text = z.string();

export const contract = {
  // ── window / Big Picture / app ───────────────────────────────────────────
  'window:get-version': invoke(none, type<string>()),
  'window:is-visible': invoke(none, type<boolean>()),
  'window:startup-content-ready': send(none),
  'window:minimize': send(none),
  'window:maximize': send(none),
  'window:close': send(none),
  'window:maximized-change': event(type<boolean>()),
  'window:fullscreen-change': event(type<boolean>()),
  'window:visible-change': event(type<boolean>()),
  'bigpicture:get': invoke(none, type<boolean>()),
  'bigpicture:enter': send(none),
  'bigpicture:exit': send(none),
  'bigpicture:changed': event(type<boolean>()),
  'app:quit': send(none),

  // ── overlay ──────────────────────────────────────────────────────────────
  'overlay:ready': send(none),
  'overlay:dismiss': send(none),
  'overlay:getState': invoke(none, type<boolean>()),
  'overlay:state': event(type<boolean>()),

  // ── dialog ───────────────────────────────────────────────────────────────
  'dialog:pickExecutable': invoke(none, type<string | null>()),
  'dialog:pickDirectory': invoke(none, type<DirectoryPickResult | null>()),
  'dialog:pickFolder': invoke(none, type<string | null>()),
  'dialog:pickFile': invoke(none, type<string | null>()),

  // ── devices / sync ───────────────────────────────────────────────────────
  'devices:getAll': invoke(none, type<DeviceInfo[]>()),
  'sync:getStatus': invoke(none, type<SyncStatus>()),
  'sync:pair': invoke(
    z.tuple([pairRequest]),
    type<{ ok: true; status: SyncStatus } | { ok: false; message: string }>(),
  ),
  'sync:unpair': invoke(none, type<SyncStatus>()),
  'sync:syncNow': invoke(none, type<void>()),
  'sync:status': event(type<void>()),
  // El único aviso de cambio de datos (§15.4): ver shared/ipc/dataChanged.ts.
  'data:changed': event(type<DataChanged>()),

  // ── backup ───────────────────────────────────────────────────────────────
  'backup:createManual': invoke(z.tuple([text]), type<string>()),

  // ── games ────────────────────────────────────────────────────────────────
  'games:getAll': invoke(none, type<GameListItem[]>()),
  'games:getPlanned': invoke(none, type<PlannedGameListItem[]>()),
  'games:getPlannedExtras': invoke(none, type<PlannedGameExtras[]>()),
  'games:setPlanPinned': invoke(z.tuple([id, z.boolean()]), type<boolean>()),
  'games:reorderUpNext': invoke(z.tuple([z.array(id)]), type<boolean>()),
  'games:createPlanned': invoke(z.tuple([createPlannedGameInput]), type<GameRow>()),
  'games:promote': invoke(z.tuple([promotePlannedGameInput]), type<GameRow>()),
  'games:moveToPlan': invoke(z.tuple([id]), type<GameRow>()),
  'games:getById': invoke(z.tuple([id]), type<GameDetail | null>()),
  'games:createWithDetails': invoke(z.tuple([createGameWithDetailsInput]), type<GameRow>()),
  'games:update': invoke(z.tuple([id, updateGamePatch]), type<GameRow | null>()),
  'games:setSteamAppId': invoke(z.tuple([id, z.number()]), type<GameRow | null>()),
  'games:delete': invoke(z.tuple([id]), type<boolean>()),
  'games:resetEndlessState': invoke(z.tuple([id]), type<boolean>()),
  'games:launchExecutable': invoke(z.tuple([id]), type<LaunchExecutableResult>()),
  'games:openInstallDirectory': invoke(z.tuple([id]), type<LaunchExecutableResult>()),
  'games:getInstallInfo': invoke(z.tuple([id]), type<GameInstallInfo>()),

  // ── emulators ────────────────────────────────────────────────────────────
  'emulators:getAll': invoke(none, type<Emulator[]>()),
  'emulators:create': invoke(z.tuple([createEmulatorInput]), type<Emulator>()),
  'emulators:delete': invoke(z.tuple([id]), type<boolean>()),

  // ── iterations (playthroughs) ────────────────────────────────────────────
  'iterations:create': invoke(z.tuple([createIterationInput]), type<Iteration>()),
  'iterations:update': invoke(z.tuple([id, updateIterationPatch]), type<Iteration | null>()),
  'iterations:delete': invoke(z.tuple([id]), type<boolean>()),
  'iterations:concurrent': invoke(z.tuple([id]), type<ConcurrentPlaythrough[]>()),
  'iterations:merge': invoke(z.tuple([mergePlaythroughsRequest]), type<MergePlaythroughsOutcome>()),

  // ── sessions ─────────────────────────────────────────────────────────────
  'sessions:getAll': invoke(none, type<SessionWithGame[]>()),
  'sessions:close': invoke(z.tuple([id, z.date()]), type<Session | null>()),
  'sessions:delete': invoke(z.tuple([id]), type<boolean>()),
  'sessions:startForGame': invoke(z.tuple([id]), type<Session | null>()),
  'sessions:getPending': invoke(none, type<PendingSession[]>()),
  'sessions:assign': invoke(z.tuple([id, id]), type<Session | null>()),
  'sessions:deletePending': invoke(z.tuple([id]), type<boolean>()),
  'sessions:setNote': invoke(z.tuple([id, text]), type<Session | null>()),
  'sessions:closed': event(type<SessionClosedEvent>()),

  // ── stateEvents / spend ──────────────────────────────────────────────────
  'stateEvents:add': invoke(z.tuple([addStateEventInput]), type<StateEvent>()),
  'stateEvents:getAll': invoke(none, type<StateEventSummary[]>()),
  'stateEvents:update': invoke(z.tuple([id, updateStateEventPatch]), type<StateEvent | null>()),
  'stateEvents:delete': invoke(z.tuple([id]), type<boolean>()),
  'spend:add': invoke(z.tuple([addSpendEventInput]), type<SpendEvent>()),
  'spend:getAll': invoke(none, type<SpendEventSummary[]>()),
  'spend:delete': invoke(z.tuple([id]), type<boolean>()),
  'spend:update': invoke(z.tuple([id, updateSpendEventPatch]), type<SpendEvent | null>()),

  // ── igdb / hltb / sgdb / images ──────────────────────────────────────────
  'igdb:search': invoke(z.tuple([text]), type<IgdbSearchResult[]>()),
  'igdb:getById': invoke(z.tuple([z.number()]), type<IgdbGameDetail | null>()),
  'igdb:searchSteam': invoke(z.tuple([text]), type<SteamSearchResult[]>()),
  'igdb:collectionGames': invoke(z.tuple([z.array(z.number())]), type<CollectionGame[]>()),
  'hltb:getTimes': invoke(z.tuple([text, z.number().nullable()]), type<HltbTimes | null>()),
  'hltb:refreshGame': invoke(z.tuple([id]), type<HltbTimes | null>()),
  'sgdb:getImages': invoke(z.tuple([getSgdbImagesInput]), type<SgdbImages>()),
  'images:getSrc': invoke(z.tuple([text, imageCacheType]), type<string>()),
  'images:getUsage': invoke(none, type<ImageCacheUsage>()),
  'images:cleanUnused': invoke(
    none,
    type<{ files: number; bytes: number; usage: ImageCacheUsage }>(),
  ),
  'images:redownload': invoke(none, type<number>()),
  'images:activity': event(type<ImageRedownloadEvent>()),

  // ── external (datos externos de la biblioteca) ───────────────────────────
  'external:status': invoke(none, type<ExternalDataStatus>()),
  'external:refreshAll': invoke(none, type<number>()),
  'external:refreshPlan': invoke(none, type<number>()),
  'external:refreshGame': invoke(z.tuple([id]), type<GameFullRefreshResult | null>()),
  'external:refreshRatings': invoke(z.tuple([id]), type<RatingsRefreshResult | null>()),
  'external:activity': event(type<ExternalRefreshEvent>()),

  // ── saves (partidas guardadas) ───────────────────────────────────────────
  'saves:getStatus': invoke(none, type<SavesStatus>()),
  'saves:getLegalFiles': invoke(none, type<{ name: string; path: string }[]>()),
  'saves:openPath': invoke(z.tuple([text]), type<void>()),
  'saves:getUsage': invoke(none, type<SaveBackupsUsage>()),
  'saves:getLocalUsage': invoke(none, type<LocalBackupsUsage>()),
  'saves:cleanLocalBackups': invoke(
    none,
    type<{ files: number; bytes: number; folders: number }>(),
  ),
  'saves:needsIdentityCheck': invoke(none, type<boolean>()),
  'saves:checkIdentity': invoke(none, type<IdentityCheck | null>()),
  'saves:adoptMachine': invoke(z.tuple([text]), type<void>()),
  'saves:keepIdentity': invoke(none, type<void>()),
  'saves:getInstallIdentity': invoke(none, type<InstallIdentityStatus>()),
  'saves:resolveDuplicate': invoke(z.tuple([duplicateResolution]), type<void>()),
  'saves:scanBucket': invoke(none, type<CloudInventory>()),
  'saves:recoverFromCloud': invoke(none, type<RecoveryResult>()),
  'saves:deleteMachine': invoke(z.tuple([text]), type<number>()),
  'saves:purgeFolder': invoke(z.tuple([text]), type<number>()),
  'saves:scanLibrary': invoke(none, type<SavesScanEntry[]>()),
  'saves:getGameState': invoke(z.tuple([id]), type<SavesGameState | null>()),
  'saves:setEnabled': invoke(z.tuple([id, z.boolean(), text.optional()]), type<boolean>()),
  'saves:detect': invoke(z.tuple([id]), type<string | null>()),
  'saves:clearDetection': invoke(z.tuple([id]), type<boolean>()),
  'saves:addFolder': invoke(z.tuple([id, text]), type<string | null>()),
  'saves:removeFolder': invoke(z.tuple([id, text]), type<boolean>()),
  'saves:backupNow': invoke(z.tuple([id]), type<SavesBackupResult | null>()),
  'saves:restore': invoke(z.tuple([restoreRequestInput]), type<RestoreResult>()),
  'saves:setRestoreTarget': invoke(z.tuple([id, text.nullable()]), type<void>()),
  'saves:deleteBackup': invoke(z.tuple([id, id]), type<boolean>()),
  'saves:activity': event(type<SavesActivityEvent>()),
  'saves:queued': event(type<SavesQueuedEvent>()),

  // ── scan (carpetas de juegos) ────────────────────────────────────────────
  'scan:getFolders': invoke(none, type<string[]>()),
  'scan:setFolders': invoke(z.tuple([z.array(text)]), type<string[]>()),
  'scan:cached': invoke(none, type<ScanReport>()),
  'scan:run': invoke(none, type<ScanReport>()),
  'scan:matchTitle': invoke(
    z.tuple([z.object({ title: text, igdbId: z.number().nullable() })]),
    type<ScannedFolder | null>(),
  ),
  'scan:changed': event(type<void>()),

  // ── settings ─────────────────────────────────────────────────────────────
  'settings:getOpenAtLogin': invoke(none, type<boolean>()),
  'settings:setOpenAtLogin': invoke(z.tuple([z.boolean()]), type<void>()),
  'settings:getTimeFormat': invoke(none, type<TimeFormat>()),
  'settings:setTimeFormat': invoke(z.tuple([timeFormat]), type<void>()),
  'settings:getAmbientIdleMinutes': invoke(none, type<number>()),
  'settings:setAmbientIdleMinutes': invoke(z.tuple([z.number()]), type<void>()),
  'settings:getOverlayEnabled': invoke(none, type<boolean>()),
  'settings:setOverlayEnabled': invoke(z.tuple([z.boolean()]), type<void>()),
  'settings:getOverlayShortcut': invoke(none, type<string>()),
  'settings:setOverlayShortcut': invoke(z.tuple([text]), type<void>()),
  'settings:getOverlayShortcutStatus': invoke(none, type<OverlayShortcutStatus>()),
  'settings:getBackupIntervalHours': invoke(none, type<number>()),
  'settings:setBackupIntervalHours': invoke(z.tuple([z.number()]), type<void>()),
  'settings:getBackupCount': invoke(none, type<number>()),
  'settings:setBackupCount': invoke(z.tuple([z.number()]), type<void>()),
  'settings:getSyncFailure': invoke(none, type<SyncFailureInfo | null>()),
  'settings:getCredentials': invoke(none, type<CredentialsValues>()),
  'settings:getSaveStorageProvider': invoke(none, type<SaveStorageProvider>()),
  'settings:setCredentials': invoke(
    z.tuple([credentialsValues, saveStorageProvider.optional()]),
    type<CredentialsValues>(),
  ),
  'settings:storageMigrationProgress': event(type<StorageMigrationProgress>()),
  'settings:exportCredentials': invoke(z.tuple([text]), type<string>()),
  'settings:importCredentials': invoke(z.tuple([text]), type<CredentialsImportResult>()),
  'settings:getStartupKeysImport': invoke(none, type<StartupKeysImport | null>()),
  'settings:openDataFolder': invoke(none, type<void>()),

  // ── curiosities / memories / achievements / radar ────────────────────────
  'curiosities:getAll': invoke(none, type<CuriositySummary[]>()),
  'curiosities:getStatus': invoke(none, type<CuriositiesStatus>()),
  'curiosities:runBackfill': invoke(none, type<void>()),
  'curiosities:activity': event(type<CuriosityActivityEvent>()),
  'memories:getAll': invoke(none, type<GeneratedMemorySummary[]>()),
  'memories:getStatus': invoke(none, type<MemoriesStatus>()),
  'memories:runBackfill': invoke(none, type<void>()),
  'memories:regenerateStale': invoke(none, type<void>()),
  'memories:stop': invoke(none, type<void>()),
  'memories:activity': event(type<MemoryActivityEvent>()),
  'achievements:getForGame': invoke(z.tuple([id]), type<GameAchievements>()),
  'achievements:getStatus': invoke(none, type<AchievementsStatus>()),
  'achievements:getOverview': invoke(
    z.tuple([z.number().nullable()]),
    type<AchievementsOverview>(),
  ),
  'achievements:getSessionUnlocks': invoke(none, type<SessionUnlock[]>()),
  'achievements:sync': invoke(z.tuple([z.boolean()]), type<number>()),
  'achievements:stop': invoke(none, type<void>()),
  'achievements:retryFailed': invoke(none, type<number>()),
  'achievements:refreshGame': invoke(z.tuple([id]), type<boolean>()),
  'achievements:replacePlacements': invoke(z.tuple([id]), type<number>()),
  'achievements:activity': event(type<AchievementActivityEvent>()),
  'radar:list': invoke(none, type<RadarGame[]>()),
  'radar:dismiss': invoke(z.tuple([z.number()]), type<boolean>()),
  'radar:activity': event(type<RadarActivityEvent>()),
} as const;

export type Contract = typeof contract;
export type ChannelName = keyof Contract;
