export type NativeProgressEvent = { fileId: string; bytesSent: number; totalBytes: number };

/** Native bridge values remain unknown until validated, regardless of TS casts. */
export function nativeEventRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function parseNativeProgressEvent(value: unknown): NativeProgressEvent | null {
  const event = nativeEventRecord(value);
  if (typeof event.fileId !== 'string' || typeof event.bytesSent !== 'number' ||
      typeof event.totalBytes !== 'number' || !Number.isFinite(event.bytesSent) ||
      !Number.isFinite(event.totalBytes) || event.bytesSent < 0 || event.totalBytes < 0) return null;
  return { fileId: event.fileId, bytesSent: event.bytesSent, totalBytes: event.totalBytes };
}

export type NativeEvents = {
  onUploadProgress: (event: unknown) => void;
  onPreparationProgress: (event: unknown) => void;
  onThermalStateChanged: (event: unknown) => void;
};
