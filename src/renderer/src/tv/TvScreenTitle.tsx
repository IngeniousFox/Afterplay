import { tvRevealClass, tvRevealStyle } from './styles';

// EL RÓTULO DE PANTALLA: la firma tipográfica de cada habitación del modo
// TV. Antes cada pantalla escribía su título en texto plano y quedaba mudo —
// sin jerarquía frente a los chips que tiene al lado. Ahora el título lleva
// el mismo tratamiento de plata degradada que el titular del hero (la única
// tipografía "de cartel" de la casa) y, delante, su lámpara: un punto de luz
// encendido del color de la habitación (el mismo acento que routeAccent pone
// en el ambiente y el menú Start ya usa por entrada). Pantalla y ambiente
// dicen el mismo color — eso es lo que hace que se lea como habitación.
export const TvScreenTitle = ({
  label,
  accent,
  revealIndex = 0,
}: {
  label: string;
  accent: string;
  revealIndex?: number;
}): React.JSX.Element => (
  <span
    className={`flex items-center gap-[0.55em] ${tvRevealClass}`}
    style={tvRevealStyle(revealIndex)}
  >
    <span
      aria-hidden
      className="afterplay-tv-glow h-[0.4em] w-[0.4em] flex-none rounded-full"
      style={{ background: accent, boxShadow: `0 0 0.8em ${accent}cc` }}
    />
    {/* pb + leading holgado por la misma razón que el titular del hero: con
        background-clip:text se pinta el fondo de la CAJA recortado por los
        glifos, y un descendente que asome por debajo (la "y" de Library, la
        de January) se queda sin pintar. */}
    <h1
      className="pb-[0.1em] text-[1.5em] leading-[1.18] font-extrabold tracking-[-.015em]"
      style={{
        backgroundImage: 'linear-gradient(180deg, #ffffff 52%, rgba(255,255,255,.66))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 2px 14px rgba(0,0,0,.5))',
      }}
    >
      {label}
    </h1>
  </span>
);
