import type { RadarActivityEvent } from '../../shared/types';
import { makeNotifier } from '../lib/makeNotifier';

// Aviso al renderer de que el radar ha encontrado entregas nuevas de tus
// sagas. Mismo patrón inyectado que curiosidades, recaps, logros e imágenes
// (lib/makeNotifier) — un solo aviso AGRUPADO por pasada, nunca uno por
// juego: descubrir tres secuelas la misma semana es una noticia, no tres.
const notifier = makeNotifier<RadarActivityEvent>();

export const setRadarNotifier = notifier.set;
export const notifyRadarActivity = notifier.notify;
