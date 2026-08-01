import { Check, ChevronDown, MonitorPlay } from 'lucide-react';
import { useState } from 'react';
import { GREEN } from '../../../lib/colors';
import { expandClass } from '../../../lib/styles';

// El .exe adivinado, y —cuando hay más de un candidato— cuál de ellos.
// Nació dentro de FolderScanStep ("best guess of 2" sin enseñar cuál era el
// otro ni dejar cambiarlo) y ahora es pieza COMPARTIDA: lo usan las filas
// del escaneo, el autorrelleno desde carpetas vigiladas y el botón "Scan"
// del campo de ejecutable — mismos candidatos, mismo gesto de corregir la
// apuesta en los tres sitios.

const fileName = (path: string): string => path.slice(path.lastIndexOf('\\') + 1);

export const ExecutablePicker = ({
  basePath,
  candidates,
  value,
  onChange,
}: {
  // La carpeta del juego: las rutas se enseñan RELATIVAS a ella — es lo
  // único que distingue `Binaries/Win64/X-Shipping.exe` de `X.exe`, que es
  // exactamente el caso en el que hace falta elegir.
  basePath: string;
  candidates: string[];
  value: string | null;
  onChange: (path: string) => void;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);

  if (candidates.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.25">
        <MonitorPlay size={13} className="flex-none text-muted-foreground/50" />
        <span className="text-[12px] text-muted-foreground/60">
          No executable found — set it later if you want the watcher.
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.25">
        <MonitorPlay size={13} className="flex-none" style={{ color: GREEN }} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground"
          title={value ?? undefined}
        >
          {value === null ? '—' : fileName(value)}
        </span>

        {candidates.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="flex flex-none items-center gap-1 rounded-[7px] border border-input px-2 py-0.75 text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:border-primary/45 hover:text-foreground"
          >
            <ChevronDown
              size={11}
              className="transition-transform duration-150"
              style={open ? undefined : { transform: 'rotate(-90deg)' }}
            />
            {candidates.length} found
          </button>
        )}
      </div>

      {open && (
        <div className={`border-t border-border bg-black/20 px-2 py-2 ${expandClass}`}>
          <div className="mb-1.5 px-2 text-[10.5px] font-bold tracking-[.12em] text-muted-foreground">
            WHICH ONE LAUNCHES THE GAME?
          </div>
          <div className="flex flex-col gap-1">
            {candidates.map((candidate, position) => {
              const active = candidate === value;
              const relative = candidate.startsWith(basePath)
                ? candidate.slice(basePath.length + 1)
                : candidate;
              const folder = relative.slice(0, relative.length - fileName(relative).length);

              return (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    onChange(candidate);
                    setOpen(false);
                  }}
                  title={candidate}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-1.75 text-left transition-colors duration-150 ${
                    active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.035]'
                  }`}
                >
                  <Check
                    size={13}
                    strokeWidth={3}
                    className="flex-none"
                    style={{ color: active ? GREEN : 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    <span className="text-muted-foreground/45">{folder}</span>
                    <span className={active ? 'text-foreground' : 'text-muted-foreground'}>
                      {fileName(relative)}
                    </span>
                  </span>
                  {position === 0 && (
                    <span className="flex-none rounded-full bg-white/[0.06] px-1.75 py-0.75 text-[10px] font-semibold text-muted-foreground">
                      best guess
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};
