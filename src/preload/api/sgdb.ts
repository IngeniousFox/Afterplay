import { ipcRenderer } from 'electron';
import type { GetSgdbImagesInput, SgdbImages } from '../../shared/types';

export const sgdbApi = {
  getImages: (input: GetSgdbImagesInput): Promise<SgdbImages> =>
    ipcRenderer.invoke('sgdb:getImages', input),
};
