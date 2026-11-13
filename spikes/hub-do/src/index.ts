// Worker mínimo: enruta todo al TenantHub del inquilino `?tenant=` (por defecto "spike").
// Autenticación: TODAS las rutas exigen la cabecera `x-spike-key` igual al secreto
// SPIKE_KEY del Worker. Sin secreto configurado se rechaza todo (falla cerrado).
export { TenantHub } from './hub';

type Env = { TENANT_HUB: DurableObjectNamespace; SPIKE_KEY?: string };

// Comparación en tiempo constante (sin crypto.subtle.timingSafeEqual para no depender del runtime local).
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const key = req.headers.get('x-spike-key');
    if (!env.SPIKE_KEY || !key || !safeEqual(key, env.SPIKE_KEY))
      return new Response('unauthorized', { status: 401 });
    const tenant = new URL(req.url).searchParams.get('tenant') ?? 'spike';
    const stub = env.TENANT_HUB.get(env.TENANT_HUB.idFromName(tenant));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
