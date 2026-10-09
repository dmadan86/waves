// Waves home-screen widgets (iOS).
//
// Three launcher widgets in one extension, all on the same white-glass card with
// the purple "W" tile — the iOS twins of the Android widgets emitted by
// plugins/withWavesWidgets.js:
//
//   - Compact: "Add expense / Tap to add quickly" and three round buttons
//     (photo, voice, manual). Also on the Lock Screen as a rectangular accessory.
//   - Search: a "What did you spend on?" pill with a mic, over Food / Travel /
//     Shopping / … chips that open quick add with that category chosen.
//   - Action grid: a "Waves" header with a settings gear, over Photo, Voice,
//     Scan and Manual tiles.
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
    // `gallery=1` / `scan=1` are markers; +native-intent.ts rewrites each to a
    // fresh nonce per tap so the capture screen's consume-once guard re-fires.
    static let photo = URL(string: "waves:///capture?gallery=1")!
    static let scan = URL(string: "waves:///capture?scan=1")!
    static let voice = URL(string: "waves:///voice")!
    static let settings = URL(string: "waves:///profile")!
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
    let brand: Color
    let brandSoft: Color
    let lilac: Color, lilacInk: Color
    let sky: Color, skyInk: Color
    let peach: Color, peachInk: Color
    let mint: Color, mintInk: Color
    let pinkInk: Color

    static func of(_ scheme: ColorScheme) -> Palette {
        scheme == .dark
            ? Palette(
                card: hex(0x16162A, 0.94), pill: hex(0x1E1E36), chip: hex(0x2A2A47),
                text: hex(0xF4F3FF), muted: hex(0x9E9EB8),
                brand: hex(0x8B6FF0), brandSoft: hex(0x2A2250),
                lilac: hex(0x2E2A57), lilacInk: hex(0xC9C2FF),
                sky: hex(0x1B3A52), skyInk: hex(0xAFD8F7),
                peach: hex(0x463020), peachInk: hex(0xF7CFA2),
                mint: hex(0x26306B), mintInk: hex(0xC7CEFF),
                pinkInk: hex(0xFFC2CA))
            : Palette(
                card: hex(0xFFFFFF, 0.92), pill: hex(0xFFFFFF), chip: hex(0xF3F1FB),
                text: hex(0x14142B), muted: hex(0x54566B),
                brand: hex(0x6C4EE3), brandSoft: hex(0xE9E4FF),
                lilac: hex(0xDCD9FB), lilacInk: hex(0x6C4EE3),
                sky: hex(0xCFE6FA), skyInk: hex(0x1D68A3),
                peach: hex(0xFBE0C4), peachInk: hex(0xB8690F),
                mint: hex(0xDCE1FF), mintInk: hex(0x2E3A8C),
                pinkInk: hex(0x964450))
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

/// The purple rounded-square "W" tile every widget leads with.
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

/// A round icon button (the compact widget's photo / voice / manual).
struct RoundButton: View {
    let systemImage: String
    let label: String
    let url: URL
    let fill: Color
    let ink: Color
    var size: CGFloat = 44

    var body: some View {
        Link(destination: url) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(ink)
                .frame(width: size, height: size)
                .background(fill, in: Circle())
        }
        .accessibilityLabel(label)
    }
}

// MARK: - Compact

struct CompactView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryRectangular {
            accessory
        } else {
            card
        }
    }

    /// Lock Screen: monochrome, one tap target — the whole thing opens quick add.
    private var accessory: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 26, weight: .semibold))
            VStack(alignment: .leading, spacing: 1) {
                Text("Add expense").font(.headline).lineLimit(1)
                Text("Tap to add quickly").font(.caption).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .widgetURL(Links.manual)
        .widgetBackground(Color.clear)
    }

    private var card: some View {
        let p = Palette.of(scheme)
        return HStack(spacing: 10) {
            LogoTile(size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("Add expense")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(p.text)
                Text("Tap to add quickly")
                    .font(.system(size: 12))
                    .foregroundStyle(p.muted)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            HStack(spacing: 8) {
                RoundButton(systemImage: "camera.fill", label: "Photo", url: Links.photo, fill: p.lilac, ink: p.lilacInk)
                RoundButton(systemImage: "mic.fill", label: "Voice", url: Links.voice, fill: p.sky, ink: p.skyInk)
                RoundButton(systemImage: "plus", label: "Add expense", url: Links.manual, fill: p.brandSoft, ink: p.brand)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetBackground(p.card)
        .widgetURL(Links.manual)
    }
}

struct WavesCompactWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesCompact", provider: LauncherProvider()) { _ in
            CompactView()
        }
        .configurationDisplayName("Add expense")
        .description("Add an expense with a photo, your voice or by hand.")
        .supportedFamilies([.systemMedium, .accessoryRectangular])
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

// MARK: - Action grid

struct ActionTile: View {
    let systemImage: String
    let title: String
    let subtitle: String
    let url: URL
    let fill: Color
    let ink: Color
    let p: Palette

    var body: some View {
        Link(destination: url) {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(ink)
                    .padding(.bottom, 2)
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(p.text)
                Text(subtitle)
                    .font(.system(size: 10))
                    .foregroundStyle(p.muted)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

struct GridView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let p = Palette.of(scheme)
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                LogoTile(size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Waves")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(p.text)
                    Text("Capture expenses, anywhere")
                        .font(.system(size: 11))
                        .foregroundStyle(p.muted)
                }
                .lineLimit(1)
                Spacer(minLength: 0)
                Link(destination: Links.settings) {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(p.text)
                        .frame(width: 30, height: 30)
                        .background(p.chip, in: Circle())
                }
                .accessibilityLabel("Settings")
            }

            HStack(spacing: 6) {
                ActionTile(systemImage: "camera.fill", title: "Photo", subtitle: "Add with photo", url: Links.photo, fill: p.lilac, ink: p.lilacInk, p: p)
                ActionTile(systemImage: "mic.fill", title: "Voice", subtitle: "Say it out loud", url: Links.voice, fill: p.sky, ink: p.skyInk, p: p)
                ActionTile(systemImage: "doc.text.fill", title: "Scan", subtitle: "Scan receipt", url: Links.scan, fill: p.peach, ink: p.peachInk, p: p)
                ActionTile(systemImage: "plus", title: "Manual", subtitle: "Add expense", url: Links.manual, fill: p.mint, ink: p.mintInk, p: p)
            }
            .frame(maxHeight: .infinity)
        }
        .widgetBackground(p.card)
        .widgetURL(Links.manual)
    }
}

// Keeps the kind of the 4x2 "Waves" widget it replaces, so one already on a Home
// Screen redraws as the grid instead of disappearing.
struct WavesHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WavesHome", provider: LauncherProvider()) { _ in
            GridView()
        }
        .configurationDisplayName("Waves")
        .description("Capture expenses, anywhere.")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct WavesWidgets: WidgetBundle {
    var body: some Widget {
        WavesCompactWidget()
        WavesSearchWidget()
        WavesHomeWidget()
    }
}
