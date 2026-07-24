import { BLUE } from '../../../lib/colors';
import { fieldLabelClass } from './styles';

// Chapa numerada + rótulo "PLAYTHROUGH". Compartida por el PRIMER playthrough
// (PlayedBeforePanel) y por los extra (ManualPlaythroughsField): antes solo
// los extra llevaban número, así que la lista empezaba en un bloque sin
// numerar y seguía por el 2 — se leía como si el primero fuese otra cosa.
export const PlaythroughLabel = ({ number }: { number: number }): React.JSX.Element => (
  <div className="flex items-center gap-2">
    <span
      className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10.5px] font-extrabold tabular-nums"
      style={{ background: `${BLUE}26`, color: BLUE }}
    >
      {number}
    </span>
    <span className={fieldLabelClass}>PLAYTHROUGH</span>
  </div>
);
