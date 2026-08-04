import type { SaveBackupRow } from '../db/schema';

// Contrato del IPC de partidas guardadas. Vive aparte de orchestrator.ts a
// propósito: shared/types.ts lo reexporta para el renderer, y así ese import
// no arrastra (ni siquiera visualmente) el módulo que carga el SDK de S3,
// node:fs y electron.

// Las DOS puertas de PARTIDAS-GUARDADAS.md §9.2. Ninguna función de
// partidas hace nada a medias: o están las dos abiertas o la sección se ve
// deshabilitada con el motivo.
export type SavesStatus = {
  // Falso si el .exe no está o un antivirus se lo llevó (§11.2). Afterplay
  // sigue funcionando con normalidad; solo se apaga esto.
  binaryAvailable: boolean;
  r2Configured: boolean;
  ready: boolean;
};

// Una fila de la pantalla de resultados del escaneo completo (§10.1).
export type SavesScanEntry = {
  ludusaviName: string;
  fileCount: number;
  bytes: number;
  registryKeys: string[];
  steamIdInPath: boolean;
  // Con qué juego de la biblioteca ha casado, si ha casado con alguno.
  gameId: number | null;
  gameTitle: string | null;
  enabled: boolean;
};

export type SavesLocalState = {
  files: number;
  bytes: number;
  registryKeys: string[];
  locations: string[];
  steamIdInPath: boolean;
  // Comparación con el último backup, gratis en el mismo --preview.
  change: 'new' | 'different' | 'same' | 'none';
};

export type SavesGameState = {
  ludusaviName: string | null;
  detectionSource: 'auto' | 'manual' | null;
  enabled: boolean;
  // Carpetas añadidas a mano, YA expandidas para poder enseñarlas. En un
  // juego detectado automáticamente se SUMAN a lo que ludusavi ya sabe (y a
  // su registro), no lo sustituyen.
  customPaths: string[];
  local: SavesLocalState | null;
  cloud: SaveBackupRow[];
  // Destino personalizado de restauración en ESTA máquina, si lo hay
  // (§10bis.5). Nunca sincroniza: vive en machine-saves.json.
  restoreTarget: string | null;
  // El juego está corriendo ahora mismo: restaurar queda bloqueado (§10bis.3).
  running: boolean;
};

// Los tres destinos posibles de una restauración (§10bis.5).
export type RestoreMode =
  // Rutas del backup. La ÚNICA destructiva: pisa la partida actual.
  | 'in-place'
  // Otra ruta de este PC — se recuerda por máquina.
  | 'custom-path'
  // Copia suelta a una carpeta. No toca el juego ni el registro.
  | 'export';

export type RestoreRequestInput = {
  gameId: number;
  backupId: number;
  mode: RestoreMode;
  // Obligatorio salvo en 'in-place'.
  target?: string;
  // true = solo calcular el plan, sin escribir nada. El diálogo de
  // confirmación se construye con esto, que es lo que ludusavi haría de
  // verdad y no una predicción nuestra (§4.9-6).
  preview: boolean;
};

export type RestorePlanFile = {
  // Ruta final, ya con los redirects aplicados.
  target: string;
  source: string | null;
  bytes: number;
};

export type RestoreResult = {
  mode: RestoreMode;
  files: RestorePlanFile[];
  registryKeys: string[];
  totalBytes: number;
  // Ubicaciones distintas que trae el backup. Con más de una, redirigir solo
  // la primera dejaría la partida a medias (§4.9-3).
  locations: string[];
  registrySkipped: boolean;
  // Solo en preview: avisos que la UI tiene que enseñar antes de confirmar.
  warnings: string[];
};

export type SavesBackupResult = {
  ludusaviName: string;
  uploaded: number;
  // ¿Había ALGO donde Afterplay mira? Separa dos casos que acaban los dos en
  // `uploaded: 0` y que no se parecen en nada: "la partida no ha cambiado
  // desde la última copia" (todo bien) y "no hay ni un archivo ahí" (la
  // carpeta se movió, el juego se desinstaló, la ruta a mano se quedó
  // vieja). Sin esta distinción el segundo caso se anunciaba como el
  // primero — "Nothing changed since the last backup" — que es justo lo
  // tranquilizador que no hay que decirle a alguien cuyas partidas ya no se
  // están copiando. Verificado con el binario: una ruta inexistente devuelve
  // `games: {}` y código de salida 0, sin un solo aviso.
  foundFiles: boolean;
};

// Una máquina que el BUCKET conoce (machines/<id>.json). Las dos banderas
// de coincidencia se calculan en el main, que es quien sabe cómo se llama
// este PC y cuál es su %USERPROFILE%.
export type CloudMachine = {
  machineId: string;
  machineName: string;
  home: string;
  updatedAt: string | null;
  sameName: boolean;
  sameHome: boolean;
};

export type IdentityCheck = {
  bucket: string;
  currentMachineId: string;
  // Ya hay backups subidos con el id actual: adoptar otra identidad los
  // dejaría huérfanos, así que el cambio deja de ofrecerse sin más.
  claimed: boolean;
  // Esta máquina ya figura en machines/ — si no, una reinstalación futura no
  // tendría con qué reconocerla.
  published: boolean;
  // Las demás máquinas del bucket (la propia se excluye).
  machines: CloudMachine[];
};

// ── Inventario del bucket (lo que hay DE VERDAD ahí arriba) ───────────────
// El índice local puede estar incompleto o vacío (reinstalación sin Turso),
// así que esto se calcula listando R2 y no la tabla. Los tamaños vienen del
// propio listado —ListObjectsV2 devuelve Size por objeto—, así que conocer el
// total exacto no cuesta ni una lectura extra.

// Una carpeta de juego de una máquina: saves/<igdbId>/<machineId>/
export type CloudFolder = {
  igdbId: number;
  machineId: string;
  // Título de la biblioteca si el igdbId casa con un juego; null si no está
  // (juego borrado, o biblioteca aún sin recuperar).
  gameTitle: string | null;
  gameId: number | null;
  backupCount: number;
  totalBytes: number;
  // Cuántas de esas versiones NO están en el índice local — o sea, lo que la
  // app no sabe que existe y por tanto no puede ni restaurar ni borrar.
  unknownCount: number;
};

export type CloudInventory = {
  totalBytes: number;
  objectCount: number;
  // Bytes que el índice local desconoce por completo.
  unknownBytes: number;
  folders: CloudFolder[];
  // Máquinas presentes en el bucket, con lo que ocupa cada una. Incluye las
  // que no tienen manifiesto en machines/ (subidas antes de que existiera el
  // registro, o por una instalación que nunca llegó a registrarse).
  machines: {
    machineId: string;
    machineName: string | null;
    home: string | null;
    isCurrent: boolean;
    totalBytes: number;
    backupCount: number;
  }[];
};

export type RecoveryResult = {
  // Filas de índice creadas a partir de lo que había en el bucket.
  recovered: number;
  // Versiones que no se pudieron enganchar porque su juego no está en la
  // biblioteca (hay que añadirlo primero y volver a recuperar).
  skippedNoGame: number;
  // Carpetas cuyo mapping.yaml no se pudo leer.
  unreadableFolders: number;
};

// Cuánto ocupa Cloud saves en R2, para Ajustes (API & Sync) — ver
// getSaveBackupsUsage: una SUM local sobre save_backups, cero llamadas al
// bucket.
export type SaveBackupsUsage = { totalBytes: number; backupCount: number };

// Cuánto ocupa la carpeta LOCAL de backups (save-backups/, ver run.ts), para
// el mantenimiento de Ajustes — ver saves/localUsage.ts. No confundir con
// SaveBackupsUsage de arriba, que es el mismo dato pero en R2.
export type LocalBackupsUsage = {
  totalBytes: number;
  totalFiles: number;
  // Ya reflejado en el índice de esta máquina — seguro de borrar.
  reclaimableBytes: number;
  reclaimableFiles: number;
  // Carpetas sin fila ni juego que las reclame.
  orphanBytes: number;
  orphanFolders: number;
};

// Copia automática en marcha, para que la ficha abierta lo cuente en vivo
// (§10.2). Las cuatro fases son las que un humano necesita distinguir:
// "va a pasar", "está pasando", "ya está" y "no ha podido ser".
export type SavesActivityEvent = {
  gameId: number;
  phase: 'scheduled' | 'uploading' | 'done' | 'failed';
  // Solo en 'done': cuántas versiones nuevas se subieron (0 si la partida no
  // había cambiado desde la última copia).
  uploaded?: number;
  // Solo en 'done': false cuando no se encontró NINGÚN archivo donde mirar
  // (ver SavesBackupResult.foundFiles). Un backup automático que no encuentra
  // nada es la peor forma de fallar —silenciosa y repetida— así que la ficha
  // abierta tiene que poder decirlo en vez de dar un "listo" a secas.
  foundFiles?: boolean;
  // Solo en 'failed'.
  message?: string;
};

// La ficha pide su estado (getGameSavesState -> previewGame) y ludusavi ya
// está ocupado con otra cosa (un escaneo global, PARTIDAS-GUARDADAS.md §4.1,
// dura 8-15s en una biblioteca real) — antes esto era un spinner mudo sin
// decir por qué tardaba. `label` sale de peekLudusaviQueueLabel(), leído en
// el main JUSTO ANTES de encolar esta petición: lo que estuviera corriendo
// en ese instante es, por construcción, SIEMPRE ajeno (la propia petición
// nunca puede ser lo que ve corriendo antes de haberse encolado ella misma).
export type SavesQueuedEvent = {
  gameId: number;
  label: string;
};
