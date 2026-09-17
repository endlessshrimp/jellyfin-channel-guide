/*
 * HOMER library screens' data: the Jellyfin session, the Movies/TV Shows
 * lists, shows' seasons and episodes, a movie's cast and media details,
 * watched/resume state, playback and moving between screens. The TV layout
 * (library/library.js) and the phone layout (library/library-phone.js) both
 * draw from it, the way the guide's two layouts share guide/guide-model.js.
 *
 * Nothing here draws. Every load asks Jellyfin afresh (watched and resume
 * state change while you watch), so a screen that opens again is current.
 *
 * It also holds what the two layouts must agree on: how a library can be
 * ordered (sortsFor/sortCompare/sortStore) and how it can be narrowed down —
 * genre, decade, Unwatched, Favourites and 4K, all combining (makeFilters),
 * with the chips each screen was left on kept for the sitting (filters).
 *
 * window.HomerLibraryModel = { util, load, play, facts, getServer, api,
 *                              typeCache, remember, memory, fresh,
 *                              makeFilters, filters, sortsFor, ... }
 */
(() => {
    const VERSION = '0.2.0';

    const SUPPORTED = new Set(['Movie', 'Series', 'Season', 'Episode']);
    const TICKS_PER_MIN = 600000000;

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

    // ---------- What the screens remember ----------

    // Items the screens have seen, by id, so a details route for one of them opens
    // without a lookup (and routes we don't handle are recognized at once).
    const typeCache = new Map();
    const remember = (items) => { for (const it of items || []) if (it && it.Id && it.Type) typeCache.set(it.Id, it.Type); };

    // Where each screen was (the title highlighted, the season), so coming back
    // (Back, or the end of a movie) lands where you left. Both layouts use it.
    const memory = new Map();

    // id -> an item a screen already has, for the next screen to draw at once
    // (used once)
    const fresh = new Map();

    // ---------- Putting a library in order ----------
    // Both layouts offer the same list, in the same order, and remember the
    // choice per library (a sort is a preference; a filter isn't — see below).

    const SORTS = [
        { key: 'added', label: 'Recently added', short: 'Added' },
        { key: 'az', label: 'A–Z', short: 'A–Z' },
        { key: 'year', label: 'Year', short: 'Year' },
        { key: 'rating', label: 'Rating', short: 'Rating' },
        { key: 'aired', label: 'Recently aired', short: 'Aired', tv: true }
    ];
    const sortsFor = (isTv) => SORTS.filter((s) => isTv || !s.tv);
    const sortKeyOf = (it) => lc(it.SortName || it.Name);
    const byName = (a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b), undefined, { numeric: true });
    const newestBy = (value) => (a, b) => (value(b) - value(a)) || byName(a, b);
    const sortCompare = (mode) => {
        if (mode === 'added') return (a, b) => String(b.DateCreated || '').localeCompare(String(a.DateCreated || '')) || byName(a, b);
        if (mode === 'year') return newestBy((x) => yearOf(x) || -1);
        if (mode === 'rating') return newestBy((x) => x.CommunityRating || -1);
        if (mode === 'aired') return newestBy((x) => Date.parse(x.PremiereDate || '') || -1);
        return byName;
    };
    const sortStore = {
        key: (collection) => 'homer-library-sort-' + collection,
        get(collection, isTv) {
            let mode = '';
            try { mode = localStorage.getItem(sortStore.key(collection)) || ''; } catch { /* default */ }
            return sortsFor(isTv).some((s) => s.key === mode) ? mode : 'az';
        },
        set(collection, mode) {
            try { localStorage.setItem(sortStore.key(collection), mode); } catch { /* a nicety only */ }
        }
    };

    // ---------- Narrowing a library down (genre, decade, state) ----------
    // Movies and TV Shows both offer the same chips: one genre, one decade, and
    // Unwatched / Favourites / 4K, all combining. Everything here works on the
    // titles the screen already has, so a chip costs one pass over ~150 items
    // rather than another round trip.

    const MAX_GENRES = 10; // the genres this library leans on, not all forty
    const yearOf = (it) => it.ProductionYear
        || (it.PremiereDate ? new Date(it.PremiereDate).getUTCFullYear() : 0);
    const decadeOf = (it) => {
        const y = yearOf(it);
        return y ? Math.floor(y / 10) * 10 : 0;
    };
    const unwatched = (it) => (it.Type === 'Series'
        ? ((it.UserData && it.UserData.UnplayedItemCount) || 0) > 0
        : !played(it));
    const favourite = (it) => !!(it.UserData && it.UserData.IsFavorite);

    const NONE = { genre: '', decade: 0, unwatched: false, favourite: false, uhd: false };

    // The chips a particular library can offer, and what each one would leave
    // on screen. `uhd` is the set of 4K item ids (empty when the server had
    // nothing to say, in which case the 4K chip doesn't appear at all).
    const makeFilters = (items, uhd) => {
        const state = { ...NONE };

        const tally = new Map();
        for (const it of items) for (const g of it.Genres || []) tally.set(g, (tally.get(g) || 0) + 1);
        // most-used first: the row reads as "what this library is made of"
        const genres = [...tally.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, MAX_GENRES)
            .map(([g]) => g);
        const decades = [...new Set(items.map(decadeOf).filter(Boolean))].sort((a, b) => a - b);
        // A chip that could never find anything in this library isn't offered
        // at all — a 4K chip over a library with nothing in 2160p, or Favourites
        // over one nobody has hearted, is just something else to arrow past.
        // (Decided once, from the whole library, so chips don't flicker in and
        // out as you narrow; a chip that's merely empty *right now* is dimmed.)
        const anyUhd = items.some((it) => uhd.has(it.Id));
        const anyFav = items.some(favourite);
        const anyUnwatched = items.some(unwatched);

        const matches = (it, s = state) => {
            if (s.genre && !(it.Genres || []).includes(s.genre)) return false;
            if (s.decade && decadeOf(it) !== s.decade) return false;
            if (s.unwatched && !unwatched(it)) return false;
            if (s.favourite && !favourite(it)) return false;
            if (s.uhd && !uhd.has(it.Id)) return false;
            return true;
        };

        // Every chip, in the order the rows show them. `pool` is what the search
        // box has left, so a count says what pressing this chip would really
        // give you — with everything else that's on still on.
        const chips = (pool) => {
            const count = (patch) => pool.reduce((n, it) => n + (matches(it, { ...state, ...patch }) ? 1 : 0), 0);
            const list = [];
            if (anyUnwatched) list.push({ group: 'unwatched', key: 'unwatched', label: 'Unwatched', patch: { unwatched: true }, off: { unwatched: false } });
            if (anyFav) list.push({ group: 'favourite', key: 'favourite', label: 'Favourites', patch: { favourite: true }, off: { favourite: false } });
            if (anyUhd) list.push({ group: 'uhd', key: 'uhd', label: '4K', patch: { uhd: true }, off: { uhd: false } });
            // Two rows, and the split is about width as much as meaning: the
            // decades are short enough to sit beside the sort and the state
            // chips, which leaves the genres a row of their own that fits
            // without running off the end of the stage.
            for (const d of decades) {
                list.push({ group: 'decade', key: 'd' + d, label: `${d}s`, patch: { decade: d }, off: { decade: 0 } });
            }
            for (const g of genres) {
                list.push({ group: 'genre', key: 'g' + g, label: g, row: 1, patch: { genre: g }, off: { genre: '' } });
            }
            for (const c of list) {
                c.on = Object.entries(c.patch).every(([k, v]) => state[k] === v);
                // always "how many titles this chip stands for": a preview of
                // pressing it while it's off, and what you're looking at while
                // it's on — so the lit chip's number and the list agree
                c.count = count(c.patch);
                if (c.row == null) c.row = 0;
            }
            return list;
        };

        const on = () => Object.keys(NONE).some((k) => state[k] !== NONE[k]);
        // what's on, in words, for the count line and the empty screen
        const summary = () => [
            state.genre,
            state.decade ? `${state.decade}s` : '',
            state.unwatched ? 'Unwatched' : '',
            state.favourite ? 'Favourites' : '',
            state.uhd ? '4K' : ''
        ].filter(Boolean).join(' · ');

        return {
            state,
            genres,
            decades,
            anyUhd,
            anyFav,
            anyUnwatched,
            matches,
            chips,
            on,
            summary,
            // pressing a chip: off again when it's the one that's on
            press(chip) { Object.assign(state, chip.on ? chip.off : chip.patch); },
            clear() { Object.assign(state, NONE); },
            restore(saved) { if (saved) Object.assign(state, NONE, saved); }
        };
    };

    // What each library screen was narrowed to, for as long as you're using
    // HOMER: leave Movies, come back, and the chips are still where you left
    // them. Never saved — a filter is for this sitting, so a box that has been
    // sitting on the home screen since yesterday shows the whole library again.
    const FILTER_TTL = 2 * 3600000;
    const filterMemory = new Map(); // route key -> { at, state }
    const filters = {
        get(key) {
            const e = filterMemory.get(key);
            if (!e) return null;
            if (Date.now() - e.at > FILTER_TTL) {
                filterMemory.delete(key);
                return null;
            }
            return e.state;
        },
        set(key, state) {
            if (Object.keys(NONE).every((k) => state[k] === NONE[k])) filterMemory.delete(key);
            else filterMemory.set(key, { at: Date.now(), state: { ...state } });
        }
    };

    // ---------- The player (shared/player.js) ----------
    // While a video plays docked in a preview window, HOMER screens sit on top of
    // Jellyfin's player page and move between each other without touching the
    // address (leaving the player page would stop the video). HomerPlayer keeps
    // that screen stack; the screens ask it where they are and go through it.
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

    // ---------- Loading ----------

    // Newest first by a number (season or episode order); items without one
    // keep Jellyfin's order among themselves, after the numbered ones.
    const newestFirst = (list, num) => list
        .map((x, i) => ({ x, i, n: num(x) }))
        .sort((a, b) => (b.n ?? -Infinity) - (a.n ?? -Infinity) || a.i - b.i)
        .map((e) => e.x);

    const load = {
        // a Movies or TV Shows library: its titles, and the library's own name
        async library(server, parentId, isTv) {
            const fields = 'Overview,Genres,DateCreated,ProductionYear,PremiereDate,EndDate,OfficialRating,CommunityRating,SortName,OriginalTitle' + (isTv ? ',RecursiveItemCount,ChildCount,Status' : '');
            const [res, lib] = await Promise.all([
                api(`/Items?userId=${server.UserId}&ParentId=${parentId}&IncludeItemTypes=${isTv ? 'Series' : 'Movie'}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Fields=${fields}&EnableImageTypes=Primary,Backdrop,Thumb&ImageTypeLimit=1&EnableTotalRecordCount=false`),
                api(`/Items/${parentId}?userId=${server.UserId}`).catch(() => null)
            ]);
            const items = (res && res.Items) || [];
            remember(items);
            return { items, name: (lib && lib.Name) || '' };
        },
        // Which of a library's titles are 4K. Jellyfin answers Is4K itself, so
        // this is one small extra query for ids beside the main one — not a
        // second pass over every title's media. A server that won't answer it
        // (or a library with nothing in 2160p) gives an empty set, and the
        // screens simply don't offer the chip.
        async uhd(server, parentId, isTv) {
            try {
                const res = await api(`/Items?userId=${server.UserId}&ParentId=${parentId}&IncludeItemTypes=${isTv ? 'Series' : 'Movie'}&Recursive=true&Is4K=true&EnableImages=false&EnableUserData=false&EnableTotalRecordCount=false`);
                return new Set(((res && res.Items) || []).map((x) => x.Id));
            } catch {
                return new Set();
            }
        },
        // a show's next episode to watch (in progress, or the first unwatched)
        async nextUp(server, seriesId, withOverview = false) {
            const res = await api(`/Shows/NextUp?userId=${server.UserId}&seriesId=${seriesId}&enableResumable=true&Limit=1${withOverview ? '&Fields=Overview' : ''}`);
            return (res && res.Items && res.Items[0]) || null;
        },
        // one item in full (a movie's cast and media streams included)
        item: (server, id) => api(`/Items/${id}?userId=${server.UserId}`),
        // a show's seasons, newest first by when they aired (a season numbered
        // by year, like "Season 1997", mustn't jump ahead of Season 7), then by
        // number when there's no date; Specials last
        async seasons(server, seriesId) {
            const res = await api(`/Shows/${seriesId}/Seasons?userId=${server.UserId}&Fields=Overview,PremiereDate,ProductionYear`);
            const aired = (x) => (x.PremiereDate ? Date.parse(x.PremiereDate)
                : x.ProductionYear ? Date.UTC(x.ProductionYear, 0) : undefined);
            const list = newestFirst((res && res.Items) || [], (x) => (x.IndexNumber === 0 ? -Infinity
                : aired(x) ?? (x.IndexNumber != null ? x.IndexNumber - 1e6 : undefined)));
            remember(list);
            return list;
        },
        // a season's episodes, newest first (season._all: a show without
        // seasons, all of them)
        async episodes(server, seriesId, season) {
            const q = season._all ? '' : `&seasonId=${season.Id}`;
            const res = await api(`/Shows/${seriesId}/Episodes?userId=${server.UserId}${q}&Fields=Overview,PremiereDate,OfficialRating,CommunityRating&EnableImageTypes=Primary,Thumb,Backdrop&ImageTypeLimit=1`);
            const list = newestFirst((res && res.Items) || [], (x) => (x.ParentIndexNumber || 0) * 100000 + (x.IndexNumber || 0));
            remember(list);
            return list;
        }
    };

    // A movie's (or episode's) "About" rows: who made it, and what's in the file.
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

    window.HomerLibraryModel = {
        version: VERSION,
        SUPPORTED,
        TICKS_PER_MIN,
        getServer,
        request,
        api,
        util: {
            el, esc, lc, clamp, fmtTime, fmtDate, fmtMins, runtime, posOf, played, pctOf, minsLeft, endsAt,
            epCode, yearsOf, plural, isNew, imgUrl, posterUrl, backdropUrl, stillUrl, langName,
            yearOf, decadeOf, unwatched, favourite
        },
        typeCache,
        remember,
        memory,
        fresh,
        makeFilters,
        filters,
        SORTS,
        sortsFor,
        sortCompare,
        sortStore,
        P,
        docked,
        currentRoute,
        nav,
        detailsHash,
        goBack,
        goHome,
        play,
        load,
        facts
    };
})();
