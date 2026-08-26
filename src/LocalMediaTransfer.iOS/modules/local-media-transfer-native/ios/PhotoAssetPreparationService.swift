import Foundation
import Photos
import UniformTypeIdentifiers

/// Coordinates bounded PhotoKit requests. Resource selection, exporting,
/// session ownership, and hashing live in dedicated collaborators.
final class PhotoAssetPreparationService {
  static let maximumBatchSize = 250
  private let sessions: PreparationSessionStore
  private let catalog: PhotoAssetResourceCatalog
  private let exporter: PhotoAssetExporter

  init(sessions: PreparationSessionStore) {
    self.sessions = sessions
    self.catalog = PhotoAssetResourceCatalog()
    self.exporter = PhotoAssetExporter(sessions: sessions)
  }

  func prepareWindow(
    sessionRef: String,
    requests: [[String: Any]],
    includeAdditionalComponents: Bool,
    onProgress: ((Int, Int) -> Void)? = nil
  ) async throws -> [[String: Any]] {
    guard PreparationSessionStore.validSessionRef(sessionRef),
          requests.count <= Self.maximumBatchSize else {
      throw NSError(
        domain: "LocalMediaTransfer.Preparation",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid native preparation request"]
      )
    }

    let assetIds = requests.compactMap { $0["assetId"] as? String }
    let fetched = PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
    var assetsById: [String: PHAsset] = [:]
    fetched.enumerateObjects { asset, _, _ in
      assetsById[asset.localIdentifier] = asset
    }

    var output: [[String: Any]] = []
    var completedAssets = 0
    for request in requests {
      if sessions.isCancelled(sessionRef) { break }
      defer {
        completedAssets += 1
        onProgress?(completedAssets, requests.count)
      }
      let sourceFileRef = request["fileRef"] as? Int ?? 0
      let assetId = request["assetId"] as? String ?? ""
      guard sourceFileRef > 0, !assetId.isEmpty else {
        output.append(failure(
          assetId: assetId,
          fileRef: sourceFileRef,
          variantId: UUID().uuidString,
          mediaRole: "unknown",
          componentSemantics: "primary",
          originalFilename: "",
          stage: "filename",
          code: "invalid-filename-request"
        ))
        continue
      }
      guard let asset = assetsById[assetId] else {
        output.append(failure(
          assetId: assetId,
          fileRef: sourceFileRef,
          variantId: UUID().uuidString,
          mediaRole: "unknown",
          componentSemantics: "primary",
          originalFilename: "",
          stage: "rendition",
          code: "asset-not-found"
        ))
        continue
      }

      do {
        let variants = try catalog.variants(
          for: asset,
          includeAdditionalComponents: includeAdditionalComponents
        )
        for (variantIndex, variant) in variants.enumerated() {
          if sessions.isCancelled(sessionRef) { break }
          let variantId = UUID().uuidString.lowercased()
          let fileRef = sourceFileRef * 16 + variantIndex + 1
          do {
            let exported = try await exporter.export(
              variant,
              asset: asset,
              sessionRef: sessionRef,
              variantId: variantId
            )
            let transferFilename = reconcile(
              requestedFilename: variant.transferFilename,
              exportedUrl: exported.url,
              contentTypeIdentifier: exported.contentType,
              edited: isEdited(variant.role)
            )
            var result: [String: Any] = [
              "assetId": assetId,
              "fileRef": fileRef,
              "variantId": variantId,
              "mediaRole": variant.role.rawValue,
              "componentSemantics": variant.componentSemantics.rawValue,
              "originalFilename": variant.originalFilename,
              "status": "ready",
              "localUri": exported.url.absoluteString,
              "sizeBytes": exported.sizeBytes,
              "transferFilename": transferFilename,
              "temporary": exported.temporary,
              "materializationPath": exported.materializationPath.rawValue,
              "materializationDurationMs": exported.materializationDurationMs,
              "temporaryBytesWritten": exported.temporary ? exported.sizeBytes : 0,
            ]
            if let contentType = exported.contentType {
              result["contentType"] = contentType
            }
            output.append(result)
          } catch let error as PhotoPreparationError {
            let payload = error.payload
            output.append(failure(
              assetId: assetId,
              fileRef: fileRef,
              variantId: variantId,
              mediaRole: variant.role.rawValue,
              componentSemantics: variant.componentSemantics.rawValue,
              originalFilename: variant.originalFilename,
              stage: payload.stage,
              code: payload.code
            ))
          } catch {
            output.append(failure(
              assetId: assetId,
              fileRef: fileRef,
              variantId: variantId,
              mediaRole: variant.role.rawValue,
              componentSemantics: variant.componentSemantics.rawValue,
              originalFilename: variant.originalFilename,
              stage: "rendition",
              code: photoPreparationCode(for: error)
            ))
          }
        }
      } catch let error as PhotoPreparationError {
        let payload = error.payload
        output.append(failure(
          assetId: assetId,
          fileRef: sourceFileRef * 16 + 1,
          variantId: UUID().uuidString.lowercased(),
          mediaRole: "unknown",
          componentSemantics: "primary",
          originalFilename: "",
          stage: payload.stage,
          code: payload.code
        ))
      } catch {
        output.append(failure(
          assetId: assetId,
          fileRef: sourceFileRef * 16 + 1,
          variantId: UUID().uuidString.lowercased(),
          mediaRole: "unknown",
          componentSemantics: "primary",
          originalFilename: "",
          stage: "rendition",
          code: "asset-info-unavailable"
        ))
      }
    }
    return output
  }

  func resolveFilenames(_ requests: [[String: String]]) throws -> [[String: Any]] {
    guard requests.count <= Self.maximumBatchSize else {
      throw NSError(
        domain: "LocalMediaTransfer.Preparation",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Filename batch is too large"]
      )
    }
    let assetIds = requests.compactMap { $0["assetId"] }
    let fetched = PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
    var assetsById: [String: PHAsset] = [:]
    fetched.enumerateObjects { asset, _, _ in assetsById[asset.localIdentifier] = asset }
    return requests.map { request in
      let assetId = request["assetId"] ?? ""
      guard let asset = assetsById[assetId] else {
        return ["assetId": assetId, "status": "failed", "errorCode": "asset-not-found"]
      }
      do {
        return [
          "assetId": assetId,
          "status": "resolved",
          "filename": try catalog.primaryFilename(for: asset),
          "source": "apple-resource",
        ]
      } catch {
        return ["assetId": assetId, "status": "failed", "errorCode": "resource-not-found"]
      }
    }
  }

  private func reconcile(
    requestedFilename: String,
    exportedUrl: URL,
    contentTypeIdentifier: String?,
    edited: Bool
  ) -> String {
    let actualExtension = !exportedUrl.pathExtension.isEmpty
      ? exportedUrl.pathExtension
      : contentTypeIdentifier.flatMap {
          UTType($0)?.preferredFilenameExtension
        }
    guard let actualExtension, !actualExtension.isEmpty else {
      return requestedFilename
    }
    let requested = requestedFilename as NSString
    if requested.pathExtension.caseInsensitiveCompare(actualExtension) == .orderedSame {
      return requestedFilename
    }
    var stem = requested.deletingPathExtension
    if edited && !stem.hasSuffix(" - Edited") { stem += " - Edited" }
    return stem.isEmpty ? requestedFilename : "\(stem).\(actualExtension)"
  }

  private func isEdited(_ role: PhotoMediaRole) -> Bool {
    role == .editedPhoto || role == .editedVideo || role == .editedLivePhotoStill
  }

  private func failure(
    assetId: String,
    fileRef: Int,
    variantId: String,
    mediaRole: String,
    componentSemantics: String,
    originalFilename: String,
    stage: String,
    code: String
  ) -> [String: Any] {
    [
      "assetId": assetId,
      "fileRef": fileRef,
      "variantId": variantId,
      "mediaRole": mediaRole,
      "componentSemantics": componentSemantics,
      "originalFilename": originalFilename,
      "status": "failed",
      "stage": stage,
      "errorCode": code,
    ]
  }
}
