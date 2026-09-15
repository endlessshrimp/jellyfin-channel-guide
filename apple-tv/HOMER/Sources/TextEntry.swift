import UIKit

/// The tvOS keyboard for a text box in the page (Search, the ZIP and Home
/// Assistant boxes in Settings, Jellyfin's sign-in). An alert with one text
/// field that opens the full-screen keyboard straight away, the way
/// tvOSBrowser does it (BrowserPageActionCoordinator.m). Done on the keyboard
/// hands the text back and presses Enter; Cancel (or Back) leaves the box as
/// it was.
@MainActor
final class TextEntry: NSObject, UITextFieldDelegate {
    struct Request {
        let id: Int
        let value: String
        let placeholder: String
        let kind: String        // the input's type: text, search, email, password, url, number…
        let inputMode: String   // its inputmode attribute (numeric for a ZIP)
        let enterKeyHint: String
        let secure: Bool

        init?(_ message: [String: Any]) {
            guard let id = (message["id"] as? NSNumber)?.intValue else { return nil }
            self.id = id
            value = message["value"] as? String ?? ""
            placeholder = message["placeholder"] as? String ?? ""
            kind = message["kind"] as? String ?? "text"
            inputMode = message["inputMode"] as? String ?? ""
            enterKeyHint = message["enterKeyHint"] as? String ?? ""
            secure = message["secure"] as? Bool ?? false
        }
    }

    typealias Done = (_ text: String?, _ submit: Bool) -> Void

    private weak var alert: UIAlertController?
    private var done: Done?

    var isShowing: Bool { alert != nil }

    /// One at a time: the caller checks isShowing first.
    func present(_ r: Request, from host: UIViewController, done: @escaping Done) {
        finish(nil, false) // an earlier one that never answered
        let title = r.placeholder.isEmpty ? "Type" : r.placeholder
        let alert = UIAlertController(title: title, message: nil, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = r.value
            field.placeholder = r.placeholder
            field.isSecureTextEntry = r.secure
            field.autocorrectionType = .no
            field.autocapitalizationType = .none
            field.keyboardType = TextEntry.keyboard(for: r)
            field.returnKeyType = (r.kind == "search" || r.enterKeyHint == "search" || title.lowercased().hasPrefix("search")) ? .search : .done
            field.delegate = self
        }
        alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self, weak alert] _ in
            self?.finish(alert?.textFields?.first?.text ?? "", true)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.finish(nil, false)
        })
        self.alert = alert
        self.done = done
        host.present(alert, animated: true) {
            alert.textFields?.first?.becomeFirstResponder()
        }
    }

    // Done on the keyboard itself: no need to stop at the alert on the way back
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        let text = textField.text ?? ""
        alert?.dismiss(animated: true)
        finish(text, true)
        return false
    }

    private func finish(_ text: String?, _ submit: Bool) {
        let d = done
        done = nil
        d?(text, submit)
    }

    private static func keyboard(for r: Request) -> UIKeyboardType {
        switch (r.kind, r.inputMode) {
        case ("email", _), (_, "email"): return .emailAddress
        case ("url", _), (_, "url"): return .URL
        case ("number", _), ("tel", _), (_, "numeric"), (_, "decimal"), (_, "tel"): return .numbersAndPunctuation
        default: return .default
        }
    }
}
