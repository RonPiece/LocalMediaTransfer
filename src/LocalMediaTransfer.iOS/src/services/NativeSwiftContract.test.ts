import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function swiftFile(name: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../modules/local-media-transfer-native/ios/${name}`,
    ),
    'utf8',
  );
}

const moduleSource = swiftFile('LocalMediaTransferNativeModule.swift');
const preparationSource = swiftFile('PhotoAssetPreparationService.swift');
const catalogSource = swiftFile('PhotoAssetResourceCatalog.swift');
const exporterSource = swiftFile('PhotoAssetExporter.swift');
const sessionSource = swiftFile('PreparationSessionStore.swift');
const hasherSource = swiftFile('PreparedFileHasher.swift');
const thermalSource = swiftFile('ThermalMonitor.swift');
const uploadSource = swiftFile('NativeUploadService.swift');
const httpSource = swiftFile('PinnedHTTPClient.swift');
const preparationTypesSource = swiftFile('PhotoPreparationTypes.swift');
const appConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../app.json'), 'utf8'),
) as {
  expo: {
    ios: {
      privacyManifests?: {
        NSPrivacyAccessedAPITypes?: {
          NSPrivacyAccessedAPIType: string;
          NSPrivacyAccessedAPITypeReasons: string[];
        }[];
      };
    };
  };
};

function sourceSection(source: string, start: string, end: string): string {
  const startOffset = source.indexOf(start);
  const endOffset = source.indexOf(end, startOffset + start.length);
  expect(startOffset).toBeGreaterThanOrEqual(0);
  expect(endOffset).toBeGreaterThan(startOffset);
  return source.slice(startOffset, endOffset);
}

describe('native Swift source contracts', () => {
  it('keeps the Expo module as a focused service-composition boundary', () => {
    expect(moduleSource).toContain('private let discovery = DiscoveryService()');
    expect(moduleSource).toContain('private let httpClient = PinnedHTTPClient()');
    expect(moduleSource).toContain(
      'private let preparationSessions = PreparationSessionStore()',
    );
    expect(moduleSource).toContain('PhotoAssetPreparationService(');
    expect(moduleSource).toContain('PreparedFileHasher(');
    expect(moduleSource).toContain('private let uploader = NativeUploadService()');
    expect(moduleSource).not.toContain('PHAsset.fetchAssets');
    expect(moduleSource).not.toContain('FileHandle(forReadingFrom:');
    expect(moduleSource).toContain('AssetPreparationRequestRecord: Record');
    expect(moduleSource).toContain('NativeUploadOptionsRecord: Record');
    expect(moduleSource).toContain('@Field(.required)');
  });

  it('scopes passive thermal observation to the thermal event', () => {
    expect(moduleSource).toContain('OnStartObserving("onThermalStateChanged")');
    expect(moduleSource).toContain('OnStopObserving("onThermalStateChanged")');
    expect(moduleSource).toContain('self.thermalMonitor.stop()');
    const initialStateRead = thermalSource.indexOf('_ = processInfo.thermalState');
    const observerRegistration = thermalSource.indexOf(
      'NotificationCenter.default.addObserver',
    );
    expect(initialStateRead).toBeGreaterThanOrEqual(0);
    expect(observerRegistration).toBeGreaterThan(initialStateRead);
    expect(thermalSource).toContain('object: processInfo');
  });

  it('does not apply thermal state to upload scheduling', () => {
    expect(uploadSource).not.toContain('thermalState');
    expect(uploadSource).not.toContain('ProcessInfo');
    expect(uploadSource).toContain('"X-Skip-Duplicates"');
  });

  it('catalogues originals and edited renditions in one bounded PhotoKit window', () => {
    expect(preparationSource).toContain('static let maximumBatchSize = 250');
    expect(preparationSource).toContain('PHAsset.fetchAssets');
    expect(catalogSource).toContain('$0.type == .photo');
    expect(catalogSource).toContain('$0.type == .alternatePhoto');
    expect(catalogSource).toContain('stillResources.first(where:');
    expect(catalogSource).toContain('!isRaw($0.originalFilename)');
    expect(catalogSource).toContain('$0.type == .pairedVideo');
    expect(catalogSource).toContain('$0.type == .adjustmentData');
    expect(exporterSource).toContain('options.version = .current');
    expect(exporterSource).toContain('options.isNetworkAccessAllowed = false');
    expect(catalogSource).not.toContain('.adjustmentBasePhoto');
  });

  it('filters optional PhotoKit components before export and preserves component semantics', () => {
    expect(moduleSource).toContain('includeAdditionalMediaComponents');
    expect(preparationSource).toContain('includeAdditionalComponents: includeAdditionalComponents');
    expect(catalogSource).toContain('includeAdditionalComponents ? [primary] + optional : [primary]');
    expect(catalogSource).toContain('componentSemantics: .primary');
    expect(catalogSource).toContain('componentSemantics: .optional');
    expect(preparationSource).toContain('"componentSemantics": variant.componentSemantics.rawValue');
  });

  it('classifies unavailable current renditions using official PhotoKit result information', () => {
    expect(preparationTypesSource).toContain('PHImageResultIsInCloudKey');
    expect(preparationTypesSource).toContain('PHImageErrorKey');
    expect(preparationTypesSource).toContain('PHImageCancelledKey');
    expect(preparationTypesSource).toContain('PHPhotosError.Code.networkAccessRequired.rawValue');
    expect(exporterSource).toContain('photoKitResultCode(info)');
  });

  it('records only bounded aggregate materialization and temporary-lifetime measurements', () => {
    expect(preparationSource).toContain('"materializationDurationMs"');
    expect(preparationSource).toContain('"temporaryBytesWritten"');
    expect(sessionSource).toContain('temporaryCreatedAtUptime');
    expect(moduleSource).toContain('"temporaryLifetimeMs"');
    expect(moduleSource).not.toContain('originalFilename": metrics');
  });

  it('owns temporary edited renditions by transfer session', () => {
    expect(sessionSource).toContain('recordsByVariant');
    expect(sessionSource).toContain(
      'try? FileManager.default.removeItem(at: temporaryRootDirectory)',
    );
    expect(sessionSource).toContain('func release(sessionRef: String, uri: String)');
    expect(sessionSource).toContain('func end(sessionRef: String)');
    expect(sessionSource).toContain('func endAll()');
    expect(sessionSource).toContain('init() {');
    expect(sessionSource).toContain('removedStaleRoot = true');
    expect(moduleSource).toContain('AsyncFunction("releasePreparedFile")');
    expect(moduleSource).toContain('AsyncFunction("endTransfer")');
    expect(moduleSource).toContain('self.preparationSessions.endAll()');
    expect(sessionSource).toContain('maximumTemporaryBytes');
    expect(sessionSource).toContain('storageReserveBytes');
    expect(sessionSource).not.toContain('maximumPreparedFiles');
    expect(sessionSource).not.toContain('prepared-file-limit');
    expect(exporterSource).not.toContain(
      'write(to: destination, options: .atomic)',
    );
  });

  it('removes unregistered partial exports on every exporter failure path', () => {
    const resourceExport = sourceSection(
      exporterSource,
      'private func exportResource(',
      'private func exportCurrentImage(',
    );
    const imageExport = sourceSection(
      exporterSource,
      'private func exportCurrentImage(',
      'private func exportCurrentVideo(',
    );
    const videoExport = sourceSection(
      exporterSource,
      'private func exportCurrentVideo(',
      'private func currentVideoAsset(',
    );

    for (const section of [resourceExport, imageExport, videoExport]) {
      expect(section).toContain('removeItem(at: destination)');
    }
    expect(resourceExport).toContain('} catch {');
    expect(imageExport).toContain('catch let error as PhotoPreparationError');
    expect(videoExport).toContain('} catch {');
  });

  it('declares the required-reason disk-space API used by preparation policy', () => {
    expect(appConfig.expo.ios.privacyManifests?.NSPrivacyAccessedAPITypes)
      .toContainEqual({
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
        NSPrivacyAccessedAPITypeReasons: ['E174.1'],
      });
  });

  it('maps native out-of-space failures to the typed storage error', () => {
    expect(preparationTypesSource).toContain('NSFileWriteOutOfSpaceError');
    expect(preparationTypesSource).toContain('NSPOSIXErrorDomain');
    expect(preparationTypesSource).toContain('"temporary-storage-limit"');
    expect(exporterSource).toContain('photoPreparationCode(for: error)');
  });

  it('reports native preparation progress while retaining bounded PhotoKit windows', () => {
    expect(moduleSource).toContain('"onPreparationProgress"');
    expect(moduleSource).toContain('PreparationProgressCoalescer');
    expect(moduleSource).toContain('static let minimumInterval: TimeInterval = 0.1');
    expect(moduleSource).toContain('defer { progress.flush() }');
    expect(moduleSource).toContain('completedAssets >= totalAssets');
    expect(moduleSource).not.toContain('Timer.scheduledTimer');
    expect(moduleSource).not.toContain('DispatchSource.makeTimerSource');
    expect(preparationSource).toContain('onProgress: ((Int, Int) -> Void)? = nil');
    expect(preparationSource).toContain('onProgress?(completedAssets, requests.count)');
  });

  it('hashes only session-owned prepared files with bounded incremental reads', () => {
    expect(moduleSource).toContain('AsyncFunction("hashPreparedFiles")');
    expect(hasherSource).toContain('private static let chunkSize = 4 * 1024 * 1024');
    expect(hasherSource).toContain('private static let permits = HashPermitPool()');
    expect(hasherSource).toContain('FileHandle(forReadingFrom: snapshot.url)');
    expect(hasherSource).toContain('hasher.update(data: data)');
    expect(hasherSource).toContain('sessions.snapshot(');
    expect(hasherSource).toContain('"bytesRead": bytesRead');
    expect(hasherSource).toContain('"durationMs": durationMs');
    expect(hasherSource).toContain('"cacheHit": cacheHit');
    expect(hasherSource).toContain('ProcessInfo.processInfo.systemUptime');
    expect(hasherSource).not.toContain('Data(contentsOf:');
  });

  it('does not retry a native upload after cancellation is observed', () => {
    const catchOffset = uploadSource.indexOf('} catch {');
    const cancellationOffset = uploadSource.indexOf(
      'if isCancelled {',
      catchOffset,
    );
    const retryOffset = uploadSource.indexOf('retryCount += 1', catchOffset);
    expect(catchOffset).toBeGreaterThanOrEqual(0);
    expect(cancellationOffset).toBeGreaterThan(catchOffset);
    expect(retryOffset).toBeGreaterThan(cancellationOffset);
    expect(uploadSource).toContain('activeTasks');
    expect(uploadSource).toContain('tasks.forEach { $0.cancel() }');
  });

  it('cancels active Photos and AVFoundation operations', () => {
    expect(exporterSource).toContain('cancelImageRequest');
    expect(exporterSource).toContain('cancelExport()');
    expect(moduleSource).toContain('self.preparationSessions.cancel(sessionRef: sessionRef)');
  });

  it('binds pinned HTTPS challenges and redirects to the configured origin', () => {
    expect(httpSource).toContain(
      'challenge.protectionSpace.host.lowercased() == expectedHost',
    );
    expect(httpSource).toContain(
      'challenge.protectionSpace.port == expectedPort',
    );
    expect(httpSource).toContain('willPerformHTTPRedirection');
    expect(httpSource).toContain('origin(for: url) == baseUrl');
  });
});
