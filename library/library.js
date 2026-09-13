/*
 * HOMER library screens for Jellyfin Web: Movies, TV Shows and item details,
 * drawn as a full-screen set-top-box UI on the same 1920×1080 stage as the
 * guide.
 *
 * Takes over these Jellyfin routes while they're showing (Jellyfin's own page
 * stays underneath, untouched):
 *   #/movies?topParentId=…   Movies library
 *   #/tv?topParentId=…       TV Shows library
 *   #/details?id=…           Movie, Series, Season and Episode items only
 *
 * Remote/keyboard: arrows move, OK/Enter activates, Esc/Back goes back.
 *
 * window.HomerLibrary = { open(route), close, destroy, version }
 */
(() => {
    const VERSION = '0.1.1';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerLibrary && typeof window.HomerLibrary.destroy === 'function') {
        window.HomerLibrary.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="library.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/library\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'library/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const SUPPORTED = new Set(['Movie', 'Series', 'Season', 'Episode']);
    const TICKS_PER_MIN = 600000000;
    const Z = 99990; // just under the guide, so the guide can open on top

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

    // Identify as Jellyfin Web itself, so API use doesn't rename this browser in
    // the dashboard or split it into a second session (same as the guide).
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* token only; the server fills in the rest */ }
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
    const lc = (x) => String(x ?? '').toLowerCase();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
    const fmtMins = (mins) => {
        mins = Math.max(1, Math.round(mins));
        const h = Math.floor(mins / 60);
        return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
    };
    const runtime = (it) => (it.RunTimeTicks > 0 ? fmtMins(it.RunTimeTicks / TICKS_PER_MIN) : '');
    const posOf = (it) => (it && it.UserData && it.UserData.PlaybackPositionTicks) || 0;
    const played = (it) => !!(it && it.UserData && it.UserData.Played);
    const pctOf = (it) => {
        const pos = posOf(it);
        if (!pos || !(it.RunTimeTicks > 0)) return 0;
        return clamp((pos / it.RunTimeTicks) * 100, 1, 100);
    };
    const minsLeft = (it) => (it.RunTimeTicks > 0 ? (it.RunTimeTicks - posOf(it)) / TICKS_PER_MIN : 0);
    const endsAt = (it) => {
        const left = it.RunTimeTicks > 0 ? minsLeft(it) : 0;
        return left > 0 ? `Ends at ${fmtTime(new Date(Date.now() + left * 60000))}` : '';
    };
    const epCode = (ep) => {
        if (ep.IndexNumber == null) return '';
        const e = ep.IndexNumberEnd && ep.IndexNumberEnd !== ep.IndexNumber ? `E${ep.IndexNumber}–${ep.IndexNumberEnd}` : `E${ep.IndexNumber}`;
        return ep.ParentIndexNumber != null ? `S${ep.ParentIndexNumber} ${e}` : e;
    };
    const yearsOf = (it) => {
        const y = it.ProductionYear;
        if (!y) return '';
        if (it.Type !== 'Series') return String(y);
        if (it.Status === 'Continuing') return `Since ${y}`;
        const end = it.EndDate ? new Date(it.EndDate).getUTCFullYear() : null;
        return end && end !== y ? `${y}–${end}` : String(y);
    };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const isNew = (it) => it.DateCreated && Date.now() - new Date(it.DateCreated) < 14 * 86400000;

    const imgUrl = (id, type, tag, q) => `/Items/${id}/Images/${type}?${q}&tag=${encodeURIComponent(tag)}`;
    const posterUrl = (it, h = 180) => (it.ImageTags && it.ImageTags.Primary ? imgUrl(it.Id, 'Primary', it.ImageTags.Primary, `fillHeight=${h}&quality=90`) : null);
    const backdropUrl = (it, w = 1280) => {
        if (it.BackdropImageTags && it.BackdropImageTags.length) return `/Items/${it.Id}/Images/Backdrop/0?maxWidth=${w}&quality=85&tag=${encodeURIComponent(it.BackdropImageTags[0])}`;
        if (it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length) {
            return `/Items/${it.ParentBackdropItemId}/Images/Backdrop/0?maxWidth=${w}&quality=85&tag=${encodeURIComponent(it.ParentBackdropImageTags[0])}`;
        }
        if (it.ImageTags && it.ImageTags.Thumb) return imgUrl(it.Id, 'Thumb', it.ImageTags.Thumb, `maxWidth=${w}&quality=85`);
        return null;
    };
    // an episode's own still, else the show's art
    const stillUrl = (ep, w = 640) => {
        if (ep.ImageTags && ep.ImageTags.Primary) return imgUrl(ep.Id, 'Primary', ep.ImageTags.Primary, `maxWidth=${w}&quality=85`);
        if (ep.ParentThumbItemId && ep.ParentThumbImageTag) return imgUrl(ep.ParentThumbItemId, 'Thumb', ep.ParentThumbImageTag, `maxWidth=${w}&quality=85`);
        return backdropUrl(ep, w);
    };

    const LANGS = {
        eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian',
        jpn: 'Japanese', por: 'Portuguese', rus: 'Russian', chi: 'Chinese', zho: 'Chinese', kor: 'Korean',
        dut: 'Dutch', nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', pol: 'Polish',
        hin: 'Hindi', ara: 'Arabic', heb: 'Hebrew', tur: 'Turkish', gre: 'Greek', ell: 'Greek', cze: 'Czech', ces: 'Czech',
        hun: 'Hungarian', tha: 'Thai', vie: 'Vietnamese', ukr: 'Ukrainian'
    };
    const langName = (code) => (code ? LANGS[lc(code)] || code.toUpperCase() : '');

    // Items the screens have seen, by id, so a details route for one of them opens
    // without a lookup (and routes we don't handle are recognized at once).
    const typeCache = new Map();
    const remember = (items) => { for (const it of items || []) if (it && it.Id && it.Type) typeCache.set(it.Id, it.Type); };

    // Where the highlight was on each screen, so coming back (Back, or the end of
    // a movie) lands where you left.
    const memory = new Map();

    // Stylesheets load on first open. tokens.css normally comes from homer.js;
    // load it here too when this script is used on its own.
    let cssReady = null;
    const ensureCss = () => {
        if (!document.getElementById('homer-tokens')) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE + '../shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
        if (cssReady && document.getElementById('hl-css')) return cssReady;
        const css = document.createElement('link');
        css.id = 'hl-css';
        css.rel = 'stylesheet';
        css.href = BASE + 'library.css' + QUERY;
        cssReady = new Promise((resolve) => {
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
        });
        document.head.appendChild(css);
        return cssReady;
    };

    // ---------- Playback ----------

    // Hand Jellyfin Web's own remote-control handler a Play message, exactly as
    // if the server had told this client to play it (the guide does the same).
    const play = async (id, startTicks) => {
        if (docked()) P().fullscreen(); // Play means full screen, even while something plays docked
        const ac = window.ApiClient;
        const server = getServer();
        // always explicit: 0 means "from the beginning" (Restart), never "wherever it was"
        const data = { PlayCommand: 'PlayNow', ItemIds: [id], StartPositionTicks: startTicks > 0 ? startTicks : 0 };
        if (ac && typeof ac.handleMessageReceived === 'function' && (!ac.serverId || ac.serverId() === server.Id)) {
            ac.handleMessageReceived({ MessageType: 'Play', Data: data });
            return;
        }
        // Fallback: remote-control this browser's own session through the server.
        const deviceId = (ac && ac.deviceId && ac.deviceId()) || localStorage.getItem('_deviceId2');
        const sessions = await api(`/Sessions?deviceId=${encodeURIComponent(deviceId)}`);
        const mine = (sessions || []).find((s) => s.DeviceId === deviceId && s.SupportsRemoteControl);
        if (!mine) throw new Error('Could not find this browser\'s Jellyfin session');
        await request('POST', `/Sessions/${mine.Id}/Playing?playCommand=PlayNow&itemIds=${id}${startTicks > 0 ? '&startPositionTicks=' + startTicks : ''}`);
    };

    // ---------- The player (shared/player.js) ----------
    // While a video plays docked in a preview window, HOMER screens sit on top of
    // Jellyfin's player page and move between each other without touching the
    // address (leaving the player page would stop the video). HomerPlayer keeps
    // that screen stack; this module asks it where it is and goes through it.
    const P = () => window.HomerPlayer || null;
    const docked = () => !!(P() && P().docked());
    const currentRoute = () => (P() ? P().route() : location.hash);
    const nav = (hash) => { if (P()) P().go(hash); else location.hash = hash; };

    const detailsHash = (id) => {
        const server = getServer();
        return `#/details?id=${id}${server && server.Id ? '&serverId=' + server.Id : ''}`;
    };

    // Back, like a remote: the previous page, or somewhere sensible when this was
    // the first page in the tab.
    const goBack = (fallback) => {
        if (docked()) { P().back(); return; }
        const before = location.href;
        history.back();
        setTimeout(() => {
            if (location.href === before) location.hash = fallback;
        }, 400);
    };

    // Home: HOMER Home handles it when it's loaded, otherwise Jellyfin's home route
    const goHome = () => {
        if (P()) P().goHome();
        else if (window.HomerHome && window.HomerHome.goHome) window.HomerHome.goHome();
        else location.hash = '#/home';
    };

    // ---------- Pixel scrolling (lists and the season tabs) ----------
    // The trackpad moves a list freely; keyboard selection nudges it just enough
    // to keep the highlight in view. Wheel never moves the selection.
    const makeScroller = (viewport, inner, horizontal = false, onMove = null) => {
        let pos = 0;
        const viewSize = () => (horizontal ? viewport.clientWidth : viewport.clientHeight);
        const contentSize = () => (horizontal ? inner.scrollWidth : inner.offsetHeight);
        const set = (p, animate) => {
            pos = clamp(p, 0, Math.max(0, contentSize() - viewSize()));
            inner.style.transition = animate ? 'transform 160ms ease' : 'none';
            inner.style.transform = horizontal ? `translateX(${-pos}px)` : `translateY(${-pos}px)`;
            if (onMove) onMove(pos, viewSize());
        };
        return {
            set,
            reset() { set(0, false); },
            refresh() { set(pos, false); },
            reveal(start, size, animate = true) {
                if (start < pos) set(start, animate);
                else if (start + size > pos + viewSize()) set(start + size - viewSize(), animate);
            },
            wheel(ev) {
                const d = horizontal && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : (horizontal ? ev.deltaY || ev.deltaX : ev.deltaY);
                const px = ev.deltaMode === 1 ? d * 40 : ev.deltaMode === 2 ? d * viewSize() : d;
                set(pos + px, false);
            }
        };
    };

    // Row art loads for what's on screen plus a screen either side. (Native lazy
    // loading can't see these rows: they move by transform inside a clipped box.)
    const loadNear = (inner) => (pos, size) => {
        for (const img of inner.querySelectorAll('img[data-src]')) {
            const row = img.parentNode.parentNode;
            if (row.style.display === 'none') continue;
            const top = row.offsetTop;
            if (top + row.offsetHeight >= pos - size && top <= pos + size * 2) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            }
        }
    };

    // Hover highlights, but only when the pointer really moved: a list sliding
    // under a resting pointer (trackpad scrolling) must not drag the highlight.
    const hoverTracker = () => {
        let x = -1;
        let y = -1;
        return (ev) => {
            if (ev.clientX === x && ev.clientY === y) return false;
            x = ev.clientX;
            y = ev.clientY;
            return true;
        };
    };

    // ---------- Shared chrome: stage, top bar, info panel, legend ----------

    const PREVIEW_HTML = `
        <div class="hl-preview">
            <div class="hl-preview-art"></div>
            <div class="hl-preview-poster"></div>
            <div class="hl-preview-badge"></div>
            <div class="hl-preview-bar"><span class="hl-preview-left"></span><span class="hl-preview-right"></span></div>
            <div class="hl-progress"><i></i></div>
        </div>`;

    const TEXT_HTML = `
        <div class="hl-text">
            <div class="hl-kicker"></div>
            <div class="hl-title"></div>
            <div class="hl-meta"></div>
            <div class="hl-desc"></div>
            <div class="hl-actions"></div>
        </div>`;

    const createShell = ({ kind, brand, search }) => {
        const root = el('div');
        root.id = 'hl-root';
        root.className = 'hl-' + kind;
        root.style.visibility = 'hidden'; // until library.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hl-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hl-ambient"></div>
            <div class="hl-topbar">
                <div class="hl-brand homer-home" role="button" title="Home (H)"><span class="hl-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hl-brand-sub">${esc(brand)}</span></div>
                ${search ? `<label class="hl-search">
                    <span class="material-icons hl-search-icon" aria-hidden="true">search</span>
                    <input class="hl-search-input" type="text" placeholder="${esc(search)}" autocomplete="off" spellcheck="false" aria-label="${esc(search)}">
                    <span class="hl-search-count"></span>
                </label>` : ''}
                <div class="hl-clock"><div class="hl-clock-time"></div><div class="hl-clock-date"></div></div>
            </div>
            <div class="hl-toast" role="status" aria-live="polite"></div>
            <div class="hl-body"></div>
            <div class="hl-legend"></div>`;
        document.body.appendChild(root);

        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), matching
        // Home and the guide, so the screen fills the window instead of letterboxing
        const fit = () => {
            let s = window.innerHeight / 1080;
            let w = window.innerWidth / s;
            if (w < 1600) { s = window.innerWidth / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        const tick = () => {
            const d = new Date();
            $('.hl-clock-time').textContent = fmtTime(d);
            $('.hl-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);

        const toastEl = $('.hl-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `<span class="hl-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hl-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hl-toast'; }, 3200);
        };

        // legend: [{ key, label, action }] with 'spacer' for the gap. Every screen
        // gets H Home, just before Back.
        const HOME_ITEM = { key: 'H', label: 'Home', action: 'home' };
        const FULL_ITEM = { key: 'F', label: 'Full screen', action: 'fullscreen' };
        let lastLegend = [];
        const setLegend = (list) => {
            lastLegend = list;
            const items = list.slice();
            const at = items.indexOf('spacer');
            if (at >= 0) items.splice(at, 0, ...(docked() ? [FULL_ITEM] : []));
            const sp = items.indexOf('spacer');
            if (sp >= 0) items.splice(sp + 1, 0, HOME_ITEM);
            else items.push(...(docked() ? [FULL_ITEM] : []), 'spacer', HOME_ITEM);
            $('.hl-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hl-key">${i.key}</span>${esc(i.label)}</span>`)).join('');
        };

        const setAmbient = (url) => {
            const a = $('.hl-ambient');
            a.style.backgroundImage = url ? `url("${url}")` : 'none';
            a.classList.toggle('on', !!url);
        };

        // Art fades in once it has loaded, like a channel change, instead of the
        // window sitting blank (or showing the previous title) while it downloads.
        let artUrl = null;
        const setArt = (url) => {
            if (url === artUrl) return;
            artUrl = url;
            const art = $('.hl-preview-art');
            art.classList.remove('in');
            if (!url) {
                art.style.backgroundImage = 'none';
                return;
            }
            const img = new Image();
            img.onload = () => {
                if (artUrl !== url) return;
                art.style.backgroundImage = `url("${url}")`;
                art.classList.add('in');
            };
            img.src = url;
        };

        // info panel: text column + preview window
        const renderInfo = (info) => {
            $('.hl-kicker').innerHTML = info.kicker || '';
            $('.hl-kicker').style.display = info.kicker ? '' : 'none';
            const title = $('.hl-title');
            title.textContent = info.title || '';
            title.classList.toggle('long', (info.title || '').length > 34);
            $('.hl-meta').innerHTML = (info.chips || []).filter((c) => c && c.text)
                .map((c) => `<span class="hl-chip${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>`).join('');
            $('.hl-desc').textContent = info.desc || '';
            $('.hl-desc').classList.toggle('empty', !info.desc);
            setArt(info.art);
            const poster = $('.hl-preview-poster');
            poster.innerHTML = !info.art && info.poster ? `<img src="${esc(info.poster)}" alt="">` : '';
            $('.hl-preview-badge').innerHTML = info.badge || '';
            $('.hl-preview-left').textContent = info.barLeft || '';
            $('.hl-preview-right').textContent = info.barRight || '';
            $('.hl-progress').style.display = info.progress ? '' : 'none';
            $('.hl-progress > i').style.width = (info.progress || 0) + '%';
        };

        // action buttons: [{ id, icon, label }]
        const renderActions = (list, focusIdx, focused) => {
            const box = $('.hl-actions');
            box.innerHTML = list.map((a, i) => `<div class="hl-btn${i === focusIdx ? ' cur' : ''}${i === focusIdx && focused ? ' focus' : ''}" role="button" data-i="${i}">
                <span class="material-icons" aria-hidden="true">${a.icon}</span><span>${esc(a.label)}</span></div>`).join('');
        };

        let onKey = null;
        let onWheel = null;
        const keyHandler = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (onKey) onKey(ev);
        };
        const wheelHandler = (ev) => {
            ev.preventDefault(); // never let the Jellyfin page underneath scroll
            if (onWheel) onWheel(ev);
        };
        document.addEventListener('keydown', keyHandler, true);
        window.addEventListener('resize', fit);
        $('.hl-brand').addEventListener('click', goHome);
        $('.hl-legend').addEventListener('click', (ev) => {
            if (ev.target.closest('[data-action="home"]')) goHome();
            else if (ev.target.closest('[data-action="fullscreen"]') && P()) P().fullscreen();
        });
        root.addEventListener('wheel', wheelHandler, { passive: false });

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        return {
            root,
            stage,
            $,
            toast,
            setLegend,
            refreshLegend() { setLegend(lastLegend); },
            setAmbient,
            renderInfo,
            renderActions,
            setKeys(fn) { onKey = fn; },
            setWheel(fn) { onWheel = fn; },
            show() { root.style.visibility = ''; },
            teardown() {
                document.removeEventListener('keydown', keyHandler, true);
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearTimeout(toastTimer);
                root.remove();
            }
        };
    };

    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const stop = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    };

    // ---------- Library screen (Movies / TV Shows) ----------

    const createLibrary = (server, route) => {
        const isTv = route.collection === 'tvshows';
        const nouns = isTv ? 'shows' : 'movies';
        const shell = createShell({ kind: 'library', brand: isTv ? 'TV SHOWS' : 'MOVIES', search: isTv ? 'Filter shows' : 'Filter movies' });
        const { root, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-list">
                <div class="hl-list-head">
                    <div class="hl-sort">
                        <span class="hl-sort-opt" data-sort="az">A–Z</span>
                        <span class="hl-sort-opt" data-sort="added">Recently added</span>
                    </div>
                    <div class="hl-count"></div>
                </div>
                <div class="hl-rows"><div class="hl-rows-inner"></div><div class="hl-state"></div></div>
            </div>
            <div class="hl-detail">${PREVIEW_HTML}${TEXT_HTML}</div>`;

        const saved = memory.get(route.key) || {};
        const SORT_KEY = 'homer-library-sort-' + route.collection;
        let sortMode = 'az';
        try { sortMode = localStorage.getItem(SORT_KEY) === 'added' ? 'added' : 'az'; } catch { /* default */ }

        let rows = []; // { it, el }
        let view = []; // row indices in display order
        let sel = -1;
        let zone = 'list'; // list | actions | sort
        let act = 0;
        let actions = [];
        let query = '';
        let status = 'loading'; // loading | ready | error
        const nextUp = new Map(); // seriesId -> episode | null
        let nextUpTimer = 0;

        const rowsView = $('.hl-rows');
        const inner = $('.hl-rows-inner');
        const scroller = makeScroller(rowsView, inner, false, loadNear(inner));
        const moved = hoverTracker();
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const current = () => (rows[sel] ? rows[sel].it : null);

        // ----- rows -----
        const rowSub = (it) => {
            if (it.Type === 'Series') {
                const n = it.RecursiveItemCount || 0;
                return [yearsOf(it), n ? plural(n, 'episode') : '', it.ChildCount > 1 ? plural(it.ChildCount, 'season') : ''].filter(Boolean).join(' · ');
            }
            return [it.ProductionYear, runtime(it), it.OfficialRating].filter(Boolean).join(' · ');
        };
        const rowFlag = (it) => {
            if (it.Type === 'Series') {
                const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                return n ? `<span class="hl-count-dot">${n}</span>` : '<span class="material-icons hl-check">check</span>';
            }
            if (posOf(it) > 0) return `<span class="hl-left">${fmtMins(minsLeft(it))} left</span>`;
            if (played(it)) return '<span class="material-icons hl-check">check</span>';
            return '<span class="hl-dot" title="Unwatched"></span>';
        };
        const makeRow = (it) => {
            const r = el('div', 'hl-row');
            const poster = posterUrl(it, 180);
            r.innerHTML = `
                <div class="hl-thumb">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((it.Name || '?').slice(0, 1))}</span>`}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(it.Name)}</div><div class="hl-row-sub">${esc(rowSub(it))}</div></div>
                <div class="hl-row-flag">${rowFlag(it)}</div>
                ${pctOf(it) ? `<div class="hl-row-progress"><i style="width:${pctOf(it)}%"></i></div>` : ''}`;
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => { img.parentNode.innerHTML = `<span>${esc((it.Name || '?').slice(0, 1))}</span>`; };
            }
            return r;
        };

        const markSort = () => root.querySelectorAll('.hl-sort-opt').forEach((o) => o.classList.toggle('on', o.dataset.sort === sortMode));
        markSort();
        const sortKey = (it) => lc(it.SortName || it.Name);
        const applyView = (keepId) => {
            const order = rows.map((_, i) => i);
            if (sortMode === 'added') order.sort((a, b) => String(rows[b].it.DateCreated || '').localeCompare(String(rows[a].it.DateCreated || '')));
            else order.sort((a, b) => sortKey(rows[a].it).localeCompare(sortKey(rows[b].it), undefined, { numeric: true }));
            view = order.filter((i) => {
                if (!query) return true;
                const it = rows[i].it;
                return lc(`${it.Name} ${it.OriginalTitle || ''} ${it.ProductionYear || ''} ${(it.Genres || []).join(' ')}`).includes(query);
            });
            const shown = new Set(view);
            for (const i of order) {
                rows[i].el.style.display = shown.has(i) ? '' : 'none';
                inner.appendChild(rows[i].el); // DOM order = display order
            }
            markSort();
            const total = rows.length;
            $('.hl-count').textContent = query ? `${view.length} of ${total}` : plural(total, isTv ? 'show' : 'movie');
            $('.hl-search-count').textContent = query ? `${view.length} ${view.length === 1 ? nouns.slice(0, -1) : nouns}` : '';
            root.classList.toggle('filtering', !!query);
            scroller.reset();
            if (!view.length) {
                setState(query ? `<b>Nothing matches “${esc(query)}”</b><span>Esc clears the filter</span>` : '');
                if (rows[sel]) rows[sel].el.classList.remove('sel');
                sel = -1;
                showEmptyInfo();
                return;
            }
            setState('');
            const keep = rows.findIndex((r) => r.it.Id === keepId);
            select(keep >= 0 && shown.has(keep) ? keep : view[0]);
        };

        const select = (i, { scroll = true } = {}) => {
            if (!rows[i] || view.indexOf(i) < 0) return;
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            const changed = sel !== i;
            sel = i;
            rows[i].el.classList.add('sel');
            if (scroll) scroller.reveal(rows[i].el.offsetTop - 8, rows[i].el.offsetHeight + 16);
            memory.set(route.key, { id: rows[i].it.Id });
            if (changed) act = 0;
            showInfo(rows[i].it);
        };

        const step = (d) => {
            if (!view.length) return;
            const v = clamp(view.indexOf(sel) + d, 0, view.length - 1);
            select(view[v]);
        };

        // ----- info panel -----
        const actionsFor = (it) => {
            if (it.Type === 'Series') {
                const list = [{ id: 'episodes', icon: 'video_library', label: 'Episodes' }];
                const nu = nextUp.get(it.Id);
                if (nu) {
                    const code = epCode(nu);
                    if (posOf(nu) > 0) {
                        list.push({ id: 'resume', icon: 'play_arrow', label: code ? `Resume ${code}` : 'Resume', item: nu });
                        list.push({ id: 'restart', icon: 'replay', label: 'Restart', item: nu });
                    } else {
                        list.push({ id: 'play', icon: 'play_arrow', label: code ? `Play ${code}` : 'Play next', item: nu });
                    }
                }
                return list;
            }
            if (posOf(it) > 0) {
                return [{ id: 'resume', icon: 'play_arrow', label: 'Resume', item: it },
                    { id: 'restart', icon: 'replay', label: 'Restart', item: it }];
            }
            return [{ id: 'play', icon: 'play_arrow', label: 'Play', item: it }];
        };

        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, zone === 'actions');
        };

        const updateLegend = () => {
            const back = ['spacer', { key: 'ESC', label: 'Back', action: 'back' }];
            if (status === 'error') return shell.setLegend([{ key: 'OK', label: 'Try again', action: 'ok' }, ...back]);
            if (status !== 'ready' || !rows.length) return shell.setLegend(back);
            const ok = actions[zone === 'actions' ? act : 0];
            shell.setLegend([
                { key: '▲▼', label: 'Browse' },
                { key: '◀▶', label: 'Options' },
                ...(ok || zone === 'sort' ? [{ key: 'OK', label: zone === 'sort' ? 'Sort' : ok.label.replace(/ S\d+.*$/, ''), action: 'ok' }] : []),
                { key: '/', label: 'Filter', action: 'filter' },
                ...back
            ]);
        };

        const showInfo = (it) => {
            const chips = [];
            if (it.Type === 'Series') {
                chips.push({ text: yearsOf(it) }, { text: it.OfficialRating });
                if (it.ChildCount) chips.push({ text: plural(it.ChildCount, 'season') });
            } else {
                chips.push({ text: it.ProductionYear ? String(it.ProductionYear) : '' }, { text: it.OfficialRating }, { text: runtime(it) });
            }
            if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
            for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });

            let badge = '';
            let barRight = '';
            if (it.Type === 'Series') {
                const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                badge = n ? `<span class="hl-chip hl-chip-new">${n} unwatched</span>` : '<span class="hl-chip">Watched</span>';
                barRight = plural(it.RecursiveItemCount || 0, 'episode');
            } else if (posOf(it) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(it))} left`;
            } else {
                badge = played(it) ? '<span class="hl-chip">Watched</span>' : isNew(it) ? '<span class="hl-chip hl-chip-new">New</span>' : '';
                barRight = runtime(it);
            }
            shell.renderInfo({
                title: it.Name,
                chips,
                desc: it.Overview || '',
                art: backdropUrl(it, 1280),
                poster: posterUrl(it, 420),
                badge,
                barLeft: it.DateCreated ? `Added ${fmtDate(it.DateCreated)}` : '',
                barRight,
                progress: it.Type === 'Series' ? 0 : pctOf(it)
            });
            actions = actionsFor(it);
            drawActions();
            updateLegend();
            if (it.Type === 'Series' && !nextUp.has(it.Id)) queueNextUp(it);
        };

        const showEmptyInfo = () => {
            actions = [];
            shell.renderInfo({ title: '', chips: [], desc: '' });
            drawActions();
            updateLegend();
        };

        // a show's next episode (for Play/Resume), looked up once you settle on it
        const queueNextUp = (it) => {
            clearTimeout(nextUpTimer);
            nextUpTimer = setTimeout(async () => {
                try {
                    const res = await api(`/Shows/NextUp?userId=${server.UserId}&seriesId=${it.Id}&enableResumable=true&Limit=1&Fields=Overview`);
                    nextUp.set(it.Id, (res && res.Items && res.Items[0]) || null);
                } catch {
                    return; // just no Play button
                }
                if (alive && current() === it) {
                    actions = actionsFor(it);
                    drawActions();
                    updateLegend();
                }
            }, 180);
        };

        // ----- actions -----
        const run = (a) => {
            if (!a) return;
            const it = current();
            if (a.id === 'episodes') {
                typeCache.set(it.Id, 'Series');
                fresh.set(it.Id, it); // the show screen can draw its header at once
                nav(detailsHash(it.Id));
                return;
            }
            const target = a.item;
            const start = a.id === 'resume' ? posOf(target) : 0;
            const name = target.Type === 'Episode' ? `${target.SeriesName || ''} ${epCode(target)}`.trim() : target.Name;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${name}`);
            play(target.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        const setZone = (z) => {
            zone = z;
            root.classList.remove('hl-zone-list', 'hl-zone-actions', 'hl-zone-sort');
            root.classList.add('hl-zone-' + z);
            drawActions();
            updateLegend();
        };

        const setSort = (mode) => {
            if (mode === sortMode) return;
            sortMode = mode;
            try { localStorage.setItem(SORT_KEY, mode); } catch { /* per-viewer nicety only */ }
            applyView(null); // a new order starts at its top
        };

        // ----- filter -----
        const searchInput = $('.hl-search-input');
        // typing lands on the first match; clearing returns to the title you were on
        let beforeFilter = null;
        const applyFilter = (text) => {
            const next = lc(text).trim();
            if (next && !query) beforeFilter = current() && current().Id;
            query = next;
            applyView(query ? null : beforeFilter);
        };
        searchInput.addEventListener('input', () => applyFilter(searchInput.value));
        const clearFilter = () => {
            searchInput.value = '';
            applyFilter('');
        };
        const focusSearch = () => {
            if (zone !== 'list') setZone('list');
            searchInput.focus();
            searchInput.select();
        };

        // ----- input -----
        const retry = () => {
            if (status !== 'error') return;
            load();
        };
        shell.setKeys((ev) => {
            const k = ev.key;
            if (ev.target === searchInput) {
                if (k === 'Escape') {
                    stop(ev);
                    if (searchInput.value) clearFilter();
                    else searchInput.blur();
                } else if (k === 'Enter' || k === 'ArrowDown' || k === 'Tab') {
                    stop(ev);
                    searchInput.blur();
                    setZone('list');
                } else {
                    ev.stopPropagation();
                }
                return;
            }
            if (k === '/') {
                stop(ev);
                focusSearch();
                return;
            }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                if (query) clearFilter();
                else goBack('#/home');
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return;
            stop(ev);
            if (status === 'error' && k === 'Enter') return retry();
            if (!view.length || (ev.repeat && k === 'Enter')) return;
            if (zone === 'list') {
                if (k === 'ArrowDown') step(1);
                else if (k === 'ArrowUp') {
                    if (view.indexOf(sel) === 0) setZone('sort');
                    else step(-1);
                } else if (k === 'PageDown') step(8);
                else if (k === 'PageUp') step(-8);
                else if (k === 'Home') step(-view.length);
                else if (k === 'End') step(view.length);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'Enter') run(actions[0]);
            } else if (zone === 'actions') {
                if (k === 'ArrowRight') { act = Math.min(actions.length - 1, act + 1); drawActions(); updateLegend(); }
                else if (k === 'ArrowLeft') {
                    if (act === 0) setZone('list');
                    else { act -= 1; drawActions(); updateLegend(); }
                } else if (k === 'ArrowUp' || k === 'ArrowDown') {
                    setZone('list');
                    step(k === 'ArrowDown' ? 1 : -1);
                } else if (k === 'Enter') run(actions[act]);
            } else if (zone === 'sort') {
                if (k === 'ArrowLeft') setSort('az');
                else if (k === 'ArrowRight') setSort('added');
                else if (k === 'Enter' || k === ' ') setSort(sortMode === 'az' ? 'added' : 'az');
                else if (k === 'ArrowDown') setZone('list');
                else if (k === 'ArrowUp') focusSearch();
            }
        });

        shell.setWheel((ev) => {
            if (rowsView.contains(ev.target) && view.length) scroller.wheel(ev);
        });

        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const r = ev.target.closest('.hl-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) return;
            if (zone !== 'list') setZone('list');
            if (i !== sel) select(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            const r = ev.target.closest('.hl-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) return;
            select(i, { scroll: false });
            run(actions[0]);
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        $('.hl-sort').addEventListener('click', (ev) => {
            const o = ev.target.closest('.hl-sort-opt');
            if (o) setSort(o.dataset.sort);
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const a = item.dataset.action;
            if (a === 'ok') {
                if (status === 'error') retry();
                else if (zone === 'sort') setSort(sortMode === 'az' ? 'added' : 'az');
                else run(zone === 'actions' ? actions[act] : actions[0]);
            } else if (a === 'filter') focusSearch();
            else if (a === 'back') goBack('#/home');
        });

        // ----- data -----
        let alive = true;
        const load = async () => {
            status = 'loading';
            inner.innerHTML = '';
            rows = [];
            view = [];
            sel = -1;
            setState(`<div class="hl-spinner"></div><b>Loading ${nouns}…</b>`);
            shell.renderInfo({ title: '', chips: [], desc: '' });
            $('.hl-count').textContent = '';
            actions = [];
            drawActions();
            updateLegend();
            const fields = 'Overview,Genres,DateCreated,ProductionYear,PremiereDate,EndDate,OfficialRating,CommunityRating,SortName,OriginalTitle' + (isTv ? ',RecursiveItemCount,ChildCount,Status' : '');
            try {
                const [res, lib] = await Promise.all([
                    api(`/Items?userId=${server.UserId}&ParentId=${route.parentId}&IncludeItemTypes=${isTv ? 'Series' : 'Movie'}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Fields=${fields}&EnableImageTypes=Primary,Backdrop,Thumb&ImageTypeLimit=1&EnableTotalRecordCount=false`),
                    api(`/Items/${route.parentId}?userId=${server.UserId}`).catch(() => null)
                ]);
                if (!alive) return;
                if (lib && lib.Name) $('.hl-brand-sub').textContent = lib.Name;
                const items = (res && res.Items) || [];
                remember(items);
                status = 'ready';
                rows = items.map((it) => ({ it, el: makeRow(it) }));
                if (!rows.length) {
                    setState(`<b>No ${nouns} here yet</b><span>Anything added to this library in Jellyfin shows up here.</span>`);
                    $('.hl-count').textContent = `0 ${nouns}`;
                    showEmptyInfo();
                    return;
                }
                setZone('list');
                applyView(saved.id);
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState(`<b>Couldn't load ${nouns}</b><span>Jellyfin didn't answer. Press OK to try again.</span>`);
                shell.renderInfo({ title: `Couldn't load ${nouns}`, chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                updateLegend();
            }
        };
        setZone('list');
        load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                clearTimeout(nextUpTimer);
                shell.teardown();
            }
        };
    };

    // ---------- Details: Series / Season / Episode ----------
    // One screen for all three: season tabs, the season's episodes, and the
    // highlighted episode in the info panel with Play / Resume / Restart.

    const createShow = (server, route, item) => {
        const shell = createShell({ kind: 'show', brand: 'TV SHOWS' });
        const { root, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-info">${TEXT_HTML}${PREVIEW_HTML}</div>
            <div class="hl-panel">
                <div class="hl-tabs-head">
                    <div class="hl-tabs"><div class="hl-tabs-inner"></div></div>
                    <div class="hl-count"></div>
                </div>
                <div class="hl-rows"><div class="hl-rows-inner"></div><div class="hl-state"></div></div>
            </div>`;

        const seriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
        const saved = memory.get(route.key) || {};
        let series = item.Type === 'Series' && item.Name ? item : null;
        let seasons = []; // season items (or one pseudo-season when the show has none)
        let seasonIdx = -1;
        let eps = [];
        let epRows = [];
        let sel = -1;
        let zone = item.Type === 'Episode' ? 'actions' : 'episodes'; // actions | seasons | episodes
        let lastBelow = 'episodes'; // where Down from the buttons goes back to
        let act = 0;
        let actions = [];
        let status = 'loading';
        let alive = true;
        let loadToken = 0;
        const epCache = new Map(); // seasonId -> episodes

        const rowsView = $('.hl-rows');
        const inner = $('.hl-rows-inner');
        const tabsInner = $('.hl-tabs-inner');
        const scroller = makeScroller(rowsView, inner, false, loadNear(inner));
        const tabScroller = makeScroller($('.hl-tabs'), tabsInner, true);
        const moved = hoverTracker();
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };
        const current = () => eps[sel] || null;

        // ----- info -----
        const actionsFor = (ep) => {
            if (!ep) return [];
            if (posOf(ep) > 0) {
                return [{ id: 'resume', icon: 'play_arrow', label: 'Resume' }, { id: 'restart', icon: 'replay', label: 'Restart' }];
            }
            return [{ id: 'play', icon: 'play_arrow', label: 'Play' }];
        };
        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, zone === 'actions');
        };
        const updateLegend = () => {
            const items = [];
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (zone === 'episodes') {
                items.push({ key: '▲▼', label: 'Episodes' }, { key: '▶', label: 'Options' });
                if (actions[0]) items.push({ key: 'OK', label: actions[0].label, action: 'ok' });
            } else if (zone === 'seasons') {
                items.push({ key: '◀▶', label: 'Season' }, { key: '▼', label: 'Episodes' });
            } else {
                items.push({ key: '◀▶', label: 'Options' }, { key: '▼', label: 'Episodes' });
                if (actions[act]) items.push({ key: 'OK', label: actions[act].label, action: 'ok' });
            }
            items.push('spacer', { key: 'ESC', label: 'Back', action: 'back' });
            shell.setLegend(items);
        };

        const showInfo = (ep) => {
            if (!ep) {
                actions = [];
                shell.renderInfo({
                    kicker: series ? `<b>${esc(yearsOf(series))}</b>${esc(series.Name)}` : '',
                    title: series ? series.Name : '',
                    chips: series ? [{ text: series.OfficialRating }, ...(series.Genres || []).slice(0, 3).map((g) => ({ text: g, cls: 'genre' }))] : [],
                    desc: series ? series.Overview : '',
                    art: series ? backdropUrl(series, 900) : null,
                    poster: series ? posterUrl(series, 420) : null
                });
                drawActions();
                updateLegend();
                return;
            }
            const code = epCode(ep);
            const chips = [
                { text: ep.PremiereDate ? fmtDate(ep.PremiereDate) : '' },
                { text: runtime(ep) },
                { text: ep.OfficialRating || (series && series.OfficialRating) }
            ];
            if (ep.CommunityRating) chips.push({ text: `★ ${ep.CommunityRating.toFixed(1)}` });
            let badge = '';
            let barRight = runtime(ep);
            if (posOf(ep) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(ep))} left`;
            } else if (played(ep)) badge = '<span class="hl-chip">Watched</span>';
            else if (isNew(ep)) badge = '<span class="hl-chip hl-chip-new">New</span>';
            shell.renderInfo({
                kicker: `${code ? `<b>${esc(code)}</b>` : ''}${esc(ep.SeriesName || (series && series.Name) || '')}`,
                title: ep.Name,
                chips,
                desc: ep.Overview || '',
                art: stillUrl(ep, 900),
                badge,
                barLeft: endsAt(ep),
                barRight,
                progress: pctOf(ep)
            });
            actions = actionsFor(ep);
            drawActions();
            updateLegend();
        };

        // ----- seasons -----
        const renderTabs = () => {
            tabsInner.innerHTML = seasons.map((s, i) => {
                const n = (s.UserData && s.UserData.UnplayedItemCount) || 0;
                return `<div class="hl-tab" data-i="${i}">${esc(s.Name)}${n ? '<span class="hl-tab-dot"></span>' : ''}</div>`;
            }).join('');
        };
        const markTabs = () => {
            tabsInner.querySelectorAll('.hl-tab').forEach((t, i) => {
                t.classList.toggle('on', i === seasonIdx);
                t.classList.toggle('focus', i === seasonIdx && zone === 'seasons');
            });
            const t = tabsInner.children[seasonIdx];
            if (t) tabScroller.reveal(t.offsetLeft - 40, t.offsetWidth + 80); // clear of the fade at the edge
        };

        const pickEpisode = (list, preferId) => {
            let i = preferId ? list.findIndex((e) => e.Id === preferId) : -1;
            if (i < 0) i = list.findIndex((e) => posOf(e) > 0);
            if (i < 0) i = list.findIndex((e) => !played(e));
            return Math.max(0, i);
        };

        const selectSeason = async (i, preferId) => {
            if (i < 0 || i >= seasons.length) return;
            const changed = i !== seasonIdx;
            seasonIdx = i;
            markTabs();
            if (!changed && eps.length) return;
            const token = ++loadToken;
            const season = seasons[i];
            eps = [];
            epRows = [];
            sel = -1;
            inner.innerHTML = '';
            scroller.reset();
            $('.hl-count').textContent = '';
            let list = epCache.get(season.Id);
            if (!list) {
                setState('<div class="hl-spinner"></div><b>Loading episodes…</b>');
                try {
                    const q = season._all ? '' : `&seasonId=${season.Id}`;
                    const res = await api(`/Shows/${seriesId}/Episodes?userId=${server.UserId}${q}&Fields=Overview,PremiereDate,OfficialRating,CommunityRating&EnableImageTypes=Primary,Thumb,Backdrop&ImageTypeLimit=1`);
                    list = (res && res.Items) || [];
                    epCache.set(season.Id, list);
                    remember(list);
                } catch (err) {
                    console.error('[HOMER Library]', err);
                    if (alive && token === loadToken) {
                        setState('<b>Couldn\'t load these episodes</b><span>Pick the season again to retry.</span>');
                        showInfo(null);
                    }
                    return;
                }
            }
            if (!alive || token !== loadToken) return;
            eps = list;
            const unplayed = eps.filter((e) => !played(e)).length;
            $('.hl-count').textContent = eps.length ? `${plural(eps.length, 'episode')}${unplayed ? ` · ${unplayed} unwatched` : ''}` : '';
            if (!eps.length) {
                setState('<b>No episodes in this season</b>');
                showInfo(null);
                return;
            }
            setState('');
            epRows = eps.map((ep) => {
                const r = makeEpRow(ep);
                inner.appendChild(r);
                return r;
            });
            selectEp(pickEpisode(eps, preferId));
            scroller.refresh(); // load the art for the rows now on screen
        };

        const makeEpRow = (ep) => {
            const r = el('div', 'hl-ep');
            const still = stillUrl(ep, 320);
            const num = ep.IndexNumber != null
                ? `<small>EP</small>${ep.IndexNumber}${ep.IndexNumberEnd && ep.IndexNumberEnd !== ep.IndexNumber ? '–' + ep.IndexNumberEnd : ''}`
                : (ep.PremiereDate ? `<small>${esc(new Date(ep.PremiereDate).toLocaleDateString([], { month: 'short', timeZone: 'UTC' }))}</small>${new Date(ep.PremiereDate).getUTCDate()}` : '<small>EP</small>–');
            const sub = [ep.PremiereDate ? `Aired ${fmtDate(ep.PremiereDate)}` : '', runtime(ep)].filter(Boolean).join(' · ');
            let flag = '<span class="hl-dot" title="Unwatched"></span>';
            if (posOf(ep) > 0) flag = `<span class="hl-left">${fmtMins(minsLeft(ep))} left</span>`;
            else if (played(ep)) flag = '<span class="material-icons hl-check">check</span>';
            r.innerHTML = `
                <div class="hl-ep-num">${num}</div>
                <div class="hl-ep-thumb">${still ? `<img data-src="${esc(still)}" alt="">` : ''}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(ep.Name)}</div><div class="hl-row-sub">${esc(sub)}</div></div>
                <div class="hl-row-flag">${flag}</div>
                ${pctOf(ep) ? `<div class="hl-row-progress"><i style="width:${pctOf(ep)}%"></i></div>` : ''}`;
            if (played(ep)) r.classList.add('played');
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => img.remove();
            }
            return r;
        };

        const selectEp = (i, { scroll = true } = {}) => {
            if (!epRows[i]) return;
            if (epRows[sel]) epRows[sel].classList.remove('sel');
            if (sel !== i) act = 0;
            sel = i;
            epRows[i].classList.add('sel');
            if (scroll) scroller.reveal(epRows[i].offsetTop - 8, epRows[i].offsetHeight + 16);
            memory.set(route.key, { seasonId: seasons[seasonIdx] && seasons[seasonIdx].Id, epId: eps[i].Id });
            showInfo(eps[i]);
        };

        const setZone = (z) => {
            if (z !== 'actions') lastBelow = z;
            zone = z;
            root.classList.remove('hl-zone-actions', 'hl-zone-seasons', 'hl-zone-episodes');
            root.classList.add('hl-zone-' + z);
            markTabs();
            drawActions();
            updateLegend();
        };

        // ----- actions -----
        const run = (a) => {
            const ep = current();
            if (!a || !ep) return;
            const start = a.id === 'resume' ? posOf(ep) : 0;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${epCode(ep) || ep.Name}`);
            play(ep.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        // ----- input -----
        shell.setKeys((ev) => {
            const k = ev.key;
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                goBack(item.Type === 'Series' ? '#/home' : detailsHash(seriesId));
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return;
            stop(ev);
            if (status === 'error') {
                if (k === 'Enter') load();
                return;
            }
            if (status !== 'ready' || (ev.repeat && k === 'Enter')) return;
            if (zone === 'episodes') {
                if (k === 'ArrowDown') selectEp(Math.min(eps.length - 1, sel + 1));
                else if (k === 'ArrowUp') {
                    if (sel <= 0) setZone('seasons');
                    else selectEp(sel - 1);
                } else if (k === 'PageDown') selectEp(Math.min(eps.length - 1, sel + 4));
                else if (k === 'PageUp') selectEp(Math.max(0, sel - 4));
                else if (k === 'Home') selectEp(0);
                else if (k === 'End') selectEp(eps.length - 1);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'Enter') run(actions[0]);
            } else if (zone === 'seasons') {
                if (k === 'ArrowLeft') selectSeason(seasonIdx - 1);
                else if (k === 'ArrowRight') selectSeason(seasonIdx + 1);
                else if ((k === 'ArrowDown' || k === 'Enter') && eps.length) setZone('episodes');
                else if (k === 'ArrowUp' && actions.length) setZone('actions');
            } else if (zone === 'actions') {
                if (k === 'ArrowRight') { act = Math.min(actions.length - 1, act + 1); drawActions(); updateLegend(); }
                else if (k === 'ArrowLeft') {
                    if (act > 0) { act -= 1; drawActions(); updateLegend(); }
                    else if (eps.length) setZone('episodes');
                } else if (k === 'ArrowDown') setZone(lastBelow === 'seasons' || !eps.length ? 'seasons' : 'episodes');
                else if (k === 'Enter') run(actions[act]);
            }
        });

        shell.setWheel((ev) => {
            if (rowsView.contains(ev.target) && eps.length) scroller.wheel(ev);
            else if ($('.hl-tabs').contains(ev.target)) tabScroller.wheel(ev);
        });

        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const i = epRows.indexOf(ev.target.closest('.hl-ep'));
            if (i < 0) return;
            if (zone !== 'episodes') setZone('episodes');
            if (i !== sel) selectEp(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            const i = epRows.indexOf(ev.target.closest('.hl-ep'));
            if (i < 0) return;
            selectEp(i, { scroll: false });
            run(actions[0]);
        });
        tabsInner.addEventListener('click', (ev) => {
            const t = ev.target.closest('.hl-tab');
            if (!t) return;
            setZone('seasons');
            selectSeason(Number(t.dataset.i));
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            const itemEl = ev.target.closest('[data-action]');
            if (!itemEl) return;
            const a = itemEl.dataset.action;
            if (a === 'ok') {
                if (status === 'error') load();
                else run(zone === 'actions' ? actions[act] : actions[0]);
            } else if (a === 'back') goBack(item.Type === 'Series' ? '#/home' : detailsHash(seriesId));
        });

        // ----- data -----
        const load = async () => {
            status = 'loading';
            seasonIdx = -1;
            eps = [];
            epRows = [];
            inner.innerHTML = '';
            tabsInner.innerHTML = '';
            setState('<div class="hl-spinner"></div><b>Loading episodes…</b>');
            shell.renderInfo({ title: item.Type === 'Series' ? item.Name : (item.SeriesName || ''), chips: [], desc: '' });
            updateLegend();
            try {
                const [s, seasonRes, nu] = await Promise.all([
                    series ? Promise.resolve(series) : api(`/Items/${seriesId}?userId=${server.UserId}`),
                    api(`/Shows/${seriesId}/Seasons?userId=${server.UserId}&Fields=Overview`),
                    item.Type === 'Series' && !saved.epId
                        ? api(`/Shows/NextUp?userId=${server.UserId}&seriesId=${seriesId}&enableResumable=true&Limit=1`).catch(() => null)
                        : Promise.resolve(null)
                ]);
                if (!alive) return;
                series = s;
                remember([s]);
                shell.setAmbient(backdropUrl(s, 1280));
                seasons = (seasonRes && seasonRes.Items) || [];
                remember(seasons);
                if (!seasons.length) seasons = [{ Id: 'all', Name: 'Episodes', _all: true }];
                status = 'ready';
                renderTabs();
                const next = nu && nu.Items && nu.Items[0];
                let seasonId = saved.seasonId;
                let preferId = saved.epId;
                if (!seasonId) {
                    if (item.Type === 'Episode') { seasonId = item.SeasonId; preferId = item.Id; }
                    else if (item.Type === 'Season') seasonId = item.Id;
                    else if (next) { seasonId = next.SeasonId; preferId = next.Id; }
                    else {
                        const firstUnplayed = seasons.find((x) => x.UserData && x.UserData.UnplayedItemCount && x.IndexNumber !== 0);
                        seasonId = (firstUnplayed || seasons.find((x) => x.IndexNumber !== 0) || seasons[0]).Id;
                    }
                }
                const idx = Math.max(0, seasons.findIndex((x) => x.Id === seasonId));
                setZone(zone);
                await selectSeason(idx, preferId);
                if (alive && !eps.length && zone !== 'seasons') setZone('seasons');
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState('<b>Couldn\'t load this show</b><span>Jellyfin didn\'t answer. Press OK to try again.</span>');
                shell.renderInfo({ title: 'Couldn\'t load this show', chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                updateLegend();
            }
        };
        setZone(zone);
        load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                shell.teardown();
            }
        };
    };

    // ---------- Details: Movie ----------

    const createMovie = (server, route, item) => {
        const shell = createShell({ kind: 'movie', brand: 'MOVIES' });
        const { root, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-info">${TEXT_HTML}${PREVIEW_HTML}</div>
            <div class="hl-panel">
                <div class="hl-tabs-head"><div class="hl-panel-label"><b>ABOUT</b></div><div class="hl-count"></div></div>
                <div class="hl-facts"></div>
                <div class="hl-state"></div>
            </div>`;
        root.classList.add('hl-zone-actions');
        let it = item;
        let act = 0;
        let actions = [];
        let status = 'loading';
        let alive = true;
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, true);
            shell.setLegend([
                ...(status === 'error' ? [{ key: 'OK', label: 'Try again', action: 'ok' }] : [
                    { key: '◀▶', label: 'Options' },
                    ...(actions[act] ? [{ key: 'OK', label: actions[act].label, action: 'ok' }] : [])
                ]),
                'spacer',
                { key: 'ESC', label: 'Back', action: 'back' }
            ]);
        };

        const facts = (m) => {
            const people = m.People || [];
            const names = (type, n) => people.filter((p) => p.Type === type).slice(0, n).map((p) => p.Name).join(', ');
            const src = (m.MediaSources || [])[0];
            const streams = (src && src.MediaStreams) || [];
            const v = streams.find((s) => s.Type === 'Video');
            const audio = streams.filter((s) => s.Type === 'Audio');
            const mainAudio = audio.find((s) => s.IsDefault) || audio[0];
            const subs = [...new Set(streams.filter((s) => s.Type === 'Subtitle').map((s) => langName(s.Language) || s.Title || s.DisplayTitle).filter(Boolean))];
            const res = v && v.Height ? (v.Width >= 3200 || v.Height >= 2000 ? '4K' : `${v.Height}p`) : '';
            return [
                ['Directed by', names('Director', 3)],
                ['Written by', names('Writer', 3)],
                ['Starring', names('Actor', 6)],
                ['Studio', (m.Studios || []).slice(0, 3).map((s) => s.Name).join(', ')],
                ['Video', v ? [res, (v.Codec || '').toUpperCase(), v.VideoRangeType && v.VideoRangeType !== 'Unknown' ? v.VideoRangeType : v.VideoRange].filter(Boolean).join(' · ') : ''],
                ['Audio', mainAudio ? [langName(mainAudio.Language), mainAudio.ChannelLayout, (mainAudio.Codec || '').toUpperCase()].filter(Boolean).join(' · ') + (audio.length > 1 ? `  +${audio.length - 1} more` : '') : ''],
                ['Subtitles', subs.slice(0, 6).join(', ') + (subs.length > 6 ? ` +${subs.length - 6} more` : '')]
            ].filter((f) => f[1]);
        };

        const render = () => {
            const chips = [
                { text: it.ProductionYear ? String(it.ProductionYear) : '' },
                { text: it.OfficialRating },
                { text: runtime(it) }
            ];
            if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
            for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });
            let badge = '';
            let barRight = runtime(it);
            if (posOf(it) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(it))} left`;
            } else if (played(it)) badge = '<span class="hl-chip">Watched</span>';
            else if (isNew(it)) badge = '<span class="hl-chip hl-chip-new">New</span>';
            shell.renderInfo({
                kicker: (it.Taglines && it.Taglines[0]) ? `<i>${esc(it.Taglines[0])}</i>` : '',
                title: it.Name,
                chips,
                desc: it.Overview || '',
                art: backdropUrl(it, 1280),
                poster: posterUrl(it, 420),
                badge,
                barLeft: endsAt(it),
                barRight,
                progress: pctOf(it)
            });
            shell.setAmbient(backdropUrl(it, 1280));
            actions = posOf(it) > 0
                ? [{ id: 'resume', icon: 'play_arrow', label: 'Resume' }, { id: 'restart', icon: 'replay', label: 'Restart' }]
                : [{ id: 'play', icon: 'play_arrow', label: 'Play' }];
            drawActions();
            const rows = facts(it);
            $('.hl-facts').innerHTML = rows.map(([k, v]) => `<div class="hl-fact"><div class="hl-fact-k">${esc(k)}</div><div class="hl-fact-v">${esc(v)}</div></div>`).join('');
            setState(rows.length ? '' : '<b>No cast or media details for this movie</b>');
        };

        const run = (a) => {
            if (!a || status !== 'ready') return;
            const start = a.id === 'resume' ? posOf(it) : 0;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${it.Name}`);
            play(it.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        shell.setKeys((ev) => {
            const k = ev.key;
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                goBack('#/home');
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(k)) return;
            stop(ev);
            if (status === 'error') {
                if (k === 'Enter') load();
                return;
            }
            if (ev.repeat && k === 'Enter') return;
            if (k === 'ArrowRight') act = Math.min(actions.length - 1, act + 1);
            else if (k === 'ArrowLeft') act = Math.max(0, act - 1);
            else if (k === 'Enter') return run(actions[act]);
            drawActions();
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b || Number(b.dataset.i) === act) return;
            act = Number(b.dataset.i);
            drawActions();
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            const itemEl = ev.target.closest('[data-action]');
            if (!itemEl) return;
            if (itemEl.dataset.action === 'ok') {
                if (status === 'error') load();
                else run(actions[act]);
            } else if (itemEl.dataset.action === 'back') goBack('#/home');
        });

        const load = async () => {
            status = 'loading';
            setState('<div class="hl-spinner"></div><b>Loading…</b>');
            try {
                const full = await api(`/Items/${item.Id}?userId=${server.UserId}`);
                if (!alive) return;
                it = full;
                status = 'ready';
                render();
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState('<b>Couldn\'t load this movie</b><span>Jellyfin didn\'t answer. Press OK to try again.</span>');
                shell.renderInfo({ title: 'Couldn\'t load this movie', chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                drawActions();
            }
        };
        // the route lookup already fetched the full item; draw it at once
        if (item.People || item.MediaSources) {
            status = 'ready';
            render();
        } else load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                shell.teardown();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null; // the open screen, or null
    let suppressedKey = null; // closed via close(); stay out of the way until the route changes
    let lookup = null; // details id being looked up
    const fresh = new Map(); // id -> full item fetched by the route lookup (used once)

    const parseRoute = (hash = currentRoute()) => {
        const m = (hash || '').match(/^#!?\/([a-z]+)(?:\.html)?(?:\?(.*))?$/i);
        if (!m) return null;
        const page = m[1].toLowerCase();
        const q = new URLSearchParams(m[2] || '');
        if ((page === 'movies' || page === 'tv') && q.get('topParentId')) {
            const tab = q.get('tab');
            if (tab && tab !== '0') return null; // Suggestions, Genres, … stay Jellyfin's
            return { kind: 'library', collection: page === 'movies' ? 'movies' : 'tvshows', parentId: q.get('topParentId'), key: 'lib:' + q.get('topParentId') };
        }
        if (page === 'details' && q.get('id')) return { kind: 'details', id: q.get('id'), key: 'det:' + q.get('id') };
        return null;
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const openScreen = (route, server) => {
        let s;
        if (route.kind === 'library') s = createLibrary(server, route);
        else {
            const item = fresh.get(route.id) || { Id: route.id, Type: typeCache.get(route.id) };
            fresh.delete(route.id);
            if (item.Type === 'Movie') s = createMovie(server, route, item);
            else if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode') {
                if (item.Type !== 'Series' && !item.SeriesId) {
                    // need the parent show; look it up first
                    typeCache.delete(route.id);
                    sync();
                    return;
                }
                s = createShow(server, route, item);
            } else return;
        }
        if (destroyed) return s.teardown();
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    let destroyed = false;
    const sync = () => {
        if (destroyed) return;
        const route = parseRoute();
        const server = getServer();
        if (!route || route.key !== suppressedKey) suppressedKey = null;
        if (!route || !server || suppressedKey) {
            closeScreen();
            return;
        }
        if (screen && screen.key === route.key) return;
        if (route.kind === 'details') {
            const known = fresh.get(route.id);
            const type = known ? known.Type : typeCache.get(route.id);
            if (type && !SUPPORTED.has(type)) {
                closeScreen(); // people, channels, collections, …: Jellyfin's page
                if (docked()) P().leave(currentRoute()); // (which means leaving the player)
                return;
            }
            // Seasons/episodes need their show's id, so fetch the item itself.
            if (!type || (!known && (type === 'Season' || type === 'Episode'))) {
                closeScreen();
                if (lookup === route.id) return;
                lookup = route.id;
                api(`/Items/${route.id}?userId=${server.UserId}`).then((it) => {
                    typeCache.set(route.id, it.Type);
                    if (SUPPORTED.has(it.Type)) fresh.set(route.id, it);
                }).catch(() => {
                    typeCache.set(route.id, 'Unknown');
                }).finally(() => {
                    lookup = null;
                    sync();
                });
                return;
            }
        }
        closeScreen();
        openScreen(route, server);
    };

    let lastHref = '';
    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued) return;
        syncQueued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            const here = location.href + '|' + currentRoute();
            if (here === lastHref && (screen || !parseRoute())) return;
            lastHref = here;
            sync();
        }, 50);
    };
    const onRouteChange = () => {
        lastHref = '';
        queueSync();
    };

    let observer = null;
    const start = () => {
        // Jellyfin's router uses pushState, which fires no event; watch the DOM
        // (it re-renders on every navigation) and check the address.
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    // docking, Back and Home change the route without changing the address
    let offPlayer = null;
    const hookPlayer = () => {
        if (offPlayer || !P()) return;
        offPlayer = P().onChange(() => {
            onRouteChange();
            if (screen && screen.refreshLegend) screen.refreshLegend();
        });
    };
    hookPlayer();
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerLibrary = {
        version: VERSION,
        // open(): take over the current route if it's a library/details page;
        // open('#/movies?topParentId=…'): go there (and take it over).
        open(route) {
            suppressedKey = null;
            if (typeof route === 'string' && route && currentRoute() !== route) {
                nav(route.startsWith('#') ? route : '#' + route);
                return;
            }
            lastHref = '';
            sync();
        },
        // close(): reveal Jellyfin's own page until the route changes
        close() {
            if (!screen) return;
            suppressedKey = screen.key;
            closeScreen();
        },
        destroy() {
            destroyed = true;
            closeScreen();
            observer && observer.disconnect();
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            if (offPlayer) offPlayer();
            document.getElementById('hl-css')?.remove();
            cssReady = null;
        }
    };
})();
