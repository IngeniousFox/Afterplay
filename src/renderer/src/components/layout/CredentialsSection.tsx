import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  HardDriveDownload,
  KeyRound,
  Save,
  Upload,
} from 'lucide-react';
import { Select } from '@base-ui/react/select';
import { useEffect, useRef, useState } from 'react';
import type {
  CredentialsValues,
  SaveStorageProvider,
  StorageMigrationProgress,
} from '../../../../shared/types';
import {
  useCredentials,
  useExportCredentials,
  useImportCredentials,
  useSetCredentials,
  useSaveStorageProvider,
  useSyncFailure,
} from '../../hooks/settings';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../library/add-game/styles';
import { accentGradientStyle, expandClass, floatingPanelClass } from '../../lib/styles';
import { AMBER, BLUE } from '../../lib/colors';
import { cn } from '../../lib/utils';

type CredentialsSectionProps = {
  // Primer arranque sin credenciales de IGDB: el grupo de IGDB nace
  // desplegado (NavRail decide cuándo, vía SettingsModal).
  spotlight: boolean;
};

type FieldKey = keyof CredentialsValues;

// Las claves se agrupan POR SERVICIO, no en una lista plana: cada servicio
// necesita un número distinto de claves (IGDB 2, SGDB 1, Turso 2...) y con
// todas sueltas la sección se convertía en un muro de inputs que crece cada
// vez que se integra algo nuevo. Agrupadas, un servicio nuevo cuesta UNA
// fila plegada, no N campos a la vista.
//
// El nombre del servicio va en la cabecera del grupo, así que las etiquetas
// de dentro no lo repiten ("API KEY", no "STEAMGRIDDB API KEY").
type ServiceId = 'igdb' | 'sgdb' | 'turso' | 'storage' | 'anthropic' | 'steam' | 'ra';

type CredentialField = { key: FieldKey; label: string };

const R2_FIELDS: CredentialField[] = [
  { key: 'r2AccountId', label: 'ACCOUNT ID' },
  { key: 'r2Bucket', label: 'BUCKET' },
  { key: 'r2AccessKeyId', label: 'ACCESS KEY ID' },
  { key: 'r2SecretAccessKey', label: 'SECRET ACCESS KEY' },
];

const S3_FIELDS: CredentialField[] = [
  { key: 's3Endpoint', label: 'ENDPOINT URL' },
  { key: 's3Region', label: 'REGION' },
  { key: 's3Bucket', label: 'BUCKET' },
  { key: 's3AccessKeyId', label: 'ACCESS KEY ID' },
  { key: 's3SecretAccessKey', label: 'SECRET ACCESS KEY' },
  { key: 's3AddressingMode', label: 'ADDRESSING' },
];

const S3_ADDRESSING_OPTIONS = [
  { value: 'path', label: 'Path style' },
  { value: 'virtual', label: 'Virtual host style' },
];

const storageReady = (creds: CredentialsValues, provider: SaveStorageProvider): boolean =>
  provider === 'cloudflare'
    ? Boolean(creds.r2AccountId && creds.r2Bucket && creds.r2AccessKeyId && creds.r2SecretAccessKey)
    : Boolean(
        creds.s3Endpoint &&
        creds.s3Region &&
        creds.s3Bucket &&
        creds.s3AccessKeyId &&
        creds.s3SecretAccessKey,
      );

type Service = {
  id: ServiceId;
  label: string;
  detail: string;
  where: string;
  fields: CredentialField[];
  // Un servicio solo está listo con TODAS sus claves — IGDB y Turso necesitan
  // las dos suyas, media configuración no sirve de nada.
  isReady: (creds: CredentialsValues, provider: SaveStorageProvider) => boolean;
};

const SERVICES: Service[] = [
  {
    id: 'igdb',
    label: 'IGDB',
    detail: 'Game search & metadata',
    where: 'dev.twitch.tv',
    fields: [
      { key: 'twitchClientId', label: 'TWITCH CLIENT ID' },
      { key: 'twitchClientSecret', label: 'TWITCH CLIENT SECRET' },
    ],
    isReady: (creds) => Boolean(creds.twitchClientId && creds.twitchClientSecret),
  },
  {
    id: 'sgdb',
    label: 'SteamGridDB',
    detail: 'Covers & heroes',
    where: 'steamgriddb.com/profile/preferences/api',
    fields: [{ key: 'steamGridDbApiKey', label: 'API KEY' }],
    isReady: (creds) => Boolean(creds.steamGridDbApiKey),
  },
  {
    id: 'turso',
    label: 'Turso',
    detail: 'Cloud sync across PCs · optional',
    where: 'turso.tech',
    fields: [
      { key: 'databaseUrl', label: 'DATABASE URL' },
      { key: 'databaseAuthToken', label: 'AUTH TOKEN' },
    ],
    isReady: (creds) => Boolean(creds.databaseUrl && creds.databaseAuthToken),
  },
  {
    id: 'storage',
    label: 'Cloud saves',
    detail: 'Cloudflare R2 · optional',
    where: 'dash.cloudflare.com → R2 → Manage API tokens',
    // Ambos juegos de campos viven en el borrador para que alternar el
    // selector no borre credenciales del destino que no está a la vista.
    fields: [...R2_FIELDS, ...S3_FIELDS],
    isReady: storageReady,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    detail: 'Game trivia · optional',
    where: 'console.anthropic.com → API keys',
    fields: [{ key: 'anthropicApiKey', label: 'API KEY' }],
    isReady: (creds) => Boolean(creds.anthropicApiKey),
  },
  {
    id: 'steam',
    label: 'Steam',
    detail: 'Achievements · optional',
    where: 'steamcommunity.com/dev/apikey',
    // El SteamID64 es opcional dentro del opcional: la key sola ya trae el
    // catálogo de logros de cualquier juego; el ID solo hace falta para leer
    // TUS desbloqueos de juegos de tu cuenta (y exige perfil con "detalles
    // de juego" en público). isReady con la key basta.
    fields: [
      { key: 'steamApiKey', label: 'API KEY' },
      { key: 'steamUserId64', label: 'STEAMID64 (FOR YOUR UNLOCKS)' },
    ],
    isReady: (creds) => Boolean(creds.steamApiKey),
  },
  {
    id: 'ra',
    label: 'RetroAchievements',
    detail: 'Retro console achievements · optional',
    where: 'retroachievements.org/settings (Keys)',
    // Los dos o nada: la key autentica la API, pero sin usuario no se sabe
    // DE QUIÉN leer los desbloqueos — media configuración no trae nada.
    fields: [
      { key: 'raUsername', label: 'USERNAME' },
      { key: 'raApiKey', label: 'WEB API KEY' },
    ],
    isReady: (creds) => Boolean(creds.raUsername && creds.raApiKey),
  },
];

// Derivado de SERVICES y no escrito a mano: el borrador, la siembra y el
// guardado deben incluir incluso las claves del destino que está oculto.
// El cast es la contrapartida de Object.fromEntries, que devuelve un índice ancho.
const FIELD_KEYS = SERVICES.flatMap((service) => service.fields.map((field) => field.key));

const draftFrom = (read: (key: FieldKey) => string): Record<FieldKey, string> =>
  Object.fromEntries(FIELD_KEYS.map((key) => [key, read(key)])) as Record<FieldKey, string>;

const EMPTY_DRAFT = draftFrom(() => '');

const destinationKey = (provider: SaveStorageProvider, values: CredentialsValues): string =>
  provider === 'cloudflare'
    ? JSON.stringify([provider, values.r2AccountId?.trim(), values.r2Bucket?.trim()])
    : JSON.stringify([
        provider,
        values.s3Endpoint?.trim().replace(/\/$/, '').toLowerCase(),
        values.s3Bucket?.trim(),
      ]);

const destinationLabel = (provider: SaveStorageProvider, values: CredentialsValues): string =>
  provider === 'cloudflare'
    ? `Cloudflare R2 · ${values.r2Bucket ?? 'no bucket'}`
    : `S3 · ${values.s3Endpoint ?? 'no server'} · ${values.s3Bucket ?? 'no bucket'}`;

// Los tres botones del traslado son SECUNDARIOS: la acción principal de esta
// sección sigue siendo Save keys (el único con el degradado de acento).
// Mismo botón de contorno que el "Back up now" de Data backups, que es el
// gesto hermano — escribir/leer un fichero fuera de la app.
const transferButtonClass =
  'flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3 py-1.75 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

// Credenciales de APIs externas, editables sin .env (main/config/credentials
// las guarda cifradas en userData). Vive en su propia pestaña de Ajustes
// (Connections), así que ya no se pliega entera como antes — lo que se
// pliega es cada servicio, en acordeón.
export const CredentialsSection = ({ spotlight }: CredentialsSectionProps): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: savedProvider } = useSaveStorageProvider();
  const { data: syncFailure } = useSyncFailure();
  const setCredentials = useSetCredentials();
  const exportCredentials = useExportCredentials();
  const importCredentials = useImportCredentials();

  // Acordeón: un servicio abierto a la vez. Rellenar claves es una tarea de
  // uno en uno, y así la sección no crece a lo alto. Si Ajustes se abrió por
  // faltar IGDB (primer arranque), ese grupo ya viene desplegado.
  const [openService, setOpenService] = useState<ServiceId | null>(spotlight ? 'igdb' : null);
  const [showValues, setShowValues] = useState(false);
  const [draft, setDraft] = useState<Record<FieldKey, string>>(EMPTY_DRAFT);
  const [selectedProvider, setSelectedProvider] = useState<SaveStorageProvider>('cloudflare');
  const [seededProvider, setSeededProvider] = useState(false);
  if (savedProvider && !seededProvider) {
    setSeededProvider(true);
    setSelectedProvider(savedProvider);
  }
  // Los valores guardados llegan async — se siembran en el borrador UNA vez
  // (ajustar-estado-durante-render, como EditNotesModal). Tras guardar, la
  // mutation fija la query con lo normalizado y el borrador ya coincide.
  const [seeded, setSeeded] = useState(false);
  if (creds && !seeded) {
    setSeeded(true);
    setDraft(draftFrom((key) => creds[key] ?? ''));
  }
  const [savedFlash, setSavedFlash] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<StorageMigrationProgress | null>(null);
  const [pendingStorageChange, setPendingStorageChange] = useState<{
    values: CredentialsValues;
    provider: SaveStorageProvider;
    from: string;
    to: string;
  } | null>(null);
  const migrationPromptRef = useRef<HTMLDivElement>(null);
  useEffect(() => window.api.settings.onStorageMigrationProgress(setMigrationProgress), []);
  useEffect(() => {
    if (pendingStorageChange && !setCredentials.isPending)
      migrationPromptRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pendingStorageChange, setCredentials.isPending]);
  // El resultado del traslado (exportar/importar), en su propia línea: son
  // dos gestos que terminan FUERA de la app —un fichero escrito, un fichero
  // leído— y sin decirlo no se ve absolutamente nada. El error se muestra
  // aquí igual que el acierto en vez de dejarlo en la mutation: los dos
  // botones comparten la misma línea de respuesta.
  const [transferFlash, setTransferFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const transferBusy = exportCredentials.isPending || importCredentials.isPending;

  const saveValues = async (
    values: CredentialsValues,
    provider: SaveStorageProvider,
  ): Promise<void> => {
    setSavedFlash(false);
    setMigrationProgress(null);
    try {
      await setCredentials.mutateAsync({ values, provider });
      setPendingStorageChange(null);
      setSavedFlash(true);
    } catch {
      // La mutation pinta el error debajo. El proveedor anterior sigue activo.
    }
  };

  const handleSave = async (): Promise<void> => {
    const values = Object.fromEntries(
      FIELD_KEYS.map((key) => [key, draft[key] || null]),
    ) as CredentialsValues;
    const oldProvider = savedProvider ?? 'cloudflare';
    if (
      creds &&
      storageReady(creds, oldProvider) &&
      storageReady(values, selectedProvider) &&
      destinationKey(oldProvider, creds) !== destinationKey(selectedProvider, values)
    ) {
      setPendingStorageChange({
        values,
        provider: selectedProvider,
        from: destinationLabel(oldProvider, creds),
        to: destinationLabel(selectedProvider, values),
      });
      return;
    }
    await saveValues(values, selectedProvider);
  };

  const handleExport = async (): Promise<void> => {
    setTransferFlash(null);
    const directory = await window.api.dialog.pickFolder();
    if (!directory) return;
    try {
      const path = await exportCredentials.mutateAsync(directory);
      setTransferFlash({ text: `Saved to ${path}`, ok: true });
    } catch (error) {
      setTransferFlash({ text: (error as Error).message, ok: false });
    }
  };

  const handleImport = async (): Promise<void> => {
    setTransferFlash(null);
    const filePath = await window.api.dialog.pickFile();
    if (!filePath) return;
    try {
      const result = await importCredentials.mutateAsync(filePath);
      // El borrador de arriba seguiría enseñando lo de antes: se resiembra
      // con lo importado, que es lo que ya está guardado de verdad. Y el
      // "Saved" del guardado se apaga, que ya no habla de esto.
      setDraft(draftFrom((key) => result.values[key] ?? ''));
      setSavedFlash(false);
      setTransferFlash({
        text: `Imported ${result.imported} ${result.imported === 1 ? 'key' : 'keys'} — applied immediately.`,
        ok: true,
      });
    } catch (error) {
      setTransferFlash({ text: (error as Error).message, ok: false });
    }
  };

  return (
    <div className="rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.75">
      {/* Cabecera estática (esta sección ya no se pliega — vive en su propia
          pestaña): título + qué servicios están listos, de un vistazo. */}
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0: deja que la descripción envuelva en líneas normales (nada
            de truncate, eso cortaría texto) en vez de exigir su ancho de una
            sola línea y dejar a los servicios sin sitio donde repartirse. */}
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md"
            style={{ background: `${BLUE}1f` }}
          >
            <KeyRound size={13} style={{ color: BLUE }} />
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">API keys</div>
            <div className="mt-0.25 text-xs text-muted-foreground">
              Each service below unlocks one feature — game search, artwork, sync… The app works
              without any of them; add only the ones you want.
            </div>
          </div>
        </div>
        {/* flex-wrap: los servicios van seguidos en una línea y van saltando
            a la siguiente según hagan falta, en vez de amontonarse uno por
            fila. min-w-0 es lo que permite que esta columna ceda ancho al
            texto de la izquierda en lugar de exigir el suyo entero. */}
        {creds && (
          <div className="flex min-w-0 max-w-44 flex-wrap items-center justify-end gap-x-2.5 gap-y-1 pt-1">
            {SERVICES.map((service) => ({
              ...service,
              ready: service.isReady(creds, savedProvider ?? 'cloudflare'),
            })).map((service) => (
              <span
                key={service.id}
                title={service.detail}
                // whitespace-nowrap: cada etiqueta es una unidad
                // ("Cloud saves" son dos palabras) — sin esto el texto
                // se parte a mitad en vez de saltar la etiqueta entera.
                className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-bold"
                style={{ color: service.ready ? '#2fdc7e' : 'var(--muted-foreground)' }}
              >
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{
                    background: service.ready ? '#2fdc7e' : 'rgba(255,255,255,.22)',
                  }}
                />
                {service.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Un sync roto se enseña SIEMPRE, arriba del todo. Antes esto solo
          salía por consola y un desajuste de esquema estuvo horas fallando
          cada minuto sin que nada lo dijera. */}
      {syncFailure && (
        <div
          className="mt-2.5 flex items-start gap-2 rounded-[9px] border px-2.75 py-2"
          style={{ borderColor: `${AMBER}44`, background: `${AMBER}0f` }}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-none" style={{ color: AMBER }} />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold" style={{ color: AMBER }}>
              {syncFailure.schemaMismatch
                ? "Cloud sync is stuck — the remote database doesn't match this one"
                : 'Cloud sync is failing'}
              {syncFailure.consecutive > 1 && ` · ${syncFailure.consecutive} tries`}
            </div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {/* Un desajuste de esquema NO se cura reintentando: hay que
                  aplicar la migración que falta en el remoto. Decirlo evita
                  esperar en vano a que "ya se arreglará". */}
              {syncFailure.schemaMismatch
                ? 'A table or column is missing on Turso, so nothing new is being uploaded. Retrying will not fix it — the pending migration has to be applied there. Your data is safe locally.'
                : 'Your data is safe locally and will upload once the connection recovers.'}
            </div>
            <div className="mt-1 font-mono text-[10px] break-all text-muted-foreground/60">
              {syncFailure.message}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            Open a service to add its keys — they save encrypted on this PC and apply right away.
          </div>
          <button
            type="button"
            onClick={() => setShowValues((current) => !current)}
            title={showValues ? 'Hide values' : 'Show values'}
            className="flex flex-none items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            {showValues ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {SERVICES.map((service) => {
          const ready = creds ? service.isReady(creds, savedProvider ?? 'cloudflare') : false;
          const isOpen = openService === service.id;
          const fields =
            service.id === 'storage'
              ? selectedProvider === 'cloudflare'
                ? R2_FIELDS
                : S3_FIELDS
              : service.fields;
          return (
            <div
              key={service.id}
              className="overflow-hidden rounded-[9px] border border-border bg-white/[0.02]"
            >
              <button
                type="button"
                onClick={() => setOpenService(isOpen ? null : service.id)}
                className="flex w-full items-center gap-2 px-2.75 py-2.25 text-left transition-colors duration-150 hover:bg-white/[0.03]"
              >
                <ChevronDown
                  size={13}
                  className="flex-none text-muted-foreground transition-transform duration-150"
                  style={isOpen ? undefined : { transform: 'rotate(-90deg)' }}
                />
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: ready ? '#2fdc7e' : 'rgba(255,255,255,.22)' }}
                />
                <span className="text-[12.5px] font-semibold text-foreground">{service.label}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                  {service.id === 'storage'
                    ? `${(savedProvider ?? 'cloudflare') === 'cloudflare' ? 'Cloudflare R2' : 'S3 compatible'} · backups`
                    : service.detail}
                </span>
                <span
                  className="flex-none text-[10.5px] font-bold"
                  style={{ color: ready ? '#2fdc7e' : 'var(--muted-foreground)' }}
                >
                  {ready ? 'Configured' : 'Not set'}
                </span>
              </button>

              {isOpen && (
                <div
                  className={`flex flex-col gap-2.5 border-t border-border px-2.75 pt-2.5 pb-3 ${expandClass}`}
                >
                  {service.id === 'storage' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(['cloudflare', 's3'] as const).map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          aria-pressed={selectedProvider === provider}
                          onClick={() => {
                            setSelectedProvider(provider);
                            setPendingStorageChange(null);
                            setSavedFlash(false);
                          }}
                          className={`rounded-[8px] border px-3 py-1.75 text-[12px] font-semibold transition-colors ${
                            selectedProvider === provider
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border bg-white/[0.02] text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {provider === 'cloudflare' ? 'Cloudflare R2' : 'S3 compatible'}
                        </button>
                      ))}
                    </div>
                  )}
                  {service.id === 'storage' &&
                    selectedProvider !== (savedProvider ?? 'cloudflare') && (
                      <p className="text-[11px] text-amber-300">
                        The current destination stays active until saved.
                      </p>
                    )}
                  <div
                    className={
                      service.id === 'storage'
                        ? 'grid grid-cols-1 gap-x-2.5 gap-y-2.5 min-[700px]:grid-cols-2'
                        : 'flex flex-col gap-2.5'
                    }
                  >
                    {fields.map((field) => (
                      <div
                        key={field.key}
                        className={
                          field.key === 's3Endpoint' || field.key === 's3AddressingMode'
                            ? 'min-[700px]:col-span-2'
                            : undefined
                        }
                      >
                        {field.key === 's3AddressingMode' ? (
                          <Select.Root
                            items={S3_ADDRESSING_OPTIONS}
                            value={draft.s3AddressingMode === 'virtual' ? 'virtual' : 'path'}
                            onValueChange={(value) => {
                              if (!value) return;
                              setDraft((current) => ({ ...current, s3AddressingMode: value }));
                              setPendingStorageChange(null);
                              setSavedFlash(false);
                            }}
                          >
                            <Select.Label className={fieldLabelClass}>ADDRESSING</Select.Label>
                            <Select.Trigger
                              className={cn(
                                textInputClass,
                                textInputFocusClass,
                                'flex items-center justify-between text-left text-[12px]',
                              )}
                            >
                              <Select.Value />
                              <Select.Icon>
                                <ChevronDown size={15} className="text-muted-foreground" />
                              </Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Positioner
                                alignItemWithTrigger={false}
                                sideOffset={4}
                                className="isolate z-60"
                              >
                                <Select.Popup
                                  className={`w-(--anchor-width) rounded-[9px] border ${floatingPanelClass} p-1 outline-none`}
                                >
                                  <Select.List className="flex flex-col gap-0.5">
                                    {S3_ADDRESSING_OPTIONS.map((option) => (
                                      <Select.Item
                                        key={option.value}
                                        value={option.value}
                                        className="flex cursor-default items-center justify-between rounded-[7px] px-2.75 py-2 text-[12px] text-foreground outline-none data-highlighted:bg-white/[0.07] data-selected:text-primary"
                                      >
                                        <Select.ItemText>{option.label}</Select.ItemText>
                                        <Select.ItemIndicator>
                                          <Check size={14} className="text-primary" />
                                        </Select.ItemIndicator>
                                      </Select.Item>
                                    ))}
                                  </Select.List>
                                </Select.Popup>
                              </Select.Positioner>
                            </Select.Portal>
                          </Select.Root>
                        ) : (
                          <>
                            <div className={fieldLabelClass}>{field.label}</div>
                            <input
                              type={
                                showValues ||
                                field.key === 's3Endpoint' ||
                                field.key === 's3Region' ||
                                field.key === 's3Bucket'
                                  ? 'text'
                                  : 'password'
                              }
                              value={draft[field.key]}
                              onChange={(event) => {
                                setDraft((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }));
                                setPendingStorageChange(null);
                                setSavedFlash(false);
                              }}
                              autoComplete="off"
                              spellCheck={false}
                              className={`${textInputClass} ${textInputFocusClass} font-mono text-[11.5px]`}
                            />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  {service.id === 'storage' && selectedProvider === 's3' && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Path style is recommended for private S3 servers.
                    </p>
                  )}
                  {service.id === 'storage' &&
                    selectedProvider === 's3' &&
                    draft.s3Endpoint.trim().toLowerCase().startsWith('http://') && (
                      <p className="text-[11px] leading-relaxed text-amber-300">
                        HTTP sends backup data without transport encryption. Use HTTPS for Plexy.
                      </p>
                    )}
                  <div className="text-[11px] text-muted-foreground">
                    Get it at{' '}
                    {service.id === 'storage' && selectedProvider === 's3'
                      ? 'your S3 server’s admin panel'
                      : service.where}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={setCredentials.isPending}
            className="[will-change:transform] flex w-fit items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
            style={accentGradientStyle}
          >
            <Save size={14} />
            {setCredentials.isPending
              ? migrationProgress
                ? 'Migrating…'
                : 'Saving…'
              : 'Save keys'}
          </button>
          {savedFlash && !setCredentials.isPending && (
            <span className="text-[12px] font-semibold text-primary">
              Saved — applied immediately, no restart needed.
            </span>
          )}
          {setCredentials.isError && (
            <span className="text-[12px] text-destructive">
              Couldn&apos;t save — {setCredentials.error.message}
            </span>
          )}
        </div>

        {pendingStorageChange && !setCredentials.isPending && (
          <div
            ref={migrationPromptRef}
            className="rounded-[9px] border border-amber-400/35 bg-amber-400/[0.07] px-3 py-3 text-[12px] text-foreground"
          >
            <div className="font-semibold">Move cloud saves to the new destination?</div>
            <div className="mt-1 text-muted-foreground">
              {pendingStorageChange.from} → {pendingStorageChange.to}
            </div>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Afterplay will copy and verify every object before activating the new destination. The
              original bucket will remain intact. Close Afterplay on other PCs during the move, then
              switch each PC before using it again.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void saveValues(pendingStorageChange.values, pendingStorageChange.provider)
                }
                className="rounded-[8px] border border-primary/40 bg-primary/10 px-3 py-1.75 font-semibold text-primary"
              >
                Migrate backups and switch
              </button>
              <button
                type="button"
                onClick={() => setPendingStorageChange(null)}
                className="rounded-[8px] border border-border px-3 py-1.75 font-semibold text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {setCredentials.isPending && migrationProgress && (
          <div className="text-[12px] text-muted-foreground">
            {migrationProgress.phase === 'listing'
              ? 'Checking objects in both buckets…'
              : `${migrationProgress.phase === 'copying' ? 'Copying' : 'Verifying'} ${migrationProgress.completed} of ${migrationProgress.total} objects`}
          </div>
        )}

        {/* Llevarse las claves a otro PC. Debajo del guardado y separado por
            una línea: no es parte de rellenar claves, es lo que se hace
            DESPUÉS — y una sola vez por instalación. */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            Moving to another PC? Export puts every key above into a single{' '}
            <span className="font-mono text-[10.5px] text-foreground/70">afterplay-keys.json</span>.
            On the other one, import it here — or just drop it into the app folder and it loads
            itself on the next start. That file is readable, so keep it somewhere safe and delete it
            when you&apos;re done.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={transferBusy}
              className={transferButtonClass}
            >
              <HardDriveDownload size={13} />
              {exportCredentials.isPending ? 'Exporting…' : 'Export keys'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={transferBusy}
              className={transferButtonClass}
            >
              <Upload size={13} />
              {importCredentials.isPending ? 'Importing…' : 'Import from file'}
            </button>
            {/* La ruta de userData no se la sabe nadie de memoria, y sin ella
                el camino automático ("déjalo en la carpeta") no es seguible. */}
            <button
              type="button"
              onClick={() => void window.api.settings.openDataFolder()}
              className={transferButtonClass}
            >
              <FolderOpen size={13} />
              Open app folder
            </button>
          </div>
          {transferFlash && (
            <div
              className={`text-[11.5px] break-all ${transferFlash.ok ? 'text-primary' : 'text-destructive'}`}
            >
              {transferFlash.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
