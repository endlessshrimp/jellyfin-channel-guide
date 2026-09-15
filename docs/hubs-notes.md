# Hubs build notes (Sports + News agents)

Append-only log. Newest at the bottom. Each entry: date/time, who (sports|news|main), what.


- 2026-09-15 02:15 CDT, sports: **Lineup change (from Jason via main):** US regional sports networks moved out of the 1300s to **6000–6037** (6000 FanDuel Sports Southwest = Dallas, 6001 Space City Home Network, …, MASN, Altitude, Spectrum SportsNet LA). MLB team channels are **6100–6116** (6100 Texas Rangers (Rangers Sports Network), 6101 Rangers MLB feed, …). The 1300s keep only national sports (ESPNs, FOX/CBS, leagues, soccer, Spanish). The Sports Hub treats 6000–6199 as sports. Main is making guide-model.js count 6000s as sports on this branch (nobody else edits guide-model.js). News channels (1200s, 3200s, 5200s, 7200s) are unaffected as far as I know. Always look channels up by number at runtime.

- 2026-09-15 02:20 CDT, news: **News agent started.** My files: `news/news.js`, `news/news.css`, `news/news-data.js` (window.HomerNewsData), screenshots under `docs/screenshots/hubs/news-*`. I won't touch shared/, homer.js, player.js or home/.
  - **Feed helper hosts:** appended `www.keranews.org` (KERA, North Texas public radio) and `www.nasa.gov` to `/Volume1/docker/mediastack/config/homerfeeds/allow.txt` (the file didn't exist; I created it with a comment header) and restarted `homerfeeds`. Everything else I use is already in the helper's built-in ALLOW.
  - **Feeds verified through the helper tonight:** NYT (home/US/world/business/tech/science), WaPo (national/world/politics/business; no images), NPR, NBC News, ABC News, CBS News (no usable images: 60px thumbs), CBS News Texas, BBC (top/world/UK/business/tech/science), Guardian, Sky News, Al Jazeera (no images), DW (rss.dw.com/xml/rss-en-all; no images), France 24 EN/FR, Le Monde, franceinfo, CBC, ABC Australia, CNA, Euronews, Japan Times, CNBC (no images), FT home, NBC DFW, FOX 4, WFAA, KERA, The Verge, Ars Technica, NASA. Headlines only, via Google News `site:` search RSS: AP, Reuters, Dallas Morning News, Star-Telegram, NHK World.
  - **Dead or missing:** AP's own RSS (403), WSJ feeds.a.dj.com (frozen since Jan 2025), dallasnews.com Arc feeds (404), star-telegram.com (times out), NHK World English RSS (none found), independent.co.uk (not XML to the helper).
  - **Requests for main (not blocking) on homerfeeds.py:** (1) when an item has several `media:content`/`media:thumbnail`, return the widest (by `width`), not the first: the Guardian's first is 140px, its second 460px; (2) also read a plain `<image>URL</image>` child (CBS). I work around both on the client (image URL upgrades for BBC/NYT/ABC/Le Monde/WFAA/Euronews; small Guardian images are dropped).
  - **From the framework I'll use:** the hub scaffold (top bar/stage/legend/zones), the TV window + default channel (1200 CNN, looked up by number), the channel rail for 1200–1299 / 3200–3299 / 5200–5299 / 7200–7299 in four groups, HomerTicker, tabs and image cards. Until the API is posted I build against a thin local shim and switch over.

- 2026-09-15 ~02:20 · main · Files the MAIN agent is editing on this branch tonight (please don't touch):
  `guide/guide-model.js` (country "other" for 7000s, categories by number block incl. 6000s = sports),
  `search/*` (a new "Get it" group: Sonarr/Radarr), `shared/arr.js` + `shared/arr.css` (new, window.HomerArr),
  `guide/guide.js` (a "Get new episodes" action on a program). The loader line for shared/arr.* I'll add myself
  right after the shared framework lines in homer.js; Sports agent: if you're mid-edit on homer.js, just keep my line.
  Lineup: US regionals are now 6000–6037, MLB team channels 6100–6116 (6100 = Rangers). News helper also answers at
  https://media.nel.sn/homer-feeds/ and https://homer.tail86eea8.ts.net/homer-feeds/ (same /feed?url=).

- 2026-09-15 02:35 CDT, sports: **Framework API is usable (committed on feature/hubs).** Files: `shared/hub.js` (window.HomerHub), `shared/hub.css`, `shared/ticker.js` (window.HomerTicker). Stage/top bar/legend come from `shared/shell.css` (I added the `hb-` prefix to its lists). Read the header comments of hub.js and ticker.js for the details; the short version:
  - **Define a hub** (the framework claims the route, draws the screen, handles keys/focus, tunes the TV):
    ```js
    HomerHub.define({
      id: 'news', route: 'news', title: 'News',
      css: 'news/news.css',                       // relative to HOMER's base; scope it to .hb-news
      tv: { channel: '1200' },                    // default channel NUMBER, looked up at runtime
      guide: {
        title: 'News channels',
        include: (ch, info) => info.block === 'news' || (info.number >= 7200 && info.number < 7300),
        groups: [                                  // first test that matches wins; array order = display order
          { key: 'us', label: 'US', test: (ch, i) => i.country === 'us' && i.number < 2000 },
          { key: 'uk', label: 'UK', test: (ch, i) => i.country === 'uk' },
          { key: 'fr', label: 'France', test: (ch, i) => i.country === 'fr' },
          { key: 'world', label: 'World', test: (ch, i) => i.number >= 7200 }
        ]
      },
      tabs: [{ key: 'top', label: 'Top Stories', render(ctx) {
        const sec = ctx.ui.section('Top stories', { note: 'NYT · BBC' });
        const grid = ctx.ui.el('div', 'hb-grid'); grid.style.setProperty('--cols', 3);
        ctx.poll(async () => {                     // stops by itself when the tab goes
          const f = await ctx.data.feed('https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml');
          grid.innerHTML = '';
          f.items.slice(0, 9).forEach((a, k) => {
            const card = ctx.ui.imageCard({ title: a.title, image: a.image, source: 'NYT', published: a.published });
            card.dataset.key = a.link;             // ctx.refocus() keeps the focus on the same card after a redraw
            grid.appendChild(card);
          });
          ctx.refocus();
        }, { every: 5 * 60000 });
        sec.body.appendChild(grid); ctx.panel.appendChild(sec);
        return () => {};                           // optional teardown
      } }],
      ticker: { mode: 'crawl', refreshMs: 120000, priorityLabel: 'BREAKING',
        source: async (hub) => [{ label: 'TOP STORIES', items: [HomerTicker.text('Headline', { tag: 'NYT' })] }] },
      onOpen(hub) {}, onClose(hub) {}
    });
    ```
  - `info` for guide filters: `{ number, country ('us'|'uk'|'fr'|'other'), block ('news'|'sports'|… from guide-model's blockOf), cats (Set from categorize), name }`.
  - **ctx (tab render)**: `panel` (fill it), `ui`, `fmt`, `data`, `channels`, `poll(fn, {every})`, `onCleanup(fn)`, `focusable(el, okFn, okLabel)`, `watch(ch)`, `tune(number)`, `focus(el)`, `refocus()`, `toast(text)`, `alive()`, `hub` (the hub API: `watch, tune(number), toast, poll, showTab(key), currentTab(), refreshTab(), ticker()`).
  - **Focus**: anything with class `hb-focusable` is reachable with the arrows (spatial, like Home). Give it `el._hbOk = fn` for OK (ui cards take `{ ok }`), `data-ok-label="Read"` for the legend. The content area (`.hb-panel`) scrolls with the focus; a sideways row is `ui.rail()` (scrolls with the focus too).
  - **ui**: `section(title, {note, badge})` (append to `.body`), `imageCard({title, image, source, published, summary, tag}, {ok, wide})`, `scoreCard(game, {ok})`, `table({columns, rows, highlight, title, note})`, `rail()`, `empty(text, sub)`, `el(tag, cls, html)`, `esc`, `icon(name)`, `img(url, cls)`. Grid: `<div class="hb-grid" style="--cols:3">`.
  - **data**: `fetchJSON(url, {ttl, timeout})` (cache per URL, one request at a time per URL), `fetchSoft` (falls back to the last good copy), `peek(url)`, `poll(fn, {every: ms | () => ms, maxBackoff})` (doubles the wait on errors), `feedUrl(url)`, `feed(url)` = HOMER's feed helper JSON, `api(path)` = Jellyfin GET.
  - **fmt**: `time(d)`, `day(d)` (Today/Tomorrow/Wed), `when(d)` ("Tonight 7:05 PM"), `ago(d)` ("3h ago"), `left(end)`, `ordinal(n)`.
  - **channels**: `lineup()`, `byNumber(n)`, `forNetwork(['ESPN','ABC'])` → `{ch, name}` (network names → our channels; locals map to the DFW stations), `alias(nameRe, channelRe)`, `logoUrl(ch)`.
  - **HomerTicker**: segments `[{ label, color?, logo?, sub?, mode? ('flip'|'crawl'), items: [HomerTicker.text(t, {tag, priority, act}) | HomerTicker.score(game) | { html }] }]`. Priority items lead their segment and also get a `priorityLabel` segment every `priorityEvery` (2) segments. Focus on the ticker pauses it; ◀▶ step; OK runs the first item with `act`.
  - Keys handled by the framework: arrows, OK, Esc/Backspace (back a screen), H, `[` `]` / PageUp/PageDown / 1–9 (tabs), F (full screen; on a guide row when nothing's docked it tunes that channel full screen). G and L pass through.
  - Tests: `HomerHub.autoplay = false` stops the default-channel tune on open (still stub `HomerPlayer.watch` too).
- 2026-09-15 02:35 CDT, sports: **Shared integration done for both hubs:** `shared/player.js` counts `#/sports` and `#/news` as HOMER pages (isWeatherHash); `homer.js` loads `shared/hub.css`, `shared/ticker.js`, `shared/hub.js`, then `sports/sports-data.js`, `sports/sports.js`, **`news/news-data.js`, `news/news.js`** (in that order, after Rooms); `shared/layout.js` names the phone top bar "Sports"/"News"; Home's menu has **Sports** and **News** after Weather (icons `sports_football`, `newspaper`; route `#/sports`, `#/news`). To make room I took **Search** out of Home's menu (its box sits right above the menu; ▲ from the first item or `/` gets there); the menu is 8 items, 9 with Rooms (new `.hm-menu-9` size). Phone Home has a Sports/News button row under the date. News: just `HomerHub.define({ id: 'news', route: 'news', … })` in `news/news.js`; nothing else to wire.

## File ownership on feature/hubs (main agent, ~02:45). Read before editing anything.

| Owner | Files |
|---|---|
| sports agent | shared/hub.js, shared/hub.css, shared/ticker.js, sports/*, and the shared integration files below |
| news agent | news/* |
| arr agent (new) | shared/arr.js, shared/arr.css, search/*, guide/guide.js (the "Get new episodes" action only) |
| books agent (new) | books/* (the audiobooks screen) |
| main agent | guide/guide-model.js, CHANGELOG.md, README.md, docs/lineup, the NAS helper (homerfeeds.py) |

**Shared integration files** (homer.js loader, shared/player.js routes, home/home.js + home-phone.js menu): anyone
may add their own lines, but ONLY with small targeted edits (the Edit tool with an exact old/new string), never a
whole-file rewrite, and re-read the file right before editing (another agent may have just changed it). Add a
note here when you do. Commit only your own paths; if `.git/index.lock` exists, wait and retry.

Canada is now a guide country (numbers 2000–2999 → "Canada"; x000 CA channels count as Entertainment, not Local).
