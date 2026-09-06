// La cascada de entrada del modo TV — la pareja de revealClass/revealStyle
// de escritorio (lib/styles.ts), con su propio ritmo: pasos de 70ms y tope en
// el octavo, porque a partir de ahí la cola de retardos ya no se lee como
// cascada sino como lentitud.

export const tvRevealClass =
  'afterplay-tv-reveal animate-[afterplay-tv-reveal-in_640ms_cubic-bezier(0.22,1,0.36,1)_both]';

export const tvRevealStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 8) * 70}ms`,
});
