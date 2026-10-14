import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { api } from '@/api/ApiClient';
import { clearProblemPreviews } from '@/services/history/ProblemPreviewStore';
import { useReceiverHistory } from './useReceiverHistory';

let mockScope = 'receiver-a';
jest.mock('@/api/ApiClient', () => ({ api: { get url() { return mockScope; }, getHistory: jest.fn(), clearHistory: jest.fn() } }));
jest.mock('@/services/history/ProblemPreviewStore', () => ({ clearProblemPreviews: jest.fn().mockResolvedValue(undefined) }));
beforeEach(() => {
  mockScope = 'receiver-a';
  jest.clearAllMocks();
  jest.mocked(api.getHistory).mockResolvedValue([{ sessionId: 'initial' }]);
  jest.mocked(api.clearHistory).mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
function deleteAction() {
  return jest.mocked(Alert.alert).mock.calls[0][2]!.find(button => button.text === 'Delete')!.onPress!;
}
it('invalidates a refresh that returns old history after deletion', async () => {
  const { result } = renderHook(() => useReceiverHistory({ isConnected: true }));
  await act(async () => { await result.current.refresh(); });
  let resolveHistory!: (value: { sessionId: string }[]) => void;
  jest.mocked(api.getHistory).mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve; }));
  act(() => { void result.current.refresh(); });
  act(() => result.current.confirmClear());
  await act(async () => { await deleteAction()(); });
  await act(async () => { resolveHistory([{ sessionId: 'stale' }]); });
  expect(result.current.items).toEqual([]);
  expect(result.current.loading).toBe(false);
  expect(clearProblemPreviews).toHaveBeenCalledWith('receiver-a');
});
it('does not delete another receiver after a confirmation remains open', async () => {
  const { result } = renderHook(() => useReceiverHistory({ isConnected: true }));
  act(() => result.current.confirmClear());
  mockScope = 'receiver-b';
  await act(async () => { await deleteAction()(); });
  expect(api.clearHistory).not.toHaveBeenCalled();
  expect(clearProblemPreviews).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Could not delete history', expect.stringContaining('receiver changed'));
});
