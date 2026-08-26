import CryptoKit
import Foundation
import Security

private final class PinnedSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
  private let expectedFingerprint: [UInt8]
  private let expectedHost: String
  private let expectedPort: Int
  private let lock = NSLock()
  private var certificateVerified = false
  private var tlsVersion: String?

  init?(fingerprint: String, expectedUrl: URL) {
    let normalized = fingerprint.lowercased().filter { $0.isHexDigit }
    guard normalized.count == 64,
          expectedUrl.scheme?.lowercased() == "https",
          let host = expectedUrl.host?.lowercased(),
          !host.isEmpty else {
      return nil
    }
    var bytes: [UInt8] = []
    var index = normalized.startIndex
    while index < normalized.endIndex {
      let next = normalized.index(index, offsetBy: 2)
      guard let byte = UInt8(normalized[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    expectedFingerprint = bytes
    expectedHost = host
    expectedPort = expectedUrl.port ?? 443
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (
      URLSession.AuthChallengeDisposition,
      URLCredential?
    ) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod ==
            NSURLAuthenticationMethodServerTrust,
          challenge.protectionSpace.host.lowercased() == expectedHost,
          challenge.protectionSpace.port == expectedPort,
          let trust = challenge.protectionSpace.serverTrust,
          let certificate = SecTrustGetCertificateAtIndex(trust, 0) else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    let actual = Array(SHA256.hash(data: SecCertificateCopyData(certificate) as Data))
    guard constantTimeEqual(actual, expectedFingerprint) else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
    SecTrustSetAnchorCertificatesOnly(trust, true)
    SecTrustSetPolicies(trust, SecPolicyCreateBasicX509())
    var error: CFError?
    guard SecTrustEvaluateWithError(trust, &error) else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    lock.lock()
    certificateVerified = true
    lock.unlock()
    completionHandler(.useCredential, URLCredential(trust: trust))
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let target = request.url,
          target.scheme?.lowercased() == "https",
          target.host?.lowercased() == expectedHost,
          (target.port ?? 443) == expectedPort else {
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didFinishCollecting metrics: URLSessionTaskMetrics
  ) {
    guard let raw =
      metrics.transactionMetrics.last?.negotiatedTLSProtocolVersion?.rawValue else {
      return
    }
    let value = raw == 0x0304
      ? "TLS 1.3"
      : raw == 0x0303
        ? "TLS 1.2"
        : String(format: "TLS 0x%04x", raw)
    lock.lock()
    tlsVersion = value
    lock.unlock()
  }

  func state() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    var output: [String: Any] = ["certificateVerified": certificateVerified]
    if let tlsVersion { output["tlsVersion"] = tlsVersion }
    return output
  }

  private func constantTimeEqual(_ lhs: [UInt8], _ rhs: [UInt8]) -> Bool {
    guard lhs.count == rhs.count else { return false }
    var difference: UInt8 = 0
    for index in lhs.indices { difference |= lhs[index] ^ rhs[index] }
    return difference == 0
  }
}

/// Owns authenticated HTTP sessions whose leaf certificate is pinned to one
/// configured HTTPS origin. Cross-origin redirects are rejected.
final class PinnedHTTPClient {
  private let lock = NSLock()
  private var secureSession: URLSession?
  private var secureDelegate: PinnedSessionDelegate?
  private var secureBaseUrl: String?

  func configure(baseUrl: String, fingerprint: String) throws {
    guard let parsedBaseUrl = URL(string: baseUrl),
          parsedBaseUrl.scheme?.lowercased() == "https",
          parsedBaseUrl.host != nil,
          let delegate = PinnedSessionDelegate(
            fingerprint: fingerprint,
            expectedUrl: parsedBaseUrl
          ) else {
      throw serviceError("A valid HTTPS URL and SHA-256 fingerprint are required")
    }
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 60 * 60
    configuration.httpShouldUsePipelining = true
    let session = URLSession(
      configuration: configuration,
      delegate: delegate,
      delegateQueue: nil
    )
    lock.lock()
    secureSession?.invalidateAndCancel()
    secureSession = session
    secureDelegate = delegate
    secureBaseUrl = origin(for: parsedBaseUrl)
    lock.unlock()
  }

  func clear() {
    lock.lock()
    secureSession?.invalidateAndCancel()
    secureSession = nil
    secureDelegate = nil
    secureBaseUrl = nil
    lock.unlock()
  }

  func securityState() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return secureDelegate?.state() ?? ["certificateVerified": false]
  }

  func session(for url: URL) throws -> URLSession {
    guard url.scheme?.lowercased() == "https" else { return URLSession.shared }
    lock.lock()
    defer { lock.unlock() }
    guard let session = secureSession,
          let baseUrl = secureBaseUrl,
          origin(for: url) == baseUrl else {
      throw serviceError("HTTPS server is not configured with a trusted fingerprint")
    }
    return session
  }

  private func origin(for url: URL) -> String {
    let scheme = url.scheme?.lowercased() ?? ""
    let host = url.host?.lowercased() ?? ""
    let port = url.port ?? (scheme == "https" ? 443 : 80)
    return "\(scheme)://\(host):\(port)"
  }

  func performRequest(
    url urlText: String,
    method: String,
    headers: [String: String],
    body requestBody: String?
  ) async throws -> [String: Any] {
    guard let url = URL(string: urlText) else {
      throw serviceError("Invalid request URL")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    for (name, value) in headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    if let requestBody {
      request.httpBody = Data(requestBody.utf8)
    }
    let (body, response) = try await session(for: url).data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw serviceError("Server returned a non-HTTP response")
    }
    lock.lock()
    let delegate = secureDelegate
    lock.unlock()
    let securityState = delegate?.state()
    var output: [String: Any] = [
      "status": http.statusCode,
      "body": String(data: body, encoding: .utf8) ?? "",
      "headers": http.allHeaderFields.reduce(into: [String: String]()) {
        result, item in
        result[String(describing: item.key)] = String(describing: item.value)
      },
      "certificateVerified":
        url.scheme?.lowercased() == "https"
          ? securityState?["certificateVerified"] as? Bool ?? false
          : false,
    ]
    if let version = securityState?["tlsVersion"] as? String {
      output["tlsVersion"] = version
    }
    return output
  }

  private func serviceError(_ description: String) -> NSError {
    NSError(
      domain: "LocalMediaTransfer.HTTP",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: description]
    )
  }
}
