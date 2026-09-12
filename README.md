# Channel Guide

A set-top-box style theme for Jellyfin's **Live TV guide**: the dark, quiet grid,
bright "on now" cells and white selection outline of a modern cable/DVR guide.

It only restyles the guide page (`.tvguide`). The rest of Jellyfin is left alone,
so it plays nicely on top of the default theme or alongside other tweaks.

![Guide](screenshots/guide.jpg)

## Install

Dashboard → **General** → **Custom CSS**, add:

```css
@import url("https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v0.1.0/theme.css");
```

Pin a version tag (as above) rather than `@main`, so an update never changes
your guide until you choose to bump the tag. jsDelivr and Jellyfin both cache
aggressively; after changing the tag, hard-refresh the browser (Ctrl/Cmd+Shift+R).

## Customize

Override any variable after the `@import`:

```css
:root {
    --cg-accent: 255, 196, 0;   /* selection/"now" color as an R, G, B triplet */
    --cg-row-height: 3em;       /* denser grid */
    --cg-logo-filter: none;     /* keep channel logos in full color */
}
```

| Variable | Default | What it does |
| --- | --- | --- |
| `--cg-bg` | `#0a0e13` | Guide background |
| `--cg-header` | `rgba(10,14,19,.97)` | Header/time bar |
| `--cg-cell` | `rgba(22,27,34,.94)` | Program and channel cells |
| `--cg-cell-now` | `rgba(34,42,53,.97)` | Programs airing now |
| `--cg-rule` / `--cg-rule-strong` | white at 6% / 13% | Grid lines |
| `--cg-text` / `--cg-text-muted` | `#eef1f4` / `#98a2ad` | Primary / secondary text |
| `--cg-accent` | `58, 141, 222` | Selection tint and active date |
| `--cg-focus` | `#ffffff` | Selection outline |
| `--cg-logo-filter` | grayscale, brightened | Monochrome channel logos |
| `--cg-row-height` | `3.4em` (`3.8em` in TV layout) | Row height |

## Compatibility

- **Jellyfin Web 10.11.x.** Selectors are checked against 10.11.8.
- **Applies to** clients built on Jellyfin Web: browsers, Jellyfin Media Player
  (including TV mode), and the iOS/Android phone apps.
- **Does not apply to** native clients: Android TV / Fire TV, Roku, Swiftfin.
  Jellyfin's custom CSS only reaches Jellyfin Web.
- Uses `:has()` to scope header styling to the guide page (Chrome/Edge 105+,
  Safari 15.4+, Firefox 121+, current Jellyfin Media Player).

## Development

Everything lives in `theme.css`. To preview changes live without saving them to
the server, serve the repo locally and load the stylesheet from your browser's
console on the guide page:

```sh
python3 -m http.server 8765
```

```js
const l = document.createElement('link');
l.rel = 'stylesheet';
l.href = 'http://<your-machine>:8765/theme.css?t=' + Date.now();
document.head.appendChild(l);
```

## License

MIT. Not affiliated with or endorsed by any TV or DVR company; "set-top-box
style" describes the look, not a brand.
