import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getLudusaviPath, isLudusaviAvailable } from './binary';

// Invocación de ludusavi. Todo lo que hay aquí sale de las pruebas reales de
// PARTIDAS-GUARDADAS.md §4.7 y §4.9 — son detalles que cuestan una tarde
// descubrir y ninguno es opcional:
//
//  · `--config` SIEMPRE con ruta absoluta estilo Windows. Con una relativa
//    hace panic, no da un error limpio.
//  · Los flags GLOBALES (--config, --no-manifest-update) van ANTES del
//    subcomando; detrás, la CLI los rechaza con "unexpected argument".
//  · El JSON va por stdout y los avisos humanos por stderr.
//  · El exit code puede ser ≠ 0 con JSON perfectamente válido (un `find` de
//    un juego desconocido devuelve errors.unknownGames con código 1). Regla:
//    se parsea stdout SIEMPRE y solo es error si el JSON falta o no parsea.
//  · `--no-cloud-sync`: no usamos el rclone de ludusavi, subimos nosotros a
//    R2. Sin esto se mete en comprobaciones de nube que no llevan a nada.
//  · execFile y nunca exec: los argumentos van como array, sin shell que
//    reinterprete comillas ni rutas con espacios.

export const getConfigDir = (): string => join(app.getPath('userData'), 'ludusavi-config');

// Carpeta de trabajo de los backups en ESTA máquina. Es la fuente local; la
// copia que importa vive en R2 (§9).
export const getBackupDir = (): string => join(app.getPath('userData'), 'save-backups');

// Donde se materializa lo que se baja de R2 antes de restaurar. Hermana de
// la de backups, nunca dentro: ver createRestoreWorkspace.
export const getRestoreWorkspaceDir = (): string =>
  join(app.getPath('userData'), 'save-restore-tmp');

export const ensureSavesDirs = (): void => {
  mkdirSync(getConfigDir(), { recursive: true });
  mkdirSync(getBackupDir(), { recursive: true });
};

export class LudusaviUnavailableError extends Error {
  constructor() {
    super("The save-backup engine isn't available.");
    this.name = 'LudusaviUnavailableError';
  }
}

// Un escaneo global de la biblioteca entera devuelve cientos de KB de JSON
// (medido: 319 KB con 15 juegos detectados y muchos más analizados). El
// límite por defecto de execFile (1 MB) se quedaría corto en una biblioteca
// grande y el fallo sería un truncamiento silencioso.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type RunOptions = {
  // Solo para operaciones largas de verdad (escaneo global). El resto se
  // conforma con el timeout por defecto.
  timeoutMs?: number;
  // Prepara el config.yaml para ESTA invocación, y se ejecuta DENTRO de la
  // cola, justo antes del comando. Auditoría: escribir el config al llamar y
  // ejecutar después (encolado) dejaba una carrera — dos operaciones a la
  // vez y el comando de una corría con el config de la otra, exactamente lo
  // que la cola existía para impedir. Config y comando tienen que ser una
  // sola unidad atómica.
  configure?: () => void;
};

const execLudusavi = (args: string[], timeoutMs: number): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      getLudusaviPath(),
      args,
      { maxBuffer: MAX_OUTPUT_BYTES, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        // Se resuelve incluso con error: el exit code NO decide nada aquí
        // (ver cabecera). Solo un fallo real de lanzamiento —binario que no
        // arranca, timeout— deja stdout vacío, y de eso ya se encarga el
        // parseo de arriba.
        if (error && !stdout) {
          reject(new Error(`ludusavi falló: ${error.message}${stderr ? ` — ${stderr}` : ''}`));
          return;
        }
        resolve({ stdout });
      },
    );

    // CERRAR STDIN NO ES OPCIONAL. Varios subcomandos aceptan la lista de
    // juegos "alternativamente por stdin, uno por línea": si no se le pasan
    // nombres —que es justo el caso del escaneo global— ludusavi se queda
    // esperando esa lista hasta el fin de los tiempos. Con execFile el hijo
    // hereda una tubería que nadie cierra, así que el proceso NO termina
    // nunca: medido, 6 minutos y subiendo con salida vacía; cerrando stdin,
    // 13 segundos y 15 juegos detectados.
    //
    // Y como la cola de aquí abajo es serie, una sola invocación colgada
    // congela TODA la función: el "Detect" de una ficha se quedaba esperando
    // detrás de un escaneo que ya no iba a terminar.
    child.stdin?.end();
  });

// Cola de una sola vía: todas las operaciones comparten el MISMO config.yaml
// (los redirects y toggles se escriben justo antes de cada invocación, §8.2),
// así que dos a la vez se pisarían la configuración. Los backups del watcher
// pueden coincidir con algo lanzado a mano desde la ficha, y eso no es una
// hipótesis remota: es un cierre de sesión mientras miras otro juego.
let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queue.then(task, task);
  // La cola nunca se rompe por un fallo de una tarea: la siguiente arranca
  // igual (de ahí el mismo callback en los dos brazos del then de arriba).
  queue = result.catch(() => undefined);
  return result;
};

// Ejecuta ludusavi con --api y devuelve el JSON parseado. `args` es SOLO el
// subcomando y sus opciones; los flags globales los pone esta función.
export const runLudusavi = async <T>(args: string[], options: RunOptions = {}): Promise<T> => {
  if (!isLudusaviAvailable()) throw new LudusaviUnavailableError();
  ensureSavesDirs();

  const fullArgs = ['--config', getConfigDir(), '--no-manifest-update', ...args];

  return enqueue(async () => {
    options.configure?.();
    const { stdout } = await execLudusavi(fullArgs, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new Error(
        `ludusavi no devolvió JSON válido (${args[0]}): ${stdout.slice(0, 400) || '(salida vacía)'}`,
      );
    }
  });
};

// El manifest (la base de datos de "qué juego guarda dónde") es lo ÚNICO que
// necesita red, y solo por eso esta es la única invocación sin
// --no-manifest-update. El resto del tiempo va siempre puesto, para que
// ninguna operación de partidas dependa de tener internet.
//
// Nunca lanza: sin red se sigue con el manifest que ya hubiera, y si no
// había ninguno la detección automática devolverá "no encontrado" — que es
// justo para lo que existe el modo manual (§10.3).
const updateManifest = async (): Promise<void> => {
  try {
    // Ludusavi se autolimita a una comprobación cada 24h, así que llamarlo
    // una vez por sesión no supone una descarga por arranque.
    await enqueue(() =>
      execLudusavi(
        ['--config', getConfigDir(), '--try-manifest-update', 'manifest', 'update'],
        DEFAULT_TIMEOUT_MS,
      ),
    );
  } catch (error) {
    console.warn('[saves] no se pudo actualizar el manifest de ludusavi:', error);
  }
};

let readyOnce: Promise<void> | null = null;

const prepare = async (): Promise<void> => {
  ensureSavesDirs();

  // 1. La PRIMERA vez que se toca una carpeta de config virgen, ludusavi la
  // crea él solo y de paso AUTODETECTA los roots (verificado: encuentra
  // Steam en C:, la biblioteca suelta de D:, WindowsApps y EA sin ayuda
  // ninguna). Eso no se puede pedir desde la CLI, así que se le deja hacerlo
  // ANTES de que nuestro escritor de config toque nada — si escribiéramos
  // primero, esa detección no llegaría a ocurrir nunca y los juegos que
  // guardan dentro de su carpeta de instalación quedarían invisibles.
  if (!existsSync(join(getConfigDir(), 'config.yaml'))) {
    await runLudusavi<unknown>(['config', 'show']).catch(() => undefined);
  }

  // 2. Sin manifest no hay detección automática posible. En una instalación
  // nueva no existe, y como todas nuestras invocaciones llevan
  // --no-manifest-update, nadie lo bajaría nunca por su cuenta.
  await updateManifest();
};

// Deja a ludusavi en condiciones de trabajar. Se llama al principio de cada
// operación; el trabajo real ocurre UNA vez por sesión (las siguientes
// llamadas reusan la misma promesa, también si aún está en vuelo).
export const ensureLudusaviReady = async (): Promise<void> => {
  if (!isLudusaviAvailable()) throw new LudusaviUnavailableError();
  // Si prepare() falla (un EPERM transitorio del antivirus sobre el mkdir, un
  // corte al bajar el manifest), la promesa rechazada NO se puede quedar
  // memoizada: con `??=` no se reasigna nunca, así que TODA operación de
  // saves de la sesión rechazaría con ese error caduco hasta reiniciar. Al
  // limpiar la caché en el fallo, el siguiente intento vuelve a probar.
  readyOnce ??= prepare().catch((error) => {
    readyOnce = null;
    throw error;
  });
  await readyOnce;
};
