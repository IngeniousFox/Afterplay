let requestedEpilogueId: number | null = null;
const listeners = new Set<() => void>();

const emitChange = (): void => {
  for (const listener of listeners) listener();
};

export const requestSessionEpilogueReview = (id: number): void => {
  requestedEpilogueId = id;
  emitChange();
};

export const closeSessionEpilogueReview = (): void => {
  requestedEpilogueId = null;
  emitChange();
};

export const subscribeSessionEpilogueReview = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSessionEpilogueReview = (): number | null => requestedEpilogueId;
