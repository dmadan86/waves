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

        // The one place a dropped intent can be seen. Quick-add and Speak both
        // dismiss the moment they send, and the phone's `ack` never arrives when
        // the message itself did not, so without this row an expense entered
        // here could vanish with nothing to show for it.
        if relay.lastSendFailed {
          Label {
            Text("Last expense didn't reach your phone. Open Waves there and try again.")
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
      if relay.recent.isEmpty {
        VStack(spacing: 6) {
          Image(systemName: "clock").font(.title3).foregroundStyle(.secondary)
          Text("Nothing yet").font(.footnote).foregroundStyle(.secondary)
        }
      } else {
        List(relay.recent) { item in
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
        // The crown value is a major-unit amount; convert to minor (×100) for
        // the two-decimal currencies the phone defaults to. The phone re-derives
        // the real currency; this sends its default.
        relay.quickAdd(amountMinor: Int(amount * 100), currency: relay.currency, note: "")
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
      case .sending:
        status(icon: "paperplane.fill", text: "Sending…", detail: nil, spinner: true)
      case .queued:
        status(
          icon: "iphone.radiowaves.left.and.right",
          text: "Queued",
          detail: "Will add when your phone is near",
          spinner: false)
      case .added(let text):
        status(icon: "checkmark.circle.fill", text: "Added \(text)", detail: nil, spinner: false)
      case .review:
        status(icon: "tray.and.arrow.down.fill", text: "Saved for review", detail: "Check it on your phone", spinner: false)
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
      // Back from "Type instead" (or a take that was cancelled): not recording.
      Button {
        recorder.start()
      } label: {
        Label("Tap to speak", systemImage: "mic.fill").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(accent)
      typeInstead
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
      typeInstead
    case .denied:
      Image(systemName: "mic.slash.fill").font(.title2).foregroundStyle(.orange)
      Text("Allow the microphone for Waves in the Watch app's settings, or type instead.")
        .font(.caption2)
        .multilineTextAlignment(.center)
      typeInstead
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
      typeInstead
    }
  }

  private var typeInstead: some View {
    NavigationLink(destination: TypeInsteadView(onSent: { dismiss() })) {
      Text("Type instead").font(.caption2)
    }
    .buttonStyle(.plain)
    .foregroundStyle(.secondary)
    .simultaneousGesture(TapGesture().onEnded { recorder.cancel() })
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

// The keyboard path, kept for when speaking is not an option (noisy room,
// microphone refused). TextFieldLink opens the system input sheet.
struct TypeInsteadView: View {
  @EnvironmentObject var relay: WatchRelay
  /// Closes the Speak screen this was opened from, so a send lands back on Home.
  var onSent: () -> Void
  @State private var text: String = ""

  private var transcript: String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        // A plain TextField reaches dictation in two taps — open the field, then
        // pick the mic out of the input menu — which is a strange way to enter a
        // screen called "Speak". TextFieldLink presents that same system input
        // controller straight from this button, so the screen opens speaking.
        // Whatever comes back (dictated, scribbled, or typed on a Mac keyboard in
        // the Simulator, which has no dictation) lands in `text` to be read back
        // before it is sent, since a misheard amount is worth catching here
        // rather than on the phone.
        TextFieldLink(prompt: Text("Say what you spent")) {
          Label(transcript.isEmpty ? "Speak" : "Say again", systemImage: "mic.fill")
            .frame(maxWidth: .infinity)
        } onSubmit: { spoken in
          text = spoken
        }
        .buttonStyle(.borderedProminent)
        .tint(accent)

        if transcript.isEmpty {
          Text("e.g. add 500 to Goa")
            .font(.caption2)
            .foregroundStyle(.secondary)
        } else {
          Text(transcript)
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button {
          relay.voiceAdd(transcript)
          onSent()
        } label: {
          Label("Send", systemImage: "paperplane.fill").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .disabled(transcript.isEmpty)
      }
      .padding(.horizontal, 4)
    }
    .navigationTitle("Type")
  }
}
