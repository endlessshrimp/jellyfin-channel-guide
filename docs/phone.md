# HOMER on phones: how a screen gets a phone layout

HOMER runs on phones: Jellyfin's Android and iOS apps are wrappers around the
server's Jellyfin Web, so they load HOMER through the JavaScript Injector, and
so do mobile browsers. A screen can draw a phone layout of its own. The guide
has one; the others still draw their TV layout, shrunk to fit.

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
   layouts keeps it, so nothing loads twice. A layout attaches to the model
   (`attach({ window, onChunk, onProbed })`) to say what time it shows and hear
   when listings arrive.
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
   through. Tap it for full screen with `HomerPlayer.fullscreen()`, stop with
   `HomerPlayer.stop()`.
7. **Touch rules:** 44px targets at least, nothing that only shows on hover, no
   long-press, and a press-again confirm (never a browser dialog) for anything
   that throws something away, like the guide's ● → "Cancel?".
8. **Look:** tokens from `shared/tokens.css`, Barlow, the navy backdrop, and
   channel logos on the dark chip through `HomerLogos.watch(img, chip)` (it
   knocks out a dark logo). The approved frames are the phone guide's list and
   its docked strip with the record sheet.

## The shared TV shell: `shared/shell.css`

The TV screens' stage, palette, top bar (brand and clock), key legend, toast,
chips, buttons and loading state are in one file, listed per screen prefix
(`hl-` library, `hs-` search, `hr-` recordings, `hx-` settings, `hf-` weather).
A new TV screen adds its prefix to those lists; its own stylesheet only holds
what it does differently.

## Testing without a phone

- From a signed-in Jellyfin tab, add a same-origin iframe sized 390×844 (or
  844×390, 820×1180) at `/web/index.html#/livetv?tab=1`; the injector loads
  HOMER in it at that size. Load a local build into the iframe's document too.
- An iframe can't be a screen that can't hover: use `HomerLayout.force({ touch:
  true })` inside it.
- A hidden (automated) browser tab throttles timers to almost nothing and
  doesn't start video, so drive the iframe's timers yourself and fake the
  docked state (`HomerPlayer.docked`/`nowPlaying`) for screenshots.
- Never play live TV from an automated tab: the provider allows two streams.
