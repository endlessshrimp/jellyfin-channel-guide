# HOMER on phones: how a screen gets a phone layout

HOMER runs on phones: Jellyfin's Android and iOS apps are wrappers around the
server's Jellyfin Web, so they load HOMER through the JavaScript Injector, and
so do mobile browsers. Every screen is reachable from the tab bar or from the
menu sheet the HOMER mark opens (below). Every HOMER screen has a phone layout of its own: the
guide, Home, Movies and TV Shows with their details pages, Search,
Recordings, Settings, Weather, Rooms, Cameras, Music and Now Playing. A screen
without one would draw its TV layout, shrunk to fit.

## Deciding the layout: `shared/layout.js`

`window.HomerLayout` decides with CSS media queries, never the browser's name:

- **Phone layout** when the window's shortest side is under 600px, in either
  orientation (`isPhone()`, `html.homer-phone`).
- **Touch** when the device can't hover, on either layout (`isTouch()`,
  `html.homer-touch`). A tablet keeps the TV layout, with touch.
- `onChange(fn)` fires when either flips (rotating, resizing) and when a
  screen's phone layout arrives. `force({ phone, touch })` overrides both, for
  testing.

On a phone, every HOMER screen gets the **phone chrome**: a top bar (HOMER and
the screen's name, the weather, Search) and a tab bar (Home, Guide, Movies,
Shows, Recordings), `html.homer-chrome` while they're up. Their heights are
`--homer-phone-top` and `--homer-phone-tabs` (safe-area insets included; see
`shared/phone.css`). Jellyfin's viewport tag already has `viewport-fit=cover`,
so `env(safe-area-inset-*)` works; `layout.js` adds it on phones if it's ever
missing.

## The menu on a phone: `HomerMenu.openSheet()`

The tab bar has five screens and HOMER has fourteen, so the rest were only
reachable from a row of buttons on Home — which you had to know was there. The
HOMER mark in the top bar opens the whole list instead (`shared/menu.js`,
styled in `shared/menu.css`): the same items in the same order as the TV's
rail, with **Home** added first, the one you're on ticked.

- `shared/layout.js` only wires the tap: `.hp-brand` calls
  `HomerMenu.toggleSheet()`, and falls back to `goHome()` if menu.js isn't
  loaded. Everything else is in menu.js, so there's one list, not two.
- **The sheet sits between the bars**, not over them: `#hm-sheet-root` is
  `top: var(--homer-phone-top); bottom: var(--homer-phone-tabs)`, so the top
  bar and the tab bar stay visible and unblocked. A tap outside — the bars
  included — dismisses the sheet and does nothing else, the way a sheet
  behaves anywhere else on a phone; tap again to use what's under it.
- **Back closes the sheet, not the screen.** Opening it pushes one history
  entry at the *same address* (`history.pushState(…, location.href)`, with
  whatever state was there kept, so `shared/player.js`'s own docked mark
  survives). No router sees an address change; the browser's Back takes that
  entry instead of the page, and `popstate` closes the sheet.
- **Take the entry away before navigating, never after.** `history.back()` is
  asynchronous, so closing the sheet and going somewhere in the same tick
  would pop the page you just went to. A row tap calls
  `closeSheet(then)`, which drops the entry and runs `then` once the
  `popstate` has come back (with a timeout in case it doesn't) — the same
  shape as `dropMark(then)` in `shared/player.js`. The result: one history
  entry per screen change, and Back from there lands where you started.
- A swipe down closes it, but only from the top of the list, so a scrolled
  list scrolls instead of dismissing.

## A screen without a phone layout

Nothing to do. Its root is squeezed between the bars (`shared/phone.css`), and
its `fit()` scales the TV stage to that room with `HomerLayout.stageBox()`
(the window on a TV, so the TV layout doesn't change). The tab bar gets you
around meanwhile.

## Giving a screen a phone layout (the guide's pattern)

1. **Split the data and actions from the drawing.** The guide's channels,
   listings (3-hour chunks and their cache), timers, scheduling and cancelling
   (with its one-request-at-a-time and never-twice guards) and watching live in
   `guide/guide-model.js`. The TV layout (`guide/guide.js`) and the phone
   layout (`guide/guide-phone.js`) both draw from one model, and switching
   layouts keeps it, so nothing loads twice. (The library screens do the
   same with `library/library-model.js`; there, where each screen was, the
   title or the season, is in the model's `memory`, which both layouts read
   and write, so a switch lands in the same place.) A layout attaches to the model
   (`attach({ window, onChunk, onProbed })`) to say what time it shows and hear
   when listings arrive. A screen with little data can do less: Home's
   `loadData()` returns one promise (its rows and what's on), and both layouts
   are handed it. (Home has no position worth carrying from one layout to the
   other, so its phone layout has no `state()`.)
2. **Write the phone layout** in its own file, `x/x-phone.js`:
   `window.HomerXPhone = { create(ctx) }`, returning `{ phone: true, show(),
   state(), teardown() }`. `state()` is where it is (category, time, the
   channel at the top); the other layout starts from it. When the file has
   loaded it says so: `HomerLayout.register('x', { phone: true })`.
3. **Pick the layout when the screen opens:** `HomerLayout.usePhone('x')` (a
   phone, and the phone layout is loaded). Listen to `HomerLayout.onChange`;
   when `usePhone('x')` flips, tear down the one that's up and draw the other
   from its `state()`.
4. **Place it between the bars.** Its panels start at `var(--homer-phone-top)`
   and end at `var(--homer-phone-tabs)`. Keep its root id if other code looks
   for it (the phone guide is still `#cg-root`, with `.cg-phone`), and scope
   its CSS to a class so the TV stylesheet and the phone one can both be
   loaded.
5. **Navigation stays shared.** Route with `HomerPlayer.go(hash)`, `.back()`,
   `.goHome()`, and read where you are from `HomerPlayer.route()`, never
   `location.hash`: while a video is docked the address is the player's. On a
   phone the guide is a screen at its own route (`#/livetv?tab=1`) like the
   others, so the tab bar and the browser's Back treat it like one.
6. **Docked video:** give the layout a `[data-homer-preview]` element;
   HomerPlayer pins the real video over it (z-index 99995). A root that sits
   above that (the phone guide is at 99997, so its sheet can cover the tab bar)
   must leave the preview transparent once the video is in, so the video shows
   through. A phone root that keeps a TV root's id (the library's `#hl-root`)
   also gets the `homer-screen` class, so HomerPlayer finds its
   `[data-homer-preview]` rather than looking for the TV layout's preview. Tap it for full screen with `HomerPlayer.fullscreen()`, stop with
   `HomerPlayer.stop()`.
   - The player only looks for `[data-homer-preview]` inside `#cg-root` or a
     `.homer-screen` root (plus the TV screens' `.hm-preview`/`.hl-preview`),
     so a phone root with another id adds `homer-screen` to its classes (phone
     Home is `#hm-root.hm-phone.homer-screen`).
   - Outside the guide, the player takes any tap inside the preview as "full
     screen" (in the capture phase), so buttons drawn on the strip (✕, full
     screen) must be its siblings, layered over it, not its children.
   - Nothing between the root and the preview may paint a background: every
     ancestor of the hole up to the root has to be transparent, or the video
     is hidden. Put backgrounds on the panels beside the strip instead.
   - Put the strip where the guide's is (full width under the top bar in
     portrait; the left 42%, 16:9, in landscape), so the video doesn't move
     from one screen to the next.
7. **Touch rules:** 44px targets at least, nothing that only shows on hover, no
   long-press, and a press-again confirm (never a browser dialog) for anything
   that throws something away, like the guide's ● → "Cancel?".
8. **Look:** tokens from `shared/tokens.css`, Barlow, the navy backdrop, and
   channel logos on the dark chip through `HomerLogos.watch(img, chip)` (it
   knocks out a dark logo). The approved frames are the phone guide's list and
   its docked strip with the record sheet.

## Search's phone layout (`search/search-phone.js`)

- **No model file.** Search's data is one request per kind and a minute's
  cache, so `search/search.js` hands its search, cache, Back memory,
  navigation and formatting to the phone layout through `ctx`
  (`createPhone`). Both layouts write the same Back memory, so a change of
  layout (`remember()` on the one going away) starts the other at the same
  query, kind and result.
- **Recording** borrows the guide's model: `HomerGuideModel.create(server)`
  costs nothing until asked, and its `schedule`/`cancel` keep the
  one-request-at-a-time and never-twice guards.
- **The keyboard.** An iPhone only raises it for a focus inside a tap, and a
  screen opens a moment after the tap that routed to it. The top bar's Search
  calls `HomerSearch.phoneTap()` inside the tap: on Search it focuses the box;
  elsewhere a hidden stand-in `<input>` takes the focus (keyboard up) and the
  box takes it over, with anything typed, once it's showing. The keyboard
  covers the page without shrinking it (iPhones, Android's Chrome), so the
  list gets `--sp-kb` (from `visualViewport`) of room at its end; a finger
  moving on the list puts the keyboard away. The box is `type="search"`,
  `enterkeyhint="search"`, 17px (an iPhone zooms in on anything under 16px).
- **Docked video controls.** HomerPlayer turns a tap inside
  `[data-homer-preview]` into full screen (except in the guide), so buttons
  over the video (✕, full screen) are siblings of the preview element, not
  children. The root sits at 99997 like the phone guide's, above the video,
  with the strip left transparent once the video is in.
### Recordings, the same way

`recordings/recordings-phone.js` follows the guide, with a few differences
worth copying for a small screen:

- Its model, `recordings/recordings-model.js`, keeps no state: `load(server)`
  returns every tab's list (and a signature, so a quiet refresh that changed
  nothing redraws nothing), and `remove()` / `play()` do the rest. Each layout
  holds what it loaded. Where you are (the tab, an open folder) lives in a
  `memory` object that `recordings.js` hands both layouts, so a change of
  layout lands on the same tab.
- The root is still `#hr-root`, with `.homer-screen` (so the phone chrome and
  HomerPlayer see a HOMER screen) and `.hr-phone`. `.homer-screen` is what
  `shared/phone.css` squeezes between the bars, so the phone stylesheet puts
  it back to full height (`html.homer-chrome #hr-root.hr-phone`) and places
  its own panels between the bars, like the guide.
- A tap opens a sheet; anything that throws something away is a sheet button
  that arms on the first tap ("Tap again to delete") and ignores a second tap
  within 400ms (a double tap isn't a decision).
## Settings and Weather: a screen under the bars

The guide's phone layout sits above the bars (99997) and leaves its video
strip transparent. Settings (`settings/settings-phone.js`) and Weather
(`forecast/forecast-phone.js`) are simpler, and a good pattern for a screen
that's just a column:

- The root keeps the screen's id and `.homer-screen` (plus `.hx-phone` /
  `.hf-phone` to scope the CSS), so `shared/phone.css` puts it between the
  bars and HomerPlayer and the chrome count it as a screen. It stays at the
  screens' 99990, and scrolls inside itself.
- Docked video: a 16:9 `[data-homer-preview]` at the top (at the left in
  landscape), with what's playing, Full screen and ✕ in a bar under it. The
  real video (99995) covers the preview; the controls sit clear of it, so
  nothing needs to be see-through. A tap on the video is HomerPlayer's (full
  screen).
- The data stays in the TV file: Settings' `createModel(server)` (the
  settings, their values, saving with the new value shown at once), and
  Weather's `createFeed`, `summary`, `stripSlots`, `dayInfo`, the skies and
  `createRadar` (the map and loop for any panel size, names scaled with `t`).
  The TV file hands them to `create(ctx)`.
- A text box on a phone: `inputmode="numeric"` (and `pattern="[0-9]*"` for
  iPhones), 16px or larger so iPhones don't zoom, a real `<form>` so the
  keyboard's Done/Go submits, and `visualViewport` to keep the box above the
  keyboard (Settings' ZIP code).

## Rooms: Home Assistant on a phone

`rooms/rooms-phone.js` is a screen under the bars, like Settings, with a row
of room chips at the top (one room at a time) instead of a list you open.
Its data is `shared/homeassistant.js`, and its helpers (a room's summary, a
light's or thermostat's state, camera stills) come from `rooms/rooms.js`
through `ctx`, as Weather's do. Two things worth copying:

- **Dimming with a finger**: the bar is a 26px-tall touch target around an
  8px track (`touch-action: none`), and the new brightness is sent once, when
  the finger lifts. A tap on the bar sets it there; a tap anywhere else on the
  row switches the light.
- **A bulb's colors** open as a sheet from the bottom, inside the screen's
  main area (above the tab bar): the presets in a grid of four, then a white
  strip and a color strip you drag (`touch-action: none`; the color is sent
  when the finger lifts or rests, like dimming). A tap beside the sheet, ✕ or
  Esc closes it. Everything else in a room stays one level deep: a player's
  buttons, inputs and a device's settings sit on its card, not behind it.
- **A TV's remote** (an Apple TV, a Samsung TV: `Remote` on the player's
  card) is a view over the room like a camera: a round pad (the arrows as
  wedges around OK, `clip-path`) and a row of Back, Home, Play/Pause, Vol−
  and Vol+, all 60px targets with `touch-action: none`. A press goes on
  `pointerdown`, not the tap, so it feels like a remote; it lights its button
  and buzzes (`navigator.vibrate(10)`, where the browser has it). A finger
  held on an arrow or the volume repeats after 450ms, then about six times a
  second, and the commands are dropped rather than queued when the device is
  slow (`HomerHA.sendRemote`). In landscape the keys move beside the pad.

  ![The remote on a phone](screenshots/remote-phone.jpg)

- **The quick controls and the doorbell** (`rooms/quick.js`) are drawn once for
  both layouts: a sheet from the bottom and a card at the top on a phone
  (`.phone`), a panel at the right and a card at the top right, scaled from
  1080-tall units, on a TV.

## Cameras: one column, the doorbell first

`cameras/cameras-phone.js` is a screen under the bars like Settings and
Weather, with the same shape as its TV layout turned into a column. Worth
copying:

- **The data is a model file, not the TV screen.** `cameras/cameras-model.js`
  holds the wall (real cameras and the placeholders), each camera's controls,
  and its events — the camera's own clips from `media-source://reolink` and,
  where there are none, Home Assistant's history. `cameras/cameras.js` hands
  it to the phone layout through `ctx` (`model()`, plus its formatters:
  `whenText`, `agoText`, `runLength`, `roomTag`, `keepStill`,
  `statusMessage`). Both layouts share one model instance, so a change of
  layout doesn't re-read anything.
- **One level deep.** The column is the doorbell, its events strip, then the
  other cameras. A tap on any camera swaps the column for that camera's page
  (live view, controls, its own events) with a 44px **‹ Cameras** button; Esc
  and the phone's Back do the same. Nothing is nested further.
- **A strip of clips as thumbnails.** Each event's picture is its clip's first
  frame, in a muted `<video preload="metadata">` that loads two at a time, so
  a strip of a dozen doesn't pull a dozen files off a battery camera at once.
  A frame that never arrives leaves the event's icon showing, which is also
  what a history-only event ("No clip") gets.
- **The camera's controls are 60px buttons**, two across (four in landscape),
  and each says what it will do rather than what it is (**Siren · Sound it**,
  **LED · Auto**). Nothing here needs a press-again confirm: none of them
  throws anything away.
## Music: a player that outlives the screen

`music/music-phone.js` is a sheet-based screen like Books', with one thing
worth copying for anything that plays:

- **The player isn't in the screen.** `music/music-model.js` owns the `<audio>`
  element and the queue on `document.body`, so tearing down either layout (or
  leaving `#/music` entirely) doesn't stop the music. `music/music-strip.js`
  draws the now-playing strip on every *other* screen; on a phone it sits above
  the tab bar (`.homer-chrome #mu-strip { bottom: calc(var(--homer-phone-tabs)
  + 8px) }`) and the screen's own `.mup-mini` takes over inside Music.
- **`pagehide` is not the page going away.** Jellyfin Web fires `pagehide` on
  its own in-app navigations, so a player that stops on `pagehide` (Books does,
  deliberately) stops every time you change screen. Music reports its position
  on `pagehide` and only stops on `beforeunload`.
- Both layouts read `HomerMusicModel.player.state()` and repaint from one
  `onChange`; the phone's mini player and the TV's strip are the same state
  drawn twice. A repaint arrives about four times a second, so anything the
  finger is on (the queue list) is only redrawn when the track actually
  changes.
- **A star that a thumb can hit.** The favorite star is a `<button>` of its own
  beside the row button, not an element inside it — a row that plays when
  tapped can't also hold a control that doesn't. The pair lives in a
  `.mup-song-row` / `.mup-track-row` flex wrapper, which is also where the
  hairline between rows moved to. The star's handler calls
  `stopPropagation()` and `preventDefault()` anyway, for the browsers that
  synthesise a click on the ancestor.
- **A star changing repaints stars, not lists.** `music-model.js` emits
  `'favorite'`; both layouts walk the stars already on screen and swap the
  glyph rather than rebuilding the list, because on a phone a thumb is usually
  still resting on one. Only the Favorites list itself is redrawn, since that
  is the one list a star actually changes.
- **One picker, two sizes.** "Play on…" (`music/playon.js`) is the same list on
  both layouts, with no layout-specific code in it: the screen passes `tv:
  true/false` and a host element, and `music/playon.css` switches between stage
  pixels (the TV's 1920x1080 stage, which the stage's own transform scales) and
  a real-pixel sheet from the bottom of a phone. The TV screen appends it
  *inside* `#mu-stage` so it scales with everything else; the phone appends it
  to `document.body`. The row is 84 stage pixels on the TV and a 60px thumb
  target on a phone.

  ![Play on…, on a phone](screenshots/music-playon-phone.jpg)

  Two things that bit while building it: an icon sized with a class loses to
  the screen's own `#mu-root .material-icons { font-size: inherit }` (an id
  beats any class), so the size goes on the row's icon box and the glyph
  inherits it; and the picker's own `keydown` listener is registered later than
  the Music screen's, so capture-phase order alone won't keep the screen's keys
  out — `music.js` asks `HomerPlayOn.isOpen()` and stands aside.
## Now Playing: one model, two layouts, no menu on the phone

`playing/playing-phone.js` is the shortest version of the pattern, because
everything that isn't drawing already lives somewhere else:

- **The model is the whole screen.** `playing/playing-model.js` gathers the
  three sources (Jellyfin's `/Sessions`, Home Assistant's players, HOMER's own
  music), normalizes them into one list of cards and owns every control
  (`act(card, what, arg)`). Both layouts call `cards()`, `idle()` and
  `onChange()` and draw; neither knows which source a card came from.
- **`start()` and `stop()` belong to whichever layout is up.** The model polls
  `/Sessions` only while a layout has started it, so switching layouts hands
  the polling over rather than running it twice.
- **A progress bar doesn't need a poll.** A card carries `position` and `at`
  (when that position was read). Each layout runs its own cheap interval — 250
  ms on TV, 500 ms on the phone — and computes `position + (now − at)` for
  anything playing, so the bars move smoothly between samples.
- **The phone layout draws no menu of its own.** The TV layout puts
  `shared/menu.js` down the left so the screen doubles as a way into
  everything else; on a phone that job belongs to the chrome — the tab bar and
  the menu sheet the HOMER mark opens — so the phone layout is just the
  cards.

## The shared TV shell: `shared/shell.css`

The TV screens' stage, palette, top bar (brand and clock), key legend, toast,
chips, buttons and loading state are in one file, listed per screen prefix
(`hl-` library, `hs-` search, `hr-` recordings, `hx-` settings, `hf-` weather,
`hn-` now playing, `ho-` rooms).
A new TV screen adds its prefix to those lists; its own stylesheet only holds
what it does differently. `shell.css` doesn't set `box-sizing`, so a screen
whose sizes are outer sizes says so itself (Now Playing does, once, for
`#hn-stage *`).

## Testing without a phone

- From a signed-in Jellyfin tab, add a same-origin iframe sized 390×844 (or
  844×390, 820×1180) at `/web/index.html#/livetv?tab=1`; the injector loads
  HOMER in it at that size. Load a local build into the iframe's document too.
- An iframe can't be a screen that can't hover: use `HomerLayout.force({ touch:
  true })` inside it.
- A hidden (automated) browser tab throttles timers to almost nothing and
  doesn't start video, so drive the iframe's timers yourself and fake the
  docked state (`HomerPlayer.docked`/`nowPlaying`) for screenshots.
- It won't decode **audio** either: an `<audio>` element sits at
  `readyState 0` / `networkState 2` for ever, even though the same URL fetches
  fine (and `AudioContext.decodeAudioData` on the bytes works). To shoot Now
  playing, wrap `HomerMusicModel.player.state` so it returns a position, and
  fire a `seeked` event on `#homer-music-audio` to make the screen repaint.
- To see a docked strip with a picture in it without playing anything, pin a
  stand-in: a `<video>` fed by a `canvas.captureStream()`, inside a
  `div.videoPlayerContainer.homer-pinned` at z-index 99995 over the preview's
  rect. The layouts' "the video is in" checks see it as the real thing.
- Never play live TV from an automated tab: the provider allows two streams.
