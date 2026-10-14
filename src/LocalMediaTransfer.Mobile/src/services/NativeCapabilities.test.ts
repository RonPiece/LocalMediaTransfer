import {
  parseDiscoveredServer,
  parseFilenameResolution,
  parseNativeHashResult,
  parseNativePreparationResult,
  parseNativeUploadResult,
} from './NativeCapabilities';

describe('native hash diagnostic payload validation', () => {
  it('accepts bounded hash measurements and rejects an invalid digest', () => {
    expect(parseNativeHashResult({
      variantId: 'variant-1',
      status: 'success',
      sha256: 'AB'.repeat(32),
      bytesRead: 4_200_000,
      durationMs: 125.5,
      cacheHit: false,
    })).toEqual({
      variantId: 'variant-1',
      status: 'success',
      sha256: 'ab'.repeat(32),
      bytesRead: 4_200_000,
      durationMs: 125.5,
      cacheHit: false,
    });
    expect(parseNativeHashResult({
      variantId: 'variant-1',
      status: 'success',
      sha256: 'short',
      bytesRead: 1,
      durationMs: 1,
    })).toBeNull();
  });

  it('bounds malformed diagnostic numbers without rejecting a typed failure', () => {
    expect(parseNativeHashResult({
      variantId: 'variant-2',
      status: 'failed',
      errorCode: 'file-read-failed',
      bytesRead: -1,
      durationMs: Number.NaN,
    })).toEqual({
      variantId: 'variant-2',
      status: 'failed',
      errorCode: 'file-read-failed',
      bytesRead: 0,
      durationMs: 0,
      cacheHit: false,
    });
  });
});

describe('native filename resolution payload validation', () => {
  it('accepts an Apple Photos original filename result', () => {
    expect(parseFilenameResolution({
      assetId: 'photos-id-3231',
      status: 'resolved',
      filename: 'IMG_3231.HEIC',
      source: 'apple-resource',
    })).toEqual({
      assetId: 'photos-id-3231',
      status: 'resolved',
      filename: 'IMG_3231.HEIC',
      source: 'apple-resource',
    });
  });

  it('accepts a typed PhotoKit failure without inventing a fallback filename', () => {
    expect(parseFilenameResolution({
      assetId: 'photos-id-missing',
      status: 'failed',
      errorCode: 'resource-not-found',
    })).toEqual({
      assetId: 'photos-id-missing',
      status: 'failed',
      errorCode: 'resource-not-found',
    });
  });

  it('rejects missing, empty, or unknown filename metadata', () => {
    expect(parseFilenameResolution({ assetId: '', filename: 'IMG_3231.HEIC', source: 'apple-resource' })).toBeNull();
    expect(parseFilenameResolution({ assetId: 'id', filename: '', source: 'apple-resource' })).toBeNull();
    expect(parseFilenameResolution({ assetId: 'id', filename: 'IMG_3231.HEIC', source: 'unknown' })).toBeNull();
  });
});

describe('native upload payload validation', () => {
  it('accepts a typed successful native upload', () => {
    expect(parseNativeUploadResult({
      status: 'success',
      bytesSent: 10,
      skipped: false,
      chunkCount: 1,
      chunkSizeBytes: 8,
      fileReadDurationMs: 1,
      httpRequestDurationMs: 2,
      interChunkGapDurationMs: 0,
      retryCount: 0,
      peakResidentMemoryBytes: 3,
      serverWriteDurationMs: 1,
      serverFinalizeDurationMs: 1,
      transferFilename: 'camera-file.heic',
    })).toEqual(expect.objectContaining({
      status: 'success',
      bytesSent: 10,
      transferFilename: 'camera-file.heic',
    }));
  });

  it('accepts a typed authorization failure and rejects malformed failures', () => {
    expect(parseNativeUploadResult({
      status: 'failed',
      errorCode: 'unauthorized',
      httpStatus: 401,
      bytesSent: 0,
      transferFilename: 'camera-file.heic',
    })).toEqual({
      status: 'failed',
      errorCode: 'unauthorized',
      httpStatus: 401,
      bytesSent: 0,
      transferFilename: 'camera-file.heic',
    });
    expect(() => parseNativeUploadResult({
      status: 'failed',
      errorCode: 'unknown',
    })).toThrow('invalid failure');
  });
});

describe('native preparation payload validation', () => {
  it('accepts ready current-rendition metadata without exposing a Photos ID', () => {
    expect(parseNativePreparationResult({
      fileRef: 7,
      variantId: 'prepared-7',
      mediaRole: 'unknown',
      componentSemantics: 'primary',
      originalFilename: 'IMG_3231.HEIC',
      status: 'ready',
      localUri: 'file:///tmp/current.heic',
      sizeBytes: 1234,
      transferFilename: 'IMG_3231.HEIC',
      contentType: 'public.heic',
      temporary: true,
      materializationPath: 'photo-resource',
      materializationDurationMs: 0,
      temporaryBytesWritten: 0,
    })).toEqual({
      fileRef: 7,
      variantId: 'prepared-7',
      mediaRole: 'unknown',
      componentSemantics: 'primary',
      originalFilename: 'IMG_3231.HEIC',
      status: 'ready',
      localUri: 'file:///tmp/current.heic',
      sizeBytes: 1234,
      transferFilename: 'IMG_3231.HEIC',
      contentType: 'public.heic',
      temporary: true,
      materializationPath: 'photo-resource',
      materializationDurationMs: 0,
      temporaryBytesWritten: 0,
    });
  });

  it('accepts a typed local-rendition failure and rejects malformed results', () => {
    expect(parseNativePreparationResult({
      fileRef: 8,
      variantId: 'prepared-8',
      mediaRole: 'unknown',
      componentSemantics: 'primary',
      originalFilename: '',
      status: 'failed',
      stage: 'rendition',
      errorCode: 'asset-info-unavailable',
    })).toEqual({
      fileRef: 8,
      variantId: 'prepared-8',
      mediaRole: 'unknown',
      componentSemantics: 'primary',
      originalFilename: '',
      status: 'failed',
      stage: 'rendition',
      errorCode: 'asset-info-unavailable',
    });
    expect(parseNativePreparationResult({
      fileRef: 0,
      status: 'ready',
      localUri: 'file:///tmp/a',
      sizeBytes: 1,
      transferFilename: 'a.jpg',
    })).toBeNull();
  });
});

describe('native discovery payload validation', () => {
  it('normalizes valid discovery payloads from the native module', () => {
    expect(parseDiscoveredServer({
      serverId: 'server-1',
      name: 'Desktop',
      address: '192.168.1.2',
      httpsPort: 8443,
      httpPort: 8080,
      certificateFingerprint: 'AA:'.repeat(31) + 'AA',
      approvalRequired: true,
      environment: 'production',
    })).toEqual({
      serverId: 'server-1',
      name: 'Desktop',
      address: '192.168.1.2',
      httpsPort: 8443,
      httpPort: 8080,
      certificateFingerprint: 'aa'.repeat(32),
      approvalRequired: true,
      environment: 'production',
    });
  });

  it('rejects discovery payloads that cannot establish pinned HTTPS trust', () => {
    expect(parseDiscoveredServer({
      serverId: 'server-1',
      address: '192.168.1.2',
      httpsPort: 0,
      certificateFingerprint: 'aa'.repeat(32),
      environment: 'production',
    })).toBeNull();

    expect(parseDiscoveredServer({
      serverId: 'server-1',
      address: '192.168.1.2',
      httpsPort: 8443,
      certificateFingerprint: 'short',
      environment: 'production',
    })).toBeNull();

    expect(parseDiscoveredServer({
      serverId: 'server-1',
      address: '',
      httpsPort: 8443,
      certificateFingerprint: 'aa'.repeat(32),
      environment: 'production',
    })).toBeNull();

    expect(parseDiscoveredServer({
      serverId: 'server-1',
      address: '192.168.1.2',
      httpsPort: 8443,
      certificateFingerprint: 'aa'.repeat(32),
    })).toBeNull();
  });
});
