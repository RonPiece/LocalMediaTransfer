import Foundation
import Photos
import UniformTypeIdentifiers

/// Selects the current user-visible representation first and catalogues
/// archival/secondary resources only when the caller explicitly asks for them.
/// Internal adjustment sidecars are always excluded.
final class PhotoAssetResourceCatalog {
  func variants(
    for asset: PHAsset,
    includeAdditionalComponents: Bool
  ) throws -> [PhotoAssetVariant] {
    let resources = PHAssetResource.assetResources(for: asset)
    let hasAdjustments = resources.contains { $0.type == .adjustmentData }
    let isLivePhoto = asset.mediaSubtypes.contains(.photoLive)
    var primary: PhotoAssetVariant
    var optional: [PhotoAssetVariant] = []

    switch asset.mediaType {
    case .image:
      let originals = resources.filter { $0.type == .photo }
      let modified = resources.filter { $0.type == .fullSizePhoto }
      let alternates = resources.filter { $0.type == .alternatePhoto }
      let stillResources = originals + modified + alternates
      // Photos normally presents the rendered/JPEG companion rather than RAW
      // bytes when both are available. Prefer a non-RAW still for the default
      // primary path, while preserving RAW-only assets as their own primary.
      guard let namingResource = stillResources.first(where: {
        !isRaw($0.originalFilename)
      }) ?? stillResources.first else {
        throw PhotoPreparationError.filename("resource-not-found")
      }

      if hasAdjustments {
        primary = PhotoAssetVariant(
          role: isLivePhoto ? .editedLivePhotoStill : .editedPhoto,
          componentSemantics: .primary,
          originalFilename: namingResource.originalFilename,
          transferFilename: editedFilename(namingResource.originalFilename),
          source: .currentImage
        )
        optional.append(contentsOf: (originals + alternates).enumerated().map {
          resourceVariant(
            $0.element,
            role: imageRole(resource: $0.element, index: $0.offset, livePhoto: isLivePhoto),
            componentSemantics: .optional
          )
        })
      } else {
        primary = resourceVariant(
          namingResource,
          role: imageRole(resource: namingResource, index: 0, livePhoto: isLivePhoto),
          componentSemantics: .primary
        )
        optional.append(contentsOf: (originals + modified + alternates)
          .filter { $0 !== namingResource }
          .enumerated()
          .map {
            resourceVariant(
              $0.element,
              role: imageRole(resource: $0.element, index: $0.offset + 1, livePhoto: isLivePhoto),
              componentSemantics: .optional
            )
          })
      }

      if isLivePhoto {
        let originalMotion = resources.filter { $0.type == .pairedVideo }
        let currentMotion = resources.filter { $0.type == .fullSizePairedVideo }
        let motionResources = hasAdjustments
          ? currentMotion + originalMotion
          : (originalMotion.isEmpty ? currentMotion : originalMotion)
        optional.append(contentsOf: motionResources.map {
          resourceVariant(
            $0,
            role: .livePhotoMotion,
            componentSemantics: .optional
          )
        })
      }

    case .video:
      let originals = resources.filter { $0.type == .video }
      let modified = resources.filter { $0.type == .fullSizeVideo }
      guard let namingResource = originals.first ?? modified.first else {
        throw PhotoPreparationError.filename("resource-not-found")
      }
      if hasAdjustments {
        primary = PhotoAssetVariant(
          role: .editedVideo,
          componentSemantics: .primary,
          originalFilename: namingResource.originalFilename,
          transferFilename: editedFilename(namingResource.originalFilename),
          source: .currentVideo
        )
        optional.append(contentsOf: originals.map {
          resourceVariant($0, role: .originalVideo, componentSemantics: .optional)
        })
      } else {
        primary = resourceVariant(
          namingResource,
          role: .originalVideo,
          componentSemantics: .primary
        )
        optional.append(contentsOf: (originals + modified)
          .filter { $0 !== namingResource }
          .map {
            resourceVariant($0, role: .originalVideo, componentSemantics: .optional)
          })
      }

    default:
      throw PhotoPreparationError.rendition("asset-info-unavailable")
    }

    let selected = includeAdditionalComponents ? [primary] + optional : [primary]
    return assignSemanticNames(deduplicated(selected))
  }

  func primaryFilename(for asset: PHAsset) throws -> String {
    guard let filename = try variants(
      for: asset,
      includeAdditionalComponents: false
    ).first?.originalFilename else {
      throw PhotoPreparationError.filename("resource-not-found")
    }
    return filename
  }

  private func resourceVariant(
    _ resource: PHAssetResource,
    role: PhotoMediaRole,
    componentSemantics: PhotoComponentSemantics
  ) -> PhotoAssetVariant {
    PhotoAssetVariant(
      role: role,
      componentSemantics: componentSemantics,
      originalFilename: resource.originalFilename,
      transferFilename: resource.originalFilename,
      source: .resource(resource)
    )
  }

  private func imageRole(
    resource: PHAssetResource,
    index: Int,
    livePhoto: Bool
  ) -> PhotoMediaRole {
    if isRaw(resource.originalFilename) { return .rawOriginal }
    if livePhoto && index == 0 { return .livePhotoStill }
    if resource.type == .alternatePhoto || index > 0 { return .jpegCompanion }
    return .originalPhoto
  }

  private func isRaw(_ filename: String) -> Bool {
    guard let type = UTType(filenameExtension: (filename as NSString).pathExtension) else {
      return false
    }
    return type.conforms(to: .rawImage)
  }

  private func editedFilename(_ originalFilename: String) -> String {
    let value = originalFilename as NSString
    let stem = value.deletingPathExtension
    let ext = value.pathExtension
    let base = stem.isEmpty ? originalFilename : "\(stem) - Edited"
    return ext.isEmpty ? base : "\(base).\(ext)"
  }

  private func deduplicated(_ variants: [PhotoAssetVariant]) -> [PhotoAssetVariant] {
    var keys = Set<String>()
    return variants.filter { variant in
      let key: String
      switch variant.source {
      case .resource(let resource):
        key = "resource:\(String(describing: ObjectIdentifier(resource)))"
      case .currentImage:
        key = "current-image"
      case .currentVideo:
        key = "current-video"
      }
      return keys.insert(key).inserted
    }
  }

  private func assignSemanticNames(
    _ variants: [PhotoAssetVariant]
  ) -> [PhotoAssetVariant] {
    var used = Set<String>()
    return variants.map { variant in
      let key = variant.transferFilename.lowercased()
      guard !used.insert(key).inserted else { return variant }
      let value = variant.transferFilename as NSString
      let stem = value.deletingPathExtension
      let ext = value.pathExtension
      let suffix: String
      switch variant.role {
      case .rawOriginal: suffix = "RAW"
      case .jpegCompanion: suffix = "JPEG Companion"
      case .livePhotoStill: suffix = "Live Photo Still"
      case .livePhotoMotion: suffix = "Live Photo Motion"
      default: suffix = variant.role.rawValue
      }
      let semantic = ext.isEmpty
        ? "\(stem) - \(suffix)"
        : "\(stem) - \(suffix).\(ext)"
      used.insert(semantic.lowercased())
      return PhotoAssetVariant(
        role: variant.role,
        componentSemantics: variant.componentSemantics,
        originalFilename: variant.originalFilename,
        transferFilename: semantic,
        source: variant.source
      )
    }
  }
}
