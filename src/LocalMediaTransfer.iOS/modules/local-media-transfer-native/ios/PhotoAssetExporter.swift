import AVFoundation
import Foundation
import Photos
import UniformTypeIdentifiers

private final class PhotoContinuationGate<Value> {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Value, Error>?
  private var completed = false

  init(_ continuation: CheckedContinuation<Value, Error>) {
    self.continuation = continuation
  }

  var isCompleted: Bool {
    lock.lock()
    defer { lock.unlock() }
    return completed
  }

  func resume(with result: Result<Value, Error>) {
    lock.lock()
    guard !completed, let continuation else {
      lock.unlock()
      return
    }
    completed = true
    self.continuation = nil
    lock.unlock()
    continuation.resume(with: result)
  }
}

/// Exports catalogued PhotoKit resources to session-owned files. Cloud access
/// stays disabled so selection never triggers an implicit cellular download.
final class PhotoAssetExporter {
  private let sessions: PreparationSessionStore

  init(sessions: PreparationSessionStore) {
    self.sessions = sessions
  }

  func export(
    _ variant: PhotoAssetVariant,
    asset: PHAsset,
    sessionRef: String,
    variantId: String
  ) async throws -> ExportedPhotoVariant {
    guard !sessions.isCancelled(sessionRef) else {
      throw PhotoPreparationError.rendition("cancelled")
    }

    let startedAt = ProcessInfo.processInfo.systemUptime
    let materializationPath = diagnosticPath(for: variant)
    let exported: ExportedPhotoVariant
    switch variant.source {
    case .resource(let resource):
      exported = try await exportResource(resource, sessionRef: sessionRef)
    case .currentImage:
      exported = try await exportCurrentImage(asset, sessionRef: sessionRef)
    case .currentVideo:
      exported = try await exportCurrentVideo(asset, sessionRef: sessionRef)
    }

    do {
      try sessions.registerPreparedFile(
        sessionRef: sessionRef,
        variantId: variantId,
        url: exported.url,
        sizeBytes: exported.sizeBytes,
        temporary: exported.temporary,
        materializationPath: materializationPath,
        temporaryCreatedAtUptime: exported.temporaryCreatedAtUptime
      )
    } catch {
      if exported.temporary { try? FileManager.default.removeItem(at: exported.url) }
      throw error
    }
    return ExportedPhotoVariant(
      url: exported.url,
      sizeBytes: exported.sizeBytes,
      contentType: exported.contentType,
      temporary: exported.temporary,
      materializationPath: materializationPath,
      materializationDurationMs: max(
        0,
        (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000
      ),
      temporaryCreatedAtUptime: exported.temporaryCreatedAtUptime
    )
  }

  private func exportResource(
    _ resource: PHAssetResource,
    sessionRef: String
  ) async throws -> ExportedPhotoVariant {
    let ext = (resource.originalFilename as NSString).pathExtension
    let destination = try sessions.temporaryUrl(
      sessionRef: sessionRef,
      fileExtension: ext.isEmpty ? "bin" : ext
    )
    let temporaryCreatedAtUptime = ProcessInfo.processInfo.systemUptime
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = false
    do {
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, Error>) in
        PHAssetResourceManager.default().writeData(
          for: resource,
          toFile: destination,
          options: options
        ) { error in
          if let error {
            continuation.resume(throwing: error)
          } else {
            continuation.resume(returning: ())
          }
        }
      }
      guard !sessions.isCancelled(sessionRef) else {
        throw PhotoPreparationError.rendition("cancelled")
      }
      return try inspectedTemporary(
        destination,
        path: .photoResource,
        temporaryCreatedAtUptime: temporaryCreatedAtUptime
      )
    } catch {
      // PhotoKit progressively writes this destination and may leave a partial
      // file when the request fails. It is not registered with the session yet,
      // so the exporter must remove it immediately instead of waiting for the
      // session directory fallback cleanup.
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
  }

  private func exportCurrentImage(
    _ asset: PHAsset,
    sessionRef: String
  ) async throws -> ExportedPhotoVariant {
    let options = PHImageRequestOptions()
    options.version = .current
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = false
    let value = try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<(Data, String?), Error>) in
      let gate = PhotoContinuationGate(continuation)
      let operationId = UUID()
      let manager = PHImageManager.default()
      let requestId = manager.requestImageDataAndOrientation(
        for: asset,
        options: options
      ) { data, dataUTI, _, info in
        self.sessions.completeOperation(sessionRef: sessionRef, id: operationId)
        guard let data else {
          gate.resume(with: .failure(
            PhotoPreparationError.rendition(photoKitResultCode(info))
          ))
          return
        }
        gate.resume(with: .success((data, dataUTI)))
      }
      sessions.registerOperation(
        sessionRef: sessionRef,
        id: operationId,
        completed: gate.isCompleted
      ) {
        manager.cancelImageRequest(requestId)
        gate.resume(with: .failure(PhotoPreparationError.rendition("cancelled")))
      }
    }
    let ext = value.1.flatMap { UTType($0)?.preferredFilenameExtension } ?? "jpg"
    let destination = try sessions.temporaryUrl(
      sessionRef: sessionRef,
      fileExtension: ext
    )
    let temporaryCreatedAtUptime = ProcessInfo.processInfo.systemUptime
    do {
      try value.0.write(to: destination)
      let inspected = try inspectedTemporary(
        destination,
        path: .currentImage,
        temporaryCreatedAtUptime: temporaryCreatedAtUptime
      )
      return ExportedPhotoVariant(
        url: inspected.url,
        sizeBytes: inspected.sizeBytes,
        contentType: value.1,
        temporary: true,
        materializationPath: .currentImage,
        materializationDurationMs: 0,
        temporaryCreatedAtUptime: temporaryCreatedAtUptime
      )
    } catch let error as PhotoPreparationError {
      try? FileManager.default.removeItem(at: destination)
      throw error
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw PhotoPreparationError.rendition(photoPreparationCode(for: error))
    }
  }

  private func exportCurrentVideo(
    _ asset: PHAsset,
    sessionRef: String
  ) async throws -> ExportedPhotoVariant {
    let avAsset = try await currentVideoAsset(asset, sessionRef: sessionRef)
    let destination = try sessions.temporaryUrl(
      sessionRef: sessionRef,
      fileExtension: "mov"
    )
    let temporaryCreatedAtUptime = ProcessInfo.processInfo.systemUptime
    guard let exporter = AVAssetExportSession(
      asset: avAsset,
      presetName: AVAssetExportPresetHighestQuality
    ) else {
      throw PhotoPreparationError.rendition("asset-info-unavailable")
    }
    exporter.outputURL = destination
    exporter.outputFileType = .mov
    exporter.shouldOptimizeForNetworkUse = false
    do {
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, Error>) in
        let gate = PhotoContinuationGate(continuation)
        let operationId = UUID()
        exporter.exportAsynchronously {
          self.sessions.completeOperation(sessionRef: sessionRef, id: operationId)
          switch exporter.status {
          case .completed: gate.resume(with: .success(()))
          case .cancelled:
            gate.resume(with: .failure(PhotoPreparationError.rendition("cancelled")))
          default:
            gate.resume(with: .failure(
              PhotoPreparationError.rendition(
                exporter.error.map { photoPreparationCode(for: $0) }
                  ?? "asset-info-unavailable"
              )
            ))
          }
        }
        sessions.registerOperation(
          sessionRef: sessionRef,
          id: operationId,
          completed: gate.isCompleted
        ) {
          exporter.cancelExport()
          gate.resume(with: .failure(PhotoPreparationError.rendition("cancelled")))
        }
      }
      let inspected = try inspectedTemporary(
        destination,
        path: .currentVideo,
        temporaryCreatedAtUptime: temporaryCreatedAtUptime
      )
      return ExportedPhotoVariant(
        url: inspected.url,
        sizeBytes: inspected.sizeBytes,
        contentType: UTType.quickTimeMovie.identifier,
        temporary: true,
        materializationPath: .currentVideo,
        materializationDurationMs: 0,
        temporaryCreatedAtUptime: temporaryCreatedAtUptime
      )
    } catch {
      // AVAssetExportSession can also leave a partial destination on failure or
      // cancellation. As above, it has not reached session registration yet.
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
  }

  private func currentVideoAsset(
    _ asset: PHAsset,
    sessionRef: String
  ) async throws -> AVAsset {
    let options = PHVideoRequestOptions()
    options.version = .current
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = false
    return try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<AVAsset, Error>) in
      let gate = PhotoContinuationGate(continuation)
      let operationId = UUID()
      let manager = PHImageManager.default()
      let requestId = manager.requestAVAsset(forVideo: asset, options: options) {
        avAsset, _, info in
        self.sessions.completeOperation(sessionRef: sessionRef, id: operationId)
        guard let avAsset else {
          gate.resume(with: .failure(
            PhotoPreparationError.rendition(photoKitResultCode(info))
          ))
          return
        }
        gate.resume(with: .success(avAsset))
      }
      sessions.registerOperation(
        sessionRef: sessionRef,
        id: operationId,
        completed: gate.isCompleted
      ) {
        manager.cancelImageRequest(requestId)
        gate.resume(with: .failure(PhotoPreparationError.rendition("cancelled")))
      }
    }
  }

  private func inspectedTemporary(
    _ url: URL,
    path: PhotoMaterializationPath,
    temporaryCreatedAtUptime: TimeInterval
  ) throws -> ExportedPhotoVariant {
    let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
    guard let size = values.fileSize, size > 0 else {
      try? FileManager.default.removeItem(at: url)
      throw PhotoPreparationError.metadata("file-empty")
    }
    return ExportedPhotoVariant(
      url: url,
      sizeBytes: UInt64(size),
      contentType: values.contentType?.identifier,
      temporary: true,
      materializationPath: path,
      materializationDurationMs: 0,
      temporaryCreatedAtUptime: temporaryCreatedAtUptime
    )
  }

  private func diagnosticPath(
    for variant: PhotoAssetVariant
  ) -> PhotoMaterializationPath {
    switch variant.source {
    case .currentImage: return .currentImage
    case .currentVideo: return .currentVideo
    case .resource:
      switch variant.role {
      case .rawOriginal: return .rawResource
      case .livePhotoMotion: return .livePhotoMotion
      case .originalVideo, .editedVideo: return .videoResource
      default: return .photoResource
      }
    }
  }
}
