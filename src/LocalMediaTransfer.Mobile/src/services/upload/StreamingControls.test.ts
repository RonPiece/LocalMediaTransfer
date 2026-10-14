import { BoundedAsyncQueue } from './BoundedAsyncQueue';
import { ThermalController } from './ThermalController';

describe('BoundedAsyncQueue', () => {
  it('never admits more than its configured capacity', async () => {
    const queue = new BoundedAsyncQueue<number>(2);
    await queue.push(1);
    await queue.push(2);
    let thirdResolved = false;
    const third = queue.push(3).then(() => {
      thirdResolved = true;
    });

    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    expect(queue.maxDepth).toBe(2);
    expect(await queue.shift()).toBe(1);
    await third;
    expect(await queue.shift()).toBe(2);
    expect(await queue.shift()).toBe(3);
    queue.close();
    expect(await queue.shift()).toBeNull();
  });

  it('reports capacity waiting only while a producer is actually blocked', async () => {
    const queue = new BoundedAsyncQueue<number>(1);
    const waitChanges: boolean[] = [];
    await queue.push(1, waiting => waitChanges.push(waiting));
    const blockedPush = queue.push(2, waiting => waitChanges.push(waiting));

    await Promise.resolve();
    expect(waitChanges).toEqual([true]);
    expect(await queue.shift()).toBe(1);
    await blockedPush;
    expect(waitChanges).toEqual([true, false]);
    expect(await queue.shift()).toBe(2);
  });
});

describe('ThermalController', () => {
  it('keeps both upload workers active in the current monitor-only policy', async () => {
    const thermal = new ThermalController('monitor-only');
    thermal.update('critical');

    await expect(thermal.waitForPreparation()).resolves.toBe(true);
    await expect(thermal.waitForUpload(0)).resolves.toBe(true);
    await expect(thermal.waitForUpload(1)).resolves.toBe(true);
    expect(thermal.controlMode).toBe('normal');
  });

  it('keeps preparation and one worker moving while serious, then restores both workers', async () => {
    const thermal = new ThermalController();
    thermal.update('serious');
    let secondWorkerResolved = false;
    const preparation = thermal.waitForPreparation();
    const firstWorker = thermal.waitForUpload(0);
    const secondWorker = thermal.waitForUpload(1).then(value => {
      secondWorkerResolved = value;
    });

    expect(thermal.controlMode).toBe('reduced');
    expect(await preparation).toBe(true);
    expect(await firstWorker).toBe(true);
    await Promise.resolve();
    expect(secondWorkerResolved).toBe(false);

    thermal.update('fair');
    await secondWorker;
    expect(secondWorkerResolved).toBe(true);
  });

  it('never fully pauses at critical and cancellation releases the reduced worker', async () => {
    const thermal = new ThermalController();
    thermal.update('critical');
    const preparation = thermal.waitForPreparation();
    const firstWorker = thermal.waitForUpload(0);
    const secondWorker = thermal.waitForUpload(1);
    await expect(preparation).resolves.toBe(true);
    await expect(firstWorker).resolves.toBe(true);
    expect(thermal.controlMode).toBe('reduced');
    thermal.cancel();
    await expect(secondWorker).resolves.toBe(false);
  });

  it('restores the second worker after critical thermal pressure clears', async () => {
    const thermal = new ThermalController();
    thermal.update('critical');
    let resolvedCount = 0;
    const secondWorker = thermal.waitForUpload(1).then(value => {
      if (value) resolvedCount += 1;
      return value;
    });

    await Promise.resolve();
    expect(resolvedCount).toBe(0);

    thermal.update('nominal');
    await expect(secondWorker).resolves.toBe(true);
    expect(resolvedCount).toBe(1);
  });
});
