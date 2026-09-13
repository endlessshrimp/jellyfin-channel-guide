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
 * The guide's data and actions (channels, listings, recordings, watching) are
 * in guide/guide-model.js. This file draws the TV layout; on a phone
 * (shared/layout.js) the guide draws guide/guide-phone.js instead, from the
 * same model, and lives at its route (#/livetv?tab=1) like any other screen.
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

    // the guide's model: channels, listings, recordings (guide/guide-model.js)
    const M = () => window.HomerGuideModel;

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

    const logoChip = (ch) => {
        const chip = el('div', 'cg-logo-chip');
        if (ch.ImageTags && ch.ImageTags.Primary) {
            const img = new Image();
            img.src = `/Items/${ch.Id}/Images/Primary?maxHeight=120&tag=${ch.ImageTags.Primary}`;
            img.alt = '';
            img.onerror = () => { chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`; };
            chip.appendChild(img);
            if (window.HomerLogos) window.HomerLogos.watch(img, chip); // a dark or light chip for this logo
        } else {
            chip.innerHTML = `<div class="cg-chan-fallback">${esc(ch.Name)}</div>`;
        }
        return chip;
    };

    // The stylesheet is fetched on first open (not on every Jellyfin page load);
    // resolves once it has loaded, or after a timeout so a slow CDN can't block.
    // (Both layouts' stylesheets: the phone one is scoped to .cg-phone.)
    let cssReady = null;
    const ensureCss = () => {
        if (cssReady && document.getElementById('cg-css')) return cssReady;
        const link = (id, file) => {
            document.getElementById(id)?.remove();
            const css = document.createElement('link');
            css.id = id;
            css.rel = 'stylesheet';
            css.href = BASE + file + QUERY;
            document.head.appendChild(css);
            return new Promise((resolve) => {
                css.onload = css.onerror = resolve;
                setTimeout(resolve, 2000);
            });
        };
        cssReady = Promise.all([link('cg-css', 'guide.css'), link('cg-phone-css', 'guide-phone.css')]);
        return cssReady;
    };

    // Home: HOMER Home knows how (it keeps a playing video going); without it,
    // close and go to Jellyfin's home route
    const goHome = () => {
        if (window.HomerPlayer) { window.HomerPlayer.goHome(); return; }
        if (window.HomerHome && window.HomerHome.goHome) { window.HomerHome.goHome(); return; }
        close({ returnToLiveTv: false });
        location.hash = '#/home';
    };

    // Touch screens (no hover, like a tablet): the first tap on a program
    // highlights it and shows its ● button, and a tap on the highlighted
    // program does what OK does. A touch on a screen that can also hover (a
    // touch laptop) counts too.
    // (shared/layout.js decides, from the same media query, when it's loaded)
    const touchMq = window.matchMedia ? window.matchMedia('(hover: none)') : null;
    const touchScreen = () => (window.HomerLayout ? window.HomerLayout.isTouch() : !!(touchMq && touchMq.matches));

    // The model and the phone layout come from homer.js, just after this file;
    // used on its own, the guide loads them itself. Either way open() waits
    // for them.
    const DEPS = [['guide-model.js', 'HomerGuideModel'], ['guide-phone.js', 'HomerGuidePhone']];
    let depsReady = null;
    const loadDeps = () => {
        if (!depsReady) {
            depsReady = Promise.all(DEPS.map(([file, global]) => new Promise((resolve) => {
                if (window[global]) { resolve(); return; }
                let s = [...document.querySelectorAll('script[src*="guide/' + file + '"]')].pop();
                if (!s) {
                    s = document.createElement('script');
                    s.src = BASE + file + QUERY;
                    document.head.appendChild(s);
                }
                s.addEventListener('load', resolve);
                s.addEventListener('error', resolve);
                setTimeout(resolve, 5000);
            })));
        }
        return depsReady;
    };
    const depsLoaded = () => DEPS.every(([, global]) => !!window[global]);
    let depsTried = false; // waited for them once; a missing phone layout means the TV one

    // ---------- Guide ----------

    let guide = null; // the open guide (its TV or its phone layout), or null
    let model = null; // the open guide's data; a change of layout keeps it
    let nowWatching = null; // channel last started from the guide
    let openedFromTab = false; // opened in place of Jellyfin's Live TV → Guide tab
    let tabSuppressed = false; // closed from that tab; don't reopen until it's left
    const LIVETV_HOME = '#/home'; // Jellyfin's Live TV pages don't show under HOMER
    const GUIDE_HASH = '#/livetv?tab=1';

    // The phone layout: shared/layout.js says when; guide/guide-phone.js draws
    // it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerGuidePhone && window.HomerLayout.usePhone('guide'));

    // On a phone, full screen and back (or a quick look at another tab) closes
    // the guide and opens it again; it comes back where it was, with the
    // listings it had, if that's within a few minutes.
    const KEEP_MS = 10 * 60000;
    let kept = null; // { model, state, at }
    const forget = () => {
        if (kept) kept.model.dispose();
        kept = null;
    };

    const open = () => {
        if (guide) return;
        const server = getServer();
        if (!server) {
            console.warn('[Channel Guide] Not signed in to Jellyfin');
            return;
        }
        if (!depsLoaded() && !depsTried) {
            loadDeps().then(() => {
                depsTried = true;
                if (!guide) open();
            });
            return;
        }
        if (!M()) return; // the model didn't load
        // on a phone the guide is a screen like the others, at its own route
        if (phoneLayout() && !onGuideRoute()) {
            if (window.HomerPlayer) window.HomerPlayer.go(GUIDE_HASH);
            else location.hash = GUIDE_HASH;
            return;
        }
        let state = null;
        if (kept && phoneLayout() && Date.now() - kept.at < KEEP_MS && kept.model.server.Id === server.Id) {
            model = kept.model;
            state = kept.state;
            kept = null;
        } else {
            forget();
            model = M().create(server);
        }
        guide = draw(server, state);
        const g = guide;
        ensureCss().then(() => g.show());
    };

    // the layout for the screen we're on, drawn from the model (and from where
    // the other layout was, when the layout changes)
    const draw = (server, state) => (phoneLayout()
        ? window.HomerGuidePhone.create({
            server,
            model,
            state,
            logoChip,
            isOpen: (v) => guide === v,
            goHome,
            watching: (ch) => { nowWatching = ch; }
        })
        : createGuide(server, state));

    // returnToLiveTv: when the guide stands in for Jellyfin's own Guide tab,
    // closing it goes to Live TV's first tab instead of revealing the stock guide.
    const close = ({ returnToLiveTv = true } = {}) => {
        if (!guide) return;
        const g = guide;
        guide = null;
        const state = g.phone ? g.state() : null;
        g.teardown();
        if (g.phone && model) {
            forget();
            kept = { model, state, at: Date.now() };
        } else if (model) {
            model.dispose();
        }
        model = null;
        const fromTab = openedFromTab;
        openedFromTab = false;
        if (fromTab) {
            tabSuppressed = true;
            if (returnToLiveTv && isNativeGuideRoute()) location.hash = LIVETV_HOME;
        }
    };

    // The phone and TV layouts switch places (a window resized across the
    // line, mostly): draw the other one, at the same channel and time.
    const onLayout = () => {
        if (!guide || guide.phone === phoneLayout()) return;
        const server = getServer();
        const g = guide;
        const state = g.state();
        g.teardown();
        guide = null;
        if (!server || !model) return;
        if (phoneLayout() && !onGuideRoute()) {
            // the phone layout lives at the guide's route: go there
            forget();
            kept = { model, state, at: Date.now() };
            model = null;
            openedFromTab = false;
            if (window.HomerPlayer) window.HomerPlayer.go(GUIDE_HASH);
            else location.hash = GUIDE_HASH;
            return;
        }
        guide = draw(server, state);
        const next = guide;
        ensureCss().then(() => { if (guide === next) next.show(); });
    };

    const createGuide = (server, state) => {
        const m = model; // channels, listings and recordings (guide-model.js)
        const { CATEGORIES, COUNTRIES } = M();
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
                <span class="cg-legend-rec"><span class="cg-key rec">R</span><span class="cg-legend-rec-label">Record</span></span>
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
            // the window, or on a phone the room between HOMER's bars (shared/layout.js)
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < MIN_STAGE_W) { s = box.width / MIN_STAGE_W; w = MIN_STAGE_W; }
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
        const earliest = m.earliest;
        let winStart = new Date(earliest());
        let winEnd = new Date(+winStart + WINDOW_MIN * MIN_MS);
        // as late as the real listings go (the model finds out where they end)
        const latest = () => m.latest(WINDOW_MIN);
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
        // programId -> Jellyfin timer (the model keeps them)
        const timersByProgram = m.timersByProgram;
        let armed = null; // { cell, timer } while a cancel waits for its confirming press

        const current = () => {
            const row = rows[sel.row];
            return row ? { row, cell: row.cells[sel.col] } : null;
        };

        // a program: can it be recorded, is it set to, is it recording right now
        const { recordable, isSet, recordingNow } = m;

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

        // ---------- Listings ----------
        // The model loads them in 3-hour chunks, what's on screen first; it asks
        // this layout what time it's showing, and says when a chunk is in.
        const { chunkOf, chunkStart, chunkReady, chunkFailed, sortedFor } = m;
        let touched = false; // the user has moved; don't jump them back to "now"
        const pump = () => m.pump();
        const detachModel = m.attach({
            window: () => ({ start: +winStart, end: +winEnd }),
            // on screen: put the listings (or the failure) in the grid
            onChunk: (i) => {
                if (rows.length && chunkStart(i) < winEnd && chunkStart(i + 1) > winStart) refill();
            },
            // paged past the end before it was known: nothing more is coming
            onProbed: () => {
                const end = m.listingsEnd();
                if (rows.length && end && winEnd > end) refill();
            }
        });

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
            // highlight from the keys when the grid redraws under it. (A tap
            // sends a mouseenter too; on a touch screen only the tap counts.)
            cell.addEventListener('mouseenter', () => {
                if (!pointerActive() || touchInput()) return;
                touched = true;
                select(rowData.i, rowData.cells.indexOf(cellData), { scroll: false });
            });
            // A click on an airing program watches it. An upcoming one is only
            // selected (its ● button records), so a stray click never sets a
            // recording. On a touch screen the first tap only highlights the
            // program, which shows its ● button; a second tap watches.
            cell.addEventListener('click', () => {
                touched = true;
                const c = rowData.cells.indexOf(cellData);
                const again = sel.row === rowData.i && sel.col === c;
                select(rowData.i, c, { scroll: false });
                if (touchInput() && !again) return;
                if (!upcoming(cellData)) watch();
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
                const rowData = { i, el: row, ch, lane, cells: [], cats: M().categorize(ch), country: M().countryOf(ch) };
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
            M().playChannel(cur.row.ch).catch((err) => console.error('[Channel Guide] Playback failed:', err));
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

        // The legend says what OK and R do for the highlighted program, and
        // offers N (back to now) while now is off the screen. R only shows when
        // it does something OK doesn't: on an upcoming program they're the same.
        const okLabel = $('.cg-legend-ok-label');
        const okItem = $('.cg-legend-ok');
        const recLabel = $('.cg-legend-rec-label');
        const recItem = $('.cg-legend-rec');
        const nowItem = $('.cg-legend-now');
        const recVerb = (c) => (!isSet(c) ? 'Record' : recordingNow(c) ? 'Stop recording' : 'Cancel recording');
        const updateLegend = () => {
            nowItem.hidden = nowInView();
            const cur = current();
            const c = cur && cur.cell;
            if (!c || !upcoming(c)) {
                okLabel.textContent = 'Watch';
                okItem.classList.remove('off');
                recItem.hidden = false;
                recLabel.textContent = c ? recVerb(c) : 'Record';
                recItem.classList.toggle('off', !c || !recordable(c));
                return;
            }
            okLabel.textContent = recVerb(c);
            okItem.classList.toggle('off', !recordable(c));
            recItem.hidden = true;
        };

        // ---------- Recording ----------
        // R, or the record button on a hovered program, toggles that program's
        // recording. Cancelling takes a second press within a few seconds, so a
        // stray press never throws a recording away.
        const CONFIRM_MS = 4000;

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
            if (m.isBusy(cell.p.Id)) {
                toast(m.busyText() || `Still scheduling ${cell.p.Name}…`);
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
            const hint = via === 'click' ? (touchInput() ? 'Tap again' : 'Click again')
                : `Press <span class="cg-key">${via === 'ok' ? 'OK' : 'R'}</span>again`;
            showToast(`<span class="cg-toast-q"><span>${q}</span><span class="cg-toast-name">${esc(cell.p.Name)}</span><span>?</span></span>`
                + `<span class="cg-toast-hint">${hint}</span>`, 'confirm', CONFIRM_MS);
        };

        // Jellyfin can take 20 seconds or more to set a recording up, so the
        // guide says it's on it right away (the model sends the request, and
        // checks first that nothing else has set it up meanwhile).
        const schedule = async (cell) => {
            toast(`Scheduling ${cell.p.Name}…`, '', 60000);
            const ok = await m.schedule(cell.p);
            if (guide !== self) return;
            if (!ok) {
                toast('Couldn\'t schedule that recording', 'err');
                return;
            }
            markRecorded();
            reshow();
            toast(`${recordingNow(cell) ? 'Recording' : 'Set to record'} ${cell.p.Name}`, 'rec');
        };

        // Deleting the timer also stops a recording that's in progress.
        const cancelRecording = async (cell) => {
            const stopping = recordingNow(cell);
            toast(`${stopping ? 'Stopping' : 'Cancelling'} ${cell.p.Name}…`, '', 60000);
            const result = await m.cancel(cell.p, stopping);
            if (guide !== self) return;
            markRecorded();
            reshow();
            if (result === 'gone') toast(`${stopping ? 'Recording stopped' : 'Recording cancelled'}: ${cell.p.Name}`);
            else if (result === 'unset') toast(`${cell.p.Name} isn't set to record`);
            else if (result === 'kept') toast('Jellyfin still has that recording scheduled', 'err');
            else toast('Couldn\'t cancel that recording', 'err');
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

        // ---------- Touch ----------
        // A finger drags the channels up and down, and sideways moves through
        // time the way the trackpad does. A drag is never a tap.
        let lastTouchAt = 0;
        const touchInput = () => touchScreen() || Date.now() - lastTouchAt < 1000;
        const syncTouch = () => root.classList.toggle('cg-touch', touchScreen());
        syncTouch();
        let drag = null;
        let noClickUntil = 0;
        const rowsBox = $('.cg-rows');
        const onTouchDown = (ev) => {
            if (ev.pointerType === 'mouse') return;
            lastTouchAt = Date.now();
            drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, axis: null };
        };
        const onTouchMove = (ev) => {
            if (!drag || ev.pointerId !== drag.id) return;
            const dx = ev.clientX - drag.x;
            const dy = ev.clientY - drag.y;
            if (!drag.axis) {
                if (Math.hypot(dx, dy) < 10) return; // still a tap
                drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                try { rowsBox.setPointerCapture(ev.pointerId); } catch { /* it's gone */ }
            }
            drag.x = ev.clientX;
            drag.y = ev.clientY;
            if (!rows.length) return;
            touched = true;
            if (drag.axis === 'y') setScroll(scrollY - dy / stageScale, false);
            else scrub(-dx); // the grid follows the finger: dragging left goes later
        };
        const onTouchEnd = (ev) => {
            if (!drag || ev.pointerId !== drag.id) return;
            if (drag.axis) noClickUntil = Date.now() + 400;
            drag = null;
        };
        const onClickAfterDrag = (ev) => {
            if (Date.now() >= noClickUntil) return;
            ev.preventDefault();
            ev.stopPropagation();
        };
        rowsBox.addEventListener('pointerdown', onTouchDown);
        rowsBox.addEventListener('pointermove', onTouchMove);
        rowsBox.addEventListener('pointerup', onTouchEnd);
        rowsBox.addEventListener('pointercancel', onTouchEnd);
        rowsBox.addEventListener('click', onClickAfterDrag, true);
        if (touchMq && touchMq.addEventListener) touchMq.addEventListener('change', syncTouch);
        const offTouch = window.HomerLayout ? window.HomerLayout.onChange(syncTouch) : () => {};

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

        // Drawn again after a change of layout: the same category, country,
        // channel and time as the other layout had.
        const restore = (st) => {
            if (st.country && st.country !== country) setCountry(st.country);
            if (st.category && st.category !== category) setCategory(st.category);
            touched = true;
            if (st.start) shiftWindow(floorSlot(st.start));
            const r = rows.findIndex((x) => x.ch.Id === st.channelId);
            const target = r >= 0 && vpos(r) >= 0 ? r : order[0];
            if (target !== undefined) select(target, colAt(target, Math.max(st.time || 0, +winStart, Date.now())));
        };

        const self = {
            phone: false,
            show() {
                root.style.visibility = '';
            },
            // where the guide is, for the other layout to pick up from
            state() {
                const cur = current();
                return {
                    category,
                    country,
                    start: +winStart,
                    channelId: cur ? cur.row.ch.Id : null,
                    time: cur && cur.cell ? +cur.cell.s : 0
                };
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
                clearTimeout(scrubTimer);
                if (touchMq && touchMq.removeEventListener) touchMq.removeEventListener('change', syncTouch);
                offTouch();
                if (armed) clearTimeout(armed.timer);
                detachModel();
                root.remove();
            }
        };

        // The channels go up as soon as they're in; the first 3 hours of listings
        // load alongside them and fill in the grid when they arrive.
        (async () => {
            await null; // until createGuide returns, `guide` isn't this one yet
            pump();
            const channels = await m.channels();
            if (guide !== self) return;
            render(channels);
            if (state && rows.length) restore(state);
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

    const GUIDE_ROUTE = /^#\/livetv(\.html)?\?(.*&)?tab=1(&|$)/;
    const isNativeGuideRoute = () => GUIDE_ROUTE.test(location.hash);
    // On a phone the guide is a screen like the others: it's up while HOMER's
    // route is the guide's, even with a video docked in it (when the address
    // is the player's).
    const onGuideRoute = () => GUIDE_ROUTE.test(window.HomerPlayer ? window.HomerPlayer.route() : location.hash);
    const nativeGuideShowing = () => (phoneLayout() ? onGuideRoute()
        : isNativeGuideRoute() || !!document.querySelector('.page:not(.hide) .tvguide.is-active'));

    const syncTakeover = () => {
        if (!nativeGuideShowing()) {
            tabSuppressed = false;
            if (guide && guide.phone) close({ returnToLiveTv: false }); // left the guide's route
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
    // a link) should take the guide down with it. (The phone guide stays while
    // HOMER's route is still the guide, e.g. when a channel starts in its
    // preview and the address becomes the player's.)
    const onRouteChange = () => {
        if (!(guide && guide.phone && onGuideRoute())) close({ returnToLiveTv: false });
        tabSuppressed = false;
        queueSync();
        if (pipPendingUntil && Date.now() < pipPendingUntil) {
            pipPendingUntil = 0;
            setTimeout(openOverPlayer, 300);
        }
    };

    let observer = null;
    // HomerPlayer moves between screens without touching the address while a
    // video is docked; the phone guide follows it. The layout can change too.
    let offPlayer = null;
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};
    const start = () => {
        if (window.HomerPlayer) offPlayer = window.HomerPlayer.onChange(queueSync);
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
            forget();
            observer && observer.disconnect();
            if (offPlayer) offPlayer();
            offLayout();
            document.removeEventListener('keydown', onGlobalKey, true);
            document.removeEventListener('enterpictureinpicture', onEnterPip, true);
            document.querySelectorAll('.' + OSD_BTN_CLASS).forEach((b) => b.remove());
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.querySelectorAll('.' + BTN_CLASS).forEach((b) => b.remove());
            document.getElementById('cg-css')?.remove();
            document.getElementById('cg-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
