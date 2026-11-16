import {
  buildEntries,
  summarizeEntry,
  type JourneyEntrySummary,
} from '../../../../../shared/domain/journeyEntries';
import type { QueryContext } from '../common';
import { getGames } from '../library';
import { getAllStateEvents } from '../playthroughs';
import { getAllSessions } from '../sessions/read';

// Las carátulas del Journey (la línea temporal de lo jugado) cocinadas en el
// main (AFTERPLAY-2.0.md §15.6, F-41): `buildEntries` necesita las sesiones de
// toda la biblioteca para saber cuándo empezó y acabó cada tramo, su última
// nota y sus horas, pero las pantallas solo pintan el resultado. Lo que viaja
// son las entradas sin sus sesiones (`JourneyEntrySummary`); el rastro de
// puntitos del panel flotante pide las de su juego al abrirse.
export function getJourneyEntries(ctx: QueryContext): JourneyEntrySummary[] {
  return buildEntries(getGames(ctx), getAllSessions(ctx), getAllStateEvents(ctx)).map(
    summarizeEntry,
  );
}
