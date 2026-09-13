# Changelog

## v0.2.0

- HOMER: one loader (`homer.js`) for every screen, replacing the direct
  `guide/guide.js` snippet.
- HOMER Home replaces Jellyfin's home page: TiVo-style main menu (Live TV
  Guide, Movies, TV Shows, Recordings, Search, Settings), an On Now panel with
  live preview, and rows for Continue Watching, Up Next, On Now and Recently
  Added. Remote-style navigation; fills the window edge to edge.
- Global skin (`skin/skin.css`): every remaining stock page (settings,
  dashboard, drawer, dialogs, search, forms) in the HOMER look.
- Shared design tokens (`shared/tokens.css`).

## v0.1.10

- Country switch (All / USA / UK / France) replaces the International
  category and combines with it (e.g. Sports + UK). C cycles countries.
  Irish channels sit under UK. Category counts follow the chosen country.

## v0.1.9

- Channel categories: a chip row above the grid (All, Favorites, Local, News,
  Sports, Movies, Kids, Entertainment, International) with counts. [ ] cycle,
  1–9 jump, or click. Categories come from channel names; a channel can be in
  two (e.g. Sky Sports (UK) is Sports and International). Favorites are
  Jellyfin's own favorites. Works together with the filter box.
- The guide fills the window edge to edge: 1080 tall and as wide as the window
  (min 1600), with the time grid widening to match. No more black bars.

## v0.1.7

- Scrolling in the guide no longer changes the player's volume underneath: the
  guide captures wheel/trackpad events while it's open.

## v0.1.6

- The preview no longer mirrors video that's in the floating picture-in-picture
  window (it was showing the same video twice); it shows the highlighted
  channel instead. Live mirroring is only for the guide over a full-screen video.

## v0.1.5

- The guide opens over the player without leaving it, so playback continues:
  G, or a new Guide button in the player's control bar.
- Entering the browser's picture-in-picture window brings the guide up behind
  the floating video instead of the channel's details page.
- The preview window mirrors the live video that's playing ("Now watching").

## v0.1.4

- Filter box in the top bar (or press /): narrows the grid to channels whose
  name/number matches or that air a matching show; matching shows are
  highlighted. Esc clears the filter, a second Esc closes the guide.
- Trackpad/wheel now scrolls the grid smoothly like a normal list, without
  moving the selection. Arrow keys still move the highlight and keep it in
  view; Page Up/Down jump a screen.

## v0.1.3

- Wheel/trackpad scrolling pages the grid 5 channels (one screen) at a time,
  keeping the highlight in the same spot; one swipe = one page.

## v0.1.2

- Mouse wheel / trackpad scrolling moves one channel per notch-sized chunk
  with a short cooldown, instead of one channel per wheel event.

## v0.1.1

- Jellyfin's own Live TV → Guide tab now opens Channel Guide instead of the
  stock grid. Closing it returns to Live TV → Programs; Back from a channel you
  started returns to the guide.
- Hovering with the mouse only highlights; the grid no longer scrolls under the
  pointer. Arrow keys and the wheel scroll only when the selection leaves view.

## v0.1.0 (2026-09-12)

First release of the full-screen guide.

- Full-screen, set-top-box style guide on a 1920×1080 stage that scales to the
  window: program info panel, preview window, three-hour channel grid with a
  "now" marker, remote-style key legend.
- Loads on every Jellyfin Web page without opening anything. Adds a **Guide**
  button to the header for signed-in users and opens on the **G** key. The
  button reattaches when Jellyfin redraws its header, and loading the script
  twice doesn't add a second one.
- **OK / Enter** or a click starts the channel in the same browser tab.
- **R** schedules a one-time recording of the selected program and shows a
  confirmation. Programs with a scheduled recording get a red dot.
- The OK, Record and Exit hints along the bottom are clickable, so the guide can
  be closed without a keyboard.
- Closes when Jellyfin navigates to another page.
- Sends Jellyfin Web's own client/device details with API requests, so using the
  guide doesn't rename the browser in Jellyfin's device list or create an extra
  session.
- `window.ChannelGuide.open()` / `.close()` for scripting.

`theme.css`, the earlier CSS-only restyle of Jellyfin's built-in guide page, is
still in the repo but is no longer the main product.
