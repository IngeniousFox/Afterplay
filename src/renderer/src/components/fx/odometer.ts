// Qué caracteres de `next` son nuevos respecto a `prev`, alineando por la
// derecha (las unidades cambian más que las decenas, y "9:59" → "10:00" crece
// por la izquierda). Puro, para poder probarlo sin DOM.
export const changedChars = (prev: string | null, next: string): boolean[] => {
  if (prev === null) return Array.from(next, () => false);
  const offset = prev.length - next.length;
  return Array.from(next, (char, index) => prev[index + offset] !== char);
};
