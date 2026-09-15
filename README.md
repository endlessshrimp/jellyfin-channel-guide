# HOMER for Jellyfin

A TiVo-style TV-appliance interface for Jellyfin Web: a HOMER Home screen, the
Channel Guide, Movies and TV Shows screens, and a global skin so every remaining
Jellyfin page matches. On a phone, HOMER has a phone layout (see
[On a phone](#on-a-phone)).

## Home

Home replaces Jellyfin's home page: a main menu (Live TV Guide, Movies, TV
Shows, Books, Recordings, Weather, Sports, News, Settings, and Rooms once Home
Assistant is connected), an On Now panel, and rows of Continue Watching, Up
Next, On Now and Recently Added. The search box sits above the menu (▲ or `/`).

- **Watch** plays the channel in the On Now preview window, and Home stays up
  so you can keep browsing. The panel shows what you're watching, with
  **Full screen**, **Guide** and **Stop**.
- **H**, or the HOMER logo at the top left of any HOMER screen, comes back to
  Home from anywhere.

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
    volume and OK to play or pause on the card, then its buttons (skip, mute,
    power) and its inputs. A speaker group shows once, under the speaker
    leading it; the same speaker or TV coming in through two integrations
    (itself, DLNA, Cast) shows once.
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
- Keys: arrows and OK; `[` `]` or 1–9 switch tabs; **F** full screen; focus
  the ticker to pause it, ◀▶ to step through it.
- A new hub is a `HomerHub.define({...})` call; see `docs/hubs-notes.md`.

## Books

Audiobooks from Jellyfin's Books library: the book you're listening to up
top with its chapter ruler, your shelf below, a book page with every chapter,
and a listening screen (chapter and 30-second skips, speed, sleep timer).
Progress is saved in Jellyfin. **P** or Play/Pause pauses anywhere.

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
- Scales a fixed 1920×1080 layout to fit any window, the way a TV UI does.
- Uses your existing Jellyfin sign-in. There's nothing to configure and no
  separate account or API key.

## On a phone

Jellyfin's Android and iOS apps (and a phone's browser) load HOMER too. When
the screen's shortest side is under 600px, HOMER switches to its phone layout,
in either orientation; a tablet keeps the TV layout, with touch (see
[Controls](#controls)).

![Phone guide](screenshots/phone-guide.png)

- A **top bar** (HOMER and the screen's name, the weather, **Search**) and a
  **tab bar** (Home, Guide, Movies, Shows, Recordings) on every HOMER screen.
  The weather opens the Weather screen; Settings is on Home, and so is Rooms
  once Home Assistant is connected. The phone shows the time, so HOMER
  doesn't.
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
- Home, Movies, TV Shows, Search, Recordings, Settings and Weather don't have
  their phone layouts yet: they show their TV layout, shrunk to fit between
  the bars.

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
   (function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v0.4.0/homer.js';document.head.appendChild(s);})();
   ```

3. Save, then reload Jellyfin in your browser. The Guide button appears in the
   header next to Search.

The URL is pinned to a release tag (`@v0.4.0`), so an update never changes
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
| **Page Up / Page Down** | Jump a screen of channels |
| **H** | Go to Home (a playing channel keeps playing in Home's preview) |
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
