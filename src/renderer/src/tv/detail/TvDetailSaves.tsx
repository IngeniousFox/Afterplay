import { Check, CloudOff, CloudUpload, FileText, FolderOpen, TriangleAlert } from 'lucide-react';
import type { SaveBackupRow, SavesLocalState, TimeFormat } from '../../../../shared/types';
import { useGameSaves, useSavesStatus } from '../../hooks/saves';
import { useTimeFormat } from '../../hooks/settings';
import { AMBER, BLUE, GRAY, GREEN, TEAL } from '../../lib/colors';
import { formatByPrecision, formatBytes, pluralize } from '../../lib/format';
import { useTvFocusable } from '../focusContext';
import { tvRevealClass, tvRevealStyle } from '../styles';

// La pestaña Saves de la ficha del sofá — el SavesSection de escritorio en
// LECTURA ABSOLUTA: aquí no se detecta, no se respalda, no se restaura ni se
// toca un solo ajuste. Desde el sillón la única pregunta que importa es
// "¿están a salvo mis partidas?", y esta pantalla la contesta con los MISMOS
// datos que el escritorio (mismos hooks, misma caché de react-query): la nube
// sale del índice ya sincronizado (cero red) y lo local de un preview que no
// escribe nada.

// Cada estado de sincronización con su color e icono, calcado de la tabla del
// SavesSection de escritorio: verde = no tienes que hacer nada, ámbar = hay
// algo pendiente de subir, gris = aquí no hay nada que mirar.
const CHANGE_META: Record<string, { label: string; color: string; Icon: typeof CloudUpload }> = {
  new: { label: 'Not backed up yet', color: AMBER, Icon: CloudUpload },
  different: { label: 'Changes to back up', color: AMBER, Icon: CloudUpload },
  same: { label: 'Up to date', color: GREEN, Icon: Check },
  none: { label: 'No save files here', color: GRAY, Icon: CloudOff },
};

// Cuántas rutas se enseñan sin desbordar: esta columna comparte pantalla con
// el resto de la ficha y una lista de carpetas larga es exactamente lo que
// NO se viene a leer a una tele — el detalle fino vive en el escritorio.
const MAX_PATHS = 4;

// ¿`path` es la misma carpeta que `parent`, o cuelga de ella? La misma
// deduplicación por CONTENENCIA que el FoldersBlock de escritorio: la
// ubicación que deriva ludusavi suele colgar POR DEBAJO de la carpeta que
// eligió el usuario, y comparando strings salían dos filas para lo mismo —
// la segunda con una chapa AUTO falsa, porque esos archivos aparecen
// precisamente gracias a la carpeta añadida a mano.
const isWithin = (path: string, parent: string): boolean => {
  const a = path.toLowerCase();
  const b = parent.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
};

// El banner-héroe: LA respuesta de la pestaña, pintada antes de que haya que
// leer nada — degradado del color del estado sobre el cristal de la casa,
// chip con icono y la etiqueta en grande. Mismo recurso que el SyncHero de
// escritorio, a escala de sofá.
const SyncHero = ({ local }: { local: SavesLocalState }): React.JSX.Element => {
  const meta = CHANGE_META[local.change] ?? CHANGE_META.none;
  const Icon = meta.Icon;
  const registryKeys = local.registryKeys.length;
  return (
    <div
      className="relative flex items-center gap-[0.8em] overflow-hidden rounded-[0.6em] border border-white/[0.08] bg-black/70 px-[1em] py-[0.8em]"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
    >
      {/* El aliento del color del estado, desde la esquina del chip: el
          banner ES su color antes de ser su texto. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${meta.color}24, ${meta.color}08 55%, transparent)`,
        }}
      />
      <span
        className="relative flex h-[2.1em] w-[2.1em] flex-none items-center justify-center rounded-[0.5em]"
        style={{ background: `${meta.color}24`, boxShadow: `inset 0 0 0 1px ${meta.color}3d` }}
      >
        <Icon
          className="h-[1.15em] w-[1.15em]"
          style={{ color: meta.color, filter: `drop-shadow(0 0 0.5em ${meta.color}66)` }}
        />
      </span>
      <div className="relative min-w-0">
        <div className="truncate text-[0.95em] font-extrabold" style={{ color: meta.color }}>
          {meta.label}
        </div>
        <div className="mt-[0.1em] truncate text-[0.62em] font-semibold text-muted-foreground">
          {pluralize(local.files, 'file')} · {formatBytes(local.bytes)}
          {registryKeys > 0 && ` · +${pluralize(registryKeys, 'registry key')}`}
        </div>
      </div>
    </div>
  );
};

// Una ruta respaldada, en lectura: el nombre de la carpeta manda y la ruta
// padre queda de contexto en mono pequeñito — de una ruta larga truncada por
// la derecha lo único legible era justo lo que menos distingue. NO es
// clicable ni enfocable: abrir el Explorador es un gesto de escritorio.
const PathRowTv = ({
  path,
  tone,
  tag,
}: {
  path: string;
  tone: string;
  tag: string;
}): React.JSX.Element => {
  const name = path.slice(path.lastIndexOf('/') + 1) || path;
  const parent = path.slice(0, path.lastIndexOf('/'));
  // Fichero suelto (memory card de emulador) o carpeta: se decide por la
  // extensión y no preguntándole al disco — esto es solo el icono, y una
  // ruta que ya no existe también tiene que poder verse.
  const isFile = /\.[a-z0-9]{1,6}$/i.test(name);
  const Icon = isFile ? FileText : FolderOpen;
  return (
    <div
      className="flex items-center gap-[0.5em] rounded-[0.45em] px-[0.6em] py-[0.4em]"
      style={{ background: `${tone}0d`, boxShadow: `inset 0 0 0 1px ${tone}2e` }}
    >
      <span
        className="flex h-[1.4em] w-[1.4em] flex-none items-center justify-center rounded-[0.3em]"
        style={{ background: `${tone}1f` }}
      >
        <Icon className="h-[0.75em] w-[0.75em]" style={{ color: tone }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[0.45em]">
          <span className="truncate text-[0.65em] font-bold text-foreground/90">{name}</span>
          <span
            className="flex-none rounded-full px-[0.6em] py-[0.06em] text-[0.48em] font-bold tracking-[.08em]"
            style={{ background: `${tone}26`, color: tone }}
          >
            {tag}
          </span>
        </span>
        <span className="block truncate font-mono text-[0.5em] text-muted-foreground/80">
          {parent}
        </span>
      </span>
    </div>
  );
};

// Fila de versión en LECTURA, con el lenguaje exacto de SessionRowTv:
// enfocable solo para que el stick recorra y la lista haga scroll (sin
// onSelect — el motor silencia A sobre ella), y la luz del foco DENTRO de la
// fila (background suave + anillo interior), porque la lista recorta.
const VersionRowTv = ({
  version,
  index,
  latest,
  timeFormat,
}: {
  version: SaveBackupRow;
  index: number;
  latest: boolean;
  timeFormat: TimeFormat;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({});
  return (
    <div
      ref={ref}
      className={`rounded-[0.45em] px-[0.6em] py-[0.45em] transition-[background-color,box-shadow] duration-150 ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(index),
        ...(focused
          ? {
              background: 'rgba(133,163,214,.09)',
              boxShadow: 'inset 0 0 0 1px rgba(133,163,214,.32)',
            }
          : undefined),
      }}
    >
      <div className="flex items-center gap-[0.5em] text-[0.68em]">
        {/* Con hora, no solo fecha: dos copias del mismo día es el caso
            NORMAL (una por sesión) y sin hora la lista era una columna de
            fechas repetidas. */}
        <span className="truncate font-bold text-foreground/85 tabular-nums">
          {formatByPrecision(version.createdAt, 'datetime', timeFormat)}
        </span>
        {latest && (
          <span
            className="flex-none rounded-full px-[0.6em] py-[0.06em] text-[0.68em] font-bold tracking-[.08em]"
            style={{ background: `${BLUE}26`, color: BLUE }}
          >
            LATEST
          </span>
        )}
      </div>
      <div className="mt-[0.1em] truncate text-[0.6em] font-semibold text-muted-foreground tabular-nums">
        {formatBytes(version.sizeBytes)} · {version.machineName}
        {version.differential && ' · incremental'}
      </div>
    </div>
  );
};

// La lista de versiones, como bloque aparte porque vive en DOS ramas: la
// normal y la de motor caído — que falte el binario o las claves R2 no puede
// esconder si tus partidas siguen en la nube (el índice es local y
// sincronizado, enseñarlo no cuesta ni una llamada).
const VersionsBlock = ({
  versions,
  timeFormat,
  revealIndex,
}: {
  versions: SaveBackupRow[];
  timeFormat: TimeFormat;
  revealIndex: number;
}): React.JSX.Element => (
  <div
    className={`flex min-h-0 flex-1 flex-col ${tvRevealClass}`}
    style={tvRevealStyle(revealIndex)}
  >
    <div className="flex-none text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
      VERSIONS
    </div>
    {versions.length === 0 ? (
      <div className="mt-[0.4em] rounded-[0.45em] border border-dashed border-white/[0.14] px-[0.8em] py-[0.6em] text-[0.65em] text-muted-foreground">
        Nothing in the cloud yet.
      </div>
    ) : (
      <div className="relative mt-[0.35em] min-h-0 flex-1">
        <div
          className="flex h-full flex-col gap-[0.15em] overflow-y-auto pb-[0.8em]"
          style={{ scrollbarWidth: 'none' }}
        >
          {versions.map((version, index) => (
            <VersionRowTv
              key={version.id}
              version={version}
              index={index}
              latest={index === 0}
              timeFormat={timeFormat}
            />
          ))}
        </div>
        {/* La lista se funde contra el borde: pista de que hay más abajo. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[0.9em] bg-gradient-to-t from-black/50 to-transparent"
        />
      </div>
    )}
  </div>
);

export const TvDetailSaves = ({ gameId }: { gameId: number }): React.JSX.Element => {
  const { data: status } = useSavesStatus();
  // Mismo criterio que el escritorio: el estado se pide en cuanto se sabe si
  // la función existe, no solo cuando TODO está listo — si falta el binario,
  // las versiones que ya están en la nube siguen siendo lo primero que uno
  // quiere ver. Misma queryKey que la ficha de escritorio: caché compartida.
  const { data: state, isLoading } = useGameSaves(gameId, Boolean(status));
  const { data: timeFormat = '24h' } = useTimeFormat();

  const ready = status?.ready ?? false;
  const cloudCount = state?.cloud.length ?? 0;

  // Las rutas, deduplicadas por contenencia (ver isWithin) y unificadas en
  // una sola lista para poder cortar en MAX_PATHS contando las dos clases.
  const detectedOnly = (state?.local?.locations ?? []).filter(
    (detected) => !(state?.customPaths ?? []).some((own) => isWithin(detected, own)),
  );
  const allPaths = [
    ...detectedOnly.map((path) => ({ path, tone: BLUE, tag: 'AUTO' })),
    ...(state?.customPaths ?? []).map((path) => ({ path, tone: TEAL, tag: 'YOURS' })),
  ];
  const visiblePaths = allPaths.slice(0, MAX_PATHS);
  const hiddenPaths = allPaths.length - visiblePaths.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-[0.7em]">
      {/* La cabecera con la identidad de la pestaña: el mismo chip azul de la
          card de escritorio, y la píldora con el recuento de la nube — el
          dato tranquilizador cabe en la cabecera. */}
      <div
        className={`flex flex-none items-center gap-[0.5em] ${tvRevealClass}`}
        style={tvRevealStyle(0)}
      >
        <span
          className="flex h-[1.5em] w-[1.5em] flex-none items-center justify-center rounded-[0.35em]"
          style={{ background: `${BLUE}1f`, boxShadow: `inset 0 0 0 1px ${BLUE}3d` }}
        >
          <CloudUpload
            className="h-[0.85em] w-[0.85em]"
            style={{ color: BLUE, filter: 'drop-shadow(0 0 0.45em rgba(133,163,214,.55))' }}
          />
        </span>
        <span className="text-[0.62em] font-extrabold tracking-[.18em] text-muted-foreground">
          SAVES
        </span>
        {cloudCount > 0 && (
          <span
            className="ml-auto flex-none rounded-full px-[0.7em] py-[0.15em] text-[0.55em] font-bold tabular-nums"
            style={{
              background: `${BLUE}1f`,
              color: BLUE,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.10)',
            }}
          >
            {cloudCount} in cloud
          </span>
        )}
      </div>

      {!status ? (
        // Aún sin saber si la función existe: nada que afirmar todavía. La
        // query es local e instantánea — esto no llega a verse en la práctica.
        <div className="text-[0.65em] text-muted-foreground">Checking…</div>
      ) : !ready ? (
        <>
          {/* Los textos EXACTOS del escritorio (§9.2): la pestaña se enseña
              deshabilitada con el motivo, no se esconde — y las versiones que
              ya están en la nube se pintan igual (índice local, cero red). */}
          <div
            className={`flex flex-none items-start gap-[0.6em] rounded-[0.6em] border border-white/[0.08] bg-black/70 px-[1em] py-[0.8em] ${tvRevealClass}`}
            style={{ ...tvRevealStyle(1), boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
          >
            <TriangleAlert
              className="mt-[0.15em] h-[1em] w-[1em] flex-none"
              style={{ color: AMBER }}
            />
            <span className="text-[0.68em] leading-relaxed text-muted-foreground">
              {!status.binaryAvailable
                ? 'The save-backup engine isn’t available in this install — an antivirus may have quarantined it. Everything else works as usual.'
                : 'Add your Cloudflare R2 keys in Settings → API & Sync to back up saves. Nothing is uploaded until then.'}
            </span>
          </div>
          {state && state.cloud.length > 0 && (
            <VersionsBlock versions={state.cloud} timeFormat={timeFormat} revealIndex={2} />
          )}
        </>
      ) : isLoading ? (
        <div className="text-[0.65em] text-muted-foreground">Checking…</div>
      ) : !state?.ludusaviName ? (
        // Sin detección no hay nada que vigilar — y arreglarlo (detectar,
        // elegir carpeta) son gestos de escritorio, así que se dice claro.
        <div
          className={`flex-none rounded-[0.6em] border border-dashed border-white/[0.16] px-[1em] py-[0.9em] text-[0.7em] leading-relaxed text-muted-foreground ${tvRevealClass}`}
          style={tvRevealStyle(1)}
        >
          Afterplay doesn’t know where this game keeps its saves yet. Set it up from your desk.
        </div>
      ) : (
        <>
          {state.local ? (
            <div className={`flex-none ${tvRevealClass}`} style={tvRevealStyle(1)}>
              <SyncHero local={state.local} />
            </div>
          ) : (
            // Sin nada local no hay comparación posible: se dice tal cual
            // (mismo texto que el escritorio), sin fingir un estado.
            <div
              className={`flex flex-none items-center gap-[0.6em] rounded-[0.6em] border border-dashed border-white/[0.14] px-[1em] py-[0.8em] text-[0.68em] text-muted-foreground ${tvRevealClass}`}
              style={tvRevealStyle(1)}
            >
              <CloudOff className="h-[1.1em] w-[1.1em] flex-none opacity-70" />
              Nothing on this PC — the game may not be installed here.
            </div>
          )}

          {/* El opt-in de subir a la nube, solo como ESTADO: encenderlo es
              una decisión de datos personales (§10.5) y se toma en el
              escritorio, no desde el sofá. */}
          <div
            className={`flex flex-none items-center gap-[0.6em] rounded-[0.6em] border border-white/[0.08] bg-black/70 px-[1em] py-[0.6em] ${tvRevealClass}`}
            style={{ ...tvRevealStyle(2), boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
          >
            <CloudUpload
              className="h-[0.9em] w-[0.9em] flex-none"
              style={{ color: state.enabled ? BLUE : 'var(--muted-foreground)' }}
            />
            <span className="flex-none text-[0.7em] font-bold text-foreground/85">
              Cloud backup
            </span>
            <span
              className="ml-auto min-w-0 truncate text-[0.62em] font-semibold"
              style={{ color: state.enabled ? BLUE : 'var(--muted-foreground)' }}
            >
              {state.enabled
                ? 'ON — runs when you close a session'
                : 'OFF — nothing leaves this PC'}
            </span>
          </div>

          {visiblePaths.length > 0 && (
            <div className={`flex-none ${tvRevealClass}`} style={tvRevealStyle(3)}>
              <div className="text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
                WHERE IT SAVES
              </div>
              <div className="mt-[0.35em] flex flex-col gap-[0.3em]">
                {visiblePaths.map(({ path, tone, tag }) => (
                  <PathRowTv key={path} path={path} tone={tone} tag={tag} />
                ))}
                {hiddenPaths > 0 && (
                  <div className="text-[0.58em] font-semibold text-white/30">
                    +{hiddenPaths} more
                  </div>
                )}
              </div>
            </div>
          )}

          <VersionsBlock versions={state.cloud} timeFormat={timeFormat} revealIndex={4} />
        </>
      )}
    </div>
  );
};
