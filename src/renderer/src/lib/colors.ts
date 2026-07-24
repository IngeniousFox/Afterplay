// Acento ámbar de la SPEC para gasto/pendientes/rachas — coincide con el
// color de 'beaten' (ver gameStatus.ts) pero es un token aparte a propósito:
// uno es el color de un estado de juego, el otro es un acento de UI que no
// debe cambiar si el color de 'beaten' cambiara el día de mañana.
export const AMBER = '#e3b24a';

// Resto de la paleta de identidad de sección (FormSection/SettingsCard/
// ModalShell/CheckboxRow) — antes redefinida byte a byte en AddGameModal.tsx,
// EditGameModal.tsx, edit-game/IterationSection.tsx, edit-game/
// EndlessSection.tsx y add-game/CheckboxRow.tsx, cada una con su propia
// copia de los mismos hex. Mismo motivo que AMBER: tokens de UI aparte de
// cualquier color de estado, aunque algunos coincidan de casualidad.
export const GREEN = '#2fdc7e';
export const VIOLET = '#7c86c8';
export const BLUE = '#85a3d6';
export const TEAL = '#2bb6a6';
export const GRAY = '#8b93a3';
