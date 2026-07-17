// Filtro de texto compartido por las columnas de nav y el modal de asignar
// sesión: trim + lowercase + includes, sin ninguna lógica más elaborada.
export const filterByTitle = <T extends { title: string }>(items: T[], search: string): T[] => {
  const query = search.trim().toLowerCase();
  return query ? items.filter((item) => item.title.toLowerCase().includes(query)) : items;
};
