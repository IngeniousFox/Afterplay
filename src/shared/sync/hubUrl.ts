// La dirección del hub (AFTERPLAY-2.0.md §9.3), validada en UN sitio: la usan
// el formulario de emparejado (para avisar mientras se escribe) y el proceso
// principal (que no se fía de lo que le llega por IPC).
//
// https obligatorio: por esa conexión viaja el token del dispositivo, que abre
// toda la biblioteca. La única excepción es un hub de desarrollo en esta misma
// máquina (`wrangler dev`), que habla http sobre el bucle local.

export type HubUrlCheck =
  | { readonly ok: true; readonly url: string; readonly host: string; readonly local: boolean }
  | { readonly ok: false; readonly message: string };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** ¿Es esta máquina? (`hostname` tal como lo devuelve `URL`, con corchetes en IPv6.) */
export const isLoopbackHost = (hostname: string): boolean =>
  LOOPBACK_HOSTS.has(hostname.toLowerCase());

/**
 * Valida y normaliza (sin barra final ni parámetros). Los mensajes están en
 * inglés porque se enseñan tal cual en la interfaz.
 */
export function checkHubUrl(raw: string): HubUrlCheck {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Enter the hub address.' };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return {
      ok: false,
      message: 'That is not a valid address. Use the form https://your-hub.example.',
    };
  }
  const local = isLoopbackHost(parsed.hostname);
  if (parsed.protocol === 'http:') {
    if (!local) {
      return {
        ok: false,
        message: 'The hub address must start with https:// (http is only allowed for localhost).',
      };
    }
  } else if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'The hub address must start with https://.' };
  }
  // Credenciales en la URL acabarían en el log y en la interfaz.
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, message: 'The hub address must not contain a user name or password.' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return {
    ok: true,
    url: `${parsed.protocol}//${parsed.host}${path}`,
    host: parsed.hostname.toLowerCase(),
    local,
  };
}
