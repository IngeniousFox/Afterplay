type StatCardEmptyProps = {
  children: React.ReactNode;
};

// Mensaje de "sin datos" de una stat card — mismo <p> repetido en 8 sitios
// con solo el texto cambiando (a veces según el año elegido). El texto se
// queda a medida de cada card, solo el envoltorio se comparte.
export const StatCardEmpty = ({ children }: StatCardEmptyProps): React.JSX.Element => (
  <p className="text-xs text-muted-foreground">{children}</p>
);
