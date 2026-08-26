import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import {
  discoveryPortForEnvironment,
  iosClientEnvironment,
} from '@/config/runtimeEnvironment';
import { normalizeFingerprint } from '@/security/ConnectionSecurity';
import { ThermalState } from './upload/types';
import {
  isMediaVariantRole,
  MediaComponentSemantics,
  MediaMaterializationPath,
  MediaVariantRole,
} from './upload/mediaVariants';
export type { MediaVariantRole } from './upload/mediaVariants';

export type ServerEnvironment = 'production' | 'test' | 'benchmark';
export type ClientServerEnvironment = Exclude<ServerEnvironment, 'benchmark'>;

export interface DiscoveredServer {
  serverId: string;
  name: string;
  address: string;
  httpsPort: number;
  certificateFingerprint: string;
  httpPort?: number;
  approvalRequired: boolean;
  environment: ClientServerEnvironment;
}

export interface NativeUploadSuccessResult {
  status: 'success';
  bytesSent: number;
  skipped: boolean;
  chunkCount: number;
  chunkSizeBytes: number;
  fileReadDurationMs: number;
  httpRequestDurationMs: number;
  interChunkGapDurationMs: number;
  retryCount: number;
  peakResidentMemoryBytes: number;
  serverWriteDurationMs: number;
  serverFinalizeDurationMs: number;
  transferFilename: string;
  savedFilename?: string;
}

export interface NativeUploadFailureResult {
  status: 'failed';
  errorCode: 'unauthorized' | 'server-rejected';
  httpStatus: number;
  bytesSent: number;
  transferFilename: string;
}

export type NativeUploadResult =
  | NativeUploadSuccessResult
  | NativeUploadFailureResult;

export interface NativeUploadOptions {
  uri: string;
  endpoint: string;
  token: string;
  fileId: string;
  transferFilename: string;
  chunkSize: number;
  skipDuplicates: boolean;
}

export interface NativeFilenameResolutionRequest {
  assetId: string;
  uri: string;
  fallbackFilename: string;
}

export interface NativeFilenameResolution {
  assetId: string;
  status: 'resolved' | 'failed';
  filename?: string;
  source?: 'apple-resource' | 'expo-fallback';
  errorCode?: 'invalid-filename-request' | 'asset-not-found' | 'resource-not-found';
}

export interface NativePreparationRequest {
  fileRef: number;
  assetId: string;
}

export interface NativePreparationOptions {
  includeAdditionalMediaComponents: boolean;
}

export interface NativeReleaseMetrics {
  materializationPath: MediaMaterializationPath;
  temporaryBytesWritten: number;
  temporaryLifetimeMs: number;
}

export type NativePreparationResult =
  | {
      fileRef: number;
      assetId?: string;
      variantId: string;
      mediaRole: MediaVariantRole;
      componentSemantics: MediaComponentSemantics;
      originalFilename: string;
      status: 'ready';
      localUri: string;
      sizeBytes: number;
      transferFilename: string;
      contentType?: string;
      temporary: boolean;
      materializationPath: MediaMaterializationPath;
      materializationDurationMs: number;
      temporaryBytesWritten: number;
    }
  | {
      fileRef: number;
      assetId?: string;
      variantId: string;
      mediaRole: MediaVariantRole;
      componentSemantics: MediaComponentSemantics;
      originalFilename: string;
      status: 'failed';
      stage: 'rendition' | 'metadata' | 'filename';
      errorCode:
        | 'invalid-filename-request'
        | 'asset-not-found'
        | 'resource-not-found'
        | 'asset-info-unavailable'
        | 'file-missing'
        | 'file-empty'
        | 'file-size-unavailable'
        | 'temporary-storage-limit'
        | 'invalid-prepared-file'
        | 'icloud-resource-unavailable'
        | 'cancelled';
    };

export interface NativeHashRequest {
  variantId: string;
  localUri: string;
  expectedSizeBytes: number;
}

export type NativeHashResult =
  | {
      variantId: string;
      status: 'success';
      sha256: string;
      bytesRead: number;
      durationMs: number;
      cacheHit: boolean;
    }
  | {
      variantId: string;
      status: 'failed';
      errorCode: 'prepared-file-not-owned' | 'file-changed' | 'file-read-failed' | 'cancelled';
      bytesRead: number;
      durationMs: number;
      cacheHit: false;
    };

export interface NativeHttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  tlsVersion?: string;
  certificateVerified: boolean;
}

interface LocalMediaTransferNativeModule {
  discover(timeoutMs: number, port: number, environment: ClientServerEnvironment): Promise<unknown[]>;
  configureSecureConnection(options: { baseUrl: string; fingerprint: string }): Promise<void>;
  clearSecureConnection(): void;
  request(options: Record<string, unknown>): Promise<NativeHttpResponse>;
  securityState(): Promise<{ tlsVersion?: string; certificateVerified: boolean }>;
  resolveAssetFilenames(requests: NativeFilenameResolutionRequest[]): Promise<unknown[]>;
  prepareAssetWindow(
    sessionRef: string,
    requests: NativePreparationRequest[],
    options: NativePreparationOptions,
  ): Promise<unknown[]>;
  hashPreparedFiles(sessionRef: string, requests: NativeHashRequest[]): Promise<unknown[]>;
  releasePreparedFile(sessionRef: string, uri: string): Promise<unknown>;
  endTransfer(sessionRef: string): Promise<void>;
  getThermalState(): Promise<string>;
  uploadFile(options: NativeUploadOptions): Promise<unknown>;
  beginTransfer(sessionRef: string): Promise<void>;
  cancel(sessionRef: string): void;
}

export function parseFilenameResolution(value: unknown): NativeFilenameResolution | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Record<string, unknown>;
  const assetId = typeof result.assetId === 'string' ? result.assetId : '';
  if (!assetId) return null;
  if (result.status === 'failed') {
    const errorCode = result.errorCode === 'invalid-filename-request' ||
      result.errorCode === 'asset-not-found' ||
      result.errorCode === 'resource-not-found'
      ? result.errorCode
      : null;
    return errorCode ? { assetId, status: 'failed', errorCode } : null;
  }
  const filename = typeof result.filename === 'string' ? result.filename : '';
  const source = result.source === 'apple-resource' ? 'apple-resource' :
    result.source === 'expo-fallback' ? 'expo-fallback' : null;
  if (result.status !== 'resolved' || !filename || !source) return null;
  return { assetId, status: 'resolved', filename, source };
}

export function parseNativePreparationResult(value: unknown): NativePreparationResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Record<string, unknown>;
  const fileRef = typeof result.fileRef === 'number' && Number.isInteger(result.fileRef)
    ? result.fileRef
    : 0;
  if (fileRef <= 0) return null;
  const assetId = typeof result.assetId === 'string' && result.assetId
    ? result.assetId
    : undefined;
  const variantId = typeof result.variantId === 'string' && result.variantId
    ? result.variantId
    : `prepared-${fileRef}`;
  const mediaRole = isMediaVariantRole(result.mediaRole)
    ? result.mediaRole
    : 'unknown';
  const originalFilename = typeof result.originalFilename === 'string'
    ? result.originalFilename
    : '';
  const componentSemantics: MediaComponentSemantics =
    result.componentSemantics === 'optional' ? 'optional' : 'primary';
  const materializationPaths = new Set<MediaMaterializationPath>([
    'photo-resource', 'video-resource', 'raw-resource', 'live-photo-motion',
    'current-image', 'current-video', 'expo-direct',
  ]);
  if (result.status === 'ready') {
    const localUri = typeof result.localUri === 'string' ? result.localUri : '';
    const sizeBytes = typeof result.sizeBytes === 'number' ? result.sizeBytes : 0;
    const transferFilename =
      typeof result.transferFilename === 'string' ? result.transferFilename : '';
    if (!localUri || sizeBytes <= 0 || !transferFilename) return null;
    return {
      fileRef,
      ...(assetId ? { assetId } : {}),
      variantId,
      mediaRole,
      componentSemantics,
      originalFilename: originalFilename || transferFilename,
      status: 'ready',
      localUri,
      sizeBytes,
      transferFilename,
      ...(typeof result.contentType === 'string'
        ? { contentType: result.contentType }
        : {}),
      temporary: result.temporary === true,
      materializationPath:
        typeof result.materializationPath === 'string' &&
        materializationPaths.has(result.materializationPath as MediaMaterializationPath)
          ? result.materializationPath as MediaMaterializationPath
          : 'photo-resource',
      materializationDurationMs:
        typeof result.materializationDurationMs === 'number' &&
        Number.isFinite(result.materializationDurationMs) &&
        result.materializationDurationMs >= 0
          ? result.materializationDurationMs
          : 0,
      temporaryBytesWritten:
        typeof result.temporaryBytesWritten === 'number' &&
        Number.isFinite(result.temporaryBytesWritten) &&
        result.temporaryBytesWritten >= 0
          ? result.temporaryBytesWritten
          : 0,
    };
  }
  const stage = result.stage === 'rendition' ||
    result.stage === 'metadata' ||
    result.stage === 'filename'
    ? result.stage
    : null;
  const allowedCodes = new Set([
    'invalid-filename-request',
    'asset-not-found',
    'resource-not-found',
    'asset-info-unavailable',
    'file-missing',
    'file-empty',
    'file-size-unavailable',
    'temporary-storage-limit',
    'invalid-prepared-file',
    'icloud-resource-unavailable',
    'cancelled',
  ]);
  const errorCode = typeof result.errorCode === 'string' &&
    allowedCodes.has(result.errorCode)
    ? result.errorCode as Extract<
        NativePreparationResult,
        { status: 'failed' }
      >['errorCode']
    : null;
  if (result.status !== 'failed' || !stage || !errorCode) return null;
  return {
    fileRef,
    ...(assetId ? { assetId } : {}),
    variantId,
    mediaRole,
    componentSemantics,
    originalFilename,
    status: 'failed',
    stage,
    errorCode,
  };
}

export function parseNativeHashResult(value: unknown): NativeHashResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Record<string, unknown>;
  const variantId = typeof result.variantId === 'string' ? result.variantId : '';
  if (!variantId) return null;
  const bytesRead = typeof result.bytesRead === 'number' &&
    Number.isFinite(result.bytesRead) && result.bytesRead >= 0
    ? result.bytesRead
    : 0;
  const durationMs = typeof result.durationMs === 'number' &&
    Number.isFinite(result.durationMs) && result.durationMs >= 0
    ? result.durationMs
    : 0;
  if (result.status === 'success') {
    const sha256 = typeof result.sha256 === 'string' ? result.sha256.toLowerCase() : '';
    return /^[0-9a-f]{64}$/.test(sha256)
      ? {
          variantId,
          status: 'success',
          sha256,
          bytesRead,
          durationMs,
          cacheHit: result.cacheHit === true,
        }
      : null;
  }
  const allowedErrors = new Set([
    'prepared-file-not-owned', 'file-changed', 'file-read-failed', 'cancelled',
  ]);
  const errorCode = typeof result.errorCode === 'string' && allowedErrors.has(result.errorCode)
    ? result.errorCode as Extract<NativeHashResult, { status: 'failed' }>['errorCode']
    : null;
  return result.status === 'failed' && errorCode
    ? { variantId, status: 'failed', errorCode, bytesRead, durationMs, cacheHit: false }
    : null;
}

function parseThermalState(value: unknown): ThermalState {
  return value === 'fair' || value === 'serious' || value === 'critical'
    ? value
    : 'nominal';
}

export function parseNativeUploadResult(value: unknown): NativeUploadResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Native upload returned an invalid result');
  }
  const result = value as Record<string, unknown>;
  const bytesSent = typeof result.bytesSent === 'number' && result.bytesSent >= 0
    ? result.bytesSent
    : 0;
  const transferFilename = typeof result.transferFilename === 'string'
    ? result.transferFilename
    : '';
  if (result.status === 'failed') {
    const errorCode = result.errorCode === 'unauthorized' ||
      result.errorCode === 'server-rejected'
      ? result.errorCode
      : null;
    const httpStatus = typeof result.httpStatus === 'number'
      ? result.httpStatus
      : 0;
    if (!errorCode || !transferFilename) {
      throw new Error('Native upload returned an invalid failure');
    }
    return {
      status: 'failed',
      errorCode,
      httpStatus,
      bytesSent,
      transferFilename,
    };
  }

  const numericFields = [
    'chunkCount',
    'chunkSizeBytes',
    'fileReadDurationMs',
    'httpRequestDurationMs',
    'interChunkGapDurationMs',
    'retryCount',
    'peakResidentMemoryBytes',
    'serverWriteDurationMs',
    'serverFinalizeDurationMs',
  ] as const;
  if (
    result.status !== 'success' ||
    !transferFilename ||
    numericFields.some(field => typeof result[field] !== 'number')
  ) {
    throw new Error('Native upload returned an invalid success result');
  }
  return {
    status: 'success',
    bytesSent,
    skipped: result.skipped === true,
    chunkCount: result.chunkCount as number,
    chunkSizeBytes: result.chunkSizeBytes as number,
    fileReadDurationMs: result.fileReadDurationMs as number,
    httpRequestDurationMs: result.httpRequestDurationMs as number,
    interChunkGapDurationMs: result.interChunkGapDurationMs as number,
    retryCount: result.retryCount as number,
    peakResidentMemoryBytes: result.peakResidentMemoryBytes as number,
    serverWriteDurationMs: result.serverWriteDurationMs as number,
    serverFinalizeDurationMs: result.serverFinalizeDurationMs as number,
    transferFilename,
    ...(typeof result.savedFilename === 'string' && result.savedFilename
      ? { savedFilename: result.savedFilename }
      : {}),
  };
}

function validPort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
    ? value
    : undefined;
}

export function parseDiscoveredServer(value: unknown): DiscoveredServer | null {
  if (typeof value !== 'object' || value === null) return null;
  const server = value as Record<string, unknown>;
  const serverId = typeof server.serverId === 'string' ? server.serverId : '';
  const name = typeof server.name === 'string' && server.name.length > 0 ? server.name : 'Desktop';
  const address = typeof server.address === 'string' ? server.address : '';
  const httpsPort = validPort(server.httpsPort);
  const httpPort = validPort(server.httpPort);
  const certificateFingerprint = normalizeFingerprint(
    typeof server.certificateFingerprint === 'string' ? server.certificateFingerprint : '',
  );
  const environment = server.environment === 'production' || server.environment === 'test'
    ? server.environment
    : null;
  if (!serverId || !address || !httpsPort || certificateFingerprint.length !== 64 || !environment) {
    return null;
  }
  return {
    serverId,
    name,
    address,
    httpsPort,
    certificateFingerprint,
    httpPort,
    approvalRequired: server.approvalRequired === true,
    environment,
  };
}

let nativeModule: LocalMediaTransferNativeModule | null = null;
try {
  nativeModule = requireNativeModule<LocalMediaTransferNativeModule>('LocalMediaTransferNative');
} catch {
  nativeModule = null;
}

export function expectedServerEnvironment(): ClientServerEnvironment {
  return iosClientEnvironment(nativeModule !== null);
}

// expo-modules-core types do not expose the generated native module event map.
// Keep the cast at this boundary instead of leaking `any` into callers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nativeEventEmitter = nativeModule ? new EventEmitter(nativeModule as any) : null;

export const nativeCapabilities = {
  available: nativeModule !== null,
  discover: async (timeoutMs = 1500): Promise<DiscoveredServer[]> => {
    if (!nativeModule) return [];
    const environment = expectedServerEnvironment();
    const rawServers = await nativeModule.discover(
      timeoutMs,
      discoveryPortForEnvironment(environment),
      environment,
    );
    return rawServers
      .map(parseDiscoveredServer)
      .filter((server): server is DiscoveredServer =>
        server !== null && server.environment === environment);
  },
  configureSecureConnection: async (baseUrl: string, fingerprint: string): Promise<void> => {
    if (!nativeModule) throw new Error('Pinned HTTPS requires the installed app');
    await nativeModule.configureSecureConnection({ baseUrl, fingerprint });
  },
  clearSecureConnection: () => nativeModule?.clearSecureConnection(),
  request: async (options: Record<string, unknown>): Promise<NativeHttpResponse> => {
    if (!nativeModule) throw new Error('Native HTTPS transport is unavailable in Expo Go');
    return nativeModule.request(options);
  },
  securityState: async (): Promise<{ tlsVersion?: string; certificateVerified: boolean }> =>
    nativeModule ? nativeModule.securityState() : { certificateVerified: false },
  resolveAssetFilenames: async (
    requests: NativeFilenameResolutionRequest[],
  ): Promise<NativeFilenameResolution[]> => {
    if (!nativeModule) {
      return requests.map(request => ({
        assetId: request.assetId,
        status: 'resolved' as const,
        filename: request.fallbackFilename,
        source: 'expo-fallback' as const,
      }));
    }
    const rawResults = await nativeModule.resolveAssetFilenames(requests);
    return rawResults
      .map(parseFilenameResolution)
      .filter((result): result is NativeFilenameResolution => result !== null);
  },
  prepareAssetWindow: async (
    sessionRef: string,
    requests: NativePreparationRequest[],
    options: NativePreparationOptions,
    onProgress?: (completedAssets: number, totalAssets: number) => void,
  ): Promise<NativePreparationResult[]> => {
    if (!nativeModule) {
      throw new Error('Native Photos preparation is unavailable in Expo Go');
    }
    const listener = nativeEventEmitter && onProgress
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (nativeEventEmitter as any).addListener(
          'onPreparationProgress',
          (event: { sessionRef?: unknown; completedAssets?: unknown; totalAssets?: unknown }) => {
            if (
              event.sessionRef !== sessionRef ||
              typeof event.completedAssets !== 'number' ||
              typeof event.totalAssets !== 'number'
            ) return;
            onProgress(event.completedAssets, event.totalAssets);
          },
        )
      : null;
    try {
      const rawResults = await nativeModule.prepareAssetWindow(sessionRef, requests, options);
      return rawResults
        .map(parseNativePreparationResult)
        .filter((result): result is NativePreparationResult => result !== null);
    } finally {
      listener?.remove();
    }
  },
  hashPreparedFiles: async (
    sessionRef: string,
    requests: NativeHashRequest[],
  ): Promise<NativeHashResult[]> => {
    if (!nativeModule) {
      throw new Error('Native duplicate hashing is unavailable in Expo Go');
    }
    const rawResults = await nativeModule.hashPreparedFiles(sessionRef, requests);
    return rawResults
      .map(parseNativeHashResult)
      .filter((result): result is NativeHashResult => result !== null);
  },
  releasePreparedFile: async (
    sessionRef: string,
    uri: string,
  ): Promise<NativeReleaseMetrics | null> => {
    const raw = await nativeModule?.releasePreparedFile(sessionRef, uri);
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Record<string, unknown>;
    const path = value.materializationPath;
    const allowedPaths = new Set<MediaMaterializationPath>([
      'photo-resource', 'video-resource', 'raw-resource', 'live-photo-motion',
      'current-image', 'current-video', 'expo-direct',
    ]);
    if (typeof path !== 'string' || !allowedPaths.has(path as MediaMaterializationPath)) {
      return null;
    }
    return {
      materializationPath: path as MediaMaterializationPath,
      temporaryBytesWritten: typeof value.temporaryBytesWritten === 'number' &&
        Number.isFinite(value.temporaryBytesWritten) && value.temporaryBytesWritten >= 0
        ? value.temporaryBytesWritten : 0,
      temporaryLifetimeMs: typeof value.temporaryLifetimeMs === 'number' &&
        Number.isFinite(value.temporaryLifetimeMs) && value.temporaryLifetimeMs >= 0
        ? value.temporaryLifetimeMs : 0,
    };
  },
  getThermalState: async (): Promise<ThermalState> =>
    nativeModule ? parseThermalState(await nativeModule.getThermalState()) : 'nominal',
  uploadFile: async (options: NativeUploadOptions): Promise<NativeUploadResult> => {
    if (!nativeModule) throw new Error('Native transfer is unavailable in Expo Go');
    return parseNativeUploadResult(await nativeModule.uploadFile(options));
  },
  beginTransfer: async (sessionRef: string): Promise<void> => {
    await nativeModule?.beginTransfer(sessionRef);
  },
  endTransfer: async (sessionRef: string): Promise<void> => {
    await nativeModule?.endTransfer(sessionRef);
  },
  cancel: (sessionRef: string) => nativeModule?.cancel(sessionRef),
  addProgressListener: (listener: (event: { fileId: string; bytesSent: number; totalBytes: number }) => void) => {
    if (!nativeEventEmitter) return { remove() {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (nativeEventEmitter as any).addListener('onUploadProgress', listener);
  },
  addThermalStateListener: (listener: (state: ThermalState) => void) => {
    if (!nativeEventEmitter) return { remove() {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (nativeEventEmitter as any).addListener(
      'onThermalStateChanged',
      (event: { state?: unknown }) => listener(parseThermalState(event.state)),
    );
  },
};
