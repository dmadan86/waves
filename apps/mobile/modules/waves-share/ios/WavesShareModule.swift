import ExpoModulesCore
import MessageUI
import UIKit

/**
 * Shares an image and its text in one go: an activity sheet with both items
 * (WhatsApp's share extension turns the text into the image's caption), or for
 * `email` a mail draft with the image attached when a Mail account is set up.
 *
 * Resolves `shared` once the sheet or draft is on screen. iOS cannot tell
 * whether a given app is installed from here, so `unavailable` only means
 * there was nothing to present on.
 *
 * Compiled with Xcode; exercise a real share before trusting it in a release.
 */
public final class WavesShareModule: Module {
  private var mailDelegate: MailDelegate?

  public func definition() -> ModuleDefinition {
    Name("WavesShare")

    AsyncFunction("shareImageWithText") { (options: [String: String]) -> String in
      guard let fileUri = options["fileUri"], let url = URL(string: fileUri) else {
        return "unavailable"
      }
      let text = options["text"] ?? ""
      let subject = options["subject"] ?? ""
      let target = options["target"] ?? "any"
      let utilities = self.appContext?.utilities

      return await MainActor.run { () -> String in
        guard let presenter = utilities?.currentViewController() else { return "unavailable" }

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
          return "shared"
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
        presenter.present(sheet, animated: true)
        return "shared"
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
