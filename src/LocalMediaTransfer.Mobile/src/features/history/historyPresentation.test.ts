import { formatHistoryDate, historyItemKey, historyStatus, normalizeHistoryItems } from './historyPresentation';

it('formats receiver timestamps and derives transfer status', () => {
  expect(formatHistoryDate(1710000000000)).not.toBe('Date unavailable');
  expect(formatHistoryDate(0)).toBe('Date unavailable');
  expect(formatHistoryDate('0')).toBe('Date unavailable');
  expect(formatHistoryDate(undefined)).toBe('Date unavailable');
  expect(historyStatus({ uploadedFiles: 2, skippedFiles: 1, failedFiles: 0 })).toBe('Completed');
  expect(historyStatus({ uploadedFiles: 1, failedFiles: 1 })).toBe('Completed with errors');
  expect(historyStatus({ expandedFiles: 448, uploadedFiles: 447, skippedFiles: 0, failedFiles: 0 })).toBe('Canceled');
});

it('normalizes stable history keys when the receiver omits session IDs', () => {
  const [first, second] = normalizeHistoryItems([
    { completedAt: 1710000000000, uploadedFiles: 1, skippedFiles: 0, failedFiles: 0 },
    { completedAt: 1710000000000, uploadedFiles: 1, skippedFiles: 0, failedFiles: 0 },
  ]);
  expect(historyItemKey(first)).toBe('history:1710000000000:1:0:0');
  expect(historyItemKey(second)).toBe('history:1710000000000:1:0:0:duplicate-1');
});
