import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  parse3Dm,
  parseCreamApi,
  parseDefaultIni,
  parseGoldbergJson,
  parseOnlineFix,
  parseRazor1911,
  parseRld,
  parseSkidrow,
  parseUserStats,
} from '../emu/parsers';

// LOS 9 PARSERS DE FORMATOS DE CRACK (steam/emu/parsers.ts, LOGROS.md §7):
// cada uno lee lo mismo —qué logro, cuándo— de un fichero con una sintaxis
// propia y frágil, escrita por un crack y no por Valve. Sin un test, un
// refactor de uno de ellos rompe SOLO a la gente que usa ESE crack en concreto,
// y no se entera nadie hasta que un usuario reporta "mis logros no aparecen".
//
// QUÉ BLINDA cada bloque de tests:
//   · Qué cuenta como "desbloqueado" en la sintaxis exacta de ese formato
//     (Achieved=1, achieved=true, el primer campo de un '@', earned:true...).
//   · La cicatriz de los 7 dígitos de OnlineFix/CreamAPI: el mismo número de
//     dígitos que un timestamp normal, pero interpretado con un multiplicador
//     MIL veces mayor. Sin este test, "arreglar" onlineFixSeconds para que
//     sea "más simple" (quitar la rama de 7 dígitos) manda esos logros a 1970
//     en silencio.
//   · Que un logro SIN fecha utilizable (0, ausente, corta) se cuenta igual
//     como desbloqueado con unlockedAt: null — no desaparece. El contrato lo
//     dice el propio tipo EmuUnlock; aquí se comprueba que cada parser lo
//     cumple de verdad.
//   · Que una fila que NO es un logro (el índice de RUNE, la sección 'Steam'
//     de RLD!, un valor no numérico) no cuela como uno.
//
// QUÉ ES REAL: ficheros de verdad en una carpeta temporal (mkdtempSync), con
// el contenido byte a byte que escribe cada crack (BOM, comentarios ###/;,
// hex, JSON). Los parsers solo llaman a readFileSync/JSON.parse — nada que
// doblar, así que QUÉ ES DOBLE es: nada.

let dir: string;
let counter = 0;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'afterplay-parsers-'));
});
after(() => {
  // Carpeta temporal del SO: no hace falta borrarla a mano para el test, y
  // arrastrar rimraf aquí sería una dependencia solo para esto.
});

// Un fichero de crack de verdad, con nombre único por test para no pisarse.
const writeCrack = (content: string): string => {
  const filePath = join(dir, `crack-${++counter}.dat`);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
};

const writeCrackBuffer = (content: Buffer): string => {
  const filePath = join(dir, `crack-${++counter}.dat`);
  writeFileSync(filePath, content);
  return filePath;
};

// Segundos unix usados en la mayoría de fixtures: 2026-02-01T12:00:00Z. Una
// fecha real y reciente, no 1970, para poder distinguir "se leyó bien" de
// "se rompió y dio 0".
const SECONDS = 1769947200;
const ISO = '2026-02-01T12:00:00.000Z';
// Hex little-endian de SECONDS (uint32), para RLD! y 3DM.
const SECONDS_HEX_LE = '40407f69';
// El caso real documentado en el fichero de este PC: 7 dígitos = micros, no
// millis. 1783855 * 1_000_000 ms = 2026-07-12T11:16:40.000Z — no 1970.
const RARE_7_DIGIT = '1783855';
const RARE_7_DIGIT_ISO = '2026-07-12T11:16:40.000Z';

describe('parseDefaultIni: CODEX / RUNE / RLE', () => {
  it('cuenta Achieved=1, ignora Achieved=0 y salta el índice de RUNE por nombre', () => {
    const file = writeCrack(
      [
        '﻿; comentario con punto y coma, se ignora',
        '### comentario de bloque, se ignora',
        '',
        '[SteamAchievements]',
        // Aunque este bloque tuviera Achieved=1, es el índice de RUNE, no un
        // logro: se descarta por NOMBRE de sección, no por su contenido.
        'Achieved=1',
        'UnlockTime=999999999',
        '',
        `[ACH_WIN_GAME]`,
        'Achieved=1',
        `UnlockTime=${SECONDS}`,
        '',
        '[ACH_LOSE_GAME]',
        'Achieved=0',
        `UnlockTime=${SECONDS}`,
      ].join('\r\n'),
    );

    const unlocks = parseDefaultIni(file);
    assert.deepEqual(unlocks.map((u) => u.apiName).sort(), ['ACH_WIN_GAME']);
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });

  it('un UnlockTime disparatado (0) sigue contando el logro, pero con fecha null', () => {
    // El contrato de EmuUnlock: "unlockedAt: null si el fichero no trae fecha
    // utilizable — el desbloqueo cuenta igual." Si un refactor filtrara por
    // fecha válida, este logro desaparecería en vez de aparecer sin fecha.
    const file = writeCrack('[ACH_SIN_FECHA]\nAchieved=1\nUnlockTime=0\n');
    const unlocks = parseDefaultIni(file);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].apiName, 'ACH_SIN_FECHA');
    assert.equal(unlocks[0].unlockedAt, null);
  });
});

describe('parseOnlineFix: dos variantes de mayúsculas, y la rareza de los 7 dígitos', () => {
  it('la variante minúscula (achieved/timestamp) no lleva la rareza: se multiplica por 1000 siempre', () => {
    const file = writeCrack(
      [
        '[ACH_LOWER_YES]',
        'achieved=true',
        `timestamp=${SECONDS}`,
        '',
        '[ACH_LOWER_NO]',
        'achieved=false',
        `timestamp=${SECONDS}`,
      ].join('\n'),
    );
    const unlocks = parseOnlineFix(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_LOWER_YES'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });

  it('la variante mayúscula con TimeUnlocked de 7 dígitos multiplica por 1.000.000, no por 1.000', () => {
    // LA cicatriz documentada en parsers.ts: un TimeUnlocked de exactamente 7
    // dígitos son segundos/1000, así que hay que deshacer esa división
    // multiplicando por 1e6. Interpretarlo como segundos normales (x1000)
    // mandaría este logro a un instante de 1970 — un test que solo comprobara
    // "hay una fecha" no distinguiría el bug de la fecha correcta.
    const file = writeCrack(`[ACH_UPPER_RARE]\nAchieved=true\nTimeUnlocked=${RARE_7_DIGIT}\n`);
    const unlocks = parseOnlineFix(file);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].unlockedAt?.toISOString(), RARE_7_DIGIT_ISO);
    // Y NO 1970, que es lo que daría *1000 en vez de *1_000_000.
    assert.notEqual(unlocks[0].unlockedAt?.getUTCFullYear(), 1970);
  });

  it('la variante mayúscula con un TimeUnlocked normal (no 7 dígitos) sí multiplica por 1000', () => {
    // El mismo valor de segundos que el test de arriba, pero con 10 dígitos:
    // la rama de la rareza NO debe activarse aquí.
    const file = writeCrack(`[ACH_UPPER_NORMAL]\nAchieved=true\nTimeUnlocked=${SECONDS}\n`);
    const unlocks = parseOnlineFix(file);
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });
});

describe('parseCreamApi: achieved=true + unlocktime, misma rareza de 7 dígitos', () => {
  it('7 dígitos en unlocktime también multiplica por 1.000.000', () => {
    const file = writeCrack(`[ACH_RARE]\nachieved=true\nunlocktime=${RARE_7_DIGIT}\n`);
    const unlocks = parseCreamApi(file);
    assert.equal(unlocks[0].unlockedAt?.toISOString(), RARE_7_DIGIT_ISO);
  });

  it('sin unlocktime en absoluto, el logro cuenta igual con fecha null (fallback a "0")', () => {
    const file = writeCrack('[ACH_SIN_TIEMPO]\nachieved=true\n');
    const unlocks = parseCreamApi(file);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].unlockedAt, null);
  });

  it('achieved=false se descarta entero', () => {
    const file = writeCrack(`[ACH_NO]\nachieved=false\nunlocktime=${RARE_7_DIGIT}\n`);
    assert.deepEqual(parseCreamApi(file), []);
  });
});

describe('parseSkidrow: ApiName=1@...@<segundos>, un único valor separado por @', () => {
  it('lee el primer campo como el flag y el ÚLTIMO como los segundos, con cualquier número de @ en medio', () => {
    const file = writeCrack(
      [
        '[Achievements]',
        `ACH_TRES_CAMPOS=1@0@${SECONDS}`,
        `ACH_DOS_CAMPOS=1@${SECONDS}`,
        `ACH_NO_GANADO=0@0@${SECONDS}`,
      ].join('\n'),
    );
    const unlocks = parseSkidrow(file);
    assert.deepEqual(unlocks.map((u) => u.apiName).sort(), ['ACH_DOS_CAMPOS', 'ACH_TRES_CAMPOS']);
    for (const unlock of unlocks) assert.equal(unlock.unlockedAt?.toISOString(), ISO);
  });

  it('un valor sin ningún @ (solo "1") sigue contando como desbloqueado, con fecha null', () => {
    // parts[0] y parts[parts.length-1] son el MISMO elemento cuando no hay
    // '@': "1" como segundos son 1000ms, muy anterior a 2000 -> null. El
    // logro no debe desaparecer por eso.
    const file = writeCrack('[Achievements]\nACH_SIN_AT=1\n');
    const unlocks = parseSkidrow(file);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].apiName, 'ACH_SIN_AT');
    assert.equal(unlocks[0].unlockedAt, null);
  });

  it('sin sección [Achievements] no revienta: devuelve la lista vacía', () => {
    const file = writeCrack('[OtraSeccion]\nAlgo=1\n');
    assert.deepEqual(parseSkidrow(file), []);
  });
});

describe('parseGoldbergJson: dos formas de JSON, earned + earned_time', () => {
  it('forma array (con "name"): earned true entra, false se descarta, sin earned_time da fecha null', () => {
    const file = writeCrack(
      JSON.stringify([
        { name: 'ACH_WIN', earned: true, earned_time: SECONDS },
        { name: 'ACH_LOSE', earned: false, earned_time: SECONDS },
        { name: 'ACH_SIN_TIEMPO', earned: true },
        // Un logro "en bruto" que no es objeto (fichero corrupto a medias):
        // no debe reventar el parseo del resto.
        'basura',
      ]),
    );
    const unlocks = parseGoldbergJson(file);
    assert.deepEqual(unlocks.map((u) => u.apiName).sort(), ['ACH_SIN_TIEMPO', 'ACH_WIN']);
    const win = unlocks.find((u) => u.apiName === 'ACH_WIN');
    assert.equal(win?.unlockedAt?.toISOString(), ISO);
    const sinTiempo = unlocks.find((u) => u.apiName === 'ACH_SIN_TIEMPO');
    assert.equal(sinTiempo?.unlockedAt, null);
  });

  it('forma objeto (apiName como clave) se lee igual que la forma array', () => {
    const file = writeCrack(
      JSON.stringify({
        ACH_WIN: { earned: true, earned_time: SECONDS },
        ACH_LOSE: { earned: false, earned_time: SECONDS },
      }),
    );
    const unlocks = parseGoldbergJson(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_WIN'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });
});

describe('parseRld: State/Time como uint32 LE en hex dentro de un INI', () => {
  it('State=1 (hex LE) desbloquea, State=0 no, y la sección "Steam" se salta por nombre', () => {
    const file = writeCrack(
      [
        '[Steam]',
        // Metadatos del propio crack, no un logro: si el filtro por nombre de
        // sección se cayera, esta fila colaría como un desbloqueo fantasma.
        'SomeMeta=01000000',
        '',
        '[ACH_WIN]',
        'State=01000000',
        `Time=${SECONDS_HEX_LE}`,
        '',
        '[ACH_LOSE]',
        'State=00000000',
        `Time=${SECONDS_HEX_LE}`,
      ].join('\n'),
    );
    const unlocks = parseRld(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_WIN'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });

  it('sin campo State no hay forma de saber si está desbloqueado: se excluye entero (a diferencia de sin Time)', () => {
    const file = writeCrack(`[ACH_SIN_STATE]\nTime=${SECONDS_HEX_LE}\n`);
    assert.deepEqual(parseRld(file), []);
  });

  it('un State demasiado corto para ser un uint32 (menos de 4 bytes) se trata como no desbloqueado', () => {
    // hexLeUint32 exige al menos 4 bytes; con menos, devuelve 0 en vez de
    // reventar — 0 !== 1, así que no cuenta.
    const file = writeCrack('[ACH_STATE_CORTO]\nState=01\n');
    assert.deepEqual(parseRld(file), []);
  });
});

describe('parse3Dm: secciones [State] y [Time] paralelas, "0101" = desbloqueado', () => {
  it('cruza ApiName entre las dos secciones por nombre', () => {
    const file = writeCrack(
      [
        '[State]',
        'ACH_WIN=0101',
        'ACH_LOSE=0100',
        '',
        '[Time]',
        `ACH_WIN=${SECONDS_HEX_LE}`,
        `ACH_LOSE=${SECONDS_HEX_LE}`,
      ].join('\n'),
    );
    const unlocks = parse3Dm(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_WIN'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });

  it('desbloqueado en [State] pero sin fila en [Time] cuenta igual, con fecha null', () => {
    const file = writeCrack('[State]\nACH_SIN_TIEMPO=0101\n\n[Time]\n');
    const unlocks = parse3Dm(file);
    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].unlockedAt, null);
  });
});

describe('parseUserStats: user_stats.ini, "Name"=(unlocked = true, time = N)', () => {
  it('unlocked = true se lee y el nombre pierde las comillas; unlocked = false no matchea el patrón y se descarta', () => {
    // El truco del parser: reemplaza el literal "unlocked = true, time = " y
    // deja solo el número. Si el valor dice "false", ese reemplazo NO ocurre,
    // el texto sobrante no es un número, y Number(...) da NaN -> se descarta.
    // Es una decisión sutil: no hay un chequeo explícito de "true" vs "false",
    // es la propia sustitución de texto la que filtra.
    const file = writeCrack(
      [
        '[ACHIEVEMENTS]',
        `"ACH_WIN"=(unlocked = true, time = ${SECONDS})`,
        '"ACH_LOSE"=(unlocked = false, time = 0)',
      ].join('\n'),
    );
    const unlocks = parseUserStats(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_WIN'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });

  it('una clave sin comillas se lee igual (el replace de comillas es un no-op, no obligatorio)', () => {
    const file = writeCrack(
      `[ACHIEVEMENTS]\nACH_SIN_COMILLAS=(unlocked = true, time = ${SECONDS})\n`,
    );
    const unlocks = parseUserStats(file);
    assert.equal(unlocks[0].apiName, 'ACH_SIN_COMILLAS');
  });

  it('sin sección [ACHIEVEMENTS] devuelve la lista vacía sin reventar', () => {
    const file = writeCrack('[OTRA]\nX=1\n');
    assert.deepEqual(parseUserStats(file), []);
  });
});

describe('parseRazor1911: texto plano, "ApiName 1 <segundos>" por línea', () => {
  it('lee las líneas con flag 1, ignora las de flag 0, y quita el BOM inicial', () => {
    const file = writeCrackBuffer(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]), // BOM UTF-8
        Buffer.from(`ACH_WIN 1 ${SECONDS}\nACH_LOSE 0 ${SECONDS}\n\n`, 'utf8'),
      ]),
    );
    const unlocks = parseRazor1911(file);
    assert.deepEqual(
      unlocks.map((u) => u.apiName),
      ['ACH_WIN'],
    );
    assert.equal(unlocks[0].unlockedAt?.toISOString(), ISO);
  });
});
