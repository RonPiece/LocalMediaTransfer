export type TransferStage =
  | 'rendition'
  | 'metadata'
  | 'filename'
  | 'preflight'
  | 'upload'
  | 'network'
  | 'server';

export type TransferErrorCode =
  | 'asset-info-unavailable'
  | 'file-missing'
  | 'file-size-unavailable'
  | 'temporary-storage-limit'
  | 'invalid-prepared-file'
  | 'icloud-resource-unavailable'
  | 'prepared-file-not-owned'
  | 'file-changed'
  | 'native-hashing-unavailable'
  | 'asset-not-found'
  | 'resource-not-found'
  | 'invalid-filename-request'
  | 'filename-resolution-failed'
  | 'preflight-unavailable'
  | 'file-empty'
  | 'file-read-failed'
  | 'request-timeout'
  | 'unauthorized'
  | 'server-rejected'
  | 'upload-failed'
  | 'cancelled'
  | 'unexpected';

const userMessages: Record<TransferErrorCode, string> = {
  'asset-info-unavailable': 'The selected item could not be loaded from Photos.',
  'file-missing': 'The selected item is not currently available on this iPhone.',
  'file-size-unavailable': 'The selected item size could not be read.',
  'temporary-storage-limit': 'This iPhone does not have enough free space to prepare this media item. Free storage and retry; large selections already transfer in storage-saving batches.',
  'invalid-prepared-file': 'The prepared media item could not be registered safely. Try selecting it again.',
  'icloud-resource-unavailable': 'The original is stored in iCloud. Download it in Photos, then retry the transfer.',
  'prepared-file-not-owned': 'The prepared file is no longer part of this transfer. Prepare the selection again.',
  'file-changed': 'The prepared file changed while duplicates were being checked. Prepare it again.',
  'native-hashing-unavailable': 'Native duplicate checking is unavailable in this installed app. Reinstall or update the app before retrying.',
  'asset-not-found': 'Photos could not find the selected item.',
  'resource-not-found': 'Photos did not provide the original filename for this item.',
  'invalid-filename-request': 'The selected item had invalid filename information.',
  'filename-resolution-failed': 'The original filename could not be verified.',
  'preflight-unavailable': 'The desktop duplicate check was unavailable.',
  'file-empty': 'The selected item contains no transferable data.',
  'file-read-failed': 'The selected item could not be read.',
  'request-timeout': 'The desktop did not respond in time.',
  unauthorized: 'The desktop session changed. Scan the current QR code to reconnect.',
  'server-rejected': 'The desktop rejected this file.',
  'upload-failed': 'The file could not be uploaded.',
  cancelled: 'The transfer was cancelled.',
  unexpected: 'An unexpected transfer error occurred.',
};

export class TransferFailure extends Error {
  constructor(
    public readonly stage: TransferStage,
    public readonly code: TransferErrorCode,
    public readonly fatal = false,
  ) {
    super(userMessages[code]);
    this.name = 'TransferFailure';
  }
}

export function transferFailure(
  value: unknown,
  stage: TransferStage,
  fallbackCode: TransferErrorCode,
): TransferFailure {
  if (value instanceof TransferFailure) return value;
  return new TransferFailure(stage, fallbackCode);
}

export function transferErrorMessage(code: TransferErrorCode): string {
  return userMessages[code];
}
