import UIKit

/// The Apple TV's half: the Siri Remote turned into key presses, and the tvOS
/// keyboard for text boxes. The web view itself never takes a press, so
/// nothing fights over them.
final class TVViewController: HomerViewController {
    private let keys = RemoteKeys()
    private let textEntry = TextEntry()
    /// Presses the app took in pressesBegan, so their ends go the same way.
    private var taken = Set<UIPress.PressType>()

    override func viewDidLoad() {
        super.viewDidLoad()
        keys.send = { [weak self] key, phase, isRepeat in self?.sendKey(key, phase.rawValue, isRepeat) }
        keys.sendAction = { [weak self] action in self?.sendAction(action) }
        for direction: UISwipeGestureRecognizer.Direction in [.up, .down, .left, .right] {
            let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
            swipe.direction = direction
            view.addGestureRecognizer(swipe)
        }
    }

    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func pageDidLoad() {
        if presentedViewController == nil { becomeFirstResponder() }
        #if DEBUG
        if Self.selfTest { runSelfTest() }
        #endif
    }

    // ---------- The remote ----------

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var rest = Set<UIPress>()
        for press in presses {
            if takes(press.type) {
                taken.insert(press.type)
                began(press.type)
            } else {
                rest.insert(press)
            }
        }
        if !rest.isEmpty { super.pressesBegan(rest, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var rest = Set<UIPress>()
        for press in presses {
            if taken.remove(press.type) != nil { ended(press.type) } else { rest.insert(press) }
        }
        if !rest.isEmpty { super.pressesEnded(rest, with: event) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var rest = Set<UIPress>()
        for press in presses {
            if taken.remove(press.type) != nil { keys.cancelled(press.type) } else { rest.insert(press) }
        }
        if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
    }

    override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let rest = presses.filter { !taken.contains($0.type) }
        if !rest.isEmpty { super.pressesChanged(rest, with: event) }
    }

    /// Whether a press is the app's. Back is, once HOMER has shown: it goes
    /// to the page as Escape and never quits the app. Before that (HOMER
    /// never loaded), Back leaves the app as usual.
    private func takes(_ type: UIPress.PressType) -> Bool {
        guard presentedViewController == nil, RemoteKeys.handles(type) else { return false }
        if type == .menu { return pageShown }
        return true
    }

    private func began(_ type: UIPress.PressType) {
        guard statusShown else { keys.began(type); return }
        // the loading/error screen: Select tries again; nothing else to do
        if type == .select, web != nil { load() }
    }

    private func ended(_ type: UIPress.PressType) {
        guard statusShown else { keys.ended(type); return }
        if type == .menu, pageShown { hideStatus() } // back to the page
    }

    @objc private func swiped(_ swipe: UISwipeGestureRecognizer) {
        guard !statusShown, presentedViewController == nil, web != nil else { return }
        keys.swiped(swipe.direction)
    }

    // ---------- The tvOS keyboard ----------

    override func handle(message: [String: Any], type: String) -> Bool {
        guard type == "keyboard" else { return false }
        guard !textEntry.isShowing, presentedViewController == nil, let request = TextEntry.Request(message) else { return true }
        keys.reset()
        #if DEBUG
        if Self.selfTest { // answer for the keyboard: "smoke", then Done
            web?.evaluate("window.__homerApp.text(\(request.id), \"smoke\", true)")
            return true
        }
        if Self.probe { // looking at the page: say so, keep the keyboard out of the way
            print("[HOMER probe] the page asked for the keyboard (\(request.placeholder.isEmpty ? request.kind : request.placeholder))")
            return true
        }
        #endif
        textEntry.present(request, from: self) { [weak self] text, submit in
            guard let self else { return }
            self.becomeFirstResponder()
            self.web?.evaluate("window.__homerApp && window.__homerApp.text(\(request.id), \(Self.js(text)), \(submit))")
        }
        return true
    }

    override func saveSession() {
        keys.reset()
        super.saveSession()
    }

    // ---------- Self-test (Debug builds) ----------

    #if DEBUG
    /// Launched with `-HomerSelfTest YES`: once the page loads, press buttons
    /// through the same path the remote's presses take, and answer the
    /// keyboard itself. For checking the app without an Apple TV
    /// (Tools/catalyst-smoke.sh runs it on the Mac).
    private static var selfTest: Bool { UserDefaults.standard.bool(forKey: "HomerSelfTest") }
    private var selfTestRan = false

    private func runSelfTest() {
        guard !selfTestRan else { return }
        selfTestRan = true
        let presses: [(TimeInterval, UIPress.PressType, Bool)] = [
            (0.5, .downArrow, true), (0.6, .downArrow, false),   // a tap
            (1.0, .rightArrow, true), (1.8, .rightArrow, false), // held: repeats
            (2.2, .select, true), (2.3, .select, false),         // OK: Enter
            (2.6, .playPause, true), (2.7, .playPause, false),
            (3.0, .menu, true), (3.1, .menu, false),             // Back: Escape
            (3.5, .menu, true), (4.4, .menu, false),             // held: h
            (4.8, .select, true), (5.7, .select, false),         // held: the menu, no Enter
        ]
        for (delay, type, down) in presses {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self else { return }
                if down { self.keys.began(type) } else { self.keys.ended(type) }
            }
        }
        for (delay, direction) in [(6.1, UISwipeGestureRecognizer.Direction.up), (6.4, .down), (6.7, .left)] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.keys.swiped(direction)
            }
        }
    }
    #endif
}
