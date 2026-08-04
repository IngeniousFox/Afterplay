import { app } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TimeFormat } from '../../shared/types';
import { writeFileAtomicSync } from '../lib/atomicWrite';

// Preferencias de la app que NO son ajustes del sistema operativo (a
// diferencia de "iniciar con Windows", que vive en el registro vía
// app.setLoginItemSettings — ver ipc/settings.ts). Fichero plano en
// userData, igual que la DB — vale para lo poco que hay hoy y para lo que
// se añada después (SPEC 1.5.D, tema claro/oscuro, sigue pendiente).
// Tamaño/posición de la ventana SIN maximizar (ver lib/windowState.ts) —
// null hasta el primer resize/move/cierre real, o si el monitor donde
// estaba ya no está conectado.
type WindowBounds = { x: number; y: number; width: number; height: number };

type AppConfig = {
  timeFormat: TimeFormat;
  windowBounds: WindowBounds | null;
  windowMaximized: boolean;
  // Carpetas de juegos del modo "Scan your folders" (Add Game). Van aquí y
  // no en la DB a propósito: son rutas de ESTA máquina, y la DB sincroniza
  // entre PCs — el mismo motivo por el que las partidas guardadas tienen su
  // machine-saves.json (PARTIDAS-GUARDADAS.md §7.2).
  scanFolders: string[];
  // Minutos sin tocar la app antes de que entre el modo ambiente, o 0 para
  // no encenderlo nunca. En segundos sería más preciso pero el ajuste se
  // elige en minutos y guardar la misma unidad que se enseña evita
  // conversiones repartidas por el código.
  ambientIdleMinutes: number;
};

const DEFAULT_CONFIG: AppConfig = {
  timeFormat: '24h',
  windowBounds: null,
  windowMaximized: false,
  scanFolders: [],
  ambientIdleMinutes: 3,
};

// Lazy por el mismo motivo que getDbPath() en db/index.ts: app.getPath
// depende de app.setName(), que corre al principio de main/index.ts pero
// después de que este módulo se importe.
const getConfigPath = (): string => join(app.getPath('userData'), 'config.json');

let cached: AppConfig | null = null;

const readConfig = (): AppConfig => {
  if (cached) return cached;

  let next: AppConfig;
  if (existsSync(getConfigPath())) {
    try {
      next = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(getConfigPath(), 'utf-8')) };
    } catch (error) {
      // Existe pero no parsea (un corte a mitad de escritura): antes esto
      // reseteaba a DEFAULT_CONFIG en SILENCIO y el usuario perdía carpetas de
      // escaneo, posición de ventana y formato de hora sin enterarse de nada.
      // El writeFileAtomicSync de abajo ya casi lo impide, pero si aún pasa,
      // que al menos quede constancia en el log.
      console.warn('[config] config.json ilegible, arranco con los valores por defecto:', error);
      next = { ...DEFAULT_CONFIG };
    }
  } else {
    // No existe todavía: primer arranque, sin ruido. El próximo
    // setConfigValue() lo crea.
    next = { ...DEFAULT_CONFIG };
  }
  cached = next;
  return next;
};

export const getConfigValue = <K extends keyof AppConfig>(key: K): AppConfig[K] =>
  readConfig()[key];

export const setConfigValue = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void => {
  const config = { ...readConfig(), [key]: value };
  cached = config;
  writeFileAtomicSync(getConfigPath(), JSON.stringify(config, null, 2));
};
