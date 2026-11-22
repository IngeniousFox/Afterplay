import { Gamepad2 } from 'lucide-react';
import { cn } from '../lib/cn';

type CoverProps = {
  url: string | null;
  title: string;
  className?: string;
};

// La carátula, con el acabado de Fósforo: formato 3/4, esquinas de 4 px (las
// de los controles), filo tenue y `brightness-90` para que el arte no compita
// con el texto de al lado.
//
// Aquí las URLs se cargan DIRECTAS del CDN de IGDB/SteamGridDB. En el
// escritorio hace falta el protocolo afterplay-image: y una caché en disco,
// pero eso es una restricción del CSP de Electron: en un navegador normal no
// aplica (REMOTO.md §2.1). Un regalo, no un descuido.
export const Cover = ({ url, title, className = '' }: CoverProps): React.JSX.Element => (
  <div
    className={cn(
      'relative aspect-3/4 shrink-0 overflow-hidden rounded-sm border border-line bg-raised',
      className,
    )}
  >
    {url ? (
      <img
        src={url}
        alt={title}
        loading="lazy"
        className="block h-full w-full object-cover brightness-90"
      />
    ) : (
      // Sin arte, un mando: en Fósforo las carátulas van siempre junto a su
      // título, así que repetirlo dentro (a 30 px de ancho) solo estorbaba.
      <div className="flex h-full w-full items-center justify-center bg-raised">
        <Gamepad2 size={18} strokeWidth={1.5} className="w-1/2 max-w-6 text-dust/60" />
        <span className="sr-only">{title}</span>
      </div>
    )}
  </div>
);
