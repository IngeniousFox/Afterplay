import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  HardDriveDownload,
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
import { fieldLabelClass, textInputClass } from '../library/add-game/styles';
import { expandClass, floatingPanelClass } from '../../lib/styles';
import { cn } from '../../lib/utils';
import {
  buttonSize,
  focusRingInset,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../shell/controls';
import { SegmentedControl } from '../ui/segmented-control';
import { SettingsCard, SettingsNotice, StatusLine } from './SettingsCard';

type CredentialsSectionProps = {
  // Primer arranque sin credenciales de IGDB: el grupo de IGDB nace
  // desplegado (RootLayout decide cuándo, vía la navegación a Integrations).
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
// de dentro no lo repiten ("API key", no "SteamGridDB API key").
type ServiceId = 'igdb' | 'sgdb' | 'turso' | 'storage' | 'anthropic' | 'steam' | 'ra';

type CredentialField = { key: FieldKey; label: string };

const R2_FIELDS: CredentialField[] = [
  { key: 'r2AccountId', label: 'Account ID' },
  { key: 'r2Bucket', label: 'Bucket' },
  { key: 'r2AccessKeyId', label: 'Access key ID' },
  { key: 'r2SecretAccessKey', label: 'Secret access key' },
];

const S3_FIELDS: CredentialField[] = [
  { key: 's3Endpoint', label: 'Endpoint URL' },
  { key: 's3Region', label: 'Region' },
  { key: 's3Bucket', label: 'Bucket' },
  { key: 's3AccessKeyId', label: 'Access key ID' },
  { key: 's3SecretAccessKey', label: 'Secret access key' },
  { key: 's3AddressingMode', label: 'Addressing' },
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
  // Hidden services are not drawn, but their keys stay in the draft (see
  // FIELD_KEYS) so Save keys writes them back untouched instead of wiping them.
  hidden?: boolean;
};

const SERVICES: Service[] = [
  {
    id: 'igdb',
    label: 'IGDB',
    detail: 'Game search & metadata',
    where: 'dev.twitch.tv',
    fields: [
      { key: 'twitchClientId', label: 'Twitch client ID' },
      { key: 'twitchClientSecret', label: 'Twitch client secret' },
    ],
    isReady: (creds) => Boolean(creds.twitchClientId && creds.twitchClientSecret),
  },
  {
    id: 'sgdb',
    label: 'SteamGridDB',
    detail: 'Covers & heroes',
    where: 'steamgriddb.com/profile/preferences/api',
    fields: [{ key: 'steamGridDbApiKey', label: 'API key' }],
    isReady: (creds) => Boolean(creds.steamGridDbApiKey),
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
    fields: [{ key: 'anthropicApiKey', label: 'API key' }],
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
      { key: 'steamApiKey', label: 'API key' },
      { key: 'steamUserId64', label: 'SteamID64 (for your unlocks)' },
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
      { key: 'raUsername', label: 'Username' },
      { key: 'raApiKey', label: 'Web API key' },
    ],
    isReady: (creds) => Boolean(creds.raUsername && creds.raApiKey),
  },
  {
    id: 'turso',
    // La base de la 1.x. La 2.0 ya no sincroniza por aquí, pero el corte de
    // la migración (main/migration/legacyCutover.ts) todavía LEE estas dos
    // claves para hablar con la base antigua. No se pintan, pero siguen en el
    // borrador para que guardar no las borre; desaparecen con el resto de
    // Turso (AFTERPLAY-2.0.md, Apéndice C).
    hidden: true,
    label: 'Turso (1.x)',
    detail: 'Old cloud database · only read while moving from 1.x',
    where: 'turso.tech',
    fields: [
      { key: 'databaseUrl', label: 'Database URL' },
      { key: 'databaseAuthToken', label: 'Auth token' },
    ],
    isReady: (creds) => Boolean(creds.databaseUrl && creds.databaseAuthToken),
  },
];

// Derivado de SERVICES y no escrito a mano: el borrador, la siembra y el
// guardado deben incluir incluso las claves del destino que está oculto.
// El cast es la contrapartida de Object.fromEntries, que devuelve un índice ancho.
const FIELD_KEYS = SERVICES.flatMap((service) => service.fields.map((field) => field.key));

// Lo que se pinta: todo menos los servicios ocultos.
const VISIBLE_SERVICES = SERVICES.filter((service) => !service.hidden);

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
// sección sigue siendo Save keys (el único primario).
const transferButtonClass = cn(secondaryButtonClass, buttonSize.md);

// Lo que desbloquea cada servicio, para el panel lateral (estados-ajustes-
// integrations.png): la respuesta a "¿necesito esta clave?" sin abrir nada.
const UNLOCKS: Record<ServiceId, string> = {
  igdb: 'Search, summaries, ratings and release dates',
  sgdb: 'Covers and heroes',
  storage: 'Save backups in your own bucket',
  anthropic: 'Game trivia and monthly stories',
  steam: 'Achievements and Steam reviews',
  ra: 'Achievements on retro games',
  turso: 'Moving your library over from Afterplay 1.x',
};

// Credenciales de APIs externas, editables sin .env (main/config/credentials
// las guarda cifradas en userData). Sección Integrations de Ajustes: un
// acordeón de servicios (uno abierto a la vez) y, al lado, qué desbloquea
// cada uno y cómo llevarse las claves a otro PC.
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

  const provider = savedProvider ?? 'cloudflare';

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <SettingsCard
        title="API keys"
        description="Each service unlocks one feature. The app works without any of them; add only the ones you want. Open a service to add its keys: they save encrypted on this PC and apply right away."
        action={
          <button
            type="button"
            onClick={() => setShowValues((current) => !current)}
            aria-label={showValues ? 'Hide values' : 'Show values'}
            title={showValues ? 'Hide values' : 'Show values'}
            aria-pressed={showValues}
            className={iconButtonClass}
          >
            {showValues ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
          </button>
        }
        flush
      >
        {/* Un sync roto se enseña SIEMPRE, arriba del todo. Hoy el main ya no
            lo publica (settings:getSyncFailure responde null desde que el
            sync de Turso salió del escritorio), así que en la práctica no
            aparece; se conserva mientras exista el canal. */}
        {syncFailure && (
          <div className="border-b border-line px-5 py-3.5">
            <SettingsNotice>
              <div className="font-semibold">
                {syncFailure.schemaMismatch
                  ? "Cloud sync is stuck: the remote database doesn't match this one"
                  : syncFailure.walOutOfStep
                    ? 'Cloud sync is stuck: changes from your other devices are not coming in'
                    : 'Cloud sync is failing'}
                {syncFailure.consecutive > 1 && ` · ${syncFailure.consecutive} tries`}
              </div>
              <div className="mt-0.5 font-normal text-dust">
                {syncFailure.schemaMismatch
                  ? 'A table or column is missing on Turso, so nothing new is being uploaded. Retrying will not fix it: the pending migration has to be applied there. Your data is safe locally.'
                  : syncFailure.walOutOfStep
                    ? 'Your changes are still uploading to Turso, but nothing from your other devices can download. Retrying will not fix it: the local copy has to be rebuilt from Turso once.'
                    : 'Your data is safe locally and will upload once the connection recovers.'}
              </div>
              <div className="mt-1 font-mono text-micro font-normal break-all text-dust">
                {syncFailure.message}
              </div>
            </SettingsNotice>
          </div>
        )}

        <ul>
          {VISIBLE_SERVICES.map((service) => {
            const ready = creds ? service.isReady(creds, provider) : false;
            const isOpen = openService === service.id;
            const fields =
              service.id === 'storage'
                ? selectedProvider === 'cloudflare'
                  ? R2_FIELDS
                  : S3_FIELDS
                : service.fields;
            return (
              <li
                key={service.id}
                className={cn(
                  'border-t border-line first:border-t-0',
                  isOpen && 'bg-phosphor-tint/40',
                )}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenService(isOpen ? null : service.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-bone/4',
                    focusRingInset,
                  )}
                >
                  <ChevronDown
                    aria-hidden
                    size={15}
                    className={cn(
                      'flex-none text-dust transition-transform duration-150 motion-reduce:transition-none',
                      !isOpen && '-rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-bone">{service.label}</span>
                    <span className="block text-small text-dust">
                      {service.id === 'storage'
                        ? `${provider === 'cloudflare' ? 'Cloudflare R2' : 'S3 compatible'} · backups`
                        : service.detail}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex flex-none items-center gap-1.5 text-small font-semibold',
                      ready ? 'text-tube' : 'text-dust',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 flex-none rounded-full',
                        ready ? 'bg-tube' : 'border-2 border-dust',
                      )}
                    />
                    {ready ? 'Configured' : 'Not set'}
                  </span>
                </button>

                {isOpen && (
                  <div className={cn('flex flex-col gap-3.5 px-5 pt-1 pb-5 pl-12', expandClass)}>
                    {service.id === 'storage' && (
                      <SegmentedControl
                        aria-label="Cloud save destination"
                        value={selectedProvider}
                        options={[
                          { value: 'cloudflare', label: 'Cloudflare R2' },
                          { value: 's3', label: 'S3 compatible' },
                        ]}
                        onChange={(next) => {
                          setSelectedProvider(next);
                          setPendingStorageChange(null);
                          setSavedFlash(false);
                        }}
                        className="self-start"
                      />
                    )}
                    {service.id === 'storage' && selectedProvider !== provider && (
                      <p className="text-small text-phosphor">
                        The current destination stays active until saved.
                      </p>
                    )}
                    <div
                      className={
                        service.id === 'storage' || fields.length === 2
                          ? 'grid grid-cols-1 gap-3.5 min-[900px]:grid-cols-2'
                          : 'flex flex-col gap-3.5'
                      }
                    >
                      {fields.map((field) => (
                        <div
                          key={field.key}
                          className={
                            field.key === 's3Endpoint' || field.key === 's3AddressingMode'
                              ? 'min-[900px]:col-span-2'
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
                              <Select.Label className={cn(fieldLabelClass, 'block')}>
                                Addressing
                              </Select.Label>
                              <Select.Trigger
                                className={cn(
                                  textInputClass,
                                  'flex items-center justify-between text-left',
                                )}
                              >
                                <Select.Value />
                                <Select.Icon>
                                  <ChevronDown aria-hidden size={15} className="text-dust" />
                                </Select.Icon>
                              </Select.Trigger>
                              <Select.Portal>
                                <Select.Positioner
                                  alignItemWithTrigger={false}
                                  sideOffset={4}
                                  className="isolate z-60"
                                >
                                  <Select.Popup
                                    className={cn(
                                      'w-(--anchor-width) rounded-sm border p-1 outline-hidden',
                                      floatingPanelClass,
                                    )}
                                  >
                                    <Select.List className="flex flex-col gap-0.5">
                                      {S3_ADDRESSING_OPTIONS.map((option) => (
                                        <Select.Item
                                          key={option.value}
                                          value={option.value}
                                          className="flex cursor-default items-center justify-between rounded-xs px-3 py-2 text-small text-bone outline-hidden data-highlighted:bg-bone/7 data-selected:text-phosphor"
                                        >
                                          <Select.ItemText>{option.label}</Select.ItemText>
                                          <Select.ItemIndicator>
                                            <Check
                                              aria-hidden
                                              size={14}
                                              className="text-phosphor"
                                            />
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                      ))}
                                    </Select.List>
                                  </Select.Popup>
                                </Select.Positioner>
                              </Select.Portal>
                            </Select.Root>
                          ) : (
                            <label className="block">
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
                                className={cn(textInputClass, 'font-mono')}
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                    {service.id === 'storage' && selectedProvider === 's3' && (
                      <p className="text-small text-dust">
                        Path style is recommended for private S3 servers.
                      </p>
                    )}
                    {service.id === 'storage' &&
                      selectedProvider === 's3' &&
                      draft.s3Endpoint.trim().toLowerCase().startsWith('http://') && (
                        <p className="text-small text-phosphor">
                          HTTP sends backup data without transport encryption. Use HTTPS for Plexy.
                        </p>
                      )}
                    <div className="text-small text-dust">
                      Get it at{' '}
                      <span className="text-bone">
                        {service.id === 'storage' && selectedProvider === 's3'
                          ? 'your S3 server’s admin panel'
                          : service.where}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={setCredentials.isPending}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              <Save aria-hidden size={15} />
              {setCredentials.isPending
                ? migrationProgress
                  ? 'Migrating…'
                  : 'Saving…'
                : 'Save keys'}
            </button>
            {savedFlash && !setCredentials.isPending && (
              <span className="text-small font-semibold text-tube">
                Saved — applied immediately, no restart needed.
              </span>
            )}
            {setCredentials.isError && (
              <span className="text-small text-live">
                Couldn&apos;t save — {setCredentials.error.message}
              </span>
            )}
          </div>

          {pendingStorageChange && !setCredentials.isPending && (
            <div ref={migrationPromptRef}>
              <SettingsNotice
                action={
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void saveValues(pendingStorageChange.values, pendingStorageChange.provider)
                      }
                      className={cn(primaryButtonClass, buttonSize.md)}
                    >
                      Migrate backups and switch
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingStorageChange(null)}
                      className={cn(secondaryButtonClass, buttonSize.md)}
                    >
                      Cancel
                    </button>
                  </>
                }
              >
                <div className="font-semibold">Move cloud saves to the new destination?</div>
                <div className="mt-1 font-normal text-bone">
                  {pendingStorageChange.from} → {pendingStorageChange.to}
                </div>
                <p className="mt-1.5 font-normal text-dust">
                  Afterplay will copy and verify every object before activating the new destination.
                  The original bucket will remain intact. Close Afterplay on other PCs during the
                  move, then switch each PC before using it again.
                </p>
              </SettingsNotice>
            </div>
          )}
          {setCredentials.isPending && migrationProgress && (
            <div className="text-small text-tube">
              {migrationProgress.phase === 'listing'
                ? 'Checking objects in both buckets…'
                : `${migrationProgress.phase === 'copying' ? 'Copying' : 'Verifying'} ${migrationProgress.completed} of ${migrationProgress.total} objects`}
            </div>
          )}
        </div>
      </SettingsCard>

      <div className="flex min-w-0 flex-col gap-5">
        <SettingsCard title="What each key unlocks" flush>
          <ul>
            {VISIBLE_SERVICES.map((service) => {
              const ready = creds ? service.isReady(creds, provider) : false;
              return (
                <li
                  key={service.id}
                  className="flex items-start justify-between gap-3 border-t border-line px-5 py-3 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="text-body font-semibold text-bone">{service.label}</div>
                    <div className="text-small text-dust">{UNLOCKS[service.id]}</div>
                  </div>
                  {ready && (
                    <span className="mt-0.5 flex flex-none items-center gap-1.5 text-micro font-semibold text-tube">
                      <Check aria-hidden size={13} />
                      Ready
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </SettingsCard>

        {/* Llevarse las claves a otro PC: no es parte de rellenar claves, es
            lo que se hace DESPUÉS — y una sola vez por instalación. */}
        <SettingsCard
          title="Moving to another PC?"
          description={
            <>
              Export puts every key above into a single{' '}
              <span className="font-mono text-bone">afterplay-keys.json</span>. On the other one,
              import it here, or just drop it into the app folder and it loads itself on the next
              start. That file is readable, so keep it somewhere safe and delete it when you&apos;re
              done.
            </>
          }
          extra={
            transferFlash && (
              <StatusLine tone={transferFlash.ok ? 'info' : 'error'}>
                <span className="break-all">{transferFlash.text}</span>
              </StatusLine>
            )
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={transferBusy}
              className={transferButtonClass}
            >
              <HardDriveDownload aria-hidden size={15} />
              {exportCredentials.isPending ? 'Exporting…' : 'Export keys'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={transferBusy}
              className={transferButtonClass}
            >
              <Upload aria-hidden size={15} />
              {importCredentials.isPending ? 'Importing…' : 'Import from file'}
            </button>
            {/* La ruta de userData no se la sabe nadie de memoria, y sin ella
                el camino automático ("déjalo en la carpeta") no es seguible. */}
            <button
              type="button"
              onClick={() => void window.api.settings.openDataFolder()}
              className={transferButtonClass}
            >
              <FolderOpen aria-hidden size={15} />
              Open app folder
            </button>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
};
