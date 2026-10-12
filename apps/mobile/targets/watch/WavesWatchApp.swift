import SwiftUI
import WatchConnectivity

// Waves — Apple Watch companion.
//
// Sends intents to the paired phone over WatchConnectivity and shows what the
// phone relays back. The wire shapes match @waves/core's relay contract:
//   watch → phone: {t:"quickAdd"|"voiceAdd"|"requestRecent", ...}
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

/// Where a recorded clip is on its way to becoming an expense.
enum VoiceOutcome: Equatable {
  case idle
  case sending
  /// Handed to WatchConnectivity but no answer yet — the phone is out of reach.
  case queued
  case added(String)
  case review
  case failed(String)
}

final class WatchRelay: NSObject, ObservableObject, WCSessionDelegate {
  @Published var recent: [RecentItem] = []
  @Published var recentCount: Int = 5
  @Published var currency: String = "USD"
  @Published var lastAckOk: Bool? = nil
  @Published var reachable: Bool = false
  /// An expense this watch sent that WatchConnectivity could not deliver.
  @Published var lastSendFailed: Bool = false
  /// The latest voice clip's journey, shown on the Speak screen.
  @Published var voiceOutcome: VoiceOutcome = .idle
  private var currentClipId: String?
  private var queuedTimer: Timer?

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

  func quickAdd(amountMinor: Int, currency: String, note: String) {
    // Clear the warning only if the payload was actually accepted for delivery.
    // Clearing up front and then hitting the guard in `send` — session not yet
    // activated right after launch — dropped the expense and left no warning,
    // the silent loss this whole change exists to stop.
    lastSendFailed = !send([
      "t": "quickAdd",
      // A stable id per intent so a transport retry of the same tap is
      // idempotent on the phone rather than creating a duplicate expense.
      "id": UUID().uuidString,
      "amountMinor": String(amountMinor),
      "currency": currency,
      "note": note,
    ])
  }

  func voiceAdd(_ transcript: String) {
    lastSendFailed = !send(["t": "voiceAdd", "id": UUID().uuidString, "transcript": transcript])
  }

  /// Send a recorded clip to the phone with `transferFile`, which is queued and
  /// survives the phone being out of reach. The outcome comes back as a
  /// `voiceResult` message — immediately when the phone is reachable, otherwise
  /// whenever it next runs Waves.
  func sendClip(_ url: URL, durationMs: Int) {
    guard let session, session.activationState == .activated else {
      voiceOutcome = .failed("Phone not connected")
      try? FileManager.default.removeItem(at: url)
      return
    }
    let id = UUID().uuidString
    currentClipId = id
    voiceOutcome = .sending
    session.transferFile(
      url,
      metadata: ["t": "voiceClip", "id": id, "durationMs": durationMs, "version": relayVersion]
    )
    // Not reachable: say so rather than spin on "Sending…" for minutes. The
    // transfer stays queued and the answer still lands when it arrives.
    queuedTimer?.invalidate()
    queuedTimer = Timer.scheduledTimer(withTimeInterval: 12, repeats: false) { [weak self] _ in
      guard let self, self.currentClipId == id, self.voiceOutcome == .sending else { return }
      self.voiceOutcome = .queued
    }
  }

  func resetVoiceOutcome() {
    if voiceOutcome != .sending && voiceOutcome != .queued { voiceOutcome = .idle }
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
  /// accepted: `false` means there was no activated session to take it, so the
  /// caller (an expense send) must surface that rather than assume it left.
  /// `requestRecent` ignores the result — a missed recent-list refresh is not a
  /// lost expense and must not raise the expense-drop warning.
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
      if activationState == .activated { self.requestRecent() }
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
    DispatchQueue.main.async { self.reachable = session.isReachable }
  }

  /**
   * The outcome of a `transferUserInfo` — the path every intent takes whenever
   * the phone is not reachable, which on a wrist is most of the time.
   *
   * Without this method WatchConnectivity has nowhere to report a failed
   * transfer, so an expense spoken or dialled here could disappear between the
   * watch and the phone with nothing shown: the view dismisses on tap and the
   * only other signal, `ack`, comes from a phone that never got the message.
   *
   * Only the intents that carry an expense raise the warning. A lost
   * `requestRecent` costs nothing — the list simply stays as it was, which the
   * Recent screen already shows honestly.
   */
  func session(
    _ session: WCSession,
    didFinish userInfoTransfer: WCSessionUserInfoTransfer,
    error: Error?
  ) {
    let kind = userInfoTransfer.userInfo["t"] as? String
    guard kind == "quickAdd" || kind == "voiceAdd" else { return }
    let failed = error != nil
    DispatchQueue.main.async { self.lastSendFailed = failed }
  }

  /// A clip's file transfer finished. Success only means it reached the phone;
  /// the outcome is the `voiceResult`. A failure is terminal.
  func session(
    _ session: WCSession,
    didFinish fileTransfer: WCSessionFileTransfer,
    error: Error?
  ) {
    try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
    guard error != nil else { return }
    DispatchQueue.main.async {
      self.queuedTimer?.invalidate()
      self.lastSendFailed = true
      if self.voiceOutcome == .sending || self.voiceOutcome == .queued {
        self.voiceOutcome = .failed("Couldn't reach your phone")
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
      case "voiceResult":
        // Ignore an answer for a clip that is not the current one.
        guard (message["id"] as? String) == self.currentClipId else { break }
        self.queuedTimer?.invalidate()
        let text = message["text"] as? String ?? ""
        switch message["status"] as? String {
        case "added": self.voiceOutcome = .added(text)
        case "review": self.voiceOutcome = .review
        default:
          self.voiceOutcome = .failed(Self.voiceErrorText(message["error"] as? String, text))
        }
      case "ack":
        self.lastAckOk = message["ok"] as? Bool ?? false
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
