import CoreLocation
import Foundation

// One-shot, reduced-accuracy location for an add, only when the phone says
// location is on for expenses. Never blocks an add: the caller gets nil after
// `timeout` seconds. Permission is asked only the first time the setting is on.
//
// UNVERIFIED: authored without Xcode.

final class WatchLocator: NSObject, CLLocationManagerDelegate {
  struct Fix {
    let lat: Double
    let lng: Double
    let accuracy: Double
    let capturedAt: Int64
  }

  /// Mirrors the phone's `locationEnabled` setting. Off by default.
  var enabled = false {
    didSet { if enabled { askPermissionIfNeeded() } }
  }

  private let manager = CLLocationManager()
  private var waiting: [(Fix?) -> Void] = []
  private var timeoutWork: DispatchWorkItem?

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  private var allowed: Bool {
    let s = manager.authorizationStatus
    return s == .authorizedWhenInUse || s == .authorizedAlways
  }

  private func askPermissionIfNeeded() {
    if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
  }

  /// A fix, or nil if location is off, not allowed, or none arrives within `timeout`.
  func current(timeout: TimeInterval = 3, _ done: @escaping (Fix?) -> Void) {
    guard enabled, allowed else { return done(nil) }
    // A recent cached fix is as good as a new one at this accuracy.
    if let last = manager.location, abs(last.timestamp.timeIntervalSinceNow) < 60,
      last.horizontalAccuracy >= 0
    {
      return done(Self.fix(last))
    }
    waiting.append(done)
    if waiting.count == 1 {
      manager.requestLocation()
      let work = DispatchWorkItem { [weak self] in self?.finish(nil) }
      timeoutWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: work)
    }
  }

  private func finish(_ fix: Fix?) {
    timeoutWork?.cancel()
    timeoutWork = nil
    let callbacks = waiting
    waiting = []
    callbacks.forEach { $0(fix) }
  }

  private static func fix(_ l: CLLocation) -> Fix {
    Fix(
      lat: l.coordinate.latitude, lng: l.coordinate.longitude,
      accuracy: max(0, l.horizontalAccuracy),
      capturedAt: Int64(l.timestamp.timeIntervalSince1970 * 1000))
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    finish(locations.last.map(Self.fix))
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish(nil)
  }
}
