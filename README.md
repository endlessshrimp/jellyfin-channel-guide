# Channel Guide

A full-screen, set-top-box style TV guide for Jellyfin Live TV. It runs inside
Jellyfin Web and works like the guide on a cable box: a program info panel up
top, a channel grid you move through with the arrow keys, and OK to tune in.

![Channel Guide](screenshots/guide.jpg)

- Opens from a **Guide** button in Jellyfin's header, or the **G** key.
- **OK / Enter** (or a click) starts the channel in the same browser tab.
- **R** schedules a one-time recording of the selected program. Programs that
  are set to record get a red dot.
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
   **Add Script**, name it "Channel Guide", and paste this into the code box:

   ```js
   (function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v0.1.2/guide/guide.js';document.head.appendChild(s);})();
   ```

3. Save, then reload Jellyfin in your browser. The Guide button appears in the
   header next to Search.

The URL is pinned to a release tag (`@v0.1.0`), so an update never changes your
guide until you edit the tag yourself. jsDelivr and browsers both cache
aggressively, so after changing the tag, hard-refresh (Ctrl/Cmd+Shift+R).

## Controls

| Key | What it does |
| --- | --- |
| **G** | Open the guide (from anywhere in Jellyfin, unless you're typing in a text field) |
| **▲ ▼** | Change channel (keeps the same time slot, like a real guide) |
| **◀ ▶** | Move through time on the current channel |
| **OK / Enter** | Watch the selected channel |
| **R** | Record the selected program |
| **Esc / Backspace / G** | Close the guide |

With a mouse: hover to select, click a program to watch it, scroll to change
channels. The **OK**, **●** and **ESC** hints along the bottom are clickable too.

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
