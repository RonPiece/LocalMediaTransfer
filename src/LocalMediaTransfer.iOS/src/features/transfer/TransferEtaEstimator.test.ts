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

    expect(estimator.estimateSeconds(2499)).toBeNull();
    const estimate = estimator.estimateSeconds(2500);
    expect(estimate).toBeCloseTo(63.5, 5);
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
    const fastEstimate = estimator.estimateSeconds(2500);

    estimator.observe({
      acknowledgedMediaBytes: 4_000_000,
      plannedUploadMediaBytes: 400_000_000,
      currentMediaMBps: 4,
      sampledAt: 3000,
    });
    const slowedEstimate = estimator.estimateSeconds(3000);

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

    expect(estimator.estimateSeconds(2500)).not.toBeNull();
    expect(estimator.estimateSeconds(6001)).toBeNull();

    estimator.observe({
      acknowledgedMediaBytes: 32_000_000,
      plannedUploadMediaBytes: 320_000_000,
      currentMediaMBps: 32,
      sampledAt: 6500,
    });
    expect(estimator.estimateSeconds(6500)).not.toBeNull();
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
