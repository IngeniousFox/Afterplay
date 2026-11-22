import { WifiOff } from 'lucide-react';
import { useOnline } from '../hooks/useOnline';

// La banda "sin conexión": arriba del todo mientras el navegador esté
// offline, pegada bajo la zona segura. Solo informa; no reintenta nada (las
// queries ya vuelven a pedir al recuperar la red).
export const OfflineBand = (): React.JSX.Element | null => {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      className="sticky top-[env(safe-area-inset-top)] z-30 flex min-h-9 animate-fade-in items-center justify-center gap-2 border-b border-phosphor/25 bg-[#2a251b] px-4 text-small font-semibold text-phosphor"
    >
      <WifiOff size={15} aria-hidden="true" />
      You&apos;re offline
    </div>
  );
};
