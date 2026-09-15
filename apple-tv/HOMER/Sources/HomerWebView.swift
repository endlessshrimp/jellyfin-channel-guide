import UIKit

@MainActor
protocol HomerWebViewDelegate: AnyObject {
    func homerWebViewDidFinishLoad(_ web: HomerWebView)
    func homerWebView(_ web: HomerWebView, didFailWith error: Error)
    func homerWebView(_ web: HomerWebView, received message: [String: Any])
    func homerWebViewContentProcessDidTerminate(_ web: HomerWebView)
}

/// The one full-screen WKWebView, set up for HOMER: inline video that starts
/// without a tap, no scrolling or browser chrome, the page-side bridge
/// (homer-tvapp.js) injected at document start, and a message channel back
/// to the app ("homer").
@MainActor
final class HomerWebView: NSObject {
    let view: UIView
    weak var delegate: HomerWebViewDelegate?
    private let contentController: AnyObject
    private let proxy: WebKitDelegateProxy

    /// nil when WebKit can't be loaded or a WKWebView can't be made.
    /// `bootScript` runs first, then the bridge.
    init?(bootScript: String, frame: CGRect) {
        guard WebKitRuntime.loadedFrom != nil,
              let configClass = WebKitRuntime.objectClass("WKWebViewConfiguration"),
              let controllerClass = WebKitRuntime.objectClass("WKUserContentController")
        else { return nil }

        let config = configClass.init()
        let c = WebKitRuntime.calls(config)
        c.wk_setAllowsInlineMediaPlayback?(true)
        c.wk_setMediaTypesRequiringUserActionForPlayback?(0) // WKAudiovisualMediaTypeNone: autoplay, sound and all
        c.wk_setAllowsAirPlayForMediaPlayback?(true)

        if let prefs = c.wk_preferences?() {
            let p = WebKitRuntime.calls(prefs)
            p.wk_setJavaScriptCanOpenWindowsAutomatically?(false)
            p.wk_setElementFullscreenEnabled?(true)
            p.wk_setMediaSourceEnabled?(true)
            p.wk_setManagedMediaSourceEnabled?(true)
            p.wk_setMediaCapabilityGrantsEnabled?(true)
        }

        let controller = controllerClass.init()
        let proxy = WebKitDelegateProxy()
        let cc = WebKitRuntime.calls(controller)
        let bridge = HomerWebView.bridgeSource()
        if let script = WebKitRuntime.makeUserScript(source: bootScript + "\n" + bridge, atDocumentStart: true, mainFrameOnly: true) {
            cc.wk_addUserScript?(script)
        }
        cc.wk_addScriptMessageHandler?(proxy, name: "homer")
        c.wk_setUserContentController?(controller)

        guard let webView = WebKitRuntime.makeWebView(frame: frame, configuration: config) else { return nil }

        self.view = webView
        self.contentController = controller
        self.proxy = proxy
        super.init()
        proxy.owner = self

        let w = WebKitRuntime.calls(webView)
        w.wk_setNavigationDelegate?(proxy)
        w.wk_setCustomUserAgent?(Config.userAgent)
        w.wk_setInspectable?(true) // Safari's Develop menu, if it lists the Apple TV

        webView.backgroundColor = .black
        webView.isOpaque = true
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // The remote never touches the page directly: every press becomes a
        // key event (RemoteKeys). This also keeps WebKit's own tvOS focus
        // and scrolling out of the way.
        webView.isUserInteractionEnabled = false
        if let scroll = w.wk_scrollView?() {
            scroll.isScrollEnabled = false
            scroll.contentInsetAdjustmentBehavior = .never
            scroll.backgroundColor = .black
        }
    }

    deinit {
        WebKitRuntime.calls(contentController).wk_removeScriptMessageHandler?(forName: "homer")
    }

    func load(_ url: URL) {
        _ = WebKitRuntime.calls(view).wk_load?(URLRequest(url: url))
    }

    func reload() {
        _ = WebKitRuntime.calls(view).wk_reload?()
    }

    var currentURL: URL? { WebKitRuntime.calls(view).wk_url?() ?? nil }

    /// Runs `script` in the page; `done` gets its result (nil on error).
    func evaluate(_ script: String, done: ((Any?) -> Void)? = nil) {
        let calls = WebKitRuntime.calls(view)
        guard calls.wk_evaluate != nil else { done?(nil); return }
        calls.wk_evaluate?(script) { result, error in
            if let error { print("[HOMER] script error:", error.localizedDescription) }
            done?(error == nil ? result : nil)
        }
    }

    /// homer-tvapp.js from the app bundle.
    private static func bridgeSource() -> String {
        guard let url = Bundle.main.url(forResource: "homer-tvapp", withExtension: "js"),
              let js = try? String(contentsOf: url, encoding: .utf8)
        else {
            print("[HOMER] homer-tvapp.js is missing from the app bundle")
            return "window.HOMER_TVAPP = true;"
        }
        return js
    }

    fileprivate func received(_ body: Any?) {
        if let message = body as? [String: Any] { delegate?.homerWebView(self, received: message) }
    }
    fileprivate func finished() { delegate?.homerWebViewDidFinishLoad(self) }
    fileprivate func failed(_ error: Error) { delegate?.homerWebView(self, didFailWith: error) }
    fileprivate func contentProcessDied() { delegate?.homerWebViewContentProcessDidTerminate(self) }
}

/// WebKit's navigation delegate and script message handler. WebKit holds
/// its message handlers strongly, so this small object sits between it and
/// HomerWebView (held weakly) to avoid a retain cycle. The @objc names are
/// WebKit's selectors (WKNavigationDelegate, WKScriptMessageHandler).
@MainActor
final class WebKitDelegateProxy: NSObject {
    weak var owner: HomerWebView?

    override init() {
        super.init()
        _ = WebKitDelegateProxy.adoptOnce
    }

    private static let adoptOnce: Void = {
        WebKitRuntime.adopt("WKNavigationDelegate", on: WebKitDelegateProxy.self)
        WebKitRuntime.adopt("WKScriptMessageHandler", on: WebKitDelegateProxy.self)
    }()

    @objc(userContentController:didReceiveScriptMessage:)
    func userContentController(_ controller: AnyObject, didReceive message: AnyObject) {
        owner?.received(WebKitRuntime.calls(message).wk_body?() ?? nil)
    }

    @objc(webView:didFinishNavigation:)
    func webView(_ webView: AnyObject, didFinish navigation: AnyObject?) {
        owner?.finished()
    }

    @objc(webView:didFailNavigation:withError:)
    func webView(_ webView: AnyObject, didFail navigation: AnyObject?, withError error: NSError) {
        if !Self.ignorable(error) { owner?.failed(error) }
    }

    @objc(webView:didFailProvisionalNavigation:withError:)
    func webView(_ webView: AnyObject, didFailProvisional navigation: AnyObject?, withError error: NSError) {
        if !Self.ignorable(error) { owner?.failed(error) }
    }

    @objc(webViewWebContentProcessDidTerminate:)
    func webViewWebContentProcessDidTerminate(_ webView: AnyObject) {
        owner?.contentProcessDied()
    }

    /// A load cut short by another load (-999), or WebKit's "frame load
    /// interrupted" (102) when a download or redirect takes over.
    private static func ignorable(_ error: NSError) -> Bool {
        (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
            || (error.domain == "WebKitErrorDomain" && error.code == 102)
    }
}
