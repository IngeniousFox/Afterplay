import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { vacuumInto } from './backupCore';
import { withDbAccess } from '.';
import { getConfigValue } from '../config/store';
import { removeSidecars, sweepStraySidecars } from './sidecars';

const BACKUP_PREFIX = 'Afterplay-';
const BACKUP_SUFFIX = '.db';

const getBackupsDir = (): string => join(app.getPath('userData'), 'backups');

// El nombre lleva fecha Y HORA en LOCAL (no UTC) — es lo que el usuario ve al
// abrir la carpeta en el explorador, y tiene que leerse como su propio reloj
// de pared, no el de Greenwich. Minutos de precisión, sin segundos: con el
// intervalo mínimo de la app (6h) dos copias no pueden caer en el mismo
// minuto por accidente, y un nombre más corto se lee mejor.
const pad = (n: number): string => String(n).padStart(2, '0');

const stampOf = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
  `${pad(date.getHours())}-${pad(date.getMinutes())}`;

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})$/;

// La fecha que lleva el nombre de una copia, o null si el fichero no sigue el
// patrón. Y sí pasa: la carpeta es del usuario y puede tener dentro cualquier
// cosa que empiece por "Afterplay-" —una copia manual, un fichero que él mismo
// dejó ahí—, así que este null es quien decide qué es una copia automática y
// qué no (ver listBackups). Reconstruida con el constructor de Date en LOCAL
// —igual que se escribió— para que las horas salgan bien aunque de por medio
// haya un cambio de horario de verano.
const parseStamp = (fileName: string): Date | null => {
  const stem = fileName.slice(BACKUP_PREFIX.length, -BACKUP_SUFFIX.length);
  const match = STAMP_RE.exec(stem);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
};

const backupPathFor = (date: Date): string =>
  join(getBackupsDir(), `${BACKUP_PREFIX}${stampOf(date)}${BACKUP_SUFFIX}`);

// Las copias AUTOMÁTICAS de la carpeta, las únicas que este mecanismo cuenta
// para el intervalo y rota. Se exige que el sello se pueda LEER, no solo que
// el nombre empiece por "Afterplay-": con el filtro anterior una copia manual
// guardada aquí (el diálogo de "Back up now" no propone carpeta, así que se
// puede elegir esta) se colaba en la lista, ordenaba siempre la última —su
// nombre no lleva el sello, y cualquier letra ordena después de un dígito—,
// parseStamp devolvía null sobre ella y el "no hay último del que medir" de
// abajo hacía que TOCARA COPIA EN CADA ARRANQUE, con la rotación comiéndose
// las automáticas viejas: la retención se derrumbaba de días a arranques sin
// que nada avisara. Y de propina, una copia que el usuario pidió a mano ya no
// puede desaparecer por rotación.
const listBackups = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter(
          (name) =>
            name.startsWith(BACKUP_PREFIX) &&
            name.endsWith(BACKUP_SUFFIX) &&
            parseStamp(name) !== null,
        )
        // El nombre es AAAA-MM-DD_HH-mm con ceros de relleno: el orden
        // alfabético YA es el orden cronológico, no hace falta parsear nada
        // para ordenar.
        .sort()
    : [];

const HOUR_MS = 3_600_000;
const hoursBetween = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / HOUR_MS;

// Una copia física del .db local, sin tocar Turso para nada — para el "se me
// ha ido la pinza con algo y quiero volver a hace unas horas/días" sin
// depender de tener red ni de la ventana de retención de Turso. Se lanza
// (sin esperar) justo después de runMigrations() en el arranque, con el
// criterio de todo lo accesorio del arranque: si falla, se avisa por
// consola y la app sigue igual — no es motivo para no arrancar, y mucho
// menos para retrasar la ventana mientras VACUUM INTO copia el fichero
// entero. El propio VACUUM INTO va dentro de withDbAccess, igual que
// cualquier otro acceso a la DB que corre fuera del arranque síncrono.
//
// Cadencia y retención son configurables (Ajustes → Data backups,
// backupIntervalHours/backupCount en config/store.ts) — pero el mecanismo
// sigue siendo "se comprueba en cada arranque", no un temporizador de
// fondo: esta función no sabe ni le importa cuánto tiempo lleva la app sin
// abrirse, solo si desde la ÚLTIMA COPIA QUE EXISTE han pasado ya las horas
// que tocan.
export const runDailyBackup = async (): Promise<void> => {
  const dir = getBackupsDir();
  mkdirSync(dir, { recursive: true });

  // Antes de cualquier "¿toca copia?": la limpieza tiene que correr siempre,
  // o el día que la app se abre por segunda vez no se barre nada — y hay
  // días en que se abre veinte veces y ninguna es la primera.
  sweepStraySidecars(dir, BACKUP_PREFIX);

  const backupCount = getConfigValue('backupCount');
  // 0 = apagado. Se sale ANTES de tocar la DB — ni VACUUM INTO ni nada—, no
  // solo antes de guardar: encender/apagar esto no puede costar el peso de
  // copiar el fichero entero si al final no se va a quedar ninguna copia.
  if (backupCount <= 0) return;

  const backups = listBackups(dir);
  const lastStamp = backups.length > 0 ? parseStamp(backups[backups.length - 1]) : null;
  const now = new Date();
  const intervalHours = Math.max(1, getConfigValue('backupIntervalHours'));
  // Sin copias automáticas todavía: se trata como "toca ya" — no hay ningún
  // "último" del que medir la espera. El otro camino a null (un nombre
  // ilegible) ya no llega hasta aquí: listBackups solo devuelve nombres cuyo
  // sello se lee, y ese era justo el que convertía este "toca ya" en "toca en
  // CADA arranque".
  const due = lastStamp === null || hoursBetween(lastStamp, now) >= intervalHours;
  if (!due) return;

  const filePath = backupPathFor(now);
  // Ya existe una de este mismo minuto (rarísimo, pero el reloj del sistema
  // puede haber retrocedido): nada que hacer, VACUUM INTO fallaría igual si
  // el destino ya existe.
  if (existsSync(filePath)) return;

  try {
    await withDbAccess(() => vacuumInto(filePath));
    console.log(`[backup] copia local creada: ${filePath}`);
  } catch (error) {
    console.warn('[backup] no se pudo crear la copia local:', error);
    return;
  }

  const fresh = listBackups(dir);
  const toDelete = fresh.slice(0, Math.max(0, fresh.length - backupCount));
  for (const name of toDelete) {
    const backupPath = join(dir, name);
    try {
      unlinkSync(backupPath);
    } catch (error) {
      console.warn(`[backup] no se pudo borrar la copia antigua ${name}:`, error);
    }
    // Y sus acompañantes: si la copia se va, lo que iba con ella no pinta nada.
    removeSidecars(backupPath);
  }
};
