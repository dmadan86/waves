import SwiftUI
import WatchConnectivity

// Waves — Apple Watch companion.
//
// Sends intents to the paired phone over WatchConnectivity and shows what the
// phone relays back. The wire shapes match @waves/core's relay contract:
//   watch → phone: {t:"quickAdd"|"requestRecent", ...} (+ id, madeAt, tzOffsetMin, location?)
//                  and a recorded clip as a file (transferFile) with metadata
//                  {t:"voiceClip", id, durationMs}
//   phone → watch: {t:"recent", items:[...]} | {t:"settings", recentCount} | {t:"ack", ok}
//                  | {t:"voiceResult", id, status:"added"|"review"|"error", text, error?}
//
// UNVERIFIED: authored on Windows without Xcode. Build on a Mac/EAS before trust.

// MARK: - Relay

struct RecentItem: Identifiable {
  let id = UUID()
  let title: String
  let subtitle: String
  let amountText: String
  let whenText: String
}

/// Where the latest voice note is, shown on the Speak screen.
enum VoiceOutcome: Equatable {
  case idle
  /// Recorded and stored on the watch; goes to the phone when it can.
  case saved
  /// The phone has it (it lands in Review there).
  case sent
  case failed(String)
}

final class WatchRelay: NSObject, ObservableObject, WCSessionDelegate {
  @Published var recent: [RecentItem] = []
  @Published var recentCount: Int = 5
  @Published var currency: String = "USD"
  @Published var lastAckOk: Bool? = nil
  @Published var reachable: Bool = false
  /// A send WatchConnectivity reported as failed. The add itself is safe in
  /// `pending` and is retried, so this is only a hint.
  @Published var lastSendFailed: Bool = false
  /// Adds stored on this watch, newest first: pending, plus recently sent voice notes.
  @Published var pending: [PendingAdd] = PendingStore.load()
  @Published var voiceOutcome: VoiceOutcome = .idle
  private var currentClipId: String?
  /// Fixes for new adds; on only while the phone's `locationEnabled` setting is.
  let locator = WatchLocator()

  private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

  override init() {
    super.init()
    guard let session else { return }
    session.delegate = self
    session.activate()
  }

  // Matches @waves/core's WATCH_RELAY_VERSION so a version-skewed phone rejects us.
  private let relayVersion = 1

  func requestRecent() {
    send(["t": "requestRecent", "count": recentCount])
  }

  // MARK: Offline-first adds

  private func persist() { PendingStore.save(pending) }

  private func newEntry(_ kind: PendingAdd.Kind) -> PendingAdd {
    let now = Date()
    return PendingAdd(
      id: UUID().uuidString, kind: kind, amount: 0, currency: currency, note: "",
      madeAt: Int64(now.timeIntervalSince1970 * 1000),
      tzOffsetMin: TimeZone.current.secondsFromGMT(for: now) / 60,
      lat: nil, lng: nil, accuracy: nil, capturedAt: nil, clipFile: nil, durationMs: 0,
      queued: false, delivered: false, awaitingLocation: locator.enabled)
  }

  /// Store the add now (shown at once), then wait at most ~3 s for a fix before sending.
  private func store(_ entry: PendingAdd) {
    pending.insert(entry, at: 0)
    persist()
    guard entry.awaitingLocation else { return flush() }
    locator.current { [weak self] fix in
      guard let self, let i = self.pending.firstIndex(where: { $0.id == entry.id }) else { return }
      if let fix {
        self.pending[i].lat = fix.lat
        self.pending[i].lng = fix.lng
        self.pending[i].accuracy = fix.accuracy
        self.pending[i].capturedAt = fix.capturedAt
      }
      self.pending[i].awaitingLocation = false
      self.persist()
      self.flush()
    }
  }

  /// `amount` is what was dialled, in whole units. No minor-unit scaling here: the
  /// watch knows nothing of a currency's decimals (JPY has none, KWD three), so the
  /// phone scales it for the currency it books in.
  func quickAdd(amount: Int, currency: String, note: String) {
    lastAckOk = nil
    var e = newEntry(.quick)
    e.amount = amount
    e.currency = currency
    e.note = note
    store(e)
  }

  /// A finished recording: keep the audio on the watch, then send it when the
  /// phone can take it. The phone transcribes it and files a draft in Review.
  func sendClip(_ url: URL, durationMs: Int) {
    var e = newEntry(.voice)
    let name = "\(e.id).m4a"
    do {
      try FileManager.default.moveItem(
        at: url, to: PendingStore.clipDirectory.appendingPathComponent(name))
    } catch {
      voiceOutcome = .failed("Couldn't save the recording")
      try? FileManager.default.removeItem(at: url)
      return
    }
    e.clipFile = name
    e.durationMs = durationMs
    currentClipId = e.id
    voiceOutcome = .saved
    store(e)
  }

  /// Send everything not yet delivered. Safe to call any time and as often as
  /// wanted: the phone dedupes on the add's id, and nothing is re-queued with
  /// the OS while a queued copy is still outstanding.
  func flush() {
    guard let session, session.activationState == .activated else { return }
    var changed = false
    for i in pending.indices.reversed() where !pending[i].delivered && !pending[i].awaitingLocation {
      let e = pending[i]
      var wire = e.wire
      wire["version"] = relayVersion
      if e.kind == .quick {
        if session.isReachable {
          session.sendMessage(wire, replyHandler: nil) { _ in }
        }
        if !e.queued {
          session.transferUserInfo(wire)
          pending[i].queued = true
          changed = true
        }
      } else if !e.queued, let url = PendingStore.clipURL(e),
        FileManager.default.fileExists(atPath: url.path)
      {
        session.transferFile(url, metadata: wire)
        pending[i].queued = true
        changed = true
        // transferFile alone waits until Waves next runs on the phone. A live message
        // wakes the iOS app in the background, which then takes the queued file now.
        if session.isReachable {
          session.sendMessage(["t": "voiceClip", "id": e.id, "version": relayVersion], replyHandler: nil)
        }
      }
    }
    if changed { persist() }
  }

  func resetVoiceOutcome() {
    // The note itself lives in `pending`; this only clears the Speak screen.
    voiceOutcome = .idle
  }

  private func markDelivered(_ id: String) {
    guard let i = pending.firstIndex(where: { $0.id == id }) else { return }
    if pending[i].kind == .voice {
      pending[i].delivered = true
      PendingStore.deleteClip(pending[i])
      if currentClipId == id, voiceOutcome == .saved { voiceOutcome = .sent }
    } else {
      pending.remove(at: i)
    }
    persist()
  }

  private static func voiceErrorText(_ code: String?, _ text: String) -> String {
    switch code {
    case "clarify": return text.isEmpty ? "Try again with an amount" : text
    case "no-amount": return "No amount heard"
    case "nothing-heard": return "Didn't catch that"
    case "payer": return "Open Waves to add what someone else paid"
    default: return "Couldn't add that. Try again."
    }
  }

  /// Hand a message to WatchConnectivity for delivery. Returns whether it was
  /// accepted: `false` means there was no activated session to take it.
  /// Only used for `requestRecent`; adds go through `pending` and `flush`.
  @discardableResult
  private func send(_ message: [String: Any]) -> Bool {
    guard let session, session.activationState == .activated else { return false }
    var payload = message
    payload["version"] = relayVersion
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { _ in
        session.transferUserInfo(payload)
      }
    } else {
      session.transferUserInfo(payload)
    }
    return true
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      if activationState == .activated {
        self.requestRecent()
        self.flush()
      }
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    handle(applicationContext)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handle(userInfo)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      // The phone is back: send whatever was stored while it was away.
      if session.isReachable { self.flush() }
    }
  }

  /// A queued `transferUserInfo` finished. A failure only clears the `queued` flag
  /// so the next `flush` queues it again; the add itself is never dropped.
  func session(
    _ session: WCSession,
    didFinish userInfoTransfer: WCSessionUserInfoTransfer,
    error: Error?
  ) {
    guard let id = userInfoTransfer.userInfo["id"] as? String else { return }
    DispatchQueue.main.async {
      if error != nil, let i = self.pending.firstIndex(where: { $0.id == id }) {
        self.pending[i].queued = false
        self.persist()
      }
      self.lastSendFailed = error != nil
    }
  }

  /// A clip's file transfer finished. Success means the audio reached the phone
  /// (it then transcribes it into a Review draft); a failure is retried by `flush`.
  func session(
    _ session: WCSession,
    didFinish fileTransfer: WCSessionFileTransfer,
    error: Error?
  ) {
    guard let id = fileTransfer.file.metadata?["id"] as? String else { return }
    DispatchQueue.main.async {
      if error == nil {
        self.markDelivered(id)
      } else if let i = self.pending.firstIndex(where: { $0.id == id }) {
        self.pending[i].queued = false
        self.persist()
      }
    }
  }

  private func handle(_ message: [String: Any]) {
    guard let t = message["t"] as? String else { return }
    DispatchQueue.main.async {
      switch t {
      case "recent":
        let raw = message["items"] as? [[String: Any]] ?? []
        self.recent = raw.map {
          RecentItem(
            title: $0["title"] as? String ?? "",
            subtitle: $0["subtitle"] as? String ?? "",
            amountText: $0["amountText"] as? String ?? "",
            whenText: $0["whenText"] as? String ?? ""
          )
        }
      case "settings":
        if let n = message["recentCount"] as? Int { self.recentCount = n }
        if let c = message["currency"] as? String, !c.isEmpty { self.currency = c }
        // Asks for the watch's own location permission only once this is on.
        self.locator.enabled = message["locationEnabled"] as? Bool ?? false
      case "voiceResult":
        // The phone has taken the clip, whatever it made of it.
        if let id = message["id"] as? String { self.markDelivered(id) }
      case "ack":
        let ok = message["ok"] as? Bool ?? false
        self.lastAckOk = ok
        // An ack names the add it answers; an older phone's does not, and then
        // the oldest queued quick-add is the one it means.
        let id = message["id"] as? String
          ?? self.pending.last(where: { $0.kind == .quick && $0.queued })?.id
        if let id { self.markDelivered(id) }
      default:
        break
      }
    }
  }
}

// MARK: - App

@main
struct WavesWatchApp: App {
  @StateObject private var relay = WatchRelay()

  var body: some Scene {
    WindowGroup {
      HomeView().environmentObject(relay)
    }
  }
}
