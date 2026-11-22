import { Delete, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { TV_MODAL_SWALLOW, useTvButtons, useTvLegend } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable, useTvLayerIsActive } from './focusContext';
import { useTvInputDevice } from './inputDevice';
import { tvSound } from './sound';
import { tvButtonHalo, tvFocusHalo, tvFocusMotion, tvFocusScale } from './styles';
import { TvCoverArt } from './tvUi';
import type { GameId } from '../../../shared/entityIds';

// El teclado en pantalla del modo TV (BIG-PICTURE.md §7.4). Tonto a
// propósito — value/onChange/onClose y pintar teclas — para que el día que
// haga falta para las notas de sesión se enchufe tal cual. Las SUGERENCIAS
// son opcionales por el mismo motivo: la búsqueda de Library las pasa (con
// carátula, y elegir una te lleva directo a la ficha), otro uso puede no
// pasarlas y el teclado ni las menciona.
//
// LA DISTRIBUCIÓN ES LA DEL SISTEMA: navigator.keyboard.getLayoutMap()
// (Chromium) devuelve qué carácter produce cada tecla FÍSICA con el layout
// activo del SO — en un Windows en español, la tecla a la derecha de la L
// es la Ñ y así sale aquí, gratis y sin tablas propias. Si la API no está o
// falla, el fallback es el QWERTY español (con ñ), que es el teclado de
// casa. Sin tildes en ambos casos: la búsqueda normaliza acentos
// (TvLibrary), así que cada tecla extra sería fricción sin función.

// Teclas físicas por fila (códigos W3C) — la forma del teclado; el layout
// del sistema decide qué letra vive en cada una.
const PHYSICAL_ROWS: string[][] = [
  [
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
    'Digit0',
  ],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Minus'],
];

const SPANISH_FALLBACK: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
];

// El escalonado de máquina de escribir: cada fila arranca un poco más a la
// derecha que la anterior — sin él, cuatro filas de 10 centradas parecen
// una calculadora, no un teclado.
const ROW_STAGGER = ['0em', '0em', '0.95em', '1.9em'];

type KeyboardLayoutApi = {
  keyboard?: { getLayoutMap: () => Promise<Map<string, string>> };
};

// Solo teclas que producen UN carácter imprimible: una tecla muerta o de
// función del layout raro de turno no pinta nada útil en un OSK.
const isPrintable = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length === 1 && value.trim().length === 1;

const loadSystemRows = async (): Promise<string[][]> => {
  const keyboard = (navigator as Navigator & KeyboardLayoutApi).keyboard;
  if (!keyboard?.getLayoutMap) return SPANISH_FALLBACK;
  try {
    const layout = await keyboard.getLayoutMap();
    const rows = PHYSICAL_ROWS.map((row) =>
      row.map((code) => layout.get(code)).filter(isPrintable),
    );
    // Un layout que no llene lo básico (letras de las filas centrales) no es
    // de fiar — mejor el teclado de casa que uno a medias.
    if (rows[1].length < 8 || rows[2].length < 8) return SPANISH_FALLBACK;
    return rows.map((row) => row.map((char) => char.toLowerCase()));
  } catch {
    return SPANISH_FALLBACK;
  }
};

// Cuánto dura la salida del panel — la misma constante gobierna la clase
// (duration-200) y el setTimeout que espera antes de desmontar de verdad
// (patrón ScreenshotLightbox: un número, no dos que se desincronicen).
const CLOSE_DURATION_MS = 200;

const Key = ({
  label,
  width,
  accent = false,
  autoFocus = false,
  onSelect,
  children,
}: {
  label: string;
  // Ancho explícito para las teclas de la fila de acciones; sin él, la
  // tecla cuadrada estándar.
  width?: string;
  // La tecla "primaria" (done): verde también en reposo — el camino feliz
  // se ve antes de enfocarlo.
  accent?: boolean;
  autoFocus?: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}): React.JSX.Element => {
  // Contador de pulsaciones: cada pulsación remonta (key=pressCount) el velo
  // de luz de abajo y relanza su fundido — el "clac" visual de una tecla de
  // verdad, sin tocar lo que la tecla HACE.
  const [pressCount, setPressCount] = useState(0);
  const press = (): void => {
    setPressCount((count) => count + 1);
    onSelect();
  };
  const { ref, focused } = useTvFocusable({ onSelect: press, autoFocus });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      // Silencio en el reparto genérico: el clac de tecla suena en el embudo
      // de escritura (typeChar/backspace) — el confirmar de la casa sobre
      // cada letra convertiría escribir en una fanfarria.
      data-tv-sound="none"
      onClick={press}
      // La tecla de tvpwa-tv-library.png: Raised con borde, 92 × 84 a 1080p.
      // Enfocada: anillo ámbar con halo y sube 3 px (translate, sin escala:
      // las teclas van pegadas y escalarlas las montaría unas sobre otras).
      // El active: del ratón la hunde.
      className={cn(
        'relative flex h-[3.4em] items-center justify-center overflow-hidden rounded-md border text-[1.3em] font-medium active:translate-y-[0.06em]',
        tvFocusMotion,
        'transition-[translate,box-shadow,background-color,border-color,color]',
        accent
          ? 'border-phosphor bg-phosphor font-semibold text-ink'
          : 'border-line-strong bg-raised text-bone',
        focused && [
          '-translate-y-[0.1em] motion-reduce:translate-y-0',
          accent ? tvButtonHalo : ['border-phosphor text-phosphor', tvFocusHalo],
        ],
      )}
      style={{ width: width ?? '2.95em' }}
    >
      {/* El flash de pulsación: nace encendido y se apaga. Vive DENTRO del
          overflow-hidden de la tecla. */}
      {pressCount > 0 && (
        <span
          key={pressCount}
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-[fade-in_300ms_var(--ease-out)_reverse_both] bg-phosphor/25"
        />
      )}
      <span className="relative">{children ?? label}</span>
    </button>
  );
};

export type TvKeyboardSuggestion = {
  id: GameId;
  label: string;
  coverUrl: string | null;
};

// La sugerencia: carátula + título, vestida del violeta de la búsqueda.
// Elegirla es un ATAJO — te saltas el resto de letras y entras directo.
const SuggestionChip = ({
  suggestion,
  onSelect,
}: {
  suggestion: TvKeyboardSuggestion;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-[2.6em] min-w-0 items-center gap-[0.6em] rounded-md border border-line-strong bg-raised pr-[0.9em] pl-[0.3em] text-[1.02em] font-medium text-bone',
        tvFocusMotion,
        focused && ['border-phosphor', tvFocusScale, tvButtonHalo],
      )}
    >
      <TvCoverArt
        game={{ title: suggestion.label, coverUrl: suggestion.coverUrl }}
        className="w-[1.55em] flex-none text-[0.5em]"
      />
      <span className="min-w-0">{suggestion.label}</span>
    </button>
  );
};

type TvKeyboardProps = {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
  placeholder: string;
  // "N matches" en el campo — el panel tapa media parrilla, que el número
  // cuente lo que pasa detrás.
  hint?: string;
  // Presentes (aunque vacíen): la fila reserva su alto para que el panel no
  // dé saltos al aparecer/desaparecer resultados. Ausentes: ni se pinta.
  suggestions?: TvKeyboardSuggestion[];
  onSuggestion?: (id: GameId) => void;
};

// El wrapper solo abre la capa modal; la superficie vive DENTRO para poder
// preguntarle al motor si sigue siendo la capa activa (un panel de sesion
// puede aterrizar encima en cualquier momento).
export const TvKeyboard = (props: TvKeyboardProps): React.JSX.Element => (
  <TvFocusLayer>
    <KeyboardSurface {...props} />
  </TvFocusLayer>
);

const KeyboardSurface = ({
  value,
  onChange,
  onClose,
  placeholder,
  hint,
  suggestions,
  onSuggestion,
}: TvKeyboardProps): React.JSX.Element => {
  const [rows, setRows] = useState<string[][] | null>(null);
  // Fase de salida (patrón ScreenshotLightbox): el panel sigue montado con
  // las clases animate-out puestas durante CLOSE_DURATION_MS y solo entonces
  // llama al onClose real — renderizado condicional como está en TvLibrary,
  // no hay otra forma de que el cierre no sea un pop seco.
  const [closing, setClosing] = useState(false);
  const device = useTvInputDevice();
  // Gate de capa para el listener de captura: si un panel se apilo encima,
  // el OSK se calla — sin esto, sus letras seguian editando la query y un
  // Backspace con el campo vacio lo desmontaba DEBAJO del panel activo.
  const layerActive = useTvLayerIsActive();
  const layerActiveRef = useRef(layerActive);
  useEffect(() => {
    layerActiveRef.current = layerActive;
  });

  useEffect(() => {
    let cancelled = false;
    void loadSystemRows().then((loaded) => {
      if (!cancelled) setRows(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestClose = (): void => {
    if (closing) return; // ya en marcha — una segunda orden no la reinicia
    setClosing(true);
    setTimeout(onClose, CLOSE_DURATION_MS);
  };

  // Embudo único de escritura: con la salida en marcha ya no se edita — una
  // tecla que aterrice durante los 200ms del cierre no debe cambiar la query
  // que el usuario acaba de dar por buena.
  const typeChar = (char: string): void => {
    if (closing) return;
    // El clac vive AQUÍ, en el embudo: suena igual desde el mando, el click
    // y el teclado físico — y jamás durante el cierre.
    tvSound.key();
    onChange(value + char);
  };

  const backspace = (): void => {
    if (closing) return;
    if (value.length === 0) {
      requestClose();
      return;
    }
    tvSound.key();
    onChange(value.slice(0, -1));
  };

  const clearAll = (): void => {
    if (closing || value.length === 0) return;
    tvSound.key();
    onChange('');
  };

  // Atajos de mando estilo consola (§7.4): B CIERRA la búsqueda (conservando
  // lo escrito — como en cualquier consola, B es "salir de aquí", no una
  // goma de borrar), Y espacio, X también cierra. Borrar es de la tecla
  // Delete del propio teclado (o del Backspace físico). Registrados en la
  // pila del layout: mientras el OSK viva, estos ganan a los de la pantalla.
  useTvButtons({
    ...TV_MODAL_SWALLOW,
    b: requestClose,
    y: () => typeChar(' '),
    x: requestClose,
  });
  useTvLegend(
    device === 'gamepad'
      ? [
          { action: 'b', label: 'Close' },
          { action: 'y', label: 'Space' },
        ]
      : // Con teclado, F/X escriben letras (el capture se las queda antes de
        // que el espejo del shell pudiera traducirlas): anunciarlas seria
        // mentir. Esc cierra conservando el filtro; Backspace borra.
        [{ action: 'b', label: 'Close' }],
  );

  // El teclado físico escribe en el mismo campo (Moonlight lo reenvía): el
  // OSK es la vía del mando, no una cárcel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!layerActiveRef.current) return;
      // Esc con teclado CIERRA el teclado (conservando lo escrito) — borrar
      // es de Backspace. Antes Esc caía al 'b' del shell y borraba letra a
      // letra, que en un teclado físico es un gesto de otra cosa.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // preventDefault TAMBIÉN: stopImmediatePropagation solo frena otros
        // listeners, no la activación nativa — un Espacio con foco DOM en
        // una tecla clicada antes disparaba el click de ESA tecla en el
        // keyup (espacio + letra fantasma, dos clacs).
        event.preventDefault();
        event.stopImmediatePropagation();
        typeChar(event.key.toLowerCase());
      }
    };
    // Captura para adelantarse al espejo de flechas del layout (que ignora
    // letras igualmente, pero Backspace/Escape sí chocan).
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  return (
    // TARJETA flotante sobre la biblioteca atenuada: el posicionador de fuera
    // centra, pinta el velo y lleva la entrada/salida; la tarjeta es Overlay
    // con su sombra de modal (es lo que flota).
    <div
      className={cn(
        'absolute inset-0 z-20 flex items-end justify-center bg-scrim px-[4vw] pb-[3.4em]',
        closing
          ? 'animate-[fade-in_200ms_var(--ease-out)_reverse_both]'
          : 'animate-[fade-in_200ms_var(--ease-out)_both]',
      )}
    >
      <div
        className={cn(
          'w-max max-w-full rounded-md border border-line-strong bg-overlay px-[1.3em] pt-[1.1em] pb-[1.2em] shadow-modal',
          !closing && 'animate-dialog-in',
        )}
      >
        {/* El campo: hundido (Inset), texto grande, cursor ámbar pegado al
            texto y el recuento a la derecha. Con texto, borde Phosphor. */}
        <div
          className={cn(
            'mb-[0.9em] flex h-[2.9em] w-full items-center gap-[0.6em] rounded-md border bg-inset px-[0.9em] text-[1.35em] transition-colors duration-150',
            value.length > 0 ? 'border-phosphor shadow-focus-field' : 'border-edge',
          )}
        >
          <Search className="size-[0.8em] flex-none text-phosphor" />
          {value.length > 0 ? (
            <span className="min-w-0 truncate text-bone">{value}</span>
          ) : (
            <span className="min-w-0 truncate text-dust">{placeholder}</span>
          )}
          <span className="-ml-[0.3em] h-[1.1em] w-[0.12em] flex-none animate-[afterplay-tv-caret-blink_1.06s_step-end_infinite] rounded-[1px] bg-phosphor motion-reduce:animate-none" />
          {hint !== undefined && (
            <span className="ml-auto flex-none pl-[0.6em] text-[0.7em] text-dust tabular-nums">
              {hint}
            </span>
          )}
        </div>

        {/* Las sugerencias: los primeros resultados COMO ATAJO — subes con el
          D-pad desde las teclas y entras directo a la ficha. La fila reserva
          su alto aunque no haya nada: el panel no da saltos al escribir. */}
        {suggestions !== undefined && (
          <div className="mx-auto mb-[0.7em] flex h-[2.9em] w-full max-w-[52em] items-center justify-center gap-[0.6em]">
            {suggestions.map((suggestion) => (
              <SuggestionChip
                key={suggestion.id}
                suggestion={suggestion}
                onSelect={() => onSuggestion?.(suggestion.id)}
              />
            ))}
          </div>
        )}

        {rows === null ? (
          // Tres puntos mientras llega el layout del sistema.
          <div className="flex items-center justify-center gap-[0.4em] py-[1.2em]">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-[0.3em] animate-pulse-soft rounded-full bg-dust motion-reduce:animate-none"
                style={{ animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </div>
        ) : (
          // w-max + escalonado por fila: un teclado de verdad, no una parrilla
          // centrada de calculadora.
          <div className="mx-auto flex w-max animate-fade-in flex-col gap-[0.45em]">
            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="flex gap-[0.45em]"
                style={{ paddingLeft: ROW_STAGGER[rowIndex] }}
              >
                {row.map((char, charIndex) => (
                  <Key
                    key={char}
                    label={char}
                    autoFocus={rowIndex === 1 && charIndex === 0}
                    onSelect={() => typeChar(char)}
                  />
                ))}
              </div>
            ))}
            {/* La fila de acciones: limpiar · espacio · borrar · done en
              Phosphor — el camino feliz, visible. */}
            <div className="flex gap-[0.45em]" style={{ paddingLeft: '0.95em' }}>
              <Key label="clear" width="4.4em" onSelect={clearAll}>
                <X className="size-[0.85em]" />
              </Key>
              <Key label="space" width="16.2em" onSelect={() => typeChar(' ')}>
                <span className="text-[0.75em] text-dust">space</span>
              </Key>
              <Key label="delete" width="4.4em" onSelect={backspace}>
                <Delete className="size-[0.85em]" />
              </Key>
              <Key label="done" width="7.3em" accent onSelect={requestClose}>
                done
              </Key>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
