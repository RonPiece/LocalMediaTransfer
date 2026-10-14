import { runTransferPipeline } from './transferPipeline';

describe('runTransferPipeline', () => {
  it('prepares all windows before starting prepare-first workers', async () => {
    const events: string[] = [];
    const completed = await runTransferPipeline({
      preparationMode: 'prepare-first',
      produce: async immediate => {
        events.push(`produce:${immediate}`);
        return true;
      },
      finishPreparation: () => events.push('finished'),
      closeReadyQueue: () => events.push('closed'),
      enqueuePreparedWindows: async () => { events.push('enqueue'); },
      runWorkers: () => [Promise.resolve().then(() => { events.push('worker'); })],
    });

    expect(completed).toBe(true);
    expect(events.slice(0, 3)).toEqual(['produce:false', 'finished', 'enqueue']);
    expect(events).toContain('worker');
  });

  it('starts streaming workers while preparation is active and closes the queue', async () => {
    const events: string[] = [];
    let finishProducer: () => void = () => {};
    const producerGate = new Promise<void>(resolve => {
      finishProducer = () => resolve();
    });
    const run = runTransferPipeline({
      preparationMode: 'streaming',
      produce: async immediate => {
        events.push(`produce:${immediate}`);
        await producerGate;
        return true;
      },
      finishPreparation: () => events.push('finished'),
      closeReadyQueue: () => events.push('closed'),
      enqueuePreparedWindows: async () => { throw new Error('not used'); },
      runWorkers: () => [Promise.resolve().then(() => { events.push('worker'); })],
    });

    await Promise.resolve();
    expect(events).toContain('worker');
    finishProducer();
    await expect(run).resolves.toBe(true);
    expect(events.slice(-2)).toEqual(['finished', 'closed']);
  });
});
