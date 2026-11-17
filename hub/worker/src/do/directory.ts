// Durable Object `Directory` (§9.1): UNO para todo el despliegue. Envoltura de
// `DirectoryStore` (la lógica pura está allí y se prueba con SQLite de Node).
// Se direcciona siempre con `idFromName('directory')`.

import { DurableObject } from 'cloudflare:workers';
import { DirectoryStore, type InvitationRecord, type InviteResult } from '../directoryStore';
import { DoSqlStorage } from './sqlStorage';

export const DIRECTORY_OBJECT_NAME = 'directory';

export class DirectoryObject extends DurableObject {
  private store!: DirectoryStore;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.store = new DirectoryStore(new DoSqlStorage(ctx.storage), () => Date.now());
    });
  }

  resolve(
    email: string,
    adminEmail: string | undefined,
  ): { tenantId: string; created: boolean } | null {
    return this.store.resolve(email, adminEmail);
  }

  tenantIds(): string[] {
    return this.store.tenantIds();
  }

  tenantExists(tenantId: string): boolean {
    return this.store.tenantExists(tenantId);
  }

  invite(email: string, invitedBy: string): InviteResult {
    return this.store.invite(email, invitedBy);
  }

  listInvitations(): InvitationRecord[] {
    return this.store.listInvitations();
  }
}
