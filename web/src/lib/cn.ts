// Junta clases de Tailwind, saltándose las vacías. Sin fusión de conflictos
// (tailwind-merge no está en la PWA): quien llama no repite una misma
// propiedad en dos trozos.
export const cn = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');
