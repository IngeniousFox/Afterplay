import { createContext, useContext } from 'react';
import type { GameId } from '../../../../shared/entityIds';
import { EMPTY_FILTERS, type GameFilters } from '../../lib/gameFilters';
import type { SettingsSectionId } from '../layout/SettingsSections';

// Lo que el armazón de escritorio (RootLayout) ofrece a las pantallas que
// monta: ir a Ajustes, abrir el alta de juegos o la paleta de Ctrl K sin que
// cada pantalla tenga su propia copia de esos modales, y la vista de la
// biblioteca.
//
// La vista de Library (búsqueda, filtros y el último juego abierto) vive aquí y
// no en la pantalla: antes la columna de juegos sobrevivía a la ficha porque
// estaba montada al lado, y ahora Library se desmonta al abrir un juego. Sin
// esto, volver de una ficha te devolvería la lista sin filtros.

export type LibraryView = {
  search: string;
  filters: GameFilters;
  // El juego que se abrió desde la rejilla por última vez: al volver, su
  // portada sale seleccionada y con el foco, como la fila de la columna.
  lastOpenedId: GameId | null;
};

// La biblioteca se ordena por lo último jugado (Fósforo): el último juego es
// el que manda, igual que en Home.
export const INITIAL_LIBRARY_VIEW: LibraryView = {
  search: '',
  filters: { ...EMPTY_FILTERS, sort: 'last-played' },
  lastOpenedId: null,
};

export type ShellActions = {
  // Navega a la página de Ajustes (/settings/<section>, General por defecto).
  // credentials: abre Integrations con el aviso de bienvenida y el grupo de
  // IGDB desplegado (lo que hacía el rail en el primer arranque).
  openSettings: (options?: { section?: SettingsSectionId; credentials?: boolean }) => void;
  openAddGame: () => void;
  openPalette: () => void;
  library: LibraryView;
  updateLibrary: (patch: Partial<LibraryView>) => void;
};

export const ShellContext = createContext<ShellActions | null>(null);

export const useShell = (): ShellActions => {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell needs RootLayout above it');
  return shell;
};
