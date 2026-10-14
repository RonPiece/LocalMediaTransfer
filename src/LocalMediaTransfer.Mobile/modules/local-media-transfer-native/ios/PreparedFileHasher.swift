import CryptoKit
import Foundation

private actor HashPermitPool {
  private var available = 2
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func acquire() async {
    if available > 0 {
      available -= 1
      return
    }
    await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    if waiters.isEmpty {
      available += 1
    } else {
      waiters.removeFirst().resume()
    }
  }
}

private actor HashRequestQueue {
  private var requests: [PreparedHashRequest]
  private var cursor = 0

  init(_ requests: [PreparedHashRequest]) {
    self.requests = requests
  }

  func next() -> PreparedHashRequest? {
    guard cursor < requests.count else { return nil }
    defer { cursor += 1 }
    return requests[cursor]
  }
}

struct PreparedHashRequest {
  let variantId: String
  let uri: String
  let expectedSizeBytes: UInt64
}

private struct PreparedHashResult {
  let variantId: String
  let status: String
  let sha256: String?
  let errorCode: String?
  let bytesRead: UInt64
  let durationMs: Double
  let cacheHit: Bool

  var dictionary: [String: Any] {
    var value: [String: Any] = [
      "variantId": variantId,
      "status": status,
      "bytesRead": bytesRead,
      "durationMs": durationMs,
      "cacheHit": cacheHit,
    ]
    if let sha256 { value["sha256"] = sha256 }
    if let errorCode { value["errorCode"] = errorCode }
    return value
  }
}

/// Incrementally hashes only files registered by native preparation. The
/// process-wide permit pool bounds concurrent disk readers to two even if more
/// than one bridge call overlaps.
final class PreparedFileHasher {
  static let maximumBatchSize = 100
  private static let chunkSize = 4 * 1024 * 1024
  private static let permits = HashPermitPool()
  private let sessions: PreparationSessionStore

  init(sessions: PreparationSessionStore) {
    self.sessions = sessions
  }

  func hashPreparedFiles(
    sessionRef: String,
    requests: [PreparedHashRequest]
  ) async throws -> [[String: Any]] {
    guard PreparationSessionStore.validSessionRef(sessionRef),
          !requests.isEmpty,
          requests.count <= Self.maximumBatchSize else {
      throw NSError(
        domain: "LocalMediaTransfer.Hashing",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid native hash request"]
      )
    }
    let queue = HashRequestQueue(requests)
    let results = await withTaskGroup(
      of: [PreparedHashResult].self,
      returning: [PreparedHashResult].self
    ) { group in
      for _ in 0..<min(2, requests.count) {
        group.addTask {
          var workerResults: [PreparedHashResult] = []
          while let request = await queue.next() {
            await Self.permits.acquire()
            let result = self.hashOne(sessionRef: sessionRef, request: request)
            await Self.permits.release()
            workerResults.append(result)
          }
          return workerResults
        }
      }
      var combined: [PreparedHashResult] = []
      for await workerResults in group { combined.append(contentsOf: workerResults) }
      return combined
    }
    return results.map(\.dictionary)
  }

  private func hashOne(
    sessionRef: String,
    request: PreparedHashRequest
  ) -> PreparedHashResult {
    let startedAt = ProcessInfo.processInfo.systemUptime
    var bytesRead: UInt64 = 0
    func elapsedMs() -> Double {
      max(0, (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
    }

    if sessions.isCancelled(sessionRef) {
      return failure(request.variantId, "cancelled", bytesRead, elapsedMs())
    }
    if let cached = sessions.cachedHash(
      sessionRef: sessionRef,
      variantId: request.variantId
    ) {
      return success(request.variantId, cached, 0, elapsedMs(), true)
    }
    guard let snapshot = sessions.snapshot(
      sessionRef: sessionRef,
      variantId: request.variantId,
      uri: request.uri,
      expectedSizeBytes: request.expectedSizeBytes
    ) else {
      return failure(
        request.variantId,
        "prepared-file-not-owned",
        bytesRead,
        elapsedMs()
      )
    }

    do {
      let before = try snapshot.url.resourceValues(forKeys: [
        .fileSizeKey,
        .contentModificationDateKey,
        .isRegularFileKey,
      ])
      guard before.isRegularFile != false,
            before.fileSize == Int(snapshot.sizeBytes),
            before.contentModificationDate == snapshot.modificationDate else {
        return failure(request.variantId, "file-changed", bytesRead, elapsedMs())
      }
      let handle = try FileHandle(forReadingFrom: snapshot.url)
      defer { try? handle.close() }
      var hasher = SHA256()
      while true {
        if sessions.isCancelled(sessionRef) {
          return failure(request.variantId, "cancelled", bytesRead, elapsedMs())
        }
        guard let data = try handle.read(upToCount: Self.chunkSize), !data.isEmpty else {
          break
        }
        bytesRead += UInt64(data.count)
        if bytesRead > snapshot.sizeBytes {
          return failure(request.variantId, "file-changed", bytesRead, elapsedMs())
        }
        hasher.update(data: data)
      }
      guard bytesRead == snapshot.sizeBytes else {
        return failure(request.variantId, "file-changed", bytesRead, elapsedMs())
      }
      let after = try snapshot.url.resourceValues(forKeys: [
        .fileSizeKey,
        .contentModificationDateKey,
      ])
      guard after.fileSize == before.fileSize,
            after.contentModificationDate == before.contentModificationDate else {
        return failure(request.variantId, "file-changed", bytesRead, elapsedMs())
      }
      let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
      sessions.cacheHash(
        sessionRef: sessionRef,
        variantId: request.variantId,
        sha256: digest
      )
      return success(request.variantId, digest, bytesRead, elapsedMs(), false)
    } catch {
      return failure(request.variantId, "file-read-failed", bytesRead, elapsedMs())
    }
  }

  private func success(
    _ variantId: String,
    _ sha256: String,
    _ bytesRead: UInt64,
    _ durationMs: Double,
    _ cacheHit: Bool
  ) -> PreparedHashResult {
    PreparedHashResult(
      variantId: variantId,
      status: "success",
      sha256: sha256,
      errorCode: nil,
      bytesRead: bytesRead,
      durationMs: durationMs,
      cacheHit: cacheHit
    )
  }

  private func failure(
    _ variantId: String,
    _ code: String,
    _ bytesRead: UInt64,
    _ durationMs: Double
  ) -> PreparedHashResult {
    PreparedHashResult(
      variantId: variantId,
      status: "failed",
      sha256: nil,
      errorCode: code,
      bytesRead: bytesRead,
      durationMs: durationMs,
      cacheHit: false
    )
  }
}
