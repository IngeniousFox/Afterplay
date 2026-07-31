import { Delete, Search, Space, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GameCover } from '../components/GameCover';
import { TV_MODAL_SWALLOW, useTvButtons, useTvLegend } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable, useTvLayerIsActive } from './focusContext';
import { useTvInputDevice } from './inputDevice';
import { tvSound } from './sound';

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
const ROW_STAGGER = ['0em', '0.75em', '1.15em', '1.9em'];

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
      // KEYCAP de verdad: luz cenital (gradiente claro→oscuro), hairline
      // interior y un CANTO sólido abajo — la tecla tiene grosor. Al
      // enfocarse se levanta (translate) y el canto crece con ella; el
      // active: del ratón la hunde. Nunca scale (lección Chromium).
      className="relative flex h-[2.1em] items-center justify-center overflow-hidden rounded-[0.42em] text-[0.85em] font-bold transition-[background-color,color,box-shadow,translate] duration-150 active:translate-y-[0.06em]"
      style={{
        width: width ?? '2.1em',
        ...(focused
          ? {
              background: 'linear-gradient(180deg, rgba(47,220,126,.3), rgba(47,220,126,.12))',
              color: '#eafff3',
              textShadow: '0 0 0.6em rgba(47,220,126,.8)',
              translate: '0 -0.12em',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,.16), 0 0.16em 0 rgba(10,52,28,.5), 0 0.45em 1.1em rgba(47,220,126,.24), 0 0.35em 0.9em rgba(0,0,0,.3)',
            }
          : accent
            ? {
                background: 'linear-gradient(180deg, rgba(47,220,126,.13), rgba(47,220,126,.05))',
                color: '#8fe8b8',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,.08), inset 0 0 0 1px rgba(47,220,126,.24), 0 0.09em 0 rgba(10,42,24,.4), 0 0.16em 0.4em rgba(0,0,0,.2)',
              }
            : {
                // Cristal ligero, no baldosa: luz cenital tenue y un canto
                // FINO — la tecla insinúa grosor sin parecer de granito.
                background:
                  'linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.022))',
                color: 'var(--foreground)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,.07), inset 0 0 0 1px rgba(255,255,255,.045), 0 0.09em 0 rgba(0,0,0,.26), 0 0.16em 0.4em rgba(0,0,0,.16)',
              }),
      }}
    >
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.42em]"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(47,220,126,.9)' }}
        />
      )}
      {/* El flash de pulsación: nace encendido y se apaga (animate-out +
          forwards, como en ScreenshotLightbox, para que no reaparezca al
          acabar). Vive DENTRO del overflow-hidden de la tecla. */}
      {pressCount > 0 && (
        <span
          key={pressCount}
          aria-hidden
          className="animate-out fade-out-0 fill-mode-forwards pointer-events-none absolute inset-0 rounded-[0.42em] duration-300"
          style={{
            background: 'radial-gradient(circle, rgba(47,220,126,.55), rgba(47,220,126,.12) 75%)',
          }}
        />
      )}
      {/* La letra crece un punto al enfocarse — la burbuja de los OSK de
          consola, en texto puro (sin arte que emborronar). */}
      <span className={`relative transition-[scale] duration-150 ${focused ? 'scale-125' : ''}`}>
        {children ?? label}
      </span>
    </button>
  );
};

export type TvKeyboardSuggestion = {
  id: number;
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
      className="animate-in fade-in-0 slide-in-from-bottom-1 relative flex min-w-0 items-center gap-[0.5em] overflow-hidden rounded-[0.5em] py-[0.28em] pr-[0.75em] pl-[0.28em] text-[0.7em] font-bold transition-[background-color,box-shadow,translate] duration-150"
      style={
        focused
          ? {
              background: 'linear-gradient(180deg, rgba(124,134,200,.28), rgba(124,134,200,.12))',
              color: '#e6eaff',
              translate: '0 -0.12em',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,.14), 0 0.3em 1em rgba(124,134,200,.3), 0 0.3em 0.8em rgba(0,0,0,.35)',
            }
          : {
              background: 'rgba(255,255,255,.05)',
              color: 'var(--foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
            }
      }
    >
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.5em]"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(124,134,200,.85)' }}
        />
      )}
      <GameCover
        url={suggestion.coverUrl}
        className="h-[2.1em] w-[1.5em] flex-none rounded-[0.3em]"
        iconSize={12}
      />
      <span className="relative max-w-[9em] min-w-0 truncate">{suggestion.label}</span>
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
  onSuggestion?: (id: number) => void;
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
    // TARJETA flotante, no losa de lado a lado: el teclado es una pieza que
    // levita sobre la pantalla — cristal oscuro, esquinas redondeadas por
    // los cuatro costados y aire alrededor. El posicionador de fuera centra
    // y lleva la animación de entrada/salida; la tarjeta pinta el material.
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-[3.3em] z-20 flex justify-center px-[4vw] ${
        closing
          ? 'animate-out slide-out-to-bottom-4 fade-out-0 fill-mode-forwards duration-200'
          : 'animate-in slide-in-from-bottom-6 fade-in-0 duration-300'
      }`}
    >
      <div
        // Sin backdrop-blur: el posicionador de fuera anima con transform y
        // el blur de dentro no muestrearía hasta el final (fondo ya casi
        // opaco — no se pierde nada).
        className="pointer-events-auto w-max max-w-full rounded-[1em] px-[1.4em] pt-[1em] pb-[1.1em]"
        style={{
          background: 'linear-gradient(180deg, rgba(19,22,20,.94), rgba(10,12,11,.97))',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,.08), inset 0 0 0 1px rgba(255,255,255,.06), 0 1.6em 4em rgba(0,0,0,.6), 0 0 2.5em rgba(47,220,126,.06)',
        }}
      >
        {/* El campo: barra oscura de escritura DE VERDAD — fondo hundido,
            texto grande y claro, el cursor parpadeando seco pegado al texto
            y el recuento a la derecha. Con texto, el aro se tiñe de verde:
            "estás filtrando". */}
        <div
          className="mb-[0.75em] flex w-full items-center gap-[0.55em] rounded-[0.55em] px-[0.85em] py-[0.55em] text-[1.05em] font-bold transition-[box-shadow] duration-200"
          style={{
            background: 'rgba(0,0,0,.45)',
            boxShadow:
              value.length > 0
                ? 'inset 0 0 0 1px rgba(47,220,126,.45), inset 0 0.15em 0.5em rgba(0,0,0,.5), 0 0 1.2em rgba(47,220,126,.1)'
                : 'inset 0 0 0 1px rgba(255,255,255,.12), inset 0 0.15em 0.5em rgba(0,0,0,.5)',
          }}
        >
          <Search
            className="h-[0.85em] w-[0.85em] flex-none"
            style={{ color: '#2fdc7e', filter: 'drop-shadow(0 0 0.4em rgba(47,220,126,.55))' }}
          />
          {value.length > 0 ? (
            <span className="min-w-0 truncate text-white">{value}</span>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground/60">{placeholder}</span>
          )}
          <span
            className="afterplay-tv-caret -ml-[0.15em] h-[1.15em] w-[3px] flex-none rounded-[1px] bg-[#7dffb5]"
            style={{ boxShadow: '0 0 0.5em rgba(47,220,126,.9)' }}
          />
          {hint !== undefined && (
            <span className="ml-auto flex-none pl-[0.6em] text-[0.58em] font-semibold text-muted-foreground/70 tabular-nums">
              {hint}
            </span>
          )}
        </div>

        {/* Las sugerencias: los primeros resultados COMO ATAJO — subes con el
          D-pad desde las teclas y entras directo a la ficha. La fila reserva
          su alto aunque no haya nada: el panel no da saltos al escribir. */}
        {suggestions !== undefined && (
          <div className="mx-auto mb-[0.6em] flex h-[2.4em] w-full max-w-[44em] items-center justify-center gap-[0.5em]">
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
          // Tres puntos respirando a destiempo mientras llega el layout del
          // sistema — un latido, no un "…" mudo.
          <div className="flex items-center justify-center gap-[0.4em] py-[1.2em]">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-[0.3em] w-[0.3em] animate-pulse rounded-full bg-muted-foreground/60"
                style={{ animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </div>
        ) : (
          // w-max + escalonado por fila: un teclado de verdad, no una parrilla
          // centrada de calculadora.
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 mx-auto flex w-max flex-col gap-[0.4em] duration-300">
            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="flex gap-[0.4em]"
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
            {/* La fila de acciones: limpiar · espacio (la barra ancha de
              verdad) · borrar · done en verde — el camino feliz, visible. */}
            <div className="flex gap-[0.4em]" style={{ paddingLeft: '1.15em' }}>
              <Key label="clear" width="3em" onSelect={clearAll}>
                <X className="h-[1em] w-[1em]" />
              </Key>
              <Key label="space" width="9.4em" onSelect={() => typeChar(' ')}>
                <Space className="h-[1em] w-[1em]" />
              </Key>
              <Key label="delete" width="3em" onSelect={backspace}>
                <Delete className="h-[1em] w-[1em]" />
              </Key>
              <Key label="done" width="4.6em" accent onSelect={requestClose}>
                done
              </Key>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
