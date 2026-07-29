import { useEffect, useState } from 'react';

// Si la ventana está en fullscreen real de SO (F11) — lo avisa el main
// process, que es quien de verdad lo sabe (ver 'enter-full-screen' en
// main/index.ts).
export const useFullscreen = (): boolean => {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => window.api.window.onFullscreenChange(setFullscreen), []);

  return fullscreen;
};
