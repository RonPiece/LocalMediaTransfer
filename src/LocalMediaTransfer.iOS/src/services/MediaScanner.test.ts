import * as MediaLibrary from 'expo-media-library';
import { MediaScanner } from './MediaScanner';

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(), getAssetsAsync: jest.fn(),
  SortBy: { creationTime: 'creationTime' }, MediaType: { photo: 'photo', video: 'video' },
}));
beforeEach(() => jest.resetAllMocks());

it('collects consecutive pages once, with the requested album and normalized media', async () => {
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
  jest.mocked(MediaLibrary.getAssetsAsync)
    .mockResolvedValueOnce({ assets: [{ id: 'one', mediaType: 'photo' }], hasNextPage: true, endCursor: 'cursor' } as never)
    .mockResolvedValueOnce({ assets: [{ id: 'two', mediaType: 'video' }], hasNextPage: false } as never);
  const result = await new MediaScanner().getAllMedia('album');
  expect(result.map(({ id, type }) => ({ id, type }))).toEqual([
    { id: 'one', type: 'photo' }, { id: 'two', type: 'video' },
  ]);
  expect(MediaLibrary.getAssetsAsync).toHaveBeenNthCalledWith(2,
    expect.objectContaining({ first: 500, album: 'album', after: 'cursor' }));
  expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledTimes(2);
});
it('does not enumerate assets when permission is denied', async () => {
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
  expect(await new MediaScanner().getAllMedia()).toEqual([]);
  expect(MediaLibrary.getAssetsAsync).not.toHaveBeenCalled();
});
