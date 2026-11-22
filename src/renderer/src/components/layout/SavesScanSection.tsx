import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, FileText, Loader2, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { SavesScanEntry } from '../../../../shared/types';
import { queryKeys } from '../../hooks/queryKeys';
import {
  useSavesScanResults,
  useSavesStatus,
  useSavesUsage,
  useScanSaves,
  useSetSaveBackupEnabled,
} from '../../hooks/saves';
import { formatBytes, pluralize } from '../../lib/format';
import { KEYS_TAB } from '../../lib/settingsTabs';
import { expandClass } from '../../lib/styles';
import type { GameId } from '../../../../shared/entityIds';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { Switch } from '../ui/switch';
import { SettingsCard, SettingsNotice, StatusLine } from './SettingsCard';

// Escaneo completo de la biblioteca (PARTIDAS-GUARDADAS.md §10.1): BAJO
// DEMANDA y con un botón, nunca al arrancar la app. Es una sola invocación
// que compara todo lo instalado contra el manifest de ludusavi (~9s en una
// biblioteca real de 333 juegos), y no escribe nada: solo mira.
//
// La pantalla de resultados es además el momento natural para activar en
// bloque lo que se quiera respaldar — ves la lista de lo encontrado y
// decides, que es justo lo que pide el opt-in de §10.5.
export const SavesScanSection = (): React.JSX.Element => {
  const { data: status } = useSavesStatus();
  const scan = useScanSaves();
  const setEnabled = useSetSaveBackupEnabled();
  const queryClient = useQueryClient();
  // Respaldado por query (useSavesScanResults), no por useState: salir de
  // Ajustes desmonta la sección, y un useState tiraba a la basura una pasada
  // de ~9s aunque nada en la biblioteca hubiera cambiado desde entonces.
  const { data: results } = useSavesScanResults();
  // Qué fila está guardándose ahora mismo. Sin esto, activar un juego no
  // daba NINGUNA señal hasta cerrar y reabrir Ajustes: la lista es una foto
  // del escaneo, y una mutation que invalida queries no la toca.
  // Un Set y no un solo id: dos filas distintas alternadas a la vez
  // compartían el único busyGameId, y el finally de la primera lo ponía a
  // null mientras la segunda seguía en vuelo — su spinner desaparecía y su
  // botón se reactivaba a media petición, dejando colar un doble envío.
  const [busyIds, setBusyIds] = useState<Set<GameId>>(new Set());

  const ready = status?.ready ?? false;

  const setResults = (next: SavesScanEntry[] | null): void => {
    queryClient.setQueryData(queryKeys.savesLibraryScan.results, next);
  };

  const handleScan = async (): Promise<void> => {
    setResults(null);
    setResults(await scan.mutateAsync());
  };

  const patchEntry = (gameId: GameId, enabled: boolean): void => {
    queryClient.setQueryData(
      queryKeys.savesLibraryScan.results,
      (current: SavesScanEntry[] | null | undefined) =>
        current?.map((entry) => (entry.gameId === gameId ? { ...entry, enabled } : entry)) ?? null,
    );
  };

  // Optimista: la fila cambia YA y se revierte si el guardado falla. Es una
  // preferencia de una columna booleana, no una operación de riesgo — esperar
  // al ida y vuelta solo se nota como "no ha pasado nada".
  const handleToggle = async (
    gameId: GameId,
    enabled: boolean,
    ludusaviName: string,
  ): Promise<void> => {
    patchEntry(gameId, enabled);
    setBusyIds((prev) => new Set(prev).add(gameId));
    try {
      // El nombre de ludusavi viaja con el toggle: el escaneo ya sabe con
      // qué juego casó esta fila, y sin guardarlo el juego quedaría marcado
      // pero sin emparejar (la ficha diría "no sé dónde guarda" y el backup
      // automático lo saltaría).
      await setEnabled.mutateAsync({ gameId, enabled, ludusaviName });
    } catch {
      patchEntry(gameId, !enabled);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(gameId);
        return next;
      });
    }
  };

  return (
    <SettingsCard
      title="Cloud saves"
      description="Scan your installed games to find the ones whose save files Afterplay can back up, then choose which ones to keep safe in the cloud. Nothing uploads until you turn a game on."
      action={
        <button
          type="button"
          onClick={handleScan}
          disabled={!status?.binaryAvailable || scan.isPending}
          className={cn(secondaryButtonClass, buttonSize.md)}
        >
          {scan.isPending ? (
            <Loader2 aria-hidden size={15} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Radar aria-hidden size={15} />
          )}
          {scan.isPending ? 'Scanning…' : 'Scan my games'}
        </button>
      }
      extra={
        scan.isError && <StatusLine tone="error">The scan failed: {scan.error.message}</StatusLine>
      }
      flush
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <CloudUsage />
        {!ready && <UnavailableNotice status={status} />}
      </div>
      {results && <ScanResults results={results} busyIds={busyIds} onToggle={handleToggle} />}
      <LegalLinks />
    </SettingsCard>
  );
};

// Cuánto ocupan las partidas en la nube. Va aquí, en la tarjeta que trata de
// esto y a la vista sin desplegar nada — no dentro de las claves de R2, que
// es donde se configura el acceso, no donde se mira el resultado.
//
// El dato NO le cuesta una sola llamada a R2: sale de sumar el sizeBytes que
// ya se guarda por backup al subirlo, y el índice se poda en el mismo
// momento en que se borra el objeto del bucket (ver getSaveBackupsUsage).
// Se enseña siempre, incluso a cero: ocultarlo en el caso vacío no dejaba
// distinguir "aún no hay nada" de "esto no funciona".
const CloudUsage = (): React.JSX.Element | null => {
  const { data: usage } = useSavesUsage();
  if (!usage) return null;

  const empty = usage.backupCount === 0;
  return (
    <div className="flex items-center gap-2.5 text-small">
      <CloudUpload
        aria-hidden
        size={15}
        className={cn('flex-none', empty ? 'text-dust' : 'text-tube')}
      />
      {empty ? (
        <span className="text-dust">
          Nothing in the cloud yet. Turn a game on below and it&apos;ll back up when you stop
          playing.
        </span>
      ) : (
        <span className="font-semibold text-bone">
          {formatBytes(usage.totalBytes)} in the cloud
          <span className="font-normal text-dust">
            {' · '}
            {pluralize(usage.backupCount, 'backup')}
          </span>
        </span>
      )}
    </div>
  );
};

const UnavailableNotice = ({
  status,
}: {
  status: { binaryAvailable: boolean; r2Configured: boolean } | undefined;
}): React.JSX.Element => (
  <SettingsNotice>
    {status && !status.binaryAvailable
      ? 'The save-backup engine is missing from this install. An antivirus may have quarantined it. Everything else works normally.'
      : `Scanning works, but nothing can be uploaded until you add your cloud save credentials in ${KEYS_TAB}.`}
  </SettingsNotice>
);

// Obligación al redistribuir el binario (PARTIDAS-GUARDADAS.md §6.4):
// ludusavi es MIT y varias de sus dependencias de Rust son Apache-2.0/BSD,
// con sus propias cláusulas de retención de aviso. Los textos viajan junto al
// ejecutable y desde aquí se pueden abrir.
const LegalLinks = (): React.JSX.Element | null => {
  const { data: files } = useQuery({
    queryKey: queryKeys.saves.legal,
    queryFn: () => window.api.saves.getLegalFiles(),
    staleTime: Infinity,
  });
  if (!files?.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-micro text-dust">
      <span>Powered by ludusavi (MIT).</span>
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => window.api.saves.openPath(file.path)}
          className="rounded-xs font-semibold text-tube underline-offset-2 hover:text-tube-hi hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
        >
          {file.name.includes('LICENSE') ? 'License' : 'Third-party notices'}
        </button>
      ))}
    </div>
  );
};

const ScanResults = ({
  results,
  busyIds,
  onToggle,
}: {
  results: SavesScanEntry[];
  busyIds: Set<GameId>;
  onToggle: (gameId: GameId, enabled: boolean, ludusaviName: string) => void;
}): React.JSX.Element => {
  // Los que han casado con un juego de la biblioteca van primero: son los
  // únicos accionables. El resto se enseña igual, porque saber que ludusavi
  // encontró una partida de algo que no tienes añadido es información útil.
  const matched = results.filter((entry) => entry.gameId !== null);
  const unmatched = results.filter((entry) => entry.gameId === null);
  const enabledCount = matched.filter((entry) => entry.enabled).length;

  if (results.length === 0) {
    return (
      <div className="border-t border-line px-5 py-4 text-small text-dust">
        Nothing found. Games that aren&apos;t recognised can still be set up one by one from their
        own page, choosing the folder yourself.
      </div>
    );
  }

  return (
    // Los resultados aterrizan, no aparecen de golpe.
    <div className={cn('border-t border-line', expandClass)}>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-2.5 text-small text-dust">
        <span>
          <span className="font-semibold text-bone">{matched.length}</span> matched
        </span>
        {unmatched.length > 0 && (
          <span>
            <span className="font-semibold text-bone">{unmatched.length}</span> not in your library
          </span>
        )}
        {/* La cuenta de activados es el otro feedback del toggle: sube y baja
            con cada clic, así que se ve que la lista está viva. */}
        {enabledCount > 0 && (
          <span className="text-tube">
            <span className="font-semibold">{enabledCount}</span> backing up
          </span>
        )}
      </div>

      <ul className="max-h-[420px] overflow-y-auto">
        {matched.map((entry) => {
          const busy = entry.gameId !== null && busyIds.has(entry.gameId);
          return (
            <li
              key={entry.ludusaviName}
              className="flex items-center gap-3 border-t border-line px-5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-body font-semibold text-bone">{entry.gameTitle}</div>
                <div className="text-micro text-dust">
                  {pluralize(entry.fileCount, 'file')} · {formatBytes(entry.bytes)}
                  {entry.registryKeys.length > 0 && ' · registry'}
                  {/* En Phosphor: es el aviso de §11.1, no un dato más. */}
                  {entry.steamIdInPath && (
                    <span className="text-phosphor"> · tied to your Steam account</span>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  'flex flex-none items-center gap-1.5 text-small font-semibold',
                  entry.enabled ? 'text-tube' : 'text-dust',
                )}
              >
                {busy && (
                  <Loader2
                    aria-hidden
                    size={13}
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {entry.enabled ? 'Backing up' : 'Turn on'}
              </span>
              <Switch
                checked={entry.enabled}
                onCheckedChange={(next) =>
                  onToggle(entry.gameId as GameId, next, entry.ludusaviName)
                }
                disabled={busy}
                aria-label={`Back up ${entry.gameTitle ?? entry.ludusaviName}`}
              />
            </li>
          );
        })}

        {unmatched.map((entry) => (
          <li
            key={entry.ludusaviName}
            className="flex items-center gap-2 border-t border-line px-5 py-2 text-small text-dust"
          >
            <FileText aria-hidden size={13} className="flex-none" />
            <span className="min-w-0 flex-1">{entry.ludusaviName}</span>
            <span className="flex-none tabular-nums">{formatBytes(entry.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
