# Changelog

## v0.3.7

- Weather location: the weather follows each device instead of always showing
  Kaufman. A browser that can share its location (over HTTPS) uses it; any
  other device uses a ZIP code set in Settings → Weather location (type the
  digits, OK to save). With nothing set, it starts at 75142.

## v0.3.6

- Weather: the icon sits to the right of the temperature.

## v0.3.5

- Weather: the temperature and high/low are right-aligned, like the clock.

## v0.3.4

- Weather: every HOMER screen with a clock shows the current temperature in
  Kaufman, TX to its left, with today's high and low and an animated icon for
  the conditions (sun or moon, clouds, rain, storms, snow, fog), split from the
  clock by a rule. Data from Open-Meteo, refreshed every 10 minutes; the bug
  hides itself if the data can't load. Icons are Meteocons by Bas Milius (MIT).

## v0.3.3

- Recordings: a HOMER Recordings screen replaces Jellyfin's. Recorded (shows
  with several recordings fold into one row), Scheduled and Series tabs; Play,
  Resume, Restart; Delete, Cancel recording and Cancel series, each with an
  OK-again confirm.

## v0.3.2

- Search: a HOMER Search screen replaces Jellyfin's search results. Movies, TV
  Shows, Episodes, Channels and what's On TV (now and the next 3 hours), with
  filter chips, the search box in the top bar, and Watch / Details actions.

## v0.3.1

- Guide recording: hovering a program shows a ● button on that program;
  click it to record. On a program that's set to record it's "Cancel" (or
  "Stop" while recording), with a click-again confirm. R toggles the same way
  ("Press R again"). The legend's Record hint is no longer clickable, since
  reaching it used to record whatever the mouse crossed on the way.
- Guide cells are the width they were meant to be (they overlapped the next
  program by a few pixels).
- French channels land in the right guide categories (BFM, LCI, franceinfo,
  France 24 in News; Canal+ Sport, beIN, Eurosport, L'Equipe in Sports; …).
- Settings: a HOMER Settings screen replaces Jellyfin's preferences menu
  (audio language, subtitles, subtitle language, streaming quality, sign out).
- No stock Jellyfin pages: anything HOMER doesn't draw goes to Home, and
  Jellyfin's own pages stay hidden underneath HOMER. The admin dashboard,
  sign-in and the player are left alone. Search results and Recordings stay
  Jellyfin's until their HOMER screens ship. Closing the guide always goes Home.

## v0.3.0

- Watching while you browse: a playing video stays up across every HOMER
  screen. Home, Movies, TV Shows, and show and movie pages all open on top of
  the player, with the video playing in their preview window and gliding
  between screens.
- Back from full screen (the player's ← button, Esc, Backspace) shrinks the
  video into the screen you came from instead of stopping it. Full screen, F,
  or a click on the preview window expands it again.
- Play on a show or movie page while something plays goes full screen. When a
  video ends, you stay on the screen you were on.
- The trackpad never changes the volume, including in Jellyfin's full-screen
  player.
- New `shared/player.js` (HomerPlayer), loaded first by `homer.js`, owns
  playback, the preview window, Back, H and F for every screen.

## v0.2.3

- Home from anywhere: the HOMER logo at the top left of the guide, Movies,
  TV Shows and show/movie pages is a Home button, and H goes Home from any
  screen (not while typing). From the full-screen player, the video comes
  along into Home's preview window. Every screen's key hints include H Home.

## v0.2.2

- Home: Watch plays the channel in the On Now preview window, so you can keep
  browsing while it plays. The panel switches to Now Watching with Full
  screen, Guide and Stop. Picking a channel in the On Now row does the same.
- Full screen (or F, or a click on the preview) hands the channel to
  Jellyfin's player. The player's new Home button (or H) brings it back to the
  preview.
- While the preview plays, the arrow keys, space and the trackpad control Home,
  not the player.
- Watching from the guide is always full screen.
- Leaving Home while a channel is still tuning cancels it instead of letting it
  pop up full screen later.

## v0.2.1

- Movies and TV Shows in a TiVo "My Shows" layout: the list on the left, the
  selected title's art, details and Play / Resume / Restart on the right.
  A–Z or Recently Added, a filter box, and in-progress and unwatched markers.
- Show, movie, season and episode pages replaced: season tabs over an episode
  list, with the selected episode's details and preview above.
- Both fill the window edge to edge, like Home and the guide.

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
