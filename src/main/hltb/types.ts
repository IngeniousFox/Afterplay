// Lo único que nos interesa de HLTB: los tres tiempos de referencia en horas,
// ya mapeados a los mismos nombres que las columnas de la tabla games. El
// resto de lo que devuelve el paquete (imagen, plataformas...) no se guarda;
// solo se usa el año internamente para el match.
export type HltbTimes = {
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
};
