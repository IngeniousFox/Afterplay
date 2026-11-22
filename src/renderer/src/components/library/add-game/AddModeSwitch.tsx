import { FolderSearch, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// El conmutador de Add game (ficha-add-buscar.png / ficha-add-escanear.png):
// las dos vías de alta, una al lado de la otra y no escondidas en un menú —
// quien acaba de instalar un juego no quiere teclear su nombre, quiere que la
// app lo encuentre en su disco.
export const AddModeSwitch = ({
  mode,
  onSearch,
  onScan,
}: {
  mode: 'search' | 'scan';
  onSearch: () => void;
  onScan: () => void;
}): React.JSX.Element => {
  const item = (active: boolean): string =>
    cn(
      'flex h-8 items-center gap-2 rounded-xs px-3.5 text-body font-semibold transition-colors duration-150',
      'outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phosphor',
      active ? 'bg-raised text-bone shadow-lift' : 'text-dust hover:text-bone',
    );
  return (
    <div className="mb-3.5 inline-flex rounded-sm border border-line-strong bg-inset p-0.5">
      <button
        type="button"
        aria-pressed={mode === 'search'}
        onClick={onSearch}
        className={item(mode === 'search')}
      >
        <Search size={14} />
        Search the catalog
      </button>
      <button
        type="button"
        aria-pressed={mode === 'scan'}
        onClick={onScan}
        className={item(mode === 'scan')}
      >
        <FolderSearch size={14} />
        Scan your folders
      </button>
    </div>
  );
};
