// Clases compartidas por varios campos del formulario — un solo sitio para
// no repetir la misma cadena larga en cada componente.
export const fieldLabelClass =
  'mb-1.75 text-[11.5px] font-bold tracking-[.05em] text-muted-foreground';

export const textInputClass =
  'w-full rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70';

// Brillo de foco (SearchStep lo estrenó) — aparte de textInputClass a
// propósito: ese se comparte con Settings y con detail/ (AddSpendPopover,
// HistoryList, DeleteGameDialog), fuera del alcance de este rediseño. Se
// añade a mano en los campos que sí lo llevan, componiéndolo con
// textInputClass en vez de tocarlo.
export const textInputFocusClass =
  'transition-[border-color,background-color,box-shadow] duration-150 focus:border-primary/45 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(47,220,126,.12)]';
