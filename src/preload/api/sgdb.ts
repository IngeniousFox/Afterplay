import { invoke } from '../ipc';
import type { GetSgdbImagesInput, SgdbImages } from '../../shared/types';

export const sgdbApi = {
  getImages: (input: GetSgdbImagesInput): Promise<SgdbImages> => invoke('sgdb:getImages', input),
};
