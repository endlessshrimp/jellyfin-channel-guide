/*
 * HOMER Search for Jellyfin Web: search results as a full-screen set-top-box
 * screen on the same stage as the guide, Home and the library screens.
 *
 * Takes over Jellyfin's search route while it's showing (Jellyfin's own page
 * stays underneath, untouched):
 *   #/search?query=…   results for the query
 *   #/search           an empty screen with the search box ready to type in
 *
 * Results are grouped Movies, TV Shows, Episodes, Channels and On TV (every
 * airing in the guide, on now or still to come, recordable from here), in a
 * list on the left with the highlighted result's art, details and actions on
 * the right. Movies, shows and episodes open their HOMER details screen;
 * channels and programs play the channel.
 *
 * Then "Get it": shows and movies Sonarr and Radarr can get that aren't in the
 * library (shared/arr.js, window.HomerArr). It's looked up once typing has
 * settled and joins the list when it answers, without holding up the rest.
 * A library show that Sonarr isn't getting new episodes of offers that too.
 * Getting something takes a second press (OK, or E for new episodes).
 *
 * Remote/keyboard: arrows move, OK/Enter acts, E gets new episodes of a show,
 * / edits the search, Esc/Back goes back, H goes Home.
 *
 * On a phone (shared/layout.js) the screen is search/search-phone.js instead,
 * drawn from the same search, cache and Back memory (see createPhone).
 *
 * window.HomerSearch = { open(route), close, phoneTap, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerSearch && typeof window.HomerSearch.destroy === 'function') {
        window.HomerSearch.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="search.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/search\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'search/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // same layer as the other HOMER screens, under the guide
    const TICKS_PER_MIN = 600000000;
    const CONFIRM_MS = 4000; // a cancel waits this long for its second press
    const DEBOUNCE_MS = 280;
    const CACHE_MS = 60000;
    // the guide's "no listings" filler, e.g. "TF1 (FR) (Sa. 18:00 - 00:00)"
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;

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

    const api = async (path, signal) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, { headers: { Authorization: authHeader(server) }, signal });
        if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
    const fmtMins = (mins) => {
        mins = Math.max(1, Math.round(mins));
        const h = Math.floor(mins / 60);
        return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
    };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const runtime = (it) => (it.RunTimeTicks > 0 ? fmtMins(it.RunTimeTicks / TICKS_PER_MIN) : '');
    const posOf = (it) => (it && it.UserData && it.UserData.PlaybackPositionTicks) || 0;
    const played = (it) => !!(it && it.UserData && it.UserData.Played);
    const pctOf = (it) => {
        const pos = posOf(it);
        if (!pos || !(it.RunTimeTicks > 0)) return 0;
        return clamp((pos / it.RunTimeTicks) * 100, 1, 100);
    };
    const minsLeft = (it) => (it.RunTimeTicks > 0 ? (it.RunTimeTicks - posOf(it)) / TICKS_PER_MIN : 0);
    const isNew = (it) => it.DateCreated && Date.now() - new Date(it.DateCreated) < 14 * 86400000;
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
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const guideUp = () => !!document.getElementById('cg-root');

    // ---------- Live TV timing ----------

    const startOf = (p) => new Date(p.StartDate).getTime();
    const endOf = (p) => new Date(p.EndDate).getTime();
    const airing = (p, now = Date.now()) => !!p && startOf(p) <= now && endOf(p) > now;
    const elapsedPct = (p) => clamp(((Date.now() - startOf(p)) / (endOf(p) - startOf(p))) * 100, 0, 100);
    const slot = (p) => `${fmtTime(new Date(startOf(p)))}–${fmtTime(new Date(endOf(p)))}`;
    // "In 25m", then "Tonight", "Tomorrow", "Wed" (the row already shows the
    // time): On TV reaches as far as the guide does
    const dayWord = (t) => {
        const d = new Date(t);
        const now = new Date();
        const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate())
            - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
        if (days <= 0) return d.getHours() >= 17 ? 'Tonight' : 'Today';
        if (days === 1) return 'Tomorrow';
        return d.toLocaleDateString([], { weekday: 'short' });
    };
    const startsLabel = (p) => {
        const mins = Math.round((startOf(p) - Date.now()) / 60000);
        if (mins < 1) return 'Starting';
        if (mins < 60) return `In ${mins}m`;
        return dayWord(startOf(p));
    };
    const chNum = (x) => x.ChannelNumber || x.Number || '';

    // When a search finds nothing still to come in the guide, On TV says so:
    // "Not on TV through Wednesday", or "Not on TV again through Wednesday"
    // with when it was last on.
    const dayDiff = (t) => {
        const d = new Date(t);
        const now = new Date();
        return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate())
            - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    };
    const throughWord = (t) => {
        const last = t - 60000; // listings that end at midnight end the day before
        const days = dayDiff(last);
        if (days <= 0) return new Date(last).getHours() >= 17 ? 'tonight' : 'today';
        if (days === 1) return 'tomorrow';
        return new Date(last).toLocaleDateString([], { weekday: 'long' });
    };
    const agoWord = (t) => {
        const days = dayDiff(t);
        if (days === 0) return 'today';
        if (days === -1) return 'yesterday';
        return new Date(t).toLocaleDateString([], { weekday: 'long' });
    };
    const tvNote = (list) => {
        const g = (list || []).find((x) => x.key === 'programs');
        if (!g || g.failed || g.items.length) return null;
        const through = g.reach ? ` through ${throughWord(g.reach)}` : ' in the guide';
        const last = g.last || [];
        if (!last.length) return { text: `Not on TV${through}`, sub: '' };
        const names = [...new Set(last.map((p) => p.ChannelName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const on = names.length > 2 ? `${names[0]} and ${names.length - 1} more` : names.join(' and ');
        const at = new Date(startOf(last[0]));
        return { text: `Not on TV again${through}`, sub: `Last on ${on ? on + ', ' : ''}${agoWord(at)} at ${fmtTime(at)}` };
    };

    // ---------- Images ----------

    const imgUrl = (id, type, tag, q) => `/Items/${id}/Images/${type}?${q}${tag ? '&tag=' + encodeURIComponent(tag) : ''}`;
    const posterUrl = (it, h = 180) => (it.ImageTags && it.ImageTags.Primary ? imgUrl(it.Id, 'Primary', it.ImageTags.Primary, `fillHeight=${h}&quality=90`) : null);
    const backdropUrl = (it, w = 1280) => {
        if (it.BackdropImageTags && it.BackdropImageTags.length) return imgUrl(it.Id, 'Backdrop/0', it.BackdropImageTags[0], `maxWidth=${w}&quality=85`);
        if (it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length) {
            return imgUrl(it.ParentBackdropItemId, 'Backdrop/0', it.ParentBackdropImageTags[0], `maxWidth=${w}&quality=85`);
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
    // A channel's logo, in its own colors. Programs don't carry their channel's
    // image tag, so theirs is fetched by channel id (as Home does).
    const logoUrl = (x) => {
        if (x.Type === 'TvChannel') return x.ImageTags && x.ImageTags.Primary ? imgUrl(x.Id, 'Primary', x.ImageTags.Primary, 'maxHeight=120') : null;
        return x.ChannelId ? imgUrl(x.ChannelId, 'Primary', null, 'maxHeight=120') : null;
    };
    const programArt = (p, w = 900) => (p && p.ImageTags && p.ImageTags.Primary ? imgUrl(p.Id, 'Primary', p.ImageTags.Primary, `maxWidth=${w}&quality=85`) : null);

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
        // and the screen shell every TV screen shares, ahead of this screen's own
        if (!document.getElementById('homer-shell')) {
            const s = document.createElement('link');
            s.id = 'homer-shell';
            s.rel = 'stylesheet';
            s.href = BASE + '../shared/shell.css' + QUERY;
            document.head.appendChild(s);
        }
        if (cssReady && document.getElementById('hs-css')) return cssReady;
        // both layouts' stylesheets (the phone one is scoped to .hs-phone)
        const link = (id, file) => new Promise((resolve) => {
            document.getElementById(id)?.remove();
            const css = document.createElement('link');
            css.id = id;
            css.rel = 'stylesheet';
            css.href = BASE + file + QUERY;
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
            document.head.appendChild(css);
        });
        cssReady = Promise.all([link('hs-css', 'search.css'), link('hs-phone-css', 'search-phone.css')]);
        return cssReady;
    };

    // The phone layout comes from homer.js, just after this file; used on its
    // own, Search loads it itself. It registers with shared/layout.js when it
    // has loaded, and a search that's already up switches over then.
    if (!window.HomerSearchPhone && !document.querySelector('script[src*="search/search-phone.js"]')) {
        const s = document.createElement('script');
        s.src = BASE + 'search-phone.js' + QUERY;
        document.head.appendChild(s);
    }
    const phoneLayout = () => !!(window.HomerLayout && window.HomerSearchPhone && window.HomerLayout.usePhone('search'));

    // ---------- Navigation and playback (through HomerPlayer when it's loaded) ----------
    // While a video plays docked in a preview window, HOMER screens sit on top of
    // Jellyfin's #/video page and navigate virtually; HomerPlayer knows the real
    // route then, and location.hash doesn't.

    const player = () => window.HomerPlayer || null;
    const call = (fn, ...args) => {
        const p = player();
        if (!p || typeof p[fn] !== 'function') return undefined;
        try {
            return p[fn](...args);
        } catch (err) {
            console.warn('[HOMER Search] HomerPlayer.' + fn + ' failed:', err);
            return undefined;
        }
    };
    const currentHash = () => {
        const r = call('route');
        if (typeof r === 'string') return r.startsWith('#') ? r : '#' + r.replace(/^\/?/, '/');
        return location.hash;
    };
    const go = (hash) => {
        const p = player();
        if (p && typeof p.go === 'function') call('go', hash);
        else location.hash = hash;
    };
    // Back, like a remote: the previous screen, or Home when this was the first
    // page in the tab.
    const goBack = () => {
        if (call('docked') === true && typeof player().back === 'function') {
            call('back');
            return;
        }
        if (history.length <= 1) {
            go('#/home');
            return;
        }
        const before = location.href;
        history.back();
        setTimeout(() => {
            if (location.href === before && !destroyed) go('#/home');
        }, 400);
    };
    const goHome = () => {
        const p = player();
        if (p && typeof p.goHome === 'function') call('goHome');
        else if (window.HomerHome && typeof window.HomerHome.goHome === 'function') window.HomerHome.goHome();
        else location.hash = '#/home';
    };
    const detailsHash = (id) => {
        const server = getServer();
        return `#/details?id=${id}${server && server.Id ? '&serverId=' + server.Id : ''}`;
    };
    // Plays in the current screen's preview window through HomerPlayer; without
    // it, Jellyfin Web's own remote-control handler plays it full screen.
    const watchChannel = (channelId, program) => {
        const p = player();
        if (p && typeof p.watch === 'function') {
            p.watch(channelId, { program });
            return;
        }
        const ac = window.ApiClient;
        if (!ac || typeof ac.handleMessageReceived !== 'function') throw new Error('Jellyfin Web player not available');
        ac.handleMessageReceived({ MessageType: 'Play', Data: { PlayCommand: 'PlayNow', ItemIds: [channelId] } });
    };

    // ---------- Pixel scrolling ----------
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
            reset() { set(0, false); },
            refresh() { set(pos, false); },
            pos: () => pos,
            to(p) { set(p, false); },
            reveal(start, size, animate = true) {
                if (start < pos) set(start, animate);
                else if (start + size > pos + viewSize()) set(start + size - viewSize(), animate);
            },
            wheel(ev) {
                const d = horizontal ? (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) : ev.deltaY;
                const px = ev.deltaMode === 1 ? d * 40 : ev.deltaMode === 2 ? d * viewSize() : d;
                set(pos + px, false);
            }
        };
    };

    // Row art loads for what's on screen plus a screen either side. (Native lazy
    // loading can't see these rows: they move by transform inside a clipped box.)
    const loadNear = (inner) => (pos, size) => {
        for (const img of inner.querySelectorAll('img[data-src]')) {
            const row = img.closest('.hs-row');
            if (!row) continue;
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

    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const stop = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    };

    // ---------- Result groups ----------

    const GROUPS = [
        { key: 'movies', label: 'Movies', types: 'Movie', limit: 60 },
        { key: 'series', label: 'TV Shows', types: 'Series', limit: 60 },
        { key: 'episodes', label: 'Episodes', types: 'Episode', limit: 100 },
        { key: 'channels', label: 'Channels', types: 'TvChannel', limit: 60, live: true },
        { key: 'programs', label: 'On TV', types: 'LiveTvProgram', limit: 1000, live: true, show: 100 }
    ];
    // a library's search button scopes the search to that kind of library
    const groupsFor = (collectionType) => {
        const ct = String(collectionType || '').toLowerCase();
        if (ct === 'movies') return GROUPS.filter((g) => g.key === 'movies');
        if (ct === 'tvshows') return GROUPS.filter((g) => g.key === 'series' || g.key === 'episodes');
        if (ct === 'livetv') return GROUPS.filter((g) => g.live);
        return GROUPS;
    };

    // Search results remembered for a minute, so Back and backspacing are instant.
    const cache = new Map(); // key -> { at, groups }
    const cacheGet = (key) => {
        const hit = cache.get(key);
        return hit && Date.now() - hit.at < CACHE_MS ? hit.groups : null;
    };
    const cachePut = (key, groups) => {
        cache.set(key, { at: Date.now(), groups });
        while (cache.size > 24) cache.delete(cache.keys().next().value);
    };

    // How far the guide reaches: when a sample of channels' listings run out
    // (the middle one: a few run a day longer or shorter). Kept half an hour.
    let reachCache = null; // { at, t }
    const guideReach = async (server, signal) => {
        if (reachCache && Date.now() - reachCache.at < 30 * 60000) return reachCache.t;
        const uid = server.UserId;
        const chans = ((await api(`/LiveTv/Channels?userId=${uid}&EnableImages=false&Limit=1000`, signal)) || {}).Items || [];
        const step = Math.max(1, Math.floor(chans.length / 10));
        const sample = chans.filter((c, i) => i % step === 0).slice(0, 10);
        const ends = (await Promise.all(sample.map((c) => api(`/LiveTv/Programs?UserId=${uid}&ChannelIds=${c.Id}&SortBy=StartDate&SortOrder=Descending&Limit=1&EnableImages=false`, signal)
            .then((r) => { const p = r && r.Items && r.Items[0]; return p && p.EndDate ? endOf(p) : 0; })
            .catch(() => 0))))
            .filter((t) => t > Date.now())
            .sort((a, b) => a - b);
        const t = ends.length ? ends[Math.floor(ends.length / 2)] : 0;
        if (t) reachCache = { at: Date.now(), t };
        return t;
    };

    const fetchResults = async (server, route, q, signal) => {
        const uid = server.UserId;
        const term = encodeURIComponent(q);
        const scope = route.parentId ? `&ParentId=${encodeURIComponent(route.parentId)}` : '';
        const vodFields = 'Overview,PrimaryImageAspectRatio,Genres,OfficialRating,ProductionYear,PremiereDate,EndDate,Status,ChildCount,DateCreated,Taglines,ProviderIds';
        const url = (g) => {
            if (g.key === 'channels') return `/Items?userId=${uid}&searchTerm=${term}&IncludeItemTypes=TvChannel&Recursive=true&Fields=Overview&EnableImageTypes=Primary&ImageTypeLimit=1&Limit=${g.limit}`;
            // The server ignores start/end filters on search, so the whole match
            // list comes back: what's on now and every airing still to come.
            if (g.key === 'programs') return `/Items?userId=${uid}&searchTerm=${term}&IncludeItemTypes=LiveTvProgram&Recursive=true&Fields=ChannelInfo,Overview&EnableImages=true&ImageTypeLimit=1&Limit=${g.limit}`;
            return `/Items?userId=${uid}&searchTerm=${term}&IncludeItemTypes=${g.types}&Recursive=true${scope}&Fields=${vodFields}&EnableImageTypes=Primary,Backdrop,Thumb&ImageTypeLimit=1&Limit=${g.limit}`;
        };
        const wanted = groupsFor(route.collectionType);
        const reachP = wanted.some((g) => g.key === 'programs') ? guideReach(server, signal).catch(() => 0) : Promise.resolve(0);
        let failed = 0;
        const lists = await Promise.all(wanted.map((g) => api(url(g), signal).then((res) => res || {}).catch((err) => {
            if (signal.aborted) throw err;
            console.warn('[HOMER Search]', g.key, err);
            failed += 1;
            return null;
        })));
        if (failed === wanted.length) throw new Error('Search failed');
        const reach = await reachP;
        const now = Date.now();
        return wanted.map((g, i) => {
            const res = lists[i];
            let items = (res && res.Items) || [];
            let more = !!(res && res.TotalRecordCount > items.length);
            if (g.key === 'channels') {
                items = items.slice().sort((a, b) => (parseFloat(chNum(a)) || 1e9) - (parseFloat(chNum(b)) || 1e9) || String(a.Name).localeCompare(String(b.Name)));
            } else if (g.key === 'programs') {
                const real = items.filter((p) => p.StartDate && p.EndDate && !PLACEHOLDER.test(p.Name || ''));
                // the last time it was on (every channel it was on then), for "Not on TV again"
                const past = real.filter((p) => endOf(p) <= now);
                const lastAt = past.reduce((m, p) => Math.max(m, startOf(p)), 0);
                items = real
                    .filter((p) => endOf(p) > now)
                    .sort((a, b) => (airing(b, now) - airing(a, now)) || startOf(a) - startOf(b) || (parseFloat(chNum(a)) || 1e9) - (parseFloat(chNum(b)) || 1e9));
                more = items.length > g.show;
                items = items.slice(0, g.show);
                return { key: g.key, label: g.label, items, more, failed: !res, reach, last: past.filter((p) => startOf(p) === lastAt) };
            }
            return { key: g.key, label: g.label, items, more, failed: !res };
        });
    };

    // ---------- Get it (Sonarr and Radarr, through shared/arr.js) ----------

    const ARR_SETTLE_MS = 650; // the arrs are asked once typing has stopped this long
    const arr = () => window.HomerArr || null;
    // what a search may offer to get: a library's search button scopes it
    const arrKinds = (route) => {
        const ct = String(route.collectionType || '').toLowerCase();
        if (ct === 'movies') return ['movie'];
        if (ct === 'tvshows') return ['show'];
        if (ct === 'livetv') return [];
        return ['show', 'movie'];
    };
    // A library show's Tvdb id, for asking Sonarr about it
    const tvdbOf = (it) => (it && it.Type === 'Series' && it.ProviderIds && it.ProviderIds.Tvdb ? Number(it.ProviderIds.Tvdb) : 0);
    // The "Get it" group for a search's results: what Sonarr and Radarr have that
    // the library doesn't. Shows found On TV that aren't in the library are
    // looked up by their own name too (Sonarr's search can miss them for a
    // loose term), and lead the group.
    const arrGroup = async (route, q, list, signal) => {
        const A = arr();
        const kinds = arrKinds(route);
        if (!A || !kinds.length) return null;
        const library = [];
        for (const g of list || []) if (g.key === 'movies' || g.key === 'series') library.push(...g.items);
        const libShows = new Set(library.filter((it) => it.Type === 'Series').map((it) => A.norm(it.Name)));
        const onTv = new Map(); // norm(name) -> { name, n, movie }
        for (const g of list || []) {
            if (g.key !== 'programs') continue;
            for (const p of g.items) {
                if (!p.Name || p.IsSports || p.IsNews || PLACEHOLDER.test(p.Name)) continue;
                const k = A.norm(p.Name);
                if (!k || libShows.has(k)) continue;
                onTv.set(k, { name: p.Name, n: ((onTv.get(k) || {}).n || 0) + 1, movie: !!p.IsMovie, year: p.IsMovie ? p.ProductionYear : 0 });
            }
        }
        const byCount = [...onTv.values()].sort((a, b) => b.n - a.n);
        // shows on TV are looked up by name; movies on TV (by name and year) only lead
        const titles = byCount.filter((t) => !t.movie).map((t) => t.name);
        const prefer = byCount.filter((t) => t.movie).map((t) => ({ title: t.name, kind: 'movie', year: t.year }));
        const res = await A.getIt(q, { library, titles, prefer, signal });
        const items = res.items.filter((v) => kinds.includes(v.kind));
        return { key: 'arr', label: 'Get it', items, more: res.more };
    };

    // ---------- The screen ----------

    // Where Back lands: the search as you left it for a result (the query you'd
    // typed and the result you picked), used once when the same search route
    // comes back within half an hour.
    const memory = new Map(); // route key|address query -> { query, key, at }
    const MEMORY_MS = 30 * 60000;

    const createScreen = (server, route) => {
        const root = el('div', 'homer-screen');
        root.id = 'hs-root';
        root.style.visibility = 'hidden'; // until search.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hs-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hs-topbar">
                <div class="hs-brand homer-home" role="button" title="Home (H)"><span class="hs-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hs-brand-sub">SEARCH</span></div>
                <label class="hs-search">
                    <span class="material-icons hs-search-icon" aria-hidden="true">search</span>
                    <input class="hs-search-input" type="text" placeholder="Search movies, shows and channels" autocomplete="off" spellcheck="false" aria-label="Search">
                    <span class="hs-search-count"></span>
                </label>
                <div class="hs-clock"><div class="hs-clock-time"></div><div class="hs-clock-date"></div></div>
            </div>
            <div class="hs-toast" role="status" aria-live="polite"></div>
            <div class="hs-list">
                <div class="hs-list-head"><div class="hs-groups"><div class="hs-groups-inner"></div></div></div>
                <div class="hs-rows"><div class="hs-rows-inner"></div><div class="hs-state"></div></div>
            </div>
            <div class="hs-detail">
                <div class="hs-preview" data-homer-preview>
                    <div class="hs-preview-idle"><span class="material-icons" aria-hidden="true">search</span></div>
                    <div class="hs-preview-art"></div>
                    <div class="hs-preview-poster"></div>
                    <div class="hs-preview-logo"></div>
                    <div class="hs-preview-badge"></div>
                    <div class="hs-preview-bar"><span class="hs-preview-left"></span><span class="hs-preview-right"></span></div>
                    <div class="hs-progress"><i></i></div>
                </div>
                <div class="hs-text">
                    <div class="hs-kicker"></div>
                    <div class="hs-title"></div>
                    <div class="hs-meta"></div>
                    <div class="hs-desc"></div>
                    <div class="hs-actions"></div>
                </div>
            </div>
            <div class="hs-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), like the
        // other HOMER screens, so it fills the window instead of letterboxing
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
            $('.hs-clock-time').textContent = fmtTime(d);
            $('.hs-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.hs-clock')) : () => {};

        const toastEl = $('.hs-toast');
        let toastTimer = 0;
        const showToast = (html, kind = '', ms = 3200) => {
            toastEl.innerHTML = html;
            toastEl.className = 'hs-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hs-toast'; }, ms);
        };
        const toast = (msg, kind = '') => showToast(`<span class="hs-toast-text">${esc(msg)}</span>`, kind);

        // ----- recording (the guide's model: one request at a time, never twice) -----
        let recModel = null;
        let timersLoaded = false;
        const rec = () => {
            if (!recModel && window.HomerGuideModel) recModel = window.HomerGuideModel.create(server);
            return recModel;
        };
        // a program as the guide's model holds one
        const itemOf = (p) => ({ p, s: new Date(startOf(p)), e: new Date(endOf(p)), unknown: false });
        // '' | 'set' | 'recording'
        const recState = (p) => {
            const m = rec();
            if (!m || !p || !m.timersByProgram.has(p.Id)) return '';
            return m.recordingNow(itemOf(p)) ? 'recording' : 'set';
        };
        let armed = null; // { id, timer } while a cancel waits for its second press
        const armedFor = (p) => !!armed && !!p && armed.id === p.Id;
        // redraw the program rows and the panel after a timer changes
        const refreshRecs = () => {
            for (const r of rows) {
                if (r.kind !== 'programs' || !r.el) continue;
                const was = r.el.classList.contains('sel');
                r.el.innerHTML = rowHtml(r);
                const img = r.el.querySelector('img');
                if (img) {
                    img.onload = () => { img.classList.add('in'); img.parentNode.classList.add('has-img'); };
                    img.onerror = () => img.remove();
                    img.src = img.dataset.src || '';
                    if (img.parentNode.classList.contains('logo') && window.HomerLogos) window.HomerLogos.watch(img);
                }
                r.el.classList.toggle('sel', was);
            }
            const r = current();
            if (r) showInfo(r);
        };
        const loadTimers = () => {
            const m = rec();
            if (!m || timersLoaded) return;
            timersLoaded = true;
            m.loadTimers().then(() => { if (alive) refreshRecs(); }).catch(() => { timersLoaded = false; });
        };
        const disarm = () => {
            if (!armed) return;
            clearTimeout(armed.timer);
            armed = null;
            refreshRecs();
        };
        const toggleRecord = async (p) => {
            const m = rec();
            if (!m) { toast('Recording isn\'t available here', 'err'); return; }
            const item = itemOf(p);
            if (m.isBusy(p.Id)) { toast(m.busyText() || `Still scheduling ${p.Name}…`); return; }
            const again = armedFor(p);
            if (armed) { clearTimeout(armed.timer); armed = null; }
            if (!m.recordable(item)) { toast('No listing to record', 'err'); return; }
            if (item.e <= new Date()) { toast('That program has already ended', 'err'); return; }
            if (!m.timersByProgram.has(p.Id)) {
                toast(`Scheduling ${p.Name}…`);
                const ok = await m.schedule(p);
                if (!alive) return;
                refreshRecs();
                toast(ok ? `${m.recordingNow(item) ? 'Recording' : 'Set to record'} ${p.Name}` : 'Couldn\'t schedule that recording', ok ? 'rec' : 'err');
                return;
            }
            if (!again) {
                // a stray press never throws a recording away: the second one does
                armed = { id: p.Id, timer: setTimeout(disarm, CONFIRM_MS) };
                refreshRecs();
                toast(`${m.recordingNow(item) ? 'Stop recording' : 'Cancel recording of'} ${p.Name}? Press again`);
                return;
            }
            const stopping = m.recordingNow(item);
            toast(`${stopping ? 'Stopping' : 'Cancelling'} ${p.Name}…`);
            const result = await m.cancel(p, stopping);
            if (!alive) return;
            refreshRecs();
            if (result === 'gone') toast(`${stopping ? 'Recording stopped' : 'Recording cancelled'}: ${p.Name}`);
            else if (result === 'unset') toast(`${p.Name} isn't set to record`);
            else if (result === 'kept') toast('Jellyfin still has that recording scheduled', 'err');
            else toast('Couldn\'t cancel that recording', 'err');
        };

        // ----- Get it: Sonarr and Radarr (shared/arr.js) -----
        let arrVia = 'OK'; // the key that pressed a get action, for "Press OK again"
        // a get action's toast: the question with its "press again", or a message
        const arrToast = (m) => {
            if (m.kind === 'confirm') {
                showToast(`<span class="hs-toast-text homer-arr-q">${esc(m.question)}</span><span class="homer-arr-again">${esc(m.hint)}</span>`, 'confirm', m.ms);
            } else {
                showToast(`<span class="hs-toast-text">${esc(m.text)}</span>`, m.kind === 'err' ? 'err' : m.kind === 'ok' ? 'got' : '', m.ms || 3200);
            }
        };
        // a show or movie changed (an add, a fresh status): its row's flag and the panel
        const refreshArr = () => {
            if (!alive) return;
            const A = arr();
            for (const r of rows) {
                if (r.kind !== 'arr' || !r.el) continue;
                const f = r.el.querySelector('.hs-row-flag');
                if (f) f.innerHTML = A ? A.flagHtml(r.it) : '';
            }
            const r = current();
            if (r && (r.kind === 'arr' || r.kind === 'series')) showInfo(r);
        };
        const arrRun = arr() ? arr().runner({ hint: () => `Press ${arrVia} again`, toast: arrToast, update: refreshArr }) : null;
        const offArr = arr() ? arr().onChange(refreshArr) : () => {};
        const arrPress = (a, v, via) => {
            if (!arrRun || !a || !v) return;
            arrVia = via;
            arrRun.press(a, v);
        };
        // A library show's Sonarr status: asked for once (when it's highlighted,
        // or among a search's first shows), then from shared/arr.js's cache.
        const askedSeries = new Set();
        const seriesArr = (it) => {
            const id = tvdbOf(it);
            return id && arr() ? arr().peekStatus({ tvdbId: id }) : null;
        };
        const wantSeries = (it) => {
            const id = tvdbOf(it);
            if (!id || !arr() || askedSeries.has(id)) return;
            askedSeries.add(id);
            arr().status({ tvdbId: id }).then(refreshArr).catch(() => { /* not in Sonarr's reach */ });
        };
        // a get action as a button: its label says when it's waiting for the second press
        const arrAct = (a, v) => ({
            id: 'arr-' + a.id,
            icon: arrRun.busy(v) ? 'hourglass_empty' : a.icon,
            label: arrRun.busy(v) ? 'Asking…' : arrRun.label(a, v),
            arr: a,
            view: v,
            armed: arrRun.armed(a, v)
        });

        const input = $('.hs-search-input');
        const rowsView = $('.hs-rows');
        const inner = $('.hs-rows-inner');
        const groupsView = $('.hs-groups');
        const groupsInner = $('.hs-groups-inner');
        const scroller = makeScroller(rowsView, inner, false, loadNear(inner));
        const groupScroller = makeScroller(groupsView, groupsInner, true);
        const moved = hoverTracker();
        const stateEl = $('.hs-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        let alive = true;
        let routeQuery = route.query; // the query in the address
        let query = null; // the query the results are for
        let status = 'idle'; // idle | loading | ready | error
        let groups = []; // shown groups: { key, label, start (first row), head (heading el or null) }
        let rows = []; // { kind, it, gi, el }
        let noteEl = null; // "Not on TV through …" under the results
        let sel = -1;
        let zone = 'list'; // search | list | groups | actions
        let results = []; // the last search's groups, all of them
        let filter = 'all'; // 'all', or the one group shown
        let chips = []; // { key, label, n } along the top of the list
        let csel = 0; // chip with the remote on it
        let act = 0;
        let actions = [];
        let debounceTimer = 0;
        let searchToken = 0;
        let controller = null;
        let lastTypeAt = 0; // the last keystroke in the box, for asking the arrs once typing settles
        let baseResults = []; // the last search's Jellyfin groups (results adds Get it)
        let arrFor = null; // { q, group } once Sonarr and Radarr have answered for query q
        let arrQ = null; // the query they're being asked about
        let arrList = null; // its Jellyfin results, once they're in
        let arrSettled = false; // typing has settled on arrQ
        let arrPending = false;
        let arrTimer = 0;
        let arrCtl = null;

        const current = () => rows[sel] || null;
        const memKey = () => route.key + '|' + routeQuery;

        // ----- info panel -----
        let artUrl = null;
        // Art fades in once it has loaded, like a channel change, instead of the
        // window sitting blank (or showing the previous result) while it downloads.
        const setArt = (url) => {
            if (url === artUrl) return;
            artUrl = url;
            const art = $('.hs-preview-art');
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
        const logoChip = (x, name) => {
            const url = logoUrl(x);
            const fallback = `<span class="hs-logo-fallback">${esc(name || '')}</span>`;
            const chip = el('div', 'hs-logo-chip', url ? '' : fallback);
            if (url) {
                const i = new Image();
                i.alt = '';
                i.onerror = () => { chip.innerHTML = fallback; };
                i.src = url;
                chip.appendChild(i);
                if (window.HomerLogos) window.HomerLogos.watch(i, chip); // a dark or light chip for this logo
            }
            return chip;
        };
        const renderInfo = (info) => {
            $('.hs-kicker').innerHTML = info.kicker || '';
            $('.hs-kicker').style.display = info.kicker ? '' : 'none';
            const title = $('.hs-title');
            title.textContent = info.title || '';
            title.classList.toggle('long', (info.title || '').length > 28);
            $('.hs-meta').innerHTML = (info.chips || []).filter((c) => c && (c.text || c.html))
                .map((c) => c.html || `<span class="hs-chip${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>`).join('');
            const desc = $('.hs-desc');
            if (info.descHtml) desc.innerHTML = info.descHtml;
            else desc.textContent = info.desc || '';
            desc.classList.toggle('empty', !info.desc && !info.descHtml);
            setArt(info.art || null);
            $('.hs-preview-poster').innerHTML = !info.art && info.poster ? `<img src="${esc(info.poster)}" alt="">` : '';
            const logo = $('.hs-preview-logo');
            logo.innerHTML = '';
            if (!info.art && info.logo) logo.appendChild(logoChip(info.logo, info.logoName));
            $('.hs-preview-idle').style.display = info.idle ? '' : 'none';
            $('.hs-preview-badge').innerHTML = info.badge || '';
            $('.hs-preview-left').textContent = info.barLeft || '';
            $('.hs-preview-right').textContent = info.barRight || '';
            $('.hs-preview-bar').style.display = info.barLeft || info.barRight ? '' : 'none';
            $('.hs-progress').style.display = info.progress ? '' : 'none';
            $('.hs-progress > i').style.width = (info.progress || 0) + '%';
        };

        const actionsFor = (r) => {
            if (!r) return [];
            if (r.kind === 'series') {
                const list = [{ id: 'open', icon: 'video_library', label: 'Episodes' }];
                const v = arrRun && seriesArr(r.it);
                if (v) list.push(...arr().actions(v, { inLibrary: true }).map((a) => arrAct(a, v)));
                return list;
            }
            if (r.kind === 'arr') return arrRun ? arr().actions(r.it).map((a) => arrAct(a, r.it)) : [];
            if (r.kind === 'movies' || r.kind === 'episodes') return [{ id: 'open', icon: 'info', label: 'Details' }];
            if (r.kind === 'channels') return [{ id: 'watch', icon: 'live_tv', label: 'Watch' }];
            if (r.kind === 'programs') {
                const st = recState(r.it);
                const recAct = { id: 'record', icon: st ? 'cancel' : 'fiber_manual_record',
                    label: armedFor(r.it) ? (st === 'recording' ? 'Stop recording?' : 'Cancel recording?') : st === 'recording' ? 'Stop recording' : st ? 'Cancel recording' : 'Record' };
                // on now: watch first; still to come: record first
                return airing(r.it)
                    ? [{ id: 'watch', icon: 'live_tv', label: 'Watch' }, recAct]
                    : [recAct, { id: 'watch', icon: 'live_tv', label: 'Watch channel' }];
            }
            return [];
        };
        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            $('.hs-actions').innerHTML = actions.map((a, i) => `<div class="hs-btn${a.arr ? ' hs-btn-arr' : ''}${a.armed ? ' armed' : ''}${i === act ? ' cur' : ''}${i === act && zone === 'actions' ? ' focus' : ''}" role="button" data-i="${i}">
                <span class="material-icons" aria-hidden="true">${a.icon}</span><span>${esc(a.label)}</span></div>`).join('');
        };

        const showInfo = (r) => {
            if (!r) {
                actions = [];
                renderInfo({ idle: status === 'idle' || !rows.length });
                drawActions();
                updateLegend();
                return;
            }
            const it = r.it;
            const chips = [];
            let info;
            if (r.kind === 'movies' || r.kind === 'series') {
                if (r.kind === 'series') {
                    chips.push({ text: yearsOf(it) }, { text: it.OfficialRating });
                    if (it.ChildCount) chips.push({ text: plural(it.ChildCount, 'season') });
                    // whether Sonarr is getting its new episodes
                    wantSeries(it);
                    const v = seriesArr(it);
                    if (v) chips.unshift({ html: arr().chipHtml(v, { inLibrary: true }) });
                } else {
                    chips.push({ text: it.ProductionYear ? String(it.ProductionYear) : '' }, { text: it.OfficialRating }, { text: runtime(it) });
                }
                if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
                for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });
                let badge = '';
                let barRight = runtime(it);
                if (r.kind === 'series') {
                    const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                    badge = n ? `<span class="hs-chip hs-chip-new">${n} unwatched</span>` : (played(it) ? '<span class="hs-chip">Watched</span>' : '');
                    barRight = '';
                } else if (posOf(it) > 0) {
                    badge = '<span class="hs-chip hs-chip-resume">In progress</span>';
                    barRight = `${fmtMins(minsLeft(it))} left`;
                } else if (played(it)) badge = '<span class="hs-chip">Watched</span>';
                else if (isNew(it)) badge = '<span class="hs-chip hs-chip-new">New</span>';
                info = {
                    kicker: r.kind === 'movies' && it.Taglines && it.Taglines[0] ? `<i>${esc(it.Taglines[0])}</i>` : '',
                    title: it.Name,
                    chips,
                    desc: it.Overview || '',
                    art: backdropUrl(it, 1280),
                    poster: posterUrl(it, 420),
                    badge,
                    barRight,
                    progress: r.kind === 'series' ? 0 : pctOf(it)
                };
            } else if (r.kind === 'episodes') {
                chips.push({ text: it.PremiereDate ? fmtDate(it.PremiereDate) : '' }, { text: runtime(it) }, { text: it.OfficialRating });
                if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
                let badge = '';
                let barRight = runtime(it);
                if (posOf(it) > 0) {
                    badge = '<span class="hs-chip hs-chip-resume">In progress</span>';
                    barRight = `${fmtMins(minsLeft(it))} left`;
                } else if (played(it)) badge = '<span class="hs-chip">Watched</span>';
                const code = epCode(it);
                info = {
                    kicker: `${code ? `<b>${esc(code)}</b>` : ''}${esc(it.SeriesName || '')}`,
                    title: it.Name,
                    chips,
                    desc: it.Overview || '',
                    art: stillUrl(it, 900),
                    badge,
                    barLeft: it.SeriesName || '',
                    barRight,
                    progress: pctOf(it)
                };
            } else if (r.kind === 'arr') {
                const A = arr();
                const v = A.latest(it);
                const show = v.kind === 'show';
                chips.push({ html: A.chipHtml(v) });
                if (show) {
                    chips.push({ text: v.status === 'continuing' && v.year ? `Since ${v.year}` : v.status === 'upcoming' ? 'Coming soon' : v.year ? String(v.year) : '' });
                    if (v.seasons) chips.push({ text: plural(v.seasons, 'season') });
                    if (v.status === 'ended') chips.push({ text: 'Ended' });
                } else {
                    chips.push({ text: v.year ? String(v.year) : '' }, { text: v.runtime ? fmtMins(v.runtime) : '' });
                    if (v.status === 'announced' || v.status === 'inCinemas') chips.push({ text: v.status === 'inCinemas' ? 'In theaters' : 'Not out yet', cls: 'soon' });
                }
                info = {
                    kicker: `<b>${show ? 'TV SHOW' : 'MOVIE'}</b>${esc((show ? v.network : v.studio) || '')}`,
                    title: v.title,
                    chips,
                    desc: v.overview || '',
                    art: A.img(v.fanart, 'art') || null,
                    poster: A.img(v.poster, 'poster') || null,
                    barLeft: show ? 'Sonarr' : 'Radarr',
                    barRight: A.detailText(v)
                };
            } else if (r.kind === 'channels') {
                const p = it.CurrentProgram && !PLACEHOLDER.test(it.CurrentProgram.Name || '') && airing(it.CurrentProgram) ? it.CurrentProgram : null;
                if (p) chips.push({ text: 'On now', cls: 'live' }, { text: `Until ${fmtTime(new Date(endOf(p)))}` });
                info = {
                    kicker: chNum(it) ? `<b>CH ${esc(chNum(it))}</b>` : '',
                    title: it.Name,
                    chips,
                    descHtml: p ? `<b>${esc(p.Name)}</b>${p.Overview ? ' · ' + esc(p.Overview) : ''}` : '',
                    desc: p ? '' : 'No listings for what\'s on right now.',
                    art: programArt(p),
                    logo: it,
                    logoName: it.Name,
                    barLeft: p ? p.Name : '',
                    barRight: p ? slot(p) : '',
                    progress: p ? elapsedPct(p) : 0
                };
            } else {
                const live = airing(it);
                chips.push(live ? { text: 'On now', cls: 'live' } : { text: startsLabel(it), cls: 'soon' });
                const st = recState(it);
                if (st) chips.push({ text: st === 'recording' ? 'Recording' : 'Set to record', cls: 'rec' });
                chips.push({ text: slot(it) });
                if (it.RunTimeTicks) chips.push({ text: runtime(it) });
                info = {
                    kicker: `${chNum(it) ? `<b>CH ${esc(chNum(it))}</b>` : ''}${esc(it.ChannelName || '')}`,
                    title: it.Name,
                    chips,
                    desc: it.Overview || '',
                    art: programArt(it),
                    logo: it,
                    logoName: it.ChannelName,
                    barLeft: it.ChannelName || '',
                    barRight: live ? `${fmtMins((endOf(it) - Date.now()) / 60000)} left` : slot(it),
                    progress: live ? elapsedPct(it) : 0
                };
            }
            renderInfo(info);
            actions = actionsFor(r);
            drawActions();
            updateLegend();
        };

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'retry' });
            else if (zone === 'search') {
                items.push({ key: 'OK', label: 'Search', action: 'submit' });
                if (rows.length) items.push({ key: '▼', label: 'Results', action: 'results' });
            } else if (zone === 'groups') {
                items.push({ key: '◀▶', label: 'Filter' }, { key: '▼', label: 'Results', action: 'results' });
            } else if (rows.length) {
                items.push({ key: '▲▼', label: 'Browse' });
                if (actions.length > 1) items.push({ key: '◀▶', label: 'Options' });
                const a = actions[zone === 'actions' ? act : 0];
                if (a) items.push({ key: 'OK', label: a.label, action: 'ok' });
                const getNew = actions.find((x) => x.arr && x.arr.id === 'new');
                if (getNew && getNew !== a) items.push({ key: 'E', label: getNew.label, action: 'arr-new', cls: 'arr' });
                const r = current();
                if (r && r.kind === 'programs' && !(a && a.id === 'record')) {
                    const st = recState(r.it);
                    items.push({ key: 'R', label: st === 'recording' ? 'Stop recording' : st ? 'Cancel recording' : 'Record', action: 'record' });
                }
            }
            if (zone !== 'search') items.push({ key: '/', label: 'Search', action: 'search' });
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' }, { key: 'ESC', label: 'Back', action: 'back' });
            $('.hs-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hs-key${i.cls ? ' ' + i.cls : ''}">${i.key}</span>${esc(i.label)}</span>`)).join('');
        };

        // ----- zones -----
        const chipOn = () => Math.max(0, chips.findIndex((c) => c.key === filter));
        const markGroups = () => {
            const on = chipOn();
            groupsInner.querySelectorAll('.hs-gchip').forEach((c, i) => {
                c.classList.toggle('on', i === on);
                c.classList.toggle('focus', zone === 'groups' && i === csel);
            });
            const f = groupsInner.children[zone === 'groups' ? csel : on];
            if (f) groupScroller.reveal(f.offsetLeft - 40, f.offsetWidth + 80);
        };
        const setZone = (z) => {
            zone = z;
            if (z !== 'search' && document.activeElement === input) input.blur();
            root.classList.remove('hs-zone-search', 'hs-zone-list', 'hs-zone-groups', 'hs-zone-actions');
            root.classList.add('hs-zone-' + z);
            markGroups();
            drawActions();
            updateLegend();
        };
        const focusSearch = () => {
            setZone('search');
            input.focus();
            input.select();
        };
        const toList = () => {
            if (!rows.length) return;
            if (sel < 0) select(0);
            setZone('list');
        };

        // ----- rows -----
        // a Get it row: the poster, what it is, and Sonarr's or Radarr's word on it
        const arrRowHtml = (r) => {
            const A = arr();
            const v = A.latest(r.it);
            const poster = A.img(v.poster, 'thumb');
            const sub = v.kind === 'show'
                ? ['TV show', v.status === 'continuing' && v.year ? `Since ${v.year}` : v.year, v.network, v.seasons ? plural(v.seasons, 'season') : '']
                : ['Movie', v.year, v.runtime ? fmtMins(v.runtime) : '', v.studio];
            return `<div class="hs-thumb poster">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((v.title || '?').slice(0, 1))}</span>`}</div>
                <div class="hs-row-text"><div class="hs-row-title">${esc(v.title)}</div><div class="hs-row-sub">${esc(sub.filter(Boolean).join(' · '))}</div></div>
                <div class="hs-row-flag">${A.flagHtml(v)}</div>`;
        };
        const rowHtml = (r) => {
            if (r.kind === 'arr') return arrRowHtml(r);
            const it = r.it;
            let thumb = '';
            let sub = '';
            let flag = '';
            if (r.kind === 'movies' || r.kind === 'series') {
                const poster = posterUrl(it, 180);
                thumb = `<div class="hs-thumb poster">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((it.Name || '?').slice(0, 1))}</span>`}</div>`;
                if (r.kind === 'series') {
                    sub = [yearsOf(it), it.ChildCount ? plural(it.ChildCount, 'season') : '', it.OfficialRating].filter(Boolean).join(' · ');
                    const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                    flag = n ? `<span class="hs-count-dot">${n}</span>` : (played(it) ? '<span class="material-icons hs-check">check</span>' : '');
                } else {
                    sub = [it.ProductionYear, runtime(it), it.OfficialRating].filter(Boolean).join(' · ');
                    if (posOf(it) > 0) flag = `<span class="hs-left">${fmtMins(minsLeft(it))} left</span>`;
                    else if (played(it)) flag = '<span class="material-icons hs-check">check</span>';
                    else flag = '<span class="hs-dot" title="Unwatched"></span>';
                }
            } else if (r.kind === 'episodes') {
                const still = stillUrl(it, 320);
                thumb = `<div class="hs-thumb still">${still ? `<img data-src="${esc(still)}" alt="">` : ''}</div>`;
                sub = [it.SeriesName, epCode(it), it.PremiereDate ? fmtDate(it.PremiereDate) : ''].filter(Boolean).join(' · ');
                if (posOf(it) > 0) flag = `<span class="hs-left">${fmtMins(minsLeft(it))} left</span>`;
                else if (played(it)) flag = '<span class="material-icons hs-check">check</span>';
                else flag = '<span class="hs-dot" title="Unwatched"></span>';
            } else {
                const url = logoUrl(it);
                const name = r.kind === 'channels' ? it.Name : it.ChannelName;
                thumb = `<div class="hs-thumb logo">${url ? `<img data-src="${esc(url)}" alt="">` : ''}<span class="hs-logo-fallback">${esc(name || '')}</span></div>`;
                if (r.kind === 'channels') {
                    const p = it.CurrentProgram && airing(it.CurrentProgram) && !PLACEHOLDER.test(it.CurrentProgram.Name || '') ? it.CurrentProgram : null;
                    sub = [chNum(it) ? `CH ${chNum(it)}` : '', p ? `Now: ${p.Name}` : ''].filter(Boolean).join(' · ');
                    flag = '';
                } else {
                    sub = [chNum(it) ? `CH ${chNum(it)}` : '', it.ChannelName, slot(it)].filter(Boolean).join(' · ');
                    const st = recState(it);
                    const recFlag = st ? `<span class="hs-rec">${st === 'recording' ? 'Recording' : 'Set to record'}</span>` : '';
                    flag = recFlag + (airing(it) ? '<span class="hs-live">Live</span>' : `<span class="hs-soon">${esc(startsLabel(it))}</span>`);
                }
            }
            const pct = r.kind === 'programs' ? (airing(it) ? elapsedPct(it) : 0) : (r.kind === 'series' || r.kind === 'channels' ? 0 : pctOf(it));
            return `${thumb}
                <div class="hs-row-text"><div class="hs-row-title">${esc(it.Name)}</div><div class="hs-row-sub">${esc(sub)}</div></div>
                <div class="hs-row-flag">${flag}</div>
                ${pct ? `<div class="hs-row-progress"><i style="width:${pct}%"></i></div>` : ''}`;
        };
        const makeRow = (r) => {
            const e = el('div', 'hs-row hs-kind-' + r.kind, rowHtml(r));
            const img = e.querySelector('img');
            if (img) {
                img.onload = () => {
                    img.classList.add('in');
                    img.parentNode.classList.add('has-img');
                };
                img.onerror = () => img.remove();
                if (img.parentNode.classList.contains('logo') && window.HomerLogos) window.HomerLogos.watch(img);
            }
            return e;
        };

        const rowKey = (r) => r && (r.kind === 'arr' && arr() ? 'arr:' + arr().key(r.it) : r.kind + ':' + r.it.Id);

        const select = (i, { scroll = true } = {}) => {
            if (!rows[i]) return;
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            if (sel !== i) act = 0;
            sel = i;
            const r = rows[i];
            r.el.classList.add('sel');
            if (scroll) {
                const g = groups[r.gi];
                // the first result of a group brings its heading into view too
                const top = g.head && g.start === i ? g.head.offsetTop : r.el.offsetTop - 8;
                // the last result brings the On TV note under it into view too
                const below = i === rows.length - 1 && noteEl && noteEl.offsetTop > r.el.offsetTop ? noteEl : r.el;
                scroller.reveal(top, below.offsetTop + below.offsetHeight + 12 - top);
            }
            showInfo(r);
        };
        const step = (d) => {
            if (!rows.length) return;
            select(clamp(sel + d, 0, rows.length - 1));
        };
        // Page Up/Down: the previous/next group when they're all showing
        const groupStep = (d) => {
            if (!rows.length) return;
            if (groups.length < 2) {
                step(d * 6);
                return;
            }
            const cur = rows[sel] ? rows[sel].gi : 0;
            // Page Up inside a group goes to that group's top first
            const gi = d < 0 && groups[cur].start !== sel ? cur : clamp(cur + d, 0, groups.length - 1);
            const g = groups[gi];
            select(g.start, { scroll: false });
            scroller.reveal(g.head ? g.head.offsetTop : rows[g.start].el.offsetTop, rowsView.clientHeight); // heading to the top
        };

        const countText = () => {
            const n = results.reduce((a, g) => a + g.items.length, 0);
            const more = results.some((g) => g.more);
            return n ? `${n}${more ? '+' : ''} ${n === 1 && !more ? 'result' : 'results'}` : '';
        };
        const countOf = (g) => `${g.items.length}${g.more ? '+' : ''}`;

        // the list for the current filter: every group under its heading, or one
        const build = (keepKey) => {
            inner.innerHTML = '';
            rows = [];
            groups = [];
            sel = -1;
            const found = results.filter((g) => g.items.length);
            if (filter !== 'all' && !found.some((g) => g.key === filter)) filter = 'all';
            const shown = found.filter((g) => filter === 'all' || g.key === filter);
            const heads = shown.length > 1;
            for (const g of shown) {
                const gi = groups.length;
                let head = null;
                if (heads) {
                    head = el('div', 'hs-group', `<span class="hs-group-name">${esc(g.label)}</span><span class="hs-group-count">${countOf(g)}</span>`);
                    inner.appendChild(head);
                }
                groups.push({ key: g.key, label: g.label, start: rows.length, head });
                for (const it of g.items) {
                    const r = { kind: g.key, it, gi };
                    r.el = makeRow(r);
                    r.el.dataset.i = rows.length;
                    inner.appendChild(r.el);
                    rows.push(r);
                }
            }
            // nothing still to come on TV: say so under the results
            const note = filter === 'all' && rows.length ? tvNote(results) : null;
            noteEl = note ? el('div', 'hs-tvnote', `<span class="material-icons" aria-hidden="true">live_tv</span><div><b>${esc(note.text)}</b>${note.sub ? `<span>${esc(note.sub)}</span>` : ''}</div>`) : null;
            // (above Get it: it's about what's on TV)
            if (noteEl) {
                const arrHead = groups.find((g) => g.key === 'arr');
                if (arrHead && arrHead.head) inner.insertBefore(noteEl, arrHead.head);
                else inner.appendChild(noteEl);
            }
            // Sonarr and Radarr are still looking: say so where Get it will go
            if (filter === 'all' && rows.length && arrPending) {
                inner.appendChild(el('div', 'hs-arrnote', '<span class="material-icons" aria-hidden="true">hourglass_empty</span><span>Looking in Sonarr and Radarr…</span>'));
            }
            // All plus one chip per kind of result; a lone kind is just its label
            const total = found.reduce((a, g) => a + g.items.length, 0);
            chips = found.length > 1
                ? [{ key: 'all', label: 'All', n: `${total}${found.some((g) => g.more) ? '+' : ''}` }, ...found.map((g) => ({ key: g.key, label: g.label, n: countOf(g) }))]
                : found.map((g) => ({ key: g.key, label: g.label, n: countOf(g) }));
            groupsInner.innerHTML = chips.map((c, i) => `<div class="hs-gchip" data-c="${i}">${esc(c.label)}<span>${c.n}</span></div>`).join('');
            root.classList.toggle('hs-has-chips', chips.length > 1);
            root.classList.toggle('hs-empty', !rows.length);
            scroller.reset();
            markGroups();
            if (!rows.length) return;
            const keep = keepKey ? rows.findIndex((r) => rowKey(r) === keepKey) : -1;
            select(keep >= 0 ? keep : 0);
            scroller.refresh(); // load the art for the rows now on screen
        };
        const setFilter = (key) => {
            if (key === filter) return;
            filter = key;
            build(null); // a new filter starts at its top
        };

        // the Jellyfin groups, and Get it when Sonarr and Radarr have answered for this query
        const withArr = (list) => (arrFor && arrFor.q === query && arrFor.group && arrFor.group.items.length ? list.concat([arrFor.group]) : list);
        const render = (list, keepKey) => {
            baseResults = list;
            results = withArr(list);
            $('.hs-search-count').textContent = countText();
            groupScroller.reset();
            build(keepKey);
            if (!rows.length) {
                // nothing matched, or the searches that failed might have
                if (list.some((g) => g.failed)) {
                    status = 'error';
                    setState('<b>Couldn\'t search everything</b><span>Part of Jellyfin didn\'t answer. Press OK to try again.</span>');
                } else {
                    // nothing anywhere; a show that was on TV earlier says when
                    const note = tvNote(list);
                    setState(arrPending
                        ? `<b>Nothing in your library for “${esc(query)}”</b><span>Looking in Sonarr and Radarr…</span>`
                        : `<b>Nothing found for “${esc(query)}”</b>`
                            + (note && note.sub ? `<span>${esc(note.text)}. ${esc(note.sub)}.</span>` : '')
                            + '<span>Try fewer letters, or another spelling.</span>');
                }
                showInfo(null);
                if (zone !== 'search') setZone('list');
                return;
            }
            setState('');
            if (zone === 'groups' || (wantList && zone === 'search')) setZone('list');
            wantList = false;
            if (rows.some((r) => r.kind === 'programs')) loadTimers();
        };

        // ----- Get it: asking Sonarr and Radarr, once typing has settled -----
        const stopArr = () => {
            clearTimeout(arrTimer);
            if (arrCtl) arrCtl.abort();
            arrCtl = null;
            arrQ = null;
            arrList = null;
            arrSettled = false;
            arrPending = false;
        };
        // Get it joins the list where it is: same result highlighted, same scroll
        const showArr = () => {
            if (status !== 'ready') return; // the next render() picks it up
            if (!rows.length) {
                render(baseResults, null);
                return;
            }
            const keepKey = rowKey(current());
            const pos = scroller.pos();
            const a = act;
            results = withArr(baseResults);
            $('.hs-search-count').textContent = countText();
            build(keepKey);
            scroller.to(pos);
            act = a;
            drawActions();
            updateLegend();
        };
        const askArr = async () => {
            if (!arrSettled || !arrList || arrCtl) return;
            const q = arrQ;
            const ctl = new AbortController();
            arrCtl = ctl;
            let group = null;
            try {
                group = await arrGroup(route, q, arrList, ctl.signal);
            } catch (err) {
                if (ctl.signal.aborted) return;
                console.warn('[HOMER Search] Sonarr/Radarr:', err);
            }
            if (!alive || ctl.signal.aborted || arrQ !== q) return;
            arrCtl = null;
            arrQ = null;
            arrList = null;
            arrSettled = false;
            arrPending = false;
            arrFor = { q, group };
            showArr();
        };
        // a new query: the arrs are asked about it once typing has stopped for
        // a moment (and its Jellyfin results are in, for what to leave out)
        const armArr = (q) => {
            if (arrQ === q) return;
            stopArr();
            const A = arr();
            if (!A || !arrKinds(route).length || (arrFor && arrFor.q === q)) return;
            arrQ = q;
            arrPending = true;
            arrTimer = setTimeout(() => {
                if (!alive || arrQ !== q) return;
                arrSettled = true;
                A.lookup(q).catch(() => { /* getIt says so */ }); // start them on it now
                // and the first few library shows' Sonarr status, for their panels
                const shows = (baseResults.find((g) => g.key === 'series') || { items: [] }).items;
                if (query === q) shows.slice(0, 6).forEach(wantSeries);
                askArr();
            }, Math.max(0, lastTypeAt + ARR_SETTLE_MS - Date.now()));
        };
        const listForArr = (q, list) => {
            if (arrQ !== q) return;
            arrList = list;
            askArr();
        };

        // ----- searching -----
        const showIdle = () => {
            status = 'idle';
            clearTimeout(debounceTimer);
            stopArr();
            if (controller) controller.abort();
            query = '';
            results = [];
            build(null);
            root.classList.remove('hs-busy');
            $('.hs-search-count').textContent = '';
            setState('<b>Type to search</b><span>Results show up as you type.</span>');
            showInfo(null);
        };

        const runSearch = async (text, { keepKey = null, force = false } = {}) => {
            clearTimeout(debounceTimer);
            const q = String(text || '').trim();
            if (!force && q === query && status !== 'error') return;
            if (!q) {
                showIdle();
                updateLegend();
                return;
            }
            query = q;
            const token = ++searchToken;
            if (controller) controller.abort();
            controller = new AbortController();
            const signal = controller.signal;
            armArr(q);
            const ckey = `${route.key}|${q.toLowerCase()}`;
            let list = force ? null : cacheGet(ckey);
            if (!list) {
                status = 'loading';
                // keep the old results up while typing; only an empty list shows the spinner
                root.classList.add('hs-busy');
                $('.hs-search-count').textContent = 'Searching…';
                if (!rows.length) {
                    setState('<div class="hs-spinner"></div><b>Searching…</b>');
                    showInfo(null);
                }
                updateLegend();
                try {
                    list = await fetchResults(server, route, q, signal);
                    cachePut(ckey, list);
                } catch (err) {
                    if (signal.aborted || !alive || token !== searchToken) return;
                    console.error('[HOMER Search]', err);
                    stopArr();
                    status = 'error';
                    root.classList.remove('hs-busy');
                    results = [];
                    build(null);
                    $('.hs-search-count').textContent = '';
                    setState('<b>Couldn\'t search</b><span>Jellyfin didn\'t answer. Press OK to try again.</span>');
                    showInfo(null);
                    return;
                }
            }
            if (!alive || token !== searchToken) return;
            status = 'ready';
            root.classList.remove('hs-busy');
            render(list, keepKey);
            listForArr(q, list);
        };
        const retry = () => runSearch(input.value, { force: true });

        // Leaving the box (OK, ▼) goes to the results for what's typed: if that
        // search is still coming, the move happens when it lands, never into the
        // previous query's list.
        let wantList = false;
        const leaveInput = () => {
            const q = input.value.trim();
            if (q && (q !== query || status === 'loading')) {
                wantList = true;
                runSearch(q);
                return true;
            }
            if (!rows.length) return false;
            toList();
            return true;
        };

        input.addEventListener('input', () => {
            wantList = false;
            lastTypeAt = Date.now();
            clearTimeout(debounceTimer);
            const text = input.value;
            debounceTimer = setTimeout(() => runSearch(text), text.trim() ? DEBOUNCE_MS : 0);
        });
        input.addEventListener('focus', () => { if (zone !== 'search') setZone('search'); });
        input.addEventListener('blur', () => {
            // clicked elsewhere on the screen (not just the window losing focus)
            setTimeout(() => {
                if (alive && zone === 'search' && document.activeElement !== input && document.hasFocus()) setZone('list');
            }, 0);
        });

        // ----- actions -----
        const run = (a) => {
            const r = current();
            if (!a || !r) return;
            const it = r.it;
            memory.set(memKey(), { query, key: rowKey(r), filter, at: Date.now() });
            if (a.arr) {
                arrPress(a.arr, a.view, 'OK');
                return;
            }
            if (a.id === 'open') {
                go(detailsHash(it.Id));
                return;
            }
            if (a.id === 'record') {
                toggleRecord(it);
                return;
            }
            if (a.id === 'watch') {
                const channelId = r.kind === 'channels' ? it.Id : it.ChannelId;
                const name = r.kind === 'channels' ? it.Name : it.ChannelName;
                let program;
                if (r.kind === 'programs' && airing(it)) program = it;
                else if (r.kind === 'channels' && it.CurrentProgram && airing(it.CurrentProgram)) {
                    program = { ...it.CurrentProgram, ChannelName: it.Name, ChannelNumber: chNum(it) };
                } else {
                    // what's on now isn't known here; the channel itself stands in
                    program = { Name: name, ChannelId: channelId, ChannelName: name, ChannelNumber: chNum(it) };
                }
                toast(`Tuning ${name || 'channel'}`);
                try {
                    watchChannel(channelId, program);
                } catch (err) {
                    console.error('[HOMER Search] Watch failed:', err);
                    toast('Couldn\'t start the channel', 'err');
                }
            }
        };

        // ----- input -----
        const HANDLED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
        const underPlayer = () => /^#\/video/.test(location.hash);
        const onKey = (ev) => {
            if (guideUp()) return; // the guide opens on top of us; it gets the keys while it's up
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key;
            if (ev.target === input) {
                if (k === 'Enter' || k === 'ArrowDown' || k === 'Tab') {
                    stop(ev);
                    if (!ev.repeat || k !== 'Enter') leaveInput();
                } else if (k === 'Escape') {
                    stop(ev);
                    if (!leaveInput()) goBack();
                } else {
                    ev.stopPropagation(); // typing; keep Jellyfin's shortcuts out of it
                }
                return;
            }
            if (k === 'h' || k === 'H') {
                // Home's global H handler may have taken it already
                if (ev.defaultPrevented || ev.repeat) return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                goHome();
                return;
            }
            if (k === '/') {
                stop(ev);
                focusSearch();
                return;
            }
            if ((k === 'r' || k === 'R') && (zone === 'list' || zone === 'actions')) {
                const r = current();
                if (r && r.kind === 'programs') {
                    stop(ev);
                    if (!ev.repeat) toggleRecord(r.it);
                    return;
                }
            }
            // E: get new episodes of the highlighted show (a second E does it)
            if ((k === 'e' || k === 'E') && (zone === 'list' || zone === 'actions')) {
                const a = actions.find((x) => x.arr && x.arr.id === 'new');
                if (a) {
                    stop(ev);
                    if (!ev.repeat) arrPress(a.arr, a.view, 'E');
                    return;
                }
            }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                goBack();
                return;
            }
            if (!HANDLED.includes(k)) {
                // over Jellyfin's player page: keep its shortcuts from firing
                if (underPlayer()) ev.stopPropagation();
                return;
            }
            stop(ev);
            if (status === 'error') {
                if (k === 'Enter' && !ev.repeat) retry();
                return;
            }
            if (!rows.length) {
                if (k === 'Enter' || k === 'ArrowUp') focusSearch();
                return;
            }
            if (ev.repeat && k === 'Enter') return;
            if (status === 'loading') return; // the list is about to change
            if (zone === 'list' || zone === 'search') {
                if (k === 'ArrowDown') step(1);
                else if (k === 'ArrowUp') {
                    if (sel <= 0) {
                        if (chips.length > 1) {
                            csel = chipOn();
                            setZone('groups');
                        } else focusSearch();
                    } else step(-1);
                } else if (k === 'PageDown') groupStep(1);
                else if (k === 'PageUp') groupStep(-1);
                else if (k === 'Home') select(0);
                else if (k === 'End') select(rows.length - 1);
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
            } else if (zone === 'groups') {
                // the filter follows the remote, like the library's sort switch
                if (k === 'ArrowLeft' || k === 'ArrowRight') {
                    csel = clamp(csel + (k === 'ArrowRight' ? 1 : -1), 0, chips.length - 1);
                    setFilter(chips[csel].key);
                    markGroups();
                } else if (k === 'ArrowDown' || k === 'Enter') setZone('list');
                else if (k === 'ArrowUp') focusSearch();
            }
        };
        // Enter/Space key-ups would otherwise reach Jellyfin's player underneath
        const onKeyUp = (ev) => {
            if (!underPlayer() || ev.target === input || guideUp()) return;
            if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); }
        };

        // Scrolling belongs to this screen while it's up: Jellyfin's player turns
        // wheel events into volume changes, and the page underneath would scroll.
        const onWheel = (ev) => {
            if (guideUp()) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (rowsView.contains(ev.target) && rows.length) scroller.wheel(ev);
            else if (groupsView.contains(ev.target)) groupScroller.wheel(ev);
        };

        // Jellyfin's search page underneath focuses its own search box when it
        // renders; typing must land in ours.
        const onFocusIn = (ev) => {
            const t = ev.target;
            if (!alive || root.contains(t) || guideUp() || !isTyping(t)) return;
            if (t.closest && t.closest('.homer-screen, #cg-root')) return;
            t.blur();
            if (zone === 'search') input.focus();
        };

        const onLegendClick = (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const a = item.dataset.action;
            if (a === 'home') goHome();
            else if (a === 'back') goBack();
            else if (a === 'search') focusSearch();
            else if (a === 'submit' || a === 'results') leaveInput();
            else if (a === 'retry') retry();
            else if (a === 'ok') run(zone === 'actions' ? actions[act] : actions[0]);
            else if (a === 'record') { const r = current(); if (r && r.kind === 'programs') toggleRecord(r.it); }
            else if (a === 'arr-new') {
                const x = actions.find((y) => y.arr && y.arr.id === 'new');
                if (x) arrPress(x.arr, x.view, 'E');
            }
        };

        document.addEventListener('keydown', onKey, true);
        document.addEventListener('keyup', onKeyUp, true);
        document.addEventListener('focusin', onFocusIn, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        $('.hs-brand').addEventListener('click', goHome);
        $('.hs-legend').addEventListener('click', onLegendClick);

        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const e = ev.target.closest('.hs-row');
            if (!e) return;
            const i = Number(e.dataset.i);
            // while typing, hovering only previews; the search box keeps the keys
            if (zone !== 'list' && zone !== 'search') setZone('list');
            if (i !== sel) select(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            const e = ev.target.closest('.hs-row');
            if (!e) return;
            const i = Number(e.dataset.i);
            select(i, { scroll: false });
            setZone('list');
            run(actions[0]);
        });
        groupsInner.addEventListener('click', (ev) => {
            const c = ev.target.closest('.hs-gchip');
            if (!c || !chips[Number(c.dataset.c)]) return;
            csel = Number(c.dataset.c);
            setFilter(chips[csel].key);
            setZone('list');
        });
        const actionsBox = $('.hs-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hs-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hs-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- start: back where you left off, or the address's query -----
        const start = (q) => {
            let saved = memory.get(memKey());
            memory.delete(memKey());
            if (saved && Date.now() - saved.at > MEMORY_MS) saved = null;
            const text = saved ? saved.query : q;
            filter = saved && saved.filter ? saved.filter : 'all';
            input.value = text;
            if (!text.trim()) {
                showIdle();
                focusSearch();
                return;
            }
            setZone('list');
            runSearch(text, { keepKey: saved && saved.key });
        };
        start(routeQuery);

        return {
            key: route.key,
            show() {
                root.style.visibility = '';
                if (zone === 'search' && document.activeElement !== input) input.focus();
            },
            // the address changed to another query while the screen is up
            update(next) {
                if (next.query === routeQuery) return;
                routeQuery = next.query;
                start(routeQuery);
            },
            // where this search is, for the phone layout to start from
            remember() {
                memory.set(memKey(), { query: input.value.trim() || query || '', key: rowKey(current()), filter, at: Date.now() });
            },
            teardown() {
                alive = false;
                clearTimeout(debounceTimer);
                clearTimeout(toastTimer);
                clearInterval(clockTimer);
                stopArr();
                if (arrRun) arrRun.dispose();
                offArr();
                wxDetach();
                if (controller) controller.abort();
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('keyup', onKeyUp, true);
                document.removeEventListener('focusin', onFocusIn, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                root.remove();
            }
        };
    };

    // ---------- The phone layout (search/search-phone.js) ----------

    // iPhones bring the keyboard up only for a focus inside the tap itself, and
    // the phone search opens a moment after the top bar's Search is tapped. So
    // a stand-in box takes the focus in the tap, and hands it (and anything
    // typed into it) to the search box once that's showing.
    let kbProxy = null; // { el, timer }
    const dropKeyboard = () => {
        if (!kbProxy) return;
        clearTimeout(kbProxy.timer);
        kbProxy.el.remove();
        kbProxy = null;
    };
    const holdKeyboard = () => {
        dropKeyboard();
        const i = document.createElement('input');
        i.type = 'search';
        i.className = 'hs-kb-proxy';
        i.tabIndex = -1;
        i.setAttribute('enterkeyhint', 'search');
        i.setAttribute('autocomplete', 'off');
        i.setAttribute('autocorrect', 'off');
        i.setAttribute('autocapitalize', 'off');
        i.setAttribute('aria-hidden', 'true');
        // 16px: an iPhone zooms the page into a smaller box
        i.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;z-index:-1';
        document.body.appendChild(i);
        try { i.focus({ preventScroll: true }); } catch { i.focus(); }
        kbProxy = { el: i, timer: setTimeout(dropKeyboard, 4000) };
    };

    const createPhone = (server, route) => window.HomerSearchPhone.create({
        server,
        route,
        startsLabel,
        tvNote,
        // a search, from the minute's cache when it's there
        cached: (q) => cacheGet(`${route.key}|${q.toLowerCase()}`),
        search: async (q, { force = false, signal } = {}) => {
            const ckey = `${route.key}|${q.toLowerCase()}`;
            const hit = force ? null : cacheGet(ckey);
            if (hit) return hit;
            const list = await fetchResults(server, route, q, signal);
            cachePut(ckey, list);
            return list;
        },
        // where Back lands (shared with the TV layout, so a change of layout keeps it too)
        recall: (routeQuery) => {
            const k = route.key + '|' + routeQuery;
            const saved = memory.get(k);
            memory.delete(k);
            return saved && Date.now() - saved.at <= MEMORY_MS ? saved : null;
        },
        remember: (routeQuery, entry) => memory.set(route.key + '|' + routeQuery, entry),
        heldKeyboard: () => (kbProxy ? kbProxy.el.value : null),
        refocusKeyboard: () => {
            if (!kbProxy) return false;
            try { kbProxy.el.focus({ preventScroll: true }); } catch { kbProxy.el.focus(); }
            return true;
        },
        dropKeyboard,
        isTyping,
        go,
        goBack,
        goHome,
        detailsHash,
        watchChannel,
        // Get it: what Sonarr and Radarr can get for a search (shared/arr.js)
        arrKinds: arrKinds(route),
        arrGroup: (q, list, signal) => arrGroup(route, q, list, signal),
        tvdbOf,
        util: {
            esc, fmtTime, fmtMins, plural, runtime, posOf, played, pctOf, minsLeft, epCode, yearsOf,
            startOf, endOf, airing, elapsedPct, chNum, posterUrl, stillUrl, logoUrl, PLACEHOLDER
        }
    });

    // ---------- Route takeover ----------

    let screen = null; // the open screen, or null
    let suppressedKey = null; // closed via close(); stay out of the way until the route changes
    let destroyed = false;

    const parseRoute = (hash) => {
        const m = (hash || '').match(/^#!?\/([a-z]+)(?:\.html)?(?:\?(.*))?$/i);
        if (!m || m[1].toLowerCase() !== 'search') return null;
        const q = new URLSearchParams(m[2] || '');
        const parentId = q.get('parentId') || '';
        const collectionType = q.get('collectionType') || '';
        return { query: q.get('query') || '', parentId, collectionType, key: `search:${parentId}:${collectionType}` };
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const sync = () => {
        if (destroyed) return;
        const route = parseRoute(currentHash());
        const server = getServer();
        if (!route || route.key !== suppressedKey) suppressedKey = null;
        if (!route || !server || suppressedKey) {
            closeScreen();
            return;
        }
        if (screen && screen.key === route.key) {
            screen.update(route);
            return;
        }
        closeScreen();
        const s = phoneLayout() ? createPhone(server, route) : createScreen(server, route);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    // The phone and TV layouts switch places (a rotation or resize across the
    // line, or the phone layout arriving): draw the other one, from where
    // this one was.
    const onLayout = () => {
        if (destroyed || !screen || !!screen.phone === phoneLayout()) return;
        if (typeof screen.remember === 'function') screen.remember();
        closeScreen();
        lastSig = '';
        sync();
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    // Follow HomerPlayer's virtual navigation when it's loaded (it may load
    // after this script, or be replaced by a reload).
    let playerSub = null;
    let playerObj = null;
    const attachPlayer = () => {
        const p = window.HomerPlayer || null;
        if (p === playerObj) return;
        if (playerSub) {
            try { playerSub(); } catch { /* already gone */ }
        }
        playerSub = null;
        playerObj = p;
        if (p && typeof p.onChange === 'function') {
            try {
                const off = p.onChange(onRouteChange);
                playerSub = typeof off === 'function' ? off : null;
            } catch (err) {
                console.warn('[HOMER Search] HomerPlayer.onChange failed:', err);
            }
        }
    };

    let lastSig = '';
    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued || destroyed) return;
        syncQueued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            if (destroyed) return; // queued before destroy(); don't resubscribe
            attachPlayer();
            const sig = location.href + '|' + currentHash();
            if (sig === lastSig && (screen || !parseRoute(currentHash()))) return;
            lastSig = sig;
            sync();
        }, 50);
    };
    function onRouteChange() {
        lastSig = '';
        queueSync();
    }

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
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerSearch = {
        version: VERSION,
        // open(): take over the current route if it's the search page;
        // open('#/search?query=…') or open('west'): go there (and take it over).
        open(route) {
            suppressedKey = null;
            if (typeof route === 'string' && route) {
                const hash = route.startsWith('#') ? route : (route.startsWith('/') ? '#' + route : `#/search?query=${encodeURIComponent(route)}`);
                if (currentHash() !== hash) {
                    go(hash);
                    return;
                }
            }
            lastSig = '';
            sync();
        },
        // close(): reveal Jellyfin's own page until the route changes
        close() {
            if (!screen) return;
            suppressedKey = screen.key;
            closeScreen();
        },
        // The phone's top bar Search (shared/layout.js), inside the tap: true
        // when the phone search is up and has taken it (back to its box);
        // false to go to #/search, with the keyboard already coming up.
        phoneTap() {
            if (destroyed || !phoneLayout()) return false;
            if (screen && screen.phone) {
                screen.focusInput();
                return true;
            }
            holdKeyboard();
            return false;
        },
        destroy() {
            destroyed = true;
            closeScreen();
            offLayout();
            dropKeyboard();
            document.getElementById('hs-phone-css')?.remove();
            observer && observer.disconnect();
            if (playerSub) {
                try { playerSub(); } catch { /* already gone */ }
            }
            playerSub = null;
            playerObj = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('hs-css')?.remove();
            cssReady = null;
        }
    };
})();
