import UIKit
import UniformTypeIdentifiers

/// Receives one shared image, parks it in the App Group container and opens
/// Waves. The extension does no UI of its own: it is a hop.
///
/// The app reads `<group>/incoming/` (WavesShareModule.swift). The group is
/// `group.<main app bundle id>`; this extension's bundle id is the main app's
/// plus `.share`, so the main id is this one minus its last component.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    handOff()
  }

  private func appGroupId() -> String? {
    guard let own = Bundle.main.bundleIdentifier else { return nil }
    var parts = own.split(separator: ".")
    guard parts.count > 1 else { return nil }
    parts.removeLast()
    return "group." + parts.joined(separator: ".")
  }

  private func handOff() {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
      .flatMap { $0.attachments ?? [] } ?? []
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) else {
      finish()
      return
    }
    provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, _ in
      guard let self = self else { return }
      var saved = false
      if let url = url, let group = self.appGroupId(),
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
      {
        let dir = container.appendingPathComponent("incoming", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // One share is live at a time.
        if let old = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
          old.forEach { try? FileManager.default.removeItem(at: $0) }
        }
        let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension.lowercased()
        let target = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
        saved = (try? FileManager.default.copyItem(at: url, to: target)) != nil
      }
      DispatchQueue.main.async {
        if saved { self.openHost() }
        self.finish()
      }
    }
  }

  /// Share extensions cannot call UIApplication.open directly; walking the
  /// responder chain to UIApplication is the standard workaround.
  private func openHost() {
    guard let url = URL(string: "waves://share-receipt") else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url, options: [:], completionHandler: nil)
        return
      }
      responder = current.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
