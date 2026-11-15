import { invalidateToken } from '../igdb/auth';
import { resetR2Client } from '../saves/r2';
import { resetSgdbClient } from '../sgdb/client';

// Lo que hay que despertar cada vez que CAMBIAN las credenciales, vengan de
// teclearlas, de importar un fichero o de otro PC por el hub: los clientes
// cacheados capturaron la clave vieja al construirse y seguirían usándola
// hasta reiniciar la app. Vive aparte para que ipc/settings.ts y
// sync/appRuntime.ts lo compartan sin importarse entre sí.
export const invalidateCredentialClients = (): void => {
  invalidateToken();
  resetSgdbClient();
  // Lo mismo con el cliente de R2: se construyó con las claves viejas y
  // seguiría firmando con ellas (PARTIDAS-GUARDADAS.md §9).
  resetR2Client();
};
