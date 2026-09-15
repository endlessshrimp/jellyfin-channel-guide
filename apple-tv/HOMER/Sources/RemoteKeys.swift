import UIKit

/// The Siri Remote, as the keys HOMER already knows:
///
/// | Remote                      | Key                         |
/// |-----------------------------|-----------------------------|
/// | clickpad ▲▼◀▶              | ArrowUp/Down/Left/Right     |
/// | swipe ◀ ▶                   | ArrowLeft/ArrowRight        |
/// | click (select)              | Enter                       |
/// | hold OK                     | HOMER's menu                |
/// | swipe ▲ / ▼                 | HOMER's swipe-up/swipe-down |
/// | Back / Menu                 | Escape                      |
/// | hold Back                   | h (Home)                    |
/// | Play/Pause                  | Space (Config.playPauseKey) |
/// | channel up/down (some TVs)  | PageUp/PageDown             |
///
/// Arrows repeat while held. Back sends Escape when let go, unless it was
/// held long enough to be Home; OK sends Enter when let go, unless it was
/// held long enough to be the menu. The three that aren't keys (the menu and
/// the two swipes) reach HOMER as a homer-tv event, since a remote has no
/// letter keys.
@MainActor
final class RemoteKeys {
    enum Phase: String { case down, up, press }

    /// Where keys go: (key, phase, repeat).
    var send: (String, Phase, Bool) -> Void = { _, _, _ in }
    /// Where HOMER's own actions go ("menu", "swipe-up", "swipe-down").
    var sendAction: (String) -> Void = { _ in }

    private var repeatTimer: Timer?
    private var repeatKey: String?
    private var backTimer: Timer?
    private var backWasHome = false
    private var selectTimer: Timer?
    private var selectWasMenu = false

    /// Whether the app handles this press (if not, UIKit gets it).
    static func handles(_ type: UIPress.PressType) -> Bool {
        type == .menu || type == .select || type == .playPause || arrowKey(type) != nil
    }

    private static func arrowKey(_ type: UIPress.PressType) -> String? {
        switch type {
        case .upArrow: return "ArrowUp"
        case .downArrow: return "ArrowDown"
        case .leftArrow: return "ArrowLeft"
        case .rightArrow: return "ArrowRight"
        case .pageUp: return "PageUp"
        case .pageDown: return "PageDown"
        default: return nil
        }
    }

    func began(_ type: UIPress.PressType) {
        switch type {
        case .menu:
            backWasHome = false
            backTimer?.invalidate()
            backTimer = Timer.scheduledTimer(withTimeInterval: Config.backHoldSeconds, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.backHeld() } // timers fire on the main run loop
            }
        case .select:
            // Enter waits for the release: OK held down is HOMER's menu instead
            selectWasMenu = false
            selectTimer?.invalidate()
            selectTimer = Timer.scheduledTimer(withTimeInterval: Config.selectHoldSeconds, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.selectHeld() }
            }
        case .playPause:
            send(Config.playPauseKey, .down, false)
        default:
            guard let key = RemoteKeys.arrowKey(type) else { return }
            stopRepeat()
            send(key, .down, false)
            startRepeat(key)
        }
    }

    func ended(_ type: UIPress.PressType) {
        switch type {
        case .menu:
            backTimer?.invalidate()
            backTimer = nil
            if !backWasHome { send("Escape", .press, false) }
            backWasHome = false
        case .select:
            selectTimer?.invalidate()
            selectTimer = nil
            if !selectWasMenu { send("Enter", .press, false) }
            selectWasMenu = false
        case .playPause:
            send(Config.playPauseKey, .up, false)
        default:
            guard let key = RemoteKeys.arrowKey(type) else { return }
            if repeatKey == key { stopRepeat() }
            send(key, .up, false)
        }
    }

    /// The system took the press back (an alert came up, say): let go of
    /// anything held, without acting on Back.
    func cancelled(_ type: UIPress.PressType) {
        switch type {
        case .menu:
            backTimer?.invalidate()
            backTimer = nil
            backWasHome = false
        case .select:
            selectTimer?.invalidate()
            selectTimer = nil
            selectWasMenu = false
        case .playPause:
            send(Config.playPauseKey, .up, false)
        default:
            guard let key = RemoteKeys.arrowKey(type) else { return }
            if repeatKey == key { stopRepeat() }
            send(key, .up, false)
        }
    }

    /// A swipe on the clickpad's touch surface: sideways is an arrow; up and
    /// down are HOMER's own (the clickpad's ▲▼ still move).
    func swiped(_ direction: UISwipeGestureRecognizer.Direction) {
        switch direction {
        case .up: sendAction("swipe-up")
        case .down: sendAction("swipe-down")
        case .left: send("ArrowLeft", .press, false)
        default: send("ArrowRight", .press, false)
        }
    }

    func reset() {
        stopRepeat()
        backTimer?.invalidate()
        backTimer = nil
        backWasHome = false
        selectTimer?.invalidate()
        selectTimer = nil
        selectWasMenu = false
    }

    private func selectHeld() {
        selectWasMenu = true
        sendAction("menu")
    }

    private func backHeld() {
        backWasHome = true
        send("h", .press, false)
    }

    private func startRepeat(_ key: String) {
        repeatKey = key
        repeatTimer = Timer.scheduledTimer(withTimeInterval: Config.repeatDelay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.repeating(key) }
        }
    }

    private func repeating(_ key: String) {
        guard repeatKey == key else { return }
        repeatTimer = Timer.scheduledTimer(withTimeInterval: Config.repeatInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.repeatKey == key else { return }
                self.send(key, .down, true)
            }
        }
    }

    private func stopRepeat() {
        repeatTimer?.invalidate()
        repeatTimer = nil
        repeatKey = nil
    }
}
