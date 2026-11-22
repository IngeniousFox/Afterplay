import {
  Check,
  CloudOff,
  CloudUpload,
  FilePlus2,
  FileText,
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
  SaveSyncState,
  SaveTip,
} from '../../../../../shared/types';
import { cn } from '@/lib/utils';
import {
  ghostButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  textLinkClass,
} from '../../shell/controls';
import {
  useBackupNow,
  useClearSaveDetection,
  useDetectSaves,
  useGameSaves,
  useSaveBackupActivity,
  useSavesStatus,
  useAddSaveFolder,
  useRemoveSaveFolder,
  useSavesQueuedBehind,
  useSetRestoreTarget,
  useSetSaveBackupEnabled,
} from '../../../hooks/saves';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes, pluralize } from '../../../lib/format';
import { describeAgo } from '../../../lib/syncText';
import { DeleteSaveBackupDialog } from './DeleteSaveBackupDialog';
import { RestoreSaveDialog } from './RestoreSaveDialog';
import type { GameId } from '../../../../../shared/entityIds';
import { useOffscreenAnimation } from '../../../hooks/useOffscreenAnimation';
import { Glitch } from '../../fx/Glitch';
import { Stagger } from '../../fx/Stagger';

type SavesSectionProps = {
  gameId: GameId;
  gameTitle: string;
};

// La pestaña Saves de la ficha (PARTIDAS-GUARDADAS.md §10.4, ficha-saves.png):
// arriba el bloque de estado, debajo las versiones y a la derecha la copia en
// la nube y dónde guarda en este PC. Es el ÚNICO sitio de la app
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
  const queuedBehind = useSavesQueuedBehind(gameId);

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

  // Misma vía que la carpeta: lo que se guarda es una ruta, y a ludusavi le
  // da igual que apunte a un fichero o a un directorio (verificado con el
  // binario: un .mcd suelto se respalda igual que una carpeta). El botón
  // aparte existe porque el diálogo nativo del sistema SÍ es distinto — con
  // el de carpetas no se puede señalar un archivo.
  const handlePickFile = async (): Promise<void> => {
    const file = await window.api.dialog.pickFile();
    if (file) await addFolder.mutateAsync({ gameId, folder: file }).catch(() => undefined);
  };

  return (
    <div>
      <div>
        {!ready ? (
          <div className="flex max-w-240 flex-col gap-5">
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
                    : 'Add your cloud save credentials to restore these.'
                }
                onRestore={setRestoring}
              />
            )}
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-body text-dust">
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
            {queuedBehind ? `Waiting behind: ${queuedBehind}…` : 'Checking…'}
          </div>
        ) : !state?.ludusaviName ? (
          <div className="flex max-w-240 flex-col gap-5">
            <NotDetected
              detecting={detect.isPending}
              picking={addFolder.isPending}
              notFound={detect.isSuccess && detect.data === null}
              onDetect={() => detect.mutate(gameId)}
              onPickFolder={handlePickFolder}
            />
            {/* Un juego puede llegar aquí YA con versiones en la nube — quitar
                la última carpeta manual de un emparejamiento 'manual' lo
                devuelve a "sin detectar" (ver saves:removeFolder), pero las
                filas de save_backups siguen colgando del mismo gameId, no del
                ludusaviName que se acaba de soltar. Sin esto se volvían
                invisibles: ni restaurar, ni borrar, ni siquiera ver cuántas
                había — igual que ya hace la rama de arriba (!ready) cuando el
                motor no está listo. */}
            {state && state.cloud.length > 0 && (
              <VersionList
                gameId={gameId}
                versions={state.cloud}
                blockedReason={null}
                onRestore={setRestoring}
              />
            )}
          </div>
        ) : (
          <Detected
            gameId={gameId}
            state={state}
            addingFolder={addFolder.isPending}
            onAddFolder={handlePickFolder}
            onAddFile={handlePickFile}
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
  <div className="flex items-start gap-4 rounded-md border border-dashed border-line-strong px-5 py-4.5">
    <span className="flex size-11 flex-none items-center justify-center rounded-full bg-bone/6 text-dust ring-1 ring-line-strong">
      <CloudOff size={19} />
    </span>
    <div className="min-w-0">
      <div className="text-lead font-semibold text-bone">Save backups are off</div>
      <p className="mt-0.5 text-body text-dust">
        {status && !status.binaryAvailable
          ? 'The save-backup engine isn’t available in this install — an antivirus may have quarantined it. Everything else works as usual.'
          : 'Add cloud save credentials in Settings → Saves to back up saves. Nothing is uploaded until then.'}
      </p>
    </div>
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
  <div className="flex flex-col gap-3">
    <div className="text-body text-dust">
      Afterplay doesn&apos;t know where this game keeps its saves yet.
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <SidebarButton onClick={onDetect} disabled={detecting} icon={detecting ? Loader2 : Radar}>
        {detecting ? 'Looking up…' : 'Detect automatically'}
      </SidebarButton>
      <button
        type="button"
        onClick={onPickFolder}
        disabled={picking}
        className={cn(textLinkClass, 'flex items-center gap-1.5 disabled:opacity-50')}
      >
        <FolderOpen size={14} />
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

// Los tonos del bloque de estado (README-ficha.md): al día verde, cambios sin
// copiar ámbar, por detrás y disponible Tube, divergido Live, y "no sé decir"
// gris. Clases literales para que Tailwind las encuentre.
type Tone = 'success' | 'phosphor' | 'tube' | 'live' | 'dust';

const TONE_CLASS: Record<Tone, { box: string; chip: string; text: string }> = {
  success: {
    box: 'border-success/35 bg-success/6',
    chip: 'bg-success/14 text-success ring-success/35',
    text: 'text-success',
  },
  phosphor: {
    box: 'border-phosphor/40 bg-phosphor/6',
    chip: 'bg-phosphor/14 text-phosphor ring-phosphor/35',
    text: 'text-phosphor',
  },
  tube: {
    box: 'border-tube/40 bg-tube/6',
    chip: 'bg-tube/14 text-tube ring-tube/35',
    text: 'text-tube',
  },
  live: {
    box: 'border-live/45 bg-live/8',
    chip: 'bg-live/16 text-live ring-live/40',
    text: 'text-live',
  },
  dust: {
    box: 'border-line-strong bg-panel',
    chip: 'bg-bone/6 text-dust ring-line-strong',
    text: 'text-bone',
  },
};

type SyncMeta = { label: string; tone: Tone; icon: typeof CloudUpload };

// La respuesta de "¿están a salvo mis partidas?" cuando no hay copias en la
// nube con las que comparar: la comparación local de siempre.
const CHANGE_META: Record<string, SyncMeta> = {
  new: { label: 'Not backed up yet', tone: 'phosphor', icon: CloudUpload },
  different: { label: 'Changes to back up', tone: 'phosphor', icon: CloudUpload },
  same: { label: 'Up to date', tone: 'success', icon: Check },
  none: { label: 'No save files here', tone: 'dust', icon: CloudOff },
};

// El bloque de estado de arriba, con la misma forma siempre: icono en círculo
// del color del estado, la frase, el detalle y las acciones a la derecha.
const SyncHero = ({
  change,
  stats,
  sync,
  children,
}: {
  change: string;
  // null = no hay nada en este PC que contar (solo se enseña el estado).
  stats: { files: number; bytes: number; registryKeys: number } | null;
  sync: SaveSyncState;
  // Las acciones del estado (restaurar la versión de otro PC...).
  children?: React.ReactNode;
}): React.JSX.Element => {
  // Con estado entre PCs (§12.4) manda ese; si no hay copias en la nube
  // (status 'none') sigue valiendo la comparación local de siempre.
  const syncMeta = syncStatusMeta(sync);
  const meta = syncMeta ?? CHANGE_META[change] ?? CHANGE_META.none;
  const tone = TONE_CLASS[meta.tone];
  const Icon = meta.icon;
  // Hay algo que hacer (copiar cambios, traer una versión): el chip late
  // suave. Divergido: un glitch al entrar en el estado, no en bucle.
  const pending = meta.tone === 'phosphor' || meta.tone === 'tube';
  const conflict = meta.tone === 'live';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-4 rounded-md border px-5 py-4.5',
        tone.box,
      )}
    >
      <Glitch
        as="div"
        active={conflict}
        replayKey={meta.label}
        className="min-w-0 flex-[1_1_380px] items-center gap-4"
      >
        <div
          className={cn(
            'relative flex size-11 flex-none items-center justify-center rounded-full ring-1',
            tone.chip,
          )}
        >
          {pending && <PendingPulse tone={meta.tone === 'tube' ? 'tube' : 'phosphor'} />}
          <Icon size={19} className="relative" />
        </div>
        <div className="min-w-0">
          <div
            data-testid={syncMeta ? 'saves-sync-status' : undefined}
            className={cn('text-lead font-semibold', tone.text)}
          >
            {meta.label}
          </div>
          {stats && (
            <div className="mt-0.5 text-small text-dust">
              {pluralize(stats.files, 'file')} · {formatBytes(stats.bytes)}
              {stats.registryKeys > 0 && ` · ${pluralize(stats.registryKeys, 'registry key')}`}
            </div>
          )}
        </div>
      </Glitch>
      {children}
    </div>
  );
};

// El latido del chip cuando hay una acción pendiente: un halo del color del
// estado que respira detrás del icono. Se pausa fuera de la vista; con
// reduced motion se queda quieto (el color ya lo dice).
const PendingPulse = ({ tone }: { tone: 'phosphor' | 'tube' }): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <span
      ref={observe}
      aria-hidden
      className={cn(
        'absolute -inset-1.5 animate-pulse-soft rounded-full blur-[6px] [animation-duration:2.4s] motion-reduce:animate-none motion-reduce:opacity-60',
        tone === 'tube' ? 'bg-tube/30' : 'bg-phosphor/30',
      )}
      style={{ animationPlayState: playState }}
    />
  );
};

// "Este PC" si la partida es de aquí, el nombre del PC si no.
const tipName = (tip: SaveTip): string => (tip.isOwn ? 'this PC' : tip.deviceName);

const tipAgo = (tip: SaveTip): string => describeAgo(new Date(tip.createdAt).getTime(), Date.now());

const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

// El texto de §12.4 para cada situación. null = no hay nada que decir (sin
// copias en la nube) y la card vuelve a su comparación local de siempre.
// 'unlinked' es informativo y va en neutro: no es un aviso, es que falta un
// eslabón del linaje y no se puede afirmar nada.
const syncStatusMeta = (sync: SaveSyncState): SyncMeta | null => {
  const head = sync.head;
  switch (sync.status) {
    case 'synced':
      return { label: 'Up to date', tone: 'success', icon: Check };
    case 'local-changes':
      return {
        label: "There are changes here that aren't backed up yet",
        tone: 'phosphor',
        icon: CloudUpload,
      };
    case 'behind':
      return head
        ? {
            label: `There's a newer save from ${tipName(head)} (${tipAgo(head)})`,
            tone: 'tube',
            icon: HardDriveDownload,
          }
        : null;
    case 'diverged':
      if (sync.tips.length > 1) {
        return {
          label: `The saves from ${joinNames(sync.tips.map(tipName))} have gone different ways`,
          tone: 'live',
          icon: TriangleAlert,
        };
      }
      return head
        ? {
            label: `You have changes here and there's a newer save from ${tipName(head)}`,
            tone: 'live',
            icon: TriangleAlert,
          }
        : null;
    case 'available':
      return head
        ? { label: `There's a save from ${tipName(head)}`, tone: 'tube', icon: HardDriveDownload }
        : null;
    case 'unlinked':
      return head
        ? {
            label: `Latest backup: ${tipName(head)}, ${tipAgo(head)}. Afterplay can't tell yet whether it's newer than the save on this PC.`,
            tone: 'dust',
            icon: CloudUpload,
          }
        : null;
    case 'none':
      return null;
  }
};

// Acciones del estado. En 'behind' y 'diverged' la acción destacada es
// restaurar ESA versión, por el mismo flujo manual de siempre (diálogo con
// copia de seguridad previa): nada se restaura solo. En 'available' es una
// acción más, sin destacar.
const SyncActions = ({
  sync,
  versions,
  blocked,
  onRestore,
}: {
  sync: SaveSyncState;
  versions: SaveBackupRow[];
  blocked: boolean;
  onRestore: (backup: SaveBackupRow) => void;
}): React.JSX.Element | null => {
  const primary = sync.status === 'behind' || sync.status === 'diverged';
  // Con varias puntas, la de este PC ya es la que hay en el disco (o su
  // última copia): se ofrecen las de los demás. Con una sola, se ofrece esa
  // aunque sea de aquí (este PC pudo restaurar otra cosa después).
  const candidates: SaveTip[] = primary
    ? sync.tips.length > 1
      ? sync.tips.filter((tip) => !tip.isOwn)
      : sync.head
        ? [sync.head]
        : []
    : sync.status === 'available' && sync.head
      ? [sync.head]
      : [];

  const rows = candidates.flatMap((tip) => {
    const backup = versions.find((version) => String(version.id) === tip.backupId);
    return backup ? [{ tip, backup }] : [];
  });
  const showUnverified = !sync.localVerified && sync.status !== 'none';
  if (rows.length === 0 && !showUnverified) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      {rows.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2.5">
          {rows.map(({ tip, backup }, index) => (
            <button
              key={tip.backupId}
              type="button"
              data-testid={primary ? 'saves-sync-restore' : undefined}
              onClick={() => onRestore(backup)}
              disabled={blocked}
              className={cn(
                primary && index === 0 ? primaryButtonClass : secondaryButtonClass,
                'h-9 px-4 text-body',
              )}
            >
              <HardDriveDownload size={15} />
              Restore the save from {tipName(tip)}…
            </button>
          ))}
        </div>
      )}
      {showUnverified && (
        <div className="max-w-90 text-right text-small text-dust">
          The save on this disk couldn&apos;t be checked, so local changes aren&apos;t taken into
          account.
        </div>
      )}
    </div>
  );
};

const Detected = ({
  gameId,
  state,
  addingFolder,
  onAddFolder,
  onAddFile,
  onRestore,
}: {
  gameId: GameId;
  state: SavesGameState;
  addingFolder: boolean;
  onAddFolder: () => void;
  onAddFile: () => void;
  onRestore: (backup: SaveBackupRow) => void;
}): React.JSX.Element => {
  const setEnabled = useSetSaveBackupEnabled();
  const backupNow = useBackupNow();
  const clearDetection = useClearSaveDetection();
  const activity = useSaveBackupActivity(gameId);
  const [flash, setFlash] = useState<{ text: string; tone: string } | null>(null);

  const handleBackupNow = async (): Promise<void> => {
    setFlash(null);
    const result = await backupNow.mutateAsync(gameId).catch(() => null);
    if (!result) return;
    setFlash(
      result.uploaded > 0
        ? {
            text: `Backed up — ${pluralize(result.uploaded, 'new version')} in the cloud`,
            tone: 'text-success',
          }
        : // "Nada que subir" son DOS cosas, y antes las dos decían lo mismo.
          // Que no haya NI UN archivo donde miramos no es tranquilizador: es
          // que la carpeta se movió, el juego se desinstaló o la ruta que
          // añadiste a mano se quedó vieja — y la copia lleva fallando en
          // silencio desde entonces.
          result.foundFiles
          ? { text: 'Nothing changed since the last backup.', tone: 'text-dust' }
          : {
              text: 'No save files found where Afterplay is looking — nothing was backed up.',
              tone: 'text-phosphor',
            },
    );
    setTimeout(() => setFlash(null), 6000);
  };

  const actions = (
    <SyncActions
      sync={state.sync}
      versions={state.cloud}
      blocked={state.running}
      onRestore={onRestore}
    />
  );

  return (
    <div className="grid items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
        {state.local ? (
          <SyncHero
            change={state.local.change}
            stats={{
              files: state.local.files,
              bytes: state.local.bytes,
              registryKeys: state.local.registryKeys.length,
            }}
            sync={state.sync}
          >
            {actions}
          </SyncHero>
        ) : state.sync.status !== 'none' ? (
          <SyncHero change="none" stats={null} sync={state.sync}>
            {actions}
          </SyncHero>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong px-5 py-4 text-body text-dust">
            <CloudOff size={16} className="flex-none" />
            Nothing on this PC — the game may not be installed here.
          </div>
        )}

        {/* La copia automática que dispara el cierre de sesión ocurre entera
            en el main: sin este aviso, la ficha se quedaba con la foto de
            antes y no había forma de saber que algo estaba subiendo. */}
        {activity && <ActivityBanner activity={activity} />}
      </div>

      <div className="min-w-0">
        <VersionList
          gameId={gameId}
          versions={state.cloud}
          blockedReason={state.running ? 'The game is running — close it before restoring.' : null}
          onRestore={onRestore}
        />
      </div>

      <aside className="flex min-w-0 flex-col gap-7">
        <section>
          <h2 className="mb-3 text-lead font-semibold text-bone">Cloud backup</h2>
          {/* Opt-in explícito, juego a juego (§10.5): subir partidas a un
              bucket es mover datos personales a un servicio externo y eso no
              se hace por defecto. */}
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            onClick={() => setEnabled.mutate({ gameId, enabled: !state.enabled })}
            className="group/switch flex w-full items-center gap-3 rounded-sm text-left outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
          >
            <span
              aria-hidden
              className={cn(
                'relative h-5.5 w-10 flex-none rounded-full border transition-colors duration-150',
                state.enabled ? 'border-phosphor bg-phosphor' : 'border-line-strong bg-inset',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-4 rounded-full transition-[left,background-color] duration-150 motion-reduce:transition-none',
                  state.enabled ? 'left-5 bg-ink' : 'left-0.5 bg-dust',
                )}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-bone">
                {state.enabled ? 'On' : 'Off'}
              </span>
              <span className="block text-small text-dust">
                {state.enabled ? 'Runs when you close a session' : 'Off — nothing leaves this PC'}
              </span>
            </span>
          </button>

          <div className="mt-3.5">
            <SidebarButton
              onClick={handleBackupNow}
              disabled={backupNow.isPending || !state.enabled}
              icon={backupNow.isPending ? Loader2 : CloudUpload}
              wide
            >
              {backupNow.isPending ? 'Backing up…' : 'Back up now'}
            </SidebarButton>
          </div>
          {/* Pulsar el botón y que no pase NADA visible es peor que un error:
              cuando la partida no ha cambiado desde la última copia, ludusavi
              no genera versión nueva y sin este mensaje parece roto. */}
          {flash && <div className={cn('mt-2 text-small', flash.tone)}>{flash.text}</div>}
          {backupNow.isError && (
            <div className="mt-2 text-small text-live">{backupNow.error.message}</div>
          )}
        </section>

        <section className="border-t border-line pt-6">
          <h2 className="text-lead font-semibold text-bone">Where it saves on this PC</h2>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-small text-dust">
            <span className="min-w-0 [overflow-wrap:anywhere]">{state.ludusaviName}</span>
            <span className="flex-none">
              {state.detectionSource === 'manual' ? 'Set by you' : 'Found automatically'}
            </span>
          </div>

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
            onAddFile={onAddFile}
          />

          {/* Vía de escape de un emparejado automático equivocado: sin esto
              no había forma de volver a "sin detectar". */}
          {state.detectionSource === 'auto' && (
            <>
              <button
                type="button"
                onClick={() => clearDetection.mutate(gameId)}
                disabled={clearDetection.isPending}
                className={cn(textLinkClass, 'mt-3 disabled:opacity-50')}
              >
                {clearDetection.isPending ? 'Resetting…' : 'Not the right game? Reset detection'}
              </button>
              {/* Es la vía de escape de un atasco: si falla en silencio, el
                  usuario se queda atrapado sin saber que lo intentó. */}
              {clearDetection.isError && (
                <div className="mt-1 text-small font-semibold text-live">
                  Couldn&apos;t reset it — {clearDetection.error.message}
                </div>
              )}
            </>
          )}
        </section>

        <RestoreTargetRow gameId={gameId} target={state.restoreTarget} />
      </aside>
    </div>
  );
};

// TODAS las carpetas que se respaldan, en un solo bloque: las detectadas por
// el manifest ("Found automatically") y las añadidas a mano (con su X). Antes iban
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
  onAddFile,
}: {
  gameId: GameId;
  detectedLocations: string[];
  ownPaths: string[];
  adding: boolean;
  isAuto: boolean;
  onAdd: () => void;
  onAddFile: () => void;
}): React.JSX.Element => {
  const removeFolder = useRemoveSaveFolder();

  // Se compara por CONTENENCIA, no por igualdad. La ubicación que deriva
  // ludusavi es la carpeta común de los archivos que encuentra, y esa suele
  // colgar por debajo de la que eligió el usuario: comparando strings salían
  // dos filas para lo mismo, y la de abajo etiquetada como automática.
  const detectedOnly = detectedLocations.filter(
    (detected) => !ownPaths.some((own) => isWithin(detected, own)),
  );

  return (
    <div className="mt-3 flex flex-col">
      {detectedOnly.map((path) => (
        <FolderRow key={path} path={path} tag="Found automatically" />
      ))}

      {ownPaths.map((path) => (
        <FolderRow
          key={path}
          path={path}
          tag="Added by you"
          onRemove={
            removeFolder.isPending ? undefined : () => removeFolder.mutate({ gameId, folder: path })
          }
        />
      ))}

      {/* Botones de verdad, no un enlace diminuto: son la única salida cuando
          la detección automática no cubre dónde guarda un juego. El fichero
          suelto es para las memory cards de emulador, que comparten carpeta
          con las de otros juegos. */}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <SidebarButton onClick={onAdd} disabled={adding} icon={adding ? Loader2 : FolderPlus}>
          {adding ? 'Adding…' : ownPaths.length > 0 ? 'Add another folder' : 'Add a folder'}
        </SidebarButton>
        <SidebarButton onClick={onAddFile} disabled={adding} icon={adding ? Loader2 : FilePlus2}>
          {adding ? 'Adding…' : 'Add a single file'}
        </SidebarButton>
      </div>

      {ownPaths.length > 0 && isAuto && (
        <div className="mt-2 text-small text-dust">
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

// Una carpeta respaldada: la ruta en monoespaciada (envuelve, no se corta) y
// de dónde salió. Pulsarla la abre en el Explorador — es LA pregunta que uno
// se hace mirando esta lista ("¿qué hay ahí dentro?").
const FolderRow = ({
  path,
  tag,
  onRemove,
}: {
  path: string;
  tag: string;
  onRemove?: () => void;
}): React.JSX.Element => {
  const name = path.slice(path.lastIndexOf('/') + 1) || path;
  // Estas filas también pueden ser un archivo (una memory card). Se distingue
  // por la extensión: una ruta que ya no existe daría error en un stat.
  const isFile = /\.[a-z0-9]{1,6}$/i.test(name);

  return (
    <div className="group/folder flex items-start gap-2 border-b border-line py-2.5">
      <button
        type="button"
        onClick={() => window.api.saves.openPath(path)}
        title={`${path} — open in Explorer`}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xs text-left outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
      >
        {isFile ? (
          <FileText size={15} className="mt-0.5 flex-none text-dust" />
        ) : (
          <FolderOpen size={15} className="mt-0.5 flex-none text-dust" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-small text-bone [overflow-wrap:anywhere] group-hover/folder:underline">
            {path}
          </span>
          <span className="block text-small text-dust">{tag}</span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Stop backing up this folder"
          aria-label="Stop backing up this folder"
          className="flex size-7 flex-none items-center justify-center rounded-sm text-dust opacity-0 transition-[opacity,color,background-color] duration-150 group-hover/folder:opacity-100 hover:bg-live/12 hover:text-live focus-visible:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// Las cuatro fases de una copia automática, contadas como se las cuenta a
// una persona: qué está pasando y si tiene que hacer algo.
const ACTIVITY_META: Record<
  SavesActivityEvent['phase'],
  { label: string; tone: string; spinning: boolean }
> = {
  scheduled: {
    label: 'Session closed — backing up shortly',
    tone: 'border-tube/35 bg-tube/6 text-tube',
    spinning: true,
  },
  uploading: {
    label: 'Uploading this save…',
    tone: 'border-tube/35 bg-tube/6 text-tube',
    spinning: true,
  },
  done: {
    label: 'Backed up just now',
    tone: 'border-success/35 bg-success/6 text-success',
    spinning: false,
  },
  failed: {
    label: "Couldn't back up — it'll retry after your next session",
    tone: 'border-phosphor/40 bg-phosphor/6 text-phosphor',
    spinning: false,
  },
};

const ActivityBanner = ({ activity }: { activity: SavesActivityEvent }): React.JSX.Element => {
  // Una copia automática que termina SIN haber encontrado nada no es un
  // "listo": es el aviso de que las partidas de este juego llevan sin
  // copiarse desde que la carpeta dejó de estar donde estaba.
  const foundNothing = activity.phase === 'done' && activity.foundFiles === false;
  const meta = foundNothing
    ? {
        label: 'No save files found where Afterplay is looking',
        tone: 'border-phosphor/40 bg-phosphor/6 text-phosphor',
        spinning: false,
      }
    : ACTIVITY_META[activity.phase];

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-sm border px-3.5 py-2.5 text-body font-semibold',
        meta.tone,
      )}
    >
      {meta.spinning ? (
        <Loader2 size={15} className="mt-0.5 flex-none animate-spin motion-reduce:animate-none" />
      ) : activity.phase === 'done' && !foundNothing ? (
        <Check size={15} className="mt-0.5 flex-none" />
      ) : (
        <TriangleAlert size={15} className="mt-0.5 flex-none" />
      )}
      <span className="min-w-0">
        {meta.label}
        {/* El motivo, en crudo: puede ser la red, las claves o el propio
            motor, y cada uno se resuelve de forma distinta. */}
        {activity.message && (
          <span
            className="mt-0.5 block text-small font-normal opacity-80 [overflow-wrap:anywhere]"
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
  wide,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: typeof CloudUpload;
  wide?: boolean;
  children: React.ReactNode;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(secondaryButtonClass, 'h-9 px-3.5 text-body', wide && 'w-full')}
  >
    <Icon
      size={15}
      className={Icon === Loader2 ? 'animate-spin motion-reduce:animate-none' : undefined}
    />
    {children}
  </button>
);

const Warning = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="mt-2 flex items-start gap-1.5 text-small text-phosphor">
    <TriangleAlert size={13} className="mt-0.5 flex-none" />
    <span>{children}</span>
  </div>
);

// El destino personalizado de ESTA máquina (§10bis.5). No sincroniza: "aquí
// el juego está en la D" es un hecho de este PC, no del juego.
const RestoreTargetRow = ({
  gameId,
  target,
}: {
  gameId: GameId;
  target: string | null;
}): React.JSX.Element => {
  const setRestoreTarget = useSetRestoreTarget();

  return (
    <section className="border-t border-line pt-6">
      <h2 className="mb-3 text-lead font-semibold text-bone">Restores to</h2>
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-raised text-dust">
          <FolderOpen size={16} />
        </span>
        {target ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-body font-semibold text-bone">A folder of your choice</div>
              <div className="font-mono text-small text-dust [overflow-wrap:anywhere]">
                {target}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRestoreTarget.mutate({ gameId, target: null })}
              className="flex size-8 flex-none items-center justify-center rounded-sm text-dust hover:bg-bone/6 hover:text-bone"
              title="Use the original paths again"
              aria-label="Use the original paths again"
            >
              <RotateCcw size={14} />
            </button>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold text-bone">The original paths</div>
            <div className="text-small text-dust">
              Or pick another folder on this PC when you restore
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// Cuántas versiones se ven sin desplegar. La retención son 3 completas + 5
// diferenciales POR MÁQUINA, así que con dos PCs la lista se va a dieciséis.
const VISIBLE_VERSIONS = 6;

const VersionList = ({
  gameId,
  versions,
  blockedReason,
  onRestore,
}: {
  gameId: GameId;
  versions: SaveBackupRow[];
  // Motivo por el que restaurar no se puede AHORA (juego abierto, motor
  // ausente...). null = se puede.
  blockedReason: string | null;
  onRestore: (backup: SaveBackupRow) => void;
}): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [expanded, setExpanded] = useState(false);
  // Borrar una versión pasa por confirmación como todo lo destructivo de la
  // app: si de la copia elegida cuelgan diferenciales, se van con ella.
  const [deleting, setDeleting] = useState<SaveBackupRow | null>(null);

  if (versions.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-lead font-semibold text-bone">Versions</h2>
        <div className="rounded-md border border-dashed border-line-strong px-5 py-4 text-body text-dust">
          Nothing in the cloud yet.
        </div>
      </section>
    );
  }

  const visible = expanded ? versions : versions.slice(0, VISIBLE_VERSIONS);

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lead font-semibold text-bone">
        Versions
        <span className="rounded-xs bg-inset px-1.5 py-px text-micro font-medium text-dust tabular-nums">
          {versions.length}
        </span>
      </h2>

      {blockedReason && <Warning>{blockedReason}</Warning>}

      {/* Carril de tiempo: un raíl vertical con un punto por versión, de
          arriba (reciente) a abajo (antigua); la más reciente con aro. */}
      {/* Las versiones entran escalonadas al abrir la pestaña (fx/Stagger). */}
      <Stagger as="ol" className="relative mt-2">
        <span aria-hidden className="absolute top-6 bottom-6 left-2 w-px bg-line-strong" />
        {visible.map((version, index) => (
          <li
            key={version.id}
            className="group/version relative flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line py-3 pl-8"
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-1/2 left-0.75 size-2.5 -translate-y-1/2 rounded-full',
                index === 0
                  ? 'bg-phosphor ring-3 ring-phosphor/30'
                  : 'border-2 border-dust bg-cabinet',
              )}
            />
            {/* Con hora, no solo fecha: dos copias del mismo día es el caso
                NORMAL —una por sesión—. */}
            <div className="min-w-44 flex-[1_1_180px]">
              <div className="flex items-center gap-2 text-body font-semibold text-bone">
                {formatByPrecision(version.createdAt, 'datetime', timeFormat)}
                {index === 0 && (
                  <span className="rounded-xs border border-tube/50 px-1.5 text-micro font-semibold text-tube">
                    Latest
                  </span>
                )}
              </div>
              <div className="text-small text-dust">
                {version.machineName}
                {version.differential && ' · incremental'}
              </div>
            </div>
            <span className="flex-none text-small text-dust tabular-nums">
              {formatBytes(version.sizeBytes)}
            </span>
            <button
              type="button"
              onClick={() => onRestore(version)}
              disabled={blockedReason !== null}
              title="Restore this version…"
              className={cn(
                index === 0 ? secondaryButtonClass : ghostButtonClass,
                'h-8.5 px-3 text-body',
                index === 0 && 'border-phosphor/55 text-phosphor hover:border-phosphor',
              )}
            >
              <HardDriveDownload size={15} />
              Restore
            </button>
            {/* La papelera solo asoma al pasar por la fila: borrar de la nube
                es lo que menos veces se hace aquí. */}
            <button
              type="button"
              onClick={() => setDeleting(version)}
              title="Delete this version from the cloud"
              aria-label="Delete this version from the cloud"
              className="flex size-8 flex-none items-center justify-center rounded-sm text-dust opacity-0 transition-[opacity,color,background-color] duration-150 group-hover/version:opacity-100 hover:bg-live/12 hover:text-live focus-visible:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </Stagger>

      {versions.length > VISIBLE_VERSIONS && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={cn(textLinkClass, 'mt-3')}
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
    </section>
  );
};
