import type { LucideIcon } from 'lucide-react';
import { BookOpen, CloudUpload, Gamepad2, HardDrive, KeyRound, Settings2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useAppVersion } from '../../hooks/settings';
import { AMBER, BLUE, GRAY, GREEN, TEAL, VIOLET } from '../../lib/colors';
import { KEYS_TAB } from '../../lib/settingsTabs';
import { revealClass, revealStyle } from '../../lib/styles';
import { ModalShell } from '../ui/modal-shell';
import { LoadingNotice } from '../ui/loading-notice';

const SettingsContent = lazy(() =>
  import('./SettingsContent').then((module) => ({ default: module.SettingsContent })),
);

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Primer arranque sin credenciales de IGDB (ver NavRail): el modal se abre
  // solo, aterriza en la pestaña Connections y el grupo de IGDB nace
  // desplegado con un aviso de por qué.
  credentialsSpotlight?: boolean;
};

// Las trece tarjetas de Ajustes, repartidas en seis habitaciones. Antes
// vivían todas en una sola columna de scroll (520px de ancho, sin ninguna
// jerarquía): "Backups", "Save backups" y "Game saves" aparecían sueltas y
// revueltas entre el formato de hora y los emuladores, y había que leerse
// las trece descripciones para saber cuál era cuál. La pestaña agrupa por
// PREGUNTA ("¿cómo se comporta la app?", "¿dónde están mis partidas?"), no
// por orden de llegada de cada función.
export type SettingsTabId = 'general' | 'connections' | 'library' | 'saves' | 'journey' | 'storage';

type Tab = {
  id: SettingsTabId;
  label: string;
  // La frase de cabecera del panel: qué pregunta responde esta pestaña.
  blurb: string;
  icon: LucideIcon;
  // Un color de la casa por pestaña, sin repetir: la identidad visual del
  // panel activo (chip del sidebar, lavado de la cabecera del modal).
  color: string;
};

const TABS: Tab[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'How the app behaves: startup, clock and the idle screen.',
    icon: Settings2,
    color: GREEN,
  },
  {
    id: 'connections',
    // Del sitio compartido: las tarjetas que dicen "te falta esta clave"
    // mandan aquí por su nombre, y ya hubo un rebautizo que las dejó
    // apuntando a una pestaña inexistente (ver lib/settingsTabs).
    label: KEYS_TAB,
    blurb: 'Your API keys, and the cloud sync that ties your PCs together.',
    icon: KeyRound,
    color: BLUE,
  },
  {
    id: 'library',
    label: 'Library',
    blurb: 'How games get into Afterplay and how sessions get tracked.',
    icon: Gamepad2,
    color: AMBER,
  },
  {
    id: 'saves',
    label: 'Game saves',
    blurb: 'Back up your save files to the cloud, and manage the local copies.',
    icon: CloudUpload,
    color: TEAL,
  },
  {
    id: 'journey',
    label: 'Journey',
    blurb: 'The stories Afterplay writes about your playing, and your trophies.',
    icon: BookOpen,
    color: VIOLET,
  },
  {
    id: 'storage',
    label: 'Storage',
    blurb: 'What Afterplay keeps on disk, and the safety copies of your data.',
    icon: HardDrive,
    color: GRAY,
  },
];

// SPEC 3E — el modal de Ajustes. Sidebar de pestañas a la izquierda, panel
// scrollable a la derecha; el cuerpo tiene ALTURA FIJA a propósito, para que
// cambiar de pestaña no haga bailar el tamaño del modal (cada panel tiene un
// alto distinto y sin esto el modal crecía y encogía con cada clic).
export const SettingsModal = ({
  open,
  onOpenChange,
  credentialsSpotlight = false,
}: SettingsModalProps): React.JSX.Element => {
  const { data: appVersion } = useAppVersion();

  // La pestaña abierta. El inicializador NO basta para aterrizar en
  // Connections en el primer arranque, y esto costó un modal mudo: NavRail
  // renderiza este componente SIEMPRE (no solo cuando está abierto), así que
  // el useState se fija en el primer render — cuando useCredentials todavía no
  // ha resuelto y credentialsSpotlight aún vale false. Lo que Radix desmonta
  // al cerrar son los `children` del DialogContent, no este componente (que es
  // quien guarda el estado), así que el inicializador tampoco vuelve a correr
  // cuando llegan las claves: en una instalación virgen Ajustes se abría solo
  // en General, sin el aviso de bienvenida ni el grupo de IGDB desplegado.
  //
  // De ahí el centinela: ajustar-estado-durante-render (sin useEffect), el
  // patrón que usa el resto de la app, para SINCRONIZAR con la prop cuando
  // cambia. Solo empuja al encenderse el spotlight — al apagarse deja la
  // pestaña donde la tuvieras.
  const [tabId, setTabId] = useState<SettingsTabId>(
    credentialsSpotlight ? 'connections' : 'general',
  );
  const [spotlightSeen, setSpotlightSeen] = useState(credentialsSpotlight);
  if (credentialsSpotlight !== spotlightSeen) {
    setSpotlightSeen(credentialsSpotlight);
    if (credentialsSpotlight) setTabId('connections');
  }
  const tab = TABS.find((candidate) => candidate.id === tabId) ?? TABS[0];

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      title="Settings"
      icon={Settings2}
      // La cabecera respira el color de la pestaña activa — la misma
      // identidad que el chip del sidebar, extendida al marco del modal.
      color={tab.color}
      widthClass="w-190"
      // Altura FIJA en píxeles, no en vh ni derivada del contenido: la misma
      // en cualquier pantalla y en cualquier pestaña — lo que sobre queda en
      // aire y lo que no quepa hace scroll en el panel derecho. OJO con
      // añadir flex-1 aquí: su flex-basis 0 ANULA la altura dentro del
      // flex-col del ModalShell y el modal vuelve a medirse por contenido,
      // saltando de tamaño entre pestañas (bug real de la primera versión).
      // El max-h es solo la red de seguridad para ventanas más bajas que el
      // propio modal.
      bodyClassName="flex h-160 max-h-[80vh] overflow-hidden"
    >
      {/* ── Sidebar de pestañas ── */}
      <div className="flex w-44 flex-none flex-col gap-1 overflow-y-auto border-r border-border px-2.5 py-3">
        {TABS.map((candidate) => {
          const active = candidate.id === tabId;
          const Icon = candidate.icon;
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setTabId(candidate.id)}
              className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-150 ${
                active ? '' : 'hover:bg-white/[0.04]'
              }`}
              style={active ? { background: `${candidate.color}14` } : undefined}
            >
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] transition-colors duration-150"
                style={{
                  background: active ? `${candidate.color}24` : 'rgba(255,255,255,.05)',
                }}
              >
                <Icon
                  size={14}
                  style={{ color: active ? candidate.color : 'var(--muted-foreground)' }}
                />
              </span>
              <span
                className={`text-[12.5px] font-semibold ${
                  active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {candidate.label}
              </span>
            </button>
          );
        })}
        {/* La versión instalada, al pie del sidebar: visible sin importar en
            qué pestaña estés (no es un ajuste de ninguna pestaña concreta,
            es un dato del propio binario) y fuera del scroll de las
            pestañas — mt-auto la empuja al fondo del panel. */}
        {appVersion && (
          <div className="mt-auto px-2.5 pt-2 text-[10.5px] font-semibold text-muted-foreground/50">
            Afterplay v{appVersion}
          </div>
        )}
      </div>

      {/* ── Panel de la pestaña activa ──
          key={tabId}: cambiar de pestaña remonta el panel entero, y con él
          la entrada escalonada de sus tarjetas (los índices de reveal son
          POR PANEL, 0..n, no los trece de la lista antigua). */}
      <div key={tabId} className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4.5">
        <div className={revealClass} style={revealStyle(0)}>
          <div className="flex items-center gap-2">
            <div className="text-[15px] font-extrabold tracking-[-.01em] text-foreground">
              {tab.label}
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{tab.blurb}</div>
        </div>

        <Suspense fallback={<LoadingNotice label="Loading settings…" className="min-h-32" />}>
          <SettingsContent tabId={tabId} credentialsSpotlight={credentialsSpotlight} />
        </Suspense>
      </div>
    </ModalShell>
  );
};
