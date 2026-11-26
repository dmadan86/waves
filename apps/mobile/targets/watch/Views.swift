import SwiftUI

// Waves watch UI — Home, Quick-add, Voice, Recent.
// Brand purple accent; glanceable rows; Digital-Crown scroll on the list.
// UNVERIFIED: authored without Xcode.

private let accent = Color(red: 0.478, green: 0.353, blue: 0.973)

struct HomeView: View {
  @EnvironmentObject var relay: WatchRelay

  var body: some View {
    NavigationStack {
      List {
        NavigationLink(destination: VoiceView()) {
          Label("Speak", systemImage: "mic.fill")
        }
        NavigationLink(destination: QuickAddView()) {
          Label("Quick add", systemImage: "plus.circle.fill")
        }
        NavigationLink(destination: RecentView()) {
          Label("Recent", systemImage: "clock.fill")
        }

        // Adds are stored on the watch first, so nothing is lost while the phone
        // is away; this just says how many are still waiting to sync.
        if relay.pending.contains(where: { !$0.delivered }) {
          Label {
            Text("Saved on watch · will sync when your phone is near.")
              .font(.caption2)
          } icon: {
            Image(systemName: "arrow.triangle.2.circlepath")
          }
          .foregroundStyle(.secondary)
        }
        // The phone got the expense but refused it (an `ack` with ok: false).
        if relay.lastAckOk == false {
          Label {
            Text("Your phone couldn't add the last expense. Open Waves there to check.")
              .font(.caption2)
          } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
          }
          .foregroundStyle(.orange)
        }
      }
      .tint(accent)
      .navigationTitle("Waves")
      .onAppear { relay.requestRecent() }
    }
  }
}

struct RecentView: View {
  @EnvironmentObject var relay: WatchRelay

  var body: some View {
    Group {
      if relay.recent.isEmpty && relay.pending.isEmpty {
        VStack(spacing: 6) {
          Image(systemName: "clock").font(.title3).foregroundStyle(.secondary)
          Text(relay.reachable ? "Nothing yet" : "Phone not connected")
            .font(.footnote).foregroundStyle(.secondary)
        }
      } else {
        List {
          // Stored on this watch: still to sync, or a voice note already sent.
          ForEach(relay.pending) { entry in
            VStack(alignment: .leading, spacing: 2) {
              HStack {
                Text(entry.title).font(.body).lineLimit(1)
                Spacer()
                Image(systemName: entry.delivered ? "checkmark.circle" : "clock.arrow.circlepath")
                  .foregroundStyle(entry.delivered ? .secondary : accent)
              }
              Text(entry.statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            }
          }
          ForEach(relay.recent) { item in
            VStack(alignment: .leading, spacing: 2) {
              HStack {
                Text(item.title).font(.body).lineLimit(1)
                Spacer()
                Text(item.amountText).font(.body).bold()
              }
              Text("\(item.subtitle) · \(item.whenText)")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
        }
      }
    }
    .navigationTitle("Recent")
    .onAppear { relay.requestRecent() }
  }
}

struct QuickAddView: View {
  @EnvironmentObject var relay: WatchRelay
  @Environment(\.dismiss) private var dismiss
  @State private var amount: Double = 0

  var body: some View {
    VStack(spacing: 10) {
      Text(String(format: "%.0f", amount))
        .font(.system(size: 44, weight: .bold))
        .focusable(true)
        .digitalCrownRotation($amount, from: 0, through: 1_000_000, by: 1, sensitivity: .medium)
      Button {
        // Whole units as dialled; the phone converts to the currency's minor units.
        relay.quickAdd(amount: Int(amount), currency: relay.currency, note: "")
        dismiss()
      } label: {
        Text("Add").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
      .disabled(amount <= 0)
    }
    .padding()
    .navigationTitle("Quick add")
  }
}

struct VoiceView: View {
  @EnvironmentObject var relay: WatchRelay
  @Environment(\.dismiss) private var dismiss
  @StateObject private var recorder = VoiceRecorder()
  @State private var startedOnce = false

  var body: some View {
    VStack(spacing: 8) {
      switch relay.voiceOutcome {
      case .idle:
        recordingBody
      case .saved:
        status(
          icon: "clock.arrow.circlepath",
          text: "Voice note · will sync",
          detail: "Saved on watch. Sent to your phone when it is near.",
          spinner: false)
      case .sent:
        status(
          icon: "checkmark.circle.fill",
          text: "Voice note · sent to phone",
          detail: "Check it in Review on your phone",
          spinner: false)
      case .failed(let text):
        status(icon: "exclamationmark.triangle.fill", text: text, detail: nil, spinner: false)
      }
    }
    .padding(.horizontal, 4)
    .navigationTitle("Speak")
    .onAppear {
      relay.resetVoiceOutcome()
      recorder.onFinished = { url, ms in relay.sendClip(url, durationMs: ms) }
      // One tap on Speak is the whole gesture: recording starts here.
      if relay.voiceOutcome == .idle && !startedOnce {
        startedOnce = true
        recorder.start()
      }
    }
    .onDisappear { recorder.cancel() }
  }

  @ViewBuilder
  private var recordingBody: some View {
    switch recorder.phase {
    case .idle:
      // A take that was cancelled: not recording.
      Button {
        recorder.start()
      } label: {
        Label("Tap to speak", systemImage: "mic.fill").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
    case .recording:
      Image(systemName: "mic.fill")
        .font(.system(size: 40))
        .foregroundStyle(accent)
        .scaleEffect(1 + 0.35 * recorder.level)
        .animation(.easeOut(duration: 0.12), value: recorder.level)
        .frame(height: 64)
      Text(String(format: "0:%02d", Int(recorder.elapsed)))
        .font(.system(.body, design: .monospaced))
        .foregroundStyle(.secondary)
      Button(role: .destructive) {
        recorder.stop()
      } label: {
        Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
    case .denied:
      Image(systemName: "mic.slash.fill").font(.title2).foregroundStyle(.orange)
      Text("Allow the microphone for Waves in the Watch app's settings.")
        .font(.caption2)
        .multilineTextAlignment(.center)
    case .failed(let text):
      Image(systemName: "waveform.slash").font(.title2).foregroundStyle(.orange)
      Text(text).font(.footnote)
      Button {
        recorder.start()
      } label: {
        Label("Try again", systemImage: "mic.fill").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
    }
  }

  private func status(icon: String, text: String, detail: String?, spinner: Bool) -> some View {
    VStack(spacing: 6) {
      if spinner {
        ProgressView()
      } else {
        Image(systemName: icon).font(.title2).foregroundStyle(accent)
      }
      Text(text).font(.footnote).multilineTextAlignment(.center)
      if let detail {
        Text(detail).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
      if !spinner {
        Button("Done") {
          relay.resetVoiceOutcome()
          dismiss()
        }
        .buttonStyle(.bordered)
      }
    }
  }
}
