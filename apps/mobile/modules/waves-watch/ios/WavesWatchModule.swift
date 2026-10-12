import ExpoModulesCore
import WatchConnectivity

// The phone end of the Apple Watch relay.
//
// A thin WatchConnectivity bridge: it forwards messages the watch sends up to
// JS (`onWatchMessage`) and sends the phone's replies back down. All product
// logic lives in JS (`src/lib/watch/bridge.tsx`); this only moves dictionaries.
//
// UNVERIFIED: written on Windows with no Xcode. Build on a Mac/EAS before trust.
public final class WavesWatchModule: Module {
  private let relay = WatchRelay()
  // A clip can be delivered at launch, before JS has subscribed (the system
  // hands queued transfers over the moment the session activates). Those wait
  // here until the first `onWatchFile` listener attaches, so none is dropped.
  private var observingFiles = false
  private var pendingFiles: [[String: Any]] = []

  public func definition() -> ModuleDefinition {
    Name("WavesWatch")

    Events("onWatchMessage", "onWatchSendFailed", "onWatchFile")

    OnCreate {
      self.relay.onMessage = { [weak self] payload in
        self?.sendEvent("onWatchMessage", ["payload": payload])
      }
      // A queued transfer reports its outcome asynchronously and long after
      // `sendToWatch` returned, so JS cannot learn of the failure from the call
      // itself — this is the only signal it gets. `t` is the message kind that
      // was lost, so the bridge can decide what to redo.
      self.relay.onSendFailed = { [weak self] kind in
        self?.sendEvent("onWatchSendFailed", ["t": kind ?? ""])
      }
      // A recorded clip the watch sent with `transferFile`. `uri` is a copy in
      // this app's caches (WatchConnectivity deletes its own when the delegate
      // returns); `metadata` is the watch's {t:"voiceClip", id, durationMs}.
      self.relay.onFile = { [weak self] uri, metadata in
        guard let self else { return }
        let payload: [String: Any] = ["uri": uri, "metadata": metadata]
        DispatchQueue.main.async {
          if self.observingFiles {
            self.sendEvent("onWatchFile", payload)
          } else {
            self.pendingFiles.append(payload)
          }
        }
      }
      self.relay.activate()
    }

    OnStartObserving("onWatchFile") {
      self.observingFiles = true
      let queued = self.pendingFiles
      self.pendingFiles = []
      for payload in queued { self.sendEvent("onWatchFile", payload) }
    }

    OnStopObserving("onWatchFile") {
      self.observingFiles = false
    }

    Function("isReachable") { () -> Bool in
      self.relay.isReachable
    }

    Function("sendToWatch") { (payload: [String: Any]) -> Void in
      self.relay.send(payload)
    }
  }
}

// Kept out of the Module subclass so the WCSessionDelegate conformance (which
// Objective-C must see) is isolated from Expo's generics.
private final class WatchRelay: NSObject, WCSessionDelegate {
  var onMessage: (([String: Any]) -> Void)?
  /** Called with the `t` of a queued payload that never reached the watch. */
  var onSendFailed: ((String?) -> Void)?
  /** Called with a cache copy of a file the watch transferred, and its metadata. */
  var onFile: ((String, [String: Any]) -> Void)?

  private var session: WCSession? {
    WCSession.isSupported() ? WCSession.default : nil
  }

  var isReachable: Bool {
    session?.isReachable ?? false
  }

  func activate() {
    guard let session else { return }
    session.delegate = self
    session.activate()
  }

  func send(_ payload: [String: Any]) {
    guard let session, session.activationState == .activated else { return }
    if session.isReachable {
      // Live path; if it fails, fall back to a queued transfer rather than
      // dropping the message.
      session.sendMessage(payload, replyHandler: nil) { _ in
        session.transferUserInfo(payload)
      }
    } else {
      // Guaranteed, FIFO delivery on the watch's next wake — unlike
      // updateApplicationContext, which keeps only the newest payload and would
      // coalesce independent recent/ack/settings messages into one.
      session.transferUserInfo(payload)
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    onMessage?(message)
  }

  // The queued counterpart of the live sendMessage path — delivered on wake.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    onMessage?(userInfo)
  }

  /**
   * A file the watch sent (`transferFile`) — a recorded voice clip.
   *
   * WatchConnectivity removes `file.fileURL` as soon as this returns, so the
   * file is copied out synchronously here and JS is handed the copy. A transfer
   * is queued by the system until the phone app next runs, so this also fires
   * for clips recorded while the phone was out of reach.
   */
  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    guard let metadata = file.metadata, metadata["t"] as? String == "voiceClip" else { return }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("watch-clips", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let ext = file.fileURL.pathExtension.isEmpty ? "m4a" : file.fileURL.pathExtension
      let copy = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
      try FileManager.default.copyItem(at: file.fileURL, to: copy)
      onFile?(copy.absoluteString, metadata)
    } catch {
      // Nothing to hand JS; the watch's own timeout reports the clip as unsent.
    }
  }

  /**
   * The outcome of a `transferUserInfo`.
   *
   * Without this method WatchConnectivity has nowhere to report a failed
   * transfer and logs that the delegate does not implement it, so every queued
   * payload that never arrived was dropped in silence. That matters most for
   * `recent`: the bridge remembers the last list it sent and skips re-sending an
   * identical one, so a lost transfer would otherwise leave the watch showing a
   * stale list until the list itself changed.
   *
   * `error` is terminal — WatchConnectivity has already retried the queued
   * transfer on its own — so this reports the loss rather than re-sending, which
   * against an unpaired or deleted watch would only fail again in a loop.
   */
  func session(
    _ session: WCSession,
    didFinish userInfoTransfer: WCSessionUserInfoTransfer,
    error: Error?
  ) {
    guard error != nil else { return }
    onSendFailed?(userInfoTransfer.userInfo["t"] as? String)
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Re-activate so a switched watch reconnects.
    session.activate()
  }
}
