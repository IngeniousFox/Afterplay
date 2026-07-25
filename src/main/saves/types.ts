// Formas del JSON que escupe ludusavi con --api (PARTIDAS-GUARDADAS.md §4).
// TODO opcional a propósito: está en 0.x y ha cambiado la salida más de una
// vez, así que aquí se asume lo mínimo y cada consumidor comprueba lo que
// necesita. El smoke test de scripts/fetch-ludusavi.ts es lo que avisa si un
// día deja de encajar; estos tipos no protegen de nada en runtime.

export type LudusaviChange = 'New' | 'Different' | 'Same' | 'Removed' | 'Unknown';

export type LudusaviFileEntry = {
  change?: LudusaviChange;
  bytes?: number;
  // Solo en restore: la ruta que tenía el archivo en el backup. La CLAVE del
  // objeto es la ruta FINAL (ya con los redirects aplicados), así que este
  // par es literalmente el "de dónde → a dónde" del diálogo de confirmación.
  originalPath?: string;
  ignored?: boolean;
  error?: { message?: string };
};

export type LudusaviRegistryEntry = {
  change?: LudusaviChange;
  ignored?: boolean;
  values?: Record<string, { change?: LudusaviChange; ignored?: boolean }>;
};

export type LudusaviGameEntry = {
  decision?: 'Processed' | 'Ignored' | 'Cancelled';
  change?: LudusaviChange;
  files?: Record<string, LudusaviFileEntry>;
  registry?: Record<string, LudusaviRegistryEntry>;
};

// Salida común de backup / restore / backups / cloud (su "general-output").
export type LudusaviOperationOutput = {
  overall?: {
    totalGames?: number;
    totalBytes?: number;
    processedGames?: number;
    processedBytes?: number;
    changedGames?: { new?: number; different?: number; same?: number };
  };
  games?: Record<string, LudusaviGameEntry>;
  errors?: { unknownGames?: string[]; someGamesFailed?: boolean };
};

export type LudusaviFindOutput = {
  games?: Record<string, unknown>;
  errors?: { unknownGames?: string[] };
};

export type LudusaviBackupInfo = {
  name: string;
  when?: string;
  os?: string;
  locked?: boolean;
};

export type LudusaviBackupsOutput = {
  games?: Record<string, { backupPath?: string; backups?: LudusaviBackupInfo[] }>;
};

// ── mapping.yaml ──────────────────────────────────────────────────────────
// El índice que ludusavi deja junto a los zips de un juego. Es lo que
// convierte una carpeta de zips en algo restaurable, y de sus rutas
// absolutas salen las ubicaciones que se pueden redirigir (§4.9-8).
export type MappingBackupNode = {
  name: string;
  when?: string;
  os?: string;
  // El valor puede ser NULL, y no es un detalle: en un diferencial, una ruta
  // con valor nulo significa "este archivo se borró desde la copia completa".
  files?: Record<string, { hash?: string; size?: number } | null>;
  registry?: { hash?: string | null } | null;
  // Los diferenciales cuelgan de su copia completa: restaurar un hijo exige
  // tener TAMBIÉN el zip del padre, y solo esos dos (§9.1).
  children?: MappingBackupNode[];
};

export type BackupMapping = {
  name?: string;
  drives?: Record<string, string>;
  backups?: MappingBackupNode[];
};

// ── Config de ludusavi (solo los campos que tocamos) ──────────────────────
// Se hace read-modify-write sobre el config.yaml que ludusavi se crea solo:
// al arrancar con una carpeta de config virgen AUTODETECTA los roots
// (verificado: encontró Steam en C: y la biblioteca de D: sin ayuda), y eso
// no se puede replicar desde la CLI. Sobrescribir el fichero entero sería
// tirar esa detección a la basura.
export type LudusaviRedirect = {
  kind: 'backup' | 'restore' | 'bidirectional';
  source: string;
  target: string;
};

export type LudusaviCustomGame = {
  name: string;
  files?: string[];
  registry?: string[];
  // 'override' (el defecto) SUSTITUYE la entrada del manifest que se llame
  // igual; 'extend' le AÑADE lo nuestro. La diferencia no es cosmética:
  // verificado sobre un juego real, extender le sumó nuestra carpeta a sus 17
  // archivos y le CONSERVÓ la clave de registro, mientras que sobrescribir la
  // habría perdido — y una partida a medias restaurada es peor que ninguna.
  integration?: 'override' | 'extend';
};

export type LudusaviConfig = {
  release?: { check?: boolean };
  roots?: { store: string; path: string }[];
  redirects?: LudusaviRedirect[];
  backup?: {
    path?: string;
    format?: { chosen?: 'simple' | 'zip'; zip?: { compression?: string } };
    retention?: { full?: number; differential?: number };
    filter?: { cloud?: Record<string, boolean> };
  };
  restore?: {
    path?: string;
    toggledRegistry?: Record<string, Record<string, boolean>>;
    toggledPaths?: Record<string, Record<string, boolean>>;
  };
  customGames?: LudusaviCustomGame[];
  [key: string]: unknown;
};
