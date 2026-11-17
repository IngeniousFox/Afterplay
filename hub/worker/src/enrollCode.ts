// Esquema del código de emparejado.
//
// El hub solo guarda la huella de `XXXXX-XXXXX` (10 caracteres, 50 bits) dentro
// del inquilino, y un código a secas no dice de qué inquilino es. Para no
// llevar un índice código -> inquilino (que habría que mantener y caducar),
// el código que ENSEÑA la PWA lleva el id del inquilino delante:
//
//   <6 del inquilino>-<5>-<5>      p. ej.  7k2m9p-K7M2P-9XQ4T
//
// 16 caracteres con guiones: se teclea sin problema. El id no es un secreto
// (va en claro en todos los tokens); lo secreto son los 50 bits finales, que
// protege el bloqueo por intentos (tenantService.ts). Como el alfabeto no tiene
// i/l/o/u, normalizar lo que teclea la persona (mayúsculas, O->0, I/L->1) es
// reversible y no mezcla ids distintos.

import { ENROLL_SECRET_PREFIX, isEnrollSecretShape } from '../../../src/shared/sync/protocol';
import { TENANT_ID_ALPHABET, TENANT_ID_LENGTH } from './directoryStore';

const CODE_BODY_LENGTH = 10;

/** `<inquilino>-<código del hub>`: lo que se enseña. */
export const formatEnrollCode = (tenantId: string, hubCode: string): string =>
  `${tenantId}-${hubCode}`;

/**
 * Separa lo que tecleó la persona en inquilino + código del hub. Null si no
 * tiene la forma (longitud o caracteres fuera del alfabeto).
 */
export function splitEnrollCode(raw: unknown): { tenantId: string; code: string } | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const compact = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1')
    .toLowerCase();
  if (compact.length !== TENANT_ID_LENGTH + CODE_BODY_LENGTH) return null;
  for (const ch of compact) if (!TENANT_ID_ALPHABET.includes(ch)) return null;
  return {
    tenantId: compact.slice(0, TENANT_ID_LENGTH),
    code: compact.slice(TENANT_ID_LENGTH).toUpperCase(),
  };
}

// ---------- Secreto de alta (§9.3, §19.3.1) ----------

/** `aes1.<inquilino>.<secreto>`: lo que el PC migrador deja para los demás. */
export const formatEnrollSecret = (tenantId: string, hubSecret: string): string =>
  `${ENROLL_SECRET_PREFIX}.${tenantId}.${hubSecret}`;

/** Separa inquilino y secreto del hub. Null si no tiene la forma. */
export function splitEnrollSecret(raw: unknown): { tenantId: string; secret: string } | null {
  if (!isEnrollSecretShape(raw)) return null;
  const [, tenantId, secret] = raw.split('.');
  return { tenantId, secret };
}
