import { useLayoutEffect, useMemo, useRef, useState } from 'react';

type HeatmapSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

type ActivityHeatmapProps = {
  sessions: HeatmapSession[];
  title?: string;
  // 'all' = últimas 52 semanas terminando hoy (actividad reciente); un año
  // concreto = ESE año entero (1 ene - 31 dic) — nada de mostrar siempre lo
  // mismo sin importar el filtro.
  year: 'all' | number;
  // Selector de año propio de esta card (Bloque 5F: Activity de un juego
  // individual tiene el suyo, independiente del de toda la página) — hueco
  // opcional en la cabecera, entre el título y la leyenda. Sin esto (Stats
  // global), el año ya lo decide el selector de la página entera.
  yearPicker?: React.ReactNode;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLING_WEEKS = 52;
const GAP_PX = 3;
const DAY_LABEL_WIDTH_PX = 26;

// Mismos 5 colores que el prototipo (Backlog.html, heatColor) — del blanco
// casi transparente al verde de acento sólido.
const LEVEL_COLORS = [
  'rgba(255,255,255,.045)',
  'rgba(47,220,126,.28)',
  'rgba(47,220,126,.48)',
  'rgba(47,220,126,.72)',
  'rgba(47,220,126,1)',
];

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const startOfDayMs = (date: Date): number => startOfDay(date).getTime();

// Sumar días vía setDate (no sumando milisegundos): al cruzar un cambio de
// hora (DST) un día "dura" 23h o 25h, y la aritmética en ms iría dejando la
// medianoche calculada una hora corrida — con lo que los días de la rejilla
// dejarían de casar con las claves reales (medianoche local) de las
// sesiones. setDate mantiene siempre las 00:00 locales.
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Lunes de la semana de `date` — semanas empiezan en lunes (SPEC: etiquetas
// Mon/Wed/Fri), a diferencia de getDay() de JS que empieza en domingo.
const mondayOf = (date: Date): Date => {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, diffToMonday));
};

// SPEC Bloque 5C — a diferencia del prototipo (datos de mentira: nivel
// aleatorio 0-4 por celda, y el mismo heatmap sin importar el año), aquí el
// nivel sale de horas REALES jugadas ese día, en relación al día más
// cargado de la ventana visible, y esa ventana cambia de verdad con el año
// elegido.
export const ActivityHeatmap = ({
  sessions,
  title = 'Activity',
  year,
  yearPicker,
}: ActivityHeatmapProps): React.JSX.Element => {
  // El tamaño de celda se calcula del ancho REAL del contenedor, medido con
  // ResizeObserver, y las pistas de la rejilla van en píxeles exactos. Nada
  // de columnas 1fr: una celda con aspect-ratio dentro de una pista 1fr
  // gana un ancho mínimo implícito (le "transfiere" la altura de la fila),
  // la rejilla no puede encoger por debajo de eso, y en ventanas estrechas
  // desbordaba la tarjeta.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = (): void => setContainerWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { cells, monthLabels, weeks } = useMemo(() => {
    const today = startOfDay(new Date());

    let rangeStart: Date;
    let rangeEnd: Date;
    if (year === 'all') {
      rangeEnd = today;
      rangeStart = mondayOf(addDays(today, -(ROLLING_WEEKS - 1) * 7));
    } else {
      // El año ENTERO aunque sea el actual y esté a medias — así el año en
      // curso tiene las mismas ~52-53 columnas que uno pasado (o que "All
      // Time") y las celdas salen del mismo tamaño en todas las vistas. Los
      // días que aún no han llegado simplemente quedan a nivel 0.
      rangeStart = mondayOf(new Date(year, 0, 1));
      rangeEnd = startOfDay(new Date(year, 11, 31));
    }

    // Días INCLUSIVOS del rango → semanas justas. (Redondeo porque un rango
    // que cruza un cambio de hora no es un múltiplo exacto de 24h.)
    const daysInclusive = Math.round((startOfDayMs(rangeEnd) - rangeStart.getTime()) / DAY_MS) + 1;
    const weeks = Math.max(1, Math.ceil(daysInclusive / 7));

    const secondsByDay = new Map<number, number>();
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      const dayMs = startOfDayMs(session.startedAt);
      if (dayMs < rangeStart.getTime() || dayMs > rangeEnd.getTime()) continue;
      secondsByDay.set(dayMs, (secondsByDay.get(dayMs) ?? 0) + (session.durationSec ?? 0));
    }

    const maxSeconds = Math.max(0, ...secondsByDay.values());

    const levelFor = (seconds: number): number => {
      if (seconds <= 0 || maxSeconds <= 0) return 0;
      const frac = seconds / maxSeconds;
      if (frac <= 0.25) return 1;
      if (frac <= 0.5) return 2;
      if (frac <= 0.75) return 3;
      return 4;
    };

    // Columna-mayor (semana a semana), 7 filas por columna — mismo orden que
    // el `grid-auto-flow:column` del prototipo.
    const cells: { level: number; dayMs: number }[] = [];
    const monthLabels: string[] = [];
    let previousMonth = -1;

    for (let week = 0; week < weeks; week++) {
      const weekStart = addDays(rangeStart, week * 7);
      const month = weekStart.getMonth();
      // La semana 0 puede ser un resto de un puñado de días del año/mes
      // ANTERIOR (alinear a lunes el 1 de enero puede caer a mitad de
      // semana, tirando para atrás hasta un lunes de diciembre) — un rótulo
      // para esa semana suelta no cabe al lado del siguiente mes real y se
      // solapan los dos textos, así que esa primera semana no lleva rótulo
      // si de verdad es solo un resto de fuera del año pedido.
      const isLeadingSpillover = week === 0 && year !== 'all' && weekStart.getFullYear() !== year;
      monthLabels.push(
        !isLeadingSpillover && month !== previousMonth
          ? weekStart.toLocaleDateString('en-US', { month: 'short' })
          : '',
      );
      previousMonth = month;

      for (let day = 0; day < 7; day++) {
        const dayDate = addDays(weekStart, day);
        const dayMs = dayDate.getTime();
        // Fuera del rango real (el futuro del año en curso, o el resto de
        // diciembre anterior que se cuela al alinear a lunes): nivel 0 a la
        // fuerza — se pinta igual de tenue que un día sin jugar, para que
        // la rejilla siempre se vea completa, pero nunca con datos que no
        // son de este año.
        const inRange =
          dayMs <= Math.min(rangeEnd.getTime(), today.getTime()) &&
          (year === 'all' || dayDate.getFullYear() === year);
        cells.push({ level: inRange ? levelFor(secondsByDay.get(dayMs) ?? 0) : 0, dayMs });
      }
    }

    return { cells, monthLabels, weeks };
  }, [sessions, year]);

  // Celda cuadrada que hace que la rejilla mida EXACTAMENTE el ancho del
  // contenedor: columnas = etiqueta de días + `weeks` semanas, con un hueco
  // de GAP_PX delante de cada semana.
  const cellPx =
    containerWidth > 0
      ? Math.max(4, (containerWidth - DAY_LABEL_WIDTH_PX - weeks * GAP_PX) / weeks)
      : 0;

  return (
    <div className="rounded-[14px] border border-border bg-card px-5.5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[14px] font-bold text-foreground">{title}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.75 text-[11px] text-muted-foreground">
            Less
            {LEVEL_COLORS.map((color) => (
              <span
                key={color}
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ background: color }}
              />
            ))}
            More
          </div>
          {yearPicker}
        </div>
      </div>

      <div ref={containerRef}>
        {cellPx > 0 && (
          <>
            {/* Fila de meses — mismas columnas de semana que la rejilla de
                abajo, con un hueco al principio del ancho de la columna de
                días. */}
            <div
              className="mb-1.5 grid text-[9.5px] whitespace-nowrap text-muted-foreground"
              style={{
                gridTemplateColumns: `${DAY_LABEL_WIDTH_PX}px repeat(${weeks}, ${cellPx}px)`,
                columnGap: GAP_PX,
                height: 14,
              }}
            >
              <span style={{ minWidth: 0 }} />
              {monthLabels.map((label, index) => (
                <span key={index} style={{ minWidth: 0, overflow: 'visible' }}>
                  {label}
                </span>
              ))}
            </div>

            {/* Rejilla ÚNICA (columna de días + celdas) — al compartir el
                mismo grid, las filas se alinean solas entre las dos partes;
                con dos contenedores separados (flex aparte para los días) se
                desincronizaban fila a fila según avanzaba hacia abajo. */}
            <div
              className="grid grid-flow-col"
              style={{
                gridTemplateColumns: `${DAY_LABEL_WIDTH_PX}px repeat(${weeks}, ${cellPx}px)`,
                gridTemplateRows: `repeat(7, ${cellPx}px)`,
                gap: GAP_PX,
              }}
            >
              {DAY_LABELS.map((label, index) => (
                <span
                  key={`day-${index}`}
                  className="flex items-center text-[9.5px] leading-none text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {cells.map((cell) => (
                <div
                  key={cell.dayMs}
                  className="rounded-[3px]"
                  style={{ background: LEVEL_COLORS[cell.level] }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
