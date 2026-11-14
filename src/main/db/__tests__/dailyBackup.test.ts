import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

// LA COPIA AUTOMATICA CONVIVIENDO CON UNA MANUAL EN LA MISMA CARPETA.
//
// El "cada cuanto toca" y la rotacion salen los dos de listar la carpeta y
// quedarse con el ULTIMO nombre. Mientras el filtro fue solo "empieza por
// Afterplay2- y acaba en .db", una copia manual guardada ahi (el dialogo de
// "Back up now" no propone carpeta, asi que se puede elegir esa) ordenaba
// siempre la ultima, su nombre no llevaba sello legible, y el "no hay ultimo
// del que medir" convertia el intervalo en "una copia por arranque" mientras
// la rotacion se comia las automaticas viejas. La ventana de retencion se
// derrumbaba de dias a arranques sin que nada avisara.
//
// QUE ES REAL Y QUE ES DOBLE: el modulo es el de verdad, listando, creando y
// borrando ficheros de verdad en una carpeta temporal. Lo doblado es lo que no
// existe fuera de la app: electron (app.getPath), el VACUUM INTO (aqui basta
// con que el fichero aparezca donde toca, que es lo unico que la rotacion
// mira) y la configuracion de Ajustes.
//
// Para lanzarlo solo:
//   npx tsx --test --experimental-test-module-mocks src/main/db/__tests__/dailyBackup.test.ts

let userDataDir = '';
const config = { backupCount: 5, backupIntervalHours: 24 };
const creados: string[] = [];

mock.module('electron', {
  namedExports: { app: { getPath: (): string => userDataDir } },
});

// La ruta se resuelve desde AQUI (src/main/db/__tests__), o sea los mismos
// ficheros que dailyBackup.ts importa como './backupCore' y
// '../config/store'. Node casa los dobles por URL resuelta.

mock.module('../backupCore', {
  namedExports: {
    vacuumInto: async (filePath: string): Promise<void> => {
      writeFileSync(filePath, 'copia de mentira');
    },
  },
});

mock.module('../../config/store', {
  namedExports: {
    getConfigValue: (key: 'backupCount' | 'backupIntervalHours'): number => config[key],
  },
});

let runDailyBackup: typeof import('../dailyBackup').runDailyBackup;

// El modulo bajo prueba se importa DENTRO del before(), con los dobles ya
// registrados: un import normal arriba lo cargaria antes que ellos.
before(async () => {
  ({ runDailyBackup } = await import('../dailyBackup'));
});

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'afterplay-backups-'));
  creados.push(userDataDir);
  config.backupCount = 5;
  config.backupIntervalHours = 24;
  mkdirSync(backupsDir(), { recursive: true });
});

after(() => {
  for (const dir of creados) rmSync(dir, { recursive: true, force: true });
});

const backupsDir = (): string => join(userDataDir, 'backups');

const pad = (n: number): string => String(n).padStart(2, '0');

// El mismo sello que escribe dailyBackup (local, hasta el minuto). Escrito a
// mano y no importado: si el formato del nombre cambiara, estos tests tienen
// que enterarse por un rojo, no adaptarse solos.
const automatica = (date: Date): string =>
  `Afterplay2-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
  `${pad(date.getHours())}-${pad(date.getMinutes())}.db`;

const escribir = (name: string): void => writeFileSync(join(backupsDir(), name), 'x');

const ficheros = (): string[] => readdirSync(backupsDir()).sort();

const horasAtras = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);

describe('la copia automatica no confunde una copia manual con una suya', () => {
  it('una manual en la carpeta no hace que toque copia en cada arranque', async () => {
    // El sintoma exacto del fallo: la automatica es de hace un rato, o sea que
    // NO toca; pero la manual ordena la ultima ('m' de manual va detras de
    // cualquier digito de un ano) y su nombre no lleva sello.
    escribir(automatica(horasAtras(1)));
    escribir('Afterplay2-manual-2026-08-13T20-23-11-000Z.db');
    const antes = ficheros();

    await runDailyBackup();

    assert.deepEqual(ficheros(), antes, 'no tocaba copia y se ha creado una');
  });

  it('la rotacion cuenta solo las automaticas y nunca se lleva la manual', async () => {
    // Con retencion 2 y tres automaticas viejas, la copia nueva deja dos: la
    // mas reciente de las viejas y ella. La manual no entra en ese censo — es
    // una copia que el usuario pidio a mano, y "un no externo no borra lo que
    // habia" vale tambien para la rotacion.
    config.backupCount = 2;
    const viejas = [horasAtras(96), horasAtras(72), horasAtras(48)].map(automatica);
    for (const name of viejas) escribir(name);
    escribir('Afterplay2-manual-2026-08-13T20-23-11-000Z.db');

    await runDailyBackup();

    const restantes = ficheros();
    assert.ok(
      restantes.includes('Afterplay2-manual-2026-08-13T20-23-11-000Z.db'),
      'la rotacion se ha llevado la copia manual',
    );
    const automaticas = restantes.filter((name) => !name.includes('manual'));
    assert.equal(automaticas.length, 2, `deberian quedar 2 automaticas: ${restantes.join(', ')}`);
    assert.ok(automaticas.includes(viejas[2]), 'ha borrado la mas reciente de las viejas');
    assert.ok(!automaticas.includes(viejas[0]), 'no ha rotado la mas antigua');
  });

  it('sin ninguna copia legible si toca: la primera se crea igual', async () => {
    // El borde contrario, para que el filtro nuevo no deje a la app sin copias:
    // una carpeta donde lo unico que hay es la manual sigue siendo "no hay
    // ninguna automatica todavia", y eso si es "toca ya".
    escribir('Afterplay2-manual-2026-08-13T20-23-11-000Z.db');

    await runDailyBackup();

    assert.equal(ficheros().length, 2, 'no ha creado la primera copia automatica');
  });

  it('con una automatica reciente y nada mas, no se copia por copiar', async () => {
    escribir(automatica(horasAtras(2)));

    await runDailyBackup();

    assert.equal(ficheros().length, 1);
  });

  it('las copias de la 1.x se quedan donde estan: ni cuentan ni rotan', async () => {
    // Afterplay-<sello>.db son las copias de la base 1.x, de antes del cambio:
    // la vuelta atras si la 2.0 sale mal. Mismo sello, otro prefijo, y la
    // rotacion de la 2.0 no las ve.
    config.backupCount = 1;
    const deLaUnoX = `Afterplay-${automatica(horasAtras(200)).slice('Afterplay2-'.length)}`;
    escribir(deLaUnoX);
    escribir(automatica(horasAtras(96)));

    await runDailyBackup();

    const restantes = ficheros();
    assert.ok(restantes.includes(deLaUnoX), 'la rotacion se ha llevado una copia de la 1.x');
    assert.equal(restantes.filter((name) => name.startsWith('Afterplay2-')).length, 1);
  });

  it('con la retencion apagada (0) no se toca nada', async () => {
    config.backupCount = 0;
    escribir(automatica(horasAtras(96)));
    const antes = ficheros();

    await runDailyBackup();

    assert.deepEqual(ficheros(), antes);
    assert.ok(existsSync(backupsDir()));
  });
});
