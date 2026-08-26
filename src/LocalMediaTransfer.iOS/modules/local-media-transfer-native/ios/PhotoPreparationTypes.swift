import Foundation
import Photos

func photoPreparationCode(for error: Error) -> String {
  var current = error as NSError
  for _ in 0..<4 {
    if (current.domain == NSCocoaErrorDomain && current.code == NSFileWriteOutOfSpaceError) ||
        (current.domain == NSPOSIXErrorDomain && current.code == 28) {
      return "temporary-storage-limit"
    }
    if current.domain == PHPhotosErrorDomain &&
        current.code == PHPhotosError.Code.networkAccessRequired.rawValue {
      return "icloud-resource-unavailable"
    }
    guard let underlying = current.userInfo[NSUnderlyingErrorKey] as? NSError,
          underlying !== current else { break }
    current = underlying
  }
  return "asset-info-unavailable"
}

func photoKitResultCode(_ info: [AnyHashable: Any]?) -> String {
  if (info?[PHImageCancelledKey] as? NSNumber)?.boolValue == true {
    return "cancelled"
  }
  if let error = info?[PHImageErrorKey] as? Error {
    return photoPreparationCode(for: error)
  }
  if (info?[PHImageResultIsInCloudKey] as? NSNumber)?.boolValue == true {
    return "icloud-resource-unavailable"
  }
  return "asset-info-unavailable"
}

enum PhotoPreparationError: Error {
  case rendition(String)
  case metadata(String)
  case filename(String)

  var payload: (stage: String, code: String) {
    switch self {
    case .rendition(let code): return ("rendition", code)
    case .metadata(let code): return ("metadata", code)
    case .filename(let code): return ("filename", code)
    }
  }
}

enum PhotoMediaRole: String {
  case originalPhoto = "original-photo"
  case originalVideo = "original-video"
  case rawOriginal = "raw-original"
  case jpegCompanion = "jpeg-companion"
  case livePhotoStill = "live-photo-still"
  case livePhotoMotion = "live-photo-motion"
  case editedPhoto = "edited-photo"
  case editedVideo = "edited-video"
  case editedLivePhotoStill = "edited-live-photo-still"
}

enum PhotoComponentSemantics: String {
  case primary
  case optional
}

enum PhotoVariantSource {
  case resource(PHAssetResource)
  case currentImage
  case currentVideo
}

enum PhotoMaterializationPath: String {
  case photoResource = "photo-resource"
  case videoResource = "video-resource"
  case rawResource = "raw-resource"
  case livePhotoMotion = "live-photo-motion"
  case currentImage = "current-image"
  case currentVideo = "current-video"
}

struct PhotoAssetVariant {
  let role: PhotoMediaRole
  let componentSemantics: PhotoComponentSemantics
  let originalFilename: String
  let transferFilename: String
  let source: PhotoVariantSource
}

struct ExportedPhotoVariant {
  let url: URL
  let sizeBytes: UInt64
  let contentType: String?
  let temporary: Bool
  let materializationPath: PhotoMaterializationPath
  let materializationDurationMs: Double
  let temporaryCreatedAtUptime: TimeInterval?
}
