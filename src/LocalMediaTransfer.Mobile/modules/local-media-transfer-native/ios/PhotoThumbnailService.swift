import Foundation
import Photos
import UIKit

/// Small, local-only history previews. Never exports original resources or
/// downloads iCloud content; runs on the bridge's dedicated serial queue.
final class PhotoThumbnailService {
  func thumbnails(assetIds: [String]) -> [[String: String]] {
    guard assetIds.count <= 20 else { return [] }
    let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard authorization == .authorized || authorization == .limited else { return [] }
    return assetIds.compactMap { identifier -> [String: String]? in
      autoreleasepool { () -> [String: String]? in
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else { return nil }
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = false
        options.deliveryMode = .fastFormat
        options.resizeMode = .exact
        let semaphore = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var jpeg: Data?
        var accepting = true
        let request = PHImageManager.default().requestImage(
          for: asset, targetSize: CGSize(width: 160, height: 160),
          contentMode: .aspectFill, options: options
        ) { image, _ in
          lock.lock()
          if accepting, let image, image.size.width > 0, image.size.height > 0 {
            // Explicitly cap pixels even if PhotoKit returns a larger image.
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let size = CGSize(width: 160, height: 160)
            let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
              let ratio = max(size.width / image.size.width, size.height / image.size.height)
              let width = image.size.width * ratio
              let height = image.size.height * ratio
              image.draw(in: CGRect(x: (160 - width) / 2, y: (160 - height) / 2, width: width, height: height))
            }
            jpeg = resized.jpegData(compressionQuality: 0.65)
          }
          lock.unlock()
          semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + .milliseconds(500))
        lock.lock()
        accepting = false
        let result = jpeg
        lock.unlock()
        PHImageManager.default().cancelImageRequest(request)
        guard let result, result.count <= 24_000 else { return nil }
        return ["assetId": identifier, "jpegBase64": result.base64EncodedString()]
      }
    }
  }
}
