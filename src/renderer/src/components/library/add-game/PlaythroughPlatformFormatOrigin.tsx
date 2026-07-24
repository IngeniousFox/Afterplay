import { Dropdown } from './Dropdown';
import { SegmentedButtonGroup } from './SegmentedButtonGroup';
import { fieldLabelClass } from './styles';
import { FORMAT_OPTIONS, ORIGIN_SEGMENT_OPTIONS, PLATFORM_OPTIONS } from './types';

type PlaythroughPlatformFormatOriginProps = {
  platform: string;
  onPlatformChange: (value: string) => void;
  format: 'digital' | 'physical';
  onFormatChange: (value: 'digital' | 'physical') => void;
  origin: string;
  onOriginChange: (value: string) => void;
};

// Trío Platform/Format/Origin, compartido por ManualPlaythroughsField (los
// playthroughs extra de Add Game) y IterationSection (el modo "+ Add manual"
// de Edit Game) — mismas opciones, mismo layout, misma lógica en los dos
// sitios (a diferencia del bloque Started/Finished+Hours+Status, este trío
// SÍ era byte-idéntico entre ambos).
export const PlaythroughPlatformFormatOrigin = ({
  platform,
  onPlatformChange,
  format,
  onFormatChange,
  origin,
  onOriginChange,
}: PlaythroughPlatformFormatOriginProps): React.JSX.Element => (
  <>
    <div>
      <div className={fieldLabelClass}>PLATFORM</div>
      <Dropdown
        value={platform}
        options={PLATFORM_OPTIONS}
        onChange={onPlatformChange}
        renderOption={(option) => option}
        searchable
      />
    </div>

    <div>
      <div className={fieldLabelClass}>FORMAT</div>
      <SegmentedButtonGroup value={format} options={FORMAT_OPTIONS} onChange={onFormatChange} />
    </div>

    <div>
      <div className={fieldLabelClass}>ORIGIN</div>
      <SegmentedButtonGroup
        value={origin}
        options={ORIGIN_SEGMENT_OPTIONS}
        onChange={onOriginChange}
        wrap
      />
    </div>
  </>
);
