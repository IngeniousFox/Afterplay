import { Check, FolderSearch, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import type { ScannedFolder } from '../../../../../shared/types';
import { GREEN } from '../../../lib/colors';
import { formatBytes } from '../../../lib/format';
import { expandClass } from '../../../lib/styles';
import { ExecutablePicker } from './ExecutablePicker';

// "Find in my game folders": el puente entre el formulario manual y el
// escaneo de carpetas vigiladas. Elegiste el juego buscándolo (SearchStep) —
// pero si además está instalado en una de tus carpetas, el vigilante YA
// conoce su carpeta, su tamaño y su .exe. Este botón cruza el juego elegido
// con esa caché (scan:matchTitle — por igdbId primero, por similitud de
// nombre después) y rellena Launch & install de un golpe. Si hay varios
// candidatos de ejecutable, el picker compartido del escaneo deja corregir
// la apuesta aquí mismo.
export const ScanAutofillRow = ({
  title,
  igdbId,
  fillExecutable,
}: {
  title: string;
  igdbId: number | null;
  // Un juego emulado no tiene .exe propio (lo vigilado es el emulador): se
  // rellena solo la carpeta.
  fillExecutable: boolean;
}): React.JSX.Element => {
  const { setValue, watch } = useFormContext<{
    installDirectory: string;
    installSizeBytes: number | null;
    executablePath: string;
  }>();
  const executablePath = watch('executablePath');
  const [searching, setSearching] = useState(false);
  // undefined = aún no se ha pulsado; null = pulsado y sin suerte.
  const [found, setFound] = useState<ScannedFolder | null | undefined>(undefined);

  const handleFind = async (): Promise<void> => {
    if (searching) return;
    setSearching(true);
    try {
      const folder = await window.api.scan.matchTitle({ title, igdbId });
      setFound(folder);
      if (!folder) return;
      setValue('installDirectory', folder.path);
      setValue('installSizeBytes', folder.sizeBytes);
      if (fillExecutable && folder.executablePath) {
        setValue('executablePath', folder.executablePath);
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleFind()}
        disabled={searching}
        className="flex w-full items-center justify-center gap-2 rounded-[9px] border border-dashed border-input bg-white/[0.02] px-3.5 py-2.25 text-[12.5px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/45 hover:text-foreground disabled:opacity-60"
      >
        {searching ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />}
        Find in my game folders
      </button>

      {/* El resultado, dicho: qué carpeta es y cuánto pesa — y si el .exe
          tenía varios candidatos, el "N found" para corregir la apuesta. */}
      {found && (
        <div
          className={`mt-1.5 overflow-hidden rounded-[9px] border border-border bg-white/[0.02] ${expandClass}`}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.25">
            <Check size={13} strokeWidth={3} className="flex-none" style={{ color: GREEN }} />
            <span
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
              title={found.path}
            >
              {found.folderName}
            </span>
            <span className="flex-none text-[11.5px] text-muted-foreground tabular-nums">
              {formatBytes(found.sizeBytes)}
            </span>
          </div>
          {fillExecutable && (
            <ExecutablePicker
              basePath={found.path}
              candidates={found.executableCandidates}
              value={executablePath || null}
              onChange={(path) => setValue('executablePath', path)}
            />
          )}
        </div>
      )}

      {found === null && (
        <div className={`mt-1.5 text-[11.5px] text-muted-foreground ${expandClass}`}>
          Nothing matching in your game folders — add or scan them from the search step, or fill the
          paths below by hand.
        </div>
      )}
    </div>
  );
};
