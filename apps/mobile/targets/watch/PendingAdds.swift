import Foundation

// Offline-first adds. Every quick-add and voice note is written here FIRST, with
// a client id and the time it was made, then sent to the phone whenever it can
// be. An entry is removed (quick-add) or marked sent (voice note) only once the
// phone has answered, and the list survives the app being closed.
//
// UNVERIFIED: authored without Xcode.

struct PendingAdd: Codable, Identifiable, Equatable {
  enum Kind: String, Codable { case quick, voice }

  var id: String
  var kind: Kind
  /// Whole units as dialled (quick-add).
  var amount: Int
  var currency: String
  var note: String
  /// Epoch ms the person made it, on this watch's clock.
  var madeAt: Int64
  /// This watch's UTC offset then, minutes east of UTC.
  var tzOffsetMin: Int
  var lat: Double?
  var lng: Double?
  var accuracy: Double?
  var capturedAt: Int64?
  /// Voice only: the clip's file name inside `PendingStore.clipDirectory`.
  var clipFile: String?
  var durationMs: Int
  /// Handed to the OS queue (transferUserInfo / transferFile) at least once.
  var queued: Bool
  /// The phone has it: acked (quick-add) or the file arrived (voice).
  var delivered: Bool
  /// Waiting up to ~3 s for a location fix; never sent while true.
  var awaitingLocation: Bool

  /// What the Recent list says under the row.
  var statusText: String {
    switch (kind, delivered) {
    case (.voice, true): return "Voice note · sent to phone"
    case (.voice, false): return "Voice note · will sync"
    default: return "Saved on watch · will sync"
    }
  }

  var title: String {
    kind == .voice ? "Voice note" : "\(currency) \(amount)"
  }

  /// The wire form of the add (without the audio for a voice note).
  var wire: [String: Any] {
    var m: [String: Any] = ["id": id, "madeAt": madeAt, "tzOffsetMin": tzOffsetMin]
    if kind == .quick {
      m["t"] = "quickAdd"
      m["amount"] = String(amount)
      m["currency"] = currency
      m["note"] = note
    } else {
      m["t"] = "voiceClip"
      m["durationMs"] = durationMs
    }
    if let lat, let lng {
      var loc: [String: Any] = ["lat": lat, "lng": lng]
      if let accuracy { loc["accuracy"] = accuracy }
      if let capturedAt { loc["capturedAt"] = capturedAt }
      m["location"] = loc
    }
    return m
  }
}

/// UserDefaults-backed list; small (a handful of rows), so a JSON blob is enough.
enum PendingStore {
  private static let key = "waves.pendingAdds.v1"
  /// Synced voice rows kept so the list can say "sent to phone".
  private static let keepDelivered = 5

  static var clipDirectory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("pending-clips", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func load() -> [PendingAdd] {
    guard let data = UserDefaults.standard.data(forKey: key),
      var list = try? JSONDecoder().decode([PendingAdd].self, from: data)
    else { return [] }
    // A relaunch ends any wait for a fix: send what we have.
    for i in list.indices { list[i].awaitingLocation = false }
    return list
  }

  static func save(_ list: [PendingAdd]) {
    // Trim old delivered voice rows (oldest first) and their files.
    var kept = list
    let deliveredIdx = kept.indices.filter { kept[$0].delivered }
    if deliveredIdx.count > keepDelivered {
      for i in deliveredIdx.dropLast(keepDelivered).reversed() { kept.remove(at: i) }
    }
    if let data = try? JSONEncoder().encode(kept) {
      UserDefaults.standard.set(data, forKey: key)
    }
  }

  static func clipURL(_ entry: PendingAdd) -> URL? {
    entry.clipFile.map { clipDirectory.appendingPathComponent($0) }
  }

  static func deleteClip(_ entry: PendingAdd) {
    if let url = clipURL(entry) { try? FileManager.default.removeItem(at: url) }
  }
}
