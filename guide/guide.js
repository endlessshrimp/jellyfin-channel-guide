/*
 * Channel Guide: full-screen set-top-box guide for Jellyfin Web.
 *
 * Load this script on every Jellyfin Web page (e.g. with the JavaScript Injector
 * plugin). Loading it does not open anything: it adds a "Guide" button to the
 * header and binds the "g" key. It runs inside the signed-in Jellyfin Web page
 * and uses that session's API access.
 *
 * Remote/keyboard: arrows move, OK/Enter watches the channel, R records the
 * selected program, Esc/Back closes.
 *
 * window.ChannelGuide = { open, close, version }
 */
(() => {
    const VERSION = '0.1.12';

    // Loading twice (hot reload, or the injector plus a manual copy) replaces the
    // previous instance instead of attaching a second button/key handler.
    if (window.ChannelGuide && typeof window.ChannelGuide.destroy === 'function') {
        window.ChannelGuide.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="guide.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/guide\.js(\?.*)?$/, '')
        : `https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@v${VERSION}/guide/`;
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const WINDOW_MIN = 180;
    // The stage is always 1080 tall and as wide as the window's shape allows
    // (never narrower than MIN_STAGE_W), so it fills a desktop window edge to edge
    // instead of letterboxing a fixed 16:9 frame.
    const MIN_STAGE_W = 1600;
    const SIDE = 72;
    const CHAN_COL = 300;
    const ROW_H = 76;
    const VISIBLE_ROWS = 5;
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;
    const BTN_CLASS = 'headerChannelGuideButton';

    // ---------- Jellyfin session ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };

    // Identify as Jellyfin Web itself. Jellyfin writes the Device/Version from the
    // auth header onto the token's device record, so a different name here would
    // rename this browser in the dashboard and split it into a second session.
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* fall back to token only; the server fills in the rest */ }
        parts.push(`Token="${server.AccessToken}"`);
        return 'MediaBrowser ' + parts.join(', ');
    };

    const request = async (method, path, body) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const headers = { Authorization: authHeader(server) };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };
    const api = (path) => request('GET', path);

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtShort = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/i, '');
    const genreOf = (p) => (p.IsSports ? 'sports' : p.IsNews ? 'news' : p.IsMovie ? 'movie' : p.IsKids ? 'kids' : null);
    const genreLabel = { sports: 'Sports', news: 'News', movie: 'Movie', kids: 'Kids' };

    // ---------- Channel categories ----------
    // Worked out from the channel name. A channel can be in more than one:
    // Sky Sports (UK) is both Sports and International.
    const CATEGORIES = [
        { key: 'all', label: 'All' },
        { key: 'fav', label: 'Favorites' },
        { key: 'local', label: 'Local' },
        { key: 'news', label: 'News' },
        { key: 'sports', label: 'Sports' },
        { key: 'movies', label: 'Movies' },
        { key: 'kids', label: 'Kids' },
        { key: 'ent', label: 'Entertainment' }
    ];
    // Country is a separate switch that combines with the category (Sports + UK).
    // Irish channels (IE) sit under UK.
    const COUNTRIES = [
        { key: 'all', label: 'All' },
        { key: 'us', label: 'USA' },
        { key: 'uk', label: 'UK' },
        { key: 'fr', label: 'France' }
    ];
    const countryOf = (ch) => {
        const name = String(ch.Name || '');
        if (/\((UK|IE)\)/i.test(name)) return 'uk';
        if (/\(FR\)/i.test(name)) return 'fr';
        return 'us';
    };
    const RULES = {
        news: /^(CNN|CNN International|HLN|FOX News|FOX Business|CNBC|MSNBC|Bloomberg|BBC News|BBC World News|Sky News|ABC News|The Weather Channel|NewsNation|Newsmax)\b/i,
        sports: /(ESPN|FOX Sports|FOX Soccer|FOX Deportes|\bFS[12]\b|NFL|NBA TV|MLB|NHL|Golf|Tennis|SEC Network|Big Ten|Pac 12|CBS Sports|Sky Sports|TNT Sports|beIN|Premier Sports?|La Liga|GOL TV|MASN|Altitude|SportsNet|Racing|Olympic)/i,
        movies: /^(HBO|Cinemax|MoreMax|ActionMax|MovieMax|Showtime|Starz|MGM\+|TCM|AMC|IFC|Sundance|Hallmark Movies|Lifetime Movies|Film 4|Epix)/i,
        kids: /^(Nick|TeenNick|Nicktoons|Disney|Cartoon Network|Boomerang|Universal Kids|PBS Kids)/i,
        local: /(\([KW][A-Z]{2,3}\)|^(ABC|CBS NY|CBS|NBC \d+|FOX \d+|The CW|ION|MeTV|Cozi TV|Laff|Comet TV|Telemundo|Univision|TXA \d+|PBS)\b)/i
    };
    const categorize = (ch) => {
        const name = String(ch.Name || '');
        const base = name.replace(/\s*\((UK|IE|FR)\)(\s*\(\d+\))?$/i, '').replace(/\s*\(\d+\)$/, '');
        const cats = new Set(['all']);
        if (RULES.news.test(base)) cats.add('news');
        else if (RULES.sports.test(base)) cats.add('sports');
        else if (RULES.movies.test(base)) cats.add('movies');
        else if (RULES.kids.test(base)) cats.add('kids');
        else if (RULES.local.test(base) && countryOf(ch) === 'us') cats.add('local');
        else cats.add('ent');
        if (ch.UserData && ch.UserData.IsFavorite) cats.add('fav');
        return cats;
    };

    const logoChip = (ch) => {
        const chip = el('div', 'cg-logo-chip');
        if (ch.ImageTags && ch.ImageTags.Primary) {
            const img = new Image();
            img.src = `/Items/${ch.Id}/Images/Primary?maxHeight=120&tag=${ch.ImageTags.Primary}`;
            img.alt = '';
            img.onerror = () => { chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`; };
            chip.appendChild(img);
        } else {
            chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`;
        }
        return chip;
    };

    // The stylesheet is fetched on first open (not on every Jellyfin page load);
    // resolves once it has loaded, or after a timeout so a slow CDN can't block.
    let cssReady = null;
    const ensureCss = () => {
        if (cssReady && document.getElementById('cg-css')) return cssReady;
        const css = document.createElement('link');
        css.id = 'cg-css';
        css.rel = 'stylesheet';
        css.href = BASE + 'guide.css' + QUERY;
        cssReady = new Promise((resolve) => {
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
        });
        document.head.appendChild(css);
        return cssReady;
    };

    // ---------- Playback ----------

    // Start the channel in this browser tab. Jellyfin Web's own "Play" remote
    // command handler is registered on window.ApiClient, so handing it a Play
    // message locally is exactly what happens when the server tells this client
    // to play something, minus the round trip (and minus the ambiguity when
    // several tabs share one Jellyfin device id).
    const playChannel = async (ch) => {
        const ac = window.ApiClient;
        const server = getServer();
        if (ac && typeof ac.handleMessageReceived === 'function' && (!ac.serverId || ac.serverId() === server.Id)) {
            ac.handleMessageReceived({ MessageType: 'Play', Data: { PlayCommand: 'PlayNow', ItemIds: [ch.Id] } });
            return;
        }
        // Fallback: remote-control this browser's own session through the server.
        const deviceId = (ac && ac.deviceId && ac.deviceId()) || localStorage.getItem('_deviceId2');
        const sessions = await api(`/Sessions?deviceId=${encodeURIComponent(deviceId)}`);
        const mine = (sessions || []).find((s) => s.DeviceId === deviceId && s.SupportsRemoteControl);
        if (!mine) throw new Error('Could not find this browser\'s Jellyfin session');
        await request('POST', `/Sessions/${mine.Id}/Playing?playCommand=PlayNow&itemIds=${ch.Id}`);
    };

    // Home: HOMER Home knows how (it keeps a playing video going); without it,
    // close and go to Jellyfin's home route
    const goHome = () => {
        if (window.HomerPlayer) { window.HomerPlayer.goHome(); return; }
        if (window.HomerHome && window.HomerHome.goHome) { window.HomerHome.goHome(); return; }
        close({ returnToLiveTv: false });
        location.hash = '#/home';
    };

    // ---------- Guide ----------

    let guide = null; // the open guide instance, or null
    let nowWatching = null; // channel last started from the guide
    let openedFromTab = false; // opened in place of Jellyfin's Live TV → Guide tab
    let tabSuppressed = false; // closed from that tab; don't reopen until it's left
    const LIVETV_HOME = '#/livetv?tab=0';

    const open = () => {
        if (guide) return;
        const server = getServer();
        if (!server) {
            console.warn('[Channel Guide] Not signed in to Jellyfin');
            return;
        }
        guide = createGuide(server);
        const g = guide;
        ensureCss().then(() => g.show());
    };

    // returnToLiveTv: when the guide stands in for Jellyfin's own Guide tab,
    // closing it goes to Live TV's first tab instead of revealing the stock guide.
    const close = ({ returnToLiveTv = true } = {}) => {
        if (!guide) return;
        const g = guide;
        guide = null;
        g.teardown();
        const fromTab = openedFromTab;
        openedFromTab = false;
        if (fromTab) {
            tabSuppressed = true;
            if (returnToLiveTv && isNativeGuideRoute()) location.hash = LIVETV_HOME;
        }
    };

    const createGuide = (server) => {
        const root = el('div');
        root.id = 'cg-root';
        root.style.visibility = 'hidden'; // until guide.css has loaded
        const stage = el('div');
        stage.id = 'cg-stage';
        root.appendChild(stage);
        document.body.appendChild(root);

        stage.innerHTML = `
            <div class="cg-topbar">
                <div class="cg-brand homer-home" role="button" title="Home (H)"><span class="cg-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="cg-brand-sub">GUIDE</span></div>
                <label class="cg-search">
                    <span class="material-icons cg-search-icon" aria-hidden="true">search</span>
                    <input class="cg-search-input" type="text" placeholder="Filter channels or shows" autocomplete="off" spellcheck="false" aria-label="Filter channels or shows">
                    <span class="cg-search-count"></span>
                </label>
                <div class="cg-clock"><div class="cg-clock-time"></div><div class="cg-clock-date"></div></div>
            </div>
            <div class="cg-toast" role="status" aria-live="polite"></div>
            <div class="cg-info">
                <div class="cg-info-text">
                    <div class="cg-info-channel"></div>
                    <div class="cg-info-title">Loading guide…</div>
                    <div class="cg-info-meta"></div>
                    <div class="cg-info-desc"></div>
                </div>
                <div class="cg-preview">
                    <div class="cg-preview-art"></div>
                    <div class="cg-preview-logo"></div>
                    <canvas class="cg-preview-live" width="1120" height="630"></canvas>
                    <div class="cg-preview-now"></div>
                    <div class="cg-preview-badge"></div>
                    <div class="cg-preview-bar"><span class="cg-preview-left"></span><span class="cg-preview-right"></span></div>
                    <div class="cg-progress"><i></i></div>
                </div>
            </div>
            <div class="cg-cats" role="tablist" aria-label="Channel categories"></div>
            <div class="cg-grid">
                <div class="cg-timebar"><div class="cg-timebar-day"><b>TODAY</b></div></div>
                <div class="cg-rows"><div class="cg-rows-inner"></div><div class="cg-needle"></div><div class="cg-empty"></div></div>
            </div>
            <div class="cg-legend">
                <span><span class="cg-key">▲▼</span>Channels</span>
                <span><span class="cg-key">◀▶</span>Time</span>
                <span data-action="watch"><span class="cg-key">OK</span>Watch</span>
                <span data-action="record"><span class="cg-key rec">●</span>Record</span>
                <span data-action="search"><span class="cg-key">/</span>Filter</span>
                <span data-action="cat-next"><span class="cg-key">[ ]</span>Category</span>
                <span data-action="country-next"><span class="cg-key">C</span>Country</span>
                <span class="spacer"></span>
                <span data-action="home"><span class="cg-key">H</span>Home</span>
                <span data-action="close"><span class="cg-key">ESC</span>Exit guide</span>
            </div>`;

        const $ = (s) => stage.querySelector(s);

        let stageW = 1920;
        let gridW = stageW - SIDE * 2 - CHAN_COL;
        let pxPerMin = gridW / WINDOW_MIN;
        let relayout = () => {};
        const fit = () => {
            let s = window.innerHeight / 1080;
            let w = window.innerWidth / s;
            if (w < MIN_STAGE_W) { s = window.innerWidth / MIN_STAGE_W; w = MIN_STAGE_W; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
            if (Math.abs(w - stageW) > 0.5) {
                stageW = w;
                gridW = stageW - SIDE * 2 - CHAN_COL;
                pxPerMin = gridW / WINDOW_MIN;
                relayout();
            }
        };

        const tick = () => {
            const d = new Date();
            $('.cg-clock-time').textContent = fmtTime(d);
            $('.cg-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);

        // ---------- Time window ----------
        const now = new Date();
        const winStart = new Date(now);
        winStart.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
        const winEnd = new Date(winStart.getTime() + WINDOW_MIN * 60000);
        const xFor = (d) => Math.max(0, Math.min(gridW, ((d - winStart) / 60000) * pxPerMin));
        const posCell = (c) => {
            const left = xFor(c.s);
            c.el.style.left = left + 4 + 'px';
            c.el.style.width = Math.max(24, xFor(c.e) - left - 8) + 'px';
        };

        const timebar = $('.cg-timebar');
        for (let m = 0; m < WINDOW_MIN; m += 30) {
            const slot = el('div', 'cg-slot', fmtShort(new Date(winStart.getTime() + m * 60000)));
            slot.dataset.m = m;
            slot.style.left = m * pxPerMin + 'px';
            timebar.appendChild(slot);
        }

        const needle = $('.cg-needle');
        const placeNeedle = () => { needle.style.left = CHAN_COL + xFor(new Date()) + 'px'; };
        relayout = () => {
            timebar.querySelectorAll('.cg-slot').forEach((sl) => { sl.style.left = +sl.dataset.m * pxPerMin + 'px'; });
            for (const r of rows) for (const c of r.cells) posCell(c);
            placeNeedle();
        };
        placeNeedle();
        const needleTimer = setInterval(placeNeedle, 30000);

        // ---------- Toast ----------
        const toastEl = $('.cg-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `<span class="cg-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'cg-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'cg-toast'; }, 3200);
        };

        // ---------- Data + render ----------
        let rows = [];
        let order = []; // indices of the rows currently shown (all of them unless filtering)
        let sel = { row: 0, col: 0 };
        const vpos = (r) => order.indexOf(r);
        fit(); // after `rows` exists: fit() relayouts the grid when the width changes
        const timersByProgram = new Map(); // programId -> timerId

        const current = () => {
            const row = rows[sel.row];
            return row ? { row, cell: row.cells[sel.col] } : null;
        };

        const markRecorded = () => {
            for (const row of rows) {
                for (const c of row.cells) {
                    c.el.classList.toggle('rec', !c.unknown && !!c.p.Id && timersByProgram.has(c.p.Id));
                }
            }
        };

        const loadTimers = async () => {
            const res = await api('/LiveTv/Timers');
            timersByProgram.clear();
            for (const t of (res && res.Items) || []) {
                if (t.ProgramId && t.Status !== 'Cancelled') timersByProgram.set(t.ProgramId, t.Id);
            }
        };

        const render = (channels, byChannel) => {
            const inner = $('.cg-rows-inner');
            rows = channels.map((ch) => {
                const progs = (byChannel[ch.Id] || [])
                    .filter((p) => new Date(p.EndDate) > winStart && new Date(p.StartDate) < winEnd)
                    .sort((a, b) => a.StartDate.localeCompare(b.StartDate));
                const row = el('div', 'cg-row');
                const chan = el('div', 'cg-chan');
                chan.appendChild(el('div', 'cg-chan-num', esc(ch.Number)));
                chan.appendChild(logoChip(ch));
                row.appendChild(chan);
                const lane = el('div', 'cg-lane');
                const cells = [];
                const rowData = { el: row, ch, cells, cats: categorize(ch), country: countryOf(ch) };
                const list = progs.length ? progs : [{ Name: '', StartDate: winStart.toISOString(), EndDate: winEnd.toISOString(), _empty: true }];
                for (const p of list) {
                    const s = new Date(p.StartDate);
                    const e = new Date(p.EndDate);
                    const unknown = !!p._empty || PLACEHOLDER.test(p.Name);
                    const cell = el('div', 'cg-prog' + (s <= now && e > now ? ' now' : '') + (unknown ? ' unknown' : ''));
                    posCell({ el: cell, s, e });
                    const g = genreOf(p);
                    if (g) cell.style.setProperty('--genre', `var(--${g})`);
                    const title = unknown ? `${ch.Name} · listings unavailable` : p.Name;
                    const sub = unknown ? '' : [p.EpisodeTitle, `${fmtShort(s)} – ${fmtShort(e)}`].filter(Boolean).join('  ·  ');
                    cell.innerHTML = `<div class="cg-prog-title">${esc(title)}</div><div class="cg-prog-sub">${esc(sub)}</div>`;
                    if (s <= now && e > now && !unknown) {
                        const bar = el('div', 'cg-prog-progress');
                        bar.style.width = Math.round(((now - s) / (e - s)) * 100) + '%';
                        cell.appendChild(bar);
                    }
                    const cellData = { el: cell, p, s, e, unknown };
                    // the mouse only highlights; it never scrolls the grid out from under the pointer
                    cell.addEventListener('mouseenter', () => select(rows.indexOf(rowData), cells.indexOf(cellData), { scroll: false }));
                    cell.addEventListener('click', () => {
                        select(rows.indexOf(rowData), cells.indexOf(cellData), { scroll: false });
                        watch();
                    });
                    cells.push(cellData);
                    lane.appendChild(cell);
                }
                row.appendChild(lane);
                inner.appendChild(row);
                return rowData;
            });

            if (!rows.length) {
                $('.cg-info-title').textContent = 'No channels';
                $('.cg-info-desc').textContent = 'Jellyfin didn\'t return any Live TV channels for this user.';
                return;
            }
            order = rows.map((_, i) => i);
            buildCats();
            markRecorded();
            // start on the first channel that has real listings, on what's airing now
            const first = Math.max(0, rows.findIndex((r) => r.cells.some((c) => !c.unknown)));
            const nowCol = Math.max(0, rows[first].cells.findIndex((c) => c.s <= now && c.e > now));
            select(first, nowCol);
        };

        // The grid scrolls in pixels, like any list: the trackpad moves it freely, and
        // keyboard selection nudges it just enough to keep the highlight in view.
        let scrollY = 0;
        const rowsInner = () => $('.cg-rows-inner');
        const viewH = () => $('.cg-rows').clientHeight || VISIBLE_ROWS * ROW_H;
        const maxScroll = () => Math.max(0, order.length * ROW_H - viewH());
        const setScroll = (y, animate) => {
            scrollY = Math.max(0, Math.min(maxScroll(), y));
            rowsInner().style.transition = animate ? 'transform 160ms ease' : 'none';
            rowsInner().style.transform = `translateY(${-scrollY}px)`;
        };
        const select = (r, c, { scroll = true } = {}) => {
            if (r < 0 || r >= rows.length || vpos(r) < 0) return;
            const row = rows[r];
            c = Math.max(0, Math.min(row.cells.length - 1, c));
            const prev = rows[sel.row];
            if (prev) {
                prev.el.classList.remove('sel');
                prev.cells[sel.col]?.el.classList.remove('sel');
            }
            sel = { row: r, col: c };
            row.el.classList.add('sel');
            row.cells[c].el.classList.add('sel');
            // keyboard/wheel: scroll only when the selection leaves the visible rows
            if (scroll) {
                const top = vpos(r) * ROW_H;
                if (top < scrollY) setScroll(top, true);
                else if (top + ROW_H > scrollY + viewH()) setScroll(top + ROW_H - viewH(), true);
            }
            showInfo(row.ch, row.cells[c]);
        };

        const showInfo = (ch, cell) => {
            const { p, s, e, unknown } = cell;
            const live = s <= now && e > now;
            $('.cg-info-channel').innerHTML = '';
            $('.cg-info-channel').appendChild(logoChip(ch));
            $('.cg-info-channel').appendChild(el('div', 'cg-info-chname', `<b>${esc(ch.Number)}</b>${esc(ch.Name)}`));
            $('.cg-info-title').textContent = unknown ? ch.Name : p.Name;
            const meta = $('.cg-info-meta');
            meta.innerHTML = '';
            if (live) meta.appendChild(el('span', 'cg-chip live', 'Live'));
            if (!unknown && timersByProgram.has(p.Id)) meta.appendChild(el('span', 'cg-chip rec', 'Recording'));
            if (!unknown) meta.appendChild(el('span', 'cg-chip', `${fmtTime(s)} – ${fmtTime(e)}`));
            const g = genreOf(p);
            if (g) {
                const chip = el('span', 'cg-chip genre', genreLabel[g]);
                chip.style.background = `var(--${g})`;
                meta.appendChild(chip);
            }
            if (p.ParentIndexNumber && p.IndexNumber) meta.appendChild(el('span', 'cg-chip', `S${p.ParentIndexNumber} E${p.IndexNumber}`));
            if (p.OfficialRating) meta.appendChild(el('span', 'cg-chip', esc(p.OfficialRating)));
            $('.cg-info-desc').textContent = unknown ? 'No listing information from this channel\'s guide.' : (p.EpisodeTitle ? p.EpisodeTitle + ' — ' : '') + (p.Overview || '');

            // preview window
            const art = $('.cg-preview-art');
            art.style.backgroundImage = p.ImageTags && p.ImageTags.Primary ? `url(/Items/${p.Id}/Images/Primary?maxWidth=700&tag=${p.ImageTags.Primary})` : 'none';
            const logo = $('.cg-preview-logo');
            logo.innerHTML = '';
            if (!(p.ImageTags && p.ImageTags.Primary)) logo.appendChild(logoChip(ch));
            $('.cg-preview-badge').innerHTML = live ? '<span class="cg-chip live">Live</span>' : '<span class="cg-chip">Upcoming</span>';
            $('.cg-preview-left').textContent = `CH ${ch.Number}`;
            $('.cg-preview-right').textContent = live && !unknown ? `${Math.round((e - now) / 60000)} min left` : unknown ? '' : `Starts ${fmtTime(s)}`;
            $('.cg-progress > i').style.width = live && !unknown ? Math.round(((now - s) / (e - s)) * 100) + '%' : '0';
        };

        // ---------- Actions ----------
        const watch = () => {
            const cur = current();
            if (!cur) return;
            nowWatching = cur.row.ch;
            // watching from the guide is always full screen, even if Home had the
            // channel playing in its preview window
            if (window.HomerPlayer && window.HomerPlayer.docked()) window.HomerPlayer.fullscreen();
            close({ returnToLiveTv: false });
            playChannel(cur.row.ch).catch((err) => console.error('[Channel Guide] Playback failed:', err));
        };

        let recording = false;
        const record = async () => {
            const cur = current();
            if (!cur || recording) return;
            const { cell } = cur;
            if (cell.unknown || !cell.p.Id) {
                toast('No listing to record', 'err');
                return;
            }
            if (timersByProgram.has(cell.p.Id)) {
                toast(`Already set to record ${cell.p.Name}`, 'rec');
                return;
            }
            if (cell.e <= new Date()) {
                toast('That program has already ended', 'err');
                return;
            }
            recording = true;
            try {
                const defaults = await api(`/LiveTv/Timers/Defaults?programId=${encodeURIComponent(cell.p.Id)}`);
                await request('POST', '/LiveTv/Timers', defaults);
                try {
                    await loadTimers();
                } catch {
                    // the timer was created; mark it even if the refresh failed
                    timersByProgram.set(cell.p.Id, null);
                }
                if (!timersByProgram.has(cell.p.Id)) timersByProgram.set(cell.p.Id, null);
                if (guide !== self) return;
                markRecorded();
                showInfo(cur.row.ch, cell);
                toast(`Recording ${cell.p.Name}`, 'rec');
            } catch (err) {
                console.error('[Channel Guide] Recording failed:', err);
                if (guide === self) toast('Couldn\'t schedule that recording', 'err');
            } finally {
                recording = false;
            }
        };

        // ---------- Input ----------
        // moving up/down keeps the same point in time, like a real guide
        const nearestCol = (r) => {
            if (!rows[r]) return 0;
            const cur = rows[sel.row].cells[sel.col];
            const t = cur ? Math.max(cur.s, now) : now;
            const i = rows[r].cells.findIndex((c) => c.s <= t && c.e > t);
            return i < 0 ? 0 : i;
        };

        const step = (d) => {
            const v = vpos(sel.row) + d;
            if (v < 0 || v >= order.length) return;
            select(order[v], nearestCol(order[v]));
        };

        // ---------- Filter ----------
        const searchInput = $('.cg-search-input');
        let query = '';
        const lc = (x) => String(x ?? '').toLowerCase();
        let category = 'all';
        let country = 'all';
        const inScope = (row) => row.cats.has(category) && (country === 'all' || row.country === country);
        const applyFilter = (text) => {
            query = lc(text).trim();
            order = [];
            rows.forEach((row, i) => {
                if (!inScope(row)) {
                    row.el.style.display = 'none';
                    for (const c of row.cells) c.el.classList.remove('match');
                    return;
                }
                const chMatch = !query || lc(row.ch.Name).includes(query) || lc(row.ch.Number).startsWith(query);
                let progMatch = false;
                for (const c of row.cells) {
                    const m = !!query && !c.unknown && lc(`${c.p.Name} ${c.p.EpisodeTitle || ''}`).includes(query);
                    c.el.classList.toggle('match', m);
                    if (m) progMatch = true;
                }
                const show = !query || chMatch || progMatch;
                row.el.style.display = show ? '' : 'none';
                row.el.classList.toggle('dim-others', !!query && progMatch && !chMatch);
                if (show) order.push(i);
            });
            root.classList.toggle('filtering', !!query);
            $('.cg-search-count').textContent = query ? `${order.length} channel${order.length === 1 ? '' : 's'}` : '';
            const empty = $('.cg-empty');
            const catLabel = [
                category !== 'all' ? (CATEGORIES.find((c) => c.key === category) || {}).label : '',
                country !== 'all' ? (COUNTRIES.find((c) => c.key === country) || {}).label : ''
            ].filter(Boolean).join(' · ') || 'these';
            empty.textContent = order.length ? ''
                : query ? `Nothing in ${catLabel} matches “${text.trim()}”`
                    : category === 'fav' ? 'No favorite channels yet. Heart a channel in Jellyfin to add it here.'
                        : `No ${catLabel} channels`;
            empty.classList.toggle('show', !order.length);
            setScroll(0, false);
            if (!order.length) return;
            // land on the first match: a matching show airing now or next, else what's on now
            const r = order[0];
            let c = rows[r].cells.findIndex((x) => x.el.classList.contains('match') && x.e > now);
            if (c < 0) c = Math.max(0, rows[r].cells.findIndex((x) => x.s <= now && x.e > now));
            select(r, c);
        };
        searchInput.addEventListener('input', () => applyFilter(searchInput.value));

        const catBar = $('.cg-cats');
        const buildCats = () => {
            catBar.innerHTML = '';
            const inCountry = (r) => country === 'all' || r.country === country;
            CATEGORIES.forEach((c, i) => {
                const n = rows.filter((r) => r.cats.has(c.key) && inCountry(r)).length;
                const chip = el('button', 'cg-cat' + (c.key === category ? ' on' : ''),
                    `<span class="cg-cat-num">${i + 1}</span>${esc(c.label)}<span class="cg-cat-count">${n}</span>`);
                chip.type = 'button';
                chip.dataset.cat = c.key;
                chip.setAttribute('role', 'tab');
                chip.setAttribute('aria-selected', String(c.key === category));
                catBar.appendChild(chip);
            });
            catBar.appendChild(el('span', 'cg-cats-spacer'));
            const seg = el('div', 'cg-countries');
            seg.setAttribute('role', 'group');
            seg.setAttribute('aria-label', 'Country');
            COUNTRIES.forEach((c) => {
                const n = c.key === 'all' ? rows.length : rows.filter((r) => r.country === c.key).length;
                const b = el('button', 'cg-country' + (c.key === country ? ' on' : ''), `${esc(c.label)}<span class="cg-cat-count">${n}</span>`);
                b.type = 'button';
                b.dataset.country = c.key;
                b.setAttribute('aria-pressed', String(c.key === country));
                seg.appendChild(b);
            });
            catBar.appendChild(seg);
        };
        const setCountry = (key) => {
            if (!COUNTRIES.some((c) => c.key === key)) return;
            country = key;
            buildCats(); // category counts follow the country
            applyFilter(searchInput.value);
        };
        const cycleCountry = () => {
            const i = COUNTRIES.findIndex((c) => c.key === country);
            setCountry(COUNTRIES[(i + 1) % COUNTRIES.length].key);
        };
        const setCategory = (key) => {
            if (!CATEGORIES.some((c) => c.key === key)) return;
            category = key;
            catBar.querySelectorAll('.cg-cat').forEach((b) => {
                const on = b.dataset.cat === key;
                b.classList.toggle('on', on);
                b.setAttribute('aria-selected', String(on));
            });
            applyFilter(searchInput.value);
        };
        const cycleCategory = (d) => {
            const i = CATEGORIES.findIndex((c) => c.key === category);
            setCategory(CATEGORIES[(i + d + CATEGORIES.length) % CATEGORIES.length].key);
        };
        catBar.addEventListener('click', (ev) => {
            const b = ev.target.closest('.cg-cat');
            if (b) { setCategory(b.dataset.cat); return; }
            const cb = ev.target.closest('.cg-country');
            if (cb) setCountry(cb.dataset.country);
        });
        const clearFilter = () => {
            searchInput.value = '';
            applyFilter('');
        };
        const focusSearch = () => {
            searchInput.focus();
            searchInput.select();
        };

        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key;
            // typing in the filter box: let the box have the keys, except a few that
            // hand control back to the grid
            if (ev.target === searchInput) {
                if (k === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (searchInput.value) clearFilter();
                    else searchInput.blur();
                } else if (k === 'Enter' || k === 'ArrowDown' || k === 'Tab') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    searchInput.blur();
                } else {
                    ev.stopPropagation();
                }
                return;
            }
            if (k === '[' || k === ']') {
                ev.preventDefault();
                ev.stopPropagation();
                cycleCategory(k === ']' ? 1 : -1);
                return;
            }
            if (k === 'c' || k === 'C') {
                ev.preventDefault();
                ev.stopPropagation();
                cycleCountry();
                return;
            }
            if (/^[1-9]$/.test(k) && CATEGORIES[+k - 1]) {
                ev.preventDefault();
                ev.stopPropagation();
                setCategory(CATEGORIES[+k - 1].key);
                return;
            }
            if (k === '/') {
                ev.preventDefault();
                ev.stopPropagation();
                focusSearch();
                return;
            }
            if ((k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') && query) {
                ev.preventDefault();
                ev.stopPropagation();
                clearFilter();
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', 'Escape', 'Backspace', 'GoBack', 'BrowserBack', 'r', 'R', 'g', 'G'];
            if (!handled.includes(k)) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.repeat && (k === 'Enter' || k === 'r' || k === 'R')) return;
            if (!rows.length && !['Escape', 'Backspace', 'GoBack', 'BrowserBack', 'g', 'G'].includes(k)) return;
            if (k === 'ArrowDown') step(1);
            else if (k === 'ArrowUp') step(-1);
            else if (k === 'PageDown') pageBy(1);
            else if (k === 'PageUp') pageBy(-1);
            else if (k === 'ArrowRight') select(sel.row, sel.col + 1);
            else if (k === 'ArrowLeft') select(sel.row, sel.col - 1);
            else if (k === 'Enter') watch();
            else if (k === 'r' || k === 'R') record();
            else close();
        };
        // Page Up / Page Down keys still jump a screen at a time.
        const pageBy = (dir) => {
            if (!order.length) return;
            const v = Math.max(0, Math.min(order.length - 1, vpos(sel.row) + dir * VISIBLE_ROWS));
            setScroll(scrollY + dir * VISIBLE_ROWS * ROW_H, true);
            select(order[v], nearestCol(order[v]));
        };
        const onWheel = (ev) => {
            ev.preventDefault();
            if (!rows.length) return;
            const px = ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaMode === 2 ? ev.deltaY * viewH() : ev.deltaY;
            setScroll(scrollY + px, false);
        };
        const onLegendClick = (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'watch') watch();
            else if (action === 'record') record();
            else if (action === 'search') focusSearch();
            else if (action === 'cat-next') cycleCategory(1);
            else if (action === 'country-next') cycleCountry();
            else if (action === 'close') close();
            else if (action === 'home') goHome();
        };

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        // Catch wheel/trackpad events at the window, before anything else sees them:
        // Jellyfin's player turns scroll gestures into volume changes, and the
        // guide sits on top of the player. While the guide is open, scrolling is
        // the guide's alone.
        const onWheelCapture = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            if (root.contains(ev.target)) onWheel(ev);
        };
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
        $('.cg-legend').addEventListener('click', onLegendClick);
        $('.cg-brand').addEventListener('click', () => goHome());

        // ---------- Live preview ----------
        // While something is playing (full screen underneath, or in the browser's
        // floating picture-in-picture window), the preview shows that live picture.
        const liveCanvas = $('.cg-preview-live');
        const live2d = liveCanvas.getContext('2d');
        // Not when the video is in the floating picture-in-picture window: it's
        // already on screen there, so the preview shows the highlighted channel.
        const playingVideo = () => [...document.querySelectorAll('video')]
            .find((v) => !root.contains(v) && v !== document.pictureInPictureElement
                && !v.paused && v.readyState >= 2 && v.videoWidth > 0);
        const mirror = () => {
            const v = playingVideo();
            root.classList.toggle('cg-live-on', !!v);
            if (!v) return;
            const cw = liveCanvas.width;
            const chh = liveCanvas.height;
            const vr = v.videoWidth / v.videoHeight;
            const cr = cw / chh;
            let sw = v.videoWidth; let sh = v.videoHeight; let sx = 0; let sy = 0;
            if (vr > cr) { sw = sh * cr; sx = (v.videoWidth - sw) / 2; } else { sh = sw / cr; sy = (v.videoHeight - sh) / 2; }
            try {
                live2d.drawImage(v, sx, sy, sw, sh, 0, 0, cw, chh);
                $('.cg-preview-now').textContent = nowWatching ? `Now watching · ${nowWatching.Name}` : 'Now watching';
            } catch {
                root.classList.remove('cg-live-on');
            }
        };
        const mirrorTimer = setInterval(mirror, 66);

        const self = {
            show() {
                root.style.visibility = '';
            },
            teardown() {
                clearInterval(mirrorTimer);
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('resize', fit);
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                clearInterval(clockTimer);
                clearInterval(needleTimer);
                clearTimeout(toastTimer);
                root.remove();
            }
        };

        (async () => {
            const [ch, progs] = await Promise.all([
                api(`/LiveTv/Channels?userId=${server.UserId}&limit=1000&EnableImages=true&ImageTypeLimit=1&EnableUserData=true`),
                api(`/LiveTv/Programs?userId=${server.UserId}&MinEndDate=${winStart.toISOString()}&MaxStartDate=${winEnd.toISOString()}&limit=5000&fields=Overview&EnableImages=true&ImageTypeLimit=1`),
                loadTimers().catch((err) => console.warn('[Channel Guide] Could not read timers:', err))
            ]);
            if (guide !== self) return;
            const byChannel = {};
            for (const p of progs.Items) (byChannel[p.ChannelId] = byChannel[p.ChannelId] || []).push(p);
            const channels = ch.Items.sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0) || a.Name.localeCompare(b.Name));
            render(channels, byChannel);
        })().catch((err) => {
            console.error('[Channel Guide]', err);
            if (guide === self) $('.cg-info-title').textContent = 'Couldn\'t load the guide';
        });

        return self;
    };

    // ---------- Launcher: header button + "g" key ----------

    const makeButton = () => {
        let btn;
        try {
            btn = document.createElement('button', { is: 'paper-icon-button-light' });
        } catch {
            btn = document.createElement('button');
        }
        btn.type = 'button';
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.className = `headerButton headerButtonRight ${BTN_CLASS} paper-icon-button-light`;
        btn.title = 'Guide';
        btn.setAttribute('aria-label', 'Guide');
        btn.innerHTML = '<span class="material-icons live_tv" aria-hidden="true"></span>';
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            open();
        });
        return btn;
    };

    const syncButton = () => {
        const signedIn = !!getServer();
        const existing = document.querySelectorAll('.' + BTN_CLASS);
        const right = document.querySelector('.skinHeader .headerRight');
        existing.forEach((b) => {
            if (!signedIn || !right || b.parentNode !== right) b.remove();
        });
        if (!signedIn || !right || right.querySelector('.' + BTN_CLASS)) return;
        const btn = makeButton();
        const before = right.querySelector('.headerSearchButton') || right.querySelector('.headerUserButton');
        right.insertBefore(btn, before || null);
    };

    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued) return;
        syncQueued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            syncButton();
            syncOsdButton();
            syncTakeover();
        }, 50);
    };

    const isTyping = (t) => {
        if (!t || !(t instanceof Element)) return false;
        if (t.isContentEditable) return true;
        const tag = t.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };

    const onGlobalKey = (ev) => {
        if (guide || ev.defaultPrevented || ev.repeat) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (ev.key !== 'g' && ev.key !== 'G') return;
        if (isTyping(ev.target) || isTyping(document.activeElement)) return;
        if (!getServer()) return;
        ev.preventDefault();
        open();
    };

    // ---------- Stand in for Jellyfin's own Guide tab ----------
    // Live TV → Guide opens this guide instead of the stock grid. After it's
    // closed from that tab we stay out of the way until the tab is left, so the
    // user isn't bounced straight back in.

    const isNativeGuideRoute = () => /^#\/livetv(\.html)?\?(.*&)?tab=1(&|$)/.test(location.hash);
    const nativeGuideShowing = () => isNativeGuideRoute() || !!document.querySelector('.page:not(.hide) .tvguide.is-active');

    const syncTakeover = () => {
        if (!nativeGuideShowing()) {
            tabSuppressed = false;
            return;
        }
        if (guide || tabSuppressed || !getServer()) return;
        openedFromTab = true;
        open();
    };

    // ---------- Guide over the player ----------
    // Leaving Jellyfin's player page stops the video, so the guide never makes you
    // leave it: it opens on top of whatever is on screen and the video keeps going.

    const openOverPlayer = () => {
        if (guide || !getServer()) return;
        openedFromTab = false;
        open();
    };

    // Shrinking the player into the browser's floating window sends Jellyfin back
    // to the previous page; put the guide up behind the floating video instead.
    let pipPendingUntil = 0;
    const onEnterPip = (ev) => {
        if (!(ev.target instanceof HTMLVideoElement)) return;
        pipPendingUntil = Date.now() + 3000;
        setTimeout(() => {
            if (pipPendingUntil) {
                pipPendingUntil = 0;
                openOverPlayer();
            }
        }, 1200);
    };

    // A Guide button in the player's own control bar
    const OSD_BTN_CLASS = 'cgOsdGuideButton';
    const syncOsdButton = () => {
        const bar = document.querySelector('.videoOsdBottom .buttons');
        if (!bar || bar.querySelector('.' + OSD_BTN_CLASS) || !getServer()) return;
        let btn;
        try {
            btn = document.createElement('button', { is: 'paper-icon-button-light' });
        } catch {
            btn = document.createElement('button');
        }
        btn.type = 'button';
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.className = `autoSize paper-icon-button-light ${OSD_BTN_CLASS}`;
        btn.title = 'Guide';
        btn.setAttribute('aria-label', 'Guide');
        btn.innerHTML = '<span class="xlargePaperIconButton material-icons live_tv" aria-hidden="true"></span>';
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openOverPlayer();
        });
        const before = bar.querySelector('.btnPip, .btnVideoOsdSettings, .btnFullscreen');
        bar.insertBefore(btn, before || null);
    };

    // Jellyfin Web is a single-page app: leaving the current view (back button,
    // a link) should take the guide down with it.
    const onRouteChange = () => {
        close({ returnToLiveTv: false });
        tabSuppressed = false;
        queueSync();
        if (pipPendingUntil && Date.now() < pipPendingUntil) {
            pipPendingUntil = 0;
            setTimeout(openOverPlayer, 300);
        }
    };

    let observer = null;
    const start = () => {
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    // capture phase, so Jellyfin's player page can't swallow the key first
    document.addEventListener('keydown', onGlobalKey, true);
    document.addEventListener('enterpictureinpicture', onEnterPip, true);
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.ChannelGuide = {
        version: VERSION,
        open,
        close,
        destroy() {
            close();
            observer && observer.disconnect();
            document.removeEventListener('keydown', onGlobalKey, true);
            document.removeEventListener('enterpictureinpicture', onEnterPip, true);
            document.querySelectorAll('.' + OSD_BTN_CLASS).forEach((b) => b.remove());
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.querySelectorAll('.' + BTN_CLASS).forEach((b) => b.remove());
            document.getElementById('cg-css')?.remove();
            cssReady = null;
        }
    };
})();
