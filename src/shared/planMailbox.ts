// El buzón del Plan (REMOTO.md §6) — lo que el móvil ENCOLA y el escritorio
// DRENA. Vive en shared porque lo necesitan los tres lados: el Worker para
// escribir, el main para leer y aplicar, y el renderer/PWA para pintar lo que
// todavía está pendiente.
//
// Por qué existe: dar de alta un planeado no es un INSERT. createPlannedGame
// resuelve IGDB + HLTB + SteamGridDB + appid de Steam y escribe juego +
// iteración + evento en una transacción. Replicar eso en el Worker sería
// duplicar lógica de negocio en dos sitios, que es exactamente como se
// desincronizan las cosas.
//
// Y la consecuencia que lo hace seguro: el cliente web NUNCA escribe en las
// tablas reales, solo en un buzón desechable. Un bug ahí no puede corromper
// nada — como mucho deja una orden que no se aplica.

// De dónde sale un juego del catálogo. Mismo vocabulario que GameSource en
// types.ts, repetido aquí a propósito: este fichero es el contrato del buzón y
// no debe arrastrar el grafo de tipos del main para que lo lea un Worker.
export type MailboxGameSource = { igdbId: number } | { steamAppId: number };

// PAYLOAD JSON DESDE EL MINUTO UNO (§6.4). El "alta de juego normal con sus
// gastos" que el §1.1 deja para más adelante es AMPLIAR este payload, no
// reescribir el mecanismo. Merece la pena aunque hoy solo se use para el Plan.
export type PlanMailboxEntry =
  | {
      type: 'add';
      source: MailboxGameSource;
      // Solo para poder enseñar algo mientras está pendiente: el título de
      // verdad lo resuelve el enriquecimiento al drenar.
      title: string;
      coverUrl: string | null;
      note: string | null;
    }
  // Fijar y soltar del "Up next". Van por el buzón igual que el alta aunque
  // sean un UPDATE de una columna: la regla del §6.2 es que la web no toca las
  // tablas reales, y una excepción "porque esto es fácil" es justo por donde
  // se cuela el primer bug que sí corrompe.
  | { type: 'pin'; gameId: number; pinnedAt: number }
  | { type: 'unpin'; gameId: number }
  // Reordenar el Up next. Viaja como UNA entrada con el orden entero y no como
  // N pines sueltos: es un solo gesto del usuario, y partirlo permitiría
  // drenar la mitad y dejar un orden que nadie pidió.
  //
  // Solo IDS, sin marcas de tiempo. La primera versión mandaba un `pinnedAt`
  // inventado por juego, y estaba mal por dos motivos: el escritorio ya tiene
  // reorderUpNext(), que REPARTE las marcas que ya existen sin inventar
  // ninguna ni derivar hacia el futuro; y mandar marcas desde el móvil dejaba
  // que un reorden fijara juegos que ya no estaban ni fijados ni planeados.
  // El orden es lo único que el móvil sabe; las fechas son cosa de quien las
  // tiene.
  | { type: 'reorder'; orderedIds: number[] };

export type PlanMailboxType = PlanMailboxEntry['type'];
