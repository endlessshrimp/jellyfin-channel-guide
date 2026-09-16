import UIKit

/// HOMER in a full-screen web view: the part that's the same on every Apple
/// platform. It opens the page, keeps the sign-in, zooms Jellyfin's own pages
/// where that's wanted, shows a loading/error screen, and passes the page's
/// messages on.
///
/// What each platform does differently lives in a subclass: TVViewController
/// (the Siri Remote as keys, the tvOS keyboard) and PhoneViewController
/// (touch, background audio, the lock screen, picture in picture).
/// `HomerViewController.make()` picks the right one.
class HomerViewController: UIViewController, HomerWebViewDelegate {
    private(set) var web: HomerWebView?
    let store = SessionStore()

    /// HOMER has loaded at least once. On the Apple TV, Back stops leaving the
    /// app from then on.
    private(set) var pageShown = false
    private var retryTimer: Timer?

    private let statusView = UIView()
    private let statusTitle = UILabel()
    private let statusText = UILabel()

    // ---------- Setup ----------

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildStatus()
        startWeb()
    }

    private func startWeb() {
        guard let web = HomerWebView(bootScript: bootScript(),
                                     frame: view.bounds,
                                     interactive: Config.interactiveWebView,
                                     pictureInPicture: Config.pictureInPicture) else {
            print("[HOMER] WebKit didn't load; tried \(WebKitRuntime.frameworkPaths)")
            showStatus("This device won't open a web view",
                       "The app couldn't load WebKit. A system update may have moved it: see apple/README.md.")
            return
        }
        print("[HOMER] WebKit from \(WebKitRuntime.loadedFrom ?? "?"); \(Config.platform) opening \(Config.homeURL.absoluteString)")
        web.delegate = self
        web.view.frame = view.bounds
        view.insertSubview(web.view, at: 0)
        self.web = web
        showStatus("HOMER", "Loading \(Config.homeURL.absoluteString)")
        web.load(Config.homeURL)
    }

    /// Runs before the bridge: which platform this is, HOMER's origin, and the
    /// sign-in saved last time.
    private func bootScript() -> String {
        let saved = store.load()
        if !saved.isEmpty { print("[HOMER] restoring: \(saved.keys.sorted().joined(separator: ", "))") }
        let boot: [String: Any] = ["platform": Config.platform,
                                   "version": Config.version,
                                   "origin": Self.origin(of: Config.homeURL),
                                   "zoom": Config.stockPageZoom,
                                   "nowPlaying": Config.backgroundAudio,
                                   "saved": saved]
        return "window.__homerAppBoot = \(Self.js(boot));"
    }

    func load() {
        retryTimer?.invalidate()
        retryTimer = nil
        guard let web else { return }
        showStatus("HOMER", "Loading \(Config.homeURL.absoluteString)")
        web.load(Config.homeURL)
    }

    // ---------- Talking to the page ----------

    /// A key, as if typed: HOMER is built for arrows, OK and Esc.
    func sendKey(_ key: String, _ phase: String, _ isRepeat: Bool) {
        web?.evaluate("window.__homerApp && window.__homerApp.key(\(Self.js(key)), \(Self.js(phase)), \(isRepeat))")
    }

    /// The buttons that aren't keys: HOMER hears them as a homer-app event.
    func sendAction(_ action: String) {
        web?.evaluate("window.__homerApp && window.__homerApp.action(\(Self.js(action)))")
    }

    // ---------- The page ----------

    func homerWebViewDidFinishLoad(_ web: HomerWebView) {
        pageShown = true
        retryTimer?.invalidate()
        retryTimer = nil
        statusView.isHidden = true
        pageDidLoad()
        #if DEBUG
        if Self.probe { startProbe() }
        #endif
    }

    func homerWebView(_ web: HomerWebView, didFailWith error: Error) {
        print("[HOMER] load failed: \(error.localizedDescription)")
        showStatus("Can't reach HOMER",
                   "\(Config.homeURL.absoluteString)\n\(error.localizedDescription)\n\n"
                   + "Trying again every \(Int(Config.retrySeconds)) seconds.")
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
        let type = message["type"] as? String ?? ""
        switch type {
        case "storage":
            if let data = message["data"] as? [String: Any] { store.save(data.compactMapValues { $0 as? String }) }
        case "zoom":
            applyZoom((message["value"] as? NSNumber)?.doubleValue ?? 1)
        case "media":
            let playing = (message["playing"] as? Bool) == true
            UIApplication.shared.isIdleTimerDisabled = playing
            mediaPlayingChanged(playing)
        case "log":
            print("[HOMER page] \(message["text"] as? String ?? "")")
        default:
            if !handle(message: message, type: type) { print("[HOMER] unknown message: \(type)") }
        }
    }

    /// The page has finished loading (a subclass may want to know).
    func pageDidLoad() {}

    /// The page started or stopped playing something.
    func mediaPlayingChanged(_ playing: Bool) {}

    /// A message this platform handles by itself (the tvOS keyboard, what's
    /// playing for a lock screen). True when it was dealt with.
    func handle(message: [String: Any], type: String) -> Bool { false }

    /// Saves the sign-in now (the app is going to the background).
    func saveSession() {
        UIApplication.shared.isIdleTimerDisabled = false
        web?.evaluate("window.__homerApp ? window.__homerApp.snapshot() : null") { [weak self] result in
            guard let self, let data = result as? [String: Any] else { return }
            self.store.save(data.compactMapValues { $0 as? String })
        }
    }

    // ---------- Zoom ----------

    /// Jellyfin's own pages are zoomed and sit in from the edges; HOMER's
    /// screens fill the screen at 1. (Only the Apple TV asks for this;
    /// Config.stockPageZoom is 1 elsewhere, so no message ever arrives.)
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
        web.evaluate("window.__homerApp && window.__homerApp.cssZoom(\(value))")
        print("[HOMER] zoom \(value)")
    }

    // ---------- The loading / error screen ----------

    var statusShown: Bool { !statusView.isHidden }

    func hideStatus() { statusView.isHidden = true }

    private func buildStatus() {
        statusView.backgroundColor = .black
        statusView.frame = view.bounds
        statusView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let big: CGFloat = traitCollection.userInterfaceIdiom == .tv ? 76 : 44
        statusTitle.font = .systemFont(ofSize: big, weight: .heavy)
        statusTitle.textColor = .white
        statusTitle.textAlignment = .center
        statusTitle.numberOfLines = 0
        statusText.font = .systemFont(ofSize: traitCollection.userInterfaceIdiom == .tv ? 30 : 17, weight: .regular)
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
            stack.widthAnchor.constraint(lessThanOrEqualTo: statusView.widthAnchor, multiplier: 0.8),
        ])
    }

    func showStatus(_ title: String, _ text: String) {
        statusTitle.text = title
        statusText.text = text
        statusView.isHidden = false
        view.bringSubviewToFront(statusView)
    }

    // ---------- Helpers ----------

    /// The view controller for this platform.
    static func make() -> HomerViewController {
        #if os(tvOS) || targetEnvironment(macCatalyst)
        return TVViewController() // Catalyst is the smoke test standing in for the TV
        #else
        return PhoneViewController()
        #endif
    }

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

    // ---------- Looking at the page (Debug builds) ----------

    #if DEBUG
    /// Launched with `-HomerProbe YES`: every 3 seconds, print what the page
    /// is doing (address, HOMER's layout, the first video's state) to the
    /// console. For the simulators, where there's no Web Inspector handy.
    static var probe: Bool { UserDefaults.standard.bool(forKey: "HomerProbe") }
    private var probeTimer: Timer?

    func startProbe() {
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
            const a = document.querySelector('audio');
            const L = window.HomerLayout;
            const r = v && v.getBoundingClientRect();
            return {
                href: location.href, title: document.title, size: innerWidth + 'x' + innerHeight,
                app: window.HOMER_APP || null, tvapp: window.HOMER_TVAPP === true,
                homerLoaded: !!window.__homerLoaded,
                layout: L ? { version: L.version, phone: L.isPhone(), touch: L.isTouch() } : null,
                htmlClass: document.documentElement.className,
                cssZoom: document.documentElement.style.zoom || 'none',
                doc: document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight,
                video: v ? {
                    paused: v.paused, time: Math.round(v.currentTime * 10) / 10, readyState: v.readyState,
                    size: v.videoWidth + 'x' + v.videoHeight, box: Math.round(r.width) + 'x' + Math.round(r.height),
                    fullscreen: !!(document.fullscreenElement || v.webkitDisplayingFullscreen)
                } : null,
                audio: a ? { paused: a.paused, time: Math.round(a.currentTime * 10) / 10, src: (a.currentSrc || '').slice(-40) } : null
            };
        })())
        """
    #endif
}
