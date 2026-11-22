import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// `cn` con los tokens de Fósforo enseñados a tailwind-merge.
//
// El `cn` de lib/utils no conoce los tamaños de texto del tema (text-body,
// text-stat…): los toma por COLORES de texto, así que `cn('text-body
// text-dust')` se quedaba con text-dust y tiraba el tamaño sin avisar. Aquí
// se declaran como tamaños, y los radios y sombras del tema como lo que son.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['hero', 'stat', 'page', 'title', 'figure', 'lead', 'body', 'small', 'micro'] },
      ],
      shadow: [
        { shadow: ['float', 'modal', 'lift', 'glow-text', 'glow-bar', 'glow-halo', 'focus-field'] },
      ],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
