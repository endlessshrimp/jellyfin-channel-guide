/*
 * HOMER Home: a TiVo-style main menu that replaces Jellyfin Web's home page.
 *
 * Loaded on every Jellyfin Web page by homer.js. When Jellyfin shows its home
 * route (#/home), this puts a full-screen HOMER stage over it: a main menu, an
 * "On Now" feature panel with a live preview, and rows of Continue Watching,
 * Up Next, On Now and Recently Added. Remote-style arrow navigation, OK to
 * select; mouse hover highlights, click selects, the trackpad scrolls.
 *
 * Watch plays the channel inside the On Now preview window so you can keep
 * browsing; shared/player.js does the playing, docking and Full screen.
 *
 * On a phone (shared/layout.js) Home draws home/home-phone.js instead: the On
 * Now card on top and the same rows, scrolled sideways. Both layouts draw from
 * the same data (loadData), and switching layouts keeps it.
 *
 * window.HomerHome = { open, close, fullscreen, goHome, destroy, version }
 */
(() => {
    const VERSION = '0.3.0';

    if (window.HomerHome && typeof window.HomerHome.destroy === 'function') {
        window.HomerHome.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="home.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc ? scriptSrc.replace(/home\.js(\?.*)?$/, '') : '';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;
    const ROW_H = 222;

    // ---------- Jellyfin session (same approach as the guide) ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* token only */ }
        parts.push(`Token="${server.AccessToken}"`);
        return 'MediaBrowser ' + parts.join(', ');
    };
    const api = async (path) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, { headers: { Authorization: authHeader(server) } });
        if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };
    const play = (itemId, startTicks) => {
        const ac = window.ApiClient;
        if (ac && typeof ac.handleMessageReceived === 'function') {
            const Data = { PlayCommand: 'PlayNow', ItemIds: [itemId] };
            if (startTicks) Data.StartPositionTicks = startTicks;
            ac.handleMessageReceived({ MessageType: 'Play', Data });
        }
    };

    // ---------- Helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const img = (id, type, tag, w, idx) => (tag ? `/Items/${id}/Images/${type}${idx != null ? '/' + idx : ''}?maxWidth=${w}&tag=${tag}&quality=85` : null);

    // best 16:9 artwork for a card
    const cardArt = (it) => {
        if (it.ImageTags && it.ImageTags.Thumb) return img(it.Id, 'Thumb', it.ImageTags.Thumb, 600);
        if (it.ParentThumbItemId && it.ParentThumbImageTag) return img(it.ParentThumbItemId, 'Thumb', it.ParentThumbImageTag, 600);
        if (it.BackdropImageTags && it.BackdropImageTags.length) return img(it.Id, 'Backdrop', it.BackdropImageTags[0], 600, 0);
        if (it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length) return img(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 600, 0);
        if (it.ImageTags && it.ImageTags.Primary) return img(it.Id, 'Primary', it.ImageTags.Primary, 600);
        return null;
    };
    // Channel logo chip. Works for a channel item or a program (programs don't
    // carry their channel's image tag, so the logo is fetched by channel id).
    const logoChip = (x, big) => {
        const chip = el('div', 'hm-logo-chip' + (big ? ' big' : ''));
        const isProgram = x && x.ChannelId && x.Type !== 'TvChannel';
        const id = isProgram ? x.ChannelId : x && x.Id;
        const name = isProgram ? (x.ChannelName || '') : (x && x.Name) || '';
        const fallback = () => { chip.innerHTML = `<div class="hm-logo-fallback">${esc(name)}</div>`; };
        if (!id) { fallback(); return chip; }
        const i = new Image();
        i.src = `/Items/${id}/Images/Primary?maxHeight=120`;
        i.alt = '';
        i.onerror = fallback;
        chip.appendChild(i);
        if (window.HomerLogos) window.HomerLogos.watch(i, chip); // a dark or light chip for this logo
        return chip;
    };

    // (Both layouts' stylesheets: the phone one is scoped to #hm-root.hm-phone.)
    let cssReady = null;
    const ensureCss = () => {
        if (cssReady && document.getElementById('hm-css')) return cssReady;
        if (!document.getElementById('homer-tokens') && BASE) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE.replace(/home\/$/, '') + 'shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
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
        cssReady = Promise.all([link('hm-css', 'home.css'), link('hm-phone-css', 'home-phone.css')]);
        return cssReady;
    };

    // ---------- The player (shared/player.js) ----------
    // HomerPlayer keeps a playing video going under HOMER's screens and pins it
    // over this screen's preview window; Home just draws the panel around it.
    const P = () => window.HomerPlayer || null;
    const previewing = () => !!(P() && P().docked());
    const nowPlayingInfo = () => (P() ? P().nowPlaying() : null);
    const currentRoute = () => (P() ? P().route() : location.hash);
    const go = (hash) => { if (P()) P().go(hash); else location.hash = hash; };
    const startPreview = (program) => { if (P()) P().watch(program.ChannelId, { program }); else play(program.ChannelId); };
    const goFullscreen = () => { if (P()) P().fullscreen(); };
    const stopPreview = () => { if (P()) P().stop(); };

    const openGuide = () => {
        if (window.ChannelGuide && window.ChannelGuide.open) window.ChannelGuide.open();
        else go('#/livetv?tab=1');
    };

    // ---------- Data (both layouts draw from it) ----------
    // The library views (for the menu), what's on live now (the first one is
    // On Now) and the rows under it, fetched once each time Home opens.
    const loadData = async (server) => {
        const uid = server.UserId;
        const fields = 'Fields=Overview,PrimaryImageAspectRatio&EnableImageTypes=Primary,Backdrop,Thumb&ImageTypeLimit=1';
        const safe = (p) => p.catch((err) => { console.warn('[HOMER Home]', err); return null; });
        const [viewsRes, resume, nextUp, onNow] = await Promise.all([
            safe(api(`/Users/${uid}/Views`)),
            safe(api(`/Users/${uid}/Items/Resume?Limit=16&MediaTypes=Video&${fields}`)),
            safe(api(`/Shows/NextUp?UserId=${uid}&Limit=16&${fields}`)),
            safe(api(`/LiveTv/Programs/Recommended?UserId=${uid}&IsAiring=true&Limit=40&EnableImages=true&ImageTypeLimit=1&Fields=ChannelInfo,Overview`))
        ]);
        const views = (viewsRes && viewsRes.Items) || [];
        const movieView = views.find((v) => v.CollectionType === 'movies');
        const tvView = views.find((v) => v.CollectionType === 'tvshows');
        const [latestMovies, latestTv] = await Promise.all([
            movieView ? safe(api(`/Users/${uid}/Items/Latest?ParentId=${movieView.Id}&Limit=16&${fields}`)) : null,
            tvView ? safe(api(`/Users/${uid}/Items/Latest?ParentId=${tvView.Id}&Limit=16&${fields}`)) : null
        ]);

        const live = ((onNow && onNow.Items) || []).filter((p) => !PLACEHOLDER.test(p.Name || ''));
        // { title, items, live }: live rows are programs on now, the rest library items
        const rows = [];
        const resumeItems = (resume && resume.Items) || [];
        const nextItems = (nextUp && nextUp.Items) || [];
        if (resumeItems.length) rows.push({ title: 'Continue watching', items: resumeItems });
        if (nextItems.length) rows.push({ title: 'Up next', items: nextItems });
        if (live.length > 1) rows.push({ title: 'On now', items: live.slice(1, 17), live: true });
        if (latestMovies && latestMovies.length) rows.push({ title: 'Recently added movies', items: latestMovies });
        if (latestTv && latestTv.length) rows.push({ title: 'Recently added TV', items: latestTv });
        return { views, live, rows };
    };

    // ---------- Home ----------

    let home = null; // the open Home (its TV or its phone layout), or null
    let data = null; // what it shows (a promise); a change of layout keeps it

    const createHome = (server, data) => {
        const root = el('div');
        root.id = 'hm-root';
        root.style.visibility = 'hidden';
        const stage = el('div');
        stage.id = 'hm-stage';
        root.appendChild(stage);
        document.body.appendChild(root);

        stage.innerHTML = `
            <div class="hm-topbar">
                <div class="hm-brand"><span class="hm-brand-mark"></span>HOMER<span class="hm-brand-sub">HOME</span></div>
                <label class="hm-search" data-focus="search">
                    <span class="material-icons" aria-hidden="true">search</span>
                    <input type="text" placeholder="Search movies, shows and people" autocomplete="off" spellcheck="false" aria-label="Search">
                </label>
                <div class="hm-clock"><div class="hm-clock-time"></div><div class="hm-clock-date"></div></div>
            </div>
            <div class="hm-menu"></div>
            <div class="hm-hero">
                <div class="hm-hero-text">
                    <div class="hm-eyebrow">On now</div>
                    <div class="hm-hero-channel"></div>
                    <div class="hm-hero-title">Loading…</div>
                    <div class="hm-hero-meta"></div>
                    <div class="hm-hero-desc"></div>
                    <div class="hm-hero-actions"></div>
                </div>
                <div class="hm-preview">
                    <div class="hm-preview-art"></div>
                    <div class="hm-preview-logo"></div>
                    <canvas width="1120" height="630"></canvas>
                    <div class="hm-preview-badge"></div>
                </div>
            </div>
            <div class="hm-rows"><div class="hm-rows-inner"></div></div>
            <div class="hm-legend">
                <span><span class="hm-key">▲▼◀▶</span>Move</span>
                <span><span class="hm-key">OK</span>Select</span>
                <span data-action="guide"><span class="hm-key">G</span>Guide</span>
                <span data-action="search"><span class="hm-key">/</span>Search</span>
                <span data-action="fullscreen" class="hm-legend-fs" style="display:none"><span class="hm-key">F</span>Full screen</span>
            </div>`;

        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), so Home
        // fills a desktop window edge to edge instead of letterboxing
        const fit = () => {
            // the window, or on a phone the room between HOMER's bars (shared/layout.js)
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < 1600) { s = box.width / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        const tick = () => {
            const d = new Date();
            $('.hm-clock-time').textContent = fmtTime(d);
            $('.hm-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.hm-clock')) : () => {};

        // ---------- Focus (spatial, like a remote) ----------
        // Every selectable thing carries a .hm-focusable class; arrows pick the
        // nearest one in that direction, the way a TV UI moves.
        let focused = null;
        let lastAbove = null; // where Up from the first row returns to
        const setFocus = (node, { scroll = true } = {}) => {
            if (!node || node === focused) return;
            if (focused) focused.classList.remove('hm-focus');
            focused = node;
            node.classList.add('hm-focus');
            if (scroll) revealFocused();
            if (node.dataset.row != null && node.dataset.col != null) rowMemory[node.dataset.row] = +node.dataset.col;
        };
        const rect = (n) => n.getBoundingClientRect();
        const move = (dir) => {
            const all = [...stage.querySelectorAll('.hm-focusable')].filter((n) => n.offsetParent !== null);
            if (!focused || !all.includes(focused)) { setFocus(all[0]); return; }
            // down from the menu's last item or the On Now buttons lands on the first
            // row; up from the first row goes back where you came from
            if (dir === 'down' && focused.dataset.row == null && (focused === menu.lastChild || focused.closest('.hm-hero'))) {
                const t = rowCard(0, rowMemory[0] ?? 0);
                if (t) { lastAbove = focused; setFocus(t); return; }
            }
            if (dir === 'up' && focused.dataset.row === '0' && lastAbove && stage.contains(lastAbove)) {
                setFocus(lastAbove);
                return;
            }
            // moving between rows lands on the card you were last on in that row
            if ((dir === 'up' || dir === 'down') && focused.dataset.row != null) {
                const r = +focused.dataset.row + (dir === 'down' ? 1 : -1);
                const target = rowCard(r, rowMemory[r] ?? 0);
                if (target) { setFocus(target); return; }
            }
            const a = rect(focused);
            const ax = a.left + a.width / 2;
            const ay = a.top + a.height / 2;
            let best = null;
            let bestScore = Infinity;
            for (const n of all) {
                if (n === focused) continue;
                const b = rect(n);
                const bx = b.left + b.width / 2;
                const by = b.top + b.height / 2;
                const dx = bx - ax;
                const dy = by - ay;
                const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
                if (!ok) continue;
                const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
                const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
                const score = primary + cross * 2.5;
                if (score < bestScore) { bestScore = score; best = n; }
            }
            if (best) setFocus(best);
        };

        // ---------- Rows: vertical scroll of the whole block, horizontal per row ----------
        const rowMemory = {};
        const rowOffsets = {}; // row index -> px scrolled horizontally
        let scrollY = 0;
        const rowsInner = () => $('.hm-rows-inner');
        const rowsViewH = () => $('.hm-rows').clientHeight;
        const setScrollY = (y, animate) => {
            const max = Math.max(0, rowsInner().scrollHeight - rowsViewH());
            scrollY = Math.max(0, Math.min(max, y));
            rowsInner().style.transition = animate ? 'transform 180ms ease' : 'none';
            rowsInner().style.transform = `translateY(${-scrollY}px)`;
        };
        const rowCard = (r, c) => {
            const row = stage.querySelector(`.hm-row[data-row="${r}"]`);
            if (!row) return null;
            const cards = row.querySelectorAll('.hm-card');
            return cards[Math.max(0, Math.min(cards.length - 1, c))] || null;
        };
        const setRowOffset = (r, x, animate) => {
            const row = stage.querySelector(`.hm-row[data-row="${r}"]`);
            if (!row) return;
            const slider = row.querySelector('.hm-row-slider');
            const track = row.querySelector('.hm-row-track');
            const max = Math.max(0, slider.scrollWidth - track.clientWidth + 72);
            rowOffsets[r] = Math.max(0, Math.min(max, x));
            slider.style.transition = animate ? 'transform 180ms ease' : 'none';
            slider.style.transform = `translateX(${-rowOffsets[r]}px)`;
        };
        const revealFocused = () => {
            if (!focused || focused.dataset.row == null) {
                if (focused && !focused.closest('.hm-rows')) setScrollY(0, true);
                return;
            }
            const r = +focused.dataset.row;
            // vertical: bring the row into view
            const top = r * ROW_H;
            if (top < scrollY) setScrollY(top, true);
            else if (top + ROW_H > scrollY + rowsViewH()) setScrollY(top + ROW_H - rowsViewH(), true);
            // horizontal: keep the card inside the track
            const c = +focused.dataset.col;
            const x = c * (300 + 22);
            const trackW = focused.closest('.hm-row-track').clientWidth;
            const off = rowOffsets[r] || 0;
            if (x < off) setRowOffset(r, x, true);
            else if (x + 300 + 40 > off + trackW) setRowOffset(r, x + 300 + 40 - trackW, true);
        };

        // ---------- Menu ----------
        let views = [];
        const route = go;
        const viewRoute = (type) => {
            const v = views.find((x) => x.CollectionType === type);
            if (!v) return null;
            return type === 'movies'
                ? `#/movies?topParentId=${v.Id}&collectionType=movies`
                : `#/tv?topParentId=${v.Id}&collectionType=tvshows`;
        };
        const MENU = [
            { icon: 'live_tv', label: 'Live TV Guide', hint: 'G', act: openGuide },
            { icon: 'movie', label: 'Movies', act: () => { const r = viewRoute('movies'); if (r) route(r); } },
            { icon: 'tv', label: 'TV Shows', act: () => { const r = viewRoute('tvshows'); if (r) route(r); } },
            // the audiobooks (books/books.js)
            { icon: 'auto_stories', label: 'Books', act: () => route('#/books') },
            // the music library (music/music.js); it keeps playing while you browse
            { icon: 'library_music', label: 'Music', act: () => route('#/music') },
            { icon: 'fiber_smart_record', label: 'Recordings', act: () => route('#/livetv?tab=3') },
            { icon: 'wb_sunny', label: 'Weather', act: () => route('#/weather') },
            // the hubs: a TV window, their channels, scores or headlines, a ticker
            { icon: 'sports_football', label: 'Sports', act: () => route('#/sports') },
            { icon: 'newspaper', label: 'News', act: () => route('#/news') },
            // Home Assistant's rooms, once it's connected on this device (Settings)
            { icon: 'lightbulb', label: 'Rooms', act: () => route('#/rooms'), when: () => !!(window.HomerHA && window.HomerHA.isSetUp()) },
            // the cameras' wall, with the doorbell's rings and clips
            { icon: 'videocam', label: 'Cameras', act: () => route('#/cameras'), when: () => !!(window.HomerHA && window.HomerHA.isSetUp()) },
            // (Search isn't in the menu: its box is right above it, ▲ from the
            // first item or / gets there)
            { icon: 'settings', label: 'Settings', act: () => route('#/mypreferencesmenu') }
        ].filter((m) => !m.when || m.when());
        const menu = $('.hm-menu');
        menu.classList.toggle('hm-menu-8', MENU.length === 8);
        menu.classList.toggle('hm-menu-9', MENU.length === 9);
        menu.classList.toggle('hm-menu-10', MENU.length === 10);
        menu.classList.toggle('hm-menu-11', MENU.length === 11);
        menu.classList.toggle('hm-menu-12', MENU.length >= 12);
        MENU.forEach((m) => {
            const item = el('div', 'hm-menu-item hm-focusable',
                `<span class="material-icons" aria-hidden="true">${m.icon}</span>${esc(m.label)}${m.hint ? `<span class="hm-menu-hint">${m.hint}</span>` : ''}`);
            item._act = m.act;
            menu.appendChild(item);
        });

        // ---------- Search ----------
        const searchInput = $('.hm-search input');
        const focusSearch = () => { searchInput.focus(); searchInput.select(); };
        const runSearch = () => {
            const q = searchInput.value.trim();
            if (q) route(`#/search?query=${encodeURIComponent(q)}`);
        };

        // ---------- On Now hero (Now watching while the preview plays) ----------
        let hero = null; // { program }
        const setArt = (url, logoFor) => {
            const art = $('.hm-preview-art');
            const logo = $('.hm-preview-logo');
            art.style.backgroundImage = url ? `url(${url})` : 'none';
            logo.innerHTML = '';
            if (!url && logoFor) logo.appendChild(logoChip(logoFor, true));
        };
        const showProgram = (p) => {
            const s = new Date(p.StartDate);
            const e = new Date(p.EndDate);
            const chanLine = $('.hm-hero-channel');
            chanLine.innerHTML = '';
            chanLine.appendChild(logoChip(p));
            chanLine.appendChild(el('span', '', `<b>${esc(p.ChannelNumber || '')}</b> ${esc(p.ChannelName || '')}`));
            $('.hm-hero-title').textContent = p.Name || '';
            const meta = $('.hm-hero-meta');
            meta.innerHTML = '';
            meta.appendChild(el('span', 'hm-chip live', 'Live'));
            if (p.StartDate && p.EndDate) meta.appendChild(el('span', 'hm-chip', `${fmtTime(s)} – ${fmtTime(e)}`));
            if (p.EpisodeTitle) meta.appendChild(el('span', 'hm-chip', esc(p.EpisodeTitle)));
            $('.hm-hero-desc').textContent = p.Overview || '';
            setArt(p.ImageTags && p.ImageTags.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 900) : null, p);
            $('.hm-preview-badge').innerHTML = '<span class="hm-chip live">Live</span>';
        };
        const showItem = (it) => {
            const isEp = it.Type === 'Episode';
            const chanLine = $('.hm-hero-channel');
            chanLine.innerHTML = '';
            const line = isEp
                ? [it.SeriesName, it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber} E${it.IndexNumber}` : ''].filter(Boolean).join(' · ')
                : it.Type === 'Movie' ? 'Movie' : '';
            chanLine.appendChild(el('span', '', esc(line)));
            $('.hm-hero-title').textContent = it.Name || '';
            const meta = $('.hm-hero-meta');
            meta.innerHTML = '';
            [it.ProductionYear, it.OfficialRating, it.RunTimeTicks ? `${Math.round(it.RunTimeTicks / 6e8)} min` : '']
                .filter(Boolean).forEach((m) => meta.appendChild(el('span', 'hm-chip', esc(m))));
            $('.hm-hero-desc').textContent = it.Overview || '';
            setArt(cardArt(it), null);
            $('.hm-preview-badge').innerHTML = '';
        };
        const showHero = () => {
            const box = $('.hm-hero');
            const actions = $('.hm-hero-actions');
            actions.innerHTML = '';
            const btn = (icon, label, act) => {
                const b = el('div', 'hm-btn hm-focusable', `<span class="material-icons" aria-hidden="true">${icon}</span>${label}`);
                b._act = act;
                actions.appendChild(b);
            };
            const watching = previewing();
            const np = nowPlayingInfo();
            const p = watching ? np && np.program : hero && hero.program;
            const item = watching && np && np.item;
            $('.hm-eyebrow').textContent = watching ? 'Now watching' : p ? 'On now' : 'Live TV';
            if (p) showProgram(p);
            else if (item) showItem(item);
            else {
                $('.hm-hero-channel').innerHTML = '';
                $('.hm-hero-meta').innerHTML = '';
                $('.hm-hero-title').textContent = watching ? 'Tuning…' : 'Nothing listed right now';
                $('.hm-hero-desc').textContent = watching ? '' : 'Open the guide to browse every channel.';
                setArt(null, null);
                $('.hm-preview-badge').innerHTML = '';
            }
            if (watching) {
                btn('fullscreen', 'Full screen', goFullscreen);
                btn('grid_view', 'Guide', openGuide);
                btn('stop', 'Stop', stopPreview);
            } else {
                if (p) btn('play_arrow', 'Watch', () => startPreview(p));
                btn('grid_view', 'Guide', openGuide);
            }
            box.classList.toggle('empty', !p && !item && !watching);
            $('.hm-legend-fs').style.display = watching ? '' : 'none';
        };

        // live mirror of whatever is playing (not when it's in the floating window)
        const canvas = $('.hm-preview canvas');
        const c2d = canvas.getContext('2d');
        const mirror = () => {
            if (previewing()) { root.classList.remove('hm-live-on'); return; }
            const v = [...document.querySelectorAll('video')]
                .find((x) => !root.contains(x) && x !== document.pictureInPictureElement && !x.paused && x.readyState >= 2 && x.videoWidth > 0);
            root.classList.toggle('hm-live-on', !!v);
            if (!v) return;
            const cw = canvas.width;
            const chh = canvas.height;
            const vr = v.videoWidth / v.videoHeight;
            const cr = cw / chh;
            let sw = v.videoWidth; let sh = v.videoHeight; let sx = 0; let sy = 0;
            if (vr > cr) { sw = sh * cr; sx = (v.videoWidth - sw) / 2; } else { sh = sw / cr; sy = (v.videoHeight - sh) / 2; }
            try { c2d.drawImage(v, sx, sy, sw, sh, 0, 0, cw, chh); } catch { root.classList.remove('hm-live-on'); }
        };
        const mirrorTimer = setInterval(mirror, 66);

        // ---------- Rows ----------
        const rowsBox = rowsInner();
        let rowCount = 0;
        const addRow = (title, items, toCard) => {
            const r = rowCount++;
            const row = el('div', 'hm-row');
            row.dataset.row = r;
            row.appendChild(el('div', 'hm-row-title', esc(title)));
            const track = el('div', 'hm-row-track');
            const slider = el('div', 'hm-row-slider');
            items.forEach((it, c) => {
                const card = toCard(it);
                card.classList.add('hm-card', 'hm-focusable');
                card.dataset.row = r;
                card.dataset.col = c;
                slider.appendChild(card);
            });
            track.appendChild(slider);
            row.appendChild(track);
            rowsBox.appendChild(row);
        };
        const mediaCard = (it) => {
            const card = el('div');
            const art = cardArt(it);
            card.appendChild(el('div', 'hm-card-img')).style.backgroundImage = art ? `url(${art})` : 'none';
            card.appendChild(el('div', 'hm-card-shade'));
            const isEp = it.Type === 'Episode';
            const title = isEp ? it.SeriesName : it.Name;
            const sub = isEp
                ? [it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber} E${it.IndexNumber}` : '', it.Name].filter(Boolean).join(' · ')
                : [it.ProductionYear, it.OfficialRating].filter(Boolean).join(' · ');
            card.appendChild(el('div', 'hm-card-text', `<div class="hm-card-title">${esc(title)}</div><div class="hm-card-sub">${esc(sub)}</div>`));
            const pct = it.UserData && it.UserData.PlayedPercentage;
            if (pct) card.appendChild(el('div', 'hm-card-progress', `<i style="width:${Math.round(pct)}%"></i>`));
            card._act = () => route(`#/details?id=${it.Id}&serverId=${server.Id}`);
            return card;
        };
        const liveCard = (p) => {
            const card = el('div');
            const art = p.ImageTags && p.ImageTags.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 600) : null;
            card.appendChild(el('div', 'hm-card-img')).style.backgroundImage = art ? `url(${art})` : 'none';
            card.appendChild(el('div', 'hm-card-shade'));
            const logo = el('div', 'hm-card-logo');
            logo.appendChild(logoChip(p));
            card.appendChild(logo);
            card.appendChild(el('div', 'hm-card-live', '<span class="hm-chip live">Live</span>'));
            const e = new Date(p.EndDate);
            card.appendChild(el('div', 'hm-card-text', `<div class="hm-card-title">${esc(p.Name)}</div><div class="hm-card-sub">${esc(p.ChannelName || '')} · until ${esc(fmtTime(e))}</div>`));
            const s = new Date(p.StartDate);
            const pct = Math.max(0, Math.min(100, ((Date.now() - s) / (e - s)) * 100));
            card.appendChild(el('div', 'hm-card-progress', `<i style="width:${Math.round(pct)}%"></i>`));
            card._act = () => startPreview(p);
            return card;
        };

        // ---------- Input ----------
        const activate = () => { if (focused && focused._act) focused._act(); };
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (document.getElementById('cg-root')) return; // the guide is on top
            const k = ev.key;
            if (ev.target === searchInput) {
                if (k === 'Enter') { ev.preventDefault(); runSearch(); }
                else if (k === 'Escape' || k === 'ArrowDown') { ev.preventDefault(); searchInput.blur(); setFocus(menu.firstChild); }
                ev.stopPropagation();
                return;
            }
            const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
            if (map[k]) {
                ev.preventDefault();
                ev.stopPropagation();
                if (k === 'ArrowUp' && focused && focused.classList.contains('hm-menu-item') && focused === menu.firstChild) { focusSearch(); return; }
                move(map[k]);
            } else if (k === 'Enter') {
                ev.preventDefault();
                ev.stopPropagation();
                if (!ev.repeat) activate();
            } else if (k === '/') {
                ev.preventDefault();
                ev.stopPropagation();
                focusSearch();
            }
        };
        const onClick = (ev) => {
            const t = ev.target.closest('.hm-focusable');
            if (t && stage.contains(t)) { setFocus(t, { scroll: false }); activate(); return; }
            const leg = ev.target.closest('.hm-legend [data-action]');
            if (leg) {
                if (leg.dataset.action === 'guide') openGuide();
                else if (leg.dataset.action === 'search') focusSearch();
                else if (leg.dataset.action === 'fullscreen') goFullscreen();
            }
        };
        const onOver = (ev) => {
            const t = ev.target.closest('.hm-focusable');
            if (t && stage.contains(t)) setFocus(t, { scroll: false });
        };
        // trackpad: vertical scrolls the rows, horizontal scrolls the row under the pointer
        const onWheelCapture = (ev) => {
            if (!root.contains(ev.target)) return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            const px = (d) => (ev.deltaMode === 1 ? d * 40 : ev.deltaMode === 2 ? d * 400 : d);
            const dx = px(ev.deltaX);
            const dy = px(ev.deltaY);
            const rowEl = ev.target.closest('.hm-row');
            if (Math.abs(dx) > Math.abs(dy) && rowEl) setRowOffset(+rowEl.dataset.row, (rowOffsets[+rowEl.dataset.row] || 0) + dx, false);
            else if (ev.target.closest('.hm-rows')) setScrollY(scrollY + dy, false);
        };

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
        stage.addEventListener('click', onClick);
        stage.addEventListener('mouseover', onOver);

        // ----- the Actions strip (shared/actions.js) -----
        // Home's own two keys. The Guide, Home and the quick controls come from
        // the strip itself, and no main action here on purpose: a swipe up on
        // the remote should open the Guide, which is what it does without one.
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [{ id: 'search', key: '/', icon: 'search', label: 'Search', run: focusSearch }];
            if (previewing()) out.push({ id: 'fullscreen', key: 'F', icon: 'fullscreen', label: 'Full screen', run: goFullscreen });
            return out;
        }, { id: 'home', title: 'Home' }) : () => {};

        const self = {
            show() { root.style.visibility = ''; },
            // redraw the On Now / Now watching panel, keeping focus sensible
            refresh() {
                const inHero = focused && !stage.contains(focused) || (focused && focused.closest('.hm-hero-actions'));
                showHero();
                root.classList.toggle('hm-previewing', previewing());
                if (inHero) setFocus($('.hm-hero-actions').firstChild, { scroll: false });
            },
            teardown() {
                offActions();
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('resize', fit);
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                clearInterval(clockTimer);
                wxDetach();
                clearInterval(mirrorTimer);
                root.remove();
            }
        };

        if (previewing()) { showHero(); root.classList.add('hm-previewing'); } // Now watching straight away

        // ---------- Data ----------
        (async () => {
            const { views: v, live, rows } = await data;
            if (home !== self) return;
            views = v;
            hero = live.length ? { program: live[0] } : null;
            showHero();

            rows.forEach((row) => addRow(row.title, row.items, row.live ? liveCard : mediaCard));
            if (!rowCount) rowsBox.appendChild(el('div', 'hm-row-empty', 'Nothing to show yet.'));

            setFocus(menu.firstChild, { scroll: false });
        })().catch((err) => {
            console.error('[HOMER Home]', err);
            if (home === self) $('.hm-hero-title').textContent = 'Couldn\'t load home';
        });

        return self;
    };

    // The phone layout: shared/layout.js says when; home/home-phone.js draws
    // it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerHomePhone && window.HomerLayout.usePhone('home'));
    const draw = (server) => (phoneLayout()
        ? window.HomerHomePhone.create({
            server,
            data,
            logoChip,
            cardArt,
            img,
            fmtTime,
            openGuide,
            go,
            watch: startPreview,
            isOpen: (v) => home === v
        })
        : createHome(server, data));

    const open = () => {
        if (home) return;
        const server = getServer();
        if (!server) return;
        data = loadData(server);
        data.catch(() => {}); // each layout says so itself
        home = draw(server);
        const h = home;
        ensureCss().then(() => h.show());
    };

    const close = () => {
        if (!home) return;
        const h = home;
        home = null;
        data = null;
        h.teardown();
    };

    // The phone and TV layouts switch places (a window resized across the
    // line, or the phone layout arriving): draw the other one from the same data.
    const onLayout = () => {
        if (!home || !!home.phone === phoneLayout()) return;
        const server = getServer();
        home.teardown();
        home = null;
        if (!server || !data) return;
        home = draw(server);
        const h = home;
        ensureCss().then(() => { if (home === h) h.show(); });
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    // ---------- Take over Jellyfin's home route ----------
    // (the player's route: Home can be the screen on top of a playing video)
    const isHomeRoute = (h) => /^#\/(home(\.html)?)?(\?.*)?$/.test(h) || h === '' || h === '#/';
    const sync = () => {
        if (isHomeRoute(currentRoute()) && getServer()) open();
        else close();
    };
    const goHome = () => {
        if (P()) { P().goHome(); return; }
        if (isHomeRoute(location.hash)) open();
        else location.hash = '#/home';
    };
    let queued = false;
    const queue = () => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; sync(); }, 50);
    };
    const onRoute = () => queue();

    window.addEventListener('hashchange', onRoute);
    window.addEventListener('popstate', onRoute);
    // the player changes the route (docking, Back) and what's playing
    const onPlayer = () => { if (home) home.refresh(); queue(); };
    let offPlayer = null;
    const hookPlayer = () => {
        if (offPlayer || !P()) return;
        offPlayer = P().onChange(onPlayer);
    };
    hookPlayer();
    let observer = null;
    const start = () => {
        hookPlayer();
        observer = new MutationObserver(queue);
        observer.observe(document.body, { childList: true });
        queue();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerHome = {
        version: VERSION,
        open,
        close,
        fullscreen: goFullscreen,
        goHome,
        destroy() {
            close();
            observer && observer.disconnect();
            window.removeEventListener('hashchange', onRoute);
            window.removeEventListener('popstate', onRoute);
            if (offPlayer) offPlayer();
            offLayout();
            document.getElementById('hm-css')?.remove();
            document.getElementById('hm-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
