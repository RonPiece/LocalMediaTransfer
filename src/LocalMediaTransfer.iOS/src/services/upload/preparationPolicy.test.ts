import {
  MAX_PREPARE_FIRST_ASSETS,
  STREAMING_PREPARATION_WINDOW_SIZE,
  STREAMING_READY_QUEUE_CAPACITY,
  resolvePreparationPolicy,
} from './preparationPolicy';

describe('resolvePreparationPolicy', () => {
  it('automatically streams large installed-app selections to bound temporary storage', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: true,
      selectedAssetCount: MAX_PREPARE_FIRST_ASSETS + 1,
    })).toEqual({
      requestedMode: 'prepare-first',
      effectiveMode: 'streaming',
      automaticallyStreamsLargeSelection: true,
      windowSize: STREAMING_PREPARATION_WINDOW_SIZE,
      queueCapacity: STREAMING_READY_QUEUE_CAPACITY,
    });
  });

  it('preserves prepare-first for one bounded native window', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: true,
      selectedAssetCount: MAX_PREPARE_FIRST_ASSETS,
    }).effectiveMode).toBe('prepare-first');
  });

  it('preserves explicit streaming and Expo Go compatibility behavior', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'streaming',
      nativeAvailable: true,
      selectedAssetCount: 1,
    }).effectiveMode).toBe('streaming');
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: false,
      selectedAssetCount: MAX_PREPARE_FIRST_ASSETS + 1,
    })).toEqual(expect.objectContaining({
      effectiveMode: 'prepare-first',
      automaticallyStreamsLargeSelection: false,
      windowSize: MAX_PREPARE_FIRST_ASSETS,
    }));
  });
});
