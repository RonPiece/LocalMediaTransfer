import Foundation

struct PreparedFileSnapshot {
  let variantId: String
  let url: URL
  let sizeBytes: UInt64
  let modificationDate: Date?
}

struct ReleasedPreparedFileMetrics {
  let materializationPath: PhotoMaterializationPath
  let temporaryBytesWritten: UInt64
  let temporaryLifetimeMs: Double
}

/// Owns the lifecycle and authorization boundary for prepared native files.
/// Hashing and release calls can access only records registered to the exact
/// transfer session that produced them.
final class PreparationSessionStore {
  private static let storageReserveBytes: UInt64 = 1_000_000_000
  private static let maximumTemporaryBytes: UInt64 = 100_000_000_000
  private static let fallbackTemporaryBytes: UInt64 = 2_000_000_000

  private struct PreparedRecord {
    let variantId: String
    let url: URL
    let sizeBytes: UInt64
    let modificationDate: Date?
    let temporary: Bool
    let materializationPath: PhotoMaterializationPath
    let temporaryCreatedAtUptime: TimeInterval
  }

  private struct Session {
    var cancelled = false
    var budgetBytes: UInt64
    var reservedBytes: UInt64 = 0
    var recordsByVariant: [String: PreparedRecord] = [:]
    var variantByUrl: [URL: String] = [:]
    var hashesByVariant: [String: String] = [:]
    var operations: [UUID: () -> Void] = [:]
  }

  private let lock = NSLock()
  private var sessions: [String: Session] = [:]
  private var removedStaleRoot = false

  init() {
    // A newly constructed store cannot own an active transfer. Remove output
    // left by a previous process before the user starts another transfer;
    // begin() retains the same fallback for hosts that construct lazily.
    try? FileManager.default.removeItem(at: temporaryRootDirectory)
    removedStaleRoot = true
  }

  func begin(sessionRef: String) {
    guard Self.validSessionRef(sessionRef) else { return }
    lock.lock()
    let removeStaleRoot = !removedStaleRoot
    removedStaleRoot = true
    sessions[sessionRef] = Session(budgetBytes: temporaryBudget())
    lock.unlock()
    if removeStaleRoot {
      try? FileManager.default.removeItem(at: temporaryRootDirectory)
    }
  }

  func cancel(sessionRef: String) {
    lock.lock()
    guard var session = sessions[sessionRef] else {
      lock.unlock()
      return
    }
    session.cancelled = true
    let cancellations = Array(session.operations.values)
    session.operations.removeAll()
    sessions[sessionRef] = session
    lock.unlock()
    cancellations.forEach { $0() }
  }

  func end(sessionRef: String) {
    cancel(sessionRef: sessionRef)
    lock.lock()
    let session = sessions.removeValue(forKey: sessionRef)
    lock.unlock()
    if let session {
      for record in session.recordsByVariant.values where record.temporary {
        try? FileManager.default.removeItem(at: record.url)
      }
    }
    try? FileManager.default.removeItem(at: sessionDirectory(sessionRef))
  }

  func endAll() {
    lock.lock()
    let active = sessions
    sessions.removeAll()
    lock.unlock()
    active.values.flatMap { $0.operations.values }.forEach { $0() }
    for session in active.values {
      for record in session.recordsByVariant.values where record.temporary {
        try? FileManager.default.removeItem(at: record.url)
      }
    }
    try? FileManager.default.removeItem(at: temporaryRootDirectory)
  }

  func isCancelled(_ sessionRef: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return sessions[sessionRef]?.cancelled ?? true
  }

  func temporaryUrl(sessionRef: String, fileExtension: String) throws -> URL {
    guard Self.validSessionRef(sessionRef), !isCancelled(sessionRef) else {
      throw PhotoPreparationError.rendition("cancelled")
    }
    let directory = sessionDirectory(sessionRef)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent(UUID().uuidString)
      .appendingPathExtension(fileExtension)
  }

  func registerPreparedFile(
    sessionRef: String,
    variantId: String,
    url: URL,
    sizeBytes: UInt64,
    temporary: Bool,
    materializationPath: PhotoMaterializationPath,
    temporaryCreatedAtUptime: TimeInterval?
  ) throws {
    let values = try url.resourceValues(forKeys: [
      .isRegularFileKey,
      .fileSizeKey,
      .contentModificationDateKey,
    ])
    guard values.isRegularFile != false,
          let actualSize = values.fileSize,
          actualSize > 0,
          UInt64(actualSize) == sizeBytes else {
      throw PhotoPreparationError.metadata("file-size-unavailable")
    }

    lock.lock()
    defer { lock.unlock() }
    guard var session = sessions[sessionRef], !session.cancelled else {
      throw PhotoPreparationError.rendition("cancelled")
    }
    guard !variantId.isEmpty,
          variantId.count <= 64,
          session.recordsByVariant[variantId] == nil else {
      throw PhotoPreparationError.metadata("invalid-prepared-file")
    }
    if temporary {
      guard sizeBytes <= session.budgetBytes,
            session.reservedBytes <= session.budgetBytes - sizeBytes else {
        throw PhotoPreparationError.rendition("temporary-storage-limit")
      }
      session.reservedBytes += sizeBytes
    }
    let normalizedUrl = url.standardizedFileURL
    let record = PreparedRecord(
      variantId: variantId,
      url: normalizedUrl,
      sizeBytes: sizeBytes,
      modificationDate: values.contentModificationDate,
      temporary: temporary,
      materializationPath: materializationPath,
      temporaryCreatedAtUptime: temporaryCreatedAtUptime
        ?? ProcessInfo.processInfo.systemUptime
    )
    session.recordsByVariant[variantId] = record
    session.variantByUrl[normalizedUrl] = variantId
    sessions[sessionRef] = session
  }

  func release(sessionRef: String, uri: String) -> ReleasedPreparedFileMetrics? {
    let url = fileUrl(from: uri).standardizedFileURL
    lock.lock()
    guard var session = sessions[sessionRef],
          let variantId = session.variantByUrl.removeValue(forKey: url),
          let record = session.recordsByVariant.removeValue(forKey: variantId) else {
      lock.unlock()
      return nil
    }
    session.hashesByVariant.removeValue(forKey: variantId)
    if record.temporary {
      session.reservedBytes = session.reservedBytes >= record.sizeBytes
        ? session.reservedBytes - record.sizeBytes
        : 0
    }
    sessions[sessionRef] = session
    lock.unlock()
    if record.temporary { try? FileManager.default.removeItem(at: record.url) }
    return ReleasedPreparedFileMetrics(
      materializationPath: record.materializationPath,
      temporaryBytesWritten: record.temporary ? record.sizeBytes : 0,
      temporaryLifetimeMs: max(
        0,
        (ProcessInfo.processInfo.systemUptime - record.temporaryCreatedAtUptime) * 1_000
      )
    )
  }

  func snapshot(
    sessionRef: String,
    variantId: String,
    uri: String,
    expectedSizeBytes: UInt64
  ) -> PreparedFileSnapshot? {
    let requestedUrl = fileUrl(from: uri).standardizedFileURL
    lock.lock()
    defer { lock.unlock() }
    guard let session = sessions[sessionRef], !session.cancelled,
          let record = session.recordsByVariant[variantId],
          record.url == requestedUrl,
          record.sizeBytes == expectedSizeBytes else {
      return nil
    }
    return PreparedFileSnapshot(
      variantId: variantId,
      url: record.url,
      sizeBytes: record.sizeBytes,
      modificationDate: record.modificationDate
    )
  }

  func cachedHash(sessionRef: String, variantId: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return sessions[sessionRef]?.hashesByVariant[variantId]
  }

  func cacheHash(sessionRef: String, variantId: String, sha256: String) {
    lock.lock()
    guard var session = sessions[sessionRef],
          session.recordsByVariant[variantId] != nil,
          !session.cancelled else {
      lock.unlock()
      return
    }
    session.hashesByVariant[variantId] = sha256
    sessions[sessionRef] = session
    lock.unlock()
  }

  func registerOperation(
    sessionRef: String,
    id: UUID,
    completed: Bool,
    cancellation: @escaping () -> Void
  ) {
    lock.lock()
    guard var session = sessions[sessionRef] else {
      lock.unlock()
      if !completed { cancellation() }
      return
    }
    let shouldCancel = session.cancelled
    if !completed && !shouldCancel {
      session.operations[id] = cancellation
      sessions[sessionRef] = session
    }
    lock.unlock()
    if shouldCancel && !completed { cancellation() }
  }

  func completeOperation(sessionRef: String, id: UUID) {
    lock.lock()
    if var session = sessions[sessionRef] {
      session.operations.removeValue(forKey: id)
      sessions[sessionRef] = session
    }
    lock.unlock()
  }

  static func validSessionRef(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 64 && value.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || $0.value == 45 || $0.value == 95
    }
  }

  private var temporaryRootDirectory: URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("LocalMediaTransfer", isDirectory: true)
  }

  private func sessionDirectory(_ sessionRef: String) -> URL {
    temporaryRootDirectory.appendingPathComponent(sessionRef, isDirectory: true)
  }

  private func temporaryBudget() -> UInt64 {
    let available = try? FileManager.default.temporaryDirectory.resourceValues(
      forKeys: [.volumeAvailableCapacityForImportantUsageKey]
    ).volumeAvailableCapacityForImportantUsage
    guard let available, available > 0 else { return Self.fallbackTemporaryBytes }
    let capacity = UInt64(available)
    guard capacity > Self.storageReserveBytes else { return 0 }
    return min(Self.maximumTemporaryBytes, capacity - Self.storageReserveBytes)
  }

  private func fileUrl(from uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri)
  }
}
