import { Search } from 'lucide-react';
import type { SteamSearchResult } from '../../../../../shared/types';
import { useSteamSearch } from '../../../hooks/igdb';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { BLUE } from '../../../lib/colors';

type SteamFallbackProps = {
  query: string;
  onSelect: (result: SteamSearchResult) => void;
};

// Una fila de resultado, con su miniatura de verdad.
//
// La imagen es una URL remota de Steam y el CSP de la app solo deja pasar
// afterplay-image: — así que NO se pinta a pelo, se resuelve por la caché de
// siempre (useImageSrc: la baja el main y la sirve por su propio protocolo),
// exactamente igual que las carátulas de IGDB en el buscador de al lado.
const SteamResultRow = ({
  result,
  onSelect,
}: {
  result: SteamSearchResult;
  onSelect: (result: SteamSearchResult) => void;
}): React.JSX.Element => {
  const src = useImageSrc(result.thumbnailUrl, 'covers');
  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className="flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-100 hover:bg-white/[0.05]"
    >
      <div className="h-11.5 w-23 flex-none overflow-hidden rounded-[7px] border border-white/10 bg-white/[0.03]">
        {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-foreground">{result.title}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">Steam · {result.appId}</div>
      </div>
    </button>
  );
};

// EL RESPALDO DEL BUSCADOR — lo que se enseña donde antes ponía "no hay
// juegos en el catálogo, prueba otro título".
//
// Ese mensaje era verdad a medias: el juego podía existir perfectamente y ser
// IGDB quien no lo tuviera todavía. Pasa con los recién anunciados — el caso
// que lo destapó fue "Enter the kOS", con página de tienda, tráiler y fecha,
// del que IGDB no sabía nada ni por nombre ni por appid. Decirle a alguien
// "prueba otro título" cuando el título es correcto es mandarlo a un callejón.
//
// Así que en vez de rendirse, se le pregunta a Steam. Solo cuando IGDB ha
// vuelto vacío: IGDB sigue siendo el catálogo bueno (plataformas, sagas,
// tráiler, capturas, notas de crítica) y esto es la puerta de atrás, no una
// alternativa al mismo nivel.
//
// Se avisa de lo que implica elegir por aquí, porque no es gratis: el juego
// nace con menos datos. Y se dice también que se arregla solo — los tres
// refrescos vigilan y, en cuanto IGDB lo meta, el juego cambia de fuente sin
// que haya que hacer nada (ver external/adoptIgdb.ts).
export const SteamFallback = ({ query, onSelect }: SteamFallbackProps): React.JSX.Element => {
  const { data: results, isLoading } = useSteamSearch(query);

  if (isLoading) {
    return (
      <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
        IGDB doesn&apos;t have it — asking Steam…
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.04]">
          <Search size={18} strokeWidth={1.5} className="text-muted-foreground/50" />
        </div>
        <p className="text-[13px] text-muted-foreground">
          Nothing found in IGDB or on Steam — try another title.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3.5 pt-3 pb-2">
        <div className="text-[10px] font-bold tracking-[.09em]" style={{ color: BLUE }}>
          NOT IN IGDB YET — FOUND ON STEAM
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Newly announced games take a while to reach IGDB. Add it from Steam and it comes with its
          cover, description and genres — Afterplay switches it over to IGDB on its own as soon as
          it shows up there.
        </p>
      </div>
      {results.map((result) => (
        <SteamResultRow key={result.appId} result={result} onSelect={onSelect} />
      ))}
    </div>
  );
};
