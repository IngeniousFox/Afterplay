import { handle } from './contractHandlers';
import type { GetSgdbImagesInput } from '../../shared/types';
import { getSgdbImages } from '../sgdb/api';

export const registerSgdbHandlers = (): void => {
  handle('sgdb:getImages', async (_event, input: GetSgdbImagesInput) => {
    return getSgdbImages(input);
  });
};
