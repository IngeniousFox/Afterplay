import { ChevronDown, Eye, EyeOff, Save } from 'lucide-react';
import { useState } from 'react';
import type { CredentialsValues } from '../../../../shared/types';
import { useCredentials, useSetCredentials } from '../../hooks/settings';
import { fieldLabelClass, textInputClass } from '../library/add-game/styles';
import { accentGradientStyle } from '../../lib/styles';

type CredentialsSectionProps = {
  // Primer arranque sin credenciales de IGDB: la sección nace expandida con
  // el aviso de por qué (NavRail decide cuándo). El resto de veces, cerrada.
  initiallyOpen: boolean;
};

type FieldKey = keyof CredentialsValues;

const FIELDS: { key: FieldKey; label: string; hint?: string }[] = [
  { key: 'twitchClientId', label: 'TWITCH CLIENT ID' },
  { key: 'twitchClientSecret', label: 'TWITCH CLIENT SECRET' },
  { key: 'steamGridDbApiKey', label: 'STEAMGRIDDB API KEY' },
  { key: 'databaseUrl', label: 'TURSO DATABASE URL' },
  { key: 'databaseAuthToken', label: 'TURSO AUTH TOKEN' },
];

const EMPTY_DRAFT: Record<FieldKey, string> = {
  twitchClientId: '',
  twitchClientSecret: '',
  steamGridDbApiKey: '',
  databaseUrl: '',
  databaseAuthToken: '',
};

// Estado por servicio para los chips del header — IGDB necesita sus dos
// claves a la vez, Turso también; SGDB va sola.
const serviceStatus = (
  creds: CredentialsValues,
): { label: string; ready: boolean; detail: string }[] => [
  {
    label: 'IGDB',
    ready: Boolean(creds.twitchClientId && creds.twitchClientSecret),
    detail: 'search & metadata',
  },
  { label: 'SteamGridDB', ready: Boolean(creds.steamGridDbApiKey), detail: 'covers & heroes' },
  {
    label: 'Turso',
    ready: Boolean(creds.databaseUrl && creds.databaseAuthToken),
    detail: 'cloud sync',
  },
];

// Credenciales de APIs externas, editables sin .env (main/config/credentials
// las guarda cifradas en userData). Colapsable y cerrada por defecto: es
// configuración de una sola vez, no algo que mirar a diario.
export const CredentialsSection = ({
  initiallyOpen,
}: CredentialsSectionProps): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const setCredentials = useSetCredentials();

  const [open, setOpen] = useState(initiallyOpen);
  const [showValues, setShowValues] = useState(false);
  const [draft, setDraft] = useState<Record<FieldKey, string>>(EMPTY_DRAFT);
  // Los valores guardados llegan async — se siembran en el borrador UNA vez
  // (ajustar-estado-durante-render, como EditNotesModal). Tras guardar, la
  // mutation fija la query con lo normalizado y el borrador ya coincide.
  const [seeded, setSeeded] = useState(false);
  if (creds && !seeded) {
    setSeeded(true);
    setDraft({
      twitchClientId: creds.twitchClientId ?? '',
      twitchClientSecret: creds.twitchClientSecret ?? '',
      steamGridDbApiKey: creds.steamGridDbApiKey ?? '',
      databaseUrl: creds.databaseUrl ?? '',
      databaseAuthToken: creds.databaseAuthToken ?? '',
    });
  }
  const [savedFlash, setSavedFlash] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSavedFlash(false);
    await setCredentials.mutateAsync({
      twitchClientId: draft.twitchClientId || null,
      twitchClientSecret: draft.twitchClientSecret || null,
      steamGridDbApiKey: draft.steamGridDbApiKey || null,
      databaseUrl: draft.databaseUrl || null,
      databaseAuthToken: draft.databaseAuthToken || null,
    });
    setSavedFlash(true);
  };

  return (
    <div className="rounded-[10px] border border-border bg-white/[0.02] px-3.25 py-2.75">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <div className="text-[13.5px] font-semibold text-foreground">API & Sync</div>
          <div className="mt-0.25 text-xs text-muted-foreground">
            Keys for game search, artwork and cloud sync. The app works without them — locally and
            without search — until you add them.
          </div>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {creds && (
            <div className="flex items-center gap-2">
              {serviceStatus(creds).map((service) => (
                <span
                  key={service.label}
                  title={service.detail}
                  className="flex items-center gap-1 text-[10.5px] font-bold"
                  style={{ color: service.ready ? '#2fdc7e' : 'var(--muted-foreground)' }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: service.ready ? '#2fdc7e' : 'rgba(255,255,255,.22)',
                    }}
                  />
                  {service.label}
                </span>
              ))}
            </div>
          )}
          <ChevronDown
            size={15}
            className="text-muted-foreground transition-transform"
            style={open ? { transform: 'rotate(180deg)' } : undefined}
          />
        </div>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted-foreground">
              Get them at dev.twitch.tv (IGDB), steamgriddb.com/profile/preferences/api and
              turso.tech — Turso is optional, only for syncing across PCs.
            </div>
            <button
              type="button"
              onClick={() => setShowValues((current) => !current)}
              title={showValues ? 'Hide values' : 'Show values'}
              className="flex flex-none items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            >
              {showValues ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {FIELDS.map((field) => (
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
                className={`${textInputClass} font-mono text-[11.5px]`}
              />
            </div>
          ))}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={setCredentials.isPending}
              className="flex w-fit items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
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
