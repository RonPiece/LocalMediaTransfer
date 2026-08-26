import ExpoModulesCore
import Foundation

/// Coalesces bridge-only UI progress without changing preparation work or
/// diagnostics. It owns no timer and lives for exactly one preparation call.
private final class PreparationProgressCoalescer {
  static let minimumInterval: TimeInterval = 0.1

  private struct Sample {
    let completedAssets: Int
    let totalAssets: Int
  }

  private let lock = NSLock()
  private let emit: (Int, Int) -> Void
  private var pending: Sample?
  private var lastEmittedAt: TimeInterval?
  private var lastEmittedCompletedAssets = -1

  init(emit: @escaping (Int, Int) -> Void) {
    self.emit = emit
  }

  func record(completedAssets: Int, totalAssets: Int) {
    let sample = Sample(
      completedAssets: completedAssets,
      totalAssets: totalAssets
    )
    let now = ProcessInfo.processInfo.systemUptime
    var sampleToEmit: Sample?
    lock.lock()
    pending = sample
    if lastEmittedAt == nil ||
        completedAssets >= totalAssets ||
        now - (lastEmittedAt ?? now) >= Self.minimumInterval {
      sampleToEmit = pending
      pending = nil
      lastEmittedAt = now
      lastEmittedCompletedAssets = completedAssets
    }
    lock.unlock()
    if let sampleToEmit {
      emit(sampleToEmit.completedAssets, sampleToEmit.totalAssets)
    }
  }

  func flush() {
    var sampleToEmit: Sample?
    lock.lock()
    if let pending, pending.completedAssets != lastEmittedCompletedAssets {
      sampleToEmit = pending
      lastEmittedAt = ProcessInfo.processInfo.systemUptime
      lastEmittedCompletedAssets = pending.completedAssets
    }
    pending = nil
    lock.unlock()
    if let sampleToEmit {
      emit(sampleToEmit.completedAssets, sampleToEmit.totalAssets)
    }
  }
}

private struct SecureConnectionRecord: Record {
  @Field(.required) var baseUrl: String
  @Field(.required) var fingerprint: String
}

private struct NativeHttpRequestRecord: Record {
  @Field(.required) var url: String
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String?
}

private struct FilenameResolutionRequestRecord: Record {
  @Field(.required) var assetId: String
  @Field(.required) var uri: String
  @Field var fallbackFilename: String = ""
}

private struct AssetPreparationRequestRecord: Record {
  @Field(.required) var fileRef: Int
  @Field(.required) var assetId: String
}

private struct AssetPreparationOptionsRecord: Record {
  @Field var includeAdditionalMediaComponents: Bool = false
}

private struct PreparedHashRequestRecord: Record {
  @Field(.required) var variantId: String
  @Field(.required) var localUri: String
  @Field(.required) var expectedSizeBytes: Double
}

private struct NativeUploadOptionsRecord: Record {
  @Field(.required) var uri: String
  @Field(.required) var endpoint: String
  @Field var token: String = ""
  @Field(.required) var fileId: String
  @Field(.required) var transferFilename: String
  @Field var chunkSize: Int = 8 * 1024 * 1024
  @Field var skipDuplicates: Bool = true
}

/// Expo Modules Core bridge for the installed iOS application.
///
/// The bridge validates JavaScript inputs as typed records and delegates
/// PhotoKit, network, discovery, and thermal work to focused services.
public final class LocalMediaTransferNativeModule: Module {
  private let discovery = DiscoveryService()
  private let httpClient = PinnedHTTPClient()
  private let preparationSessions = PreparationSessionStore()
  private lazy var photoPreparation = PhotoAssetPreparationService(
    sessions: preparationSessions
  )
  private lazy var preparedFileHasher = PreparedFileHasher(
    sessions: preparationSessions
  )
  private let thermalMonitor = ThermalMonitor()
  private let uploader = NativeUploadService()

  public func definition() -> ModuleDefinition {
    Name("LocalMediaTransferNative")
    Events("onUploadProgress", "onThermalStateChanged", "onPreparationProgress")

    OnStartObserving("onThermalStateChanged") {
      self.thermalMonitor.start { [weak self] state in
        self?.sendEvent("onThermalStateChanged", ["state": state])
      }
    }

    OnStopObserving("onThermalStateChanged") {
      self.thermalMonitor.stop()
    }

    OnDestroy {
      self.thermalMonitor.stop()
      self.uploader.cancel()
      self.preparationSessions.endAll()
      self.httpClient.clear()
    }

    AsyncFunction("discover") {
      (timeoutMs: Int, port: Int, environment: String) -> [[String: Any]] in
      guard port > 0,
            port <= 65_535,
            environment == "production" || environment == "test" else {
        throw Exception(
          name: "DiscoveryError",
          description: "Invalid discovery configuration"
        )
      }
      return try self.discovery.discover(
        timeoutMs: min(max(timeoutMs, 250), 5_000),
        port: port,
        environment: environment
      )
    }

    AsyncFunction("configureSecureConnection") {
      (options: SecureConnectionRecord) in
      try self.httpClient.configure(
        baseUrl: options.baseUrl,
        fingerprint: options.fingerprint
      )
    }

    Function("clearSecureConnection") {
      self.httpClient.clear()
    }

    AsyncFunction("request") {
      (options: NativeHttpRequestRecord) -> [String: Any] in
      try await self.httpClient.performRequest(
        url: options.url,
        method: options.method,
        headers: options.headers,
        body: options.body
      )
    }

    AsyncFunction("securityState") { () -> [String: Any] in
      self.httpClient.securityState()
    }

    AsyncFunction("resolveAssetFilenames") {
      (requests: [FilenameResolutionRequestRecord]) -> [[String: Any]] in
      try self.photoPreparation.resolveFilenames(requests.map {
        [
          "assetId": $0.assetId,
          "uri": $0.uri,
          "fallbackFilename": $0.fallbackFilename,
        ]
      })
    }

    AsyncFunction("prepareAssetWindow") {
      (
        sessionRef: String,
        requests: [AssetPreparationRequestRecord],
        options: AssetPreparationOptionsRecord
      ) -> [[String: Any]] in
      let progress = PreparationProgressCoalescer { [weak self] completedAssets, totalAssets in
        self?.sendEvent("onPreparationProgress", [
          "sessionRef": sessionRef,
          "completedAssets": completedAssets,
          "totalAssets": totalAssets,
        ])
      }
      defer { progress.flush() }
      return try await self.photoPreparation.prepareWindow(
        sessionRef: sessionRef,
        requests: requests.map {
          ["fileRef": $0.fileRef, "assetId": $0.assetId]
        },
        includeAdditionalComponents: options.includeAdditionalMediaComponents,
        onProgress: { completedAssets, totalAssets in
          progress.record(
            completedAssets: completedAssets,
            totalAssets: totalAssets
          )
        }
      )
    }

    AsyncFunction("hashPreparedFiles") {
      (
        sessionRef: String,
        requests: [PreparedHashRequestRecord]
      ) -> [[String: Any]] in
      let parsed = try requests.map { request -> PreparedHashRequest in
        guard request.expectedSizeBytes > 0,
              request.expectedSizeBytes.rounded(.towardZero) == request.expectedSizeBytes,
              request.expectedSizeBytes <= Double(UInt64.max) else {
          throw Exception(
            name: "HashingError",
            description: "Invalid expected file size"
          )
        }
        return PreparedHashRequest(
          variantId: request.variantId,
          uri: request.localUri,
          expectedSizeBytes: UInt64(request.expectedSizeBytes)
        )
      }
      return try await self.preparedFileHasher.hashPreparedFiles(
        sessionRef: sessionRef,
        requests: parsed
      )
    }

    AsyncFunction("releasePreparedFile") {
      (sessionRef: String, uri: String) -> [String: Any]? in
      guard let metrics = self.preparationSessions.release(
        sessionRef: sessionRef,
        uri: uri
      ) else { return nil }
      return [
        "materializationPath": metrics.materializationPath.rawValue,
        "temporaryBytesWritten": metrics.temporaryBytesWritten,
        "temporaryLifetimeMs": metrics.temporaryLifetimeMs,
      ]
    }

    AsyncFunction("endTransfer") { (sessionRef: String) in
      self.preparationSessions.end(sessionRef: sessionRef)
    }

    AsyncFunction("getThermalState") { () -> String in
      self.thermalMonitor.currentState
    }

    AsyncFunction("beginTransfer") { (sessionRef: String) in
      self.preparationSessions.begin(sessionRef: sessionRef)
      self.uploader.begin()
    }

    Function("cancel") { (sessionRef: String) in
      self.preparationSessions.cancel(sessionRef: sessionRef)
      self.uploader.cancel()
    }

    AsyncFunction("uploadFile") {
      (options: NativeUploadOptionsRecord) -> [String: Any] in
      try await self.uploader.upload(
        uri: options.uri,
        endpoint: options.endpoint,
        token: options.token,
        fileId: options.fileId,
        transferFilename: options.transferFilename,
        chunkSize: options.chunkSize,
        skipDuplicates: options.skipDuplicates,
        httpClient: self.httpClient
      ) { [weak self] progress in
        self?.sendEvent("onUploadProgress", progress)
      }
    }
  }
}
