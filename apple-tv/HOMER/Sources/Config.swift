import Foundation

/// Everything you might want to change, in one place.
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

    /// Jellyfin decides it's on a TV when its user agent contains "tv"
    /// anywhere ("Apple TV" qualifies), and then switches to its own TV
    /// layout, which HOMER isn't built on. So the app says it's desktop
    /// Safari, what HOMER is used in every day. No "tv" anywhere in here.
    static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

    /// The key Play/Pause sends. Space is what Jellyfin's full-screen player
    /// pauses on. (Jellyfin ignores "MediaPlayPause" from a desktop browser,
    /// and sending both would pause and unpause.)
    static let playPauseKey = " "

    /// Hold Back this long to send "h" (Home) instead of Escape.
    static let backHoldSeconds: TimeInterval = 0.6

    /// Holding an arrow repeats it, like a keyboard.
    static let repeatDelay: TimeInterval = 0.42
    static let repeatInterval: TimeInterval = 0.11

    /// If HOMER can't be reached, try again this often.
    static let retrySeconds: TimeInterval = 10
}
