import './assets/main.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Afterplay from './Afterplay';
import TitleBar from './components/TitleBar';
import { queryClient } from './lib/queryClient';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TitleBar />
      <Afterplay />
    </QueryClientProvider>
  </StrictMode>,
);
