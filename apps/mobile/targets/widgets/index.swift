// Waves home-screen widgets (iOS).
//
// The Search launcher widget, on the white-glass card with the purple "W" tile —
// the iOS twin of the Android widget emitted by plugins/withWavesWidgets.js:
//
//   - Search: a "What did you spend on?" pill with a mic, over Food / Travel /
//     Shopping / … chips that open quick add with that category chosen.
//
// Each region is a `Link` to a deep link the app already resolves through
// +native-intent.ts, so there is no timeline, no shared data, no App Group. The
// entry never changes and the timeline never reloads.

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

// MARK: - Deep links (match plugins/withWavesWidgets.js)

private enum Links {
    static let manual = URL(string: "waves:///capture")!
    static let voice = URL(string: "waves:///voice")!
    static func category(_ id: String) -> URL { URL(string: "waves:///capture?category=\(id)")! }
}

// MARK: - Palette (packages/ui themes: brand, ink, and the pastel tint family)

private func hex(_ value: UInt32, _ alpha: Double = 1) -> Color {
    Color(
        red: Double((value >> 16) & 0xFF) / 255,
        green: Double((value >> 8) & 0xFF) / 255,
        blue: Double(value & 0xFF) / 255,
        opacity: alpha
    )
}

struct Palette {
    let card: Color
    let pill: Color
    let chip: Color
    let text: Color
    let muted: Color
    let skyInk: Color
    let peachInk: Color
    let pinkInk: Color

    static func of(_ scheme: ColorScheme) -> Palette {
        scheme == .dark
            ? Palette(
                card: hex(0x16162A, 0.94), pill: hex(0x1E1E36), chip: hex(0x2A2A47),
                text: hex(0xF4F3FF), muted: hex(0x9E9EB8),
                skyInk: hex(0xAFD8F7), peachInk: hex(0xF7CFA2), pinkInk: hex(0xFFC2CA))
            : Palette(
                card: hex(0xFFFFFF, 0.92), pill: hex(0xFFFFFF), chip: hex(0xF3F1FB),
                text: hex(0x14142B), muted: hex(0x54566B),
                skyInk: hex(0x1D68A3), peachInk: hex(0xB8690F), pinkInk: hex(0x964450))
    }
}

/// The logo tile's purple is the brand in both schemes, like the app icon.
private let logoPurple = hex(0x6C4EE3)

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

// MARK: - Pieces

/// The purple rounded-square "W" tile the widget leads with.
struct LogoTile: View {
    let size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(logoPurple)
            .frame(width: size, height: size)
            .overlay(
                Text("W")
                    .font(.system(size: size * 0.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Search

struct CategoryChip: View {
    let systemImage: String
    let title: String
    let id: String
    let ink: Color
    let p: Palette

    var body: some View {
        Link(destination: Links.category(id)) {
            HStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ink)
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(p.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(p.chip, in: Capsule())
        }
    }
}

struct SearchView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let p = Palette.of(scheme)
        VStack(spacing: 10) {
            HStack(spacing: 0) {
                Link(destination: Links.manual) {
                    HStack(spacing: 10) {
                        LogoTile(size: 34)
                        Text("What did you spend on?")
                            .font(.system(size: 15))
                            .foregroundStyle(p.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 6)
                }
                Link(destination: Links.voice) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(p.text)
                        .frame(width: 40, height: 40)
                }
                .accessibilityLabel("Voice")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(p.pill, in: Capsule())

            HStack(spacing: 6) {
                CategoryChip(systemImage: "fork.knife", title: "Food", id: "food", ink: p.peachInk, p: p)
                CategoryChip(systemImage: "car.fill", title: "Travel", id: "travel", ink: p.skyInk, p: p)
                CategoryChip(systemImage: "bag.fill", title: "Shopping", id: "shopping", ink: p.pinkInk, p: p)
                Link(destination: Links.manual) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(p.text)
                        .frame(width: 40)
                        .frame(maxHeight: .infinity)
                        .background(p.chip, in: Capsule())
                }
                .accessibilityLabel("More categories")
            }
            .frame(maxHeight: .infinity)
        }
        .widgetBackground(p.card)
        .widgetURL(Links.manual)
    }
}

struct WavesSearchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesSearch", provider: LauncherProvider()) { _ in
            SearchView()
        }
        .configurationDisplayName("What did you spend on?")
        .description("Start an expense from a category in one tap.")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct WavesWidgets: WidgetBundle {
    var body: some Widget {
        WavesSearchWidget()
    }
}
