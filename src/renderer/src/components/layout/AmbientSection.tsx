import { useAmbientIdleMinutes, useSetAmbientIdleMinutes } from '../../hooks/settings';
import { Dropdown } from '../library/add-game/Dropdown';
import { SettingsCard, SettingsRow } from './SettingsCard';

// Cuánto tarda en entrar el modo ambiente, o apagarlo del todo.
//
// Las opciones son minutos concretos y no un campo libre a propósito: el
// valor exacto no importa (¿2 minutos y medio?), lo que importa es elegir
// entre "enseguida", "cuando de verdad me he ido" y "nunca". Un desplegable
// con cuatro opciones responde eso mejor que un número que hay que teclear.
const OPTIONS = ['0', '1', '2', '3', '5', '10', '30'] as const;

const LABELS: Record<string, string> = {
  '0': 'Never',
  '1': 'After 1 minute',
  '2': 'After 2 minutes',
  '3': 'After 3 minutes',
  '5': 'After 5 minutes',
  '10': 'After 10 minutes',
  '30': 'After 30 minutes',
};

export const AmbientSection = (): React.JSX.Element => {
  const { data: minutes = 3 } = useAmbientIdleMinutes();
  const setMinutes = useSetAmbientIdleMinutes();

  // Un valor guardado que no esté entre las opciones (editado a mano en
  // config.json) no puede dejar el desplegable en blanco: se enseña el más
  // cercano de la lista.
  const value = OPTIONS.includes(String(minutes) as (typeof OPTIONS)[number])
    ? String(minutes)
    : '3';

  return (
    <SettingsCard
      title="Ambient mode"
      description="When you leave the app alone, your library takes over the screen and drifts by. Move the mouse and it steps aside."
      flush
    >
      <SettingsRow
        label="Start after"
        description="Never while a game is running or a dialog is open."
        control={
          <div className="w-48 flex-none">
            <Dropdown
              value={value}
              options={[...OPTIONS]}
              onChange={(next) => setMinutes.mutate(Number(next))}
              renderOption={(option) => LABELS[option]}
              // Hacia abajo: esta fila vive arriba de la página y hacia
              // arriba el desplegable se recortaba contra el borde del scroll.
              openDirection="down"
            />
          </div>
        }
      />
    </SettingsCard>
  );
};
