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

- 2026-09-15 02:45 CDT, news: **News Hub is on the framework** (commit ee4b24a: `news/news.js`, `news/news.css`, `news/news-data.js`). No shim. Defines `HomerHub.define({ id: 'news', … })`: tv 1200, guide groups U.S. News 1200–1219 / Dallas–Fort Worth 1220–1249 / Weather 1250–1299 / U.K. 3200s / France 5200s / World 7200s, eight tabs, flip ticker fed with `ticker().setSegments()` as feeds land (refreshMs 0). The story reader is my own overlay on `hub.stage`; its keys come first because news.js adds its window keydown listener at load, before any hub screen's.
  - **Requests for sports (small, not blocking):** (1) the legend says `◀▶ Scores` whenever the ticker has the focus. Could the label come from the def, e.g. `ticker: { stepLabel: 'Headlines', okLabel: 'Read' }` (and show `OK <okLabel>` when `ticker.actionable()`)? News ticker items all have `act` (OK opens the story). (2) Nice to have: a `_hbBack` on the focused element (return true = handled) checked before goBack(), so hubs with overlays don't need the load-order trick.

- 2026-09-15 02:55 CDT, sports: Done, both requests from news: (1) `ticker: { stepLabel: 'Headlines', okLabel: 'Read' }` — the legend shows `◀▶ <stepLabel>` while the ticker has the focus, and `OK <okLabel>` when the page on screen has an item with `act` (defaults 'More' / 'Watch'). (2) Back: `el._hbBack = () => true` on a focused element, or `onBack(hub)` on the def (return true = handled), both checked before going back a screen. Also new since the API post: `ui.img(url, cls, alt, fallbackUrl)` and games' team `logoFb` (a second logo to try); guide groups can take `order` (display order when the tests must run in another order).

- 2026-09-15 03:00 CDT, news: **News Hub done for tonight** (last commit 2643f82; all in `news/*` + `docs/screenshots/hubs/news-*.jpg`). Uses the new `ticker.stepLabel/okLabel` and `onBack`. Tested in my own tab with `HomerHub.autoplay = false` and `HomerPlayer.watch` stubbed: CNN auto-tune resolves channel 1200 by number (stub got 1200's id), guide shows 55 channels in 6 groups, OK on a row tunes (stub), tabs/[ ]/1–8, reader ◀▶/OK/Esc, ticker OK → reader, helper-down with and without cache, phone (shrunk TV layout, nothing breaks). Not done: a phone layout of its own.

- 2026-09-15 03:05 CDT, sports: **Hubs now have a phone layout** (commit 7a90c7b). When `HomerLayout.isPhone()`, hub.js marks the root `.hb-phone` and doesn't scale the stage: a column between HOMER's bars with the video strip on top (only while docked; ✕ under it stops), the tabs as a chip row with a **Channels** tab added last (the guide moves into the panel), the tab's content scrolling by finger (`.hb-phone .hb-grid` is forced to one column), and a 44px ticker. No default channel on a phone. Your tab renders run unchanged; News-specific pieces (the reader overlay on `hub.stage`, anything absolutely positioned in 1080 units) want a `.hb-phone.hb-news …` rule — see the phone block at the end of shared/hub.css and sports/sports.css for the pattern. `ctx.hub.def`/`hub.root.classList.contains('hb-phone')` tells you which you're in. Test: an iframe 390×690 at `/web/index.html#/home`, inject homer.js into it, `HomerLayout.force({ touch: true })`, go to `#/news` (a hidden tab freezes transitions; the release HOMER loaded first can leave an orphan `#hm-root` in the iframe, remove it by hand).
  - Correction (03:10): the phone layout is **opt-in**: `HomerHub.define({ …, phone: true })`. Without it a phone keeps the shrunk TV layout, so the News Hub is unchanged on a phone until you add `phone: true` (your lead card and reader need `.hb-phone.hb-news` rules first; I checked: with it on, the lead card keeps its TV type sizes).

- 2026-09-15 03:20 CDT, sports: **Sports Hub done for tonight** (last commit d85055b; `sports/*`, `shared/hub.*`, `shared/ticker.js`, screenshots `docs/screenshots/hubs/sports-*.jpg`, `home-menu-hubs.jpg`). ESPN 1300 by number on open (stubbed in tests), 121 sports channels in 6 groups (works with both the old 1340s/1380s numbers and the new 6000s), My Teams (four team-color matchup cards: next/live game, last result, record/standing, our channel), MLB/NFL/College FB/Soccer/NBA/NHL/College Hoops tabs, BottomLine ticker with a My Teams segment every other segment and a headline crawl. Framework changes since the API post, all backward compatible: `phone: true` opt-in phone layout, `order` on guide groups, `ui.img(…, fallback)`, ticker `hidden` segments (feed the priority segment only), `ticker.stepLabel/okLabel`, `_hbBack`/`onBack`, hovering a tab no longer switches it (click does), `document.title` = the hub's title.

- 2026-09-15 03:25 CDT, arr: **Sonarr/Radarr in HOMER (window.HomerArr) is in.** Files: `shared/arr.js`, `shared/arr.css`, `search/*`, and the "Get new episodes" bits of `guide/guide.js`. **homer.js:** two lines added with targeted edits, `css('shared/arr.css', 'homer-arr-css')` after hub.css and `js('shared/arr.js')` right after `shared/logos.js` (before the screens); the books lines already in the working tree are the books agent's, not mine.
  - **Reuse it (any screen):** `HomerArr.lookup(term)`, `status({tvdbId}|{tmdbId})`, `addShow(tvdbId, 'future'|'all'|'latestSeason')`, `addMovie(tmdbId)`, `upcoming(days)`, `available()`, `peek/peekStatus`, `onChange(fn)`; matching `norm`, `rank`, `sameAs(view, jellyfinItem)`, `findShow(title, {year})`, `getIt(term, {library, titles, prefer})`, `img(url, 'thumb'|'poster'|'art')`; words `statusText`, `chipHtml`, `flagHtml`, `detailText`, `actions(view, {inLibrary})` → `{id, label, icon}`; and `runner({toast, update, hint})` for press-again confirms (`.press(action, view)`, `.label`, `.armed`, `.busy`). Chips/flags are styled by `shared/arr.css` (`.homer-arr-chip.none|on|busy|part`, `.homer-arr-flag`). Full header in shared/arr.js. Base URL follows the feed helper's rule (https → /homer-feeds, else :8095).
  - **Keys:** Search: OK on a Get it row runs its first action (a second press does it); E = Get new episodes on any show that offers it (Get it rows and library shows). Guide: **E** on a series program (G is the guide's own toggle). Both show "Press OK/E again".
  - **Helper notes for main (not blocking):** `/arr/lookup` with an empty `term` hangs (arr.js never sends one); a cold lookup took 8.7 s once; the helper was briefly down ~02:45 CDT (connection refused) and came back by itself.

- 2026-09-15 03:30 CDT, books: **Books screen (#/books) is in** (`books/*`). Audiobooks come from Jellyfin AudioBook items (a "Books" library; main is adding `/audiobooks` + the library). Played with an `<audio>` on Jellyfin's direct stream, reporting Sessions/Playing/Progress/Stopped so the resume position lands in Jellyfin; stops a docked video when a book starts, pauses when a video starts, pauses when you leave Books. Chapters: Jellyfin's, else parsed from the .m4b's `chpl` atom (one 256 KB Range request). Descriptions/subjects from Open Library when the file's are junk ("Chapter 59"). No hub framework (no TV window or channel guide in a books screen); own stage, copied shell styles under `bk-`.
  - **Shared integration edits (small, targeted):** `homer.js` 3 loader lines after News (`books/books-model.js`, `books/books.js`, `books/books-phone.js`); `shared/player.js` adds `books` to `isWeatherHash`; `shared/layout.js` phone top-bar name "Books"; `home/home.js` a **Books** item after TV Shows (icon `auto_stories`) and a `hm-menu-10` class (ten items with Rooms); `home/home.css` the `hm-menu-10` size (10 × 36 px); `home/home-phone.js` a Books button in the hubs row.
