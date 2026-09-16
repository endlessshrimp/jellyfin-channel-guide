# HOMER on the Apple TV (the test app)

A small tvOS app that opens HOMER full screen on the Apple TV, with the Siri
Remote working it like a keyboard. It's the pass/fail test from
[docs/apple-tv.md](../docs/apple-tv.md) (Option A): does HOMER, as it is, work
in the web view Apple hides on the Apple TV?

It opens `http://192.168.68.100:8096/web/index.html#/home`. To change that,
edit `defaultURL` in [HOMER/Sources/Config.swift](HOMER/Sources/Config.swift).

## Install it on the TV

You need Xcode 27 (Apple TVs on tvOS 27 need it) and the Apple TV on the same
network as the Mac. A free Apple ID is enough.

1. **Xcode and the tvOS platform.** Install Xcode from the App Store and open
   it once. If it asks which platforms you want, tick **tvOS**. To check later:
   Xcode → Settings → Components; tvOS should say Installed. If it doesn't,
   click **Get**.
2. **Your Apple ID.** Xcode → Settings → Accounts → **+** → Apple Account, and
   sign in. You get a "(Personal Team)" under your name.
3. **Pair the Apple TV.**
   - On the TV: Settings → Remotes and Devices → **Remote App and Devices**.
     Stay on that screen.
   - On the Mac: Xcode → Window → **Devices and Simulators**. The Apple TV
     shows up on the left under Discovered. Click it, click **Pair**, and type
     the code the TV shows.
   - If the TV asks you to turn on Developer Mode, do it and let it restart.
     (I haven't confirmed that tvOS asks.)
4. **Make the Xcode project.** In Terminal:
   ```sh
   cd ~/Projects/jellyfin-channel-guide/.claude/worktrees/apple-tv/apple-tv
   xcodegen generate
   open HOMER.xcodeproj
   ```
   XcodeGen is already installed (`brew install xcodegen` if it isn't).
5. **Pick your team.** In Xcode's left sidebar, click **HOMER** (the blue icon
   at the top), then the **HOMER** target → **Signing & Capabilities** →
   **Team** → "Your Name (Personal Team)". Running `xcodegen generate` again
   clears the team, so pick it again after that. Leave the bundle identifier
   (`org.nelsons.homer.appletv3`) alone: it's the one already on the TV, and a
   different one is a different app, with no saved sign-in.
6. **Run it.** At the top of the Xcode window, click the run destination
   (next to "HOMER") and pick your Apple TV. Press **▶** (⌘R). The first time
   takes a minute or two while Xcode prepares the TV.
   - If Xcode says the app couldn't open because the developer isn't
     trusted, look on the TV under Settings → General for a device
     management or profiles entry and trust your Apple ID there. (That's
     how it works on an iPhone. I haven't confirmed the tvOS menu path.)
   - If the TV asks whether HOMER may find devices on your local network,
     choose **Allow**. Without that it may not be able to reach the NAS. (My
     guess: tvOS may not ask at all.)

HOMER then shows up on the TV's Home Screen like any app, with a plain icon.

**Every 7 days** (free Apple ID): the app stops opening. Open the project and
press ▶ again with the TV on. Your sign-in should still be there.

## Using it

| Remote | Does |
|---|---|
| Clickpad ▲▼◀▶ | Arrow keys. Holding repeats. |
| Click the clickpad | OK (Enter), when you let go |
| **Hold OK** (about ½ a second) | HOMER's menu, for the letter shortcuts a remote can't type |
| **Swipe up / down** | HOMER's swipe-up / swipe-down |
| Swipe left / right | ◀ ▶ |
| Back | Back (Esc). Never quits the app while HOMER is showing. |
| Hold Back | Home (H) |
| Play/Pause | Space: pauses and plays in the full-screen player |
| TV button | Leaves the app, like any app |

Holding OK and swiping up or down reach HOMER as
`window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action } }))`,
with `action` of `menu`, `swipe-up` or `swipe-down`. HOMER's own side decides
what they do.

**The first time** you get Jellyfin's sign-in page, and the tvOS keyboard
comes up for the user name by itself. Type it (or hold the mic button and say
it), then choose **Done**: that moves you to the password box and the keyboard
comes back. After the password, Done puts you on **Sign In**: click. On pages
like this, where no HOMER screen is up, the arrows move between boxes and
buttons.

Any text box works the same way (Search, the ZIP and Home Assistant address in
Settings): the keyboard comes up, and Done types the text in and presses Enter.
If the keyboard went away, click the box again.

**Jellyfin's own pages are zoomed** to 1.5× (`Config.stockPageZoom`), since
they're built for a desk, not a couch, and they sit in a little from the edges
so nothing lands in a TV's overscan. HOMER's own screens size themselves to the
TV, so they stay at 1×; the app switches between the two as screens come and
go. The zoom is CSS (`html { zoom }`), not WebKit's page zoom: on tvOS that one
magnifies a page that's already laid out, so Jellyfin's sign-in lost its
right-hand side.

## The pass/fail test

From docs/apple-tv.md. **Pass means all four work:**

- [ ] **Live TV** plays docked (in the Guide's window), then full screen, then
      docked again, and Back works.
- [ ] **A movie** plays.
- [ ] **A Home Assistant camera** plays (Rooms).
- [ ] You're **still signed in** after quitting the app (TV button twice,
      swipe HOMER's card up) and after restarting the TV (Settings → System →
      Restart).

Also worth noting:

- Search: the keyboard comes up, and the results match what you typed.
- Hold Back goes Home. Play/Pause pauses the full-screen player.
- Home Assistant's sign-in page can be hard to use with a remote (docs/apple-tv.md). If it won't
  work, a long-lived Home Assistant token gets around it.

**When something fails:** keep the TV running from Xcode. Lines starting
`[HOMER]` in Xcode's console (bottom pane) are from the app, and
`[HOMER page]` lines are the page's own errors. Safari on the Mac may also
list the Apple TV under Develop for the Web Inspector, but I don't know
whether it does for tvOS.

## What's tested so far

- **On Jason's bedroom Apple TV:** HOMER loads, signing in with the tvOS
  keyboard works, and the sign-in is still there next time. The rest of the
  checklist above is still to do.
- **tvOS Simulator (tvOS 27, Xcode 27):** the app builds (for the Simulator
  and, unsigned, for a real Apple TV) with no warnings. On the Simulator:
  - It loads WebKit and opens HOMER's sign-in page full screen, with
    Jellyfin's desktop layout and HOMER's TV layout.
  - The tvOS keyboard comes up for the user name.
  - A test video (a local MP4, not Jellyfin) autoplayed with sound inside the
    page at 960×540 and never went full screen.
  - The sign-in page zooms to 1.5× and lays out again at that size, with
    nothing cut off.
- **On the Mac** (`Tools/catalyst-smoke.sh`, 23 checks): the same code built
  for the Mac.
  - Every remote button arrives in a page as the right key (key, code,
    keyCode, repeat), and the keyboard's text lands in the box.
  - Holding OK sends HOMER's menu and no Enter; a tap still sends Enter;
    swiping up and down sends HOMER's swipes and sideways stays an arrow.
  - A page with a HOMER screen is never zoomed, a plain one is.
  - The sign-in is saved and comes back after the web view's storage is wiped.
  - On a plain sign-in form, the arrows, Done and OK work.
- **Only the TV can answer these:**
  - Does real video (Jellyfin's live TV, a movie, a camera) play docked?
  - Do swipes on the clickpad reach the app? (Presses do: Jason signed in
    with them. Swipes come from UIKit gestures, which the Mac and the
    Simulator can't stand in for.)
  - Does the Keychain keep the sign-in through a reboot and a 7-day
    re-install?

## How it works

tvOS has WebKit on every Apple TV, but the SDK leaves it out, so there's no
`import WebKit`. The app does what
[tvOSBrowser](https://github.com/jvanakker/tvOSBrowser) does:

- **Loads WebKit at runtime:** `dlopen` on
  `/System/Library/Frameworks/WebKit.framework/WebKit`, with two older paths
  as fallbacks.
- **Finds the classes by name:** `WKWebView`, `WKWebViewConfiguration`,
  `WKUserContentController`, `WKUserScript`.
- **Calls them by selector:** `initWithFrame:configuration:`,
  `setAllowsInlineMediaPlayback:`, `evaluateJavaScript:completionHandler:`
  and so on. Its delegate object answers WebKit's delegate selectors without
  the SDK's protocols.
- **Is based on these tvOSBrowser files** (read from GitHub, 2026-09-15):
  - [`BrowserWebView.m`](https://github.com/jvanakker/tvOSBrowser/blob/master/_Project/Browser/BrowserWebView.m):
    `BrowserEnsureWebKitRuntimeLoaded` (the dlopen paths),
    `commonInitWithUserAgent:allowsInlineMediaPlayback:` (building the
    configuration and web view by name), `BrowserConfigurePrivateMediaPreferences`
    (the private media preferences), and `BrowserInstallYouTubeCaptureUserScript`
    (adding a user script through the runtime).
  - [`BrowserWKWebViewProofOfConceptViewController.m`](https://github.com/jvanakker/tvOSBrowser/blob/master/_Project/Browser/BrowserWKWebViewProofOfConceptViewController.m):
    the smallest version of the same thing, and taking Menu presses in
    `pressesEnded:`.
  - [`BrowserPageActionCoordinator.m`](https://github.com/jvanakker/tvOSBrowser/blob/master/_Project/Browser/BrowserPageActionCoordinator.m):
    the keyboard as an alert with a text field that becomes first responder
    right away.
  - [`AppDelegate.m`](https://github.com/jvanakker/tvOSBrowser/blob/master/_Project/Browser/AppDelegate.m):
    keeping the session in `NSUserDefaults` because tvOS clears web storage.
  - [PR #68](https://github.com/jvanakker/tvOSBrowser/pull/68) (open, by
    KJRRR, tested on tvOS 27): apps built with the tvOS 26 SDK or later exit
    at launch with no crash log unless Info.plist has a
    `UIApplicationSceneManifest`. The app-level background callbacks stop
    firing, so saving moves to the scene delegate. This app is scene-based
    from the start.
- **Licensing:** tvOSBrowser has no license file, so nothing is copied from it.
  This is the same approach, written again in Swift.

Where this app differs from tvOSBrowser:

- **No cursor.** The web view never takes touches or presses. Every button
  press becomes a key event dispatched in the page (`__homerTvApp.key`), since
  HOMER is built for arrows, OK and Esc.
- **Desktop Safari's user agent.** Jellyfin decides it's on a TV if its user
  agent contains "tv" anywhere ("Apple TV" does), and then switches to its own
  TV layout. The page script also sets `navigator.maxTouchPoints` to 0
  (Jellyfin reads more than 1 on a Mac as an iPad) and answers
  `(hover: none)` as a desktop would.
- **The sign-in, not cookies.** Jellyfin keeps its sign-in in localStorage. The
  app copies `jellyfin_credentials`, `_deviceId2` and HOMER's `homer-*`
  settings (under 96 KB) to the Keychain, and puts them back at document start
  before Jellyfin reads them.

On the HOMER side (this branch), `shared/layout.js` reads
`window.HOMER_TVAPP`: never a phone layout, never touch, and `html.homer-tvapp`
hides the cursor (`shared/shell.css`). The live v0.4.1 doesn't have that yet.
The app's page script covers the touch part until it ships.

### Files

| File | What it is |
|---|---|
| `project.yml` | XcodeGen spec (tvOS 26+, Swift). `HOMER.xcodeproj` is made from it and not committed. |
| `HOMER/Info.plist` | Scene manifest, http allowed (web content, media, LAN), local network text |
| `HOMER/Sources/Config.swift` | The address, user agent, Play/Pause key, timings |
| `HOMER/Sources/WebKitRuntime.swift` | dlopen, and the WebKit selectors the app calls |
| `HOMER/Sources/HomerWebView.swift` | The web view: autoplay, inline video, the page script, messages back |
| `HOMER/Sources/HomerViewController.swift` | The screen: presses, loading/error screen, keyboard, saving |
| `HOMER/Sources/RemoteKeys.swift` | Siri Remote → keys (repeat, hold Back for H, hold OK and swipes for HOMER) |
| `HOMER/Sources/TextEntry.swift` | The tvOS keyboard for a text box |
| `HOMER/Sources/SessionStore.swift` | The sign-in copy in the Keychain (UserDefaults if that fails) |
| `HOMER/Sources/AppDelegate.swift` | App and scene delegates |
| `HOMER/Resources/homer-tvapp.js` | The page side: the flag, keys, the homer-tv events, keyboard, saving, zoom and focus on plain pages |
| `Tools/catalyst-smoke.sh` | Runs the app's code on the Mac against `Tools/smoke/index.html` |

### Checking it without the TV

```sh
# the Swift sources and the page script
node --check HOMER/Resources/homer-tvapp.js
xcodegen generate
xcodebuild -project HOMER.xcodeproj -scheme HOMER -sdk appletvsimulator CODE_SIGNING_ALLOWED=NO build

# the app's code on the Mac, 23 checks (a small window opens for ~40 s)
Tools/catalyst-smoke.sh
```

Debug builds take two launch arguments (Edit Scheme… → Run → Arguments):

- `-HomerProbe YES` prints the page's address, HOMER's layout and the first
  video's state every 3 seconds.
- `-HomerSelfTest YES` presses a few buttons by itself.

`-HomerURL <address>` opens another page (Debug or Release).

If a tvOS update breaks it, the app shows "This Apple TV won't open a web
view" instead of crashing. Check tvOSBrowser's issues and pull requests for
that year's fix.
