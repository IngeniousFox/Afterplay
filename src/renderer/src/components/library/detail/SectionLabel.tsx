type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

// Eyebrow de sección repetido en Status/Session History/History/
// Screenshots/Notes — mismo texto pequeño, mayúsculas, tracking ancho. Sin
// margen propio: cada sitio decide si necesita mb-3.25 (título solo, ver
// StatusCard/SessionHistoryList/HistoryList) o ninguno (dentro de una fila
// con más contenido al lado, ver ScreenshotsCarousel/NotesSection — un <div>
// funciona igual que el <span> que tenía NotesSection dentro de una fila
// flex, y a diferencia de un span sí respeta el margin-bottom donde hace
// falta).
export const SectionLabel = ({ children, className }: SectionLabelProps): React.JSX.Element => (
  <div
    className={`text-[11px] font-bold tracking-[.13em] text-muted-foreground ${className ?? ''}`}
  >
    {children}
  </div>
);
