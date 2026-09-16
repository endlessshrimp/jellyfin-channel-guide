# HOMER on the Apple TV, the iPhone and the iPad

One Xcode project, two apps, the same HOMER: a full-screen web view with no
browser chrome, the sign-in kept for it, and whatever else the platform needs.

| App | Runs on | HOMER draws | Driven by |
|---|---|---|---|
| **HOMER-tvOS** | Apple TV (tvOS 26+) | the TV layout, Large guide | the Siri Remote, as key presses |
| **HOMER-iOS** | iPhone (iOS 18+) | HOMER's phone layouts | touch |
| **HOMER-iOS** | iPad | the TV layout, with touch | touch |

Both open `http://192.168.68.100:8096/web/index.html#/home`. To change that,
edit `defaultURL` in [HomerKit/Sources/Config.swift](HomerKit/Sources/Config.swift).

The Apple TV app began as the pass/fail test from
[docs/apple-tv.md](../docs/apple-tv.md) (Option A): does HOMER, as it is, work
in the web view Apple hides on the Apple TV? It does.

## Install it on the Apple TV

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
   cd ~/Projects/jellyfin-channel-guide/.claude/worktrees/ios/apple
   xcodegen generate
   open HOMER.xcodeproj
   ```
   XcodeGen is already installed (`brew install xcodegen` if it isn't).
5. **Check the team.** `project.yml` already carries your personal team, so
   Xcode should show it under the **HOMER-tvOS** target → **Signing &
   Capabilities** → **Team**. Leave the bundle identifier
   (`org.nelsons.homer.appletv3`) alone: it's the one already on the TV, and a
   different one is a different app, with no saved sign-in.
6. **Run it.** At the top of the Xcode window, pick the **HOMER-tvOS** scheme
   and your Apple TV as the destination. Press **▶** (⌘R). The first time
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

## Install it on the iPhone and the iPad

Same project, the **HOMER-iOS** scheme. The app is one app for both
(`org.nelsons.homer.ios`).

1. Plug the iPhone into the Mac with a cable (or pair it over Wi-Fi in Xcode →
   Window → Devices and Simulators). Unlock it and tap **Trust** if it asks.
2. In Xcode, pick the **HOMER-iOS** scheme, then the iPhone as the
   destination, and press **▶**.
3. The first run, the phone says the developer isn't trusted: on the phone,
   **Settings → General → VPN & Device Management**, tap your Apple ID, then
   **Trust**. Press ▶ again.
4. The same for the iPad.
5. HOMER asks to find devices on the local network the first time it opens.
   Choose **Allow**, or it can't reach the NAS.

With a free Apple ID these stop opening after 7 days as well; press ▶ again.
With the paid account (once it's through) they last a year, and TestFlight
becomes an option.

**On the phone** HOMER draws its phone layouts (`docs/phone.md`), and the page
takes taps and swipes itself: no key mapping, no page zoom. **On the iPad**
HOMER draws the TV layout with touch, so it looks like the TV and works like a
tablet.

Music keeps playing when the screen locks or you leave the app, and the lock
screen shows what's playing with play/pause, skip and scrub. A video can pop
out into picture in picture from the player's own control.

## Using it on the Apple TV

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
`window.dispatchEvent(new CustomEvent('homer-app', { detail: { action } }))`,
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
- **iPhone and iPad Simulators (iOS 27):** the app opens HOMER full screen and
  says which platform it is. On the iPhone, HOMER draws its phone layout
  (`homer-phone homer-touch`) and Jellyfin its mobile one, with no zoom; on
  the iPad, HOMER's TV layout with touch (`homer-touch`, no `homer-phone`).
  The sign-in is saved, and after the web view's storage is wiped the app puts
  it back before the page loads. The now-playing bridge reaches the app
  (title, artist, position).
- **tvOS Simulator (tvOS 27, Xcode 27):** the app builds (for the Simulator
  and, unsigned, for a real Apple TV) with no warnings. On the Simulator:
  - It loads WebKit and opens HOMER's sign-in page full screen, with
    Jellyfin's desktop layout and HOMER's TV layout.
  - The tvOS keyboard comes up for the user name.
  - A test video (a local MP4, not Jellyfin) autoplayed with sound inside the
    page at 960×540 and never went full screen.
  - The sign-in page zooms to 1.5× and lays out again at that size, with
    nothing cut off.
- **On the Mac** (`Tools/catalyst-smoke.sh`, 25 checks): the Apple TV's code
  built for the Mac.
  - Every remote button arrives in a page as the right key (key, code,
    keyCode, repeat), and the keyboard's text lands in the box.
  - Holding OK sends HOMER's menu and no Enter; a tap still sends Enter;
    swiping up and down sends HOMER's swipes and sideways stays an arrow.
  - A page with a HOMER screen is never zoomed, a plain one is.
  - The sign-in is saved and comes back after the web view's storage is wiped.
  - On a plain sign-in form, the arrows, Done and OK work.
- **Only a real device can answer these:**
  - Does real video (Jellyfin's live TV, a movie, a camera) play docked?
  - Does music keep playing on the iPhone with the screen locked, and do the
    lock screen's buttons work? The plumbing is in (the audio background mode,
    a `.playback` session held while something plays, and WebKit's own log
    saying `category = MediaPlayback, policy = LongFormAudio`), but this Mac's
    Simulators stopped playing any media part-way through the day — audio and
    video both stall with `AddRunningClient failed (-66681)` from CoreAudio,
    which is the Mac, not the app. (Earlier in the day the same tvOS build
    played a test video in the Simulator.)
  - Does picture in picture pop out of the page?
  - Do swipes on the clickpad reach the Apple TV app? (Presses do: Jason
    signed in with them. Swipes come from UIKit gestures, which the Mac and
    the Simulators can't stand in for.)
  - Does the Keychain keep the sign-in through a reboot and a 7-day
    re-install? (In the Simulators it falls back to UserDefaults, because an
    unsigned build has no Keychain entitlement.)

## How it works

tvOS has WebKit on every Apple TV, but the SDK leaves it out, so there's no
`import WebKit`. The app does what
[tvOSBrowser](https://github.com/jvanakker/tvOSBrowser) does. (iOS has WebKit
in the open, but the same code runs there: one web view host, no `#if` in the
part that matters.)

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

### What the page is told (the bridge)

`HomerKit/Resources/homer-app.js` is injected at document start, before any of
Jellyfin's or HOMER's code runs. It sets:

```js
window.HOMER_APP = { platform: 'tvos' | 'ios' | 'ipados', version: '0.2.0' }
window.HOMER_TVAPP = true      // the Apple TV only: the name HOMER v0.4.6 reads
```

and fires, for the buttons that aren't keys:

```js
window.dispatchEvent(new CustomEvent('homer-app', { detail: { action, platform } }))
// action: 'menu' (OK held) | 'swipe-up' | 'swipe-down'
// the Apple TV fires the same thing as 'homer-tv' too, for HOMER v0.4.6 and older
```

HOMER's side (`shared/layout.js`) reads the platform: **tvos** is the TV
layout with no touch and no cursor (`html.homer-tvapp`, `shared/shell.css`),
**ipados** is the TV layout with touch, and **ios** leaves the media queries
alone, so a phone gets HOMER's phone layouts. `guide/guide.js` and
`shared/hub.js` start on the Large guide on the Apple TV only, and
`shared/actions.js` listens for `homer-app`.

### What's shared and what isn't

`HomerKit/` is both apps: the web view host and its WebKit-by-selector layer,
the injected page script, the saved sign-in, the loading/error screen, the
settings, and the messages between page and app. `HomerViewController.make()`
hands back the subclass for the platform.

`tvOS/` is the remote: presses turned into keys, the hold and repeat timers,
the swipe gestures and the tvOS keyboard, in `TVViewController`.

`iOS/` is what a web view can't do by itself: the audio session, what's
playing on the lock screen and its buttons, and picture in picture, in
`PhoneViewController`.

### Files

| File | What it is |
|---|---|
| `project.yml` | XcodeGen spec: the HOMER-tvOS and HOMER-iOS targets. `HOMER.xcodeproj` is made from it and not committed. |
| `HomerKit/Sources/Config.swift` | The address, and what differs per platform: user agent, zoom, touch, picture in picture, background audio |
| `HomerKit/Sources/WebKitRuntime.swift` | dlopen, and the WebKit selectors the apps call |
| `HomerKit/Sources/HomerWebView.swift` | The web view: autoplay, inline video, picture in picture, the page script, messages back |
| `HomerKit/Sources/HomerViewController.swift` | The screen: loading/error, zoom, the page's messages, saving the sign-in |
| `HomerKit/Sources/SessionStore.swift` | The sign-in copy in the Keychain (UserDefaults if that fails) |
| `HomerKit/Sources/AppDelegate.swift` | App and scene delegates |
| `HomerKit/Resources/homer-app.js` | The page side: the flag, the events, keys, keyboard, saving, zoom, now playing |
| `tvOS/TVViewController.swift` | The Siri Remote: presses, swipes, the keyboard, the self-test |
| `tvOS/RemoteKeys.swift` | Remote → keys (repeat, hold Back for H, hold OK and swipes for HOMER) |
| `tvOS/TextEntry.swift` | The tvOS keyboard for a text box |
| `tvOS/Info.plist` | Scene manifest, http allowed (web content, media, LAN) |
| `iOS/PhoneViewController.swift` | The audio session, the lock screen and its buttons |
| `iOS/Info.plist` | The same, plus the audio background mode and the orientations |
| `Tools/catalyst-smoke.sh` | Runs the Apple TV's code on the Mac against `Tools/smoke/index.html` |

### Checking it without a TV or a phone

```sh
# the page script
node --check HomerKit/Resources/homer-app.js

xcodegen generate
xcodebuild -project HOMER.xcodeproj -scheme HOMER-tvOS -sdk appletvsimulator CODE_SIGNING_ALLOWED=NO build
xcodebuild -project HOMER.xcodeproj -scheme HOMER-iOS  -sdk iphonesimulator  CODE_SIGNING_ALLOWED=NO build

# the Apple TV's code on the Mac, 25 checks (a small window opens for ~40 s)
Tools/catalyst-smoke.sh
```

Debug builds take two launch arguments (Edit Scheme… → Run → Arguments):

- `-HomerProbe YES` prints the page's address, HOMER's layout and the first
  video's state every 3 seconds.
- `-HomerSelfTest YES` presses a few buttons by itself.

`-HomerURL <address>` opens another page (Debug or Release).

If a system update breaks it, the app shows "This device won't open a web
view" instead of crashing. Check tvOSBrowser's issues and pull requests for
that year's fix.
