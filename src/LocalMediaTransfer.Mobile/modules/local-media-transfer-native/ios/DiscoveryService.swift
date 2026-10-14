import Darwin
import Foundation

final class DiscoveryService {
  func discover(
    timeoutMs: Int,
    port: Int,
    environment: String
  ) throws -> [[String: Any]] {
    let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    guard fd >= 0 else { throw error("Unable to create UDP socket") }
    defer { close(fd) }
    var timeout = timeval(
      tv_sec: timeoutMs / 1000,
      tv_usec: Int32((timeoutMs % 1000) * 1000)
    )
    setsockopt(
      fd,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &timeout,
      socklen_t(MemoryLayout<timeval>.size)
    )
    let query = Data("{\"type\":\"lmt-discovery-query\",\"version\":2}".utf8)
    let targets = wifiSubnetTargets()
    guard !targets.isEmpty else { throw error("No active Wi-Fi IPv4 interface") }

    for targetAddress in targets {
      var target = sockaddr_in()
      target.sin_family = sa_family_t(AF_INET)
      target.sin_port = in_port_t(port).bigEndian
      target.sin_addr = targetAddress
      query.withUnsafeBytes { bytes in
        withUnsafePointer(to: &target) { pointer in
          pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            _ = sendto(
              fd,
              bytes.baseAddress,
              query.count,
              0,
              $0,
              socklen_t(MemoryLayout<sockaddr_in>.size)
            )
          }
        }
      }
    }

    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
    var found: [String: [String: Any]] = [:]
    while Date() < deadline {
      var source = sockaddr_in()
      var sourceLength = socklen_t(MemoryLayout<sockaddr_in>.size)
      var buffer = [UInt8](repeating: 0, count: 2048)
      let count = withUnsafeMutablePointer(to: &source) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          recvfrom(fd, &buffer, buffer.count, 0, $0, &sourceLength)
        }
      }
      if count <= 0 { break }
      guard let object = try? JSONSerialization.jsonObject(
        with: Data(buffer.prefix(count))
      ) as? [String: Any],
      object["type"] as? String == "lmt-discovery-response",
      object["version"] as? Int == 2,
      object["environment"] as? String == environment,
      let serverId = object["serverId"] as? String else {
        continue
      }
      var address = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
      var sourceAddress = source.sin_addr
      inet_ntop(AF_INET, &sourceAddress, &address, socklen_t(INET_ADDRSTRLEN))
      var result = object
      result["address"] = String(cString: address)
      found[serverId] = result
    }
    return Array(found.values)
  }

  private func wifiSubnetTargets() -> [in_addr] {
    var interfaces: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaces) == 0, let first = interfaces else { return [] }
    defer { freeifaddrs(interfaces) }
    var current: UnsafeMutablePointer<ifaddrs>? = first
    while let interface = current {
      defer { current = interface.pointee.ifa_next }
      guard let addressPointer = interface.pointee.ifa_addr,
            let maskPointer = interface.pointee.ifa_netmask,
            addressPointer.pointee.sa_family == sa_family_t(AF_INET),
            String(cString: interface.pointee.ifa_name) == "en0" else {
        continue
      }
      let address = addressPointer.withMemoryRebound(
        to: sockaddr_in.self,
        capacity: 1
      ) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
      var mask = maskPointer.withMemoryRebound(
        to: sockaddr_in.self,
        capacity: 1
      ) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
      if ~mask > 1023 { mask = 0xFFFFFF00 }
      let network = address & mask
      let broadcast = network | ~mask
      guard broadcast > network + 1 else { return [] }
      var targets: [in_addr] = []
      targets.reserveCapacity(Int(min(broadcast - network - 1, 1024)))
      for host in (network + 1)..<broadcast where host != address {
        targets.append(in_addr(s_addr: host.bigEndian))
        if targets.count == 1024 { break }
      }
      return targets
    }
    return []
  }

  private func error(_ description: String) -> NSError {
    NSError(
      domain: "LocalMediaTransfer.Discovery",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: description]
    )
  }
}
