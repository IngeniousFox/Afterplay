// El nombre por defecto de un playthrough nuevo: "Playthrough N".
//
// N sale del número más alto YA USADO, no del recuento. Contar era la cicatriz:
// `deleteIteration` es una acción real de la ficha, así que un juego con
// "Playthrough 1" y "Playthrough 3" vivos (borraste el 2) tiene DOS iteraciones
// y la siguiente se llamaba otra vez "Playthrough 3" — dos filas con el mismo
// nombre en el desplegable de playthroughs, indistinguibles, y reproducible al
// 100%.
//
// El recuento sigue siendo el SUELO, y a propósito: las etiquetas que el
// usuario rebautizó ("Primera vuelta", "NG+") no aportan ningún número, y ahí
// el siguiente tiene que ser "Playthrough 3" y no volver a empezar por 1.
//
// Vive en shared/domain (y no en las queries del main, donde estuvo) porque
// las puertas que estrenan playthrough son ya TRES: crear a mano
// (createIteration), jugar cuando el último ya terminó (resolveIterationForPlay
// en el escritorio) y el cronómetro del móvil (el Worker). Las dos últimas
// pasan por la decisión pura de resolvePlaythrough.ts, que no puede importar
// nada del main. El fichero antiguo se queda como reexportación para no tocar
// a createIteration.
const NUMBERED_LABEL = /^Playthrough (\d+)$/;

export const nextPlaythroughLabel = (existingLabels: readonly string[]): string => {
  let highest = existingLabels.length;

  for (const label of existingLabels) {
    const match = NUMBERED_LABEL.exec(label.trim());
    if (!match) continue;
    // Number.isSafeInteger deja fuera una etiqueta con un número absurdo
    // (parseInt de 21 dígitos devuelve 1e21 y "Playthrough 1e+21" sería peor
    // que el nombre repetido que esto viene a arreglar).
    const used = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(used) && used > highest) highest = used;
  }

  return `Playthrough ${highest + 1}`;
};
