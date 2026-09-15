# HOMER on the Apple TV

Research from 2026-09-15. The Option A test app is in [apple-tv/](../apple-tv/README.md): how to install it, and the pass/fail checklist.

## The short version

tvOS still has no public web view, so every way of putting HOMER on the Apple TV is one of two things:
- a sideloaded app that uses Apple's hidden copy of WebKit to run HOMER as it is;
- a rewrite of the screens (Plex, Swiftfin and Channels all took this route).

**Recommendation:** first try the hidden-WebKit wrapper as a 1–2 day pass/fail test. It costs nothing. If inline video fails, the fallback and long-term option is a native SwiftUI app.

## What we know

- **The Mac** is a MacBook Air M4 on macOS 26.6. Xcode isn't installed; only the Command Line Tools are, which have no tvOS SDK. Xcode 27 runs on this Mac. tvOS 27 shipped Sep 14, so if the Apple TVs have updated, installing onto them needs Xcode 27.
- **WebKit is present on the Apple TV, just not public.** [tvOSBrowser](https://github.com/jvanakker/tvOSBrowser) loads it at runtime (WKWebView). An open pull request ([#68](https://github.com/jvanakker/tvOSBrowser/pull/68)) reports it running on tvOS 27. Expect about one fix like that per yearly tvOS release.
- **Unknown: does video play inline in that web view?** HOMER needs Jellyfin's own video element playing docked.
  - For: people have watched in-page video there for years.
  - Against: the author stopped rendering full-screen web video and now hands it to Apple's player ([#62](https://github.com/jvanakker/tvOSBrowser/issues/62)).
  - Only a test on a TV answers this.
- **Other snags in the wrapper:**
  - Home Assistant's login button can't be pressed ([#65](https://github.com/jvanakker/tvOSBrowser/issues/65)); a long-lived HA token avoids the login page.
  - tvOS guarantees only 500 KB of permanent storage, so the wrapper has to save HOMER's sign-in itself.
  - Search needs the tvOS keyboard passed through.
  - The remote maps easily to key presses.
- **Dead ends:**
  - TVML: deprecated in tvOS 18, templates only.
  - Flutter tvOS: a 44-star fork from April 2026.
  - AirPlay from a Mac: laggy and re-compressed, and the remote can't drive it.
- **Swiftfin**, the official native Jellyfin app, has been on the tvOS App Store since July 2026. A grid guide landed Aug 28 and isn't in a release yet. It's a free stopgap today, but it doesn't look like HOMER.

## Options

Effort figures are estimates.

| Option | Reuses HOMER | Effort | Cost | Biggest risk |
|---|---|---|---|---|
| **A. Hidden-WebKit wrapper** | All of it; web updates need no reinstall | Test 1–2 days, finished 3–5 | $0 (re-sign weekly) or $99/yr | Docked video may not play; private API Apple could break |
| **B. Native SwiftUI rewrite** | Design and data flows only | Core screens 3–5 weeks part-time; everything 6–10 | $99/yr (TestFlight) | Every feature built twice |
| C. Fork Swiftfin | Same as B | 4–8+ weeks | $99 | Merging with a fast upstream |
| D. React Native (Plex's approach) | About 10% (logic files) | 4–8 weeks | $99 | Frame drops (Streamyfin's open bug); heavy toolchain |
| H. N100 kiosk box (docs/tv-box.md) | All of it | 1–2 days | $150–250 | It's not the Apple TV; PCM audio only |

On installing:
- A free Apple ID's installs expire after 7 days. [atvloadly](https://github.com/bitxeno/atvloadly) can re-sign automatically from a Linux host; the NAS is unproven for this, since it needs avahi.
- $99 a year makes installs last a year, and TestFlight builds last 90 days. TestFlight doesn't suit the private-API wrapper.

## The test (Option A)

1. Install Xcode 27 from the App Store. Pair an Apple TV (Settings → Remotes and Devices → Remote App and Devices) and sign in with a free Apple ID.
2. Build a small wrapper:
   - load the hidden WKWebView the way tvOSBrowser does, with inline video and autoplay on and plain http allowed on the LAN;
   - open `http://192.168.68.100:8096/web/index.html#/home` with no browser chrome;
   - map the remote: clickpad to arrows, click to Enter, Back to Esc, Play/Pause to Space, long-press Back to H;
   - add a "tvapp" flag to HOMER (as in docs/tv-box.md) to hide the cursor and never switch to phone layouts.
3. **Pass** means all four of these work:
   - live TV plays docked, then full screen, then docked again, and Back works;
   - a movie plays;
   - an HA camera plays;
   - you're still signed in after quitting and after a reboot.

   On a pass, add saved sign-in and the native keyboard, then move to the $99 account. On a fail, start B with the same slice: sign-in, then the Guide with the docked player, then full screen. Build B fresh on [jellyfin-sdk-swift](https://github.com/jellyfin/jellyfin-sdk-swift), using Swiftfin (MPL-2.0) as a reference.

## Sources

- [WKWebView platforms](https://developer.apple.com/documentation/webkit/wkwebview)
- [TVML deprecation](https://developer.apple.com/documentation/tvmljs)
- [Xcode requirements](https://developer.apple.com/xcode/system-requirements/)
- [Swiftfin](https://github.com/jellyfin/Swiftfin) ([guide PR #2141](https://github.com/jellyfin/Swiftfin/pull/2141))
- [Plex on React Native](https://www.lowpass.cc/p/plex-apple-tv-app-relaunch-tvos-react-native)
- [Streamyfin #1902](https://github.com/streamyfin/streamyfin/issues/1902)
- [Apple membership comparison](https://developer.apple.com/support/compare-memberships/)
