import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CloudUpload, FileText, Loader2, Radar, TriangleAlert } from 'lucide-react';
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
import { expandClass, revealClass, revealStyle } from '../../lib/styles';
import { CloudIdentitySection } from './CloudIdentitySection';
import { CloudInventorySection } from './CloudInventorySection';
import { SettingsCard } from './SettingsCard';
import { AMBER, BLUE } from '../../lib/colors';

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
  // Respaldado por query (useSavesScanResults), no por useState: Ajustes es
  // un Dialog de Radix que desmonta su contenido al cerrarse, así que un
  // useState tiraba a la basura una pasada de ~9s en cuanto cerrabas la
  // ventana — aunque nada en la biblioteca hubiera cambiado desde entonces.
  const { data: results } = useSavesScanResults();
  // Qué fila está guardándose ahora mismo. Sin esto, activar un juego no
  // daba NINGUNA señal hasta cerrar y reabrir Ajustes: la lista es una foto
  // del escaneo, y una mutation que invalida queries no la toca.
  // Un Set y no un solo id: dos filas distintas alternadas a la vez
  // compartían el único busyGameId, y el finally de la primera lo ponía a
  // null mientras la segunda seguía en vuelo — su spinner desaparecía y su
  // botón se reactivaba a media petición, dejando colar un doble envío.
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const ready = status?.ready ?? false;

  const setResults = (next: SavesScanEntry[] | null): void => {
    queryClient.setQueryData(queryKeys.savesLibraryScan.results, next);
  };

  const handleScan = async (): Promise<void> => {
    setResults(null);
    setResults(await scan.mutateAsync());
  };

  const patchEntry = (gameId: number, enabled: boolean): void => {
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
    gameId: number,
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
      layout="column"
      title="Game saves"
      description="Find which installed games Afterplay can back up, and pick the ones you want in the cloud."
      icon={CloudUpload}
      color={BLUE}
      className={revealClass}
      style={revealStyle(5)}
      // Arriba a la derecha, a la altura del título: debajo puede aparecer
      // una lista de veinte juegos, y en una fila centrada el botón acababa
      // flotando en mitad de la nada.
      headerRight={
        <button
          type="button"
          onClick={handleScan}
          disabled={!status?.binaryAvailable || scan.isPending}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scan.isPending ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          {scan.isPending ? 'Scanning…' : 'Scan my games'}
        </button>
      }
    >
      {/* Antes que nada lo demás: si esta instalación no ha mirado el bucket,
          reclamar su carpeta anterior es lo primero que hay que resolver —
          después de subir algo bajo un id nuevo ya no sale gratis. */}
      <CloudIdentitySection />
      <CloudUsage />
      {/* Solo tiene sentido si hay bucket al que preguntar. */}
      {status?.r2Configured && <CloudInventorySection />}
      {!ready && <UnavailableNotice status={status} />}
      {scan.isError && (
        <div className="text-[11px] text-destructive">The scan failed — {scan.error.message}</div>
      )}
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
    <div
      className="flex items-center gap-2 rounded-[8px] border px-2.75 py-2"
      style={
        empty
          ? { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
          : { borderColor: `${BLUE}2e`, background: `${BLUE}0d` }
      }
    >
      <CloudUpload
        size={13}
        className="flex-none"
        style={{ color: empty ? 'rgba(255,255,255,.18)' : BLUE }}
      />
      {empty ? (
        <span className="text-[11.5px] text-muted-foreground">
          Nothing in the cloud yet — turn a game on below and it&apos;ll back up when you stop
          playing.
        </span>
      ) : (
        <span className="text-[12px] font-semibold text-foreground">
          {formatBytes(usage.totalBytes)} in the cloud
          <span className="font-normal text-muted-foreground">
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
  <div className="flex items-start gap-1.75 text-[11px] leading-relaxed" style={{ color: AMBER }}>
    <TriangleAlert size={12} className="mt-0.5 flex-none" />
    <span>
      {status && !status.binaryAvailable
        ? 'The save-backup engine is missing from this install — an antivirus may have quarantined it. Everything else works normally.'
        : 'Scanning works, but nothing can be uploaded until you add your Cloudflare R2 keys in API & Sync above.'}
    </span>
  </div>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
      <span>Powered by ludusavi (MIT).</span>
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => window.api.saves.openPath(file.path)}
          className="underline underline-offset-2 hover:text-foreground"
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
  busyIds: Set<number>;
  onToggle: (gameId: number, enabled: boolean, ludusaviName: string) => void;
}): React.JSX.Element => {
  // Los que han casado con un juego de la biblioteca van primero: son los
  // únicos accionables. El resto se enseña igual, porque saber que ludusavi
  // encontró una partida de algo que no tienes añadido es información útil.
  const matched = results.filter((entry) => entry.gameId !== null);
  const unmatched = results.filter((entry) => entry.gameId === null);
  const enabledCount = matched.filter((entry) => entry.enabled).length;

  if (results.length === 0) {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Nothing found. Games that aren&apos;t recognised can still be set up one by one from their
        own page, choosing the folder yourself.
      </div>
    );
  }

  return (
    // La misma entrada animada que las secciones del propio modal: los
    // resultados aterrizan, no aparecen de golpe.
    <div className={`flex flex-col gap-1.5 ${expandClass}`}>
      <div className="text-[11px] font-bold tracking-[.05em] text-muted-foreground">
        {pluralize(matched.length, 'game')} matched
        {unmatched.length > 0 && ` · ${unmatched.length} not in your library`}
        {/* La cuenta de activados es el otro feedback del toggle: sube y baja
            con cada clic, así que se ve que la lista está viva. */}
        {enabledCount > 0 && <span style={{ color: BLUE }}> · {enabledCount} backing up</span>}
      </div>

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
        {matched.map((entry) => (
          <div
            key={entry.ludusaviName}
            className="flex items-center gap-2.5 rounded-[8px] border px-2.75 py-1.75 transition-colors duration-150"
            // La fila entera acompaña al toggle: activada se tiñe del azul de
            // la nube, así el barrido visual de "qué tengo protegido" no
            // exige leer los botones uno a uno.
            style={
              entry.enabled
                ? { borderColor: `${BLUE}2e`, background: `${BLUE}0d` }
                : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
            }
          >
            <CloudUpload
              size={13}
              className="flex-none transition-colors duration-150"
              style={{ color: entry.enabled ? BLUE : 'rgba(255,255,255,.18)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-foreground">
                {entry.gameTitle}
              </div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {pluralize(entry.fileCount, 'file')} · {formatBytes(entry.bytes)}
                {entry.registryKeys.length > 0 && ' · registry'}
                {/* En ámbar: es el aviso de §11.1, no un dato más. */}
                {entry.steamIdInPath && (
                  <span style={{ color: AMBER }}> · tied to your Steam account</span>
                )}
              </div>
            </div>
            {/* Todo en clases, sin `style` inline: apagado usa el hover
                estándar de los botones de la app (borde al primario + lavado
                blanco), y encendido sube su propio azul. El literal #85a3d6
                es el mismo BLUE de lib/colors — va escrito a mano porque
                Tailwind solo ve clases literales, no cadenas compuestas. */}
            <button
              type="button"
              onClick={() => onToggle(entry.gameId as number, !entry.enabled, entry.ludusaviName)}
              disabled={entry.gameId !== null && busyIds.has(entry.gameId)}
              className={`flex flex-none items-center gap-1.25 rounded-[7px] border px-2.25 py-1 text-[11px] font-bold transition-colors duration-150 disabled:opacity-70 ${
                entry.enabled
                  ? 'border-[#85a3d6]/50 bg-[#85a3d6]/12 text-[#85a3d6] enabled:hover:border-[#85a3d6]/80 enabled:hover:bg-[#85a3d6]/22'
                  : 'border-input text-muted-foreground enabled:hover:border-primary/45 enabled:hover:bg-white/[0.06] enabled:hover:text-foreground'
              }`}
            >
              {entry.gameId !== null && busyIds.has(entry.gameId) ? (
                <Loader2 size={11} className="animate-spin" />
              ) : entry.enabled ? (
                <Check size={11} />
              ) : null}
              {entry.enabled ? 'Backing up' : 'Turn on'}
            </button>
          </div>
        ))}

        {unmatched.map((entry) => (
          <div
            key={entry.ludusaviName}
            className="flex items-center gap-2 px-2.75 py-1 text-[11px] text-muted-foreground"
          >
            <FileText size={11} className="flex-none opacity-60" />
            <span className="truncate">{entry.ludusaviName}</span>
            <span className="flex-none opacity-70">{formatBytes(entry.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
