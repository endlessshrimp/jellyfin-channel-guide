/*
 * Channel Guide: full-screen set-top-box guide for Jellyfin Web.
 *
 * Load this script on every Jellyfin Web page (e.g. with the JavaScript Injector
 * plugin). Loading it does not open anything: it adds a "Guide" button to the
 * header and binds the "g" key. It runs inside the signed-in Jellyfin Web page
 * and uses that session's API access.
 *
 * Remote/keyboard: arrows move (◀▶ past the edge pages through time), OK/Enter
 * watches the channel (or records a program that hasn't started), R records the
 * selected program (R twice cancels a recording), N comes back to now,
 * Esc/Back closes.
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

    const WINDOW_MIN = 180; // one screen of the grid
    const PAGE_MIN = WINDOW_MIN / 2; // ◀▶ past the edge moves at least half a screen
    const SLOT_MIN = 30;
    // Listings load a screen's worth (3 hours) at a time, as they're needed, plus
    // the next 3 hours ahead of time. One request at a time: the NAS is slow
    // under load, and the whole EPG is several days of ~400 channels.
    const CHUNK_MIN = 180;
    const RETRY_MS = 15000; // a chunk that failed is tried again after this
    const MIN_MS = 60000;
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
    // the half hour a time falls in (local time, so slots stay on :00 and :30)
    const floorSlot = (t) => {
        const d = new Date(t);
        d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
        return d.getTime();
    };
    // "Today", "Tomorrow", or "Mon, Sep 14", relative to the real today
    const dayWord = (d) => {
        const a = new Date(d);
        a.setHours(0, 0, 0, 0);
        const b = new Date();
        b.setHours(0, 0, 0, 0);
        const days = Math.round((a - b) / 86400000);
        return days === 0 ? 'Today' : days === 1 ? 'Tomorrow'
            : a.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    };
    // a program's time, with its day when that isn't today
    const fmtWhen = (s, e) => {
        const day = dayWord(s);
        return (day === 'Today' ? '' : day + ' · ') + `${fmtTime(s)} – ${fmtTime(e)}`;
    };
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
        // French names alongside: BFM, LCI, franceinfo, Canal+ Sport, L'Equipe, …
        news: /^(CNN|CNN International|HLN|FOX News|FOX Business|CNBC|MSNBC|Bloomberg|BBC News|BBC World News|Sky News|ABC News|The Weather Channel|NewsNation|Newsmax|BFM|CNews|LCI|France ?Info|France 24|LCP|Euronews|i24|La Cha[iî]ne M[eé]t[eé]o)\b/i,
        sports: /(ESPN|FOX Sports|FOX Soccer|FOX Deportes|\bFS[12]\b|NFL|NBA TV|MLB|NHL|Golf|Tennis|SEC Network|Big Ten|Pac 12|CBS Sports|Sky Sports|TNT Sports|beIN|Premier Sports?|La Liga|GOL TV|MASN|Altitude|SportsNet|Racing|Olympic|Canal\+ Sport|Foot\+|Eurosport|L'?[EÉ]quipe|Info ?Sport|Multisports?|RMC Sport)/i,
        movies: /^(HBO|Cinemax|MoreMax|ActionMax|MovieMax|Showtime|Starz|MGM\+|TCM|AMC|IFC|Sundance|Hallmark Movies|Lifetime Movies|Film 4|Epix|Canal\+ Cin[eé]ma|OCS|Cin[eé]\+|Paramount Channel)/i,
        kids: /^(Nick|TeenNick|Nicktoons|Disney|Cartoon Network|Boomerang|Universal Kids|PBS Kids|Canal J|Gulli|TiJi|Piwi)/i,
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
    // Programs with a recording request on its way to Jellyfin, from any guide
    // opened in this tab. Jellyfin can take half a minute to answer one, and a
    // guide closed and reopened in the meantime mustn't send a second.
    const scheduling = new Set();
    let nowWatching = null; // channel last started from the guide
    let openedFromTab = false; // opened in place of Jellyfin's Live TV → Guide tab
    let tabSuppressed = false; // closed from that tab; don't reopen until it's left
    const LIVETV_HOME = '#/home'; // Jellyfin's Live TV pages don't show under HOMER

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
                <span data-action="now" class="cg-legend-now" hidden><span class="cg-key">N</span>Back to now</span>
                <span data-action="ok" class="cg-legend-ok"><span class="cg-key">OK</span><span class="cg-legend-ok-label">Watch</span></span>
                <span><span class="cg-key rec">R</span>Record</span>
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
        let stageScale = 1;
        let relayout = () => {};
        const fit = () => {
            let s = window.innerHeight / 1080;
            let w = window.innerWidth / s;
            if (w < MIN_STAGE_W) { s = window.innerWidth / MIN_STAGE_W; w = MIN_STAGE_W; }
            stageScale = s;
            stage.style.width = w + 'px';
            // narrower than 16:9: tighten the legend so every hint still fits
            root.classList.toggle('cg-compact', w < 1800);
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
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.cg-clock')) : () => {};

        // ---------- Time window ----------
        // The grid shows WINDOW_MIN at a time. It starts on the current half hour
        // and moves through the listings in half-hour steps, but never earlier
        // than now.
        const base = floorSlot(Date.now()); // listing chunks count from here
        let winStart = new Date(base);
        let winEnd = new Date(base + WINDOW_MIN * MIN_MS);
        const earliest = () => floorSlot(Date.now());
        // how far ahead there are real listings: found once the first chunk is
        // in (see probeEnd), and pushed later by any chunk that goes further.
        // Until then, a week.
        let listingsEnd = 0;
        const latest = () => {
            const end = listingsEnd || base + 7 * 1440 * MIN_MS;
            return Math.max(earliest(), floorSlot(end - 1) + SLOT_MIN * MIN_MS - WINDOW_MIN * MIN_MS);
        };
        const nowInView = () => {
            const t = Date.now();
            return t >= winStart && t < winEnd;
        };
        const xFor = (d) => Math.max(0, Math.min(gridW, ((d - winStart) / 60000) * pxPerMin));
        const posCell = (c) => {
            const left = xFor(c.s);
            const w = Math.max(24, xFor(c.e) - left - 8);
            c.el.style.left = left + 4 + 'px';
            c.el.style.width = w + 'px';
            c.el.classList.toggle('cg-narrow', w < 90); // too small for the record button
        };

        // The time header: the day chip names the window's first day (TODAY,
        // TOMORROW, WED SEP 16), and a slot that starts a new day carries its
        // weekday so a window that crosses midnight says so.
        const timebar = $('.cg-timebar');
        const dayChip = $('.cg-timebar-day b');
        const drawTimebar = () => {
            timebar.querySelectorAll('.cg-slot').forEach((sl) => sl.remove());
            for (let m = 0; m < WINDOW_MIN; m += SLOT_MIN) {
                const d = new Date(winStart.getTime() + m * MIN_MS);
                const newDay = m > 0 && d.getHours() === 0 && d.getMinutes() === 0;
                const slot = el('div', 'cg-slot' + (newDay ? ' cg-slot-newday' : ''),
                    (newDay ? `<span class="cg-slot-day">${esc(d.toLocaleDateString([], { weekday: 'short' }))}</span>` : '') + esc(fmtShort(d)));
                slot.dataset.m = m;
                slot.style.left = m * pxPerMin + 'px';
                timebar.appendChild(slot);
            }
            const day = dayWord(winStart);
            dayChip.textContent = day.replace(',', '');
            dayChip.classList.toggle('later', day !== 'Today');
        };
        drawTimebar();

        // the "now" needle only while now is on screen
        const needle = $('.cg-needle');
        const placeNeedle = () => {
            needle.hidden = !nowInView();
            needle.style.left = CHAN_COL + xFor(new Date()) + 'px';
        };
        relayout = () => {
            timebar.querySelectorAll('.cg-slot').forEach((sl) => { sl.style.left = +sl.dataset.m * pxPerMin + 'px'; });
            for (const r of rows) for (const c of r.cells) posCell(c);
            placeNeedle();
        };
        placeNeedle();
        const needleTimer = setInterval(() => {
            placeNeedle();
            updateLegend();
        }, 30000);

        // ---------- Toast ----------
        const toastEl = $('.cg-toast');
        let toastTimer = 0;
        const showToast = (html, kind = '', ms = 3200) => {
            toastEl.innerHTML = html;
            toastEl.className = 'cg-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'cg-toast'; }, ms);
        };
        const toast = (msg, kind = '', ms) => showToast(`<span class="cg-toast-text">${esc(msg)}</span>`, kind, ms);

        // ---------- Data + render ----------
        let rows = [];
        let order = []; // indices of the rows currently shown (all of them unless filtering)
        let sel = { row: 0, col: 0 };
        const vpos = (r) => order.indexOf(r);
        fit(); // after `rows` exists: fit() relayouts the grid when the width changes
        // programId -> Jellyfin timer, or null when we just created one and
        // couldn't read it back yet
        const timersByProgram = new Map();
        let armed = null; // { cell, timer } while a cancel waits for its confirming press

        const current = () => {
            const row = rows[sel.row];
            return row ? { row, cell: row.cells[sel.col] } : null;
        };

        const recordable = (c) => !c.unknown && !!c.p.Id;
        const isSet = (c) => recordable(c) && timersByProgram.has(c.p.Id);
        const airing = (c) => {
            const t = new Date();
            return c.s <= t && c.e > t;
        };
        // recording right now: Jellyfin says so, or the timer is on a program
        // that's airing and Jellyfin hasn't caught up yet
        const recordingNow = (c) => {
            const t = timersByProgram.get(c.p.Id);
            if (!t) return airing(c);
            return t.Status === 'InProgress' || (t.Status === 'New' && airing(c));
        };

        const paintCell = (c) => {
            const on = isSet(c);
            const confirming = !!armed && armed.cell === c;
            c.el.classList.toggle('rec', on);
            c.el.classList.toggle('confirming', confirming);
            if (!c.btn) return;
            const verb = !on ? 'Record' : recordingNow(c) ? 'Stop' : 'Cancel';
            c.btn.querySelector('.cg-rec-label').textContent = confirming ? verb + '?' : verb;
            c.btn.title = !on ? 'Record this program'
                : confirming ? `Click again to ${verb.toLowerCase()} this recording`
                    : `${verb} this recording`;
            c.btn.setAttribute('aria-label', c.btn.title);
        };

        const markRecorded = () => {
            for (const row of rows) for (const c of row.cells) paintCell(c);
        };

        const loadTimers = async () => {
            const res = await api('/LiveTv/Timers');
            timersByProgram.clear();
            for (const t of (res && res.Items) || []) {
                if (t.ProgramId && t.Status !== 'Cancelled') timersByProgram.set(t.ProgramId, t);
            }
        };

        // ---------- Listings, loaded in chunks ----------
        // Chunk i is [base + i·CHUNK_MIN, base + (i+1)·CHUNK_MIN). A program that
        // spans a chunk edge comes back with both chunks; it's kept once, by Id.
        const CHUNK_MS = CHUNK_MIN * MIN_MS;
        const chunkOf = (t) => Math.floor((t - base) / CHUNK_MS);
        const chunkStart = (i) => base + i * CHUNK_MS;
        const chunks = new Map(); // i -> 'loading' | 'done' | { failedAt }
        const listings = new Map(); // channelId -> { byId: Map, sorted: [] | null }
        let loadingChunk = false;
        let probed = false; // listingsEnd has been looked up
        let retryTimer = 0;
        let touched = false; // the user has moved; don't jump them back to "now"

        const chunkDone = (i) => chunks.get(i) === 'done';
        // in, or past the end of the real listings (so there's nothing to load)
        const chunkReady = (i) => chunkDone(i) || (!!listingsEnd && chunkStart(i) >= listingsEnd);
        const chunkFailed = (i) => {
            const c = chunks.get(i);
            return !!c && typeof c === 'object';
        };
        const wantsChunk = (i) => {
            const c = chunks.get(i);
            if (c === 'done' || c === 'loading') return false;
            if (c && Date.now() - c.failedAt < RETRY_MS) return false;
            return i >= 0 && chunkStart(i) < (listingsEnd || Infinity);
        };

        const addListings = (items) => {
            let realEnd = 0;
            for (const p of items) {
                if (!p.Id || !p.ChannelId) continue;
                let l = listings.get(p.ChannelId);
                if (!l) listings.set(p.ChannelId, (l = { byId: new Map(), sorted: null }));
                if (l.byId.has(p.Id)) continue;
                p._s = Date.parse(p.StartDate);
                p._e = Date.parse(p.EndDate);
                l.byId.set(p.Id, p);
                l.sorted = null;
                if (!PLACEHOLDER.test(p.Name)) realEnd = Math.max(realEnd, p._e);
            }
            if (listingsEnd && realEnd > listingsEnd) listingsEnd = realEnd;
        };
        const sortedFor = (chId) => {
            const l = listings.get(chId);
            if (!l) return [];
            if (!l.sorted) l.sorted = [...l.byId.values()].sort((a, b) => a._s - b._s);
            return l.sorted;
        };

        // Where the real listings end: the latest-starting programs, skipping the
        // "(Mo. 18:00 - 00:00)" placeholders the provider fills the tail with.
        const probeEnd = async () => {
            const res = await api(`/LiveTv/Programs?userId=${server.UserId}&MinStartDate=${new Date(base).toISOString()}&SortBy=StartDate&SortOrder=Descending&limit=400&EnableImages=false&EnableUserData=false`);
            const items = (res && res.Items) || [];
            const real = items.filter((p) => !PLACEHOLDER.test(p.Name));
            if (real.length) listingsEnd = Math.max(...real.map((p) => Date.parse(p.EndDate)));
            // only placeholders that far out: the real listings end before them
            else if (items.length) listingsEnd = Math.min(...items.map((p) => Date.parse(p.StartDate)));
            else listingsEnd = base + WINDOW_MIN * MIN_MS; // no listings at all
            for (const l of listings.values()) {
                for (const p of l.byId.values()) {
                    if (!PLACEHOLDER.test(p.Name) && p._e > listingsEnd) listingsEnd = p._e;
                }
            }
        };

        const fetchChunk = async (i) => {
            const q = `/LiveTv/Programs?userId=${server.UserId}&MinEndDate=${new Date(chunkStart(i)).toISOString()}`
                + `&MaxStartDate=${new Date(chunkStart(i + 1)).toISOString()}&fields=Overview&EnableImages=true&ImageTypeLimit=1&limit=5000`;
            const items = [];
            // a chunk bigger than one page comes back in pages
            for (;;) {
                const res = await api(q + `&StartIndex=${items.length}`);
                const page = (res && res.Items) || [];
                items.push(...page);
                if (!page.length || !(res.TotalRecordCount > items.length)) return items;
            }
        };

        // Load what's on screen first, then look up where the real listings end,
        // then the next chunk ahead. One request at a time.
        const pump = () => {
            if (loadingChunk || guide !== self) return;
            const first = chunkOf(+winStart);
            const last = chunkOf(+winEnd - 1);
            for (let i = first; i <= last; i++) {
                if (wantsChunk(i)) {
                    loadChunk(i);
                    return;
                }
            }
            if (!probed && chunkDone(0)) {
                probed = true;
                loadingChunk = true;
                probeEnd()
                    .catch((err) => console.warn('[Channel Guide] Could not find where the listings end:', err))
                    .finally(() => {
                        loadingChunk = false;
                        if (guide !== self) return;
                        // paged past the end before it was known: nothing more is coming
                        if (rows.length && listingsEnd && winEnd > listingsEnd) refill();
                        pump();
                    });
                return;
            }
            if (wantsChunk(last + 1)) loadChunk(last + 1);
        };

        const loadChunk = async (i) => {
            loadingChunk = true;
            chunks.set(i, 'loading');
            try {
                const items = await fetchChunk(i);
                if (guide !== self) return;
                addListings(items);
                chunks.set(i, 'done');
            } catch (err) {
                console.warn('[Channel Guide] Listings didn\'t load:', err);
                chunks.set(i, { failedAt: Date.now() });
                clearTimeout(retryTimer);
                retryTimer = setTimeout(pump, RETRY_MS + 100);
            } finally {
                loadingChunk = false;
            }
            if (guide !== self) return;
            // on screen: put the listings (or the failure) in the grid
            if (rows.length && chunkStart(i) < winEnd && chunkStart(i + 1) > winStart) refill();
            pump();
        };

        // ---------- Lanes ----------
        // A row's cells for the current window: its programs, plus a "loading"
        // cell over any stretch of time whose chunk isn't in yet. A row with no
        // programs at all in the window gets "listings unavailable" instead.
        const laneItems = (row) => {
            const ws = +winStart;
            const we = +winEnd;
            const items = [];
            for (const p of sortedFor(row.ch.Id)) {
                if (p._s >= we) break;
                if (p._e <= ws) continue;
                items.push({ p, s: new Date(p._s), e: new Date(p._e), unknown: PLACEHOLDER.test(p.Name) });
            }
            const empty = !items.length;
            const out = [];
            const gap = (a, b) => {
                for (let i = chunkOf(a); i <= chunkOf(b - 1); i++) {
                    const kind = chunkReady(i) ? (empty ? 'none' : null) : chunkFailed(i) ? 'failed' : 'loading';
                    if (!kind) continue;
                    const s = Math.max(a, chunkStart(i));
                    const e = Math.min(b, chunkStart(i + 1));
                    const prev = out[out.length - 1];
                    if (prev && prev.gap === kind && +prev.e === s) prev.e = new Date(e);
                    else out.push({ gap: kind, p: { Name: '' }, s: new Date(s), e: new Date(e), unknown: true });
                }
            };
            let t = ws;
            for (const it of items) {
                if (+it.s > t) gap(t, +it.s);
                out.push(it);
                t = Math.max(t, +it.e);
            }
            if (t < we) gap(t, we);
            return out;
        };

        const buildCell = (rowData, it) => {
            const { p, s, e, unknown, gap } = it;
            const ch = rowData.ch;
            const t = new Date();
            const onNow = s <= t && e > t;
            const cell = el('div', 'cg-prog' + (onNow ? ' now' : '') + (unknown ? ' unknown' : '') + (gap === 'loading' ? ' loading' : ''));
            const cellData = { el: cell, p, s, e, unknown, gap: gap || null, btn: null };
            posCell(cellData);
            const g = genreOf(p);
            if (g) cell.style.setProperty('--genre', `var(--${g})`);
            const title = gap === 'loading' ? 'Loading…'
                : gap === 'failed' ? 'Listings didn\'t load'
                    : unknown ? `${ch.Name} · listings unavailable` : p.Name;
            const sub = unknown ? '' : [p.EpisodeTitle, `${fmtShort(s)} – ${fmtShort(e)}`].filter(Boolean).join('  ·  ');
            cell.innerHTML = `<div class="cg-prog-title">${esc(title)}</div><div class="cg-prog-sub">${esc(sub)}</div>`;
            if (onNow && !unknown) {
                const bar = el('div', 'cg-prog-progress');
                bar.style.width = Math.round(((t - s) / (e - s)) * 100) + '%';
                cell.appendChild(bar);
            }
            // The mouse only highlights; it never scrolls the grid out from under
            // the pointer. A pointer that's just resting there doesn't take the
            // highlight from the keys when the grid redraws under it.
            cell.addEventListener('mouseenter', () => {
                if (!pointerActive()) return;
                touched = true;
                select(rowData.i, rowData.cells.indexOf(cellData), { scroll: false });
            });
            cell.addEventListener('click', () => {
                touched = true;
                select(rowData.i, rowData.cells.indexOf(cellData), { scroll: false });
                ok();
            });
            // The hovered program's own record button: it records the program
            // it sits on, not whatever the mouse crossed on the way to it.
            if (!unknown && p.Id && e > t) {
                cell.classList.add('can-rec');
                const btn = el('button', 'cg-rec-btn', '<i class="cg-rec-icon"></i><span class="cg-rec-label">Record</span>');
                btn.type = 'button';
                btn.tabIndex = -1;
                btn.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep focus off it
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation(); // the rest of the cell does what OK does; this only records
                    select(rowData.i, rowData.cells.indexOf(cellData), { scroll: false });
                    toggleRecord(rowData, cellData, 'click');
                });
                cell.appendChild(btn);
                cellData.btn = btn;
            }
            // a cancel that's waiting for its second press follows its program
            // into the redraw
            if (armed && p.Id && armed.cell.p.Id === p.Id) armed.cell = cellData;
            paintCell(cellData);
            return cellData;
        };

        const fillLane = (row) => {
            const frag = document.createDocumentFragment();
            row.cells = laneItems(row).map((it) => {
                const c = buildCell(row, it);
                frag.appendChild(c.el);
                return c;
            });
            row.lane.textContent = '';
            row.lane.appendChild(frag);
        };

        const render = (channels) => {
            const inner = $('.cg-rows-inner');
            rows = channels.map((ch, i) => {
                const row = el('div', 'cg-row');
                const chan = el('div', 'cg-chan');
                chan.appendChild(el('div', 'cg-chan-num', esc(ch.Number)));
                chan.appendChild(logoChip(ch));
                row.appendChild(chan);
                const lane = el('div', 'cg-lane');
                row.appendChild(lane);
                inner.appendChild(row);
                const rowData = { i, el: row, ch, lane, cells: [], cats: categorize(ch), country: countryOf(ch) };
                fillLane(rowData);
                return rowData;
            });

            if (!rows.length) {
                $('.cg-info-title').textContent = 'No channels';
                $('.cg-info-desc').textContent = 'Jellyfin didn\'t return any Live TV channels for this user.';
                return;
            }
            order = rows.map((_, i) => i);
            buildCats();
            landOnNow();
        };

        // start on the first channel that has real listings, on what's airing now
        const landOnNow = () => {
            if (!order.length) return;
            const v = Math.max(0, order.findIndex((r) => rows[r].cells.some((c) => !c.unknown)));
            select(order[v], colAt(order[v], Date.now()));
        };

        // Redraw every lane for the current window (it moved, or listings came
        // in), keeping the highlight on the same program, or at the same time.
        const refill = () => {
            const cur = current();
            const keep = cur && cur.cell ? { id: cur.cell.p.Id, t: Math.max(+cur.cell.s, +winStart) } : null;
            for (const r of rows) fillLane(r);
            if (query) filterRows();
            if (!order.length) return;
            // the listings came in before anyone moved: open on what's airing now
            if (!touched && nowInView()) {
                landOnNow();
                return;
            }
            if (!keep || vpos(sel.row) < 0) {
                select(order[0], colAt(order[0], +winStart));
                return;
            }
            const cells = rows[sel.row].cells;
            const c = keep.id ? cells.findIndex((x) => x.p.Id === keep.id) : -1;
            select(sel.row, c >= 0 ? c : colAt(sel.row, keep.t), { scroll: !!query });
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
            updateLegend();
        };

        const showInfo = (ch, cell) => {
            const { p, s, e, unknown, gap } = cell;
            const now = new Date();
            const live = s <= now && e > now;
            $('.cg-info-channel').innerHTML = '';
            $('.cg-info-channel').appendChild(logoChip(ch));
            $('.cg-info-channel').appendChild(el('div', 'cg-info-chname', `<b>${esc(ch.Number)}</b>${esc(ch.Name)}`));
            $('.cg-info-title').textContent = unknown ? ch.Name : p.Name;
            const meta = $('.cg-info-meta');
            meta.innerHTML = '';
            if (live) meta.appendChild(el('span', 'cg-chip live', 'Live'));
            if (isSet(cell)) {
                const rn = recordingNow(cell);
                const verb = rn ? 'stop' : 'cancel';
                meta.appendChild(el('span', 'cg-chip rec' + (rn ? ' now' : ''), rn ? 'Recording' : 'Set to record'));
                const key = armed && armed.via === 'ok' ? 'OK' : 'R';
                meta.appendChild(armed && armed.cell === cell
                    ? el('span', 'cg-rec-hint confirming', `Press <span class="cg-key">${key}</span>again to ${verb}`)
                    : el('span', 'cg-rec-hint', `<span class="cg-key">R</span>to ${verb}`));
            }
            if (!unknown) meta.appendChild(el('span', 'cg-chip', fmtWhen(s, e)));
            const g = genreOf(p);
            if (g) {
                const chip = el('span', 'cg-chip genre', genreLabel[g]);
                chip.style.background = `var(--${g})`;
                meta.appendChild(chip);
            }
            if (p.ParentIndexNumber && p.IndexNumber) meta.appendChild(el('span', 'cg-chip', `S${p.ParentIndexNumber} E${p.IndexNumber}`));
            if (p.OfficialRating) meta.appendChild(el('span', 'cg-chip', esc(p.OfficialRating)));
            $('.cg-info-desc').textContent = gap === 'loading' ? 'Loading the listings for this time…'
                : gap === 'failed' ? 'The listings for this time didn\'t load. The guide will try again.'
                    : unknown ? 'No listing information from this channel\'s guide.'
                        : (p.EpisodeTitle ? p.EpisodeTitle + ' — ' : '') + (p.Overview || '');

            // preview window
            const art = $('.cg-preview-art');
            art.style.backgroundImage = p.ImageTags && p.ImageTags.Primary ? `url(/Items/${p.Id}/Images/Primary?maxWidth=700&tag=${p.ImageTags.Primary})` : 'none';
            const logo = $('.cg-preview-logo');
            logo.innerHTML = '';
            if (!(p.ImageTags && p.ImageTags.Primary)) logo.appendChild(logoChip(ch));
            $('.cg-preview-badge').innerHTML = live ? '<span class="cg-chip live">Live</span>' : '<span class="cg-chip">Upcoming</span>';
            $('.cg-preview-left').textContent = `CH ${ch.Number}`;
            const day = dayWord(s);
            $('.cg-preview-right').textContent = live && !unknown ? `${Math.round((e - now) / 60000)} min left`
                : unknown ? '' : `Starts ${day === 'Today' ? '' : day + ' · '}${fmtTime(s)}`;
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

        // OK (or a click) watches what's on. A program that hasn't started yet
        // has nothing to watch, so there OK records it, the same as R.
        const upcoming = (c) => c.s > new Date();
        const ok = () => {
            const cur = current();
            if (!cur || !cur.cell) return;
            if (upcoming(cur.cell)) toggleRecord(cur.row, cur.cell, 'ok');
            else watch();
        };

        // The legend says what OK does for the highlighted program, and offers
        // N (back to now) while now is off the screen.
        const okLabel = $('.cg-legend-ok-label');
        const okItem = $('.cg-legend-ok');
        const nowItem = $('.cg-legend-now');
        const updateLegend = () => {
            nowItem.hidden = nowInView();
            const cur = current();
            const c = cur && cur.cell;
            if (!c || !upcoming(c)) {
                okLabel.textContent = 'Watch';
                okItem.classList.remove('off');
                return;
            }
            okLabel.textContent = !isSet(c) ? 'Record' : recordingNow(c) ? 'Stop recording' : 'Cancel recording';
            okItem.classList.toggle('off', !recordable(c));
        };

        // ---------- Recording ----------
        // R, or the record button on a hovered program, toggles that program's
        // recording. Cancelling takes a second press within a few seconds, so a
        // stray press never throws a recording away.
        const CONFIRM_MS = 4000;
        let recBusy = false;
        let busyText = ''; // what a press says while a request is still out

        const reshow = () => {
            const cur = current();
            if (cur && cur.cell) showInfo(cur.row.ch, cur.cell);
            updateLegend();
        };
        const disarm = () => {
            if (!armed) return;
            const { cell, timer } = armed;
            clearTimeout(timer);
            armed = null;
            paintCell(cell);
            reshow();
        };

        const toggleRecord = (row, cell, via) => {
            if (!row || !cell) return;
            // one request at a time; Jellyfin is slow to answer, so say so
            if (recBusy || scheduling.has(cell.p.Id)) {
                toast(busyText || `Still scheduling ${cell.p.Name}…`);
                return;
            }
            const again = !!armed && armed.cell === cell;
            disarm();
            if (cell.gap === 'loading') toast('The listings for this time are still loading');
            else if (!recordable(cell)) toast('No listing to record', 'err');
            else if (cell.e <= new Date()) toast('That program has already ended', 'err');
            else if (!timersByProgram.has(cell.p.Id)) schedule(cell);
            else if (again) cancelRecording(cell);
            else armCancel(cell, via);
        };

        const armCancel = (cell, via) => {
            armed = { cell, via, timer: setTimeout(disarm, CONFIRM_MS) };
            paintCell(cell);
            reshow();
            const q = recordingNow(cell) ? 'Stop recording ' : 'Cancel recording of ';
            const hint = via === 'click' ? 'Click again'
                : `Press <span class="cg-key">${via === 'ok' ? 'OK' : 'R'}</span>again`;
            showToast(`<span class="cg-toast-q"><span>${q}</span><span class="cg-toast-name">${esc(cell.p.Name)}</span><span>?</span></span>`
                + `<span class="cg-toast-hint">${hint}</span>`, 'confirm', CONFIRM_MS);
        };

        // Jellyfin can take 20 seconds or more to set a recording up (seen on the
        // NAS: 6 s for the defaults, 21 s for the POST), so the guide says it's on
        // it right away, and checks again just before sending that nothing else
        // (another tab, a guide closed and reopened) has set it up meanwhile.
        const schedule = async (cell) => {
            const id = cell.p.Id;
            recBusy = true;
            busyText = `Still scheduling ${cell.p.Name}…`;
            scheduling.add(id);
            toast(`Scheduling ${cell.p.Name}…`, '', 60000);
            try {
                const defaults = await api(`/LiveTv/Timers/Defaults?programId=${encodeURIComponent(id)}`);
                try {
                    await loadTimers();
                } catch { /* can't tell; send it */ }
                if (!timersByProgram.has(id)) {
                    await request('POST', '/LiveTv/Timers', defaults);
                    try {
                        await loadTimers();
                    } catch { /* the timer was created; it's marked below even if the refresh failed */ }
                    if (!timersByProgram.has(id)) timersByProgram.set(id, null);
                }
                if (guide !== self) return;
                markRecorded();
                reshow();
                toast(`${recordingNow(cell) ? 'Recording' : 'Set to record'} ${cell.p.Name}`, 'rec');
            } catch (err) {
                console.error('[Channel Guide] Recording failed:', err);
                if (guide === self) toast('Couldn\'t schedule that recording', 'err');
            } finally {
                recBusy = false;
                busyText = '';
                scheduling.delete(id);
            }
        };

        // Deleting the timer also stops a recording that's in progress.
        const cancelRecording = async (cell) => {
            recBusy = true;
            const stopping = recordingNow(cell);
            busyText = `Still ${stopping ? 'stopping' : 'cancelling'} ${cell.p.Name}…`;
            toast(`${stopping ? 'Stopping' : 'Cancelling'} ${cell.p.Name}…`, '', 60000);
            const gone = () => !timersByProgram.has(cell.p.Id);
            try {
                let t = timersByProgram.get(cell.p.Id);
                if (!t || !t.Id) {
                    // scheduled from here but not read back yet: look up its id
                    await loadTimers();
                    t = timersByProgram.get(cell.p.Id);
                }
                if (t && t.Id) {
                    await request('DELETE', `/LiveTv/Timers/${encodeURIComponent(t.Id)}`);
                    timersByProgram.delete(cell.p.Id);
                    try {
                        await loadTimers();
                    } catch { /* keep the local delete */ }
                }
                if (guide !== self) return;
                markRecorded();
                reshow();
                if (!t || !t.Id) toast(`${cell.p.Name} isn't set to record`);
                else if (gone()) toast(`${stopping ? 'Recording stopped' : 'Recording cancelled'}: ${cell.p.Name}`);
                else toast('Jellyfin still has that recording scheduled', 'err');
            } catch (err) {
                console.error('[Channel Guide] Cancelling the recording failed:', err);
                if (guide !== self) return;
                // it may be gone anyway (cancelled somewhere else): show what the server has
                try {
                    await loadTimers();
                } catch { /* leave the dots as they were */ }
                markRecorded();
                reshow();
                if (gone()) toast(`${cell.p.Name} isn't set to record`);
                else toast('Couldn\'t cancel that recording', 'err');
            } finally {
                recBusy = false;
                busyText = '';
            }
        };

        const record = () => {
            const cur = current();
            if (cur) toggleRecord(cur.row, cur.cell, 'key');
        };

        // ---------- Input ----------
        // the cell at time t in a row: the one airing then, else the next one
        const colAt = (r, t) => {
            const cells = rows[r].cells;
            let i = cells.findIndex((c) => c.s <= t && c.e > t);
            if (i < 0) i = cells.findIndex((c) => c.s > t);
            return i < 0 ? cells.length - 1 : i;
        };
        // the last cell in a row that starts before t
        const colBefore = (r, t) => {
            const cells = rows[r].cells;
            for (let i = cells.length - 1; i >= 0; i--) if (cells[i].s < t) return i;
            return 0;
        };

        // moving up/down keeps the same point in time, like a real guide
        const nearestCol = (r) => {
            if (!rows[r]) return 0;
            const cur = rows[sel.row].cells[sel.col];
            return colAt(r, Math.max(cur ? +cur.s : 0, +winStart, Date.now()));
        };

        const step = (d) => {
            const v = vpos(sel.row) + d;
            if (v < 0 || v >= order.length) return;
            select(order[v], nearestCol(order[v]));
        };

        // Move the window to start at `start` (clamped to now … the end of the
        // listings) and redraw the grid. The caller picks the new highlight.
        const shiftWindow = (start) => {
            start = Math.max(earliest(), Math.min(latest(), start));
            if (start === +winStart) return false;
            winStart = new Date(start);
            winEnd = new Date(start + WINDOW_MIN * MIN_MS);
            touched = true;
            drawTimebar();
            placeNeedle();
            for (const r of rows) fillLane(r);
            if (query) filterRows();
            pump();
            return true;
        };
        // after the window moved: highlight a program on the same channel (or
        // the first one showing, if a filter dropped it)
        const reselect = (pick) => {
            const r = vpos(sel.row) >= 0 ? sel.row : order[0];
            if (r === undefined) return;
            select(r, pick(r), { scroll: !!query || r !== sel.row });
        };

        // ◀▶ go program to program. Past the edge of the window they page it,
        // like a cable box: at least half a screen, and far enough that the next
        // (or previous) program lands mid-screen.
        const moveTime = (d) => {
            const row = rows[sel.row];
            if (!row) return;
            const next = sel.col + d;
            if (next >= 0 && next < row.cells.length) {
                select(sel.row, next);
                return;
            }
            const cur = row.cells[sel.col];
            const ws = +winStart;
            const half = PAGE_MIN * MIN_MS;
            if (d > 0) {
                const t = +cur.e; // where the next program starts
                const start = Math.min(latest(), Math.max(ws + half, floorSlot(t) - half));
                if (start <= ws || !shiftWindow(start)) {
                    toast('That\'s as far ahead as the listings go');
                    return;
                }
                reselect((r) => colAt(r, t));
            } else {
                const t = +cur.s; // where the previous program ends
                const start = Math.max(earliest(), Math.min(ws - half, floorSlot(t) - half));
                if (start >= ws || !shiftWindow(start)) return;
                reselect((r) => colBefore(r, t));
            }
        };

        // N: back to now, on the program airing now on this channel
        const backToNow = () => {
            shiftWindow(earliest());
            reselect((r) => colAt(r, Date.now()));
        };

        // Sideways on the trackpad (or Shift+wheel) moves through time a half hour
        // at a time, a step for every half slot of finger travel. The highlight
        // stays on its program while that's on screen, else on the edge it left by.
        let scrubPx = 0;
        let scrubAt = 0;
        let scrubTimer = 0;
        const scrub = (dx) => {
            const t = Date.now();
            if (t - scrubAt > 300 || Math.sign(dx) !== Math.sign(scrubPx)) scrubPx = 0;
            scrubAt = t;
            scrubPx += dx;
            if (scrubTimer) return;
            scrubTimer = setTimeout(() => {
                scrubTimer = 0;
                const stepPx = (SLOT_MIN * pxPerMin * stageScale) / 2;
                const n = Math.trunc(scrubPx / stepPx);
                if (!n) return;
                scrubPx -= n * stepPx;
                const cur = current();
                const keep = cur && cur.cell;
                const ws = +winStart;
                const start = Math.max(earliest(), Math.min(latest(), ws + n * SLOT_MIN * MIN_MS));
                if ((n > 0 ? start <= ws : start >= ws) || !shiftWindow(start)) {
                    scrubPx = 0;
                    return;
                }
                reselect((r) => {
                    const cells = rows[r].cells;
                    const i = keep && keep.p.Id ? cells.findIndex((c) => c.p.Id === keep.p.Id) : -1;
                    if (i >= 0) return i;
                    const at = keep ? Math.max(+winStart, Math.min(+winEnd - 1, +keep.s)) : +winStart;
                    return colAt(r, at);
                });
            }, 40);
        };

        // The pointer counts as "in use" for a moment after it moves or scrolls.
        // Otherwise a redraw under a resting pointer would hand it the highlight.
        let lastPointerAt = 0;
        const pointerActive = () => Date.now() - lastPointerAt < 500;
        const onPointerMove = (ev) => {
            if (ev.movementX || ev.movementY) lastPointerAt = Date.now();
        };

        // ---------- Filter ----------
        const searchInput = $('.cg-search-input');
        let query = '';
        const lc = (x) => String(x ?? '').toLowerCase();
        let category = 'all';
        let country = 'all';
        const inScope = (row) => row.cats.has(category) && (country === 'all' || row.country === country);
        // which rows show, and which programs match, for the current window
        const filterRows = () => {
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
                : query ? `Nothing in ${catLabel} matches “${searchInput.value.trim()}”`
                    : category === 'fav' ? 'No favorite channels yet. Heart a channel in Jellyfin to add it here.'
                        : `No ${catLabel} channels`;
            empty.classList.toggle('show', !order.length);
            setScroll(scrollY, false); // fewer rows: don't leave the list scrolled past its end
        };
        const applyFilter = (text) => {
            query = lc(text).trim();
            touched = true;
            filterRows();
            setScroll(0, false);
            if (!order.length) return;
            // land on the first match: a matching show airing (or starting) first, else what's on
            const r = order[0];
            const t = Math.max(Date.now(), +winStart);
            const c = rows[r].cells.findIndex((x) => x.el.classList.contains('match') && x.e > t);
            select(r, c >= 0 ? c : colAt(r, t));
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
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', 'Escape', 'Backspace', 'GoBack', 'BrowserBack', 'r', 'R', 'g', 'G', 'n', 'N'];
            if (!handled.includes(k)) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.repeat && (k === 'Enter' || k === 'r' || k === 'R' || k === 'n' || k === 'N')) return;
            if (!rows.length && !['Escape', 'Backspace', 'GoBack', 'BrowserBack', 'g', 'G'].includes(k)) return;
            touched = true;
            lastPointerAt = 0; // the keys have the highlight now
            if (k === 'ArrowDown') step(1);
            else if (k === 'ArrowUp') step(-1);
            else if (k === 'PageDown') pageBy(1);
            else if (k === 'PageUp') pageBy(-1);
            else if (k === 'ArrowRight') moveTime(1);
            else if (k === 'ArrowLeft') moveTime(-1);
            else if (k === 'Enter') ok();
            else if (k === 'r' || k === 'R') record();
            else if (k === 'n' || k === 'N') backToNow();
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
            lastPointerAt = Date.now();
            touched = true;
            const unit = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? viewH() : 1;
            // sideways moves through time; up and down scrolls the channels
            if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
                scrub(ev.deltaX * unit);
                return;
            }
            setScroll(scrollY + ev.deltaY * unit, false);
        };
        const onLegendClick = (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'ok') ok();
            else if (action === 'now') backToNow();
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
        root.addEventListener('mousemove', onPointerMove, { passive: true });
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
                wxDetach();
                clearInterval(needleTimer);
                clearTimeout(toastTimer);
                clearTimeout(retryTimer);
                clearTimeout(scrubTimer);
                if (armed) clearTimeout(armed.timer);
                root.remove();
            }
        };

        // The channels go up as soon as they're in; the first 3 hours of listings
        // load alongside them and fill in the grid when they arrive.
        (async () => {
            await null; // until createGuide returns, `guide` isn't this one yet
            pump();
            const [ch] = await Promise.all([
                api(`/LiveTv/Channels?userId=${server.UserId}&limit=1000&EnableImages=true&ImageTypeLimit=1&EnableUserData=true`),
                loadTimers().catch((err) => console.warn('[Channel Guide] Could not read timers:', err))
            ]);
            if (guide !== self) return;
            const channels = ch.Items.sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0) || a.Name.localeCompare(b.Name));
            render(channels);
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
