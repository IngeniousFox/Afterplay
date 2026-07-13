import axios from 'axios';
import { z } from 'zod';

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(), // segundos de vida que le quedan al token
});

// Tipo para el genérico de axios.post<T> — así response.data ya no es any
// antes incluso de pasar por el .parse() de zod (que valida en runtime).
type TwitchTokenResponse = z.infer<typeof tokenResponseSchema>;

// Caché EN MEMORIA del app access token de Twitch (dura ~60 días): variable
// de módulo en el main, mismo patrón singleton que dbInstance en db/index.ts.
// Si la app se reinicia se pierde y se pide otro — es gratis y así el token
// no toca el disco.
let cachedToken: { token: string; expiresAt: number } | null = null;

const getCredentials = (): { clientId: string; clientSecret: string } => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET en el .env');
  }
  return { clientId, clientSecret };
};

export const getClientId = (): string => getCredentials().clientId;

export const getValidToken = async (): Promise<string> => {
  // Margen de 5 minutos: si está a punto de caducar, mejor pedir uno nuevo ya que
  // arriesgarse a que muera en mitad de una petición.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token;
  }

  const { clientId, clientSecret } = getCredentials();
  const response = await axios.post<TwitchTokenResponse>(
    'https://id.twitch.tv/oauth2/token',
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    { timeout: 10_000 },
  );

  const parsed = tokenResponseSchema.parse(response.data);
  cachedToken = {
    token: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  return cachedToken.token;
};

// Para el reintento tras un 401: Twitch puede revocar el token antes de su
// expiresAt teórico; se tira el cacheado y la siguiente llamada pide otro.
export const invalidateToken = (): void => {
  cachedToken = null;
};
