import {
  MAX_PREPARE_FIRST_ASSETS,
  STREAMING_PREPARATION_WINDOW_SIZE,
  STREAMING_READY_QUEUE_CAPACITY,
  resolvePreparationPolicy,
} from './preparationPolicy';

describe('resolvePreparationPolicy', () => {
  it('preserves an explicit prepare-first choice for large installed-app selections', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: true,
    })).toEqual({
      requestedMode: 'prepare-first',
      effectiveMode: 'prepare-first',
      windowSize: MAX_PREPARE_FIRST_ASSETS,
      queueCapacity: MAX_PREPARE_FIRST_ASSETS,
    });
  });

  it('preserves prepare-first for one bounded native window', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: true,
    }).effectiveMode).toBe('prepare-first');
  });

  it('preserves explicit streaming and Expo Go compatibility behavior', () => {
    expect(resolvePreparationPolicy({
      requestedMode: 'streaming',
      nativeAvailable: true,
    }).effectiveMode).toBe('streaming');
    expect(resolvePreparationPolicy({
      requestedMode: 'prepare-first',
      nativeAvailable: false,
    })).toEqual(expect.objectContaining({
      effectiveMode: 'prepare-first',
      windowSize: MAX_PREPARE_FIRST_ASSETS,
    }));
  });
});
