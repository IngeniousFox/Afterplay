import { Check, Images, RefreshCw, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ImageCacheType, ImageCacheUsage } from '../../../../shared/types';
import {
  useCleanUnusedImages,
  useImageCacheUsage,
  useImageRedownloadActivity,
  useRedownloadImages,
} from '../../hooks/images';
import { AMBER, BLUE, GRAY, GREEN } from '../../lib/colors';
import { formatBytes } from '../../lib/format';
import { SettingsCard } from './SettingsCard';
import { UsageBreakdownBar } from './UsageBreakdownBar';
import type { UsageSegment } from './UsageBreakdownBar';

// Ajustes → Images: qué ocupa en tu disco lo que la app se ha ido bajando, y
// las dos únicas cosas que se pueden querer hacer con ello — tirar lo que ya
// no apunta a nada, o volver a bajarlo todo.
//
// Todo local: estas carpetas viven en userData y no viajan a Turso. Nada de
// lo que hagan estos botones puede perder un dato tuyo, solo copias de cosas
// que están en internet.

// Un color por carpeta. Las tres primeras son las que se quedan, con el
// color que ya tienen esas cosas en el resto de la app; las capturas van en
// GRIS a propósito, porque son las prescindibles — así el trozo de barra que
// la limpieza se va a llevar se reconoce de un vistazo, sin leer nada. (Antes
// eran violeta, y a ese tamaño no había quien lo distinguiera del azul de los
// heroes: 650 MB y 146 MB parecían el mismo bloque.)
const FOLDERS: { type: ImageCacheType; label: string; color: string }[] = [
  { type: 'covers', label: 'Covers', color: GREEN },
  { type: 'heroes', label: 'Heroes', color: BLUE },
  { type: 'achievements', label: 'Achievements', color: AMBER },
  { type: 'screenshots', label: 'Screenshots', color: GRAY },
];

const buttonClass =
  'flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

const BAR_CLASS = 'flex h-2.5 gap-0.5 overflow-hidden rounded-full';

// Lo que dura la confirmación de la limpieza antes de devolverle el renglón
// al estado real. Suficiente para leerla sin buscarla, corto para que no se
// quede a vivir ahí (que es justo lo que pasaba cuando no caducaba nunca).
const CONFIRMATION_MS = 5000;

// El reparto por carpeta, con la clave de cada segmento siendo su tipo — la
// barra y su leyenda (con el hover sincronizado de Status Breakdown) viven
// en UsageBreakdownBar, compartida con Local copies.
const segmentsOf = (usage: ImageCacheUsage): UsageSegment[] =>
  FOLDERS.map((folder) => ({
    key: folder.type,
    label: folder.label,
    color: folder.color,
    bytes: usage.byType.find((entry) => entry.type === folder.type)?.bytes ?? 0,
  })).filter((segment) => segment.bytes > 0);

// Mientras se redescarga, la barra de reparto deja su sitio a la de progreso:
// es el mismo hueco y la misma forma, así que la tarjeta no da un salto al
// empezar ni al terminar.
const RedownloadBar = ({ done, total }: { done: number; total: number }): React.JSX.Element => (
  <div className={`${BAR_CLASS} bg-white/[0.06]`}>
    <div
      className="h-full rounded-full transition-[width] duration-500 ease-out"
      style={{ width: `${total === 0 ? 0 : (done / total) * 100}%`, background: AMBER }}
    />
  </div>
);

export const ImagesSection = (): React.JSX.Element => {
  const { data: usage } = useImageCacheUsage();
  const clean = useCleanUnusedImages();
  const redownload = useRedownloadImages();
  const progress = useImageRedownloadActivity();

  // El evento manda sobre la mutación: la pasada sigue viva aunque cierres y
  // reabras Ajustes, y entonces `redownload.isPending` ya no sabe nada.
  const running = progress?.running ?? redownload.isPending;
  const busy = running || clean.isPending;
  const segments = usage ? segmentsOf(usage) : [];

  // La confirmación de la limpieza dura unos segundos y se va. Vivía en
  // `clean.data`, que no caduca: tras liberar 704 MB, el renglón se quedaba
  // con un "Freed 704 MB" fijo en el hueco donde el resto del tiempo pone
  // "704 MB reclaimable" — y con el botón ya deshabilitado al lado, eso se
  // lee como "quedan 704 MB por liberar" en vez de como "acabo de hacerlo".
  // Un resultado de un momento no puede ocupar para siempre el sitio del
  // estado; se enseña, se entiende y se quita.
  const [freed, setFreed] = useState<{ files: number; bytes: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Solo el desmontaje: cerrar Ajustes con la confirmación en pantalla no
  // debe dejar un temporizador apuntando a un componente que ya no existe.
  useEffect(() => () => clearTimeout(hideTimer.current ?? undefined), []);

  const handleClean = (): void => {
    clean.mutate(undefined, {
      onSuccess: (result) => {
        setFreed(result);
        clearTimeout(hideTimer.current ?? undefined);
        hideTimer.current = setTimeout(() => setFreed(null), CONFIRMATION_MS);
      },
    });
  };

  // La cifra a la derecha del titular. Es SIEMPRE el mismo sitio: lo que
  // sobra, o lo que va la pasada en marcha — el dato vivo de la tarjeta en un
  // solo renglón, en vez de una frase distinta cada vez.
  const badge = ((): { text: string; color: string; icon?: LucideIcon } | null => {
    // Antes ni clean.isError ni redownload.isError se miraban: un fallo (el
    // fichero bloqueado por el antivirus, disco lleno) devolvía el badge a
    // "reclaimable" como si nada hubiera pasado — parecía que el clic no
    // había servido de nada.
    const mutationError = clean.error ?? redownload.error;
    if (mutationError)
      return { text: `Failed — ${mutationError.message}`, color: 'var(--destructive)' };
    if (running && progress) {
      return { text: `${progress.done} / ${progress.total}`, color: AMBER };
    }
    if (clean.isPending) return { text: 'Cleaning up…', color: AMBER };
    // En verde y con el tic: lo que distingue "esto ya ha pasado" de "esto
    // te queda por hacer" no puede ser solo el tiempo verbal.
    if (freed) {
      return freed.files === 0
        ? { text: 'Nothing to free', color: 'var(--muted-foreground)', icon: Check }
        : { text: `Freed ${formatBytes(freed.bytes)}`, color: GREEN, icon: Check };
    }
    if (!usage) return null;
    return usage.unusedFiles > 0
      ? { text: `${formatBytes(usage.unusedBytes)} reclaimable`, color: AMBER }
      : { text: 'All in use', color: 'var(--muted-foreground)' };
  })();

  return (
    <SettingsCard
      layout="column"
      title="Images"
      // Corta a propósito: con los dos botones a la derecha, esta columna se
      // queda en media tarjeta, y la versión larga caía en seis renglones de
      // hilo. Lo que hacía falta explicar (que borrar no pierde nada) está
      // abajo, junto al botón que borra.
      description="Covers, heroes, achievement icons and screenshots, kept on your disk so the app works offline and instantly."
      icon={Images}
      color={BLUE}
      headerRight={
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={handleClean}
            disabled={busy || usage === undefined || usage.unusedFiles === 0}
            className={buttonClass}
          >
            <Trash2 size={14} />
            Clean up
          </button>
          <button
            type="button"
            onClick={() => redownload.mutate()}
            disabled={busy || (usage?.usedImages ?? 0) === 0}
            className={buttonClass}
          >
            <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
            {running ? 'Downloading…' : 'Redownload'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.75">
        {/* El peso primero, que es la pregunta que trae aquí a cualquiera
            ("¿cuánto me están ocupando?"). A 11px como el resto de renglones
            de estado de Ajustes: el número en negrita ya destaca lo justo
            dentro de una tarjeta pequeña, y un titular grande hacía que esta
            sección pesara más que las demás sin merecerlo. */}
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-foreground">
              {usage ? formatBytes(usage.totalBytes) : '—'}
            </span>
            <span className="text-muted-foreground">
              {usage ? `across ${usage.totalFiles.toLocaleString()} files` : 'measuring…'}
            </span>
          </div>
          {badge && (
            <span
              className="flex flex-none items-center gap-1 font-semibold tabular-nums"
              style={{ color: badge.color }}
            >
              {badge.icon && <badge.icon size={11} strokeWidth={3} />}
              {badge.text}
            </span>
          )}
        </div>

        {running && progress ? (
          <RedownloadBar done={progress.done} total={progress.total} />
        ) : segments.length > 0 ? (
          <UsageBreakdownBar segments={segments} />
        ) : (
          usage && (
            <div className="text-[11px] text-muted-foreground">
              Nothing cached yet — images download the first time you see them.
            </div>
          )
        )}

        {/* Lo que un botón que borra ficheros tiene la obligación de decir
            ANTES de que lo pulses. Las capturas se van siempre porque no
            salen de la base de datos: no hay forma de saber cuáles siguen
            valiendo, y vuelven solas al abrir la ficha del juego. */}
        <div className="text-[10.5px] leading-[1.45] text-muted-foreground/70">
          These are copies of things still online — cleaning up never loses anything. It removes
          what no game or achievement points to anymore, plus every screenshot.
        </div>
      </div>
    </SettingsCard>
  );
};
