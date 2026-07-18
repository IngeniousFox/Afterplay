import { app } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TimeFormat } from '../../shared/types';

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
};

const DEFAULT_CONFIG: AppConfig = {
  timeFormat: '24h',
  windowBounds: null,
  windowMaximized: false,
};

// Lazy por el mismo motivo que getDbPath() en db/index.ts: app.getPath
// depende de app.setName(), que corre al principio de main/index.ts pero
// después de que este módulo se importe.
const getConfigPath = (): string => join(app.getPath('userData'), 'config.json');

let cached: AppConfig | null = null;

const readConfig = (): AppConfig => {
  if (cached) return cached;

  let next: AppConfig;
  try {
    const raw = readFileSync(getConfigPath(), 'utf-8');
    next = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // No existe todavía (primer arranque) o está corrupto — se arranca con
    // los valores por defecto; el próximo setConfigValue() lo crea/arregla.
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
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
};
