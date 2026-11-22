import { Check, CloudOff, CloudUpload, FileText, FolderOpen, TriangleAlert } from 'lucide-react';
import type { SaveBackupRow, SavesLocalState, TimeFormat } from '../../../../shared/types';
import { useGameSaves, useSavesStatus } from '../../hooks/saves';
import { useTimeFormat } from '../../hooks/settings';
import { cn } from '@/lib/utils';
import { formatByPrecision, formatBytes, pluralize } from '../../lib/format';
import { useTvFocusable } from '../focusContext';
import {
  tvFocusHalo,
  tvFocusMotion,
  tvLabelClass,
  tvPanelClass,
  tvRevealClass,
  tvRevealStyle,
} from '../styles';
import type { GameId } from '../../../../shared/entityIds';

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
type SyncTone = 'phosphor' | 'tube' | 'dust';

const CHANGE_META: Record<string, { label: string; tone: SyncTone; Icon: typeof CloudUpload }> = {
  new: { label: 'Not backed up yet', tone: 'phosphor', Icon: CloudUpload },
  different: { label: 'Changes to back up', tone: 'phosphor', Icon: CloudUpload },
  same: { label: 'Up to date', tone: 'tube', Icon: Check },
  none: { label: 'No save files here', tone: 'dust', Icon: CloudOff },
};

const TONE_TEXT: Record<SyncTone, string> = {
  phosphor: 'text-phosphor',
  tube: 'text-tube',
  dust: 'text-dust',
};
const TONE_TILE: Record<SyncTone, string> = {
  phosphor: 'bg-phosphor-tint text-phosphor',
  tube: 'bg-tube/15 text-tube',
  dust: 'bg-raised text-dust',
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
    <div className={cn('flex items-center gap-[1em] px-[1.2em] py-[1em]', tvPanelClass)}>
      <span
        className={cn(
          'flex size-[2.6em] flex-none items-center justify-center rounded-full',
          TONE_TILE[meta.tone],
        )}
      >
        <Icon className="size-[1.3em]" />
      </span>
      <div className="min-w-0">
        <div
          className={cn('font-display text-[1.7em] leading-none font-bold', TONE_TEXT[meta.tone])}
        >
          {meta.label}
        </div>
        <div className="mt-[0.3em] text-[0.92em] leading-snug text-dust">
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
const PathRowTv = ({ path, custom }: { path: string; custom: boolean }): React.JSX.Element => {
  const name = path.slice(path.lastIndexOf('/') + 1) || path;
  const parent = path.slice(0, path.lastIndexOf('/'));
  // Fichero suelto (memory card de emulador) o carpeta: se decide por la
  // extensión y no preguntándole al disco — esto es solo el icono, y una
  // ruta que ya no existe también tiene que poder verse.
  const isFile = /\.[a-z0-9]{1,6}$/i.test(name);
  const Icon = isFile ? FileText : FolderOpen;
  return (
    <div className={cn('flex items-center gap-[0.8em] px-[0.8em] py-[0.6em]', tvPanelClass)}>
      <span className="flex size-[2em] flex-none items-center justify-center rounded-sm bg-raised text-dust">
        <Icon className="size-[1.05em]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-[0.6em]">
          <span className="font-semibold text-bone">{name}</span>
          <span
            className={cn(
              'flex-none rounded-sm px-[0.5em] py-[0.05em] text-[0.85em] font-semibold',
              custom ? 'bg-phosphor-tint text-phosphor' : 'bg-tube/15 text-tube',
            )}
          >
            {custom ? 'Custom' : 'Detected'}
          </span>
        </span>
        <span className="block font-mono text-[0.85em] break-all text-dust">{parent}</span>
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
      className={cn(
        'border-b border-line px-[0.8em] py-[0.55em]',
        tvFocusMotion,
        focused && ['bg-raised', tvFocusHalo],
        tvRevealClass,
      )}
      style={tvRevealStyle(index)}
    >
      <div className="flex items-center gap-[0.6em]">
        {/* Con hora, no solo fecha: dos copias del mismo día es lo NORMAL. */}
        <span className="font-semibold text-bone tabular-nums">
          {formatByPrecision(version.createdAt, 'datetime', timeFormat)}
        </span>
        {latest && (
          <span className="flex-none rounded-sm bg-tube/15 px-[0.5em] py-[0.05em] text-[0.85em] font-semibold text-tube">
            LATEST
          </span>
        )}
      </div>
      <div className="mt-[0.1em] text-[0.92em] text-dust tabular-nums">
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
    className={cn('flex min-h-0 flex-1 flex-col', tvRevealClass)}
    style={tvRevealStyle(revealIndex)}
  >
    <div className={cn('flex-none', tvLabelClass)}>Versions</div>
    {versions.length === 0 ? (
      <div className="mt-[0.5em] rounded-md border border-dashed border-line-strong px-[0.9em] py-[0.7em] text-dust">
        Nothing in the cloud yet.
      </div>
    ) : (
      <div
        className="mt-[0.5em] flex min-h-0 flex-1 flex-col overflow-y-auto px-[0.6em] pt-[0.6em] pb-[0.8em]"
        style={{ scrollbarWidth: 'none', scrollPaddingTop: '0.6em', scrollPaddingBottom: '0.8em' }}
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
    )}
  </div>
);

export const TvDetailSaves = ({ gameId }: { gameId: GameId }): React.JSX.Element => {
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
    ...detectedOnly.map((path) => ({ path, custom: false })),
    ...(state?.customPaths ?? []).map((path) => ({ path, custom: true })),
  ];
  const visiblePaths = allPaths.slice(0, MAX_PATHS);
  const hiddenPaths = allPaths.length - visiblePaths.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-[0.8em] px-[0.6em]">
      <div
        className={cn('flex flex-none items-center gap-[0.8em]', tvRevealClass)}
        style={tvRevealStyle(0)}
      >
        <span className={tvLabelClass}>Saves</span>
        {cloudCount > 0 && (
          <span className="ml-auto flex-none rounded-sm bg-tube/15 px-[0.6em] py-[0.1em] text-[0.92em] font-semibold text-tube tabular-nums">
            {cloudCount} in cloud
          </span>
        )}
      </div>

      {!status ? (
        <div className="text-dust">Checking…</div>
      ) : !ready ? (
        <>
          {/* Los textos EXACTOS del escritorio (§9.2): la pestaña se enseña
              deshabilitada con el motivo, no se esconde. */}
          <div
            className={cn(
              'flex flex-none items-start gap-[0.7em] px-[1em] py-[0.9em]',
              tvPanelClass,
              tvRevealClass,
            )}
            style={tvRevealStyle(1)}
          >
            <TriangleAlert className="mt-[0.15em] size-[1.1em] flex-none text-phosphor" />
            <span className="leading-relaxed text-dust">
              {!status.binaryAvailable
                ? 'The save-backup engine isn’t available in this install — an antivirus may have quarantined it. Everything else works as usual.'
                : 'Add your Cloudflare R2 keys in Settings → Integrations to back up saves. Nothing is uploaded until then.'}
            </span>
          </div>
          {state && state.cloud.length > 0 && (
            <VersionsBlock versions={state.cloud} timeFormat={timeFormat} revealIndex={2} />
          )}
        </>
      ) : isLoading ? (
        <div className="text-dust">Checking…</div>
      ) : !state?.ludusaviName ? (
        <div
          className={cn(
            'flex-none rounded-md border border-dashed border-line-strong px-[1em] py-[0.9em] leading-relaxed text-dust',
            tvRevealClass,
          )}
          style={tvRevealStyle(1)}
        >
          Afterplay doesn’t know where this game keeps its saves yet. Set it up from your desk.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-[1.4em]">
          <div
            className="flex min-h-0 flex-col gap-[0.8em] overflow-y-auto px-[0.6em] pt-[0.6em] pb-[0.8em]"
            style={{ scrollbarWidth: 'none' }}
          >
            {state.local ? (
              <div className={cn('flex-none', tvRevealClass)} style={tvRevealStyle(1)}>
                <SyncHero local={state.local} />
              </div>
            ) : (
              <div
                className={cn(
                  'flex flex-none items-center gap-[0.7em] rounded-md border border-dashed border-line-strong px-[1em] py-[0.9em] text-dust',
                  tvRevealClass,
                )}
                style={tvRevealStyle(1)}
              >
                <CloudOff className="size-[1.1em] flex-none" />
                Nothing on this PC — the game may not be installed here.
              </div>
            )}

            {/* El opt-in de subir a la nube, solo como ESTADO: encenderlo se
                decide en el escritorio (§10.5). */}
            <div
              className={cn(
                'flex flex-none items-center gap-[0.7em] px-[1em] py-[0.7em]',
                tvPanelClass,
                tvRevealClass,
              )}
              style={tvRevealStyle(2)}
            >
              <CloudUpload
                className={cn('size-[1.1em] flex-none', state.enabled ? 'text-tube' : 'text-dust')}
              />
              <span className="flex-none font-semibold text-bone">Cloud backup</span>
              <span
                className={cn(
                  'ml-auto text-right text-[0.92em] font-semibold',
                  state.enabled ? 'text-tube' : 'text-dust',
                )}
              >
                {state.enabled
                  ? 'ON — runs when you close a session'
                  : 'OFF — nothing leaves this PC'}
              </span>
            </div>

            {visiblePaths.length > 0 && (
              <div className={cn('flex-none', tvRevealClass)} style={tvRevealStyle(3)}>
                <div className={tvLabelClass}>Where it saves</div>
                <div className="mt-[0.5em] flex flex-col gap-[0.5em]">
                  {visiblePaths.map(({ path, custom }) => (
                    <PathRowTv key={path} path={path} custom={custom} />
                  ))}
                  {hiddenPaths > 0 && (
                    <div className="text-[0.92em] font-semibold text-dust">+{hiddenPaths} more</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <VersionsBlock versions={state.cloud} timeFormat={timeFormat} revealIndex={4} />
        </div>
      )}
    </div>
  );
};
