import { useMemo } from 'react';
import { encode } from 'uqr';

// Un QR pintado como SVG a partir de la matriz que calcula `uqr` (va dentro
// del bundle: nada se pide a la red). Módulos oscuros sobre fondo claro, con
// su margen de silencio, para que lo lea cualquier cámara: un QR en ámbar
// sobre negro es bonito y la mitad de los lectores no lo ve.
//
// Un solo <path> con un cuadrado por módulo en vez de cientos de <rect>.
export const QrCode = ({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}): React.JSX.Element => {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#f4f0e6" />
      <path d={path} fill="#101416" />
    </svg>
  );
};
