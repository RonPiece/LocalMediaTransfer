import Darwin
import Foundation

/// Streams one local file through the chunked desktop protocol while retaining
/// ownership of every active URLSession task for immediate cancellation.
final class NativeUploadService {
  private static let progressEventInterval: TimeInterval = 0.175
  private let cancellationLock = NSLock()
  private var cancelled = false
  private var activeTasks: [Int: URLSessionTask] = [:]

  func begin() {
    cancellationLock.lock()
    let staleTasks = Array(activeTasks.values)
    activeTasks.removeAll()
    cancelled = false
    cancellationLock.unlock()
    staleTasks.forEach { $0.cancel() }
  }

  func cancel() {
    cancellationLock.lock()
    cancelled = true
    let tasks = Array(activeTasks.values)
    activeTasks.removeAll()
    cancellationLock.unlock()
    tasks.forEach { $0.cancel() }
  }

  func upload(
    uri: String,
    endpoint: String,
    token: String,
    fileId: String,
    transferFilename: String,
    chunkSize configuredChunkSize: Int,
    skipDuplicates: Bool,
    httpClient: PinnedHTTPClient,
    onProgress: ([String: Any]) -> Void
  ) async throws -> [String: Any] {
    guard let endpointUrl = URL(string: endpoint),
          configuredChunkSize > 0,
          !fileId.isEmpty,
          !transferFilename.isEmpty else {
      throw serviceError("Missing native upload options")
    }
    let fileUrl = fileUrl(from: uri)
    let handle = try FileHandle(forReadingFrom: fileUrl)
    defer { try? handle.close() }
    let size = try handle.seekToEnd()
    try handle.seek(toOffset: 0)
    let chunkSize = UInt64(configuredChunkSize)
    let totalChunks = Int((size + chunkSize - 1) / chunkSize)
    var sent: UInt64 = 0
    var finalBody = Data()
    var fileReadDurationMs = 0.0
    var httpRequestDurationMs = 0.0
    var interChunkGapDurationMs = 0.0
    var retryCount = 0
    var peakResidentMemoryBytes = residentMemoryBytes()
    var serverWriteDurationMs = 0.0
    var serverFinalizeDurationMs = 0.0
    var previousResponseAt: Date?
    var lastProgressEventAt: Date?

    for index in 0..<totalChunks {
      if isCancelled { throw serviceError("Upload cancelled") }
      let readStarted = Date()
      let data = try handle.read(
        upToCount: Int(min(chunkSize, size - sent))
      ) ?? Data()
      fileReadDurationMs += Date().timeIntervalSince(readStarted) * 1000
      peakResidentMemoryBytes = max(peakResidentMemoryBytes, residentMemoryBytes())
      var request = URLRequest(url: endpointUrl)
      request.httpMethod = "POST"
      request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
      request.setValue(fileId, forHTTPHeaderField: "X-File-Id")
      request.setValue(
        transferFilename.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
          ?? transferFilename,
        forHTTPHeaderField: "X-Filename"
      )
      request.setValue(String(index), forHTTPHeaderField: "X-Chunk-Index")
      request.setValue(String(totalChunks), forHTTPHeaderField: "X-Total-Chunks")
      request.setValue(String(size), forHTTPHeaderField: "X-File-Size")
      request.setValue(
        skipDuplicates ? "true" : "false",
        forHTTPHeaderField: "X-Skip-Duplicates"
      )
      if !token.isEmpty {
        request.setValue(token, forHTTPHeaderField: "X-Upload-Token")
      }

      var lastError: Error?
      for attempt in 0...2 {
        do {
          if isCancelled { throw serviceError("Upload cancelled") }
          let requestStarted = Date()
          if attempt == 0, let previousResponseAt {
            interChunkGapDurationMs +=
              requestStarted.timeIntervalSince(previousResponseAt) * 1000
          }
          let (body, response) = try await performUpload(
            session: httpClient.session(for: endpointUrl),
            request: request,
            data: data
          )
          httpRequestDurationMs += Date().timeIntervalSince(requestStarted) * 1000
          guard let http = response as? HTTPURLResponse else {
            return failedResult(
              code: "server-rejected",
              bytesSent: sent,
              statusCode: 0,
              transferFilename: transferFilename
            )
          }
          if http.statusCode == 401 || http.statusCode == 403 {
            return failedResult(
              code: "unauthorized",
              bytesSent: sent,
              statusCode: http.statusCode,
              transferFilename: transferFilename
            )
          }
          if !(200..<300).contains(http.statusCode) {
            if http.statusCode >= 500 {
              throw serviceError("Temporary desktop response failure")
            }
            return failedResult(
              code: "server-rejected",
              bytesSent: sent,
              statusCode: http.statusCode,
              transferFilename: transferFilename
            )
          }
          finalBody = body
          if let metrics =
              (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] {
            serverWriteDurationMs += metrics["serverWriteDurationMs"] as? Double ?? 0
            serverFinalizeDurationMs +=
              metrics["serverFinalizeDurationMs"] as? Double ?? 0
          }
          previousResponseAt = Date()
          peakResidentMemoryBytes = max(
            peakResidentMemoryBytes,
            residentMemoryBytes()
          )
          lastError = nil
          break
        } catch {
          lastError = error
          if isCancelled {
            throw serviceError("Upload cancelled")
          }
          if attempt < 2 {
            retryCount += 1
            try await Task.sleep(
              nanoseconds: UInt64(500_000_000 * (attempt + 1))
            )
          }
        }
      }
      if let lastError { throw lastError }
      sent += UInt64(data.count)
      let eventAt = Date()
      let isFinal = sent >= size
      let intervalElapsed = lastProgressEventAt.map {
        eventAt.timeIntervalSince($0) >= Self.progressEventInterval
      } ?? true
      if isFinal || intervalElapsed {
        onProgress([
          "fileId": fileId,
          "bytesSent": sent,
          "totalBytes": size,
        ])
        lastProgressEventAt = eventAt
      }
    }

    let decoded =
      (try? JSONSerialization.jsonObject(with: finalBody)) as? [String: Any]
    var output: [String: Any] = [
      "status": "success",
      "bytesSent": sent,
      "skipped": decoded?["skipped"] as? Bool ?? false,
      "chunkCount": totalChunks,
      "chunkSizeBytes": chunkSize,
      "fileReadDurationMs": fileReadDurationMs,
      "httpRequestDurationMs": httpRequestDurationMs,
      "interChunkGapDurationMs": interChunkGapDurationMs,
      "retryCount": retryCount,
      "peakResidentMemoryBytes": peakResidentMemoryBytes,
      "serverWriteDurationMs": serverWriteDurationMs,
      "serverFinalizeDurationMs": serverFinalizeDurationMs,
      "transferFilename": transferFilename,
    ]
    if let savedFilename = decoded?["filename"] as? String,
       !savedFilename.isEmpty {
      output["savedFilename"] = savedFilename
    }
    return output
  }

  private func performUpload(
    session: URLSession,
    request: URLRequest,
    data: Data
  ) async throws -> (Data, URLResponse) {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<(Data, URLResponse), Error>) in
      var task: URLSessionUploadTask?
      task = session.uploadTask(with: request, from: data) {
        [weak self] body, response, error in
        if let task {
          self?.unregister(task)
        }
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let response else {
          continuation.resume(throwing: self?.serviceError(
            "Server returned no response"
          ) ?? NSError(domain: "LocalMediaTransfer.Upload", code: 1))
          return
        }
        continuation.resume(returning: (body ?? Data(), response))
      }
      guard let task, register(task) else {
        continuation.resume(throwing: serviceError("Upload cancelled"))
        return
      }
      task.resume()
    }
  }

  private func register(_ task: URLSessionTask) -> Bool {
    cancellationLock.lock()
    defer { cancellationLock.unlock() }
    guard !cancelled else { return false }
    activeTasks[task.taskIdentifier] = task
    return true
  }

  private func unregister(_ task: URLSessionTask) {
    cancellationLock.lock()
    activeTasks.removeValue(forKey: task.taskIdentifier)
    cancellationLock.unlock()
  }

  private func failedResult(
    code: String,
    bytesSent: UInt64,
    statusCode: Int,
    transferFilename: String
  ) -> [String: Any] {
    [
      "status": "failed",
      "errorCode": code,
      "httpStatus": statusCode,
      "bytesSent": bytesSent,
      "transferFilename": transferFilename,
    ]
  }

  private var isCancelled: Bool {
    cancellationLock.lock()
    defer { cancellationLock.unlock() }
    return cancelled
  }

  private func residentMemoryBytes() -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(
      MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size
    )
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(
          mach_task_self_,
          task_flavor_t(MACH_TASK_BASIC_INFO),
          $0,
          &count
        )
      }
    }
    return result == KERN_SUCCESS ? UInt64(info.resident_size) : 0
  }

  private func fileUrl(from uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri)
  }

  private func serviceError(_ description: String) -> NSError {
    NSError(
      domain: "LocalMediaTransfer.Upload",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: description]
    )
  }
}
