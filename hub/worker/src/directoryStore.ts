// Lógica de `Directory` (§9.1): inquilinos, invitaciones y correo -> inquilino.
// Es una clase pura sobre `SqlStorage`, sin nada de Cloudflare, para probarla
// con SQLite de Node; `do/directory.ts` es solo la envoltura del Durable Object.
//
// D-03: el anfitrión invita, pero cada persona recibe SU PROPIO inquilino al
// entrar la primera vez. Aquí no hay ninguna operación del anfitrión sobre el
// inquilino de otra persona: ni listar, ni abrir, ni migrar.

import { randomString } from '../../core/crypto';
import type { SqlStorage, SqlValue } from '../../core/storage';
import { isValidEmail, normalizeEmail } from './emailIdentity';

/**
 * Alfabeto del id de inquilino: Crockford en minúsculas (sin i, l, o, u). Es el
 * mismo alfabeto del código de emparejado, y por eso el id puede ir como
 * prefijo del código que se teclea (ver enrollCode.ts).
 */
export const TENANT_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const TENANT_ID_LENGTH = 6;

export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface TenantRecord {
  id: string;
  email: string;
  createdAt: number;
}

export interface InvitationRecord {
  email: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export type InviteResult =
  | { ok: true; invitation: InvitationRecord }
  | { ok: false; reason: 'invalid_email' | 'already_member' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  email TEXT PRIMARY KEY NOT NULL,
  invitedBy TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  acceptedAt INTEGER
);`;

const num = (value: SqlValue | undefined): number => Number(value);

export class DirectoryStore {
  constructor(
    private readonly storage: SqlStorage,
    private readonly now: () => number,
    private readonly newTenantId: () => string = () =>
      randomString(TENANT_ID_LENGTH, TENANT_ID_ALPHABET),
  ) {
    storage.execScript(SCHEMA);
  }

  tenantExists(id: string): boolean {
    return this.storage.exec(`SELECT 1 AS found FROM tenants WHERE id = ?`, id).length > 0;
  }

  /** Todos los inquilinos (para el procedimiento de restauración: subir la época de cada uno). */
  tenantIds(): string[] {
    return this.storage
      .exec(`SELECT id FROM tenants ORDER BY createdAt, id`)
      .map((r) => String(r.id));
  }

  tenantOf(email: string): TenantRecord | null {
    const row = this.storage.exec(
      `SELECT id, email, createdAt FROM tenants WHERE email = ?`,
      normalizeEmail(email),
    )[0];
    return row
      ? { id: String(row.id), email: String(row.email), createdAt: num(row.createdAt) }
      : null;
  }

  /**
   * Quién es esta persona, a partir del correo que Access ya verificó. Fallo
   * cerrado: devuelve null (el Worker responde 403) salvo que
   *  1. ya tenga inquilino, o
   *  2. sea el anfitrión (`adminEmail`): su primera entrada crea su inquilino, o
   *  3. tenga una invitación vigente sin aceptar: se crea SU inquilino y la
   *     invitación queda aceptada (una invitación no se usa dos veces).
   */
  resolve(
    email: string,
    adminEmail: string | undefined,
  ): { tenantId: string; created: boolean } | null {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return null;
    return this.storage.transactionSync(() => {
      const existing = this.tenantOf(mail);
      if (existing) return { tenantId: existing.id, created: false };

      const now = this.now();
      const isHost = adminEmail !== undefined && normalizeEmail(adminEmail) === mail;
      let invited = false;
      if (!isHost) {
        invited =
          this.storage.exec(
            `SELECT 1 AS found FROM invitations WHERE email = ? AND acceptedAt IS NULL AND expiresAt > ?`,
            mail,
            now,
          ).length > 0;
        if (!invited) return null;
      }
      const tenantId = this.createTenant(mail, now);
      if (invited) {
        this.storage.exec(`UPDATE invitations SET acceptedAt = ? WHERE email = ?`, now, mail);
      }
      return { tenantId, created: true };
    });
  }

  private createTenant(email: string, now: number): string {
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = this.newTenantId();
      if (this.tenantExists(id)) continue;
      this.storage.exec(
        `INSERT INTO tenants (id, email, createdAt) VALUES (?, ?, ?)`,
        id,
        email,
        now,
      );
      return id;
    }
    throw new Error('no se pudo asignar un id de inquilino único');
  }

  /**
   * Crea (o renueva, si estaba caducada o sin aceptar) la invitación de un
   * correo. Quién puede invitar lo decide el Worker (solo el anfitrión); aquí
   * solo se rechaza invitar a quien ya tiene inquilino.
   */
  invite(email: string, invitedBy: string, ttlMs: number = INVITATION_TTL_MS): InviteResult {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: 'invalid_email' };
    return this.storage.transactionSync((): InviteResult => {
      if (this.tenantOf(mail)) return { ok: false, reason: 'already_member' };
      const now = this.now();
      const inviter = normalizeEmail(invitedBy);
      this.storage.exec(
        `INSERT INTO invitations (email, invitedBy, createdAt, expiresAt, acceptedAt) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(email) DO UPDATE SET invitedBy = excluded.invitedBy, createdAt = excluded.createdAt, expiresAt = excluded.expiresAt, acceptedAt = NULL`,
        mail,
        inviter,
        now,
        now + ttlMs,
      );
      return {
        ok: true,
        invitation: {
          email: mail,
          invitedBy: inviter,
          createdAt: now,
          expiresAt: now + ttlMs,
          acceptedAt: null,
        },
      };
    });
  }

  listInvitations(): InvitationRecord[] {
    return this.storage
      .exec(
        `SELECT email, invitedBy, createdAt, expiresAt, acceptedAt FROM invitations ORDER BY createdAt, email`,
      )
      .map((row) => ({
        email: String(row.email),
        invitedBy: String(row.invitedBy),
        createdAt: num(row.createdAt),
        expiresAt: num(row.expiresAt),
        acceptedAt: row.acceptedAt === null ? null : num(row.acceptedAt),
      }));
  }
}
