import { formatTransferEta, TransferEtaEstimator } from './TransferEtaEstimator';

describe('TransferEtaEstimator', () => {
  it('warms up before publishing a rounded estimate', () => {
    const estimator = new TransferEtaEstimator();
    estimator.observe({
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 650_000_000,
      currentMediaMBps: 10,
      sampledAt: 1000,
    });

    expect(estimator.estimateSeconds(5999)).toBeNull();
    estimator.observe({
      acknowledgedMediaBytes: 50_000_000,
      plannedUploadMediaBytes: 650_000_000,
      currentMediaMBps: 10,
      sampledAt: 6000,
    });
    const estimate = estimator.estimateSeconds(6000);
    expect(estimate).toBeCloseTo(60, 5);
    expect(formatTransferEta({ estimatedSeconds: estimate, hasRemainingBytes: true, isFinished: false })).toBe('About 1 min');
  });

  it('smooths bursty samples but still rises after a sustained slowdown', () => {
    const estimator = new TransferEtaEstimator();
    estimator.observe({
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 400_000_000,
      currentMediaMBps: 40,
      sampledAt: 1000,
    });
    estimator.observe({
      acknowledgedMediaBytes: 200_000_000,
      plannedUploadMediaBytes: 400_000_000,
      currentMediaMBps: 40,
      sampledAt: 6000,
    });
    const fastEstimate = estimator.estimateSeconds(6000);

    estimator.observe({
      acknowledgedMediaBytes: 216_000_000,
      plannedUploadMediaBytes: 400_000_000,
      currentMediaMBps: 4,
      sampledAt: 8000,
    });
    const slowedEstimate = estimator.estimateSeconds(8000);

    expect(fastEstimate).not.toBeNull();
    expect(slowedEstimate).not.toBeNull();
    expect(slowedEstimate!).toBeGreaterThan(fastEstimate!);
    expect(slowedEstimate!).toBeLessThan(99);
  });

  it('expires stale samples and recovers on a new acknowledgement', () => {
    const estimator = new TransferEtaEstimator();
    estimator.observe({
      acknowledgedMediaBytes: 0,
      plannedUploadMediaBytes: 320_000_000,
      currentMediaMBps: 32,
      sampledAt: 1000,
    });
    estimator.observe({
      acknowledgedMediaBytes: 160_000_000,
      plannedUploadMediaBytes: 320_000_000,
      currentMediaMBps: 32,
      sampledAt: 6000,
    });

    expect(estimator.estimateSeconds(6000)).not.toBeNull();
    expect(estimator.estimateSeconds(11001)).toBeNull();

    estimator.observe({
      acknowledgedMediaBytes: 192_000_000,
      plannedUploadMediaBytes: 320_000_000,
      currentMediaMBps: 32,
      sampledAt: 11500,
    });
    expect(estimator.estimateSeconds(11500)).not.toBeNull();
  });

  it('replaces an inflated startup estimate before smoothing begins', () => {
    const estimator = new TransferEtaEstimator();
    estimator.observe({
      acknowledgedMediaBytes: 50_000,
      plannedUploadMediaBytes: 3_000_000_000,
      currentMediaMBps: 0.01,
      sampledAt: 1000,
    });
    estimator.observe({
      acknowledgedMediaBytes: 150_000_000,
      plannedUploadMediaBytes: 3_000_000_000,
      currentMediaMBps: 30,
      sampledAt: 6000,
    });

    expect(formatTransferEta({
      estimatedSeconds: estimator.estimateSeconds(6000),
      hasRemainingBytes: estimator.hasRemainingBytes(),
      isFinished: false,
    })).toBe('About 2 min');
  });

  it('formats calculating, finalizing, completion, and bounded long estimates', () => {
    expect(formatTransferEta({ estimatedSeconds: null, hasRemainingBytes: true, isFinished: false })).toBe('Calculating…');
    expect(formatTransferEta({ estimatedSeconds: 0, hasRemainingBytes: false, isFinished: false })).toBe('Finishing…');
    expect(formatTransferEta({ estimatedSeconds: 7, hasRemainingBytes: true, isFinished: false })).toBe('A few seconds');
    expect(formatTransferEta({ estimatedSeconds: 26, hasRemainingBytes: true, isFinished: false })).toBe('About 30s');
    expect(formatTransferEta({ estimatedSeconds: 7200, hasRemainingBytes: true, isFinished: false })).toBe('About 2 hr');
    expect(formatTransferEta({ estimatedSeconds: 90_000, hasRemainingBytes: true, isFinished: false })).toBe('Over 1 day');
    expect(formatTransferEta({ estimatedSeconds: null, hasRemainingBytes: true, isFinished: true })).toBe('Done');
  });
});
