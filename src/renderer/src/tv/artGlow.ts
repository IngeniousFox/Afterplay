// EL COLOR DEL JUEGO: extrae el color vivo dominante del arte del backdrop
// para que la luz ambiental del modo TV sea la del juego que estás mirando —
// no un acento fijo por pantalla. Es la pieza que convierte "fondo bonito"
// en "el juego es la pantalla": mover el foco cambia el arte Y la luz.
//
// El muestreo es barato a conciencia: el arte se dibuja a 24×24 (el blur del
// backdrop ya lo ha alisado, así que 576 píxeles lo describen de sobra) y se
// puntúa cada píxel por saturación al cuadrado × luminancia con pico en los
// medios — buscamos el color VIVO que define el arte, no el blanco del cielo
// ni el negro de las sombras. El ganador se normaliza a tono de lámpara
// (saturación y luz clampeadas) para que cualquier arte dé una luz usable.
//
// Cache por URL de por vida del renderer: un arte = un color, calculado una
// vez. Si el canvas se mancha (protocolo sin CORS) o el arte no decodifica,
// null — y el shell cae al acento de la ruta, que para eso está.

const cache = new Map<string, string | null>();

const hslToHex = (h: number, s: number, l: number): string => {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export const extractArtGlow = async (src: string): Promise<string | null> => {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let bestScore = 0;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = max / 255;
      // sat² prima color franco sobre gris; lum·(1.15−lum) pica en medios.
      const score = sat * sat * lum * (1.15 - lum);
      if (score > bestScore) {
        bestScore = score;
        best = [r, g, b];
      }
    }
    if (!best) {
      cache.set(src, null);
      return null;
    }

    // A HSL y normalizado a "tono de lámpara": mantiene el TONO del arte
    // (que es su identidad) y fija saturación/luz a rango de luz ambiental.
    const [r, g, b] = best.map((channel) => channel / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;
    const color = hslToHex(h, 0.68, 0.56);
    cache.set(src, color);
    return color;
  } catch {
    cache.set(src, null);
    return null;
  }
};
