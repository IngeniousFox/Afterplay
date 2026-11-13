// La moneda que se guarda en cada gasto nuevo (D-23: una sola moneda en la
// interfaz; cada gasto guarda la suya por si algún día hay varias).
//
// Una constante y no un ajuste: la app no tiene hoy ninguna moneda
// configurable y pinta siempre euros (`formatMoney` en `shared/format.ts`).
// Escribir otra cosa haría que un mismo historial mezclase monedas sin que la
// interfaz lo supiera. Una sola definición para todo lo que escribe gastos:
// `playthroughs/addSpendEvent` y el gasto inicial del alta y de la promoción
// (`games/`). El día que haya un ajuste de moneda, llega por el contexto y el
// resto no cambia.
//
// El importador de la 1.x (`importer/index.ts`) usa también esta constante
// para todo lo que trae (salvo que quien lo llame indique otra).
export const DEFAULT_CURRENCY = 'EUR';
