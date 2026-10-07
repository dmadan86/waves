import AVFoundation
import SwiftUI

// One-tap voice capture: opening the Speak screen starts recording at once —
// no keyboard, no second tap on a dictation mic.
//
// Mono 16 kHz AAC in an .m4a, at most 30 s. Metering ends the take on its own
// after ~2 s of quiet once something has been said, so the usual use is: tap
// Speak, say it, stop talking.

final class VoiceRecorder: NSObject, ObservableObject {
  enum Phase: Equatable {
    case idle
    case recording
    /// Microphone access refused.
    case denied
    /// Nothing usable was recorded; the string is what to tell the person.
    case failed(String)
  }

  @Published var phase: Phase = .idle
  @Published var elapsed: TimeInterval = 0
  /// 0...1, the current loudness — drives the mic's pulse.
  @Published var level: Double = 0

  /// Called once with the finished clip and its length in milliseconds.
  var onFinished: ((URL, Int) -> Void)?

  /// No take runs longer than this — the same cap as the phone's voice screen.
  static let maxSeconds: TimeInterval = 20
  /// Quiet for this long after speech ends the take.
  private static let silenceSeconds: TimeInterval = 2
  /// With nothing said at all, give up after this long.
  private static let noSpeechSeconds: TimeInterval = 5
  /// Average power (dB) above which the mic is hearing speech / below which it is quiet.
  private static let speechDb: Float = -38
  private static let quietDb: Float = -46

  private var recorder: AVAudioRecorder?
  private var timer: Timer?
  private var heardSpeech = false
  private var quietSince: TimeInterval?
  private var fileURL: URL?
  /// Bumped by every start, stop and cancel. The permission answer arrives later,
  /// on another queue; it may only begin recording if nothing has happened since
  /// it was asked — otherwise leaving the screen while the prompt is up would
  /// still switch the mic on afterwards.
  private var session = 0
  private var awaitingPermission = false

  func start() {
    guard phase != .recording, !awaitingPermission else { return }
    session += 1
    let mine = session
    awaitingPermission = true
    AVAudioApplication.requestRecordPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        self.awaitingPermission = false
        // Cancelled, stopped or restarted while the prompt was up: do nothing.
        guard self.session == mine else { return }
        if granted { self.beginRecording() } else { self.phase = .denied }
      }
    }
  }

  private func beginRecording() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .default)
      try session.setActive(true)

      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("clip-\(UUID().uuidString).m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 24_000,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
      ]
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.isMeteringEnabled = true
      guard recorder.record(forDuration: Self.maxSeconds) else {
        phase = .failed("Couldn't start the mic")
        return
      }
      self.recorder = recorder
      fileURL = url
      heardSpeech = false
      quietSince = nil
      elapsed = 0
      level = 0
      phase = .recording

      let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    } catch {
      phase = .failed("Couldn't start the mic")
    }
  }

  private func tick() {
    guard let recorder, recorder.isRecording else {
      // `record(forDuration:)` stopped itself at the cap.
      if phase == .recording { finish(userStopped: false) }
      return
    }
    recorder.updateMeters()
    let db = recorder.averagePower(forChannel: 0)
    elapsed = recorder.currentTime
    level = Double(max(0, min(1, (db + 55) / 45)))

    if db > Self.speechDb {
      heardSpeech = true
      quietSince = nil
    } else if db < Self.quietDb, quietSince == nil {
      quietSince = elapsed
    } else if db >= Self.quietDb {
      quietSince = nil
    }

    if heardSpeech, let quietSince, elapsed - quietSince >= Self.silenceSeconds {
      finish(userStopped: false)
    } else if !heardSpeech, elapsed >= Self.noSpeechSeconds {
      finish(userStopped: false)
    }
  }

  /// The Stop button.
  func stop() {
    session += 1
    finish(userStopped: true)
  }

  /// Leaving the screen: end the take and throw it away.
  func cancel() {
    session += 1
    teardown()
    if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
    fileURL = nil
    if phase == .recording { phase = .idle }
  }

  private func finish(userStopped: Bool) {
    guard phase == .recording else { return }
    let seconds = recorder?.currentTime ?? elapsed
    let url = fileURL
    teardown()
    fileURL = nil
    guard let url else { phase = .idle; return }
    // Auto-stopped with nothing said, or an accidental tap-and-stop.
    if (!userStopped && !heardSpeech) || seconds < 0.5 {
      try? FileManager.default.removeItem(at: url)
      phase = .failed("Didn't catch that")
      return
    }
    phase = .idle
    onFinished?(url, max(1, Int((seconds * 1000).rounded())))
  }

  private func teardown() {
    timer?.invalidate()
    timer = nil
    recorder?.stop()
    recorder = nil
    level = 0
    try? AVAudioSession.sharedInstance().setActive(false)
  }
}
