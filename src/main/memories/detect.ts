import { scopeRange } from '../../shared/memory/chapters';
import { enqueueMemories } from './queue';
import { computeMemoriesOverview } from './status';

// La detección automática — el corazón del cambio respecto a la v1
// (AFTERPLAY-LOOP.md §3.3): al arrancar la app y una vez al día mientras viva
// en la bandeja, los periodos recién cerrados sin recap se encolan SOLOS.
// Junio termina → la próxima vez que la app despierte en julio, el recap de
// junio se genera sin que toques nada. El 1 de enero, lo mismo con el año.
//
// "Lo automático cubre solo lo recién cerrado": el pasado histórico (todos
// tus meses de antes del Loop) se genera con el botón de Ajustes — así el
// gasto gordo inicial es una decisión tuya, no una sorpresa del primer
// arranque. La frontera es esta ventana: un periodo cuyo cierre quede más
// atrás ya no es "recién" nada, es historia.
const AUTO_WINDOW_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

// Lo stale NUNCA entra aquí (§3.3): corregir una fecha del pasado no dispara
// una llamada silenciosa — se regenera a mano desde Ajustes.
export const runMemoriesAutoDetection = async (): Promise<void> => {
  // Sin clave, nada de esto corre y la app funciona exactamente igual que
  // hoy — la IA es capa opcional, como en las curiosidades.
  if (!process.env.ANTHROPIC_API_KEY) return;

  const now = new Date();
  const { overview } = await computeMemoriesOverview(now);

  const recentlyClosed = overview.missing.filter((scope) => {
    const end = scopeRange(scope).end.getTime();
    return now.getTime() >= end && now.getTime() - end <= AUTO_WINDOW_DAYS * DAY_MS;
  });

  if (recentlyClosed.length > 0) enqueueMemories(recentlyClosed, 'auto');
};

// El tic diario: la app puede pasar semanas sin reiniciarse (vive en la
// bandeja), así que un intervalo la despierta cada hora y esto decide si hoy
// ya se miró. El día se compara en hora LOCAL — el cambio de mes que importa
// es el del calendario de quien juega.
let lastDetectionDay: string | null = null;

export const runMemoriesDailyTick = async (): Promise<void> => {
  const today = new Date().toDateString();
  if (lastDetectionDay === today) return;
  lastDetectionDay = today;
  try {
    await runMemoriesAutoDetection();
  } catch (error) {
    // Que un fallo (DB ocupada en un swap, lo que sea) no queme el día: se
    // reintenta en el siguiente tic.
    lastDetectionDay = null;
    console.error('[memories] fallo en la detección automática:', error);
  }
};
