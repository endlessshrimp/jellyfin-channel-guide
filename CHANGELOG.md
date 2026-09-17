# Changelog

## Unreleased

- **Baseball on the Sports screen comes from MLB now, not ESPN.** ESPN's
  scoreboard gave a baseball game a score and an inning, which is about a
  third of what's happening. MLB runs its own StatsAPI (`statsapi.mlb.com` —
  no key, no account, and it answers a browser directly), and it knows what a
  scoreboard knows. **MLB alone** moved to it; every other league is still on
  ESPN, unchanged.
  - **Live now**, a panel at the top of the MLB tab, drawn on the two clubs'
    colours: the batting side lit and marked, **the bases** on a diamond,
    **the count**, **the outs**, who's **pitching** and who's **at bat** (with
    the hand each throws and hits from), who's **on deck**, the pitch
    sequence of the at-bat, the **line score inning by inning** with R H E,
    and **the last four plays** with the newest one large. Before first pitch
    it's the start time and the two probable starters; afterwards it's the
    final, the line score and the winning, losing and saving pitchers.
  - **One game at a time.** The panel follows the Rangers when they're
    playing, otherwise the closest game late on. When more than one game is
    live, a chip per game across the top — logos, scores and the inning —
    picks which one it follows. Only that game's feed is fetched, and the
    Rangers', however many games are on.
  - **The Rangers' card on My Teams** shows the same detail while they're
    playing (bases, count, outs, the pitcher, the hitter, and the last play
    in place of the last result), and **the probable starters** before they
    play. Their standing line is MLB's own: "76-76 · 2nd in AL West", plus
    the magic number, "clinched" or "eliminated" once one of those is true.
  - **Every score card** for a game in progress carries the diamond, the
    count, the outs and who's at the plate under the score, and says
    "Middle of the inning" when that's what's happening.
  - **The real state of a game**, which is the thing ESPN was quietest
    about: **Warmup**, **Delayed · Rain**, **Delayed Start · Lightning**,
    **Postponed**, **Suspended**, **Final/10**, **Mid 7th**, **End 7th**,
    **Review**. Makeup games and doubleheaders say so.
  - **The ticker didn't grow a second baseball strip** — the one it already
    had just says more: "BOS 3 TEX 2 · TOP 5TH · 1 OUT, ON 3RD", and
    "POSTPONED · RAIN" where it used to say the game was over.
  - **Courteous polling.** The slate for yesterday and today is one trimmed
    request of about 20 KB (StatsAPI's `fields=`), asked every 15 seconds
    while a game is live, every minute when one starts within the half hour,
    every 5 minutes otherwise. The TV listings ride along on a separate
    half-hour cache. One game's live feed is about 3 KB and is asked every 12
    seconds while the ball's in play, every minute in a warmup or a rain
    delay, every 5 minutes once it's final. **A hidden tab or a closed screen
    asks for nothing**, and coming back asks straight away rather than
    leaving a frozen game on screen.
  - The clubs' colours and logos are a table in `sports/sports-data.js`
    rather than a request: ESPN's `/teams` endpoint is the one on that API
    that sends no CORS header, so a browser could never read it (the old
    `teamColors()` call had been failing quietly all along), and thirty clubs
    that change once a decade don't need fetching.
  - Standings, the wild card races and the headlines on the MLB tab are still
    ESPN's, and so is every other league.

## v0.4.19

- **The alert crawl only shows weather worth reacting to**: severe watches,
  warnings and emergencies. Air quality alerts, heat advisories and the like
  are dropped rather than shown quietly. House alerts are unchanged.

## v0.4.18

- **The alert crawl (`shared/alerts.js`).** One strip, over any HOMER screen
  and over full-screen video, carrying severe weather and the house.
  - **Severe weather** from the National Weather Service
    (`api.weather.gov/alerts/active?point=lat,lon` — free, no key, and it
    answers a browser directly: `access-control-allow-origin: *`, and its
    preflight names `User-Agent` in `access-control-allow-headers`, so HOMER
    can identify itself the way the NWS asks). Where the house is comes from
    Home Assistant's own config (`get_config`, now kept as
    `HomerHA.location()`); HOMER's weather location answers when Home
    Assistant isn't connected. Polled every 5 minutes, every minute while a
    warning is up.
  - **Three levels, from the NWS's own fields rather than the event's name**:
    `severity` Extreme and happening now or expected is **extreme** (red, the
    edge pulses, stays up); Severe and happening now or expected is
    **warning** (red, stays up); everything else — watches, which are Severe
    but `urgency` Future, advisories, statements — is a **notice** (quiet, and
    it takes itself down after 24 seconds, 10 over video). That pair of fields
    is the whole difference between a Flood Watch and a Flash Flood Warning,
    and it's why the crawl can tell them apart without knowing either name.
    Test and exercise messages and cancellations never show; an alert a newer
    one replaces is dropped.
  - **The house**, from the same buckets a room's "at a glance" line reads
    (`shared/homeassistant.js`'s `GLANCE_BINARY`), so there is one list of
    which sensors matter and one set of device classes, not two. Smoke, carbon
    monoxide or gas is extreme at once; water is a warning at once; a door or
    window open 10 minutes, or the garage open 5, is a notice; the doorbell
    ringing (`HomerHA.onRing`) is a notice for 3 minutes. Open is normal —
    open *for a while* is the thing worth saying. Motion and occupancy raise
    nothing.
  - **One strip, one message**: loudest level first, newest within a level.
    **Esc** or the ✕ dismisses the one showing and the next takes its place;
    HOMER remembers what you've dismissed until that alert itself clears
    (`localStorage: homer-alerts-seen`), so the same door doesn't announce
    itself on every screen, and the same door tomorrow does.
  - **It never takes focus and never moves the screen underneath**: fixed at
    `z-index: 100000` (over the guide's 99999 and Jellyfin's transport
    controls, under the Actions strip's 100001 and the quick panel's 100002),
    nothing in the tab order, and Esc is only the strip's while a message is
    showing — the next Esc is the screen's own Back. It hides itself while the
    Actions strip, the quick controls panel or the phone's menu sheet is up.
  - **Over full-screen video** it's a lower third (`bottom: 11vh`), clear of
    Jellyfin's transport controls, never a dialog; a notice gets 10 seconds
    there instead of 24, so an advisory never sits on a picture.
  - The crawl only crawls when the words don't fit, at about 110px a second,
    and stops crawling under `prefers-reduced-motion`. The NWS's own wording,
    its `instruction` before its `description`, with the product code some
    offices put on its own front line dropped and a 560-character cap — a
    crawl that takes two minutes to come round again is one nobody finishes.
  - A remote with no Esc reaches it through the Actions strip: **Dismiss
    alert**, and **Weather** for a weather alert.
  - **No made-up alert ships.** `HomerAlerts._fetch(url)` takes a real NWS
    payload (`?event=Tornado Warning&message_type=alert&limit=1`) and re-dates
    it to now so a past one isn't read as expired; `_live()` goes back to the
    house's own. Nothing else about the payload is changed.
- **Who's home.** `HomerHA.people()` answers with Home Assistant's `person.*`
  entities — its deduplicated view of somebody across their phones, with their
  picture — and falls back to `device_tracker.*` in a house that never set
  people up. Read only: nothing here calls a service.
  - **Home** shows them in the top bar beside the clock, a person each, their
    picture where Home Assistant has one and their initials where it doesn't;
    in reads lit, out reads flat and grey. The phone layout draws the same row
    (`home/home.js`'s `peopleRow`) under the date.
  - **Rooms** adds whoever Home Assistant places in a room to that room's "at
    a glance" line (`HomerHA.peopleIn(areaId)`). A person is placed by the
    tracker that decided for them (`person.source`); most houses have put none
    of those in an area, and then no room mentions anybody.
  - The made-up house (`homer-ha-mock`) gained three people, a garage door, a
    leak and a smoke sensor, a latitude and longitude, and a front door that
    has been open half an hour — enough to see every rule above without a real
    alert and without touching Home Assistant.

## v0.4.17

- **Cameras' Recent strip shows a real picture of the ring.** Home Assistant
  now saves a still the instant the doorbell is pressed, and HOMER shows it as
  that event's thumbnail instead of a clip's first frame or a plain row.
  - **Two Home Assistant automations**, *Doorbell stills: save a picture of
    every ring* and *…when a person is seen*, call `camera.snapshot` into
    `/media/doorbell/<date>/<ring|person>-<YYYYMMDD-HHMMSS>.jpg`. They live in
    Home Assistant, not here — HOMER only reads what they leave behind — and
    the README says how to find and remove them.
  - They snapshot **`camera.front_door_snapshots_fluent`**, the still-image
    entity, not the streaming one: same 640×480 in the same ~400 ms, but Home
    Assistant fetches a JPEG from the camera's snapshot endpoint rather than
    opening the sub-stream to decode a frame, and the live stream is left
    alone at the one moment the doorbell is busiest.
  - They fire on the **state change**, never a poll. The visitor sensor's
    pulse is shorter than the recorder reliably catches, which is exactly how
    a ring used to end up with no record at all.
  - `cameras/cameras-model.js` reads them back from
    `media-source://media_source/local/doorbell` (a folder per day, newest
    four walked) and lays each still over the event at the same moment —
    within 90 s and matching on kind, rings placed first so they get first
    claim on a clip that was both. **A still that matches nothing becomes its
    own event**, which is not a corner case: the picture is often the only
    trace of a ring the recorder missed. Clips stay exactly as playable.
  - `M.stillUrl(ev)` resolves per paint rather than being held, because a
    media-source URL is signed and expires in about half a minute — the same
    reason `M.clipUrl(ev)` already worked that way. A "No clip" event that has
    a still is no longer dimmed: there's a real picture of it.
  - Worth knowing, measured on the real doorbell: both stills were on screen
    in under a second while **none** of the 22 clip first-frames had decoded a
    minute later — the camera serves playback one request at a time. The still
    isn't just a nicer thumbnail; it's frequently the only one that arrives.
  - **Nothing prunes these.** ~20 KB each, so the rings are negligible and the
    person automation is throttled to one picture per two minutes, but
    `/media/doorbell` grows without limit: Home Assistant ships no service
    that deletes a file, so an automation can't do it. The README has the
    `shell_command` to add when there's file access.

- **Movies and TV Shows can be narrowed down.** Two rows of chips sit above the
  list, in the guide's chip language rather than a second pattern to learn: the
  order on top, then what the list is narrowed to.
  - **Genre** and **decade**, both read off the library itself — the ten genres
    it actually leans on, most-used first, and the decades its years really
    fall in, rather than a list of forty and a range nothing is in.
  - **Unwatched** (a movie you haven't finished, a show with episodes left),
    **Favourites**, and **4K**. The 4K set comes from Jellyfin's own `Is4K`
    filter in one small extra query beside the main one — ids only, no second
    pass over every title's media — so a library with nothing in 2160p simply
    doesn't get the chip. Nor does one nobody has hearted.
  - **Everything combines**, and the search box (**/**) narrows what's left.
    Every chip carries the number of titles it would leave, counted against
    everything else that's on, so a dead end is visible before you press it: a
    chip that would leave nothing goes dim and dashed.
  - **Sorting** is now Recently added, A–Z, Year and Rating, plus **Recently
    aired** on TV Shows (by premiere date). The sort moved out of the list
    header into the chip row and is still remembered per library.
  - **The arrows reach all of it**, exactly as they reach the guide's
    categories: **▲** off the top title goes up into the genre/decade row,
    **▲** again into the order row, **◀ ▶** run along a row, **OK** presses
    (a lit chip turns off), and **▼** drops back onto the title you left.
  - **One press clears it.** **ESC** takes every chip and the search box off
    together, an amber **Clear** chip appears while anything is on, and the
    Actions strip (**M**, or holding OK on the Siri Remote) carries Filters,
    Sort and Clear filters for a remote with no letters.
  - **Nothing matched** now says which filters did it, over the whole stage
    (the preview window has nothing to preview, so it stands aside), with the
    same one press out.
  - **What's on is readable from the sofa**: the lit chips are filled and
    ringed, an active chip that has scrolled off the end is pulled back into
    view, and the list header reads `COMEDY · 1980S` beside `11 of 178`.
  - **Remembered for the sitting, not for good.** Leave Movies and come back
    and the chips are where you left them; come back tomorrow (or after two
    hours) and the whole library is there again. A filter isn't a setting.
  - **On a phone**, the same filters are a row you flick, with the count beside
    the sorts and an amber **Clear** pinned outside the row so it's still
    reachable when the row has been flicked to its end. The row is built once
    and then only updated, so tapping a chip near the end doesn't throw the row
    back to its start.
  - Both layouts take the chips, the counts and the sort order from one place,
    `HomerLibraryModel.makeFilters` / `sortsFor` / `sortCompare`, so they can't
    drift apart. Filtering is one pass over the titles the screen already has —
    178 movies and 18 shows here — not another round trip.
## v0.4.16

- **The phone's top bar is two buttons, not one.** The HOMER mark still opens
  the menu sheet; the **screen's name** beside it now goes back to the top of
  the screen you're on. Before this there was no way out of an album, a book
  or a camera on a phone except a keyboard's Esc — the name looked like part
  of the Home button and did nothing of its own.
  - It's a contract rather than a special case per screen:
    `HomerLayout.setScreenHome(fn, { atTop })`, registered while a screen is
    mounted, last registration wins, `fn()` returning false meaning "already
    at my top". Books, Cameras and Rooms register (the shelf, the wall, and
    backing out of a colour picker, a remote or a camera).
  - Screens that don't register still work, from three defaults that need no
    cooperation: the same route with its query stripped (`#/music?album=…` →
    `#/music`, and the same for `#/books?id=`, `#/rooms?remote=`); the grid a
    details page belongs to (`#/details?id=…` → the Movies or TV Shows grid,
    which is what the name already reads); and failing those a rebuild of the
    screen's module, which opens it at its top. Music uses the last of these
    until it registers one of its own.
  - The name is only drawn as a control — a ‹ beside it, the text lit, a 44px
    target clear of the mark's — while there's somewhere above to go. At the
    top of a flat screen (Home, Weather, Now Playing) it's a plain label and a
    tap does nothing; Home is on the tab bar and at the top of the menu, so
    the name never has to double as a way there.
  - Opening a sub-view changes no route and adds nothing to `<body>`, so none
    of the chrome's usual triggers fire: that one boolean is re-checked twice
    a second while the bars are up and the tab is in front, and the click
    handler asks for itself rather than trusting a `disabled` attribute that
    would go stale between checks.
  - The TV layout is unchanged: its brand is labelled Home (`title="Home (H)"`)
    and every TV screen already draws a clickable **ESC Back** in its key
    legend — Books' even names where it goes ("Shelf") — so the ambiguity this
    fixes doesn't exist there.

## v0.4.15

- **The screen's name in the phone top bar is now its own button.** Tapping
  **MUSIC** from an album or a track goes back to Music's browse page; the same
  on Books, Cameras, Rooms and the library's details pages. The HOMER mark still
  opens the menu. At a screen's top level the name isn't a button, so it never
  does something invisible.

## v0.4.14

- **A star on every track, and a Favorites list.** The star is on every track
  row — the Songs list, an album, **Up next**, Now playing — and on an album's
  own header, on the TV screen and on a phone. Outline when it isn't a
  favorite, filled and amber when it is. **F** stars whatever the focus is on
  (the track under the cursor, or the album, artist or playlist the page is
  about), the star itself does the same without starting the track, and it's in
  the Actions strip so a remote with no letter keys reaches it. The on-screen
  legend says **Favorite** or **Unfavorite** for what F will actually do.
  - **Favorites** is a tab of its own beside Songs (a chip on a phone): every
    track with a star, in artist and album order, and Play / Shuffle / Instant
    Mix work on it like any other list.
  - These are **Jellyfin's own favorites**, so a star here is a star in
    Jellyfin Web, Swiftfin and anywhere else. Nothing is fetched twice:
    `UserData.IsFavorite` already comes back on every item HOMER asks for, and
    the list itself is one `Filters=IsFavorite` query with the rest of the
    library.
  - The star flips the instant it's pressed and is **put back if Jellyfin
    disagrees**; the server's own answer is written over the optimistic one.
    Written with `POST /UserItems/{id}/UserData` (Jellyfin 10.11, which is what
    this server runs), falling back to the older `POST`/`DELETE
    /Users/{userId}/FavoriteItems/{id}`.
  - A star changing repaints the stars on screen rather than rebuilding the
    lists, so the focus — or a thumb — stays where it was.

- **Play on… — an album on a speaker, not in the browser.** A fourth button
  beside Play / Shuffle / Instant Mix on an album, a playlist, an artist or a
  genre (and the same one on a phone) opens a list: **This screen** first, then
  every Home Assistant player that can take music, the one you used last marked
  and focused. Arrows and OK, a mouse, or a thumb; **Now Playing** at the foot
  goes to see it. Only there when Home Assistant is connected.
  - **Every row says what that speaker will really do**, because they don't all
    do the same thing, and the message after the send says what actually
    happened rather than what was hoped for. A player that can only take one
    track gets one track **and says so** — it never quietly plays one song and
    lets you think the record is on.
  - Home Assistant's `media_player.play_media` takes one item and an album is
    eleven, so HOMER's helper on the NAS (`homerfeeds`) mints a short-lived
    **M3U** of the album's Jellyfin streams and HOMER hands over that one
    address. What each family then did, tested on the real house:
    **WiiM/LinkPlay** plays the whole M3U (as one long stream, which is why the
    next bullet exists); **Sonos** refuses a plain M3U outright (UPnP error
    800) and its `MEDIA_ENQUEUE` is a lie for a plain URL — eleven `add` calls
    left a queue of one — but prefixed `x-rincon-mp3radio://` it goes to
    Sonos's radio player, which reads the playlist properly (queue of 11), in
    MP3, since handed FLAC it skips the record in seconds; **Chromecast/Nest**
    gets the first track only (Home Assistant reads the playlist itself and
    casts the first entry, with its name); **Apple TV** gets the first track
    only; **TVs** don't take music at all and are dimmed out.
  - **Now Playing names what HOMER sent where.** A speaker handed one address
    reports the address as its title and no cover, so the card uses HOMER's own
    record of the send — the album, who it's by, and its art from Jellyfin.
  - **Jellyfin's token never leaves the NAS.** `POST /music/playlist` hands the
    helper the track ids and the token and gets back an opaque key, good for
    twelve hours; `/music/p/<key>.m3u` is the album and `/music/t/<key>/<n>`
    one track (a 302 to Jellyfin). A token in `media_content_id` would be
    written into Home Assistant's logbook, its recorder and every debug log
    that repeats a service call. The helper never fetches anything: the only
    addresses it can build are Jellyfin's own, from ids that have to look like
    Jellyfin GUIDs.
  - Speakers playing as a group (two WiiMs, a pair of Sonos) are one row naming
    both rooms, the way Now Playing already folds them.
  - New: `music/playon.js`, `music/playon.css`. `HomerHA` gains `playMedia()`
    and `players()`, and `mediaCommand()` now takes service data.
## v0.4.13

- **Music on a phone:** the album wall is two even columns again. An `fr`
  track floors at its content's minimum width, so one wide cover stretched
  the first column and squashed the second to a sliver; the same guard went
  into the other phone grids that split in two.
## v0.4.12

- **Album art loads on Now Playing again** — and in Rooms and the quick panel.
  Home Assistant's Apple TV integration answers the artwork proxy with
  `200 image/heic` (a real HEIF still, 13 KB of it), and no browser but Safari
  can decode HEIC in an `<img>`, so a good reply was failing silently and the
  card fell back to its icon. Nothing was wrong with the address, the token or
  the DNS.
  - `HomerHA.pictureUrls(id)` now returns every picture worth trying, best
    first: Home Assistant's own proxy, then the artwork's real address, which
    Home Assistant itself puts in the proxy URL's `cache=` parameter. For the
    Apple TV that is the live Apple Music cover with Apple's own
    `{w}x{h}{c}.{f}` template left in it; HOMER fills the template in and gets
    a JPEG every browser reads.
  - `HomerHA.loadPicture(id)` resolves the first one an `<img>` actually
    draws, caches that per picture so a screen repainting ten times a second
    asks the network once, and — where none of them draw — rebuilds from the
    freshest state and tries once more, in case the player's token was
    replaced while it was looking. A failure is forgotten after 30 seconds, so
    a Wi-Fi blip isn't permanent.
  - Where Home Assistant has no usable picture at all, Now Playing looks the
    same album up in **Jellyfin's library** by album, artist and track
    (`HomerPlayingModel.artFor`), and only then falls back to an icon — now
    the icon for what's playing (a note for music, a film, live TV) rather
    than for the box it's playing on, with the track name still large.
  - Rooms, the quick panel and both Now Playing layouts all go through the one
    helper, so a player's cover behaves the same everywhere.

- **A camera that's offline says so** instead of showing a black square.
  The tile keeps its name and room and adds **Camera unavailable** with
  **Last seen 7:13 AM**; the full-screen view says the same where the picture
  would be, with an **Offline** badge. Nothing asks an unavailable camera for a
  still or a stream any more, and its controls are dimmed, marked
  **Unavailable**, and say so when pressed rather than failing quietly. It
  clears itself as soon as Home Assistant has the camera back.
- **Recent keeps working while the camera is away.** The ring and detection
  times come from Home Assistant's history, which is on the server, so they're
  there either way; the clips are on the camera, and `media-source://reolink`
  browses down to the camera and its resolutions but can't list the days
  without asking the camera itself. The strip now shows what it has and says
  why the rest is missing (`HomerCamerasModel.trouble`), instead of looking
  empty with no explanation.
- **Every event on the Cameras screen can be reached with a mouse.** The
  Recent strip is about three times wider than the window — two dozen events,
  eight in view — and the screen swallowed every wheel event, so the sixteen
  off-screen ones could only be reached with the remote's ◀▶. The wheel now
  scrolls the strip (either axis), the highlight follows what's in view so the
  remote picks up where the mouse left off, and the strip has a thin scrollbar
  so there's a sign there's more. The big picture, which has looked like a
  button since it was drawn, now behaves like one: a click plays and pauses a
  clip, or picks out the live view.

## v0.4.11

- **HOMER's own loading screen, instead of Jellyfin's "Page not found."**
  Opening one of HOMER's own pages after a reload — `#/weather`, `#/rooms`,
  `#/cameras`, `#/sports`, `#/news`, `#/books`, `#/music`, `#/playing` — showed
  Jellyfin's 404 first. Jellyfin Web routes long before HOMER's files land, it
  knows none of those addresses, so it painted its own "Page not found" (and
  titled the tab that) until HOMER drew over it. Warm that was about a second
  and a half; cold, or on the Apple TV, where the web view starts empty every
  launch, it was long enough to read.
  - `homer.js` now claims the page in its first few lines, before a single one
    of HOMER's ~65 files has been asked for: `<html>` gets `homer-booting`,
    which blanks Jellyfin's page to HOMER's ground. That is the whole of the
    fix's timing — the claim happens the instant the injector's script runs,
    and everything else can take as long as it likes.
  - `shared/loading.js` (new, loaded first) draws what goes over the top: the
    HOMER mark, the screen's name and a quiet pulse on HOMER's backdrop, sized
    for a phone, a desktop and a TV. It brings itself down the moment a screen
    root is up and showing, a frame later so there's no blank in between, and
    it goes if the address leaves HOMER's pages. It carries its own styles and
    leans on no other HOMER module, because it runs before any of them exist.
  - **It is never left behind.** If nothing has drawn after fifteen seconds it
    says so — "Couldn't open Sports", "HOMER didn't finish loading this
    screen" — with **Try again** and **Home**. Arrows move between the two and
    Back/Esc goes Home, so the Apple TV's remote can get out of it too.
  - **The tab says the screen's name**, and keeps saying it. Jellyfin sets
    "Page not found" whenever it routes one of HOMER's addresses, which is why
    Weather sat under that title even after it had drawn; the name is put back
    now, not just at the start.
  - Moving between HOMER's own screens is usually instant, so there the
    loading screen waits 200ms before showing itself: a screen that draws
    straight away never flickers, and one held up (its stylesheet still
    coming) is covered.
  - On a phone it sits between HOMER's bars, the way every phone screen does,
    so the top bar and tab bar stay usable. On a cold load there are no bars
    yet and it simply fills the window.
  - An address that was never HOMER's is left alone, so Jellyfin's real 404
    still answers for it.
## v0.4.10

- **Now Playing on a phone:** "Nothing is playing" no longer sits under the
  cards when something is. The screen's own layout rule was beating the
  browser's `hidden`; the shared phone chrome and TV shell now reset `[hidden]`
  as well, so no screen can hit it again.

## v0.4.9

- **A tap on the HOMER mark on a phone opens the menu** (`HomerMenu.openSheet`,
  `shared/menu.js`). The tab bar has five screens and HOMER has fourteen, so
  Now Playing, Books, Music, Weather, Sports, News, Rooms, Cameras and Settings
  were only reachable from a row of buttons on Home that you had to know was
  there. The mark now slides up a sheet with the whole list: the same items in
  the same order and with the same icons as the TV's rail, **Home** added
  first, and the screen you're on ticked.
  - `shared/layout.js` only wires the tap (`.hp-brand` →
    `HomerMenu.toggleSheet()`, still `goHome()` when menu.js isn't loaded), so
    there's one list rather than a phone copy of it. The mark grew a caret
    that turns over while the sheet is up.
  - The sheet sits *between* the bars, so the top bar and the tab bar stay
    visible and unblocked. A tap outside — the bars included — dismisses it
    and does nothing else, the way a sheet behaves anywhere else on a phone;
    tap again to use what's under it.
  - **Back closes the sheet rather than leaving the screen.** Opening it
    pushes one history entry at the same address, keeping whatever state was
    there (so `shared/player.js`'s docked mark survives), and the browser's
    Back takes that entry instead of the page. Tapping a row drops the entry
    *before* it navigates — `history.back()` is asynchronous, so doing it the
    other way round popped the screen you'd just gone to — which leaves one
    history entry per screen change and Back landing where you started.
  - A swipe down closes it too, but only from the top of the list, so a
    scrolled list scrolls instead of dismissing. Esc and the Apple TV's Back
    close it without the screen underneath going back as well.

## v0.4.8

- **Now Playing** (`#/playing`, the menu's **Now Playing** item): everything
  playing anywhere in the house on one screen, with the controls for it. No
  video — artwork only.
  - `playing/playing-model.js` gathers the three places something can be
    playing and hands both layouts one list of cards: Jellyfin's `/Sessions`
    (asked again every 4s while the screen is open, every 15s in a background
    tab), every Home Assistant `media_player` that isn't idle (pushed, so no
    polling), and HOMER's own music in this tab (`music/music-model.js`,
    controlled directly — and the Jellyfin session it reports is dropped so it
    isn't on screen twice).
  - A card shows the cover, the show and the episode (or the film, or the
    track), the device, the room and the user, and a progress bar. Positions
    are sampled, not streamed: a card carries where it was and when that was
    read, and the bar runs on its own between samples instead of asking the
    server every frame.
  - Controls per card, only the ones that player actually takes: ⏮ ⏯ ⏹ ⏭,
    mute and a volume pill (◀ ▶ set it; a press at either end moves the focus
    on instead, so a slider is never somewhere you can't arrow out of). A
    player that only steps its volume gets − + rather than a level. Jellyfin's
    volume and mute appear only where the client lists them in
    `SupportedCommands`.
  - Speakers playing together (Sonos, WiiM multiroom) are one card naming the
    rooms, with play, pause and the skips going to the one leading the group.
    An Apple TV or a Samsung TV card also offers **Remote**, which opens the
    remote Rooms already draws (`#/rooms?remote=…`).
  - Active things are big, one card each, most recently started first.
    Players that are on but idle collapse into a quiet line at the bottom
    ("Ready: Kitchen, Office…") instead of competing with them.
  - The main menu runs down the left, so the screen doubles as the way into
    every other one. Its own phone layout (`playing/playing-phone.js`) is the
    same cards in one column with thumb-sized buttons, and no menu — the tab
    bar already has the screens.
  - Registers its actions with `HomerActions.provide` (Play/Pause as the main
    action, Stop, Mute, Remote, Check again), so an Apple TV's remote reaches
    them by holding OK.
- **The main menu is one list, in one of two treatments** (`shared/menu.js`,
  `shared/menu.css`), drawn by Home and by Now Playing.
  - It used to live in `home/home.js` and shrink a little more every time an
    item was added (`.hm-menu-8` … `.hm-menu-12`): thirteen items later the
    rows were 30px tall and 21px text, which is not a menu you read from a
    sofa. Those classes are gone.
  - **A. Big rows that scroll** (`homer-menu` = `rows`, the default): rows back
    at the size they were with seven items (52px tall, 27px text), about seven
    visible. ▲▼ walk the column and scroll it, and the focus never leaves it;
    an arrow at the top or bottom edge says there's more that way and pages
    when clicked, and the row the column is cut off at fades.
  - **B. An icon rail** (`homer-menu` = `rail`): a narrow column of large
    icons the height of the screen, the focused one naming itself in a tab
    beside it. The items share out the height, so any number of them fit
    without scrolling, and Home's On Now panel and rows — and Now Playing's
    cards — move left into the ~300px it gives back.
  - Which one is a `localStorage` setting per device
    (`localStorage['homer-menu']`), so the two can be compared side by side;
    `HomerMenu.setStyle()` redraws every open menu at once. Both work with a
    remote (▲ off the top item still reaches Home's search box), a mouse and
    touch, and neither hides anything behind a submenu.
  - The list gained **Now Playing** (second, after the guide); the phone Home
    gained a **Playing** button beside Sports and News.
- `shared/shell.css` gained the `hn-` prefix for Now Playing's stage, top bar
  and legend. The made-up house (`localStorage['homer-ha-mock']`) gained a
  length and a position on its Sonos pair and its Apple TV, and now also
  stands in for Jellyfin's sessions, so a screenshot of Now Playing doesn't
  have to have the family's real viewing in it.

## v0.4.7

- HOMER's Apple apps (`apple/`) are now an Apple TV app **and** an iPhone and
  iPad app from one project, sharing a `HomerKit` group; only the input and
  the platform's own tricks differ.
  - The apps set `window.HOMER_APP = { platform, version }` (`tvos`, `ios` or
    `ipados`) and fire `homer-app` events for the buttons that aren't keys
    (OK held down, swipe up, swipe down). The Apple TV also sets the old
    `window.HOMER_TVAPP` and fires `homer-tv`, so a released HOMER keeps
    working.
  - HOMER draws by platform: the Apple TV keeps the TV layout with no touch,
    no cursor and the Large guide; an iPad draws the TV layout with touch; an
    iPhone draws HOMER's phone layouts, as in any phone browser.
  - On the iPhone and iPad: Music keeps playing with the screen locked or
    another app in front, the lock screen shows the track with play/pause,
    skip and scrub, and a video can pop out into picture in picture.

## v0.4.6

- **Music** (`#/music`, Home's **Music** item): your own music from Jellyfin's
  Music library, on the TV, and it **keeps playing while you browse HOMER**.
  - The player (`music/music-model.js`) owns its own `<audio>` element on
    `document.body` and is loaded by `homer.js` on every page, not by the
    screen, so leaving `#/music` doesn't stop it. Every other screen gets a
    now-playing strip in the corner (`music/music-strip.js`) with the cover,
    the track, a hairline of progress and ◀◀ ▶ ▶▶; it hides itself on the Music
    screen, under the guide and in full-screen video. The media keys work from
    anywhere while something is loaded, and the Actions strip gains Play/Pause,
    Next track and Music.
  - **Browse** is a column down the left — whatever the focus is on, its cover
    big, who it's by, and Play / Shuffle / Instant Mix — beside a wall of album
    art, with tabs for Recently Added, Artists, Albums, Songs, Playlists and
    Genres. An album or playlist page lists every track (the one playing lit);
    an artist or genre page lists their albums.
  - **Instant Mix** is Jellyfin's `/Items/{id}/InstantMix` — "radio from this"
    — on an album, an artist, a genre or a track (**I**).
  - **Now playing**: the cover, the track, artist and album, where you are,
    what's next, and **synced lyrics** from `/Audio/{id}/Lyrics` — the line
    you're on lit and scrolling, with the rest faded past the panel's edges.
    Plain lyrics show unlit. The right column switches to **Up next**, the
    queue, and OK on a row jumps to it.
  - Shuffle keeps the album's own order beside it, so turning shuffle off puts
    the record back in order where you are; repeat is off / all / one; volume,
    shuffle and repeat are kept per device. Playback is reported to Jellyfin
    (`/Sessions/Playing`, `/Progress`, `/Stopped`, with the queue), so the
    server knows what's playing.
  - Starting music stops HOMER's video; starting a video pauses the music.
  - **Keys:** arrows and OK; Space or **P** play/pause; **N** / **B** change
    track; **S** shuffle; **R** repeat; **I** Instant Mix; **+** / **−**
    volume; ◀ ▶ on the progress bar seek 10 s and on the volume pill change the
    volume; Esc goes back a view, then back a screen, and the music carries on.
  - **A phone layout** (`music/music-phone.js`): chips, the art two across,
    sheets for an album or an artist, a mini player above the tab bar, and Now
    playing with a volume slider and the lyrics.
  - Empty library: the screen says so and how to fix it, the way Books does.
  - **Not gapless.** The next track is preloaded while the current one
    finishes, so the join is short, but the two aren't stitched
    sample-accurate.
- **Fixed:** Jellyfin Web fires `pagehide` on its own in-app navigations, so a
  player that stops on `pagehide` stops every time you change screen. The music
  player reports its position on `pagehide` and only stops on `beforeunload`.
  (Books stops on leaving on purpose, and is unchanged.)
- Home's menu takes an eleventh item (`hm-menu-11`).

## v0.4.5

**Cameras** (`#/cameras`, Home's menu after Rooms, the **Cameras** chip on
Home on a phone): every camera in the house on one wall, and the doorbell's
rings and clips where you can see them.

- **The wall.** One tile per camera, the doorbell first and twice the size,
  each with its name, its room and a still that refreshes every few seconds.
  The tile with focus upgrades to the live stream after about a second and
  says **Live**, so only one stream runs at a time; a doorbell's tile says
  when it last rang. **OK** opens a camera full screen, **Esc** comes back.
- **A camera, full screen.** The live view large (Home Assistant's HLS through
  hls.js, the refreshing still until it starts), the camera's own controls
  beside it, and a strip of what it saw underneath. **▲▼** moves between the
  three, **◀▶** runs along a row; everything is registered with the Actions
  strip (`HomerActions.provide`), so the Siri Remote reaches all of it.
- **The controls are the camera's real ones**, found on its own Home Assistant
  device: **Siren**, **Quick reply**, **LED** (Off · Auto · At night · Always
  on, **OK** steps through), **Privacy mode**, and its **Battery** where it has
  one. A camera with none says so. Nothing risky is offered — no restart, no
  firmware, no sensitivity.
  - `shared/homeassistant.js` now keeps those four current: Home Assistant
    files them as config/diagnostic entities, which kept them out of `states`
    entirely. They stay out of Rooms (`kindOf` still calls them hidden); only
    the Cameras screen asks for them, by name, and only on a device that has a
    camera. New: `HomerHA.siblings(id)` (the other entities on an entity's
    device).
- **Recent: the rings and the detections, newest first** — *Ring · 4:12 PM*,
  *Person · 3:58 PM* — with the clip's length on its thumbnail and rings in
  amber. **OK** plays that clip in the big view; **Esc** goes back to live.
  - They come from the camera's own recordings, published by Home Assistant's
    Reolink integration at `media-source://reolink` (camera → resolution → day
    → clip). HOMER reads the integration's own clip titles
    (`19:00:39 0:02:32 Motion Vehicle Person Doorbell`) for the trigger and the
    exact start out of the media id, and asks for the low-resolution copies.
    New: `HomerHA.browseMedia`, `HomerHA.resolveMedia`, `HomerHA.history`.
  - **Home Assistant hands out no thumbnail for those clips and keeps no stills
    of its own**, so a tile's picture is the clip's own first frame, in a
    paused muted `<video>`, two at a time so a battery camera isn't asked for a
    dozen files at once. A media source that does carry a thumbnail is used as
    it is.
  - Where a camera keeps no clips, the events fall back to Home Assistant's
    history of the ring and detection sensors: right times, no picture, marked
    **No clip**. Where both have the same moment, the clip wins. (A ring often
    leaves *no* trace in the recorder — the visitor sensor's pulse is shorter
    than the recorder's resolution — so the camera's clips are the reliable
    record, not the history.)
- **Four cameras that aren't up yet** (Driveway, Backyard, Garage, Side Yard)
  hold their squares, marked **Not set up yet**, so the wall is the right shape
  before the bulb cameras go up. They're the `PLANNED` list in
  `cameras/cameras-model.js`: give a Home Assistant camera a name that matches
  one and its placeholder becomes the live tile on the next refresh, with no
  code change and no reload. A camera matching none of them still appears,
  after the placeholders.
- **A phone layout** (`cameras/cameras-phone.js`): one column, the doorbell
  first with its Recent strip right under it, then the rest and the
  placeholders. A tap opens a camera one level deep — live view, controls,
  its own Recent — with **‹ Cameras** back.
- Also: `shared/player.js` and `shared/layout.js` know `#/cameras` is HOMER's
  own page; `shared/shell.css` grew the `hc-` prefix; Home's menu has an
  eleven-item size.
## v0.4.4

- **The hubs' channel lists follow Guide size.** The list of channels under
  the TV window in **Sports** and **News** was too small to read from across
  the room. At **Large** (Settings → **Guide size**, the same setting the guide
  uses) its rows are 98px instead of 70px, with the channel name, number and
  the now/next line about 40% bigger — about three and a half channels at a
  time instead of five, scrolling for the rest. **Standard** is unchanged.
  Changing the setting changes an open hub straight away, as it does an open
  guide (`guide/guide.js` announces it; `shared/hub.js` listens, and checks
  again on its own tick). Nothing else on the screen moves: the TV window, the
  tabs, the legend and the ticker keep their places at 1920x1080 and at
  1600x900, and a phone is unaffected.
## v0.4.3

Two things a Siri Remote couldn't do, and one it couldn't reach.

- **Guide size: Standard or Large** (Settings → **Guide size**). Standard is
  the guide as it was — five channels and three hours of listings at a time.
  Large is four channels and two hours, with the titles, channel names and
  numbers about 40% bigger, for a TV across the room; the info panel, the
  preview and its now/next bar, and the legend keep their places, so nothing
  spills out of the stage at 1600x900 or 1920x1080. Changing it redraws an open
  guide where it stands, on the same channel and program — nothing reloads.
  - Large by default in HOMER's Apple TV app (`window.HOMER_TVAPP`), Standard
    in a browser; a choice made in Settings always wins and is kept per device
    (`homer-guide-size`). The phone guide is unaffected.
- **An Actions strip, for a remote with no letter keys** (`shared/actions.js`).
  Holding **OK** on the Siri Remote for about half a second — or **M** on a
  keyboard — puts up a strip of what the screen on top can do right now, each
  action with its name, its icon and the letter it teaches. Arrows move, OK
  runs, Back/Esc closes. Every screen registers its own real keys with it
  (`HomerActions.provide`), so the strip never offers anything the keyboard
  couldn't already do; it always ends with Guide, Home and Quick controls.
  - A **swipe up** on the clickpad runs the screen's one main action without
    the strip: Skip 30s in the full-screen player, Search on Search,
    Play/Pause in Books, and the Guide from everywhere else. A **swipe down**
    closes the strip, or the quick controls panel.
  - The Apple TV app fires `homer-tv` CustomEvents on `window`
    (`menu`, `swipe-up`, `swipe-down`); HOMER only listens.
- **Filter chips and tab rows are part of the arrows now**, everywhere they
  appear, since a remote can't press the letter that used to be the only way
  in. **▲** off the top of the grid or list moves up into the row, **◀ ▶** run
  along it, **OK** picks and **▼** drops back onto exactly what you left.
  - The guide's category and country chips (**C** and **[ ]** still work), and
    the guide's row slides a chip into view when it sits past the end of a
    16:9 screen.
  - The Sports and News hub tabs, fixed once in `shared/hub.js`: arrowing onto
    a tab no longer switches to it — **OK** does — so you can look along the
    row and come back down. **[ ]**, Page Up/Down and 1–9 are unchanged.
  - Search's result groups, the Movies and TV Shows sort switch and
    Recordings' tabs already had a focus zone; they now take Space as OK and
    use HOMER's shared focus ring. On those three the chip still applies as
    the remote moves onto it, which is how they have always worked.
  - The focused chip uses HOMER's focus ring and stays telling apart from the
    one that's applied.
- Nothing changes for a keyboard beyond the new **M**.

## v0.4.2

- **A real remote for an Apple TV or a Samsung TV** (Rooms → the player's
  card → **Remote**, or **Remote** in the **L** quick controls). A ring of
  arrows around OK, then Back, Home, Play/Pause and the volume, beside the
  device and what's on it. HOMER's own keys go to the device (arrows, OK,
  Esc/Backspace, Space, + and −, Page Up/Down, T for Home) and light the
  remote as they go; a held arrow repeats about six times a second. **H**, or
  **Back** held for about half a second, comes out of it. On a phone it's a round
  pad with big buttons and a light buzz on each press.
  - Home Assistant does the sending: `remote.send_command` on the `remote`
    entity that shares the player's device, with the Apple TV's command names
    or the Samsung's `KEY_` codes.
- HOMER's Apple TV test app (`apple-tv/`): HOMER full screen in the Apple TV's
  hidden web view, with the Siri Remote as arrows, OK, Back and Home. When it
  sets `window.HOMER_TVAPP`, HOMER always draws its TV layout (never a phone
  layout or touch) and hides the mouse cursor.

## v0.4.1

- News has a phone layout: the sections in a row you swipe, a **Watch CNN**
  button (CNN never starts on its own), the lead story, then one row per
  story. Tapping a story opens it with a button to read the article in a new
  tab. The headline ticker stays as a slim strip.
- News' Local section leaves out national stories already in Top or US.

## v0.4.0

- **Sports** (Home → Sports, `#/sports`): ESPN plays in the TV window, every
  sports channel is listed under it with what's on, and an ESPN-style ticker
  runs along the bottom. Tabs:
  - **My Teams**: the Rangers, Cowboys, Longhorns and Arsenal, each with its
    next or live game and our channel for it.
  - **MLB**, **NFL**, **College FB** (AP Top 25, SEC, Big 12), **Soccer**
    (Premier League table, Champions League), **NBA**, **NHL** and **College
    Hoops**.
  - Scores come from ESPN and refresh every 15 seconds while a game is live.
- **News** (`#/news`): CNN in the TV window and every news channel under it.
  - Tabs: Top, US, World, UK, France, Business, Local and Tech. Each shows
    stories from about 50 publishers' feeds (NYT, WaPo, NPR, BBC, the
    Guardian, Al Jazeera, DFW stations…), merged when several papers carry
    the same story.
  - OK opens a story with a QR code, so you can read it on your phone.
  - A headline ticker runs along the bottom.
- **Books** (`#/books`): the audiobooks in Jellyfin's Books library on a
  shelf. Each has a chapter ruler, a book page, and a listening screen with
  speed and a sleep timer. Where you left off is saved in Jellyfin.
- **Get it** (Sonarr and Radarr):
  - Search has a **Get it** group for shows and movies you don't have yet;
    OK adds one, then asks once more to confirm.
  - On a series in the guide or Search, **E** gets all its new episodes.
- The guide has **Canada** (the 2000s) and **Other** (world news, the 7000s)
  country buttons. Categories follow the lineup's number blocks.
- Sports and News are built on one shared hub screen (`shared/hub.js`, TV
  window + channel list + tabs) and ticker (`shared/ticker.js`), so the next
  hub is configuration, not a new screen.
- Home's menu: Sports, News and Books are in; Search moved out of the list,
  since the search box sits right above it (▲ or `/`).

## v0.3.19

- Rooms controls most of what Home Assistant can. Each room now shows, after
  its scenes, lights and cameras:
  - **Switches & outlets**: plugs and power strips (a Kasa strip's outlets,
    with the strip's own switch as **All outlets**), on/off.
  - **Media**: a card per player with what's playing and its art; ◀▶ sets the
    volume and OK plays or pauses on the card, and the rows under it have the
    player's buttons (skip, mute, power) and its inputs, only what the player
    supports. A Sonos or WiiM group shows once, under the speaker leading it
    (one in another room says "With Living Room"); the same speaker or TV
    coming in through two integrations (itself, DLNA, Cast) shows once.
  - **Fans**: the air purifier on/off, its speed or modes, and its own
    settings under it (child lock, favorite level).
  - **Automations & helpers**: automations on/off (enabled), toggles, and
    scripts and buttons to run.
  - **At a glance**, under the room's name: its temperature and humidity, a
    door or window left open, motion now, the air, smoke or a leak.
- The thermostat (Climate) has its own settings under it: the ecobee's
  **Current mode** (home, sleep, away) and **Clear hold**.
- Lights: wall switches first, then the bulbs, under their own headings. A
  bulb that does color has a dot in its color; **C** (or a click on the dot,
  or a tap on a phone) opens its colors: eight colors and three whites, a
  warm-to-cool white strip and a color strip. The room's **All lights** takes
  a color too.
- The quick controls over a video list wall switches, then bulbs, and add
  **Now playing** for the room's players that are on (◀▶ volume, OK
  play/pause).
- Left out: sirens and anything that sets one off, alarm panels, buttons that
  restart or reset a device, and devices whose integration isn't running
  (Home Assistant only remembers them: the disconnected fridge and oven, the
  sync box). Anything else that's unavailable is dimmed, with no controls.
- Search: **On TV** lists every airing in the guide that matches, on now or
  still to come (the guide reaches about three days out), not just the next
  three hours: a show's library results and its upcoming airings together.
  Each row says when: **Live**, **In 25m**, or **Tonight**, **Tomorrow** or
  the day. An airing that hasn't started leads with **Record** (Watch channel
  second); **R** records the highlighted airing from anywhere in the list.
  Pressing it again asks, then cancels (or stops one that's recording). Rows
  and details show **Set to record** / **Recording**.
- Search: a show with nothing still to come in the guide says so under its
  results: **Not on TV through Wednesday** (however far the guide reaches),
  or **Not on TV again through Wednesday** with when it was last on ("Last
  on FX and FXX, today at 8:00 PM").
- Player: **Skip 30s** for commercials. On a recording (or anything else with
  a timeline), the button in the full-screen player's bar, **S**, or a
  remote's fast-forward jumps ahead 30 seconds. Presses add up ("+1:30" at the
  top of the picture) and the video jumps once they stop, so a whole break is
  one jump. It replaces Jellyfin's fast-forward button; ◀ still goes back 10
  seconds. Not on live TV.
- Back from a channel you tuned in the guide goes back to the guide, where
  you were in it, with the video docked in the screen you opened the guide
  over; Back again leaves the guide. (It used to go Home.) Show and movie
  pages already came back to themselves.
- Esc on a guide opened over a screen closes just the guide; the screen
  underneath no longer also goes back a step.
- No white flash between screens during playback (the first time a screen
  opens, while its styles load): the page behind HOMER stays its dark blue.

## v0.3.18

- Rooms: TP-Link wall switches (Kasa HS200/HS210/KS200 in-wall switches,
  which Home Assistant keeps as switches, not lights) are with each room's
  lights, after the room's "All lights" and before the bulbs: on/off, no
  dimming. One named just for its room ("Dining Room Light") reads **Wall
  switch**; one that runs a fan gets a fan icon. Plugs and power strips stay
  out. A room with only a wall switch (Hallway, Back Porch) now shows up.

## v0.3.17

- Rooms: the thermostat is the house's, not a room's. It has its own
  **Climate** item under Cameras at the top of the list (a chip on a phone),
  showing the temperature and humidity inside, the set point with − / + and
  the modes; the rooms show only their lights, scenes and cameras (a room
  still shows the temperature in its summary). The quick controls over a
  video keep the thermostat at the bottom.

## v0.3.16

- Rooms leaves out a Home Assistant room named "Unused" and what's in it.
- Home Assistant sign-in comes back to a fresh `/web/index.html` address (a
  cached copy of the bare `/web/` could lack HOMER), and Rooms opens as soon
  as the sign-in finishes.

- **Rooms**: Home Assistant's rooms on a HOMER screen, once it's connected in
  Settings. Home's menu gets a **Rooms** item (the menu fits eight items in
  the same space; without Home Assistant it's the seven it was). The rooms
  are a list at the left (what's on and the temperature for each, **Cameras**
  first); a room shows its thermostat (◀▶ sets the temperature, the modes in a
  row under it), its scenes (◀▶ picks, OK turns one on), its lights (a row
  each: ◀▶ dims in 10% steps, OK switches, amber when on) and its cameras.
  A room's own light group reads **All lights**. Esc goes back a step.
- **Cameras**: a grid of stills that refresh every few seconds, and OK opens
  one large at the camera's own shape, live when it streams (Home
  Assistant's HLS) and a still every second until then, with ◀▶ to the next
  camera. A doorbell shows the day's rings and when it last rang. Stills-only
  twins of a camera (Reolink's "Snapshots" cameras) are left out.
- **Quick controls over a video**: **L**, or a lightbulb in the player's
  controls, opens a panel at the right over whatever's on (a full-screen
  video, a docked one, any HOMER screen) without stopping it: one room at a
  time (◀▶ on its name changes rooms, and it remembers), its scenes and
  lights, and the house's thermostat pinned at the bottom. **L** or **Esc**
  closes it, and so does 20 seconds without a key. On a phone it's a sheet from
  the bottom.
- **The doorbell**: when Home Assistant says it rang, the doorbell's camera
  comes up small at the top right over whatever's on. **OK** opens it in Rooms
  (a playing video docks in Rooms' preview), **Esc** puts it away, and it goes
  by itself after 30 seconds. Nothing else on the remote changes while it's up.
- Rooms on a phone: room chips along the top, then the room's thermostat
  (− and +, the modes as buttons), scenes in a row you swipe, and its lights
  (tap to switch, drag the bar to dim); a camera opens full width. Phone Home
  gets a **Rooms** button beside Settings.
- **Settings → Home Assistant**: the address (typed, or set per HOMER address
  in the injector script as `window.HomerConfig`), **Connect**, which signs in
  on Home Assistant's own page and comes back to Settings, and **Disconnect**
  (press twice), which also tells Home Assistant to forget the sign-in. Each
  device keeps its own sign-in. No password or token is in HOMER or the
  injector config.
- Under the hood: shared/homeassistant.js (the sign-in and its refresh, one
  WebSocket with a ping and reconnecting, the rooms from Home Assistant's
  areas, devices and floors, the controls with the new value showing at once
  and the remote's repeated presses sent as one, camera stills and streams,
  the doorbell). rooms/rooms.js and rooms/rooms-phone.js are the screen,
  rooms/quick.js the panel and the doorbell. HomerPlayer counts #/rooms as a
  HOMER page. Home Assistant needs no configuration change on the local
  network; see the README for reaching it over Tailscale.
## v0.3.15

- Weather: a device's own location is named by its nearest town ("Plano,
  TX") instead of "This device's location", on the Weather screen, the
  clock's weather and Settings. The name comes from the National Weather
  Service in the US and BigDataCloud elsewhere, asked once per spot (rounded
  to about 1 km) and remembered.

## v0.3.14

- A show's page lists its seasons newest first (by when they aired, so a
  season numbered by year doesn't jump ahead; Specials last), and each
  season's episodes newest first, so what's new is at the top. A show that's
  still airing opens on its newest season; one that's ended still opens
  where you left off. TV and phone layouts both.

## v0.3.13

- Phone guide: in landscape, a docked video shows through its strip (the
  backdrop behind the strip hid it).

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
- Movies and TV Shows on a phone are a poster grid, three across (more in
  landscape), under a filter field and the A–Z / Recently added chips with
  the count. Posters show where you are with each title: a blue dot for
  unwatched, a progress bar (and the time left) for one you're partway
  through, a check for watched, and a show's unwatched count. A tap opens the
  title's page. Coming back lands where you were in the grid.
- A movie's page on a phone: its art, then the title, year, rating, runtime,
  score and genres, when it would end, full-width **Resume** and **Restart**
  (or **Play**), the overview (four lines, **More** for the rest) and the
  About rows (director, writers, cast, studio, video, audio, subtitles).
- A show's page on a phone has the same top, with **Resume S1 E4** /
  **Restart** (or **Play**) for the next episode, then the seasons as chips
  that stay at the top while you scroll, and the season's episodes: still,
  number, title, runtime and progress, with the next one marked. A tap on an
  episode plays it, or resumes it if you're partway through; **↺** on one in
  progress starts it over. A season's or an episode's page is its show's, at
  that season (and that episode).
- Playing from those pages goes full screen, as on TV; Back from there docks
  the video in a strip at the top of the Movies, TV Shows or title page you
  land on (beside it in landscape), like the phone guide. A tap on the strip
  goes full screen, **✕** stops it. Library videos aren't stopped when the
  phone is pocketed; only live TV is.
- Under the hood: the library screens' data (lists, seasons, episodes, cast
  and media details, watched state, playback) is in library/library-model.js,
  shared by the TV layout and the phone one (library/library-phone.js). The
  TV screens look and work exactly as before.
- Settings on a phone is one column: each setting with what it's set to,
  and a tap opens its choices right under it (one at a time, one level
  deep), with whether it's saved to your account or kept on this device,
  what it does, and a check on the current value. A tap on a choice saves
  it, as on TV. Weather location's ZIP code box brings up the number pad,
  stays above it, and has its own Save button. Sign out still asks for a
  second tap. Who's signed in and the server are at the bottom. Nothing
  spills off the side any more. In landscape the choices go two to a row.
- Weather on a phone is one column that scrolls: the place and what's
  coming, Now (with feels like, humidity, wind and the next sunrise or
  sunset), the next 14 hours in a strip you swipe sideways, the radar
  across the full width (its map, lines and town names drawn for the
  panel's size, with the time of each picture), then the next three days.
  Now and the days keep their illustrated skies, under a heavier scrim. In
  landscape, Now sits beside the radar and the days go side by side. No
  clock and no key legend; the weather stays in the top bar.
- On both, a video playing in a preview window docks at the top, with what's
  playing, Full screen and **✕** under it.
- Under the hood: Settings' settings and saving (settings.js createModel) and
  Weather's forecast, sentences, skies and radar (forecast.js) are shared by
  the TV and phone layouts, which live in settings/settings-phone.js and
  forecast/forecast-phone.js. The TV screens look and work exactly as
  before.

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
