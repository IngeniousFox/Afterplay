import { isAddedAtArtifact } from '../../../shared/playthroughState';
import type { PlanHistory } from '../../../shared/types';

// LOS DOS HITOS DEL PASO POR EL PLAN, como los pinta la ficha (decisión R-06,
// src/main/db/v2/CONSULTAS.md).
//
// En la 1.x el historial contaba "Plan to Play" con un evento `plan_to_play`
// de la iteración vacía. La 2.0 no lo tiene (el Plan es `plan_entries`) y la
// ficha trae a cambio `planHistory`, del que salen dos entradas DERIVADAS, de
// solo lectura —ni se editan ni se borran desde el historial—:
//
//   "Added to Plan" = `plannedAt` + la nota que se apuntó al planearlo.
//   "Left the Plan" = `leftAt`, cuando se promocionó a la biblioteca.
//
// Las comparten el historial de escritorio (HistoryList), el del sofá
// (TvDetailHistory) y la tira "Your journey" (GameJourneyCard), para que las
// tres cuenten el mismo paso por el Plan con las mismas palabras.

export type PlanMilestone = {
  key: 'plan-added' | 'plan-left';
  label: string;
  date: Date;
  note: string | null;
};

export const planMilestones = (planHistory: PlanHistory | null | undefined): PlanMilestone[] => {
  if (!planHistory) return [];
  const milestones: PlanMilestone[] = [
    {
      key: 'plan-added',
      label: 'Added to Plan',
      date: planHistory.plannedAt,
      note: planHistory.note,
    },
  ];
  // null mientras sigue en el Plan, y también en lo importado de la 1.x que
  // se promocionó antes de que existiera `promotedAt`: no consta cuándo, y un
  // hito sin fecha no se inventa.
  if (planHistory.leftAt) {
    milestones.push({
      key: 'plan-left',
      label: 'Left the Plan',
      date: planHistory.leftAt,
      note: null,
    });
  }
  return milestones;
};

// "Added to Afterplay" sobra cuando el juego ENTRÓ en la app por el Plan:
// planear un juego nuevo escribe el alta y `plannedAt` con el mismo instante,
// y las dos entradas dirían lo mismo el mismo día. Mismo margen que el resto
// del papeleo del alta (isAddedAtArtifact): lo importado de la 1.x trae el
// `plannedAt` del evento `plan_to_play`, escrito en la misma transacción.
// Un juego de la biblioteca devuelto al Plan después sí conserva las dos.
export const enteredViaPlan = (
  addedAt: Date,
  planHistory: PlanHistory | null | undefined,
): boolean => planHistory != null && isAddedAtArtifact(planHistory.plannedAt, addedAt);
