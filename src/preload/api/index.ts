import { gamesApi } from './games';
import { windowApi } from './window';

export const api = {
  window: windowApi,
  games: gamesApi,
};

export type Api = typeof api;
