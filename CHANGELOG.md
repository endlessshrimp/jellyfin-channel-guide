# Changelog

## Unreleased

- Search on a phone has a layout of its own. The search box is at the top,
  where the keyboard can't cover it, and on an empty search it has the focus,
  so the keyboard comes up with it (the keyboard's key says Search, and
  pressing it puts the keyboard away to show the results). The kinds of
  result are a row of chips under it (All, Movies, TV Shows, Episodes,
  Channels, On TV, with counts) that you swipe sideways. The results are one
  list, grouped by kind under headings that stay put while you scroll:
  posters with the title, year, running time and rating for movies and
  shows, stills with the episode number and show for episodes, and channel
  logos (on the dark chip) with what's on for Channels and On TV.
- Tapping a result does what OK does on the TV: a movie, show or episode
  opens its details, and Back comes back to the same search at the same
  result. A channel, or a program that's on now, plays in a strip under the
  top bar, as in the phone guide (tap it for full screen, **✕** to stop). A
  program that hasn't started records instead, with a toast; **●** on any
  program records it too, and on one that's set to record the first tap arms
  it (**Cancel?**) and a second tap cancels.
- The top bar's Search opens it from any screen with the keyboard already
  coming up (iPhones only raise the keyboard for a focus inside the tap), and
  anything typed while it opens lands in the box. On Search itself, it goes
  back to the box, keeping what's there.
- Landscape phones get the box and chips on one line and the results two
  across; with a video playing, the video sits at the left with the box
  under it and the results down the right.
- A window resized across the phone line swaps layouts at the same search,
  kind and result. The TV layout looks and works exactly as before.
- Recordings on a phone has a layout of its own instead of the TV screen
  shrunk to fit. **Recorded / Scheduled / Series** sit in a segmented control
  at the top, with a list under it: recordings newest first (a show with
  several recordings is one row, as on TV, and a tap opens its episodes, with
  **All recordings** to go back), scheduled recordings under a heading for each
  day, and series recordings with when the next one is. Channel logos are on
  the dark chip, as in the phone guide.
- A tap on a recording, a scheduled recording or a series opens a sheet with
  what it is (channel, when, how long, the description; for a series, what's
  coming up) and big buttons: **Play**, or **Resume** and **Restart**, and
  **Delete** for a recording; **Cancel recording** (**Stop recording** while
  it's recording) for a scheduled one; **Cancel series** for a series. Delete
  and the cancels take a second tap on the same button (**Tap again to
  delete**) within a few seconds; a tap anywhere else puts it back. No browser
  dialogs, no long-presses, nothing that needs a hover.
- A video playing in a preview window keeps playing in a strip at the top of
  Recordings on a phone (at the left in landscape), as in the phone guide.
  Landscape puts the rows in two columns.
- Under the hood: Recordings' data (loading the DVR, the shape of a recording,
  a timer and a series, deleting, cancelling and playing) is in
  recordings/recordings-model.js, which the TV and phone layouts share. The TV
  screen looks and works exactly as before.
- Home on a phone is a phone screen, not the TV one shrunk: **On Now** on
  top (the program's picture, or its channel's logo, then the channel, the
  title, its time with how long is left and a progress bar, and big
  **Watch** and **Guide** buttons), then the same rows as on TV (Continue
  watching, Up next, On now, Recently added), each a strip of finger-sized
  cards you scroll sideways. A tap on a card opens its page; a tap on a live
  card watches it, as on TV. The TV menu is gone: the tab bar has the
  screens, the top bar the weather and Search, and **Settings** is a button at
  the top of Home, beside the date.
- Watch plays the channel in the same strip as the phone guide's, under the
  top bar, so the video stays put going between Home and the guide. The rows
  keep scrolling under it; tap it for full screen, **✕** to stop. In
  landscape the picture (and the video) sits at the left, with what's on
  beside it or under it, and the rows down the right.
- Under the hood: Home's rows and what's on are loaded once for both
  layouts, so switching between them (a window resized across the line)
  doesn't load them again. TV Home looks and works exactly as before.

## v0.3.12

- Guide on touch screens (tablets, and any screen that can't hover): the
  first tap on a program highlights it and shows its **●** button, a size up
  for a finger. A tap on the button records (tap it twice to cancel, as with
  the mouse), and a tap on the highlighted program watches it if it's on now.
  An upcoming program is only highlighted, as before. A finger drags the
  channels up and down, and dragging sideways moves through time; a drag
  never counts as a tap. Mouse and keyboard work exactly as before.
- Phones get HOMER's phone chrome: when the screen's shortest side is under
  600px (either way up), every HOMER screen has a top bar (HOMER and the
  screen's name, the weather, Search) and a tab bar (Home, Guide, Movies,
  Shows, Recordings), sized for a finger and clear of the notch and the home
  indicator. Screens that don't have a phone layout yet show their TV layout,
  shrunk to fit between the bars. Tablets keep the TV layout. (shared/layout.js
  decides, from CSS media queries; a rotation or resize switches over.)
- The browser's own Back (a phone's back button or swipe, Cmd+[) no longer
  stops a video playing in a preview window: it goes back a screen, and the
  video keeps playing. From Home it stops the video. In full screen, it
  shrinks a video that was in a preview window back into it.
- Settings no longer changes how Search looks after you've opened both (the
  two screens' stylesheets used the same class names; Settings' are its own
  now).
- Under the hood: the stage, top bar, legend, toast, chips, buttons and
  loading state that Movies/TV Shows, Search, Recordings, Settings and
  Weather each had a copy of are in one place (shared/shell.css), and the
  guide's channels, listings and recordings are in guide/guide-model.js, apart
  from the grid that draws them. The TV screens look and work exactly as
  before.
- The guide on a phone is a list: one row per channel with its logo and
  number, what's on (time left and a progress bar), what's next, and a **●**
  button on every row. A time rail under the chips picks what the rows show,
  Now or any half hour ahead (with the day), TiVo-style; category and country
  chips narrow the list as on TV. Channels with nothing listed get a slim
  row. Only the rows on screen are drawn, so 272 channels scroll smoothly.
- **●** records with a toast, like on TV. On a program that's set to record,
  the first tap arms it (**Cancel?**, or **Stop?** while it's recording) and a
  second tap within a few seconds cancels it. A tap on a row opens a sheet:
  the channel, the program, its time and how soon it starts, the
  description, and big **Record** and **Watch** buttons (Watch only for
  what's on now). No long-presses anywhere.
- Watching from the phone guide plays the channel in a strip under the top
  bar, and the list keeps scrolling under it (in landscape the video sits at
  the left, with the chips and times under it). Tap it for full screen, **✕**
  to stop. The guide is a screen at its own address on a phone, so the tab
  bar and Back move to and from it like any other.
- Live TV stops by itself when a phone or tablet has been locked, or HOMER has
  been in the background, for 3 minutes (checked again when it wakes up), so a
  pocketed phone doesn't hold one of the provider's two streams. Recordings
  and movies just stay paused.
- iPhones play the docked video inline (Jellyfin's video already asks for
  that; HOMER makes sure).
- Landscape phones get shorter rows, with what's next beside what's on.

## v0.3.11

- Weather: a new layout. Now keeps the top left, with the next 14 hours
  under it, two hours to a slot (conditions, temperature, chance of rain), in
  place of the long Hour by hour band. The next 3 days move down to the bottom,
  a panel each, and with the room they now show wind, sunrise and sunset along
  with the high, low, conditions, and chance and amount of rain. No more ◀ ▶
  paging.
- Weather: a Radar panel in the top right: the last hour of the National
  Weather Service's radar mosaic (a picture about every 6 minutes, from the
  NWS's own map server), played as a loop over a HOMER navy map centered on
  the place, with county and state lines, interstates in a dim grey (so no
  road can pass for heavy rain), the bigger towns, and the place marked. The
  rain is shown exactly as the NWS draws it, nothing tinted or faded; the
  time of each picture and how far through the hour it is show in the corner.
  The loop is fetched again every 5 minutes while the screen is up. Outside
  the US, or when the NWS doesn't answer, the panel says so; if only the map
  server is out, the rain still shows with just the place marked.
- Weather: Now and each day sit on an illustrated sky that matches the
  weather: clear, a few clouds, partly cloudy, overcast, fog, rain, sleet, snow
  or storms. Now's sky also follows the time of day (day, dawn, dusk, night).
  Drawn in the style of the icons, under a navy scrim so every number stays
  readable, and nothing moves; a change of weather fades the new sky in.
- Weather: a snowy day says "Snow" and its chance, without the melted amount.

## v0.3.10

- Channel logos: every logo sits on the dark chip now; there are no light
  chips. A logo that's dark itself is shown in grayscale, inverted (dark parts
  turn white), so it reads on the dark chip and keeps any detail inside it.

## v0.3.9

- Guide: move through time like a cable box. **◀ ▶** past the edge of the
  screen pages the guide later or earlier (at least half a screen, far enough
  that the next program lands mid-screen), never earlier than now and as far
  ahead as the real listings go (the placeholder "(Mo. 18:00 - 00:00)" blocks
  at the tail don't count). Sideways on the trackpad moves it a half hour at a
  time. Up and down still keep the same point in time.
- Guide: the day chip at the top left of the grid says TODAY, TOMORROW or the
  date (WED SEP 16), and a slot that starts a new day carries its weekday. The
  "now" needle only shows while now is on screen.
- Guide: **N** jumps back to now. The legend shows it (in the needle's amber)
  only while you're away from now; it's clickable too.
- Guide: listings load 3 hours at a time as you move, plus the next 3 hours
  ahead, one request at a time, instead of all at once. The channels go up as
  soon as they're in; a stretch whose listings haven't arrived shows as
  striped "Loading…" cells, and you can keep moving meanwhile. A chunk that
  fails is tried again.
- Guide: a program that hasn't started shows its day and time ("Tomorrow ·
  6:00 PM – 7:00 PM") in the info panel. OK on it records it, the same as R,
  instead of tuning the channel; a click only selects it. The legend's OK hint
  says what OK will do (Watch, Record, Cancel recording), and R's hint shows
  only when it does something different, with the right verb.
- Guide recording: Jellyfin can take 20 seconds or more to set up a recording,
  so the guide now says "Scheduling …" right away, and "Still scheduling …" to
  a second press instead of ignoring it. Just before sending, it re-reads
  Jellyfin's timers and doesn't send a second request for a program that's
  already set to record (from another tab, or a guide closed and reopened
  while the first request was still out).
- Guide: rows are exactly 76px with their divider, so keyboard scrolling no
  longer drifts a pixel per row (far down the list, the highlighted row could
  end up below the visible grid).
- Guide: on windows narrower than 16:9 the legend tightens up so every hint
  fits.
- Channel logos: most channel logos are white, and they washed out on the
  light chip behind them. Logo chips are now dark, and a logo that's dark
  itself (E!, Vice, Paramount, Sky History, NBC 5, …) gets a light chip
  instead, so every logo reads in its own colors. HOMER measures each logo
  once and remembers the answer on that device. Same chips everywhere: the
  guide (channel list, info panel, preview), Home's On Now, Recordings and
  Search.

## v0.3.8

- Weather: a HOMER Weather screen, from a new Weather item in Home's menu
  (#/weather). A forecast board in the style of a TV weather segment: a title
  band with the place and a one-line outlook, Now (temperature, conditions,
  feels like, humidity, wind, next sunrise or sunset), the next 3 days (high,
  low, conditions, chance of rain) and twelve hours at a time of conditions,
  temperature and chance of rain (◀ ▶ for earlier and later hours, OK back to
  now). Same place and same reading as the clock's weather; refreshes every
  10 minutes. Only the Now icon animates.
- Home's menu items are a little shorter so all seven fit beside On Now.
- Clicking the weather next to the clock, on any screen, opens the Weather
  screen.

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
