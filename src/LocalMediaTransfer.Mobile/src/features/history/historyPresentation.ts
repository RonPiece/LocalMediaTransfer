import { TransferHistoryItem } from '@/api/types';

export type HistoryItem = TransferHistoryItem & { clientHistoryId?: string };

const MIN_REASONABLE_HISTORY_TIMESTAMP_MS = Date.UTC(2020, 0, 1);

export function formatHistoryDate(value: HistoryItem['completedAt']): string {
  if (value === undefined || value === null || value === '') return 'Date unavailable';
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const milliseconds = typeof numeric === 'number' && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp) || timestamp < MIN_REASONABLE_HISTORY_TIMESTAMP_MS) return 'Date unavailable';
  return date.toLocaleString();
}

function fallbackHistoryKey(item: HistoryItem): string {
  return ['history', item.completedAt ?? 'unknown-date', item.uploadedFiles ?? 0, item.skippedFiles ?? 0, item.failedFiles ?? 0].join(':');
}

export function historyItemKey(item: HistoryItem): string {
  return item.sessionId || item.clientHistoryId || fallbackHistoryKey(item);
}

export function normalizeHistoryItems(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, number>();
  return value.map((item: HistoryItem) => {
    if (item.sessionId) return item;
    const baseKey = fallbackHistoryKey(item);
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    return { ...item, clientHistoryId: occurrence === 0 ? baseKey : `${baseKey}:duplicate-${occurrence}` };
  });
}

export function historyStatus(item: HistoryItem): string {
  if (item.completionStatus === 'cancelled') return 'Canceled';
  if (item.completionStatus === 'fatal') return 'Failed';
  const failed = item.failedFiles ?? 0;
  const uploaded = item.uploadedFiles ?? 0;
  const skipped = item.skippedFiles ?? 0;
  const terminalFiles = uploaded + skipped + failed;
  const expandedFiles = item.expandedFiles ?? item.selectedFiles;
  if (failed === 0 && expandedFiles !== undefined && terminalFiles < expandedFiles) return 'Canceled';
  if (failed > 0) return failed === terminalFiles ? 'Failed' : 'Completed with errors';
  if (uploaded === 0 && skipped > 0) return 'Skipped duplicates';
  if (item.completionStatus === 'mixed') return 'Completed with errors';
  return 'Completed';
}
