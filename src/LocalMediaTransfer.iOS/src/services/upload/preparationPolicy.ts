import { PreparationMode } from './types';

export const MAX_PREPARE_FIRST_ASSETS = 250;
export const STREAMING_PREPARATION_WINDOW_SIZE = 16;
export const STREAMING_READY_QUEUE_CAPACITY = 2;

export type PreparationPolicy = {
  requestedMode: PreparationMode;
  effectiveMode: PreparationMode;
  windowSize: number;
  queueCapacity: number;
};

/**
 * Prepare-first retains every exported PhotoKit component until upload starts.
 * Streaming uses small native windows so terminal files can be released while
 * later Photos assets are prepared. The requested mode is authoritative: a
 * storage tradeoff must never silently change the user's scheduling choice.
 */
export function resolvePreparationPolicy({
  requestedMode,
  nativeAvailable,
}: {
  requestedMode: PreparationMode;
  nativeAvailable: boolean;
}): PreparationPolicy {
  const boundedNativeStreaming = nativeAvailable && requestedMode === 'streaming';

  return {
    requestedMode,
    effectiveMode: requestedMode,
    windowSize: boundedNativeStreaming
      ? STREAMING_PREPARATION_WINDOW_SIZE
      : MAX_PREPARE_FIRST_ASSETS,
    queueCapacity: boundedNativeStreaming
      ? STREAMING_READY_QUEUE_CAPACITY
      : MAX_PREPARE_FIRST_ASSETS,
  };
}
