import { PreparationMode } from './types';

type TransferPipelineOptions = {
  preparationMode: PreparationMode;
  produce: (enqueueImmediately: boolean) => Promise<boolean>;
  finishPreparation: () => void;
  closeReadyQueue: () => void;
  enqueuePreparedWindows: () => Promise<void>;
  runWorkers: () => Promise<void>[];
};

/**
 * Owns only phase scheduling. Preparation, duplicate decisions, transport, and
 * presentation stay in their focused services/callers.
 */
export async function runTransferPipeline({
  preparationMode,
  produce,
  finishPreparation,
  closeReadyQueue,
  enqueuePreparedWindows,
  runWorkers,
}: TransferPipelineOptions): Promise<boolean> {
  if (preparationMode === 'streaming') {
    const [preparedAll] = await Promise.all([
      produce(true).then(completed => {
        if (completed) finishPreparation();
        closeReadyQueue();
        return completed;
      }),
      ...runWorkers(),
    ]);
    return preparedAll;
  }

  const preparedAll = await produce(false);
  if (!preparedAll) return false;
  finishPreparation();
  await Promise.all([
    enqueuePreparedWindows(),
    ...runWorkers(),
  ]);
  return true;
}
