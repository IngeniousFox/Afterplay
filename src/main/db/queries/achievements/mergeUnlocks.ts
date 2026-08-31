// LA regla del fundido multi-fuente ya no vive aquí: está en
// src/shared/mergeUnlocks.ts, con su cabecera y su porqué enteros.
//
// Se mudó porque había una copia a mano FUERA del escritorio —el bucle de
// worker/src/queries/achievements.ts, que sirve la ficha del móvil— y desde
// src/main/db no se podía compartir sin que el Worker importara medio proceso
// principal. src/shared es justo el sitio de las reglas que los dos lados
// tienen que responder igual.
//
// Este fichero se queda como puerta de siempre para las consultas del
// escritorio que ya importaban de aquí (getGameAchievements, getSessionUnlocks,
// getMemoryFacts): mover sus imports es un cambio de otra oleada, y una regla
// no se arregla rompiendo a sus tres consumidores.
export type { MergedUnlock, UnlockCandidate } from '../../../../shared/mergeUnlocks';
export { mergeUnlocksByAchievement } from '../../../../shared/mergeUnlocks';
