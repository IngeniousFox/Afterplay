import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge only knows Tailwind's default scale. Without this, the
// Fósforo sizes (`text-body`) would be taken for text colours and dropped
// next to `text-ink`, and `shadow-float` for a shadow colour.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['hero', 'stat', 'page', 'title', 'figure', 'lead', 'body', 'small', 'micro'],
      shadow: ['float', 'modal', 'lift', 'glow-text', 'glow-bar', 'glow-halo', 'focus-field'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
