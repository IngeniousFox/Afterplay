type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

// Título de sección repetido en Status/Session History/History/
// Screenshots/Notes. Fósforo no usa eyebrows en mayúsculas: minúscula normal
// en Barlow semibold, el estilo de los títulos de panel (text-lead). Sin
// margen propio: cada sitio decide si necesita mb-3.25 (título solo, ver
// StatusCard/SessionHistoryList/HistoryList) o ninguno (dentro de una fila
// con más contenido al lado, ver ScreenshotsCarousel/NotesSection).
export const SectionLabel = ({ children, className }: SectionLabelProps): React.JSX.Element => (
  <div className={`text-lead font-semibold text-bone ${className ?? ''}`}>{children}</div>
);
