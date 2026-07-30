import { ipcRenderer } from 'electron';
import type {
  ResolveSessionEpilogueInput,
  SessionEpilogue,
  SessionEpilogueSummary,
} from '../../shared/types';

export const sessionEpiloguesApi = {
  getPending: (): Promise<SessionEpilogueSummary[]> =>
    ipcRenderer.invoke('sessionEpilogues:getPending'),
  getById: (id: number): Promise<SessionEpilogueSummary | null> =>
    ipcRenderer.invoke('sessionEpilogues:getById', id),
  resolve: (input: ResolveSessionEpilogueInput): Promise<SessionEpilogue | null> =>
    ipcRenderer.invoke('sessionEpilogues:resolve', input),
};
