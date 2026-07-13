import axios from 'axios';
import { getClientId, getValidToken, invalidateToken } from './auth';

// Única puerta de salida hacia IGDB: token + Client-ID en headers, body en
// texto plano APICalypse, y el reintento del 401 centralizado para todos los
// endpoints (games hoy; covers/artworks sueltos si algún día hacen falta).
export const igdbRequest = async (endpoint: string, body: string): Promise<unknown> => {
  const doRequest = async (): Promise<unknown> => {
    const token = await getValidToken();
    // <unknown> a propósito: la forma real depende del endpoint y la valida
    // el schema Zod de quien llama (api.ts) — aquí no hay forma de saberla,
    // y unknown obliga a esa validación en vez de dejar pasar un any.
    const response = await axios.post<unknown>(`https://api.igdb.com/v4/${endpoint}`, body, {
      headers: {
        'Client-ID': getClientId(),
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      timeout: 10_000,
    });
    return response.data;
  };

  try {
    return await doRequest();
  } catch (error) {
    // axios lanza en cualquier status que no sea 2xx. Si es un 401, el token
    // fue revocado antes de tiempo: invalidar y reintentar UNA vez. Cualquier
    // otro error sube tal cual.
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      invalidateToken();
      return doRequest();
    }
    throw error;
  }
};
