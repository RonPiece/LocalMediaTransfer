import { PreparationMode } from './types';

export const MAX_PREPARE_FIRST_ASSETS = 250;
export const STREAMING_PREPARATION_WINDOW_SIZE = 16;
export const STREAMING_READY_QUEUE_CAPACITY = 2;

export type PreparationPolicy = {
  requestedMode: PreparationMode;
  effectiveMode: PreparationMode;
  automaticallyStreamsLargeSelection: boolean;
  windowSize: number;
  queueCapacity: number;
};

/**
 * Prepare-first retains every exported PhotoKit component until upload starts.
 * Streaming uses small native windows so terminal files can be released while
 * later Photos assets are prepared. A native selection larger than one
 * prepare-first window automatically streams so it cannot retain an unbounded
 * amount of temporary PhotoKit output before upload begins.
 */
export function resolvePreparationPolicy({
  requestedMode,
  nativeAvailable,
  selectedAssetCount,
}: {
  requestedMode: PreparationMode;
  nativeAvailable: boolean;
  selectedAssetCount: number;
}): PreparationPolicy {
  const automaticallyStreamsLargeSelection = nativeAvailable &&
    requestedMode === 'prepare-first' &&
    selectedAssetCount > MAX_PREPARE_FIRST_ASSETS;
  const boundedNativeStreaming = nativeAvailable && (
    requestedMode === 'streaming' || automaticallyStreamsLargeSelection
  );

  return {
    requestedMode,
    effectiveMode: boundedNativeStreaming ? 'streaming' : requestedMode,
    automaticallyStreamsLargeSelection,
    windowSize: boundedNativeStreaming
      ? STREAMING_PREPARATION_WINDOW_SIZE
      : MAX_PREPARE_FIRST_ASSETS,
    queueCapacity: boundedNativeStreaming
      ? STREAMING_READY_QUEUE_CAPACITY
      : MAX_PREPARE_FIRST_ASSETS,
  };
}
