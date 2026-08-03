// Parser del VDF BINARIO de Valve (KeyValues serializado), el formato de los
// ficheros de appcache de Steam.
//
// Es un árbol de pares clave/valor con tipado por byte: un byte de tipo, la
// clave como cadena terminada en NUL, y luego el valor según el tipo. Los
// objetos anidados abren con tipo 0x00 y cierran con 0x08.
//
// Se implementa a mano (son 60 líneas) en vez de traerse una dependencia:
// aquí solo hace falta leer, nunca escribir, y el formato lleva quieto más de
// una década.

export type VdfValue = string | number | bigint | VdfObject;
export type VdfObject = { [key: string]: VdfValue };

const TYPE_OBJECT = 0x00;
const TYPE_STRING = 0x01;
const TYPE_INT32 = 0x02;
const TYPE_FLOAT32 = 0x03;
const TYPE_POINTER = 0x04;
const TYPE_WIDESTRING = 0x05;
const TYPE_COLOR = 0x06;
const TYPE_UINT64 = 0x07;
const TYPE_END = 0x08;
const TYPE_INT64 = 0x0a;
// Algunos ficheros cierran con 0x0b en vez de 0x08 — los dos significan lo
// mismo y hay que aceptar ambos o el parseo se desalinea a mitad.
const TYPE_END_ALT = 0x0b;

// Las cadenas son UTF-8 terminadas en NUL. Devuelve el texto y la posición
// justo detrás del NUL.
const readCString = (buffer: Buffer, start: number): [string, number] => {
  const end = buffer.indexOf(0, start);
  if (end === -1) throw new Error('VDF binario: cadena sin terminador');
  return [buffer.toString('utf8', start, end), end + 1];
};

const readObject = (buffer: Buffer, start: number): [VdfObject, number] => {
  const result: VdfObject = {};
  let offset = start;

  while (offset < buffer.length) {
    const type = buffer[offset];
    offset++;

    if (type === TYPE_END || type === TYPE_END_ALT) return [result, offset];

    const [key, afterKey] = readCString(buffer, offset);
    offset = afterKey;

    switch (type) {
      case TYPE_OBJECT: {
        const [child, afterChild] = readObject(buffer, offset);
        result[key] = child;
        offset = afterChild;
        break;
      }
      case TYPE_STRING: {
        const [value, afterValue] = readCString(buffer, offset);
        result[key] = value;
        offset = afterValue;
        break;
      }
      case TYPE_WIDESTRING: {
        // UTF-16 terminado en doble NUL. Rarísimo en estos ficheros, pero si
        // aparece hay que consumirlo entero o todo lo de detrás se desalinea.
        let end = offset;
        while (end + 1 < buffer.length && !(buffer[end] === 0 && buffer[end + 1] === 0)) end += 2;
        result[key] = buffer.toString('utf16le', offset, end);
        offset = end + 2;
        break;
      }
      case TYPE_INT32:
      case TYPE_POINTER:
      case TYPE_COLOR: {
        result[key] = buffer.readInt32LE(offset);
        offset += 4;
        break;
      }
      case TYPE_FLOAT32: {
        result[key] = buffer.readFloatLE(offset);
        offset += 4;
        break;
      }
      case TYPE_UINT64: {
        result[key] = buffer.readBigUInt64LE(offset);
        offset += 8;
        break;
      }
      case TYPE_INT64: {
        result[key] = buffer.readBigInt64LE(offset);
        offset += 8;
        break;
      }
      default:
        throw new Error(`VDF binario: tipo desconocido 0x${type.toString(16)} en ${offset}`);
    }
  }

  return [result, offset];
};

export const parseBinaryVdf = (buffer: Buffer): VdfObject => readObject(buffer, 0)[0];

export const isVdfObject = (value: VdfValue | undefined): value is VdfObject =>
  typeof value === 'object' && value !== null && typeof value !== 'bigint';
