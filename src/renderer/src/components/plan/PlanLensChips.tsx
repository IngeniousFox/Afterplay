import type { PlanLens } from '../../lib/plan';
import { PLAN_LENSES } from '../../lib/plan';
import { GREEN } from '../../lib/colors';

type PlanLensChipsProps = {
  value: PlanLens;
  onChange: (lens: PlanLens) => void;
};

// Las LENTES (PLAN-TO-PLAY.md §2.4) — chips a la vista, no un desplegable de
// "ordenar por" enterrado en una esquina.
//
// La diferencia no es de estética: un desplegable con "Title A-Z / Date added
// / Rating" te obliga a traducir tu pregunta a una clave de ordenación. Estos
// cuatro chips SON las preguntas ("tengo esta noche", "¿por qué sigue
// aquí?"), y verlas todas a la vez recuerda que se pueden hacer — que es la
// mitad del valor de tenerlas.
export const PlanLensChips = ({ value, onChange }: PlanLensChipsProps): React.JSX.Element => (
  <div className="flex flex-wrap items-center gap-1.5">
    {PLAN_LENSES.map((lens) => {
      const active = lens.id === value;
      return (
        <button
          key={lens.id}
          type="button"
          onClick={() => onChange(lens.id)}
          // El subtítulo de la pregunta vive en el title y no en el chip: en
          // el chip sería el triple de ancho y los cuatro no cabrían en una
          // línea, que es justo lo que los hace comparables.
          title={lens.question}
          className="flex items-center gap-1.5 rounded-[9px] border px-2.75 py-1.5 text-[12px] font-bold whitespace-nowrap transition-[color,border-color,background-color] duration-150"
          style={
            active
              ? { color: GREEN, borderColor: `${GREEN}4d`, background: `${GREEN}1a` }
              : {
                  color: 'var(--muted-foreground)',
                  borderColor: 'var(--border)',
                  background: 'rgba(255,255,255,.028)',
                }
          }
        >
          <lens.Icon size={12} className="flex-none" />
          {lens.label}
        </button>
      );
    })}
  </div>
);
