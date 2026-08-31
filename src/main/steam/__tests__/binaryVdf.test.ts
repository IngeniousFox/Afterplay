import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isVdfObject, parseBinaryVdf, type VdfObject } from '../binaryVdf';

// EL PARSER DE VDF BINARIO (steam/binaryVdf.ts), escrito a mano byte a byte
// para el appcache de Steam. Es un árbol tipado: un byte de tipo, una clave
// terminada en NUL, y el valor según el tipo — y como está hecho a mano
// (sin librería), CUALQUIER desalineación de un solo byte hace que el resto
// del fichero se lea como basura o reviente.
//
// QUÉ BLINDA:
//   · El árbol anidado de verdad (objeto dentro de objeto), no solo un nivel.
//   · Los DOS bytes de cierre que existen en la práctica, 0x08 y 0x0b — la
//     cicatriz documentada en el propio fichero: "algunos ficheros cierran
//     con 0x0b en vez de 0x08 [...] hay que aceptar ambos o el parseo se
//     desalinea a mitad". Se prueba que ambos producen el MISMO árbol y que,
//     tras un cierre alternativo, la lectura del resto del buffer sigue
//     alineada (la prueba real de que no se desalinea).
//   · WIDESTR (UTF-16 con NUL doble), el tipo "rarísimo" que el propio
//     comentario del fichero avisa que hay que consumir entero.
//   · Los tipos numéricos (int32/float32/uint64/int64) y que isVdfObject
//     distingue un objeto anidado de cada tipo de valor hoja, UINT64/INT64
//     (bigint) incluidos.
//   · Que un tipo desconocido o una cadena sin NUL final lanzan un error en
//     vez de devolver un árbol a medias en silencio.
//
// QUÉ ES REAL: buffers construidos byte a byte con la misma forma que
// escribiría Steam, y parseBinaryVdf/isVdfObject reales sin ningún doble —
// el módulo no tiene dependencias que doblar.

// ── Constructores de buffers, un tipo VDF por función ───────────────────────

const cstr = (value: string): Buffer =>
  Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);

const stringEntry = (key: string, value: string): Buffer =>
  Buffer.concat([Buffer.from([0x01]), cstr(key), cstr(value)]);

const int32Entry = (key: string, value: number): Buffer => {
  const body = Buffer.alloc(4);
  body.writeInt32LE(value, 0);
  return Buffer.concat([Buffer.from([0x02]), cstr(key), body]);
};

const float32Entry = (key: string, value: number): Buffer => {
  const body = Buffer.alloc(4);
  body.writeFloatLE(value, 0);
  return Buffer.concat([Buffer.from([0x03]), cstr(key), body]);
};

const uint64Entry = (key: string, value: bigint): Buffer => {
  const body = Buffer.alloc(8);
  body.writeBigUInt64LE(value, 0);
  return Buffer.concat([Buffer.from([0x07]), cstr(key), body]);
};

const int64Entry = (key: string, value: bigint): Buffer => {
  const body = Buffer.alloc(8);
  body.writeBigInt64LE(value, 0);
  return Buffer.concat([Buffer.from([0x0a]), cstr(key), body]);
};

const wideStringEntry = (key: string, value: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x05]),
    cstr(key),
    Buffer.from(value, 'utf16le'),
    Buffer.from([0, 0]),
  ]);

// closeByte 0x08 o 0x0b: los dos existen en ficheros reales.
const objectEntry = (key: string, children: Buffer[], closeByte = 0x08): Buffer =>
  Buffer.concat([Buffer.from([0x00]), cstr(key), ...children, Buffer.from([closeByte])]);

describe('parseBinaryVdf: árbol anidado', () => {
  it('lee un objeto raíz con hijos escalares y un objeto anidado dentro', () => {
    const buffer = Buffer.concat([
      stringEntry('name', 'Half-Life 2'),
      objectEntry('userconfig', [int32Entry('achieved', 1)]),
    ]);

    const tree = parseBinaryVdf(buffer);
    assert.equal(tree.name, 'Half-Life 2');
    assert.ok(isVdfObject(tree.userconfig));
    assert.equal((tree.userconfig as VdfObject).achieved, 1);
  });

  it('anida tres niveles y cada nivel conserva solo sus propias claves', () => {
    const buffer = objectEntry('a', [
      stringEntry('leafA', 'uno'),
      objectEntry('b', [
        stringEntry('leafB', 'dos'),
        objectEntry('c', [stringEntry('leafC', 'tres')]),
      ]),
    ]);

    const tree = parseBinaryVdf(buffer);
    const a = tree.a as VdfObject;
    assert.equal(a.leafA, 'uno');
    const b = a.b as VdfObject;
    assert.equal(b.leafB, 'dos');
    const c = b.c as VdfObject;
    assert.equal(c.leafC, 'tres');
    // El objeto 'a' no se ha "comido" ninguna clave de sus hijos.
    assert.deepEqual(Object.keys(a).sort(), ['b', 'leafA']);
  });
});

describe('parseBinaryVdf: los dos bytes de cierre válidos, 0x08 y 0x0b', () => {
  it('un objeto anidado cerrado con 0x0b produce EXACTAMENTE el mismo árbol que cerrado con 0x08', () => {
    const withStandardClose = objectEntry('cfg', [int32Entry('v', 42)], 0x08);
    const withAltClose = objectEntry('cfg', [int32Entry('v', 42)], 0x0b);

    assert.deepEqual(parseBinaryVdf(withStandardClose), parseBinaryVdf(withAltClose));
  });

  it('tras un cierre 0x0b, la lectura del resto del buffer sigue alineada', () => {
    // La prueba real de la cicatriz: si el parser no reconociera 0x0b como
    // cierre, seguiría leyendo DENTRO del objeto anidado y confundiría la
    // siguiente entrada del padre con una clave más del hijo — 'afterKey'
    // no aparecería en el árbol, o el parseo reventaría antes de llegar.
    const buffer = Buffer.concat([
      objectEntry('nested', [int32Entry('inner', 1)], 0x0b),
      stringEntry('afterKey', 'sigue-alineado'),
    ]);

    const tree = parseBinaryVdf(buffer);
    assert.equal((tree.nested as VdfObject).inner, 1);
    assert.equal(tree.afterKey, 'sigue-alineado');
  });
});

describe('parseBinaryVdf: tipos escalares', () => {
  it('WIDESTR (UTF-16, NUL doble) decodifica el texto y no desalinea lo que viene después', () => {
    const buffer = Buffer.concat([wideStringEntry('wide', 'OK'), stringEntry('after', 'bien')]);
    const tree = parseBinaryVdf(buffer);
    assert.equal(tree.wide, 'OK');
    assert.equal(tree.after, 'bien');
  });

  it('FLOAT32 pierde precisión de IEEE754 simple pero se lee dentro de su margen', () => {
    const buffer = float32Entry('f', 3.14);
    const tree = parseBinaryVdf(buffer);
    assert.ok(Math.abs((tree.f as number) - 3.14) < 0.0001);
  });

  it('UINT64/INT64 se leen como bigint, incluido un valor que no cabe en 32 bits', () => {
    const buffer = Buffer.concat([
      uint64Entry('u', 10_000_000_000n),
      int64Entry('i', -10_000_000_000n),
    ]);
    const tree = parseBinaryVdf(buffer);
    assert.equal(tree.u, 10_000_000_000n);
    assert.equal(tree.i, -10_000_000_000n);
  });

  it('POINTER (0x04) y COLOR (0x06) se leen como int32, igual que el tipo 0x02', () => {
    const pointerEntry = Buffer.concat([
      Buffer.from([0x04]),
      cstr('p'),
      Buffer.from([0x2a, 0, 0, 0]),
    ]);
    const colorEntry = Buffer.concat([
      Buffer.from([0x06]),
      cstr('c'),
      Buffer.from([0x64, 0, 0, 0]),
    ]);
    const tree = parseBinaryVdf(Buffer.concat([pointerEntry, colorEntry]));
    assert.equal(tree.p, 42);
    assert.equal(tree.c, 100);
  });
});

describe('parseBinaryVdf: ficheros corruptos lanzan, no devuelven basura', () => {
  it('un byte de tipo desconocido lanza en vez de leer campos al azar', () => {
    const buffer = Buffer.concat([Buffer.from([0xff]), cstr('x')]);
    assert.throws(() => parseBinaryVdf(buffer), /tipo desconocido/);
  });

  it('una cadena sin terminador NUL lanza en vez de leer fuera del buffer', () => {
    // stringEntry sin el NUL final del VALOR: la clave sí termina bien, el
    // valor no.
    const buffer = Buffer.concat([
      Buffer.from([0x01]),
      cstr('clave'),
      Buffer.from('sin final', 'utf8'),
    ]);
    assert.throws(() => parseBinaryVdf(buffer), /cadena sin terminador/);
  });
});

describe('isVdfObject: distingue el nodo objeto de los valores hoja', () => {
  it('un objeto anidado es VdfObject; string, number, bigint y undefined no lo son', () => {
    const tree = parseBinaryVdf(
      Buffer.concat([
        objectEntry('obj', [int32Entry('x', 1)]),
        stringEntry('str', 'texto'),
        int32Entry('num', 7),
        uint64Entry('big', 5n),
      ]),
    );
    assert.equal(isVdfObject(tree.obj), true);
    assert.equal(isVdfObject(tree.str), false);
    assert.equal(isVdfObject(tree.num), false);
    // UINT64/INT64 son el único tipo que no es ni string/number ni un nodo
    // objeto: isVdfObject tiene que decir que no sin confundirlo con {}.
    assert.equal(isVdfObject(tree.big), false);
    assert.equal(isVdfObject(tree.noExiste), false);
  });
});
