import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { deriveLocations, toSlashes } from './paths';
import type { BackupMapping, MappingBackupNode } from './types';

// Lectura del mapping.yaml, el índice que ludusavi deja junto a los zips de
// un juego (PARTIDAS-GUARDADAS.md §4.5). Aquí importa por dos motivos:
//
//  1. Es lo que convierte una carpeta de zips en algo restaurable. Al
//     restaurar en otro PC hay que materializar la carpeta desde R2, y sin
//     el mapping.yaml ludusavi no sabe qué hay.
//  2. Sus rutas absolutas son de dónde salen las UBICACIONES redirigibles,
//     sin descargar ningún zip (§4.9-8).

export const MAPPING_FILE = 'mapping.yaml';

// Cuándo se hizo un backup, leído de su propio nombre
// ("backup-20260726T093552Z.zip" -> 2026-07-26T09:35:52Z). Hace falta para
// decidir si un objeto del bucket es anterior a esta instalación (pruneFloor
// en machine.ts) SIN tener que bajarse ni el mapping.yaml: el listado de R2
// solo da claves y tamaños.
//
// null si el nombre no encaja, y quien llama lo trata como "no tocar": ante
// un formato que no entendemos, no borrar es la única respuesta segura.
const BACKUP_NAME_RE = /^backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/;

export const backupTimestamp = (backupName: string): Date | null => {
  const match = BACKUP_NAME_RE.exec(backupName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const readMapping = (gameBackupDir: string): BackupMapping | null => {
  const path = join(gameBackupDir, MAPPING_FILE);
  if (!existsSync(path)) return null;
  try {
    return (parse(readFileSync(path, 'utf-8')) as BackupMapping | null) ?? null;
  } catch (error) {
    console.warn(`[saves] mapping.yaml ilegible en ${gameBackupDir}:`, error);
    return null;
  }
};

export type BackupVersion = {
  name: string;
  when: string | null;
  differential: boolean;
  // Zips que hacen falta para restaurar ESTA versión. Un diferencial
  // necesita también el completo del que cuelga — y solo ese, no la carpeta
  // entera (§9.1).
  chain: string[];
  files: string[];
  hasRegistry: boolean;
  sizeBytes: number;
};

const nodeFiles = (node: MappingBackupNode): NonNullable<MappingBackupNode['files']> =>
  node.files ?? {};

const buildVersion = (node: MappingBackupNode, parent: MappingBackupNode | null): BackupVersion => {
  // Un diferencial solo lista lo que cambió: el contenido real de esa
  // versión es el del completo con los cambios encima.
  //
  // Y "lo que cambió" incluye lo que se BORRÓ. Un archivo que ya no existe
  // aparece en el diferencial con valor nulo (`"ruta": ~` en el YAML), no
  // ausente. Tratarlo como un archivo más reventaba al leer su tamaño
  // —`Cannot read properties of null (reading 'size')`, caso real al
  // respaldar una partida empezada de cero— y, aunque no reventara, contarlo
  // sería mentir: esa versión NO lo contiene.
  const merged: Record<string, { size?: number }> = {};
  // El padre también puede traer nulos (fue diferencial de otro), así que se
  // filtra en los dos lados en vez de asumir que solo el hijo los tiene.
  for (const [path, file] of Object.entries(parent ? nodeFiles(parent) : {})) {
    if (file) merged[path] = file;
  }
  for (const [path, file] of Object.entries(nodeFiles(node))) {
    if (file) merged[path] = file;
    else delete merged[path];
  }

  const sizeBytes = Object.values(merged).reduce((total, file) => total + (file.size ?? 0), 0);
  const hasRegistry = Boolean(node.registry?.hash ?? parent?.registry?.hash);

  return {
    name: node.name,
    when: node.when ?? null,
    differential: parent !== null,
    chain: parent ? [parent.name, node.name] : [node.name],
    files: Object.keys(merged).map(toSlashes),
    hasRegistry,
    sizeBytes,
  };
};

// Todas las versiones restaurables, de la más reciente a la más antigua.
export const listVersions = (mapping: BackupMapping | null): BackupVersion[] => {
  if (!mapping?.backups) return [];

  const versions: BackupVersion[] = [];
  for (const full of mapping.backups) {
    versions.push(buildVersion(full, null));
    for (const child of full.children ?? []) versions.push(buildVersion(child, full));
  }
  return versions.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
};

export const findVersion = (
  mapping: BackupMapping | null,
  backupName: string,
): BackupVersion | null =>
  listVersions(mapping).find((version) => version.name === backupName) ?? null;

// Ubicaciones distintas que cubre una versión concreta — la base del
// selector de destino (§10bis.5).
export const versionLocations = (version: BackupVersion): string[] =>
  deriveLocations(version.files);

// Quita versiones del índice local. Se hace a mano porque ludusavi no tiene
// forma de borrar un backup concreto: su `backups edit` solo sabe
// bloquear/desbloquear y poner comentarios.
//
// Devuelve false si tras la poda no queda ninguna versión — en ese caso lo
// que procede es tirar la carpeta entera, no dejar un mapping.yaml vacío.
export const removeBackupsFromMapping = (gameBackupDir: string, names: string[]): boolean => {
  const mapping = readMapping(gameBackupDir);
  if (!mapping) return false;

  const doomed = new Set(names);
  // Un completo se lleva sus diferenciales por delante quiera o no: viven
  // dentro de su nodo, y sin él no se pueden restaurar de todas formas.
  const remaining = (mapping.backups ?? [])
    .filter((full) => !doomed.has(full.name))
    .map((full) => ({
      ...full,
      children: (full.children ?? []).filter((child) => !doomed.has(child.name)),
    }));

  if (remaining.length === 0) return false;

  // Se reescribe el objeto ENTERO con lo que se leyó, cambiando solo
  // `backups`: así las claves que no conocemos (drives, y lo que añadan en
  // futuras versiones) sobreviven intactas.
  writeFileSync(join(gameBackupDir, MAPPING_FILE), stringify({ ...mapping, backups: remaining }));
  return true;
};
