import UIKit
import Darwin
import ObjectiveC

/// WebKit is on every Apple TV, but the tvOS SDK leaves it out: there's no
/// `import WebKit`, and no WebKit type can be named at compile time. So the
/// app loads the framework itself with dlopen, finds WKWebView and friends by
/// name, and calls them by selector.
///
/// This is the approach jvanakker/tvOSBrowser uses (BrowserWebView.m,
/// BrowserEnsureWebKitRuntimeLoaded and commonInitWithUserAgent:), written
/// again here in Swift. See apple-tv/README.md for the links.
enum WebKitRuntime {
    /// Where WebKit has lived on tvOS over the years; the first one that
    /// yields a WKWebView class wins.
    static let frameworkPaths = [
        "/System/Library/Frameworks/WebKit.framework/WebKit",
        "/System/Library/PrivateFrameworks/WebKit.framework/WebKit",
        "/System/Library/StagedFrameworks/Safari/WebKit.framework/WebKit",
    ]

    /// The path WebKit was loaded from, or nil when it couldn't be (then the
    /// app says so on screen instead of crashing).
    static let loadedFrom: String? = {
        if NSClassFromString("WKWebView") != nil { return "already loaded" }
        for path in frameworkPaths where dlopen(path, RTLD_NOW | RTLD_GLOBAL) != nil {
            if NSClassFromString("WKWebView") != nil { return path }
        }
        return nil
    }()

    static func objectClass(_ name: String) -> NSObject.Type? {
        NSClassFromString(name) as? NSObject.Type
    }

    /// WebKit's delegate protocols aren't in the SDK either, but they are
    /// registered with the Objective-C runtime once WebKit loads. Adding one
    /// to our delegate class makes conformsToProtocol: true, for any WebKit
    /// code that asks.
    static func adopt(_ protocolName: String, on cls: AnyClass) {
        if let proto = objc_getProtocol(protocolName) {
            class_addProtocol(cls, proto)
        }
    }

    /// Treat a WebKit object as `WebKitCalls`, so its methods can be called by
    /// selector. Every method there is optional, so a call on an object
    /// without it does nothing (Swift checks respondsToSelector: first).
    static func calls(_ object: AnyObject) -> WebKitCalls {
        unsafeBitCast(object, to: WebKitCalls.self)
    }

    /// WKWebView's -initWithFrame:configuration:, on the class found at runtime.
    static func makeWebView(frame: CGRect, configuration: AnyObject) -> UIView? {
        guard let cls = NSClassFromString("WKWebView") else { return nil }
        let maker = unsafeBitCast(cls, to: WebKitWebViewInit.Type.self)
        return maker.init(frame: frame, configuration: configuration) as? UIView
    }

    /// WKUserScript's -initWithSource:injectionTime:forMainFrameOnly:
    /// (injection time 0 is WKUserScriptInjectionTimeAtDocumentStart).
    static func makeUserScript(source: String, atDocumentStart: Bool, mainFrameOnly: Bool) -> AnyObject? {
        guard let cls = NSClassFromString("WKUserScript") else { return nil }
        let maker = unsafeBitCast(cls, to: WebKitUserScriptInit.Type.self)
        return maker.init(source: source, injectionTime: atDocumentStart ? 0 : 1, forMainFrameOnly: mainFrameOnly)
    }
}

// The WebKit methods the app uses, declared by selector. Nothing conforms to
// these protocols; they only tell Swift how to send each message (argument
// types, and memory rules for init). The wk_ prefix keeps them apart from
// UIKit's own names.

@objc protocol WebKitWebViewInit {
    @objc(initWithFrame:configuration:) init(frame: CGRect, configuration: AnyObject)
}

@objc protocol WebKitUserScriptInit {
    @objc(initWithSource:injectionTime:forMainFrameOnly:) init(source: String, injectionTime: Int, forMainFrameOnly: Bool)
}

@objc protocol WebKitCalls {
    // WKWebView
    @objc(loadRequest:) optional func wk_load(_ request: URLRequest) -> AnyObject?
    @objc(reload) optional func wk_reload() -> AnyObject?
    @objc(evaluateJavaScript:completionHandler:) optional func wk_evaluate(_ script: String, completionHandler: ((Any?, Error?) -> Void)?)
    @objc(setNavigationDelegate:) optional func wk_setNavigationDelegate(_ delegate: AnyObject?)
    @objc(setCustomUserAgent:) optional func wk_setCustomUserAgent(_ userAgent: String?)
    @objc(setInspectable:) optional func wk_setInspectable(_ on: Bool)
    @objc(scrollView) optional func wk_scrollView() -> UIScrollView?
    @objc(URL) optional func wk_url() -> URL?

    // WKWebViewConfiguration
    @objc(setAllowsInlineMediaPlayback:) optional func wk_setAllowsInlineMediaPlayback(_ on: Bool)
    @objc(setMediaTypesRequiringUserActionForPlayback:) optional func wk_setMediaTypesRequiringUserActionForPlayback(_ types: UInt)
    @objc(setAllowsAirPlayForMediaPlayback:) optional func wk_setAllowsAirPlayForMediaPlayback(_ on: Bool)
    @objc(setUserContentController:) optional func wk_setUserContentController(_ controller: AnyObject)
    @objc(preferences) optional func wk_preferences() -> AnyObject?

    // WKPreferences (public)
    @objc(setJavaScriptCanOpenWindowsAutomatically:) optional func wk_setJavaScriptCanOpenWindowsAutomatically(_ on: Bool)
    @objc(setElementFullscreenEnabled:) optional func wk_setElementFullscreenEnabled(_ on: Bool)
    // WKPreferences (private; tvOSBrowser turns these on for web video)
    @objc(_setMediaSourceEnabled:) optional func wk_setMediaSourceEnabled(_ on: Bool)
    @objc(_setManagedMediaSourceEnabled:) optional func wk_setManagedMediaSourceEnabled(_ on: Bool)
    @objc(_setMediaCapabilityGrantsEnabled:) optional func wk_setMediaCapabilityGrantsEnabled(_ on: Bool)

    // WKUserContentController
    @objc(addUserScript:) optional func wk_addUserScript(_ script: AnyObject)
    @objc(addScriptMessageHandler:name:) optional func wk_addScriptMessageHandler(_ handler: AnyObject, name: String)
    @objc(removeScriptMessageHandlerForName:) optional func wk_removeScriptMessageHandler(forName name: String)

    // WKScriptMessage
    @objc(body) optional func wk_body() -> Any?
}
