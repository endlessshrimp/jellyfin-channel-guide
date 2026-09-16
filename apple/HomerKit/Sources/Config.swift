import CoreGraphics
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Everything you might want to change, in one place. What differs between
/// the Apple TV and a phone or iPad is marked per platform.
enum Config {
    /// The page the app opens: HOMER, through Jellyfin Web. The full
    /// index.html address, not bare /web/ (that can come from a cache from
    /// before the JavaScript Injector).
    static let defaultURL = URL(string: "http://192.168.68.100:8096/web/index.html#/home")!

    /// To open a different page without editing this file: in Xcode, Product →
    /// Scheme → Edit Scheme… → Run → Arguments, add `-HomerURL http://…`.
    static var homeURL: URL {
        if let s = UserDefaults.standard.string(forKey: "HomerURL"), let url = URL(string: s) { return url }
        return defaultURL
    }

    /// What the page is told it's running in: HOMER reads
    /// window.HOMER_APP.platform.
    ///
    /// Mac Catalyst only happens in Tools/catalyst-smoke.sh, which runs the
    /// Apple TV's code on the Mac, so it counts as tvOS here and below.
    static var platform: String {
        #if os(tvOS) || targetEnvironment(macCatalyst)
        return "tvos"
        #else
        return UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #endif
    }

    /// The app's version, for window.HOMER_APP.version.
    static var version: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
    }

    #if os(tvOS) || targetEnvironment(macCatalyst)

    /// Jellyfin decides it's on a TV when its user agent contains "tv"
    /// anywhere ("Apple TV" qualifies), and then switches to its own TV
    /// layout, which HOMER isn't built on. So the app says it's desktop
    /// Safari, what HOMER is used in every day. No "tv" anywhere in here.
    /// (A phone or iPad keeps WebKit's own user agent: HOMER's phone layouts
    /// want to look like what they are.)
    static let userAgent: String? =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

    /// The remote drives the page: it never gets touches of its own.
    static let interactiveWebView = false

    /// Jellyfin's own pages (sign-in, the dashboard, anything HOMER doesn't
    /// draw) are small from ten feet away, so they're zoomed. HOMER's screens
    /// size themselves to the TV and stay at 1. A phone or iPad is held close
    /// enough not to need it (1 turns it off).
    static let stockPageZoom = 1.5

    /// A zoomed page also sits in from the edges this far, clear of a TV's
    /// overscan.
    static let stockPageInset: CGFloat = 24

    /// Picture in picture and background audio are iOS's.
    static let pictureInPicture = false
    static let backgroundAudio = false

    #else

    static let userAgent: String? = nil
    static let interactiveWebView = true
    static let stockPageZoom = 1.0
    static let stockPageInset: CGFloat = 0
    static let pictureInPicture = true
    static let backgroundAudio = true

    #endif

    /// The key Play/Pause sends (Apple TV). Space is what Jellyfin's
    /// full-screen player pauses on. (Jellyfin ignores "MediaPlayPause" from a
    /// desktop browser, and sending both would pause and unpause.)
    static let playPauseKey = " "

    /// Hold Back this long to send "h" (Home) instead of Escape.
    static let backHoldSeconds: TimeInterval = 0.6

    /// Hold OK this long for HOMER's menu (a homer-app event) instead of Enter.
    static let selectHoldSeconds: TimeInterval = 0.6

    /// Holding an arrow repeats it, like a keyboard.
    static let repeatDelay: TimeInterval = 0.42
    static let repeatInterval: TimeInterval = 0.11

    /// If HOMER can't be reached, try again this often.
    static let retrySeconds: TimeInterval = 10
}
