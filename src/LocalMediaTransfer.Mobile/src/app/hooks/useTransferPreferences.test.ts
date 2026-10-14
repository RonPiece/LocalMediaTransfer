import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTransferPreferences } from './useTransferPreferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('useTransferPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('defaults to full upfront preparation and persists streaming when enabled', async () => {
    const { result } = renderHook(() => useTransferPreferences());
    expect(result.current.preparationMode).toBe('prepare-first');
    expect(result.current.skipExactDuplicates).toBe(true);
    expect(result.current.includeAdditionalMediaComponents).toBe(false);

    act(() => result.current.persistPreparationMode('streaming'));
    expect(result.current.preparationMode).toBe('streaming');
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'lmt_preparation_mode',
      'streaming',
    ));
  });

  it('restores and persists the default-off additional-media preference', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'lmt_include_additional_media_components' ? 'true' : null
    );
    const { result } = renderHook(() => useTransferPreferences());
    await waitFor(() => expect(result.current.includeAdditionalMediaComponents).toBe(true));

    act(() => result.current.persistIncludeAdditionalMediaComponents(false));
    expect(result.current.includeAdditionalMediaComponents).toBe(false);
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'lmt_include_additional_media_components',
      'false',
    ));
  });

  it('restores and persists the environment-scoped exact-duplicate preference', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'lmt_skip_exact_duplicates' ? 'false' : null
    );
    const { result } = renderHook(() => useTransferPreferences());
    await waitFor(() => expect(result.current.skipExactDuplicates).toBe(false));

    act(() => result.current.persistSkipExactDuplicates(true));
    expect(result.current.skipExactDuplicates).toBe(true);
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'lmt_skip_exact_duplicates',
      'true',
    ));
  });

  it('restores the persisted streaming preference', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('streaming');
    const { result } = renderHook(() => useTransferPreferences());
    await waitFor(() => expect(result.current.preparationMode).toBe('streaming'));
  });

  it('does not let a late hydration result overwrite a user choice', async () => {
    let resolveLoad: (value: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(resolve => {
      resolveLoad = resolve;
    }));
    const { result } = renderHook(() => useTransferPreferences());

    act(() => result.current.persistPreparationMode('streaming'));
    await act(async () => resolveLoad('prepare-first'));

    expect(result.current.preparationMode).toBe('streaming');
  });

  it('serializes persistence so the latest toggle is written last', async () => {
    const completions: (() => void)[] = [];
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      () => new Promise<void>(resolve => completions.push(resolve)),
    );
    const { result } = renderHook(() => useTransferPreferences());

    act(() => {
      result.current.persistPreparationMode('streaming');
      result.current.persistPreparationMode('prepare-first');
    });

    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1));
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      1,
      'lmt_preparation_mode',
      'streaming',
    );
    await act(async () => completions.shift()?.());
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2));
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      2,
      'lmt_preparation_mode',
      'prepare-first',
    );
    await act(async () => completions.shift()?.());
  });

  it('keeps the session choice and reports a persistence failure', async () => {
    const onPersistenceError = jest.fn();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('storage full'));
    const { result } = renderHook(() => useTransferPreferences({ onPersistenceError }));

    act(() => result.current.persistPreparationMode('streaming'));

    expect(result.current.preparationMode).toBe('streaming');
    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
  });
});
