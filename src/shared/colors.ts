// Fósforo accents for code that needs the value in JS (an icon colour, an
// inline gradient, a `${color}1f` alpha suffix) instead of a Tailwind class.
// The values mirror src/shared/theme/fosforo.css; in JSX classes use the
// tokens (`text-phosphor`, `bg-tube`, `text-live`...) instead of these.
//
// The names are the 1.x ones so the callers did not have to move in the same
// change. Fósforo has a single accent, so the old green (brand) and the old
// gold (spend, pending, streaks) both became Phosphor.
export const AMBER = '#ffb347'; // --color-phosphor
export const GREEN = '#ffb347'; // --color-phosphor
export const VIOLET = '#b9a6ff'; // --color-st-resting
export const BLUE = '#5fd3e0'; // --color-tube
export const TEAL = '#5fd3e0'; // --color-tube
export const GRAY = '#8a9496'; // --color-dust
export const RED = '#ff5e57'; // --color-live
