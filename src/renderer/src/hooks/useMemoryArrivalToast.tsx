import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { VIOLET } from '../lib/colors';
import { queryKeys } from './queryKeys';

// "Your June story is ready" — el aviso de aterrizaje de un recap AUTOMÁTICO
// (AFTERPLAY-LOOP.md §3.3). Discreto a propósito: un toast que se va solo y
// lleva al Journey con ese mes a la vista, nada de badges ni contadores. Los
// recaps del backfill manual NO avisan (origin 'manual'): una pasada de 40
// meses no puede disparar 40 toasts — su progreso vive en Ajustes.
//
// Una sola suscripción para toda la app, montada en la raíz (RootLayout),
// como useSessionClosedToast. De paso es quien invalida las queries de
// memories ante CUALQUIER actividad: el hook gemelo de Ajustes solo vive
// mientras el modal está abierto, y el Journey tiene que refrescarse igual
// con Ajustes cerrado.

const TOAST_DURATION_MS = 12_000;

const storyLabel = (scopeType: 'month' | 'year', scopeKey: string): string => {
  if (scopeType === 'year') return `Your ${scopeKey} story is ready`;
  const [year, month] = scopeKey.split('-').map(Number);
  const monthName = new Date(year, (month ?? 1) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
  });
  // El año solo cuando no es el corriente: "Your June story" se entiende
  // solo; "Your June 2025 story" hace falta si llegó con retraso.
  const suffix = year === new Date().getFullYear() ? '' : ` ${year}`;
  return `Your ${monthName}${suffix} story is ready`;
};

export const useMemoryArrivalToast = (): void => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.memories.onActivity((event) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
      if (event.kind !== 'generated' || event.origin !== 'auto') return;

      const target =
        event.scopeType === 'month'
          ? `/stats?view=journey&month=${event.scopeKey}`
          : `/stats?view=journey&year=${event.scopeKey}`;
      const label = storyLabel(event.scopeType, event.scopeKey);

      toast.custom(
        (id) => (
          <button
            type="button"
            onClick={() => {
              navigate(target);
              toast.dismiss(id);
            }}
            className="group flex w-full items-center gap-3 rounded-[14px] border border-input bg-[#141614] px-3.5 py-3 text-left shadow-[0_20px_55px_rgba(0,0,0,.6)] transition-colors duration-150 hover:border-white/25"
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
              style={{ background: `${VIOLET}24` }}
            >
              <BookOpen size={16} style={{ color: VIOLET }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-foreground">{label}</span>
              <span className="mt-0.5 block text-[11.5px] font-semibold text-muted-foreground">
                Read it in your Journey
              </span>
            </span>
            <ArrowRight
              size={15}
              className="flex-none text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-0.5"
              style={{ color: `${VIOLET}cc` }}
            />
          </button>
        ),
        // Sin id fijo: dos periodos aterrizando seguidos (mes + año en enero)
        // son dos noticias distintas y se apilan, no se pisan.
        { duration: TOAST_DURATION_MS },
      );
    });
  }, [navigate, queryClient]);
};
