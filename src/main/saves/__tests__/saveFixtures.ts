import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { BackupMapping, MappingBackupNode } from '../types';

// Ayudas para simular la carpeta de backups que deja ludusavi y el
// mapping.yaml del bucket. Datos inventados.

export interface FakeFileSpec {
  readonly hash: string;
  readonly size: number;
}

export interface FakeBackupSpec {
  readonly name: string;
  /** Fecha del mapping.yaml (ISO). */
  readonly when: string;
  readonly files: Record<string, FakeFileSpec | null>;
  /** Nombre del completo del que cuelga (un diferencial). */
  readonly parent?: string;
  readonly registryHash?: string;
}

export const ROOT_HOME = 'C:/Users/ana';
export const SAVE_PATH = `${ROOT_HOME}/AppData/Local/Celeste/slot1.sav`;

const node = (spec: FakeBackupSpec): MappingBackupNode => ({
  name: spec.name,
  when: spec.when,
  os: 'windows',
  files: spec.files,
  ...(spec.registryHash ? { registry: { hash: spec.registryHash } } : {}),
});

/** Un mapping.yaml (texto) con esas copias; las de `parent` cuelgan de su completo. */
export function mappingYaml(
  ludusaviName: string,
  specs: readonly FakeBackupSpec[],
  extra: Partial<BackupMapping> = {},
): string {
  const fulls = new Map<string, MappingBackupNode>();
  for (const spec of specs.filter((candidate) => !candidate.parent)) {
    fulls.set(spec.name, { ...node(spec), children: [] });
  }
  for (const spec of specs.filter((candidate) => candidate.parent)) {
    fulls.get(spec.parent as string)?.children?.push(node(spec));
  }
  return stringify({
    name: ludusaviName,
    drives: {},
    backups: [...fulls.values()],
    ...extra,
  });
}

/** Añade una copia (mapping.yaml + su zip) a la carpeta de un juego, como haría ludusavi. */
export function addLocalBackup(
  gameDir: string,
  ludusaviName: string,
  spec: FakeBackupSpec,
  zipBytes = 64,
): void {
  mkdirSync(gameDir, { recursive: true });
  const path = join(gameDir, 'mapping.yaml');
  const mapping: BackupMapping = existsSync(path)
    ? (parse(readFileSync(path, 'utf-8')) as BackupMapping)
    : { name: ludusaviName, drives: {}, backups: [] };
  mapping.backups ??= [];
  if (spec.parent) {
    const full = mapping.backups.find((candidate) => candidate.name === spec.parent);
    if (!full) throw new Error(`el completo ${spec.parent} no existe`);
    full.children = [...(full.children ?? []), node(spec)];
  } else {
    mapping.backups.push(node(spec));
  }
  writeFileSync(path, stringify(mapping));
  writeFileSync(join(gameDir, spec.name), Buffer.alloc(zipBytes, spec.name.length));
}

export const readLocalMapping = (gameDir: string): BackupMapping =>
  parse(readFileSync(join(gameDir, 'mapping.yaml'), 'utf-8')) as BackupMapping;

/** Los nombres de todas las versiones (completos y diferenciales) de un mapping. */
export const namesOf = (mapping: BackupMapping): string[] =>
  (mapping.backups ?? []).flatMap((full) => [
    full.name,
    ...(full.children ?? []).map((child) => child.name),
  ]);

export const h = (letter: string): string => letter.repeat(40);
