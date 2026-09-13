# HOMER for Jellyfin

A TiVo-style TV-appliance interface for Jellyfin Web: a HOMER Home screen, the
Channel Guide, Movies and TV Shows screens, and a global skin so every remaining
Jellyfin page matches.

## Home

Home replaces Jellyfin's home page: a main menu (Live TV Guide, Movies, TV
Shows, Recordings, Weather, Search, Settings), an On Now panel, and rows of
Continue Watching, Up Next, On Now and Recently Added.

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
  shrinks the video into the screen you came from, and it keeps playing there.
- **Full screen**, **F**, or a click on the preview window takes it back to
  full screen. **Play** on something else also goes full screen.
- **H** or the player's **Home** button takes the video to Home's preview.
- **Stop** on Home ends it. When a video ends by itself, you stay on the screen
  you're on.
- While a video plays behind HOMER, the arrow keys, space and the trackpad
  control HOMER, not the player. The trackpad never changes the volume, even
  in the full-screen player.
- Jellyfin's own pages (Search results, Recordings, Settings) still stop the
  video when you open them, because Jellyfin stops video whenever you leave
  its player. The browser's own Back (trackpad swipe, Cmd+[) does too.

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
   (function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v0.3.10/homer.js';document.head.appendChild(s);})();
   ```

3. Save, then reload Jellyfin in your browser. The Guide button appears in the
   header next to Search.

The URL is pinned to a release tag (`@v0.3.10`), so an update never changes
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
| **C** | Switch country: All, USA, UK, France (combines with the category) |
| **Page Up / Page Down** | Jump a screen of channels |
| **H** | Go to Home (a playing channel keeps playing in Home's preview) |
| **Esc / Backspace / G** | Close the guide |

With a mouse or trackpad: scroll the grid freely (sideways moves through
time), hover to select, click a program to watch it (one that hasn't started yet
is only selected). A hovered program shows a **●** button at its right edge
that records it (**■** on a program that's set to record: click it twice to
cancel). Type in the filter box at the top to narrow the grid. The **N**,
**OK**, **/**, **[ ]**, **C**, **H** and **ESC** hints along the bottom are
clickable too.

Scripts can also call `window.ChannelGuide.open()` and
`window.ChannelGuide.close()`.

## Compatibility

- **Jellyfin Web 10.11.x.** Tested against 10.11.8.
- **Works in** anything that runs Jellyfin Web: desktop and mobile browsers,
  Jellyfin Media Player, and the Jellyfin iOS/Android phone apps.
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
