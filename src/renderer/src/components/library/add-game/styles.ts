// Clases compartidas por varios campos del formulario — un solo sitio para
// no repetir la misma cadena larga en cada componente.
// Fósforo: rótulo en minúscula normal, Barlow semibold, sin tracking.
export const fieldLabelClass = 'mb-1.75 text-small font-semibold text-dust';

// Fósforo (hoja 4): relleno Inset, borde Edge (3:1 sobre Panel), radio 4 y
// foco con borde Phosphor + halo. El foco va incluido: todos los campos lo
// llevan.
export const textInputClass =
  'w-full rounded-sm border border-edge bg-inset px-3.25 py-2.5 text-[13px] text-bone outline-none placeholder:text-dust transition-[border-color,box-shadow] duration-150 focus:border-phosphor focus:shadow-focus-field';

// Se mantiene por compatibilidad con los campos que ya lo componían con
// textInputClass; hoy el foco ya viene en textInputClass.
export const textInputFocusClass = 'focus:border-phosphor focus:shadow-focus-field';
