import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { getBackupDir, getConfigDir } from './run';
import type { LudusaviConfig, LudusaviCustomGame, LudusaviRedirect } from './types';

// El config.yaml de ludusavi, siempre por READ-MODIFY-WRITE
// (PARTIDAS-GUARDADAS.md §8.2).
//
// Por qué no se escribe entero: al arrancar con una carpeta de config virgen
// ludusavi AUTODETECTA los roots (Steam en C:, la biblioteca suelta de D:,
// WindowsApps, EA...). Eso no se puede pedir desde la CLI, así que se le deja
// hacerlo y nosotros solo tocamos las claves que nos importan. Sobrescribir
// el fichero sería tirar esa detección — y con ella, los juegos que guardan
// dentro de su carpeta de instalación.
//
// Además ludusavi reescribe el fichero por su cuenta al terminar algunas
// operaciones, otro motivo para releerlo antes de cada cambio en vez de
// mantener una copia en memoria.

const getConfigPath = (): string => join(getConfigDir(), 'config.yaml');

export const readLudusaviConfig = (): LudusaviConfig => {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return (parse(readFileSync(path, 'utf-8')) as LudusaviConfig | null) ?? {};
  } catch (error) {
    console.warn('[saves] config.yaml de ludusavi ilegible, se parte de cero:', error);
    return {};
  }
};

const writeLudusaviConfig = (config: LudusaviConfig): void => {
  writeFileSync(getConfigPath(), stringify(config));
};

export type ConfigPatch = {
  // Lista COMPLETA para esta operación: los redirects se calculan por
  // operación a partir del backup concreto que se va a restaurar, nunca se
  // acumulan de forma permanente (§8.2).
  redirects?: LudusaviRedirect[];
  customGames?: LudusaviCustomGame[];
  // De dónde lee el restore. Por defecto la carpeta local de backups; al
  // restaurar algo bajado de R2, la carpeta temporal donde se materializó.
  restorePath?: string;
  // Claves de registro a NO tocar en un restore, por juego. Es lo que hace
  // posible "exportar a una carpeta" sin escribir en HKCU (§4.9-4).
  toggledRegistry?: Record<string, Record<string, boolean>>;
};

// Política de retención de la carpeta LOCAL (§9.1). En R2 mandamos nosotros,
// así que las dos pueden divergir si algún día interesa. Tres copias
// completas y no una porque los diferenciales cuelgan de una completa: si esa
// única ancla se corrompe, todos sus diferenciales quedan inservibles.
const RETENTION_FULL = 3;
const RETENTION_DIFFERENTIAL = 5;

// Deja el config.yaml listo para la siguiente invocación. Se llama SIEMPRE
// antes de operar (aunque no haya nada específico que poner) porque los
// ajustes base —formato zip, retención, comprobación de versiones apagada—
// tienen que estar sí o sí, y ludusavi puede haberlos reescrito.
export const applyLudusaviConfig = (patch: ConfigPatch = {}): void => {
  const config = readLudusaviConfig();

  writeLudusaviConfig({
    ...config,
    // Apagada a propósito: empaquetamos el binario nosotros, su
    // autoactualización no nos sirve de nada, y con el valor por defecto una
    // invocación llegó a colgarse más de 2 minutos intentando consultar la
    // release de GitHub (§4.7).
    release: { ...config.release, check: false },
    redirects: patch.redirects ?? [],
    customGames: patch.customGames ?? config.customGames ?? [],
    backup: {
      ...config.backup,
      path: getBackupDir(),
      // Un objeto por backup en vez de un árbol de archivos: es lo que
      // permite subir a R2 una sola clave por versión (§4.5).
      format: { ...config.backup?.format, chosen: 'zip', zip: { compression: 'deflate' } },
      retention: { full: RETENTION_FULL, differential: RETENTION_DIFFERENTIAL },
    },
    restore: {
      ...config.restore,
      path: patch.restorePath ?? getBackupDir(),
      // Se reponen SIEMPRE (aunque vengan vacíos): un toggle que se quedara
      // de la operación anterior silenciaría partes de la siguiente sin que
      // nadie lo pidiera.
      toggledRegistry: patch.toggledRegistry ?? {},
      toggledPaths: {},
    },
  });
};
