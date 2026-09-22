import { TransferOutcomes, UploadWorkerActivity } from './TransferAccounting';

it('counts terminal items once and distinguishes avoided bytes from finalization duplicates', () => {
  const outcomes = new TransferOutcomes();
  outcomes.save('saved', 10);
  outcomes.fail('saved');
  outcomes.skip('preflight', 20, 'preflight');
  outcomes.skip('finalization', 30, 'finalization');
  expect(outcomes.fail('failed', true)).toBe(true);
  expect(outcomes.fail('failed', true)).toBe(false);
  expect(outcomes.snapshot).toEqual({ filesCompleted: 4, uploadedFiles: 1,
    skippedFiles: 2, failedFiles: 1, preparationFailedFiles: 1,
    successfulUploadedBytes: 10, skippedBytes: 50, avoidedBytes: 20,
    finalizationDuplicateBytes: 30, serverSkippedFiles: 1, serverSkippedBytes: 30 });
  const snapshot = outcomes.snapshot;
  outcomes.save('later', 1);
  expect(snapshot.filesCompleted).toBe(4);
});

it('measures idle time only after workers start and when every worker is idle', () => {
  let now = 0;
  const activity = new UploadWorkerActivity(() => now);
  now = 100;
  expect(activity.idleMilliseconds()).toBe(0);
  activity.start();
  now = 150;
  activity.start();
  expect(activity.busy()).toBe(1);
  activity.busy();
  now = 200;
  activity.idle();
  expect(activity.idleMilliseconds()).toBe(50);
  now = 250;
  activity.idle();
  now = 300;
  expect(activity.idleMilliseconds()).toBe(100);
  expect(activity.peakCount).toBe(2);
  expect(activity.activeCount).toBe(0);
});
