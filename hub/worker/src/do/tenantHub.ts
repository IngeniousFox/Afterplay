// Durable Object `TenantHub` (§9.1): uno por persona. Es una envoltura fina: la
// lógica vive en `TenantService` (puro, probado con SQLite de Node) y en el
// núcleo `hub/core`. Aquí solo se hace lo que exige el runtime: construir el
// servicio una vez por instancia, exponer las llamadas por RPC y mantener la
// alarma del barrido (§9.5).
//
// Identidad: cada llamada RPC lleva el id del inquilino como primer argumento
// (ver tenantBinding.ts). La primera lo fija en el almacenamiento y las
// siguientes comprueban que coincide; no se usa `ctx.id.name`.

import { DurableObject } from 'cloudflare:workers';
import { claimTenantIdentity, readTenantIdentity, TenantService } from '../tenantService';
import type { TenantRpc } from '../tenantBinding';
import { DoSqlStorage } from './sqlStorage';

/** Cada cuánto despierta la alarma (§9.5). Una hora: caducar concesiones no corre prisa. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export class TenantHubObject extends DurableObject implements TenantRpc {
  private service: TenantService | null = null;
  private readonly storage: DoSqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.storage = new DoSqlStorage(ctx.storage);
    // Si el objeto ya tenía dueño (se despertó por la alarma o por una
    // evicción), se reconstruye el servicio antes de atender nada.
    ctx.blockConcurrencyWhile(async () => {
      const known = readTenantIdentity(this.storage);
      if (known) this.service = this.build(known);
    });
  }

  private build(tenantId: string): TenantService {
    return new TenantService(this.storage, () => Date.now(), { tenantId });
  }

  /** Fija o comprueba el inquilino y devuelve el servicio. Síncrono: sin awaits no hay carreras. */
  private serviceFor(tenantId: string): TenantService {
    claimTenantIdentity(this.storage, tenantId);
    if (!this.service) {
      this.service = this.build(tenantId);
      // La alarma se arma en cuanto el objeto tiene dueño. `setAlarm` no se
      // espera: se encola en el mismo flujo de escritura del objeto.
      void this.armAlarm();
    }
    return this.service;
  }

  /** Solo se arma si no hay una ya: reconstruir el objeto no la mueve. */
  private async armAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  // Métodos de PROTOTIPO a propósito: la RPC de Workers no expone propiedades
  // de instancia (una flecha asignada a un campo no sería invocable).
  status(
    ...[tenantId, token, version]: Parameters<TenantRpc['status']>
  ): ReturnType<TenantRpc['status']> {
    return this.serviceFor(tenantId).status(token, version);
  }

  push(
    ...[tenantId, token, request]: Parameters<TenantRpc['push']>
  ): ReturnType<TenantRpc['push']> {
    return this.serviceFor(tenantId).push(token, request);
  }

  pull(
    ...[tenantId, token, since, limit, version]: Parameters<TenantRpc['pull']>
  ): ReturnType<TenantRpc['pull']> {
    return this.serviceFor(tenantId).pull(token, since, limit, version);
  }

  claimJob(
    ...[tenantId, token, request]: Parameters<TenantRpc['claimJob']>
  ): ReturnType<TenantRpc['claimJob']> {
    return this.serviceFor(tenantId).claimJob(token, request);
  }

  doneJob(
    ...[tenantId, token, request]: Parameters<TenantRpc['doneJob']>
  ): ReturnType<TenantRpc['doneJob']> {
    return this.serviceFor(tenantId).doneJob(token, request);
  }

  enroll(...[tenantId, request]: Parameters<TenantRpc['enroll']>): ReturnType<TenantRpc['enroll']> {
    return this.serviceFor(tenantId).enroll(request);
  }

  createEnrollmentCode(
    ...[tenantId, ttlMinutes]: Parameters<TenantRpc['createEnrollmentCode']>
  ): ReturnType<TenantRpc['createEnrollmentCode']> {
    return this.serviceFor(tenantId).createEnrollmentCode(ttlMinutes);
  }

  async listTokens(
    ...[tenantId]: Parameters<TenantRpc['listTokens']>
  ): ReturnType<TenantRpc['listTokens']> {
    return this.serviceFor(tenantId).listTokens();
  }

  async revokeToken(
    ...[tenantId, tokenId]: Parameters<TenantRpc['revokeToken']>
  ): ReturnType<TenantRpc['revokeToken']> {
    return this.serviceFor(tenantId).revokeToken(tokenId);
  }

  /** Barrido periódico. Se vuelve a armar SIEMPRE, aunque el barrido falle. */
  async alarm(): Promise<void> {
    try {
      this.service?.sweep();
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
