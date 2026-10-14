import Foundation

final class ThermalMonitor {
  private var observer: NSObjectProtocol?

  var currentState: String {
    stateName(ProcessInfo.processInfo.thermalState)
  }

  func start(_ onChange: @escaping (String) -> Void) {
    guard observer == nil else { return }
    let processInfo = ProcessInfo.processInfo
    _ = processInfo.thermalState
    observer = NotificationCenter.default.addObserver(
      forName: ProcessInfo.thermalStateDidChangeNotification,
      object: processInfo,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      onChange(self.stateName(processInfo.thermalState))
    }
  }

  func stop() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
  }

  private func stateName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }
}
