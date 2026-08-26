import { theme } from '@/theme';
import type { MediaComponentSemantics, MediaVariantRole } from '@/services/upload/mediaVariants';

export type FileStatus = 'pending' | 'uploading' | 'success' | 'error' | 'skipped';

export interface FileState {
  id: string;
  filename: string;
  status: FileStatus;
  msg?: string;
  mediaRole?: MediaVariantRole;
  componentSemantics?: MediaComponentSemantics;
}

export interface TransferFailureGroup {
  id: string;
  count: number;
  message: string;
  sampleFilenames: string[];
}

export function groupFailureResults(files: FileState[]): TransferFailureGroup[] {
  const groups = new Map<string, TransferFailureGroup>();
  for (const file of files) {
    if (file.status !== 'error') continue;
    const message = file.msg?.trim() || 'The file did not complete.';
    const existing = groups.get(message);
    if (existing) {
      existing.count += 1;
      if (existing.sampleFilenames.length < 3) existing.sampleFilenames.push(file.filename);
      continue;
    }
    groups.set(message, {
      id: `failure-group-${groups.size + 1}`,
      count: 1,
      message,
      sampleFilenames: [file.filename],
    });
  }
  return Array.from(groups.values()).sort((left, right) => right.count - left.count);
}

export function formatDuration(secs: number) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mRem = m % 60;
  return `${h}h ${mRem}m ${s}s`;
}

export function formatBytes(bytes: number) {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function fileStatusPresentation(status: FileStatus) {
  switch (status) {
    case 'uploading':
      return { icon: 'cloud-upload-outline' as const, color: theme.colors.primary, text: 'Uploading...' };
    case 'success':
      return { icon: 'checkmark-circle' as const, color: theme.colors.success, text: 'Success' };
    case 'error':
      return { icon: 'alert-circle' as const, color: theme.colors.error, text: 'Failed' };
    case 'skipped':
      return { icon: 'play-skip-forward-outline' as const, color: theme.colors.warning, text: 'Skipped' };
    case 'pending':
    default:
      return { icon: 'time-outline' as const, color: theme.colors.onSurfaceVariant, text: 'Pending' };
  }
}

export function summaryBadgePresentation({
  errorCount,
  successCount,
  skipCount,
}: {
  errorCount: number;
  successCount: number;
  skipCount: number;
}) {
  if (errorCount > 0 && successCount === 0 && skipCount === 0) {
    return { text: 'FAILED', backgroundClass: 'bg-error/20', textClass: 'text-error' };
  }
  if (errorCount > 0 || skipCount > 0) {
    return { text: 'MIXED', backgroundClass: 'bg-warning/20', textClass: 'text-warning' };
  }
  return { text: 'SUCCESS', backgroundClass: 'bg-success/20', textClass: 'text-success' };
}
