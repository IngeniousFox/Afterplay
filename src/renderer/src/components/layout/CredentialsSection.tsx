import { AlertTriangle, ChevronDown, Eye, EyeOff, KeyRound, Save } from 'lucide-react';
import { useState } from 'react';
import type { CredentialsValues } from '../../../../shared/types';
import { useCredentials, useSetCredentials, useSyncFailure } from '../../hooks/settings';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../library/add-game/styles';
import { accentGradientStyle, expandClass, revealClass, revealStyle } from '../../lib/styles';
import { AMBER, BLUE } from '../../lib/colors';

type CredentialsSectionProps = {
  // Primer arranque sin credenciales de IGDB: la sección nace expandida con
  // el aviso de por qué (NavRail decide cuándo). El resto de veces, cerrada.
  initiallyOpen: boolean;
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
type ServiceId = 'igdb' | 'sgdb' | 'turso' | 'r2' | 'anthropic' | 'steam';

type Service = {
  id: ServiceId;
  label: string;
  detail: string;
  where: string;
  fields: { key: FieldKey; label: string }[];
  // Un servicio solo está listo con TODAS sus claves — IGDB y Turso necesitan
  // las dos suyas, media configuración no sirve de nada.
  isReady: (creds: CredentialsValues) => boolean;
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
    id: 'r2',
    label: 'Cloudflare R2',
    detail: 'Cloud save backups · optional',
    where: 'dash.cloudflare.com → R2 → Manage API tokens',
    fields: [
      { key: 'r2AccountId', label: 'ACCOUNT ID' },
      { key: 'r2Bucket', label: 'BUCKET' },
      { key: 'r2AccessKeyId', label: 'ACCESS KEY ID' },
      { key: 'r2SecretAccessKey', label: 'SECRET ACCESS KEY' },
    ],
    // Las cuatro o ninguna: sin bucket no hay dónde subir, sin secreto no
    // hay forma de firmar. Media configuración solo daría errores por
    // sesión, así que la función entera se queda apagada hasta tenerlo todo.
    isReady: (creds) =>
      Boolean(
        creds.r2AccountId && creds.r2Bucket && creds.r2AccessKeyId && creds.r2SecretAccessKey,
      ),
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
];

// Derivado de SERVICES y no escrito a mano: con cuatro servicios y nueve
// claves, tres listas paralelas (borrador vacío, siembra y guardado) eran
// tres sitios donde olvidarse de añadir la nueva. El cast es la contrapartida
// de Object.fromEntries, que siempre devuelve un índice ancho.
const FIELD_KEYS = SERVICES.flatMap((service) => service.fields.map((field) => field.key));

const draftFrom = (read: (key: FieldKey) => string): Record<FieldKey, string> =>
  Object.fromEntries(FIELD_KEYS.map((key) => [key, read(key)])) as Record<FieldKey, string>;

const EMPTY_DRAFT = draftFrom(() => '');

// Credenciales de APIs externas, editables sin .env (main/config/credentials
// las guarda cifradas en userData). Colapsable y cerrada por defecto: es
// configuración de una sola vez, no algo que mirar a diario.
export const CredentialsSection = ({
  initiallyOpen,
}: CredentialsSectionProps): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: syncFailure } = useSyncFailure();
  const setCredentials = useSetCredentials();

  const [open, setOpen] = useState(initiallyOpen);
  // Acordeón: un servicio abierto a la vez. Rellenar claves es una tarea de
  // uno en uno, y así la sección no vuelve a crecer a lo alto. Si la sección
  // se abrió por faltar IGDB (primer arranque), ese grupo ya viene desplegado.
  const [openService, setOpenService] = useState<ServiceId | null>(initiallyOpen ? 'igdb' : null);
  const [showValues, setShowValues] = useState(false);
  const [draft, setDraft] = useState<Record<FieldKey, string>>(EMPTY_DRAFT);
  // Los valores guardados llegan async — se siembran en el borrador UNA vez
  // (ajustar-estado-durante-render, como EditNotesModal). Tras guardar, la
  // mutation fija la query con lo normalizado y el borrador ya coincide.
  const [seeded, setSeeded] = useState(false);
  if (creds && !seeded) {
    setSeeded(true);
    setDraft(draftFrom((key) => creds[key] ?? ''));
  }
  const [savedFlash, setSavedFlash] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSavedFlash(false);
    await setCredentials.mutateAsync(
      Object.fromEntries(
        FIELD_KEYS.map((key) => [key, draft[key] || null]),
      ) as unknown as CredentialsValues,
    );
    setSavedFlash(true);
  };

  return (
    <div
      className={`rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.75 ${revealClass}`}
      style={revealStyle(1)}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        // Padding propio + margen negativo que lo compensa: el contenido
        // queda exactamente donde estaba, pero el fondo del hover respira en
        // vez de ir pegado al texto (mismo truco que el carril de
        // ScreenshotsCarousel con su -my-2 py-2).
        className="-mx-2 -my-1.5 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      >
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
            <div className="text-[13.5px] font-semibold text-foreground">API & Sync</div>
            <div className="mt-0.25 text-xs text-muted-foreground">
              Keys for game search, artwork and cloud sync. The app works without them — locally and
              without search — until you add them.
            </div>
          </div>
        </div>
        {/* flex-wrap: los servicios van seguidos en una línea y van saltando
            a la siguiente según hagan falta, en vez de amontonarse uno por
            fila. min-w-0 es lo que permite que esta columna ceda ancho al
            texto de la izquierda en lugar de exigir el suyo entero. */}
        <div className="flex min-w-0 items-center gap-2.5">
          {creds && (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
              {SERVICES.map((service) => ({ ...service, ready: service.isReady(creds) })).map(
                (service) => (
                  <span
                    key={service.id}
                    title={service.detail}
                    // whitespace-nowrap: cada etiqueta es una unidad
                    // ("Cloudflare R2" son dos palabras) — sin esto el texto
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
                ),
              )}
            </div>
          )}
          <ChevronDown
            size={15}
            className="flex-none text-muted-foreground transition-transform duration-150"
            style={open ? { transform: 'rotate(180deg)' } : undefined}
          />
        </div>
      </button>

      {/* FUERA del `open`: un sync roto tiene que verse con la sección
          plegada, que es como está el 99% del tiempo. Antes esto solo salía
          por consola y un desajuste de esquema estuvo horas fallando cada
          minuto sin que nada lo dijera. */}
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

      {open && (
        <div className={`mt-3 flex flex-col gap-2.5 border-t border-border pt-3 ${expandClass}`}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">
              Open a service to add its keys. The app works without any of them — locally and
              without search.
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
            const ready = creds ? service.isReady(creds) : false;
            const isOpen = openService === service.id;
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
                  <span className="text-[12.5px] font-semibold text-foreground">
                    {service.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                    {service.detail}
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
                    {service.fields.map((field) => (
                      <div key={field.key}>
                        <div className={fieldLabelClass}>{field.label}</div>
                        <input
                          type={showValues ? 'text' : 'password'}
                          value={draft[field.key]}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          autoComplete="off"
                          spellCheck={false}
                          className={`${textInputClass} ${textInputFocusClass} font-mono text-[11.5px]`}
                        />
                      </div>
                    ))}
                    <div className="text-[11px] text-muted-foreground">
                      Get it at {service.where}
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
              {setCredentials.isPending ? 'Saving…' : 'Save keys'}
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
        </div>
      )}
    </div>
  );
};
