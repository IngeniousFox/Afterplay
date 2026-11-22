import { TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../shell/cn';
import { usePendingSessions } from '../../hooks/sessions';
import { useCredentials } from '../../hooks/settings';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { useShell } from '../shell/shellContext';

// Los avisos que antes vivían en el rail: sesiones de emulador esperando juego
// (el número ámbar sobre Sessions, que sigue en la pestaña) y la falta de
// claves de IGDB (el rail abría Ajustes él solo; eso sigue pasando una vez por
// arranque, y aquí queda dicho mientras falten). Sin color de alarma: ámbar con
// triángulo.

type Notice = { key: string; title: string; text: string; action: string; onAction: () => void };

export const HomeNotices = (): React.JSX.Element | null => {
  const navigate = useNavigate();
  const shell = useShell();
  const { data: pending = [] } = usePendingSessions();
  const { data: credentials } = useCredentials();

  const notices: Notice[] = [];
  if (pending.length > 0) {
    notices.push({
      key: 'pending',
      title:
        pending.length === 1
          ? '1 emulator session is waiting for its game'
          : `${pending.length} emulator sessions are waiting for their game`,
      text: 'Assign them so their time counts for the right game.',
      action: 'Assign in Sessions',
      onAction: () => navigate('/sessions'),
    });
  }
  if (credentials && (!credentials.twitchClientId || !credentials.twitchClientSecret)) {
    notices.push({
      key: 'keys',
      title: 'Game search needs your IGDB keys',
      text: 'Without them Afterplay cannot look up games or fetch their artwork.',
      action: 'Open Integrations',
      onAction: () => shell.openSettings({ credentials: true }),
    });
  }
  if (notices.length === 0) return null;

  return (
    <ul
      aria-label="Notices"
      className="flex animate-screen-in flex-col gap-2.5 [animation-delay:40ms]"
    >
      {notices.map((notice) => (
        <li
          key={notice.key}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line border-l-2 border-l-phosphor bg-panel py-3 pr-3 pl-4"
        >
          <TriangleAlert aria-hidden size={17} className="flex-none text-phosphor" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-bone">{notice.title}</p>
            <p className="text-small text-dust">{notice.text}</p>
          </div>
          <button
            type="button"
            onClick={notice.onAction}
            className={cn(secondaryButtonClass, buttonSize.md)}
          >
            {notice.action}
          </button>
        </li>
      ))}
    </ul>
  );
};
