import { QueryClient } from '@tanstack/react-query';

// Instancia única para toda la app — un solo caché compartido por todos los
// hooks, sea cual sea el componente que los use.
export const queryClient = new QueryClient();
