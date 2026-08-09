import { Gamepad2 } from 'lucide-react';

type CoverProps = {
  url: string | null;
  title: string;
  className?: string;
};

// La carátula, con el mismo acabado que el escritorio: formato 3/4, esquinas
// a 13px, borde tenue y `brightness-90` para que el arte no compita con el
// texto de al lado (GameCard.tsx).
//
// Aquí las URLs se cargan DIRECTAS del CDN de IGDB/SteamGridDB. En el
// escritorio hace falta el protocolo afterplay-image: y una caché en disco,
// pero eso es una restricción del CSP de Electron: en un navegador normal no
// aplica (REMOTO.md §2.1). Un regalo, no un descuido.
export const Cover = ({ url, title, className = '' }: CoverProps): React.JSX.Element => (
  <div
    className={`relative aspect-3/4 shrink-0 overflow-hidden rounded-[13px] border border-border bg-card ${className}`}
  >
    {url ? (
      <img
        src={url}
        alt={title}
        loading="lazy"
        className="block h-full w-full object-cover brightness-90"
      />
    ) : (
      // Sin arte, el título en texto: es lo único que identifica al juego.
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted px-2 text-center">
        <Gamepad2 size={22} strokeWidth={1.5} className="text-muted-foreground/40" />
        <span className="line-clamp-3 text-[10px] font-semibold text-muted-foreground">
          {title}
        </span>
      </div>
    )}
  </div>
);
