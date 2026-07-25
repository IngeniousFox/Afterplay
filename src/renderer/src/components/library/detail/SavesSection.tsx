import {
  Check,
  CloudOff,
  CloudUpload,
  FolderOpen,
  FolderPlus,
  HardDriveDownload,
  Loader2,
  Radar,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type {
  SaveBackupRow,
  SavesActivityEvent,
  SavesGameState,
  SavesStatus,
} from '../../../../../shared/types';
import { AMBER, BLUE, GRAY, GREEN, TEAL } from '../../../lib/colors';
import {
  useBackupNow,
  useDetectSaves,
  useGameSaves,
  useSaveBackupActivity,
  useSavesStatus,
  useAddSaveFolder,
  useRemoveSaveFolder,
  useSetRestoreTarget,
  useSetSaveBackupEnabled,
} from '../../../hooks/saves';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes, pluralize } from '../../../lib/format';
import { DeleteSaveBackupDialog } from './DeleteSaveBackupDialog';
import { RestoreSaveDialog } from './RestoreSaveDialog';

type SavesSectionProps = {
  gameId: number;
  gameTitle: string;
};

// Card "Saves" del sidebar de la ficha (PARTIDAS-GUARDADAS.md §10.4), al lado
// de Details y con su mismo lenguaje visual. Es el ÚNICO sitio de la app
// desde el que se restaura una partida: no hay restauración automática en
// ninguna parte — ni al arrancar, ni al detectar el juego, ni al pulsar Play
// (§10bis.0).
//
// El estado se calcula al abrir la ficha y de dos fuentes baratas: la nube
// sale del índice ya sincronizado por Turso (cero red) y lo local de un
// preview que no escribe nada. Ninguna comprobación de fondo.
export const SavesSection = ({ gameId, gameTitle }: SavesSectionProps): React.JSX.Element => {
  const { data: status } = useSavesStatus();
  const ready = status?.ready ?? false;
  // Se pide el estado en cuanto se sabe si la función está disponible, no
  // solo cuando TODO está listo. Si falta el binario (un antivirus se lo
  // llevó, §11.2) sigue habiendo algo importante que enseñar: las versiones
  // que ya están en la nube, que salen del índice de la BD y no necesitan
  // ludusavi para nada. Ocultarlas justo cuando algo va mal es lo contrario
  // de lo que hace falta — lo primero que uno quiere saber es si sus
  // partidas siguen ahí.
  const { data: state, isLoading } = useGameSaves(gameId, Boolean(status));

  const detect = useDetectSaves();
  const addFolder = useAddSaveFolder();
  const [restoring, setRestoring] = useState<SaveBackupRow | null>(null);

  const handlePickFolder = async (): Promise<void> => {
    const folder = await window.api.dialog.pickFolder();
    // El catch evita el unhandled rejection; addFolder.isError no se pinta
    // aparte porque el fallo realista (BD inaccesible) ya tumba la query de
    // estado entera.
    if (folder) await addFolder.mutateAsync({ gameId, folder }).catch(() => undefined);
  };

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      {/* Chip de color + título, el mismo lenguaje de identidad que
          SettingsCard y las cabeceras de los modales — aquí es lo que
          distingue esta card de la de Details, que va justo encima. */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-6 w-6 flex-none items-center justify-center rounded-md"
          style={{ background: `${BLUE}1f` }}
        >
          <CloudUpload size={13} style={{ color: BLUE }} />
        </div>
        <div className="flex-1 text-[13.5px] font-bold text-foreground">Saves</div>
        {state?.cloud.length ? (
          <span
            className="flex-none rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ background: `${BLUE}1f`, color: BLUE }}
          >
            {state.cloud.length} in cloud
          </span>
        ) : null}
      </div>

      <div className="mt-3.5">
        {!ready ? (
          <div className="flex flex-col gap-3.5">
            <DisabledNotice status={status} />
            {/* Restaurar SÍ necesita el motor, así que la lista va en modo
                lectura con el motivo. Pero la lista se ve. */}
            {state && state.cloud.length > 0 && (
              <VersionList
                gameId={gameId}
                versions={state.cloud}
                blockedReason={
                  status?.binaryAvailable === false
                    ? 'Restoring needs the save-backup engine, which is missing right now.'
                    : 'Add your R2 keys to restore these.'
                }
                onRestore={setRestoring}
              />
            )}
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
            Checking…
          </div>
        ) : !state?.ludusaviName ? (
          <NotDetected
            detecting={detect.isPending}
            picking={addFolder.isPending}
            notFound={detect.isSuccess && detect.data === null}
            onDetect={() => detect.mutate(gameId)}
            onPickFolder={handlePickFolder}
          />
        ) : (
          <Detected
            gameId={gameId}
            state={state}
            addingFolder={addFolder.isPending}
            onAddFolder={handlePickFolder}
            onRestore={setRestoring}
          />
        )}
      </div>

      {restoring && (
        <RestoreSaveDialog
          gameId={gameId}
          gameTitle={gameTitle}
          backup={restoring}
          currentTarget={state?.restoreTarget ?? null}
          open
          onOpenChange={(next) => {
            if (!next) setRestoring(null);
          }}
        />
      )}
    </div>
  );
};

// Las dos puertas de §9.2. La card se ENSEÑA igualmente (deshabilitada y con
// el motivo) en vez de ocultarse: si no existe nunca, no hay forma de
// descubrir que la app puede hacer esto.
const DisabledNotice = ({ status }: { status: SavesStatus | undefined }): React.JSX.Element => (
  <div className="text-[12px] leading-relaxed text-muted-foreground">
    {status && !status.binaryAvailable
      ? 'The save-backup engine isn’t available in this install — an antivirus may have quarantined it. Everything else works as usual.'
      : 'Add your Cloudflare R2 keys in Settings → API & Sync to back up saves. Nothing is uploaded until then.'}
  </div>
);

const NotDetected = ({
  detecting,
  picking,
  notFound,
  onDetect,
  onPickFolder,
}: {
  detecting: boolean;
  picking: boolean;
  notFound: boolean;
  onDetect: () => void;
  onPickFolder: () => void;
}): React.JSX.Element => (
  <div className="flex flex-col gap-2.5">
    <div className="text-[12px] leading-relaxed text-muted-foreground">
      Afterplay doesn&apos;t know where this game keeps its saves yet.
    </div>
    <div className="flex flex-col gap-1.5">
      <SidebarButton onClick={onDetect} disabled={detecting} icon={detecting ? Loader2 : Radar}>
        {detecting ? 'Looking up…' : 'Detect automatically'}
      </SidebarButton>
      <button
        type="button"
        onClick={onPickFolder}
        disabled={picking}
        className="flex items-center justify-center gap-1.5 rounded-[9px] py-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <FolderOpen size={12} />
        Choose the folder myself
      </button>
    </div>
    {notFound && (
      <Warning>
        Nothing matched this title — pick the folder yourself and it&apos;ll work the same.
      </Warning>
    )}
  </div>
);

// Cada estado con su color e icono, como StatusCard: el verde es "no tienes
// que hacer nada" y el ámbar "hay algo pendiente de subir". Es LA respuesta
// de esta card, así que se pinta como banner-héroe y no como una línea más.
const CHANGE_META: Record<string, { label: string; color: string; icon: typeof CloudUpload }> = {
  new: { label: 'Not backed up yet', color: AMBER, icon: CloudUpload },
  different: { label: 'Changes to back up', color: AMBER, icon: CloudUpload },
  same: { label: 'Up to date', color: GREEN, icon: Check },
  none: { label: 'No save files here', color: GRAY, icon: CloudOff },
};

// Banner-héroe del estado de sincronización — el mismo recurso que el banner
// de estado de StatusCard, a escala de sidebar: degradado del color del
// estado, chip con icono y la respuesta en grande. "¿Están a salvo mis
// partidas?" se contesta antes de leer nada.
const SyncHero = ({
  change,
  files,
  bytes,
  registryKeys,
}: {
  change: string;
  files: number;
  bytes: number;
  registryKeys: number;
}): React.JSX.Element => {
  const meta = CHANGE_META[change] ?? CHANGE_META.none;
  const Icon = meta.icon;
  return (
    <div
      className="flex items-center gap-2.75 rounded-[11px] px-3 py-2.75"
      style={{
        background: `linear-gradient(135deg, ${meta.color}1f, ${meta.color}08 60%, transparent)`,
        border: `1px solid ${meta.color}2e`,
      }}
    >
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
        style={{ background: `${meta.color}24`, border: `1px solid ${meta.color}3d` }}
      >
        <Icon size={17} style={{ color: meta.color }} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[14px] font-extrabold" style={{ color: meta.color }}>
          {meta.label}
        </div>
        <div className="mt-0.25 truncate text-[10.5px] text-muted-foreground">
          {pluralize(files, 'file')} · {formatBytes(bytes)}
          {registryKeys > 0 && ` · ${pluralize(registryKeys, 'registry key')}`}
        </div>
      </div>
    </div>
  );
};

const Detected = ({
  gameId,
  state,
  addingFolder,
  onAddFolder,
  onRestore,
}: {
  gameId: number;
  state: SavesGameState;
  addingFolder: boolean;
  onAddFolder: () => void;
  onRestore: (backup: SaveBackupRow) => void;
}): React.JSX.Element => {
  const setEnabled = useSetSaveBackupEnabled();
  const backupNow = useBackupNow();
  const activity = useSaveBackupActivity(gameId);
  const [flash, setFlash] = useState<{ text: string; color: string } | null>(null);

  const handleBackupNow = async (): Promise<void> => {
    setFlash(null);
    const result = await backupNow.mutateAsync(gameId).catch(() => null);
    if (!result) return;
    setFlash(
      result.uploaded > 0
        ? {
            text: `Backed up — ${pluralize(result.uploaded, 'new version')} in the cloud`,
            color: GREEN,
          }
        : { text: 'Nothing changed since the last backup.', color: 'var(--muted-foreground)' },
    );
    setTimeout(() => setFlash(null), 6000);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">
            {state.ludusaviName}
          </span>
          <span className="flex-none text-[10px] text-muted-foreground">
            {state.detectionSource === 'manual' ? 'manual' : 'auto'}
          </span>
        </div>

        {state.local ? (
          <div className="mt-2.5">
            <SyncHero
              change={state.local.change}
              files={state.local.files}
              bytes={state.local.bytes}
              registryKeys={state.local.registryKeys.length}
            />
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-dashed border-border px-3 py-2.5 text-[11.5px] text-muted-foreground">
            <CloudOff size={13} className="flex-none opacity-70" />
            Nothing on this PC — the game may not be installed here.
          </div>
        )}

        {state.local?.steamIdInPath && (
          <Warning>
            The path has your Steam account ID in it — it only carries over to a PC on the same
            account.
          </Warning>
        )}

        <FoldersBlock
          gameId={gameId}
          detectedLocations={state.local?.locations ?? []}
          ownPaths={state.customPaths}
          adding={addingFolder}
          isAuto={state.detectionSource === 'auto'}
          onAdd={onAddFolder}
        />
      </div>

      {/* Opt-in explícito, juego a juego (§10.5): subir partidas a un bucket
          es mover datos personales a un servicio externo y eso no se hace por
          defecto. */}
      <button
        type="button"
        onClick={() => setEnabled.mutate({ gameId, enabled: !state.enabled })}
        className="flex items-center gap-2 rounded-[9px] border px-2.75 py-2 text-left transition-colors duration-150"
        style={{
          borderColor: state.enabled ? `${BLUE}66` : 'var(--input)',
          background: state.enabled ? `${BLUE}12` : 'rgba(255,255,255,.02)',
        }}
      >
        <CloudUpload
          size={13}
          className="flex-none"
          style={{ color: state.enabled ? BLUE : 'var(--muted-foreground)' }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-foreground">Cloud backup</span>
          <span className="block text-[10.5px] text-muted-foreground">
            {state.enabled ? 'Runs when you close a session' : 'Off — nothing leaves this PC'}
          </span>
        </span>
        <span
          className="flex-none text-[10px] font-bold"
          style={{ color: state.enabled ? BLUE : 'var(--muted-foreground)' }}
        >
          {state.enabled ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* La copia automática que dispara el cierre de sesión ocurre entera en
          el main: sin este aviso, la ficha que tienes delante se quedaba con
          la foto de antes y no había forma de saber que algo estaba
          subiendo. */}
      {activity && <ActivityBanner activity={activity} />}

      <SidebarButton
        onClick={handleBackupNow}
        disabled={backupNow.isPending || !state.enabled}
        icon={backupNow.isPending ? Loader2 : CloudUpload}
      >
        {backupNow.isPending ? 'Backing up…' : 'Back up now'}
      </SidebarButton>
      {/* Pulsar el botón y que no pase NADA visible es peor que un error:
          cuando la partida no ha cambiado desde la última copia, ludusavi no
          genera versión nueva y sin este mensaje parece que el botón está
          roto. */}
      {flash && (
        <div className="text-[11px]" style={{ color: flash.color }}>
          {flash.text}
        </div>
      )}
      {backupNow.isError && (
        <div className="text-[11px] text-destructive">{backupNow.error.message}</div>
      )}

      <RestoreTargetRow gameId={gameId} target={state.restoreTarget} />

      <VersionList
        gameId={gameId}
        versions={state.cloud}
        blockedReason={state.running ? 'The game is running — close it before restoring.' : null}
        onRestore={onRestore}
      />
    </div>
  );
};

// TODAS las carpetas que se respaldan, en un solo bloque: las detectadas por
// el manifest (chapa AUTO) y las añadidas a mano (teal, con su X). Antes iban
// en dos listas separadas y una carpeta que fuera las dos cosas —detectada y
// elegida— salía DOS veces, una debajo de la otra. Aquí se deduplica: si
// coincide, manda la fila "tuya", que es la que se puede quitar.
//
// Cada fila se puede pulsar y abre la carpeta en el Explorador — es LA
// pregunta que uno se hace mirando esta lista ("¿qué hay ahí dentro?").
const FoldersBlock = ({
  gameId,
  detectedLocations,
  ownPaths,
  adding,
  isAuto,
  onAdd,
}: {
  gameId: number;
  detectedLocations: string[];
  ownPaths: string[];
  adding: boolean;
  isAuto: boolean;
  onAdd: () => void;
}): React.JSX.Element => {
  const removeFolder = useRemoveSaveFolder();

  // Se compara por CONTENENCIA, no por igualdad. La ubicación que deriva
  // ludusavi es la carpeta común de los archivos que encuentra, y esa suele
  // colgar por debajo de la que eligió el usuario: con "GSE Saves/3768760"
  // elegida a mano, lo detectado era "GSE Saves/3768760/remote". Comparando
  // strings salían dos filas para lo mismo, y la de abajo etiquetada AUTO —
  // una etiqueta falsa, porque esos archivos aparecen precisamente GRACIAS a
  // la carpeta que añadió él.
  const detectedOnly = detectedLocations.filter(
    (detected) => !ownPaths.some((own) => isWithin(detected, own)),
  );
  const hasAny = detectedOnly.length > 0 || ownPaths.length > 0;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {hasAny && (
        <div className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
          WHERE IT SAVES
        </div>
      )}

      {detectedOnly.map((path) => (
        <FolderRow key={path} path={path} tone={BLUE} tag="AUTO" />
      ))}

      {ownPaths.map((path) => (
        <FolderRow
          key={path}
          path={path}
          tone={TEAL}
          tag="YOURS"
          onRemove={
            removeFolder.isPending ? undefined : () => removeFolder.mutate({ gameId, folder: path })
          }
        />
      ))}

      {/* Botón de verdad, no un enlace de 10px: es la única salida cuando la
          detección automática no cubre dónde guarda un juego, y escondido
          equivale a no existir. */}
      <SidebarButton onClick={onAdd} disabled={adding} icon={adding ? Loader2 : FolderPlus}>
        {adding ? 'Adding…' : ownPaths.length > 0 ? 'Add another folder' : 'Add a folder of my own'}
      </SidebarButton>

      {ownPaths.length > 0 && isAuto && (
        <div className="text-[10px] leading-relaxed text-muted-foreground/80">
          Backed up on top of what Afterplay detects, registry included.
        </div>
      )}
    </div>
  );
};

// ¿`path` es la misma carpeta que `parent`, o cuelga de ella? Sin distinguir
// mayúsculas, que en Windows dan igual.
const isWithin = (path: string, parent: string): boolean => {
  const a = path.toLowerCase();
  const b = parent.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
};

// Una carpeta respaldada. El nombre de la carpeta manda (foreground, primero)
// y la ruta completa queda de contexto — en un sidebar de 368px lo único
// legible de una ruta larga truncada por la derecha era justo lo que menos
// distingue ("C:/Users/Lara/AppData/…").
const FolderRow = ({
  path,
  tone,
  tag,
  onRemove,
}: {
  path: string;
  tone: string;
  tag: string;
  onRemove?: () => void;
}): React.JSX.Element => {
  const name = path.slice(path.lastIndexOf('/') + 1) || path;
  const parent = path.slice(0, path.lastIndexOf('/'));

  return (
    <div
      className="group/folder flex items-center gap-2 rounded-[9px] border px-2.5 py-1.75 transition-colors duration-150"
      style={{ borderColor: `${tone}2e`, background: `${tone}0d` }}
    >
      <button
        type="button"
        onClick={() => window.api.saves.openPath(path)}
        title={`${path} — open in Explorer`}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-[7px]"
          style={{ background: `${tone}1f` }}
        >
          <FolderOpen size={12} style={{ color: tone }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11.5px] font-semibold text-foreground group-hover/folder:underline">
              {name}
            </span>
            <span
              className="flex-none rounded-full px-1.5 py-px text-[8.5px] font-bold tracking-[.08em]"
              style={{ background: `${tone}26`, color: tone }}
            >
              {tag}
            </span>
          </span>
          <span className="block truncate font-mono text-[9.5px] text-muted-foreground/80">
            {parent}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Stop backing up this folder"
          className="flex-none rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/folder:opacity-100 hover:text-destructive focus-visible:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};

// Las cuatro fases de una copia automática, contadas como se las cuenta a
// una persona: qué está pasando y si tiene que hacer algo.
const ACTIVITY_META: Record<
  SavesActivityEvent['phase'],
  { label: string; color: string; spinning: boolean }
> = {
  scheduled: { label: 'Session closed — backing up shortly', color: BLUE, spinning: true },
  uploading: { label: 'Uploading this save…', color: BLUE, spinning: true },
  done: { label: 'Backed up just now', color: GREEN, spinning: false },
  failed: {
    label: "Couldn't back up — it'll retry after your next session",
    color: AMBER,
    spinning: false,
  },
};

const ActivityBanner = ({ activity }: { activity: SavesActivityEvent }): React.JSX.Element => {
  const meta = ACTIVITY_META[activity.phase];
  return (
    <div
      className="flex items-start gap-1.75 rounded-[9px] border px-2.75 py-2 text-[11px] font-semibold"
      style={{ borderColor: `${meta.color}2e`, background: `${meta.color}0f`, color: meta.color }}
    >
      {meta.spinning ? (
        <Loader2 size={12} className="mt-0.5 flex-none animate-spin" />
      ) : activity.phase === 'done' ? (
        <Check size={12} className="mt-0.5 flex-none" />
      ) : (
        <TriangleAlert size={12} className="mt-0.5 flex-none" />
      )}
      <span className="min-w-0">
        {meta.label}
        {/* El motivo, en crudo. "No se pudo" a secas no permite arreglar
            nada: puede ser la red, las claves o el propio motor, y cada uno
            se resuelve de forma distinta. */}
        {activity.message && (
          <span
            className="mt-0.5 block font-normal opacity-80"
            style={{ overflowWrap: 'anywhere' }}
            title={activity.message}
          >
            {activity.message}
          </span>
        )}
      </span>
    </div>
  );
};

const SidebarButton = ({
  onClick,
  disabled,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: typeof CloudUpload;
  children: React.ReactNode;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center justify-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3 py-2 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
  >
    <Icon size={13} className={Icon === Loader2 ? 'animate-spin' : undefined} />
    {children}
  </button>
);

const Warning = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed"
    style={{ color: AMBER }}
  >
    <TriangleAlert size={11} className="mt-0.5 flex-none" />
    <span>{children}</span>
  </div>
);

// El destino personalizado de ESTA máquina (§10bis.5). No sincroniza: "aquí
// el juego está en la D" es un hecho de este PC, no del juego.
const RestoreTargetRow = ({
  gameId,
  target,
}: {
  gameId: number;
  target: string | null;
}): React.JSX.Element | null => {
  const setRestoreTarget = useSetRestoreTarget();
  if (!target) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-[9px] border px-2.5 py-2"
      style={{ borderColor: `${TEAL}2e`, background: `${TEAL}0f` }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[9.5px] font-bold tracking-[.12em]" style={{ color: `${TEAL}b3` }}>
          RESTORES TO
        </div>
        <div className="truncate font-mono text-[10.5px] text-foreground" title={target}>
          {target}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setRestoreTarget.mutate({ gameId, target: null })}
        className="flex-none rounded-md p-1 text-muted-foreground hover:bg-white/6 hover:text-foreground"
        title="Use the original paths again"
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );
};

// Cuántas versiones se ven sin desplegar. La retención son 3 completas + 5
// diferenciales POR MÁQUINA, así que con dos PCs la lista se va a dieciséis:
// demasiado para una columna lateral, y las de abajo casi nunca se miran.
const VISIBLE_VERSIONS = 4;

const VersionList = ({
  gameId,
  versions,
  blockedReason,
  onRestore,
}: {
  gameId: number;
  versions: SaveBackupRow[];
  // Motivo por el que restaurar no se puede AHORA (juego abierto, motor
  // ausente...). null = se puede.
  blockedReason: string | null;
  onRestore: (backup: SaveBackupRow) => void;
}): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [expanded, setExpanded] = useState(false);
  // Borrar una versión pasa por confirmación como todo lo destructivo de la
  // app. Y aquí hace más falta que en otros sitios: si de la copia elegida
  // cuelgan diferenciales, se van con ella — el diálogo lo dice antes.
  const [deleting, setDeleting] = useState<SaveBackupRow | null>(null);

  if (versions.length === 0) {
    return (
      <div className="rounded-[9px] border border-dashed border-border px-2.75 py-2 text-[11.5px] text-muted-foreground">
        Nothing in the cloud yet.
      </div>
    );
  }

  const visible = expanded ? versions : versions.slice(0, VISIBLE_VERSIONS);

  return (
    <div className="border-t border-white/5 pt-3.5">
      <div className="mb-2 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
        VERSIONS
      </div>

      {blockedReason && <Warning>{blockedReason}</Warning>}

      {/* Carril de tiempo: un raíl vertical con un punto por versión, como
          las tiras de viaje de PlaythroughPanel — la lista se lee como
          historia (de arriba/reciente a abajo/antigua), no como tabla. */}
      <div className="relative flex flex-col gap-1 pl-3.5">
        <span
          className="absolute top-3 bottom-3 left-[4.5px] w-px"
          style={{ background: 'var(--border)' }}
        />
        {visible.map((version, index) => (
          <div key={version.id} className="relative">
            <span
              className="absolute top-1/2 -left-3.5 h-2 w-2 -translate-y-1/2 rounded-full border"
              style={
                index === 0
                  ? { background: BLUE, borderColor: BLUE }
                  : { background: 'var(--card)', borderColor: 'var(--muted-foreground)' }
              }
            />
            <div
              className="group/version flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.75 transition-colors duration-150"
              // La más reciente va teñida: en una lista de fechas parecidas
              // es la que se busca el 90% de las veces, y así se encuentra
              // sin leer ninguna.
              style={
                index === 0
                  ? { borderColor: `${BLUE}2e`, background: `${BLUE}0f` }
                  : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
              }
            >
              <div className="min-w-0 flex-1">
                {/* Con hora, no solo fecha: dos copias del mismo día es el
                    caso NORMAL —una por sesión— así que sin la hora la lista
                    es una columna de fechas repetidas donde no se distingue
                    cuál es cuál. 'datetime' da "Jul 25, 2026 · 10:42". */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[11.5px] font-semibold text-foreground">
                    {formatByPrecision(version.createdAt, 'datetime', timeFormat)}
                  </span>
                  {index === 0 && (
                    <span
                      className="flex-none rounded-full px-1.5 py-px text-[8.5px] font-bold tracking-[.08em]"
                      style={{ background: `${BLUE}26`, color: BLUE }}
                    >
                      LATEST
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {formatBytes(version.sizeBytes)} · {version.machineName}
                  {version.differential && ' · incremental'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRestore(version)}
                disabled={blockedReason !== null}
                title="Restore this version…"
                className="flex-none rounded-md p-1.25 transition-colors duration-150 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: blockedReason ? 'var(--muted-foreground)' : BLUE }}
              >
                <HardDriveDownload size={13} />
              </button>
              {/* La papelera solo asoma al pasar por la fila: borrar de la
                  nube es lo que menos veces se hace aquí, y quieta a la vista
                  en cada fila convertía la lista en una hilera de papeleras. */}
              <button
                type="button"
                onClick={() => setDeleting(version)}
                title="Delete this version from the cloud"
                className="flex-none rounded-md p-1.25 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/version:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {versions.length > VISIBLE_VERSIONS && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {expanded ? 'Show fewer' : `Show ${versions.length - VISIBLE_VERSIONS} older`}
        </button>
      )}

      <DeleteSaveBackupDialog
        backup={deleting}
        gameId={gameId}
        versions={versions}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
};
