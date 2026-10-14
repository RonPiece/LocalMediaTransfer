import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceTransparencyEnabled } from './index';

describe('Reduce Transparency appearance subscription', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads the native preference, follows changes, and removes its listener', async () => {
    const remove = jest.fn();
    let listener: (value: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_name, handler) => {
      listener = handler as unknown as (value: boolean) => void;
      return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
    const view = renderHook(useReduceTransparencyEnabled);
    await waitFor(() => expect(view.result.current).toBe(true));
    act(() => listener(false));
    expect(view.result.current).toBe(false);
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a newer event with a delayed initial query', async () => {
    let finishQuery: (value: boolean) => void = () => {};
    let listener: (value: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockReturnValue(new Promise(resolve => { finishQuery = resolve; }));
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_name, handler) => {
      listener = handler as unknown as (value: boolean) => void;
      return { remove() {} } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
    const view = renderHook(useReduceTransparencyEnabled);
    act(() => listener(true));
    await act(async () => { finishQuery(false); });
    expect(view.result.current).toBe(true);
    view.unmount();
  });
});
