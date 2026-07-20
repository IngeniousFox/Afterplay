import type { LucideIcon } from 'lucide-react';

type InfoChipProps = {
  Icon?: LucideIcon;
  children: React.ReactNode;
  // Acento propio (género destacado, formato físico…). Sin color, la píldora
  // es neutra — que es lo que debe ser la mayoría: si todo va coloreado, el
  // color deja de significar nada.
  color?: string;
  title?: string;
};

// Píldora de dato secundario del detalle (plataforma, formato, origen,
// géneros). Sustituye a las filas `label —— valor` que antes repetían
// Playthrough y Details: esos campos son etiquetas, no medidas, y como
// píldoras ocupan una fila en vez de seis y se leen de un vistazo.
export const InfoChip = ({ Icon, children, color, title }: InfoChipProps): React.JSX.Element => (
  <span
    title={title}
    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.25 py-1 text-[11.5px] font-semibold"
    style={
      color
        ? { color, borderColor: `${color}3d`, background: `${color}14` }
        : {
            color: 'var(--muted-foreground)',
            borderColor: 'var(--border)',
            background: 'rgba(255,255,255,.028)',
          }
    }
  >
    {Icon && <Icon size={12} className="flex-none" />}
    <span className="truncate">{children}</span>
  </span>
);
