/*
 * HOMER + Sonarr/Radarr ("the arrs"): one client and one way of saying things,
 * for every screen that offers to get a show or a movie.
 *
 * The arrs sit behind HOMER's helper on the NAS (homerfeeds.py), which holds
 * their keys; the browser only talks to the helper:
 *   GET  /arr/lookup?term=…      shows and movies (Sonarr's and Radarr's own search)
 *   GET  /arr/status?tvdbId=…    one show (or ?tmdbId=… one movie), with its downloads
 *   POST /arr/add                {kind:'show', tvdbId, monitor} or {kind:'movie', tmdbId}
 *   GET  /arr/upcoming?days=7    episodes and movies coming up
 * A "view" is what those return for one show or movie:
 *   show:  {kind:'show', tvdbId, title, year, overview, network, status, seasons,
 *           poster, fanart, added, sonarrId, monitored, newEpisodes, episodes,
 *           episodeFiles, nextAiring, queue?}
 *   movie: {kind:'movie', tmdbId, title, year, overview, studio, runtime, poster,
 *           fanart, status, added, radarrId, monitored, hasFile, queue?}
 *
 * The client (timeouts, a small cache, one request at a time per URL):
 *   lookup(term, {signal})         → {shows, movies, showsError?, moviesError?}
 *   status({tvdbId} | {tmdbId})    → view (with queue)
 *   addShow(tvdbId, monitor)       → view; monitor 'future' (new episodes only),
 *                                    'all' or 'latestSeason'
 *   addMovie(tmdbId)               → view
 *   upcoming(days)                 → {episodes, movies}
 *   available()                    → true when the helper's arr routes answer
 *   peek(term) / peekStatus(q)     → what's cached, or null (no request)
 *   onChange(fn)                   → fn(view) whenever a view changes (an add, a
 *                                    fresh status); returns an unsubscribe
 *
 * Matching and ranking (Sonarr's search is fuzzy: "always sunny" doesn't even
 * return It's Always Sunny in Philadelphia):
 *   norm(title)                    → a comparable form ("It's Always Sunny" → "its always sunny")
 *   rank(views, term, {prefer})    → best first: preferred titles, then exact,
 *                                    prefix and all-words matches; drops the
 *                                    ones that don't match at all
 *   sameAs(view, jellyfinItem)     → the same show/movie (ProviderIds, else title + year)
 *   findShow(title, {year})        → the best Sonarr match for a title, or null
 *   getIt(term, {library, titles, prefer, signal}) → the views a search can offer to
 *                                    get: not in the Jellyfin library, ranked
 *   img(url, 'thumb'|'poster'|'art') → a smaller TMDB/TheTVDB picture for the use
 *
 * Saying it the same way everywhere:
 *   statusText(view, {inLibrary})  → "Not in your library", "Getting new episodes",
 *                                    "In Sonarr · 12 of 40 episodes", "Downloading · 42%",
 *                                    "Added · searching", "In your library"
 *   tone(view, {inLibrary})        → 'none' | 'on' | 'busy' | 'part' (the chip's color)
 *   chipHtml(view, {inLibrary, cls}) → the status chip (shared/arr.css)
 *   flagHtml(view, {inLibrary})    → a list row's flag ("Getting new episodes", "Downloading 42%")
 *   detailText(view)               → the second line: "182 of 182 episodes · Next Mon 9:00 PM"
 *   actions(view, {inLibrary})     → [{id, label, icon}]: 'new' Get new episodes,
 *                                    'all' Get every episode, 'latest' Get the
 *                                    latest season, 'movie' Get this movie
 *   runner({toast, update, hint})  → runs an action: the first press asks
 *                                    ("Get new episodes of X? Press OK again";
 *                                    hint is that "Press OK again", or a function),
 *                                    a second press of the same action within
 *                                    4 seconds does it, with toasts on the way
 *                                    and the new view handed to update(view).
 *                                    .press(action, view), .armed(action, view),
 *                                    .label(action, view), .busy(view), .disarm(), .dispose()
 *
 * window.HomerArr = { …all of the above, base, key, version }
 */
(() => {
    const VERSION = '0.1.0';

    const TIMEOUT_MS = 20000; // the first lookup of a term can take Sonarr 5 seconds
    const ADD_TIMEOUT_MS = 45000;
    const LOOKUP_TTL = 2 * 60000; // the helper keeps lookups 2 minutes too
    const STATUS_TTL = 30000;
    const UPCOMING_TTL = 5 * 60000;
    const CONFIRM_MS = 4000;
    const SEARCHING_MS = 15 * 60000; // "Added · searching" this long after an add

    // HOMER's helper on the NAS: through the https name's /homer-feeds, or
    // straight to port 8095 on the LAN (the same rule the hubs use for news)
    const base = () => (location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095');

    // ---------- Client ----------

    const cache = new Map(); // url -> { at, ttl, value }
    const inflight = new Map(); // url -> promise
    const cacheKeep = (url, value, ttl) => {
        cache.set(url, { at: Date.now(), ttl, value });
        while (cache.size > 80) cache.delete(cache.keys().next().value);
    };
    const cached = (url) => {
        const hit = cache.get(url);
        return hit && Date.now() - hit.at < hit.ttl ? hit.value : null;
    };

    const request = async (url, { method = 'GET', body, timeout = TIMEOUT_MS, signal } = {}) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeout);
        const onAbort = () => ctl.abort();
        if (signal) {
            if (signal.aborted) ctl.abort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const res = await fetch(url, {
                method,
                signal: ctl.signal,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                cache: 'no-store'
            });
            const text = await res.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
            if (!res.ok || (json && json.error)) {
                const err = new Error((json && (json.detail || json.error)) || `HTTP ${res.status}`);
                err.status = res.status;
                err.code = json && json.error;
                throw err;
            }
            return json;
        } catch (err) {
            if (ctl.signal.aborted && !(signal && signal.aborted)) {
                const e = new Error('The NAS helper didn\'t answer in time');
                e.code = 'timeout';
                throw e;
            }
            throw err;
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    };

    // a GET, from the cache when it's fresh; the same URL asked twice at once
    // is one request (a caller that gives up doesn't cancel it for the others)
    const get = (path, ttl, { signal, force = false } = {}) => {
        const url = base() + path;
        const hit = force ? null : cached(url);
        if (hit) return Promise.resolve(hit);
        let p = inflight.get(url);
        if (!p) {
            p = request(url).then((v) => {
                cacheKeep(url, v, ttl);
                return v;
            }).finally(() => inflight.delete(url));
            inflight.set(url, p);
        }
        if (!signal) return p;
        return new Promise((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            p.then(resolve, reject);
        });
    };

    // ---------- Views ----------

    const key = (v) => (v ? (v.kind === 'movie' ? 'movie:' + v.tmdbId : 'show:' + v.tvdbId) : '');
    const statusPath = (q) => (q.tmdbId != null || q.kind === 'movie'
        ? `/arr/status?tmdbId=${encodeURIComponent(q.tmdbId)}`
        : `/arr/status?tvdbId=${encodeURIComponent(q.tvdbId)}`);

    const listeners = new Set();
    const known = new Map(); // key -> the latest view (a fresh status, or an add's answer)
    const justAdded = new Map(); // key -> { at, action }
    const changed = (v) => {
        if (!v || !v.kind) return;
        const k = key(v);
        const had = known.get(k);
        // a status carries its downloads; a lookup's copy doesn't: keep them
        if (had && had.queue && !v.queue) v = Object.assign({}, v, { queue: had.queue });
        known.set(k, v);
        cacheKeep(base() + statusPath(v), v, STATUS_TTL);
        for (const fn of [...listeners]) {
            try { fn(v); } catch (err) { console.warn('[HOMER Arr] listener failed:', err); }
        }
    };
    // the freshest copy of a view we know of (a lookup's copy can be older than an add)
    const latest = (v) => {
        const k = v && known.get(key(v));
        return k || v;
    };

    const lookupPath = (term) => '/arr/lookup?term=' + encodeURIComponent(String(term || '').trim());
    const lookup = async (term, opts = {}) => {
        const t = String(term || '').trim();
        if (!t) return { shows: [], movies: [] }; // the helper hangs on an empty term
        const res = await get(lookupPath(t), LOOKUP_TTL, opts);
        return {
            shows: ((res && res.shows) || []).map(latest),
            movies: ((res && res.movies) || []).map(latest),
            showsError: res && res.showsError,
            moviesError: res && res.moviesError
        };
    };
    const peek = (term) => {
        const res = cached(base() + lookupPath(term));
        return res ? { shows: (res.shows || []).map(latest), movies: (res.movies || []).map(latest) } : null;
    };

    const status = async (q, opts = {}) => {
        if (!q || (q.tvdbId == null && q.tmdbId == null)) throw new Error('tvdbId or tmdbId needed');
        const v = await get(statusPath(q), STATUS_TTL, opts);
        if (v && v.kind) {
            const k = key(v);
            const had = known.get(k);
            if (!had || JSON.stringify(had) !== JSON.stringify(v)) changed(v);
        }
        return v;
    };
    const peekStatus = (q) => {
        if (!q) return null;
        const k = q.tmdbId != null ? 'movie:' + q.tmdbId : 'show:' + q.tvdbId;
        return known.get(k) || cached(base() + statusPath(q)) || null;
    };

    const add = async (body, action) => {
        const v = await request(base() + '/arr/add', { method: 'POST', body, timeout: ADD_TIMEOUT_MS });
        if (v && v.kind) {
            justAdded.set(key(v), { at: Date.now(), action });
            changed(v);
        }
        return v;
    };
    const addShow = (tvdbId, monitor = 'future') => add({ kind: 'show', tvdbId: Number(tvdbId), monitor },
        monitor === 'all' ? 'all' : monitor === 'latestSeason' ? 'latest' : 'new');
    const addMovie = (tmdbId) => add({ kind: 'movie', tmdbId: Number(tmdbId) }, 'movie');

    const upcoming = (days = 7, opts = {}) => get(`/arr/upcoming?days=${encodeURIComponent(days)}`, UPCOMING_TTL, opts);

    // the helper's arr routes answer (a status with no id says so at once)
    let health = null; // { at, ok }
    const available = async ({ force = false } = {}) => {
        if (!force && health && Date.now() - health.at < (health.ok ? 60000 : 20000)) return health.ok;
        let ok = false;
        try {
            await request(base() + '/arr/status', { timeout: 5000 });
            ok = true;
        } catch (err) {
            ok = err.code === 'tvdbId or tmdbId needed'; // the answer it gives when it's up
        }
        health = { at: Date.now(), ok };
        return ok;
    };

    // ---------- Matching and ranking ----------

    const norm = (s) => String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\[[^\]]*\]/g, ' ') // listings' "[NEW]", "[S,SL]"
        .replace(/\((?:19|20)\d\d\)|\((?:us|uk|au|ca|nz|ie|fr)\)/g, ' ') // "(2005)", "(US)"
        .replace(/&/g, ' and ')
        .replace(/['’‘`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/^(the|a|an) /, '');
    const words = (s) => norm(s).split(' ').filter(Boolean);

    // how well a title matches what was typed: 100 exact, 80 starts with it,
    // 60 every typed word starts a word of the title, 0 not at all
    const matchScore = (title, term) => {
        const n = norm(title);
        const t = norm(term);
        if (!t) return 0;
        if (n === t) return 100;
        if (n.startsWith(t)) return 80;
        const tw = t.split(' ');
        const nw = n.split(' ');
        if (tw.every((w) => nw.some((x) => x.startsWith(w)))) return 60;
        return 0;
    };

    // TMDB and TheTVDB are full of home movies and shorts with no year or
    // poster: they go after the real thing
    const quality = (v) => (v.added ? 5 : 0) + (v.poster ? 0 : -6) + (v.year ? 0 : -6)
        + (v.kind === 'movie' && v.runtime > 0 && v.runtime < 40 ? -6 : 0);
    // `prefer` is what a screen already knows is wanted (what's on TV, say):
    // titles, or { title, kind ('show'|'movie'), year } to be exact
    // (never a short or a nameless home movie that happens to share the title)
    const preferred = (v, prefer) => quality(v) >= 0 && (prefer || []).some((p) => {
        const x = typeof p === 'string' ? { title: p } : p || {};
        return norm(x.title) === norm(v.title) && (!x.kind || x.kind === v.kind) && (!x.year || yearNear(x.year, v.year));
    });
    // best first: preferred, then how well the title matches. Items that don't
    // match the term at all are dropped, unless nothing matches (a misspelling
    // Sonarr's fuzzy search saw through).
    const rank = (views, term, { prefer = [] } = {}) => {
        const scored = (views || []).map((v, i) => ({
            v,
            i,
            s: matchScore(v.title, term) + (preferred(v, prefer) ? 200 : 0) + quality(v)
        }));
        const hits = scored.filter((x) => x.s >= 40);
        const list = hits.length ? hits : scored.slice(0, 4);
        return list.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.v);
    };

    const yearNear = (a, b) => !a || !b || Math.abs(Number(a) - Number(b)) <= 1;
    // the same show or movie as a Jellyfin item (by Tvdb/Tmdb id, else title and year)
    const sameAs = (v, it) => {
        if (!v || !it) return false;
        const ids = it.ProviderIds || {};
        if (v.kind === 'show') {
            if (it.Type && it.Type !== 'Series') return false;
            if (ids.Tvdb && v.tvdbId) return String(ids.Tvdb) === String(v.tvdbId);
        } else {
            if (it.Type && it.Type !== 'Movie') return false;
            if (ids.Tmdb && v.tmdbId) return String(ids.Tmdb) === String(v.tmdbId);
        }
        return norm(it.Name) === norm(v.title) && yearNear(it.ProductionYear, v.year);
    };

    // the best Sonarr show for a title (from the guide, say): an exact title,
    // then one that starts with it; among those, the year asked for, one
    // already in Sonarr, one still airing, then Sonarr's order
    const findShow = async (title, { year, signal } = {}) => {
        const t = norm(title);
        if (!t) return null;
        const res = await lookup(title, { signal });
        const shows = res.shows || [];
        let pool = shows.filter((v) => norm(v.title) === t);
        if (!pool.length) pool = shows.filter((v) => norm(v.title).startsWith(t + ' '));
        if (!pool.length) return null;
        const score = (v) => (year && yearNear(v.year, year) ? 8 : 0) + (v.added ? 4 : 0) + (v.status === 'continuing' ? 2 : 0);
        return pool.map((v, i) => ({ v, i })).sort((a, b) => score(b.v) - score(a.v) || a.i - b.i)[0].v;
    };

    // What a search can offer to get: the lookup's shows and movies that aren't
    // in the Jellyfin library, ranked. `titles` are show names the search found
    // elsewhere (On TV): Sonarr's search may miss them for a loose term, so each
    // is looked up by itself (two at most) and an exact match leads. `prefer`
    // (as for rank: movies on TV, say) lead too, without a lookup of their own.
    const getIt = async (term, { library = [], titles = [], prefer = [], signal, max = 24 } = {}) => {
        const extra = [...new Set(titles.map((s) => String(s || '').trim()).filter(Boolean))]
            .filter((s) => norm(s) !== norm(term))
            .slice(0, 2);
        const [main, ...more] = await Promise.all([
            lookup(term, { signal }),
            ...extra.map((s) => lookup(s, { signal }).catch(() => ({ shows: [], movies: [] })))
        ]);
        const seen = new Set();
        const shows = [];
        const movies = [];
        const take = (v, list) => {
            const k = key(v);
            if (seen.has(k)) return;
            seen.add(k);
            list.push(v);
        };
        more.forEach((res, i) => {
            const t = norm(extra[i]);
            for (const v of res.shows || []) if (norm(v.title) === t) take(v, shows);
        });
        for (const v of main.shows || []) take(v, shows);
        for (const v of main.movies || []) take(v, movies);
        const notMine = (v) => !library.some((it) => sameAs(v, it));
        const wanted = [...titles.map((t) => ({ title: t, kind: 'show' })), ...prefer];
        const rankedShows = rank(shows.filter(notMine), term, { prefer: wanted });
        const rankedMovies = rank(movies.filter(notMine), term, { prefer: wanted });
        // shows and movies together, best match first (a show wins a tie)
        const both = [...rankedShows.map((v, i) => ({ v, i })), ...rankedMovies.map((v, i) => ({ v, i }))]
            .map((x) => ({ ...x, s: matchScore(x.v.title, term) + (preferred(x.v, wanted) ? 200 : 0) + quality(x.v) }))
            .sort((a, b) => b.s - a.s || a.i - b.i || (a.v.kind === 'show' ? -1 : 1));
        return {
            items: both.slice(0, max).map((x) => x.v),
            more: both.length > max,
            error: main.showsError && main.moviesError ? (main.showsError || main.moviesError) : null
        };
    };

    // ---------- Pictures ----------
    // Posters and fanart come from TheTVDB and TMDB at full size; a list row
    // needs a thumbnail. 'thumb' (a row), 'poster' (a panel), 'art' (a backdrop).
    const img = (url, size = 'poster') => {
        if (!url) return '';
        if (/image\.tmdb\.org\/t\/p\/[^/]+\//.test(url)) {
            const w = size === 'thumb' ? 'w185' : size === 'art' ? 'w1280' : 'w500';
            return url.replace(/(\/t\/p\/)[^/]+\//, `$1${w}/`);
        }
        if (size === 'thumb' && /artworks\.thetvdb\.com\/.+\.jpe?g$/i.test(url) && !/_t\.jpe?g$/i.test(url)) {
            return url.replace(/\.(jpe?g)$/i, '_t.$1');
        }
        return url;
    };

    // ---------- Saying it ----------

    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const downloading = (v) => {
        const q = (v && v.queue) || [];
        if (!q.length) return null;
        const pct = Math.round(q.reduce((a, x) => a + (Number(x.progress) || 0), 0) / q.length);
        return { pct, n: q.length };
    };
    const searching = (v) => {
        const j = justAdded.get(key(v));
        if (!j || Date.now() - j.at > SEARCHING_MS) return false;
        if (v.kind === 'movie') return !v.hasFile;
        return j.action !== 'new' && (v.episodeFiles || 0) < (v.episodes || 0);
    };

    const statusText = (v, { inLibrary = false } = {}) => {
        v = latest(v);
        if (!v) return '';
        const dl = downloading(v);
        if (dl) return `Downloading · ${dl.pct}%`;
        if (v.kind === 'movie') {
            if (v.hasFile || inLibrary) return 'In your library';
            if (!v.added) return 'Not in your library';
            if (searching(v)) return 'Added · searching';
            if (v.status === 'announced' || v.status === 'inCinemas') return 'Added · not out yet';
            return v.monitored ? 'In Radarr · not downloaded yet' : 'In Radarr · not monitored';
        }
        if (!v.added) return inLibrary ? 'Not getting new episodes' : 'Not in your library';
        if (searching(v)) return 'Added · searching';
        if (v.newEpisodes) return 'Getting new episodes';
        return `In Sonarr · ${v.episodeFiles || 0} of ${plural(v.episodes || 0, 'episode')}`;
    };
    // 'none' not in, 'on' getting it / have it, 'busy' downloading or
    // searching, 'part' in Sonarr/Radarr but not getting new ones
    const tone = (v, { inLibrary = false } = {}) => {
        v = latest(v);
        if (!v) return 'none';
        if (downloading(v) || searching(v)) return 'busy';
        if (v.kind === 'movie') return v.hasFile || inLibrary ? 'on' : v.added ? 'part' : 'none';
        return !v.added ? 'none' : v.newEpisodes ? 'on' : 'part';
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const chipHtml = (v, { inLibrary = false, cls = '' } = {}) => {
        const text = statusText(v, { inLibrary });
        return text ? `<span class="homer-arr-chip ${tone(v, { inLibrary })}${cls ? ' ' + cls : ''}">${esc(text)}</span>` : '';
    };
    // A list row's flag: a colored dot and a few words, only when there's
    // something to say (nothing for "not in your library": that's the default)
    const flagText = (v, { inLibrary = false } = {}) => {
        v = latest(v);
        if (!v) return '';
        const dl = downloading(v);
        if (dl) return `Downloading ${dl.pct}%`;
        if (searching(v)) return 'Searching';
        if (v.kind === 'movie') return v.hasFile || inLibrary ? 'In your library' : v.added ? 'In Radarr' : '';
        return !v.added ? '' : v.newEpisodes ? 'Getting new episodes' : 'In Sonarr';
    };
    const flagHtml = (v, opts = {}) => {
        const t = flagText(v, opts);
        return t ? `<span class="homer-arr-flag ${tone(v, opts)}">${esc(t)}</span>` : '';
    };
    // "Mon 9:00 PM", "Tomorrow 8:00 PM", "Sep 30"
    const airWord = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (days <= 0) return `Today ${time}`;
        if (days === 1) return `Tomorrow ${time}`;
        if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    // the line under the status: how much of it you have, and what's next
    const detailText = (v) => {
        v = latest(v);
        if (!v) return '';
        const bits = [];
        if (v.kind === 'show') {
            if (v.added && v.episodes) bits.push(`${v.episodeFiles || 0} of ${plural(v.episodes, 'episode')}`);
            if (v.nextAiring) bits.push(`Next episode ${airWord(v.nextAiring)}`);
        } else if (v.added && !v.hasFile && v.status === 'announced') bits.push('Not out yet');
        const dl = downloading(v);
        if (dl && dl.n > 1) bits.push(`${dl.n} downloads`);
        return bits.join(' · ');
    };

    const ACTIONS = {
        new: { id: 'new', label: 'Get new episodes', icon: 'fiber_new', monitor: 'future' },
        all: { id: 'all', label: 'Get every episode', icon: 'library_add', monitor: 'all' },
        latest: { id: 'latest', label: 'Get the latest season', icon: 'playlist_add', monitor: 'latestSeason' },
        movie: { id: 'movie', label: 'Get this movie', icon: 'cloud_download' }
    };
    // What can be done for a view. A show already in Jellyfin only offers new
    // episodes (its old ones are already there).
    const actions = (v, { inLibrary = false } = {}) => {
        v = latest(v);
        if (!v) return [];
        if (v.kind === 'movie') return !v.added && !v.hasFile && !inLibrary ? [ACTIONS.movie] : [];
        const list = [];
        // an ended show has no new episodes to get
        if (!v.newEpisodes && v.status !== 'ended') list.push(ACTIONS.new);
        if (!inLibrary && (!v.added || (v.episodeFiles || 0) < (v.episodes || 0))) list.push(ACTIONS.all, ACTIONS.latest);
        return list;
    };

    const question = (a, name) => (a.id === 'new' ? `Get new episodes of ${name}?`
        : a.id === 'all' ? `Get every episode of ${name}?`
            : a.id === 'latest' ? `Get the latest season of ${name}?`
                : `Get ${name}?`);
    const doneText = (a, v) => (a.id === 'new' ? `Getting new episodes of ${v.title}`
        : a.id === 'all' ? `Getting every episode of ${v.title} · searching`
            : a.id === 'latest' ? `Getting the latest season of ${v.title} · searching`
                : `Getting ${v.title} · searching`);

    // Runs actions for one screen. toast({ text, kind: ''|'ok'|'err'|'confirm',
    // ms, question, name, hint }) shows a message; update(view) redraws with
    // the new view. hint is how the screen says "again" ("Press OK again").
    const runner = ({ toast = () => {}, update = () => {}, hint = 'Press OK again', confirmMs = CONFIRM_MS } = {}) => {
        const again = () => (typeof hint === 'function' ? hint() : hint);
        let armed = null; // { k, id, timer }
        const busy = new Set(); // keys with a request out
        let alive = true;
        const disarm = (redraw = true) => {
            if (!armed) return;
            clearTimeout(armed.timer);
            const was = armed.view;
            armed = null;
            if (redraw && alive) update(was);
        };
        const isArmed = (a, v) => !!armed && !!a && !!v && armed.k === key(v) && armed.id === a.id;
        const press = async (a, v) => {
            if (!a || !v || !alive) return null;
            v = latest(v);
            const k = key(v);
            if (busy.has(k)) {
                toast({ text: `Still asking ${v.kind === 'movie' ? 'Radarr' : 'Sonarr'} about ${v.title}…` });
                return null;
            }
            if (!isArmed(a, v)) {
                disarm(false);
                armed = { k, id: a.id, view: v, timer: setTimeout(() => disarm(), confirmMs) };
                const q = question(a, v.title);
                const h = again();
                toast({ text: `${q} ${h}`, kind: 'confirm', ms: confirmMs, question: q, name: v.title, hint: h });
                update(v);
                return null;
            }
            disarm(false);
            busy.add(k);
            const app = v.kind === 'movie' ? 'Radarr' : 'Sonarr';
            toast({ text: v.added ? `Asking ${app}…` : `Adding ${v.title} to ${app}…`, ms: 60000 });
            update(v);
            try {
                const next = v.kind === 'movie' ? await addMovie(v.tmdbId) : await addShow(v.tvdbId, a.monitor || 'future');
                if (!alive) return next;
                busy.delete(k);
                toast({ text: doneText(a, next || v), kind: 'ok' });
                update(next || v);
                return next;
            } catch (err) {
                busy.delete(k);
                console.warn('[HOMER Arr] add failed:', err);
                if (!alive) return null;
                toast({ text: err.code === 'timeout' ? `${app} didn't answer. Try again in a minute` : `Couldn't add ${v.title}: ${err.message}`, kind: 'err' });
                update(v);
                return null;
            }
        };
        return {
            press,
            armed: isArmed,
            label: (a, v) => (isArmed(a, v) ? a.label + '?' : a.label),
            busy: (v) => !!v && busy.has(key(v)),
            disarm: () => disarm(),
            dispose() {
                alive = false;
                if (armed) clearTimeout(armed.timer);
                armed = null;
            }
        };
    };

    window.HomerArr = {
        version: VERSION,
        base,
        key,
        // client
        lookup, peek, status, peekStatus, addShow, addMovie, upcoming, available,
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        latest,
        // matching
        norm, words, matchScore, rank, sameAs, findShow, getIt, img,
        // saying it
        statusText, tone, chipHtml, flagText, flagHtml, detailText, airWord, actions, ACTIONS, runner
    };
})();
