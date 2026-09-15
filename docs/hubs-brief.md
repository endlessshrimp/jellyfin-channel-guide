# Sports Hub + News Hub: build brief (for the two build agents)

Jason asked for two new HOMER screens, built overnight on the branch
`feature/hubs` (this worktree), for him to review in the morning. Nothing gets
merged to main. The main agent (me) reviews, commits anything left, pushes,
and points Jellyfin at the branch. You two build.

## Who does what

- **Sports agent**: builds the shared hub framework FIRST (everything under
  "Shared framework" below), posts its API in `docs/hubs-notes.md`, then builds
  the Sports Hub. Also owns the shared integration edits for BOTH hubs:
  `homer.js` (loader lines), `shared/player.js` (route regex), Home's menu
  (`home/home.js`, `home/home-phone.js`), and Search/Settings only if needed.
- **News agent**: starts right away on news sources, `news/news-data.js`, and
  the News Hub's own layout and widgets. It builds on the framework as soon as the
  Sports agent posts it. Needs a framework change? Write it in
  `docs/hubs-notes.md` and the Sports agent makes it (or the main agent relays).
- Coordinate through `docs/hubs-notes.md` (append-only: time, who, what). Re-read
  it before touching anything shared. Don't edit each other's files.

## What Jason said (verbatim where it matters)

- Sports: "create a whole new page (or whatever, you know, weather/movies/live tv)
  but for sports. by default, it should be showing ESPN in the tv window, have a
  guide below with all sports channels, and should include a ticker down at the
  bottom, like the ESPN ticker, on the telly. But it should show
  scores/schedules/updates, make it feature and image rich … maybe we can have an
  area for news where we pull in some type of feed or RSS or something for
  specific sports. College Football, MLB, that kind of stuff. Go nuts, figure
  something cool out." "like a sports hub."
- "and then let's do one for news, too. like a news hub. remember that these will
  be typically viewed on TV at a distance, so ensure we're making things readable
  but still convey the important parts. for sports, scores and schedules are
  important, as are standings, rankings for things like college football and
  basketball."
- "and news, maybe we have some sort of ticker for that too. make this stuff
  reusable, so both news and sports dont have to be reimagined."
- "i'm sure there's a news feed somewhere that we can pull in--we don't need to
  reinvent the wheel for news. look at other sources, eg., NYT, WP, print"
- His teams and priorities: "Rangers, but all MLB scores, all NFL scores but
  Cowboys most important, College football show scores for AP top 25, SEC, Big
  XII, news for Texas Longhorns. Soccer: Arsenal is most important. All Premier
  League scores/fixtures, same for Champions League, etc." News Hub's TV window
  default: CNN.
- He's the only user; it's a testing setup ("we are testing and can break things").

## HOMER in brief (read the code, don't guess)

- Repo layout and rules: `README.md`, `docs/phone.md`, the memory note
  `/Users/jason/.claude/projects/-Users-jason/memory/jellyfin-channel-guide.md`.
- Every screen is a full-window 1080-tall stage (width = window, min 1600), drawn
  over Jellyfin. Look at `forecast/forecast.js` + `.css` (Weather) and
  `rooms/rooms.js` (Rooms) as the best examples of a HOMER screen: top bar with
  the HOMER mark, the screen name, weather bug and clock; the legend at the bottom;
  arrow keys/OK/Esc/H; `shared/shell.css` for the shared stage/top bar/legend;
  `shared/tokens.css` for colors and type (Barlow / Barlow Semi Condensed, navy
  ground, accent #2f8cff). One cohesive look, nothing stock. No browser
  alert/confirm dialogs (use press-again confirms).
- Routing: HOMER screens live at hashes. The TV guide opens over a screen, but
  the others are real routes. Add `#/sports` and `#/news` the way `#/weather` and
  `#/rooms` are done (see `isWeatherHash` in `shared/player.js`, and how
  `forecast/forecast.js` claims its route). Home's menu needs entries (the menu
  already has 8 items; make room sensibly).
- **Video**: `shared/player.js` (HomerPlayer) keeps a video playing while you
  browse. A screen gives it a preview window by marking an element
  `data-homer-preview`; the real video element is pinned over it ("docked").
  Use `HomerPlayer.watch(channelId, info)` to play a channel into the current
  screen's preview, `HomerPlayer.fullscreen()`, `HomerPlayer.docked()`,
  `HomerPlayer.nowPlaying()`, `HomerPlayer.onChange(fn)`. Read player.js's header.
- **Channels and listings**: `guide/guide-model.js` (HomerGuideModel) loads
  channels, listings, categories and recordings, and has `playChannel`, logos
  (`shared/logos.js`, HomerLogos, dark chips always), `categorize`, `countryOf`.
  The lineup is numbered cable-style: US 1000s, UK 3000s, France 5000s, world
  news 7200s. In each thousand: x000–x099 local, x100s entertainment, x200s news &
  weather, x300s sports, x400s movies, x500s kids. US sports detail: 1300s ESPN
  (1300 ESPN, 1301 ESPN2, 1302 ESPNU, 1303 ESPNews, 1304 SEC Network, 1305 ACC Network),
  1310s FOX/CBS, 1320s leagues (1322 MLB Network, 1320 NFL Network, 1321 RedZone),
  1330s soccer + Spanish (1330 GOL TV, 1331 FOX Soccer Plus, 1332 beIN Sports, 1335
  ESPN Deportes, 1336 FOX Deportes, 1337 TUDN), 1340–1377 regional sports
  networks (1340 FanDuel Sports Southwest = Dallas), 1380–1396 MLB team channels
  (**1380 Texas Rangers (Rangers Sports Network)**, 1381 Rangers MLB feed). UK sports
  3300s (Sky Sports 3300–3312, TNT Sports 3320s, 3350 MUTV, 3351 LFC TV). France
  sports 5300s. US news 1200s (**1200 CNN**, 1201 HLN, 1203 FOX News, 1205 MS NOW,
  1206 CNBC, 1208 NewsNation, 1209 ABC News Live, 1211 Newsmax, 1212 CBS News 24/7,
  1213 NBC News NOW, 1214/1215 C-SPAN, 1220 CBS News Texas, 1221 Spectrum News 1 DFW,
  1250 Weather Channel, 1251 FOX Weather); UK news 3200s (BBC News 3200, Sky News 3201);
  France news 5200s; world news 7200–7220 (NHK, Al Jazeera English, DW, France 24
  English, CNA, CGTN, CBC News Network, ABC News Australia, TRT World…). Find
  channels by number through Jellyfin's API, not by id. (A few numbers move tonight
  while the new channels land, so look them up at runtime.)
- **TV at a distance**: design for a 55–65" TV across a room. Body text no smaller
  than ~24px on the 1080 stage, headlines 34–44px, scores big (40px+ numerals, tabular),
  strong contrast, not too much on screen at once. Convey the important parts first.
- Phone: HOMER has phone layouts per screen (`shared/layout.js`, `docs/phone.md`).
  TV first. A simple phone layout for each hub is a bonus if there's time;
  at minimum the hubs must not break on a phone.

## Shared framework (Sports agent builds it first; both use it)

Aim: a hub is configuration plus content, not a new screen from scratch. Suggested
(adjust, but post what you build in the notes):
- `shared/hub.js` + `shared/hub.css` (window.HomerHub): the screen scaffold
  (top bar, stage, legend, focus zones, route claim), a **TV window**
  (`data-homer-preview`) that plays a default channel on open, and a **channel
  rail/mini-guide** for a set of channels (by number range or category) with
  now/next and progress, OK to tune into the TV window, F for full screen.
- **Ticker** (window.HomerTicker, `shared/ticker.js`): an ESPN BottomLine-style
  strip. Segments with a label chip ("MLB", "NFL", "TOP STORIES"), items that
  scroll or flip, and priority items (favorite teams) shown more often. Pausing
  on focus. Fed by a function the hub supplies. Reused by News for headlines.
- **Cards and panels**: image cards (headline plus image), score cards (two
  teams with logos, score, status, network), tables (standings, rankings), and
  tabs for switching leagues or sections. All TV-readable.
- **Data helpers**: fetch with timeout, per-URL cache, auto-refresh (faster when
  games are live), and backoff on errors.

## Data sources (verified tonight)

- **ESPN's public site API sends CORS `*`**, so the browser can use it directly. Examples:
  - `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`
  - `…/football/nfl/scoreboard`
  - `…/football/college-football/scoreboard?groups=80` (FBS); for SEC use `groups=8`, for Big 12 `groups=4`.
  - `…/football/college-football/rankings` (AP Top 25)
  - `…/basketball/mens-college-basketball/rankings`
  - `…/soccer/eng.1/scoreboard` (Premier League) and `…/soccer/uefa.champions/scoreboard`
  - `https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings`
  - `…/sports/{sport}/{league}/news`, and team news and schedule via `/teams/{id}` (Rangers = `tex`, Cowboys = `dal`, Texas Longhorns CFB team id 251, Arsenal team id 359; verify).
  - The responses carry team logos and article images (`a.espncdn.com`).
- **News feeds**: most papers' RSS has no CORS, so use HOMER's feed helper on the NAS:
  - `GET <base>/feed?url=<encoded feed url>` returns JSON
    `{title, link, items:[{title, link, published, summary, image, source}]}`, cached 5 min.
  - Base: `location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095'`
    (the main agent is wiring `/homer-feeds` through Caddy and Tailscale for the https names).
  - Only allow-listed hosts are fetched. NYT, BBC, Al Jazeera and WaPo tested OK.
  - To add hosts, append them to `/Volume1/docker/mediastack/config/homerfeeds/allow.txt`
    over `ssh 192.168.68.100`, then run `docker restart homerfeeds`
    (docker is at `/Volume1/@apps/DockerEngine/dockerd/bin/docker`). Note it in the hub notes.
  - The helper code is `/Volume1/docker/mediastack/config/homerfeeds/homerfeeds.py`.
    If you need an endpoint changed, ask the main agent.
- Weather: `window.HomerWeather` exists if you want it.

## Testing rules (important)

- Dev server for THIS worktree: http://192.168.68.53:8766/ (already running; it serves
  this directory). Test in Chrome (Claude in Chrome tools): call `tabs_context_mcp`,
  then **create your own new tab** and work only there. Never touch other tabs
  (Jason watches video in his). Close your tabs when done.
- To load your build: open `http://192.168.68.100:8096/web/index.html#/home`, wait,
  then in that tab run
  `window.HomerWeather = undefined; window.HomerHA = undefined;` and inject
  `<script src="http://192.168.68.53:8766/homer.js?t=…">`.
- **Never play live TV in an automated tab**: the provider allows only 2 streams and
  it leaks tuner streams. Stub the tuning (e.g. replace `HomerPlayer.watch` /
  `HomerGuideModel.playChannel` in your test tab with a no-op that records the
  channel) before opening the hubs. Recordings or library movies are fine to play
  if you must test docking.
- Automated tabs are hidden: CSS animations and video freeze, and timers are throttled.
  A screenshot wakes the tab briefly. Don't mistake a frozen animation for a bug.
- `node --check` every JS file you touch.
- Commit on `feature/hubs` in this worktree. Stage only your own paths, and end the
  message with these two lines:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_019uvW2d1y3k6XW392YAvffg`
  If `.git/index.lock` exists, wait and retry (the other agent may be committing).
  Don't push and don't change the Jellyfin injector; the main agent does both.
- Credentials: none are needed. Never print any you come across.

## When you finish

Report to the main agent:
- what you built (files, screens, keys);
- screenshots (save them under `docs/screenshots/hubs/` in this worktree);
- what data it shows and where from;
- known gaps.
Keep the report tight.
