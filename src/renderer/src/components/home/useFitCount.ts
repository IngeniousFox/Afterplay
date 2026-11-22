import { useCallback, useEffect, useRef, useState } from 'react';

// Cuántas portadas de al menos `minWidth` caben en UNA fila del contenedor.
// Las estanterías de Home son una sola fila: en vez de cortar la que no cabe
// (y dejarla enfocable pero invisible), se pintan solo las que caben.
export const useFitCount = (
  minWidth: number,
  gap: number,
): { attach: (element: HTMLElement | null) => void; count: number } => {
  const [count, setCount] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const attach = useCallback(
    (element: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!element) return;
      const measure = (width: number): void =>
        setCount(Math.max(1, Math.floor((width + gap) / (minWidth + gap))));
      measure(element.getBoundingClientRect().width);
      observer.current = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
      observer.current.observe(element);
    },
    [minWidth, gap],
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { attach, count };
};
