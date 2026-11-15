// REPARAR DOS PLAYTHROUGHS EN CURSO (AFTERPLAY-2.0.md §10.7).
//
// Dos PCs sin red pueden abrir cada uno su playthrough del mismo juego. La
// ficha lo detecta (`iterations:concurrent`) y ofrece fusionarlos
// (`iterations:merge`). Estos son los tipos que cruzan el IPC, sin nada del
// esquema.

// Un playthrough activo cuando hay más de uno. `current` es el vigente: el de
// `syncCreated` más reciente, el que se queda por defecto.
export type ConcurrentPlaythrough = {
  readonly id: string;
  /** La etiqueta que enseña la app ("Playthrough 2" o la del usuario). */
  readonly label: string;
  readonly current: boolean;
};

export type MergePlaythroughsRequest = {
  /** El que se queda: recibe todo lo del otro. */
  readonly keepId: string;
  /** El sobrante: se borra tras mover todo. */
  readonly dropId: string;
};

export type MergePlaythroughsFailure =
  /** Alguno de los dos ya no existe (borrado aquí o en otro PC). */
  'not_found' | 'same_playthrough' | 'different_game';

export type MergePlaythroughsOutcome =
  | {
      readonly ok: true;
      readonly moved: {
        readonly sessions: number;
        readonly stateEvents: number;
        readonly spendEvents: number;
        readonly achievementUnlocks: number;
      };
    }
  | { readonly ok: false; readonly reason: MergePlaythroughsFailure; readonly message: string };
