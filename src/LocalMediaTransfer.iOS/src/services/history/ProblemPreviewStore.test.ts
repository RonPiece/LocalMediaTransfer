import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeCapabilities } from '../NativeCapabilities';
import { clearProblemPreviews, loadProblemPreviews, MAX_PROBLEM_PREVIEWS, pruneProblemPreviews, saveProblemPreviews } from './ProblemPreviewStore';
import { MediaAsset } from '../MediaScanner';

jest.mock('../NativeCapabilities', () => ({ nativeCapabilities: { available: true, historyThumbnails: jest.fn().mockResolvedValue([]) } }));
const asset: MediaAsset = { id: 'local-fixture', uri: 'ph://local-fixture', type: 'photo', filename: 'fixture', width: 100, height: 100, modificationTime: 1 };
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(nativeCapabilities.historyThumbnails).mockReset().mockResolvedValue([]);
});
it('joins by receiver/session/exact file ID and keeps Photos metadata off the wire', async () => {
  jest.mocked(nativeCapabilities.historyThumbnails).mockResolvedValue([{ assetId: asset.id, jpegBase64: 'AQ==' }]);
  await saveProblemPreviews('receiver-a', 'session-a', [{ fileId: 'variant-a', asset }, { fileId: 'variant-b', asset }]);
  const previews = await loadProblemPreviews('receiver-a', 'session-a');
  expect(previews.size).toBe(2);
  expect(previews.get('variant-a')?.uri).toBe('data:image/jpeg;base64,AQ==');
  expect(previews.get('variant-b')?.assetId).toBe(asset.id);
  expect((await loadProblemPreviews('receiver-b', 'session-a')).size).toBe(0);
  expect((await loadProblemPreviews('receiver-a', 'session-b')).size).toBe(0);
  expect(previews.get('same-filename-different-id')).toBeUndefined();
  expect(nativeCapabilities.historyThumbnails).toHaveBeenCalledTimes(1);
  expect((await AsyncStorage.getAllKeys()).filter(key => key.includes(':image:'))).toHaveLength(1);
});
it('bounds retention, batches and evicts only owned thumbnail keys', async () => {
  await AsyncStorage.setItem('unrelated-setting', 'preserve');
  jest.mocked(nativeCapabilities.historyThumbnails).mockImplementation(async ids => ids.map(assetId => ({ assetId, jpegBase64: 'AQ==' })));
  const requests = Array.from({ length: MAX_PROBLEM_PREVIEWS + 20 }, (_, index) => ({ fileId: `variant-${index}`, asset: { ...asset, id: `asset-${index}` } }));
  await saveProblemPreviews('receiver-a', 'session-a', requests);
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(MAX_PROBLEM_PREVIEWS);
  expect(jest.mocked(nativeCapabilities.historyThumbnails).mock.calls.every(([ids]) => ids.length <= 20)).toBe(true);
  await saveProblemPreviews('receiver-b', 'session-b', requests);
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(0);
  expect((await AsyncStorage.getAllKeys()).filter(key => key.includes(':image:'))).toHaveLength(MAX_PROBLEM_PREVIEWS);
  expect(await AsyncStorage.getItem('unrelated-setting')).toBe('preserve');
});
it('invalidates in-flight capture on clear and preserves other receivers', async () => {
  await saveProblemPreviews('receiver-b', 'session-b', [{ fileId: 'b', asset }]);
  let release!: (value: { assetId: string; jpegBase64: string }[]) => void;
  const started = new Promise<void>(resolve => {
    jest.mocked(nativeCapabilities.historyThumbnails).mockImplementationOnce(() => { resolve(); return new Promise(done => { release = done; }); });
  });
  const saving = saveProblemPreviews('receiver-a', 'session-a', [{ fileId: 'a', asset }]);
  await started;
  const clearing = clearProblemPreviews('receiver-a');
  release([{ assetId: asset.id, jpegBase64: 'AQ==' }]);
  await saving; await clearing;
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(0);
  expect((await loadProblemPreviews('receiver-b', 'session-b')).size).toBe(1);
});
it('keeps a local asset reference if capture is unsupported or denied', async () => {
  jest.mocked(nativeCapabilities.historyThumbnails).mockRejectedValue(new Error('permission'));
  await saveProblemPreviews('receiver-a', 'session-a', [{ fileId: 'variant-a', asset }]);
  expect((await loadProblemPreviews('receiver-a', 'session-a')).get('variant-a')?.assetId).toBe(asset.id);
  expect((await loadProblemPreviews('receiver-a', 'session-a')).get('variant-a')?.uri).toBe('');
});
it('ignores corrupt metadata and expired records', async () => {
  await AsyncStorage.setItem('lmt_problem_preview_index', 'bad json');
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(0);
  await AsyncStorage.setItem('lmt_problem_preview_index', JSON.stringify([{ scope: 'receiver-a', sessionId: 'session-a', fileId: 'v', assetId: 'a', mediaType: 'photo', createdAt: 1 }]));
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(0);
});

it('prunes expired previews and orphaned images at startup', async () => {
  await AsyncStorage.setItem('lmt_problem_preview_index', JSON.stringify([{ scope: 'receiver-a', sessionId: 'session-a', fileId: 'v', assetId: 'a', mediaType: 'photo', createdAt: 1, imageKey: 'lmt_problem_preview_index:image:old' }]));
  await AsyncStorage.setItem('lmt_problem_preview_index:image:old', 'data:image/jpeg;base64,AQ==');
  await AsyncStorage.setItem('unrelated-setting', 'keep');
  await pruneProblemPreviews();
  expect(await AsyncStorage.getItem('lmt_problem_preview_index:image:old')).toBeNull();
  expect(await AsyncStorage.getItem('unrelated-setting')).toBe('keep');
});
it('continues optional capture after a cleanup storage failure', async () => {
  const setItem = jest.mocked(AsyncStorage.setItem);
  const implementation = setItem.getMockImplementation()!;
  setItem.mockRejectedValueOnce(new Error('storage'));
  await expect(clearProblemPreviews('receiver-a')).rejects.toThrow('storage');
  setItem.mockImplementation(implementation);
  await saveProblemPreviews('receiver-a', 'session-a', [{ fileId: 'v', asset }]);
  expect((await loadProblemPreviews('receiver-a', 'session-a')).size).toBe(1);
});

it('caps pending jobs instead of growing work with successive transfers', async () => {
  let release!: (value: { assetId: string; jpegBase64: string }[]) => void;
  const started = new Promise<void>(resolve => {
    jest.mocked(nativeCapabilities.historyThumbnails).mockImplementationOnce(() => { resolve(); return new Promise(done => { release = done; }); });
  });
  const requests = [{ fileId: 'v', asset }];
  const first = saveProblemPreviews('receiver-a', 'first', requests);
  await started;
  const second = saveProblemPreviews('receiver-a', 'second', requests);
  const third = saveProblemPreviews('receiver-a', 'third', requests);
  await saveProblemPreviews('receiver-a', 'dropped', requests);
  release([]);
  await Promise.all([first, second, third]);
  expect((await loadProblemPreviews('receiver-a', 'dropped')).size).toBe(0);
  expect((await loadProblemPreviews('receiver-a', 'third')).size).toBe(1);
});
