# HOMER for Jellyfin

A TiVo-style TV-appliance interface for Jellyfin Web: a HOMER Home screen, the
Channel Guide, Movies and TV Shows screens, and a global skin so every remaining
Jellyfin page matches. On a phone, HOMER has a phone layout (see
[On a phone](#on-a-phone)).

## Home

Home replaces Jellyfin's home page: a main menu (Live TV Guide, Now Playing,
Movies, TV Shows, Books, Music, Recordings, Weather, Sports, News, Settings,
and Rooms and Cameras once Home Assistant is connected), an On Now panel, and
rows of Continue Watching, Up Next, On Now and Recently Added. The search box
sits above the menu (▲ or `/`).

- **Watch** plays the channel in the On Now preview window, and Home stays up
  so you can keep browsing. The panel shows what you're watching, with
  **Full screen**, **Guide** and **Stop**.
- **H**, or the HOMER logo at the top left of any HOMER screen, comes back to
  Home from anywhere.

### The main menu, in one of two treatments

The menu is one list (`shared/menu.js`), drawn on Home and on Now Playing, so
both screens agree on what HOMER has and neither hides anything behind a
submenu. It comes in two treatments, and which one a device uses is a
`localStorage` setting:

```js
localStorage.setItem('homer-menu', 'rows');   // A: big rows that scroll (default)
localStorage.setItem('homer-menu', 'rail');   // B: an icon rail down the side
```

- **A. Big rows that scroll** — rows at the size they were when Home had seven
  items (52px tall, 27px text), about seven visible at once. ▲▼ walk the
  column and scroll it; the focus never leaves it. A small arrow at the top or
  bottom edge says there's more that way (and clicking it pages), and the row
  the column is cut off at fades.

  ![Home, big rows](docs/screenshots/menu-a-rows.jpg)

- **B. An icon rail** — a narrow column of large icons the height of the
  screen, the focused one naming itself in a tab beside it. It fits any number
  of items without scrolling (they share out the height), and the On Now
  panel, the rows and the Now Playing cards all move left into the ~300px it
  gives back.

  ![Home, the icon rail](docs/screenshots/menu-b-rail.jpg)

Both work with a remote (▲▼ move, OK selects, ▲ off the top item goes to the
search box), a mouse and touch. On a phone there's no column for either, so
the same list is a sheet: tap the HOMER mark in the top bar (see
[On a phone](#on-a-phone)).

## Watching while you browse

A video keeps playing while you move around HOMER. Every HOMER screen (Home,
Movies, TV Shows, show and movie pages) has a preview window, and the video
sits in it, still playing, as you go from screen to screen.

- **Back** from full screen (the player's ← button, **Esc** or **Backspace**)
  shrinks the video into the screen you came from, and it keeps playing there:
  the show or movie page you pressed Play on, or the guide you tuned the
  channel from (back where you were in it, with the screen you opened it over
  underneath).
- **Full screen**, **F**, or a click on the preview window takes it back to
  full screen. **Play** on something else also goes full screen.
- **H** or the player's **Home** button takes the video to Home's preview.
- **Stop** on Home ends it. When a video ends by itself, you stay on the screen
  you're on.
- While a video plays behind HOMER, the arrow keys, space and the trackpad
  control HOMER, not the player. The trackpad never changes the volume, even
  in the full-screen player.
- The browser's own Back (a phone's back button or swipe, the trackpad swipe,
  Cmd+[) goes back a screen and the video keeps playing. From Home, where
  there's nowhere to go back to, it stops the video. In full screen, if the
  video was in a preview window before, it shrinks it back there, like **Esc**.
- Jellyfin's own pages (the dashboard, sign-in) still stop the video when you
  open them, because Jellyfin stops video whenever you leave its player.

### Skipping commercials

On a recording, or anything else with a timeline, the full-screen player's
**Skip 30s** button (where Jellyfin's fast-forward was), **S**, or a remote's
fast-forward jumps ahead 30 seconds: one commercial. Presses add up (+1:30
shows at the top) and the video jumps once you stop, so a whole break is one
jump. Jellyfin's ◀ (back 10 seconds) takes back an overshoot. Live TV has no
timeline, so the button isn't there.

## Movies and TV Shows

![Movies](screenshots/library-movies.jpg)

Movies and TV Shows open in a "My Shows" style list: titles on the left, the
selected one's art, details and Play / Resume / Restart on the right. Sort A–Z
or by Recently Added, and press **/** to filter. A show opens to season tabs
over an episode list. Arrow keys move, OK plays, Esc goes back.

![TV Shows](screenshots/library-series.jpg)

## Weather

Home's **Weather** item opens a forecast board laid out like a TV weather
segment, for the same place as the clock's weather (set per device in
Settings → Weather location):

- A title band with the place and what's coming, in a sentence.
- **Now**: the temperature and conditions, feels like, humidity, wind, and the
  next sunrise or sunset. Below them, the next 14 hours two at a time:
  conditions, temperature and chance of rain.
- **Radar**: the last hour of the National Weather Service's radar, played as
  a loop over a navy map centered on the place (county and state lines, dim
  interstates, the bigger towns), with the time of each picture. The rain is
  exactly as the NWS draws it. US only; elsewhere the panel says there's no
  radar.
- **Next 3 days**: a panel a day with conditions, high and low, chance of rain
  and how much, wind, sunrise and sunset.

Now and each day sit on an illustrated sky that matches the weather (and, for
Now, the time of day: day, dawn, dusk or night). The forecast refreshes every
10 minutes while the screen is up, the radar every 5. Data from Open-Meteo and
the National Weather Service.

## Rooms (Home Assistant)

With [Home Assistant](https://www.home-assistant.io/) connected (Settings →
Home Assistant), HOMER has a **Rooms** screen, quick controls over whatever's
playing, and a doorbell picture-in-picture. Nothing about Home Assistant is in
HOMER's code or the injector config except, if you like, its address.

- **Rooms** (Home's menu, or **Rooms** at the top of Home on a phone) lists
  Home Assistant's areas, with what's on and the temperature, plus
  **Cameras** for every camera and **Climate** for the thermostat. A room
  shows, top to bottom:
  - **At a glance** (read only): its temperature and humidity, a door or
    window left open, motion now, the air (PM2.5, AQI, CO₂), smoke or a leak.
  - Its **scenes** (◀▶ picks, OK turns one on).
  - Its **lights**: wall switches first, then the bulbs (the room's own group,
    **All lights**, first). ◀▶ dims in 10% steps, OK switches. A bulb that
    does color has a dot in its color; **C** opens its colors: presets, a
    warm-to-cool white strip and a color strip.
  - Its **cameras** (OK opens one).
  - **Switches & outlets**: plugs and power strips (a strip's own switch is
    **All outlets**).
  - **Media**: a card per player: what's playing and its art, ◀▶ for the
    volume and OK to play or pause on the card, then its buttons (**Remote**,
    skip, mute, power) and its inputs. A speaker group shows once, under the
    speaker leading it; the same speaker or TV coming in through two
    integrations (itself, DLNA, Cast) shows once.
  - **Fans** (an air purifier): on and off, its speed or modes, and the
    device's own settings under it (a child lock, a favorite level).
  - **Automations & helpers**: automations (on is enabled), toggles, and
    scripts and buttons to run.

  What's left out: sirens and anything that sets one off, alarm panels,
  hidden and settings/diagnostic entities, buttons that restart or reset a
  device, and devices whose integration isn't running (Home Assistant only
  remembers them). Anything else that's unavailable is dimmed with no
  controls. Esc goes back a step. On a phone the rooms are chips along the
  top, with the same sections; tap a bulb to switch it, drag its bar to dim,
  tap its color dot for its colors.
- **The remote.** A player that's an Apple TV or a Samsung TV (Home
  Assistant has a `remote` for it on the same device) has a **Remote**
  button on its card, and one in the quick controls. It opens the whole
  remote: a ring of arrows around OK, then Back, Home (an Apple TV's TV
  button), Play/Pause and the volume, next to the device and what's on it.
  Your remote goes straight to the device — arrows, **OK**, **Esc** or
  **Backspace** for Back, **Space** for play/pause, **+** and **−** (or
  **Page Up/Down**) for the volume, **T** for Home — and each press lights
  its key on screen; a held arrow repeats about six times a second. **H**,
  or **Back** held down, hands the keys back to HOMER. On a phone it's a
  round pad you tap, with Back, Home, Play/Pause and the volume under it,
  and a light buzz on each press. A video playing docks beside the remote.

  ![The remote on a TV](docs/screenshots/remote-tv.jpg)

- **A camera** opens large, live when the camera streams (Home Assistant's HLS,
  played with hls.js, or the browser's own on an iPhone), otherwise a still
  that refreshes every second. ◀▶ goes to the next camera. A doorbell shows
  the day's rings.
- **L** (or the lightbulb in the player's controls) opens the quick controls
  over any HOMER screen or a full-screen video, which keeps playing: one room
  at a time (◀▶ on its name changes rooms), its scenes, its lights, what its
  players are playing (◀▶ volume, OK play/pause), and the house's thermostat
  pinned at the bottom. **L** or **Esc** closes it; it
  closes by itself after 20 seconds. On a phone it's a sheet from the bottom.
- **The doorbell.** When Home Assistant says the doorbell rang (a Reolink
  visitor sensor or a doorbell event entity), its camera comes up small at the
  top right over whatever's on. **OK** opens it in Rooms (a video playing
  docks in Rooms' preview), **Esc** puts it away, and it goes by itself after
  30 seconds.

### Connecting

1. **Settings → Home Assistant → Address**: type your Home Assistant's address
   (for example `http://homeassistant.local:8123`) and press Enter. Or put it
   in the injector script, before HOMER loads, one per HOMER address:

   ```js
   window.HomerConfig = { homeAssistant: {
       'http://<nas>:8096': 'http://homeassistant.local:8123',
       'https://<nas>.<tailnet>.ts.net': 'https://<nas>.<tailnet>.ts.net:8443'
   } };
   ```

2. **Connect**: this goes to Home Assistant's own sign-in page, and back to
   Settings, which then says **Connected to** your home. Home Assistant signs
   in HOMER with this page's address as its name (it's listed under your
   Home Assistant profile's refresh tokens). Each device, and each HOMER
   address, connects once; the sign-in is kept in that browser.
3. **Disconnect** (press it twice) signs the device out and tells Home
   Assistant to forget it.

**Home Assistant needs no configuration change** when HOMER and Home Assistant
are both plain `http://` on your network. HOMER talks to Home Assistant over
its WebSocket API (states, rooms, controls, camera streams, history) and uses
its sign-in endpoints (`/auth/token`, `/auth/revoke`) and its camera pictures
and HLS streams, which all answer any page. It never calls Home Assistant's
REST API, so `cors_allowed_origins` isn't needed.

### From outside the house (Tailscale)

An `https://` HOMER page can only reach an `https://` Home Assistant (the
browser blocks `http://` and `ws://` from it). If HOMER is on Tailscale's
`https://<nas>.<tailnet>.ts.net`, serve Home Assistant from the same machine
on another port:

```sh
tailscale serve --bg --https=8443 http://<home-assistant-ip>:8123
```

and set HOMER's Home Assistant address to `https://<nas>.<tailnet>.ts.net:8443`
on those devices. Home Assistant then sees requests coming through a proxy
(the NAS), which it refuses unless it's told to trust it, in
`configuration.yaml`:

```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - <nas-lan-ip>
```

Restart Home Assistant after changing it. The same two lines cover a reverse
proxy like Caddy on the same NAS.

## Cameras

Once Home Assistant is connected, **Cameras** (Home's menu, after Rooms, or
the **Cameras** chip on Home on a phone) puts every camera in the house on one
wall and the doorbell's rings where you can see them.

![The camera wall](docs/screenshots/cameras-wall.jpg)

- **The wall.** One tile per camera, the doorbell first and twice the size.
  Every tile shows a still that refreshes every few seconds; the tile you're
  on upgrades to the live stream after a moment, so only one stream ever runs
  at a time. A doorbell's tile says when it last rang. **OK** opens a camera
  full screen, **Esc** comes back.
- **A camera, full screen.** The live view large, the camera's own controls
  beside it, and a strip of what it saw underneath. **▲▼** moves between the
  three, **◀▶** along a row.

  ![The doorbell's page](docs/screenshots/cameras-doorbell.jpg)

- **The controls** are whatever the camera really has, found on its own
  Home Assistant device: **Siren**, **Quick reply** (plays the camera's first
  quick-reply message), **LED** (Off, Auto, At night, Always on — **OK**
  steps through), **Privacy mode**, and its **Battery** where it runs on one.
  A camera with none of them says so. Nothing else on the device is offered:
  no restart, no firmware, no sensitivity sliders.
- **Recent** is the doorbell's rings and its detections, newest first:
  **Ring · 4:12 PM**, **Person · 3:58 PM**, with the clip's length on its
  thumbnail. Rings are in amber. **OK** plays that clip in the big view;
  **Esc** goes back to live.

### Where the rings and the clips come from

A Reolink camera keeps its own recordings, and Home Assistant's Reolink
integration publishes them as a media source (`media-source://reolink`), a
tree of camera → resolution → day → clip. Each clip's title is the
integration's own — `19:00:39 0:02:32 Motion Vehicle Person Doorbell`: the
time of day, how long it runs, and everything the camera triggered on.
**Doorbell** in that list is a ring. HOMER walks the newest days backwards,
reads the exact start out of the media id, and labels each event with the most
telling thing in it (a ring first, then a person, a package, an animal, a
vehicle, plain motion). It asks for the low-resolution copies: the same events,
a quarter of the bytes.

Home Assistant hands out **no thumbnail** for those clips and keeps no stills
of its own — `thumbnail` is `null` on every one, and `media-source://media_source`
(the `/media` folder) is empty. So a tile's picture is the clip's own first
frame, drawn by a paused, muted `<video>`, two at a time so a battery camera
isn't asked for a dozen files at once. A media source that *does* carry a
thumbnail is used as it is.

Where a camera has no clips — it isn't a Reolink, or its recording is off —
the events fall back to Home Assistant's history of the ring and detection
sensors (`history/history_during_period`). Those events have the right time
and no picture, and say **No clip**. Where both have the same moment, the clip
wins. Worth knowing: Home Assistant's recorder often has *no* trace of a ring
(the visitor sensor's pulse is shorter than the recorder's resolution), so the
camera's own clips are the reliable record of a ring, not the history.

If you want a still of every ring regardless — something to look at when the
camera is asleep or its SD card has rolled over — the smallest fix is a
Home Assistant automation that calls `camera.snapshot` on
`camera.front_door_snapshots_fluent` when `binary_sensor.front_door_visitor`
turns on, writing to `/media/doorbell/`. That puts the stills in
`media-source://media_source`, and nothing here has to change to find them.
HOMER doesn't install it for you.

### Cameras that aren't up yet

Four cameras are drawn as placeholders, marked **Not set up yet**, so the wall
is the right shape before the bulb cameras go up: **Driveway**, **Backyard**,
**Garage**, **Side Yard**. They're the `PLANNED` list at the top of
`cameras/cameras-model.js`, each with a name and a pattern.

**To make one real, nothing here has to be re-coded.** Add the camera to
Home Assistant (any integration — ONVIF, generic, Reolink) and give its
`camera.` entity a name that matches the slot: anything containing *driveway*,
*backyard* (or *back garden*, *rear yard*), *garage*, or *side yard* (or
*side gate*). Its placeholder becomes the live tile on HOMER's next refresh —
the screen watches Home Assistant, so it appears without a reload. Put the
entity in a Home Assistant **area** and the tile shows the room under the name.

A camera that matches none of the four still shows up: it lands after the
placeholders, in the same wall. So does a second doorbell. Only the *order*
and the held squares come from `PLANNED`; nothing is filtered out by it. To
reserve a fifth square, or change a name, add a line to that list.

## Sports and News

Two hub screens, each built the same way: a TV window that plays a channel
while you browse, the channels for that subject under it with what's on now,
tabs of content on the right, and a ticker along the bottom.

- **Sports** opens on ESPN. Tabs: My Teams (Rangers, Cowboys, Longhorns,
  Arsenal), MLB, NFL, College FB (AP Top 25, SEC, Big 12), Soccer (Premier
  League, Champions League), NBA, NHL, College Hoops. Scores, standings and
  rankings come from ESPN's public API. A game's card shows our channel for
  it, and OK watches it.
- **News** opens on CNN. Tabs: Top, US, World, UK, France, Business, Local,
  Tech, from publishers' RSS feeds through HOMER's feed helper on the NAS
  (`/homer-feeds`). OK opens a story with a QR code to read it on your phone.
- The channel list follows Settings → **Guide size** as well: **Large** draws
  its rows about 40% bigger (so about three and a half channels at a time
  instead of five, and it scrolls for the rest), **Standard** as before.
  Changing it there changes an open hub too.
- Keys: arrows and OK; `[` `]` or 1–9 switch tabs; **F** full screen; focus
  the ticker to pause it, ◀▶ to step through it.
- A new hub is a `HomerHub.define({...})` call; see `docs/hubs-notes.md`.

## Now Playing

Everything playing anywhere in the house, on one screen, with the controls for
it (`#/playing`, the menu's **Now Playing** item). No video here — artwork
only.

![Now Playing](docs/screenshots/playing-full.jpg)

A card is the cover, what's on (the show and the episode, the film, the
track), where it's playing and for whom, a progress bar that keeps moving, and
the controls that player actually takes: ⏮ ⏯ ⏹ ⏭, mute and a volume pill.
Active things are big, one card each, most recently started first; players
that are on but idle collapse into a quiet line at the bottom ("Ready:
Kitchen, Office…") instead of competing with them. The main menu runs down the
left, so this screen is also the way into every other one.

It gathers three places something can be playing:

- **Jellyfin's sessions** — every client signed in to the server, from
  `/Sessions`, asked again every few seconds while the screen is open (every
  fifteen when the tab is in the background). Pause, stop and the track skips
  go to `/Sessions/{id}/Playing/…`; the volume and mute go to
  `/Sessions/{id}/Command`, and only appear on a client that says it takes
  them (`SupportedCommands`).
- **The house** — every Home Assistant `media_player` that isn't idle, through
  `shared/homeassistant.js`. Home Assistant pushes its state, so those cards
  need no polling. Speakers playing together (Sonos, WiiM multiroom) are one
  card naming the rooms, with play, pause and the skips going to the one
  leading the group. An Apple TV or a Samsung TV also offers **Remote**, which
  opens the remote Rooms already draws (`#/rooms?remote=…`).
- **HOMER's own music** — the music playing in this browser tab
  (`music/music-model.js`), controlled directly rather than through Jellyfin.
  The Jellyfin session it reports is dropped, so it isn't on screen twice.

Positions are sampled, not streamed: a card carries where it was and when that
was read, and the bar runs on its own between samples, so it moves smoothly
without asking the server every frame.

**Keys:** ▲▼◀▶ move, **OK** does the button under the focus, **◀ ▶** on a
volume pill sets the volume (a press at either end moves the focus on
instead), **R** asks the server again, **Esc** goes back, **H** goes Home.
Holding OK on a remote opens the Actions strip with Play/Pause, Stop, Mute and
Remote for the card you're on.

## Books

Audiobooks from Jellyfin's Books library: the book you're listening to up
top with its chapter ruler, your shelf below, a book page with every chapter,
and a listening screen (chapter and 30-second skips, speed, sleep timer).
Progress is saved in Jellyfin. **P** or Play/Pause pauses anywhere.

## Music

Your own music from Jellyfin's Music library (`#/music`, Home's **Music**
item), and it **keeps playing while you browse HOMER** — the player lives
outside the screens, so leaving Music doesn't stop it. Every other screen gets
a small now-playing strip in the corner with the cover, the track and
◀◀ ▶ ▶▶; clicking it goes back to Now playing.

![The Music screen](docs/screenshots/music-browse.jpg)

- **Browse** is a column down the left — whatever the focus is on, its cover
  big, who it's by, and **Play**, **Shuffle** and **Instant Mix** — beside a
  wall of album art. Tabs across it: Recently Added, Artists, Albums, Songs,
  Playlists, Genres.
- **An album** (or a playlist): the cover large and every track, the one
  playing lit. OK on a track starts there.
- **An artist** (or a genre): their albums, with Play all / Shuffle / Instant
  Mix for the lot.
- **Instant Mix** is Jellyfin's own "radio from this" (`/Items/{id}/InstantMix`)
  and works on an album, an artist, a genre or a track. **I** starts one from
  whatever the focus is on.
- **Now playing**: the cover, the track, artist and album, where you are,
  what's next, and the **lyrics** — the line you're on lit and scrolling when
  the file has timings (an `.lrc` beside it, or lyrics in its tags). Plain
  lyrics show unlit. The right column switches between **Lyrics** and
  **Up next** (the queue; OK on a row jumps to it).

![Now playing, with synced lyrics](docs/screenshots/music-lyrics.jpg)

- **Shuffle** keeps the album's own order beside it, so turning shuffle off
  puts the record back in order where you are. **Repeat** is off / all / one.
- Playback is reported to Jellyfin like any other client
  (`/Sessions/Playing`, `/Progress`, `/Stopped`, with the queue), so the server
  knows what's playing and play counts land.
- **Starting music stops HOMER's video; starting a video pauses the music.**
- Not gapless. The next track is preloaded while the current one finishes, so
  the join is short, but the two aren't stitched sample-accurate.

**Keys on the Music screen:** arrows move and OK selects; **Space** or **P**
plays and pauses; **N** and **B** change track; **S** shuffles; **R** cycles
repeat; **I** starts an Instant Mix; **+** and **−** are the volume; **Esc**
goes back a view, then back a screen (the music keeps playing). On Now playing,
◀ ▶ on the progress bar seeks 10 seconds and on the volume pill changes the
volume. The media keys (Play/Pause, Next, Previous) work from any HOMER screen
while something is loaded.

Nothing is stored outside Jellyfin except the volume, shuffle and repeat, which
are kept per device.

## Getting shows and movies (Sonarr and Radarr)

- Search's **Get it** group lists shows and movies you don't have. OK on one
  asks once, and a second OK adds it to Sonarr or Radarr, which starts
  searching.
- **E** on a series (in Search or the guide) gets all its new episodes.
  Shows already in Sonarr say so ("Getting new episodes").
- Talks to Sonarr and Radarr through HOMER's helper on the NAS, so no API
  keys are stored in the browser.

## Channel Guide

A full-screen, set-top-box style TV guide for Jellyfin Live TV. It runs inside
Jellyfin Web and works like the guide on a cable box: a program info panel up
top, a channel grid you move through with the arrow keys, and OK to tune in.

![Channel Guide](screenshots/guide.jpg)

- Opens from a **Guide** button in Jellyfin's header, or the **G** key.
- **OK / Enter** (or a click) starts the channel in the same browser tab. On a
  program that hasn't started yet there's nothing to watch, so OK records it
  instead, like **R** (a click only selects it). The legend says what OK will
  do, and shows **R** only when it does something different.
- **◀ ▶** past the edge of the screen pages the guide later (or earlier, back
  to now), as far ahead as your listings go. The chip at the top left of the
  grid says which day you're looking at, and a new day's first slot is marked
  with its weekday. **N** jumps back to now.
- **R**, or the **●** button on a program you hover over, schedules a one-time
  recording of that program. Programs that are set to record get a red dot.
- On a program that's set to record, **R** (or its **■** button) cancels the
  recording, or stops it if it's already recording. The guide asks first:
  press **R** or click **■** again within a few seconds to confirm.
- Opens on top of whatever's playing, so the video keeps going: press **G** or
  the Guide button in the player's controls. Shrinking the player into the
  browser's floating window brings the guide up behind it.
- Over a full-screen video, the preview window shows the live picture of what
  you're watching.
- **Two sizes** (Settings → **Guide size**). **Standard** is five channels and
  three hours of listings at a time. **Large** is four channels and two hours,
  with the titles, channel names and numbers about 40% bigger — the same guide
  read from a couch instead of a desk. Changing it redraws the open guide where
  it stands, on the same channel and program; nothing reloads. HOMER's Apple TV
  app starts on Large, a browser on Standard, and a choice you make yourself
  always wins (it's kept per device). The Sports and News hubs' channel lists
  follow the same setting.
- **The filter chips are part of the arrows.** **▲** off the top channel moves
  up into the category and country row, **◀ ▶** run along it, **OK** picks and
  **▼** drops back onto the program you left. **[ ]**, **1–8** and **C** still
  do the same thing from the grid, so nothing changes if you have a keyboard.
- Scales a fixed 1920×1080 layout to fit any window, the way a TV UI does.
- Uses your existing Jellyfin sign-in. There's nothing to configure and no
  separate account or API key.

Standard and Large, both on a 1920×1080 stage:

![The guide at Standard size](docs/screenshots/guide-standard.jpg)

![The guide at Large size](docs/screenshots/guide-large.jpg)

## Actions, for a remote with no letter keys

HOMER's shortcuts are letters, and an Apple TV's Siri Remote hasn't got any. So
every screen can put what it offers on screen: **hold OK** on the Siri Remote
for about half a second, or press **M** on a keyboard, and an **Actions** strip
comes up over the screen with the things that screen can do right now — each
with its name, its icon and its letter, so the strip teaches the shortcut
rather than replacing it. Arrows move, **OK** runs it, **Back/Esc** closes.

![The Actions strip over the guide](docs/screenshots/actions-strip.jpg)

What's in it depends on where you are, and always ends with the three that work
anywhere: **Guide**, **Home** and **Quick controls**.

| Screen | Its own actions |
| --- | --- |
| **Guide** | Record / Cancel / Stop (**R**), Get new episodes (**E**), Back to now (**N**, while now is off screen), Filters (**▲**), Next category (**[ ]**), Next country (**C**), Filter channels (**/**), Exit guide |
| **Search** | What OK does on the highlighted result, Record (**R**), Get new episodes (**E**), Result group (**▲**), Search (**/**) |
| **Movies / TV Shows** | What OK does on the highlighted title, Sort (**▲**), Filter (**/**) |
| **Recordings** | What OK does on the highlighted recording, Next tab (**[ ]**), All recordings (**◀**, inside a show) |
| **Sports / News** | Next section (**]**), Previous section (**[**), Full screen (**F**, while the video is docked) |
| **Rooms** | Color (**C**) for the light you're on, Full screen (**F**) |
| **Home** | Search (**/**), Full screen (**F**) |
| **Now Playing** | Play/Pause, Stop, Mute and Remote for the card you're on, and Check again (**R**) |
| **Weather**, **Books** | Try again when something failed; Books adds Play/Pause (**P**) |
| **Music** | Play/Pause (**P**), Next track, Shuffle (**S**), Repeat (**R**), Instant Mix (**I**), Now playing |
| **Anywhere, with music loaded** | Play/Pause music, Next track, and **Music** to go back to it |
| **A recording playing full screen** | Skip 30s (**S**) |

A **swipe up** on the Siri Remote's clickpad runs the screen's one main action
without the strip: **Skip 30s** in the full-screen player, **Search** on the
Search screen, **Play/Pause** in Books, in Music and on the Now Playing card
you're on, and from anywhere else — Home included
— it opens the **Guide**. A **swipe down** closes the Actions strip, or the
quick controls panel if that's what's up; with nothing open it does nothing.

The Apple TV app sends these as DOM events on `window`, so anything else that
drives HOMER can too:

```js
window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action: 'menu' } }));      // the strip
window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action: 'swipe-up' } }));  // the main action
window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action: 'swipe-down' } })); // close what's open
```

A screen registers what it offers with `shared/actions.js`
(`HomerActions.provide(...)`); its header comment is the contract.

## Settings

**Settings** (Home → Settings, `#/mypreferencesmenu`) replaces Jellyfin Web's
preference pages with a cable-box style screen. Audio language, Subtitles and
Subtitle language are saved to your Jellyfin account; **Streaming quality**,
**Guide size**, **Weather location** and **Home Assistant** are per device.

## On a phone

Jellyfin's Android and iOS apps (and a phone's browser) load HOMER too. When
the screen's shortest side is under 600px, HOMER switches to its phone layout,
in either orientation; a tablet keeps the TV layout, with touch (see
[Controls](#controls)).

![Phone guide](screenshots/phone-guide.png)

- A **top bar** (HOMER and the screen's name, the weather, **Search**) and a
  **tab bar** (Home, Guide, Movies, Shows, Recordings) on every HOMER screen.
  The weather opens the Weather screen. The phone shows the time, so HOMER
  doesn't.
- **A tap on the HOMER mark opens the menu**: a sheet with every screen there
  is, in the same order as the TV's menu, Home first and the one you're on
  ticked. The tab bar only has five, so this is how Now Playing, Books, Music,
  Weather, Sports, News, Rooms, Cameras and Settings are reached. Tap a row to
  go there; tap outside, swipe the sheet down, or press **Back** to put it
  away. (Back closes the sheet rather than leaving the screen.) Home is the
  first row, and the tab bar still has Home too.

  ![The phone menu over Home](docs/screenshots/phone-menu-home.jpg)
  ![The phone menu over Now Playing](docs/screenshots/phone-menu-playing.jpg)
- **The guide** is a list: one row per channel with what's on (time left and a
  progress bar), what's next, and a **●** button. The time rail picks what the
  rows show: **Now**, or any half hour ahead. Category and country chips work
  as on TV (the country chip opens the choices). Channels with nothing listed
  get a slim row.
- **●** records the program in its row. On one that's set to record, the first
  tap says **Cancel?** (or **Stop?** while it's recording) and a second tap
  within a few seconds cancels it.
- **A tap on a row** opens a sheet with the program, **Record** and, for what's
  on now, **Watch**. Drag it down or tap outside it to put it away.
- **Watch** plays the channel in a strip under the top bar, and the list keeps
  scrolling under it (in landscape the video sits at the left). Tap the strip
  for full screen, **✕** to stop. **Back** goes back a screen, not out of the
  video.
- On a phone or tablet, live TV stops by itself once the screen has been
  locked, or HOMER has been in the background, for 3 minutes, so a phone in a
  pocket doesn't hold one of the provider's two streams. A recording or a
  movie just stays paused.
- **Cameras** is one column: the doorbell first, its **Recent** strip of rings
  and detections right under it (swipe it sideways, tap one to play the clip),
  then the other cameras and the placeholders. Tap a camera to open it — live
  view, its controls, its own Recent strip — and **‹ Cameras** to come back.

  ![Cameras on a phone](docs/screenshots/cameras-phone.png)

- Every HOMER screen has a phone layout of its own now — the guide, Home,
  Movies and TV Shows with their details pages, Search, Recordings, Settings,
  Weather, Rooms and Cameras. See `docs/phone.md` for how one is built.
- **Music** on a phone: chips for Recently Added / Artists / Albums / Songs /
  Playlists / Genres, the art two across, and a sheet for an album (its tracks)
  or an artist (their albums) with Play / Shuffle / Mix. A **mini player** sits
  above the tab bar whenever something is loaded — tap it for the full Now
  playing, with the cover, the controls, a volume slider and the lyrics. The
  mini player follows the music onto every other HOMER screen too.

![Music on a phone](docs/screenshots/music-phone.jpg)

- **Now Playing** on a phone is the same cards in one column, biggest thing
  first, with the controls as buttons big enough for a thumb (− and + for the
  volume). There's no menu on it: the tab bar and the buttons on Home already
  have the screens.

![Now Playing on a phone](docs/screenshots/playing-phone.jpg)
## Install

The guide is a script, so it needs the
[JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)
plugin to load it into Jellyfin Web.

1. Install **JavaScript Injector**. It isn't in Jellyfin's default catalog, so
   first add its repository (Dashboard → Plugins → Catalog → ⚙️ → ➕) using the
   10.11 manifest URL from the
   [plugin's install instructions](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector#%EF%B8%8F-installation).
   Then install it from the catalog and restart Jellyfin.
2. Open the plugin's settings (Dashboard → Plugins → JavaScript Injector), click
   **Add Script**, name it "HOMER", and paste this into the code box:

   ```js
   (function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v0.4.9/homer.js';document.head.appendChild(s);})();
   ```

3. Save, then reload Jellyfin in your browser. The Guide button appears in the
   header next to Search.

The URL is pinned to a release tag (`@v0.4.9`), so an update never changes
anything until you edit the tag yourself. jsDelivr and browsers both cache
aggressively, so after changing the tag, hard-refresh (Ctrl/Cmd+Shift+R).

## Controls

| Key | What it does |
| --- | --- |
| **G** | Open the guide (from anywhere in Jellyfin, unless you're typing in a text field) |
| **▲ ▼** | Change channel (keeps the same time slot, like a real guide) |
| **◀ ▶** | Move through time on the current channel. Past the edge of the screen, the guide pages later or earlier (never earlier than now) |
| **N** | Back to now, on what's airing on the current channel (the legend shows it once you've moved away from now) |
| **OK / Enter** | Watch the selected channel. On a program that hasn't started yet, record it (the same as **R**) |
| **R** | Record the selected program. On a program that's set to record, press **R** twice to cancel it (or stop it if it's recording) |
| **/** | Filter by channel name/number or show title (Esc clears) |
| **[ ] / 1–8** | Switch channel category: All, Favorites, Local, News, Sports, Movies, Kids, Entertainment |
| **C** | Switch country: All, USA, UK, Canada, France, Other (combines with the category) |
| **▲ from the top channel** | Move up into the guide's filter chips: **◀ ▶** along them, **OK** picks, **▼** back to the program you left. Search, Movies, TV Shows, Recordings and the Sports/News hubs reach their own chip and tab rows the same way |
| **Page Up / Page Down** | Jump a screen of channels |
| **H** | Go to Home (a playing channel keeps playing in Home's preview) |
| **M** | The **Actions** strip: what this screen can do right now, each with its own key (arrows move, OK runs, Esc closes). Holding OK on an Apple TV's Siri Remote does the same |
| **Play/Pause, Next, Previous** | The music (`#/music`), from any HOMER screen while something is loaded |
| **L** | Quick controls for Home Assistant's lights, scenes, players and thermostat, over whatever's playing (once Home Assistant is connected) |
| **Esc / Backspace / G** | Close the guide |

With a mouse or trackpad: scroll the grid freely (sideways moves through
time), hover to select, click a program to watch it (one that hasn't started yet
is only selected). A hovered program shows a **●** button at its right edge
that records it (**■** on a program that's set to record: click it twice to
cancel). Type in the filter box at the top to narrow the grid. The **N**,
**OK**, **/**, **[ ]**, **C**, **H** and **ESC** hints along the bottom are
clickable too.

On a touch screen (a tablet), the first tap on a program highlights it and
shows its **●** button; tap the button to record, or tap the highlighted
program again to watch it. Drag the grid with a finger to scroll the channels,
or sideways to move through time.

Scripts can also call `window.ChannelGuide.open()` and
`window.ChannelGuide.close()`.

## Compatibility

- **Jellyfin Web 10.11.x.** Tested against 10.11.8.
- **Works in** anything that runs Jellyfin Web: desktop and mobile browsers,
  Jellyfin Media Player, and the Jellyfin iOS/Android phone apps (with the
  phone layout).
- **Doesn't work in** native clients that don't use Jellyfin Web: Android TV /
  Fire TV, Roku, and Swiftfin (iOS / Apple TV). The JavaScript Injector plugin
  can't reach those apps.
- Recording needs a user with Live TV recording permission. Programs that
  your listings provider doesn't have data for show as "listings unavailable"
  and can't be recorded.

## Development

Serve the repo locally and load the script into a signed-in Jellyfin Web tab
from the browser console. The stylesheet loads from the same place as the
script, and loading the script again replaces the previous copy.

```sh
python3 -m http.server 8765
```

```js
const s = document.createElement('script');
s.src = 'http://<your-machine>:8765/guide/guide.js?t=' + Date.now();
document.head.appendChild(s);
```

Loaded on its own like this, the guide fetches its model
(`guide/guide-model.js`) and phone layout (`guide/guide-phone.js`) itself;
`homer.js` loads everything.

How a screen gets a phone layout, and how to test one without a phone:
[docs/phone.md](docs/phone.md).

`theme.css` is an older, separate stylesheet that restyles Jellyfin's built-in
guide page through Dashboard → General → Custom CSS. The guide doesn't need it.

## License

MIT. Channel Guide is an independent project, not affiliated with or endorsed by
any TV, cable or DVR company. "Set-top-box style" describes the look, not a
brand.

Weather icons in `shared/wx/` are [Meteocons](https://github.com/basmilius/meteocons)
by Bas Milius, MIT licensed (see `shared/wx/LICENSE`). Weather data comes from
[Open-Meteo](https://open-meteo.com/); the radar is the National Weather
Service's MRMS mosaic (from its map server, opengeo.ncep.noaa.gov, public
domain), and the radar's map is the Census Bureau's
([TIGERweb](https://tigerweb.geo.census.gov/), public domain).
