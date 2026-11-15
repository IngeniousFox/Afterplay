// Consultas 2.0 de partidas guardadas (paquete P7 de CONSULTAS.md §4).
// Léase antes `../README.md`. La forma de la clave de la que sale el id de
// una copia está en `objectKey.ts`; la excepción a la regla del dueño (R-13),
// en `maintenanceRule.ts`.

export {
  SAVES_ROOT,
  parseSaveObjectKey,
  saveBackupIdForKey,
  saveFolderPrefix,
  saveObjectKey,
  type SaveObjectKeyParts,
} from './objectKey';
export { saveMaintenanceForeignWriteRule, type SaveMaintenanceRoute } from './maintenanceRule';
export {
  UNKNOWN_DEVICE_NAME,
  getLatestSaveBackup,
  getSaveBackup,
  getSaveBackupsByIds,
  getSaveBackupsUsage,
  hasIndexedSaveBackups,
  listIndexedSaveObjectKeys,
  listKnownLudusaviNames,
  listOwnBackupEntries,
  listSaveBackups,
  listSaveLineage,
  listOwnDeletedBackupNames,
  type LatestSaveBackup,
  type SaveLineageRow,
  type OwnBackupEntry,
} from './backupIndex';
export {
  deleteDeviceSaveBackups,
  deletePlannedSaveBackups,
  deleteSaveBackups,
  planSaveBackupDeletion,
  purgeSaveFolderRows,
  listSaveKeyGames,
  saveKeyFolder,
  reconcileOwnSaveBackups,
  recoverSaveBackups,
  type BucketDevice,
  type NewOwnSaveBackup,
  type OwnSaveBackupRef,
  type ReconcileOwnSaveBackupsInput,
  type ReconcileOwnSaveBackupsResult,
  type RecoverSaveBackupsInput,
  type RecoverSaveBackupsResult,
  type RecoveredSaveBackup,
  type SaveBackupDeletionPlan,
} from './backupWrites';
export {
  addSaveFolder,
  clearSaveDetection,
  ensureSaveKey,
  getSaveGame,
  listSaveGames,
  pairDetectedSaveNameIfUnpaired,
  removeSaveFolder,
  setDetectedSaveName,
  setSaveBackupEnabled,
  updateSaveSettings,
  type SaveGame,
  type SaveSettingsPatch,
} from './saveGames';
export {
  clearAllLastSyncedHashes,
  getLastSyncedHash,
  getSaveRestoreTarget,
  getSaveRestoreTargets,
  setLastSyncedHash,
  setSaveRestoreTarget,
  type SaveRestoreTarget,
} from './localState';
export {
  checkInstallNonce,
  forcePublishInstallNonce,
  readPublishedInstallNonce,
  type InstallNonceCheck,
} from './installNonce';
