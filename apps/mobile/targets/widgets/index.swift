// Waves home-screen widgets (iOS).
//
// Three small launcher widgets in one extension. Each shows an icon + label and,
// on tap, opens the app at a deep link the app already resolves through
// +native-intent.ts — so there is no timeline, no shared data, no App Group.
// Kept deliberately static: the entry never changes, the timeline never
// reloads. The Android equivalent is emitted by plugins/withWavesWidgets.js.

import WidgetKit
import SwiftUI

// A single, unchanging entry — these widgets display nothing dynamic.
struct LauncherEntry: TimelineEntry {
    let date: Date
}

struct LauncherProvider: TimelineProvider {
    func placeholder(in context: Context) -> LauncherEntry { LauncherEntry(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (LauncherEntry) -> Void) {
        completion(LauncherEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LauncherEntry>) -> Void) {
        // Never reloads: a launcher has nothing to refresh.
        completion(Timeline(entries: [LauncherEntry(date: Date())], policy: .never))
    }
}

// Brand purple. A literal rather than Color("$accent"): apple-targets' $-prefixed
// colors are Info.plist keys, not asset names SwiftUI's Color(_:) can resolve.
private let wavesAccent = Color(red: 0.478, green: 0.353, blue: 0.973)

private extension View {
    // containerBackground is required on iOS 17+ for the widget to render on the
    // Home Screen; older systems fall back to a plain background.
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { color }
        } else {
            background(color)
        }
    }
}

struct LauncherView: View {
    let systemImage: String
    let title: String
    let url: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.white)
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetBackground(wavesAccent)
        .widgetURL(URL(string: url))
    }
}

// Deep links match plugins/withWavesWidgets.js and the app's shortcut routes.
struct QuickExpenseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesQuickExpense", provider: LauncherProvider()) { _ in
            LauncherView(systemImage: "plus.circle.fill", title: "Add expense", url: "waves:///capture")
        }
        .configurationDisplayName("Add expense")
        .description("Quickly add an expense.")
        .supportedFamilies([.systemSmall])
    }
}

struct ScanReceiptWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesScanReceipt", provider: LauncherProvider()) { _ in
            // scan=1 is a marker; +native-intent.ts rewrites it to a fresh nonce per tap.
            LauncherView(systemImage: "doc.viewfinder", title: "Scan receipt", url: "waves:///capture?scan=1")
        }
        .configurationDisplayName("Scan receipt")
        .description("Scan a receipt into an expense.")
        .supportedFamilies([.systemSmall])
    }
}

struct VoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesVoice", provider: LauncherProvider()) { _ in
            LauncherView(systemImage: "mic.fill", title: "Voice", url: "waves:///voice")
        }
        .configurationDisplayName("Voice")
        .description("Add an expense by voice.")
        .supportedFamilies([.systemSmall])
    }
}

// The medium "Waves" home widget — the iOS twin of Android's WavesHomeWidget: an
// Add-expense pill over four navigation tiles. WidgetKit has no per-region tap
// on iOS 16, so each region is a `Link`, which works in static widgets from
// iOS 17 (iOS 16 falls back to the whole widget opening Add expense).
struct HomeTile: View {
    let systemImage: String
    let title: String
    let url: String
    let fg: Color
    let fill: Color

    var body: some View {
        Link(destination: URL(string: url)!) {
            VStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .regular))
                Text(title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(fg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

struct HomeView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        let container = dark ? Color(white: 0.12) : Color(white: 0.96)
        let surface = dark ? Color(white: 0.17) : Color.white
        let fg = dark ? Color.white : Color(white: 0.12)

        VStack(spacing: 6) {
            HStack(spacing: 0) {
                Link(destination: URL(string: "waves:///capture")!) {
                    HStack(spacing: 10) {
                        Image(systemName: "waveform.path")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(wavesAccent)
                        Text("Add expense")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(fg)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 12)
                }
                Link(destination: URL(string: "waves:///capture?scan=1")!) {
                    Image(systemName: "camera")
                        .font(.system(size: 18))
                        .foregroundStyle(fg)
                        .frame(width: 40, height: 40)
                }
                Link(destination: URL(string: "waves:///voice")!) {
                    Image(systemName: "waveform")
                        .font(.system(size: 18))
                        .foregroundStyle(fg)
                        .frame(width: 40, height: 40)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            HStack(spacing: 6) {
                HomeTile(systemImage: "person.3", title: "Groups", url: "waves:///groups", fg: fg, fill: surface)
                HomeTile(systemImage: "person.2", title: "Friends", url: "waves:///friends", fg: fg, fill: surface)
                HomeTile(systemImage: "clock.arrow.circlepath", title: "Activity", url: "waves:///activity", fg: fg, fill: surface)
                HomeTile(systemImage: "qrcode.viewfinder", title: "Scan QR", url: "waves:///scan", fg: fg, fill: surface)
            }
            .frame(maxHeight: .infinity)
        }
        .widgetBackground(container)
        .widgetURL(URL(string: "waves:///capture"))
    }
}

struct WavesHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesHome", provider: LauncherProvider()) { _ in
            HomeView()
        }
        .configurationDisplayName("Waves")
        .description("Add expenses from your home screen")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct WavesWidgets: WidgetBundle {
    var body: some Widget {
        QuickExpenseWidget()
        ScanReceiptWidget()
        VoiceWidget()
        WavesHomeWidget()
    }
}
