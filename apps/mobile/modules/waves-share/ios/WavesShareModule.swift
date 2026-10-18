import ExpoModulesCore
import MessageUI
import UIKit

/**
 * Shares an image and its text in one go: an activity sheet with both items
 * (WhatsApp's share extension turns the text into the image's caption), or for
 * `email` a mail draft with the image attached when a Mail account is set up.
 *
 * Resolves `shared` once the draft is on screen, or, for `any`, the sheet. For
 * `whatsapp` and the `email` sheet fallback it waits for the sheet to finish:
 * `shared` if the user picked the intended route (WhatsApp's share extension;
 * any activity for email), `cancelled` otherwise, so the caller does not open
 * a second sheet. `unavailable` only means there was nothing to present on.
 *
 * Compiled with Xcode; exercise a real share before trusting it in a release.
 */
public final class WavesShareModule: Module {
  private var mailDelegate: MailDelegate?

  public func definition() -> ModuleDefinition {
    Name("WavesShare")

    // Incoming shares. The Share Extension (targets/share) drops the image in
    // the App Group container and opens `waves://share-receipt`; the app polls
    // here (cold start and every return to the foreground). The file is moved
    // into Caches so the share is consumed exactly once. No live event: iOS
    // always brings the app forward through the foreground poll.
    Events("onShare")

    AsyncFunction("getInitialShare") { () -> [String: String]? in
      guard let bundleId = Bundle.main.bundleIdentifier,
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: "group.\(bundleId)")
      else { return nil }
      let fm = FileManager.default
      let incoming = container.appendingPathComponent("incoming", isDirectory: true)
      guard
        let files = try? fm.contentsOfDirectory(
          at: incoming, includingPropertiesForKeys: [.contentModificationDateKey]),
        let newest = files.max(by: {
          let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
          let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
          return a < b
        })
      else { return nil }
      let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("incoming-share", isDirectory: true)
      try? fm.createDirectory(at: caches, withIntermediateDirectories: true)
      if let old = try? fm.contentsOfDirectory(at: caches, includingPropertiesForKeys: nil) {
        old.forEach { try? fm.removeItem(at: $0) }
      }
      let ext = newest.pathExtension.lowercased()
      let id = UUID().uuidString
      let target = caches.appendingPathComponent("\(id).\(ext.isEmpty ? "jpg" : ext)")
      do { try fm.moveItem(at: newest, to: target) } catch { return nil }
      // Anything else left behind is stale.
      if let rest = try? fm.contentsOfDirectory(at: incoming, includingPropertiesForKeys: nil) {
        rest.forEach { try? fm.removeItem(at: $0) }
      }
      let mime: String
      switch ext {
      case "png": mime = "image/png"
      case "heic", "heif": mime = "image/heic"
      case "webp": mime = "image/webp"
      case "gif": mime = "image/gif"
      default: mime = "image/jpeg"
      }
      return ["id": id, "uri": target.absoluteString, "mimeType": mime]
    }

    AsyncFunction("clearShare") { (_: String) in }

    AsyncFunction("shareImageWithText") { (options: [String: String]) -> String in
      guard let fileUri = options["fileUri"], let url = URL(string: fileUri) else {
        return "unavailable"
      }
      let text = options["text"] ?? ""
      let subject = options["subject"] ?? ""
      let target = options["target"] ?? "any"
      let utilities = self.appContext?.utilities

      return await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
        Task { @MainActor in
        guard let presenter = utilities?.currentViewController() else {
          continuation.resume(returning: "unavailable")
          return
        }

        if target == "email", MFMailComposeViewController.canSendMail(),
           let data = try? Data(contentsOf: url) {
          let mail = MFMailComposeViewController()
          let delegate = MailDelegate { [weak self] in self?.mailDelegate = nil }
          self.mailDelegate = delegate
          mail.mailComposeDelegate = delegate
          mail.setSubject(subject)
          mail.setMessageBody(text, isHTML: false)
          mail.addAttachmentData(data, mimeType: "image/png", fileName: url.lastPathComponent)
          presenter.present(mail, animated: true)
          continuation.resume(returning: "shared")
          return
        }

        var items: [Any] = []
        if let image = UIImage(contentsOfFile: url.path) {
          items.append(image)
        } else {
          items.append(url)
        }
        if !text.isEmpty { items.append(text) }

        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if !subject.isEmpty {
          sheet.setValue(subject, forKey: "subject")
        }
        // iPad needs an anchor or presenting the popover crashes.
        if let popover = sheet.popoverPresentationController {
          popover.sourceView = presenter.view
          popover.sourceRect = CGRect(
            x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
          popover.permittedArrowDirections = []
        }
        if target != "any" {
          sheet.completionWithItemsHandler = { activityType, completed, _, _ in
            // WhatsApp's share extension is net.whatsapp.WhatsApp.ShareExtension.
            let intended =
              target == "whatsapp"
              ? (activityType?.rawValue.lowercased().contains("whatsapp") ?? false)
              : true
            continuation.resume(returning: completed && intended ? "shared" : "cancelled")
          }
        }
        presenter.present(sheet, animated: true)
        if target == "any" { continuation.resume(returning: "shared") }
        }
      }
    }
  }
}

private final class MailDelegate: NSObject, MFMailComposeViewControllerDelegate {
  private let done: () -> Void

  init(done: @escaping () -> Void) {
    self.done = done
  }

  func mailComposeController(
    _ controller: MFMailComposeViewController,
    didFinishWith result: MFMailComposeResult,
    error: Error?
  ) {
    controller.dismiss(animated: true)
    done()
  }
}
