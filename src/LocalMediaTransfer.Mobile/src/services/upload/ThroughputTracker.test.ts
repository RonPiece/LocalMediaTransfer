import { ThroughputTracker } from './ThroughputTracker';

it('publishes coherent immutable-in-time snapshots of media and encoded acknowledgements', () => {
  const tracker = new ThroughputTracker(0);
  expect(tracker.current.uploadedMediaBytes).toBe(0);
  expect(tracker.current.sampledAt).toBe(0);
  const first = tracker.recordAcknowledgement(1_000_000, 2_000_000, 1000);
  expect(tracker.current).toBe(first);
  expect(first).toMatchObject({ uploadedMediaBytes: 1_000_000, currentMediaMBps: 1,
    averageMediaMBps: 1, currentEncodedMBps: 2, sampledAt: 1000 });
  tracker.recordAcknowledgement(1_000_000, 1_000_000, 2000);
  expect(tracker.current).toMatchObject({ uploadedMediaBytes: 2_000_000,
    acknowledgedEncodedBytes: 3_000_000, sampledAt: 2000 });
  expect(first.uploadedMediaBytes).toBe(1_000_000);
});
