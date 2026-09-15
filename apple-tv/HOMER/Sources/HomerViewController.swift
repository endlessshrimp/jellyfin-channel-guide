import UIKit

/// The whole app: HOMER in a full-screen web view, the remote turned into
/// key presses, the sign-in kept, and the tvOS keyboard for text boxes.
final class HomerViewController: UIViewController, HomerWebViewDelegate {
    private var web: HomerWebView?
    private let keys = RemoteKeys()
    private let store = SessionStore()
    private let textEntry = TextEntry()

    /// HOMER has loaded at least once: from then on Back never leaves the app.
    private var pageShown = false
    /// Presses the app took in pressesBegan, so their ends go the same way.
    private var taken = Set<UIPress.PressType>()
    private var retryTimer: Timer?

    private let statusView = UIView()
    private let statusTitle = UILabel()
    private let statusText = UILabel()

    // ---------- Setup ----------

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildStatus()
        keys.send = { [weak self] key, phase, isRepeat in self?.sendKey(key, phase, isRepeat) }
        keys.sendAction = { [weak self] action in self?.sendAction(action) }
        for direction: UISwipeGestureRecognizer.Direction in [.up, .down, .left, .right] {
            let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
            swipe.direction = direction
            view.addGestureRecognizer(swipe)
        }
        startWeb()
    }

    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    private func startWeb() {
        guard let web = HomerWebView(bootScript: bootScript(), frame: view.bounds) else {
            print("[HOMER] WebKit didn't load; tried \(WebKitRuntime.frameworkPaths)")
            showStatus("This Apple TV won't open a web view",
                       "The app couldn't load WebKit. A tvOS update may have moved it: see apple-tv/README.md.")
            return
        }
        print("[HOMER] WebKit from \(WebKitRuntime.loadedFrom ?? "?"); opening \(Config.homeURL.absoluteString)")
        web.delegate = self
        web.view.frame = view.bounds
        view.insertSubview(web.view, at: 0)
        self.web = web
        showStatus("HOMER", "Loading \(Config.homeURL.absoluteString)")
        web.load(Config.homeURL)
    }

    /// Runs before the bridge: HOMER's origin, and the sign-in saved last time.
    private func bootScript() -> String {
        let boot: [String: Any] = ["origin": Self.origin(of: Config.homeURL),
                                   "zoom": Config.stockPageZoom,
                                   "saved": store.load()]
        return "window.__homerTvAppBoot = \(Self.js(boot));"
    }

    private func load() {
        retryTimer?.invalidate()
        retryTimer = nil
        guard let web else { return }
        showStatus("HOMER", "Loading \(Config.homeURL.absoluteString)")
        web.load(Config.homeURL)
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

    private var statusShown: Bool { !statusView.isHidden }

    private func began(_ type: UIPress.PressType) {
        guard statusShown else { keys.began(type); return }
        // the loading/error screen: Select tries again; nothing else to do
        if type == .select, web != nil { load() }
    }

    private func ended(_ type: UIPress.PressType) {
        guard statusShown else { keys.ended(type); return }
        if type == .menu, pageShown { statusView.isHidden = true } // back to the page
    }

    @objc private func swiped(_ swipe: UISwipeGestureRecognizer) {
        guard !statusShown, presentedViewController == nil, web != nil else { return }
        keys.swiped(swipe.direction)
    }

    private func sendKey(_ key: String, _ phase: RemoteKeys.Phase, _ isRepeat: Bool) {
        web?.evaluate("window.__homerTvApp && window.__homerTvApp.key(\(Self.js(key)), \(Self.js(phase.rawValue)), \(isRepeat))")
    }

    /// The buttons that aren't keys: HOMER hears them as a homer-tv event.
    private func sendAction(_ action: String) {
        web?.evaluate("window.__homerTvApp && window.__homerTvApp.action(\(Self.js(action)))")
    }

    /// Jellyfin's own pages are zoomed and sit in from the edges; HOMER's
    /// screens fill the TV at 1.
    ///
    /// The zoom is CSS (`html { zoom }`), not WebKit's own page zoom: on tvOS
    /// that one magnifies what's already laid out, so a page keeps its full
    /// width and loses its right-hand side. CSS zoom lays the page out again
    /// at the size it ends up, and HOMER's fixed 1920-wide stages aren't
    /// touched because they're only up when the zoom is 1.
    private func applyZoom(_ value: Double) {
        guard let web else { return }
        let zoomed = value > 1.001
        web.view.frame = view.bounds.insetBy(dx: zoomed ? Config.stockPageInset : 0,
                                             dy: zoomed ? Config.stockPageInset : 0)
        web.evaluate("window.__homerTvApp && window.__homerTvApp.cssZoom(\(value))")
        print("[HOMER] zoom \(value)")
    }

    // ---------- The page ----------

    func homerWebViewDidFinishLoad(_ web: HomerWebView) {
        pageShown = true
        retryTimer?.invalidate()
        retryTimer = nil
        statusView.isHidden = true
        if presentedViewController == nil { becomeFirstResponder() }
        #if DEBUG
        if Self.selfTest { runSelfTest() }
        if Self.probe { startProbe() }
        #endif
    }

    func homerWebView(_ web: HomerWebView, didFailWith error: Error) {
        print("[HOMER] load failed: \(error.localizedDescription)")
        showStatus("Can't reach HOMER",
                   "\(Config.homeURL.absoluteString)\n\(error.localizedDescription)\n\n"
                   + "Trying again every \(Int(Config.retrySeconds)) seconds. Press Select to try now.")
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: Config.retrySeconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.load() } // timers fire on the main run loop
        }
    }

    func homerWebViewContentProcessDidTerminate(_ web: HomerWebView) {
        print("[HOMER] the web page's process quit; reloading")
        load()
    }

    func homerWebView(_ web: HomerWebView, received message: [String: Any]) {
        switch message["type"] as? String {
        case "storage":
            if let data = message["data"] as? [String: Any] { store.save(data.compactMapValues { $0 as? String }) }
        case "keyboard":
            guard !textEntry.isShowing, presentedViewController == nil, let request = TextEntry.Request(message) else { return }
            keys.reset()
            #if DEBUG
            if Self.selfTest { // answer for the keyboard: "smoke", then Done
                web.evaluate("window.__homerTvApp.text(\(request.id), \"smoke\", true)")
                return
            }
            if Self.probe { // looking at the page: say so, keep the keyboard out of the way
                print("[HOMER probe] the page asked for the keyboard (\(request.placeholder.isEmpty ? request.kind : request.placeholder))")
                return
            }
            #endif
            textEntry.present(request, from: self) { [weak self] text, submit in
                guard let self else { return }
                self.becomeFirstResponder()
                self.web?.evaluate("window.__homerTvApp && window.__homerTvApp.text(\(request.id), \(Self.js(text)), \(submit))")
            }
        case "zoom":
            applyZoom((message["value"] as? NSNumber)?.doubleValue ?? 1)
        case "media":
            UIApplication.shared.isIdleTimerDisabled = (message["playing"] as? Bool) == true
        case "log":
            print("[HOMER page] \(message["text"] as? String ?? "")")
        default:
            break
        }
    }

    /// Saves the sign-in now (the app is going to the background).
    func saveSession() {
        UIApplication.shared.isIdleTimerDisabled = false
        keys.reset()
        web?.evaluate("window.__homerTvApp ? window.__homerTvApp.snapshot() : null") { [weak self] result in
            guard let self, let data = result as? [String: Any] else { return }
            self.store.save(data.compactMapValues { $0 as? String })
        }
    }

    // ---------- The loading / error screen ----------

    private func buildStatus() {
        statusView.backgroundColor = .black
        statusView.frame = view.bounds
        statusView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        statusTitle.font = .systemFont(ofSize: 76, weight: .heavy)
        statusTitle.textColor = .white
        statusTitle.textAlignment = .center
        statusText.font = .systemFont(ofSize: 30, weight: .regular)
        statusText.textColor = UIColor(white: 1, alpha: 0.7)
        statusText.textAlignment = .center
        statusText.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [statusTitle, statusText])
        stack.axis = .vertical
        stack.spacing = 28
        stack.translatesAutoresizingMaskIntoConstraints = false
        statusView.addSubview(stack)
        view.addSubview(statusView)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: statusView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: statusView.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: statusView.widthAnchor, multiplier: 0.7),
        ])
    }

    private func showStatus(_ title: String, _ text: String) {
        statusTitle.text = title
        statusText.text = text
        statusView.isHidden = false
        view.bringSubviewToFront(statusView)
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

    /// Launched with `-HomerProbe YES`: every 3 seconds, print what the page
    /// is doing (address, HOMER's layout, the first video's state) to the
    /// console. For the tvOS Simulator, where there's no Web Inspector handy.
    private static var probe: Bool { UserDefaults.standard.bool(forKey: "HomerProbe") }
    private var probeTimer: Timer?

    private func startProbe() {
        guard probeTimer == nil else { return }
        probeTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.probeOnce() }
        }
        probeOnce()
    }

    private func probeOnce() {
        web?.evaluate(Self.probeScript) { result in print("[HOMER probe] \(result as? String ?? "nil")") }
    }

    private static let probeScript = """
        JSON.stringify((() => {
            const v = document.querySelector('video');
            const L = window.HomerLayout;
            const r = v && v.getBoundingClientRect();
            return {
                href: location.href, title: document.title, size: innerWidth + 'x' + innerHeight,
                tvapp: window.HOMER_TVAPP === true, homerLoaded: !!window.__homerLoaded,
                layout: L ? { version: L.version, phone: L.isPhone(), touch: L.isTouch() } : null,
                htmlClass: document.documentElement.className, focused: (document.activeElement || {}).id || null,
                screens: [...document.querySelectorAll('#hm-root, #hl-root, #cg-root, .homer-screen')].map((e) => e.id || e.className),
                cssZoom: document.documentElement.style.zoom || 'none', dpr: devicePixelRatio,
                doc: document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight,
                video: v ? {
                    paused: v.paused, time: Math.round(v.currentTime * 10) / 10, readyState: v.readyState,
                    size: v.videoWidth + 'x' + v.videoHeight, box: Math.round(r.width) + 'x' + Math.round(r.height),
                    muted: v.muted, fullscreen: !!(document.fullscreenElement || v.webkitDisplayingFullscreen),
                    error: v.error ? v.error.code : null
                } : null
            };
        })())
        """
    #endif

    // ---------- Helpers ----------

    /// A value as a JavaScript literal (JSON is one), or null.
    static func js(_ value: Any?) -> String {
        guard let value,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let s = String(data: data, encoding: .utf8)
        else { return "null" }
        return s
    }

    /// scheme://host[:port], the way a page's location.origin says it.
    static func origin(of url: URL) -> String {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return "" }
        let defaultPort = scheme == "https" ? 443 : 80
        if let port = url.port, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }
}
