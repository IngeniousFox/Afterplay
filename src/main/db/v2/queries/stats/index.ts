// Estadísticas y vistas agregadas (AFTERPLAY-2.0.md §15.6, F-41): lo que antes
// el renderer calculaba recorriendo TODAS las sesiones y hoy llega ya
// reducido. Lecturas puras sobre las de `sessions/`, `library/` y
// `playthroughs/`; las reglas viven en `shared/domain`. Léase antes
// `../README.md`.

export { getJourneyEntries } from './journey';
export { getSessionStats, readStatsSessionRows } from './sessionStats';
export { getSessionsPage } from './sessionsPage';
