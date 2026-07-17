type QueryStatePlaceholderProps = {
  isLoading: boolean;
  loadingText?: string;
  errorText: string;
  backLabel: string;
  onBack: () => void;
};

// Bloques loading/error con botón de volver, triplicados en GameDetail,
// PlanGameDetail y GameStats — cada uno con sus textos/etiquetas propios.
export const QueryStatePlaceholder = ({
  isLoading,
  loadingText = 'Loading…',
  errorText,
  backLabel,
  onBack,
}: QueryStatePlaceholderProps): React.JSX.Element => {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{loadingText}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-sm text-destructive">{errorText}</p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-[10px] border border-input bg-white/3 px-4 py-2 text-[13px] font-semibold text-foreground"
      >
        {backLabel}
      </button>
    </div>
  );
};
