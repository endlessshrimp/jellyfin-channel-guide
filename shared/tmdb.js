/*
 * HOMER + TMDB: what's out there, not only what's already in the library.
 *
 * Jellyfin's own TMDb plugin fills in metadata for things Jason already has.
 * This is the other half: what's trending, what's in theaters or on the air,
 * what's coming, and what's like the thing he's looking at — none of which is
 * in his library yet. Every one of them hands straight to shared/arr.js, so a
 * row is one press away from Sonarr or Radarr going and getting it.
 *
 * TMDB wants a key, and the key never comes near the browser: it lives on the
 * NAS with HOMER's helper (homerfeeds.py), which adds it to the handful of
 * TMDB paths below and hands back only what a row needs:
 *   GET /tmdb/health                     -> {configured, stub}
 *   GET /tmdb/row?kind=movie|show&row=trending|now|soon
 *   GET /tmdb/similar?kind=&id=<tmdbId>  recommendations, then TMDB's "similar"
 *   GET /tmdb/external?id=<tmdbId>       a show's TheTVDB id, which Sonarr wants
 * With no key on the NAS the helper answers "tmdb_not_configured", available()
 * is false for the rest of the sitting, and every screen simply draws no TMDB
 * rows: nothing else about the screen changes.
 *
 * A card is one thing TMDB knows about:
 *   {kind:'movie'|'show', tmdbId, title, year, date, overview, poster, fanart,
 *    rating, votes, source:'tmdb'}
 *
 *   available()                  → true when the NAS has a key (asked once)
 *   rows(kind, {signal})         → [{key, label, items:[card]}] — trending, now, soon
 *   row(kind, key, {signal})     → {key, label, items} or null
 *   similar(kind, tmdbId)        → [card] ("More like this")
 *   drop(cards, library)         → the cards that library hasn't got
 *   ownedBy(card, library)       → the Jellyfin item that is this card, or null
 *   view(card)                   → a shared/arr.js view for the Add flow; for a
 *                                  show it resolves TheTVDB id first (TMDB's
 *                                  external_ids, then Sonarr's own search), so
 *                                  the button is never dead
 *   peek(card)                   → the view we already hold, or null (no request)
 *   status(card)                 → Sonarr's or Radarr's word on it (a request)
 *   label(key) / ROWS            → the row names
 *   img(url, size)               → shared/arr.js's smaller picture
 *
 * window.HomerTmdb = { …all of the above, base, version }
 */
(() => {
    const VERSION = '0.1.0';

    const TIMEOUT_MS = 15000;
    const ROW_TTL = 30 * 60000; // the helper keeps them half an hour too
    const IDS_TTL = 6 * 3600000; // a show's TheTVDB id doesn't change

    // HOMER's helper on the NAS, the same way shared/arr.js finds it
    const base = () => (window.HomerArr ? window.HomerArr.base()
        : (location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095'));

    const ROWS = {
        movie: [
            { key: 'trending', label: 'Trending this week' },
            { key: 'now', label: 'In theaters now' },
            { key: 'soon', label: 'Coming soon' }
        ],
        show: [
            { key: 'trending', label: 'Trending this week' },
            { key: 'now', label: 'On the air' },
            { key: 'soon', label: 'Coming soon' }
        ]
    };
    const label = (kind, key) => {
        const r = (ROWS[kind === 'show' ? 'show' : 'movie'] || []).find((x) => x.key === key);
        return r ? r.label : '';
    };

    // ---------- Client ----------

    const cache = new Map(); // url -> { at, ttl, value }
    const inflight = new Map();
    const cached = (url) => {
        const hit = cache.get(url);
        return hit && Date.now() - hit.at < hit.ttl ? hit.value : null;
    };

    const request = async (url, { signal } = {}) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        const onAbort = () => ctl.abort();
        if (signal) {
            if (signal.aborted) ctl.abort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
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
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    };

    const get = (path, ttl, opts = {}) => {
        const url = base() + path;
        const hit = cached(url);
        if (hit) return Promise.resolve(hit);
        let p = inflight.get(url);
        if (!p) {
            p = request(url, {}).then((v) => {
                cache.set(url, { at: Date.now(), ttl, value: v });
                while (cache.size > 40) cache.delete(cache.keys().next().value);
                return v;
            }).finally(() => inflight.delete(url));
            inflight.set(url, p);
        }
        const { signal } = opts;
        if (!signal) return p;
        return new Promise((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            p.then(resolve, reject);
        });
    };

    // ---------- Is TMDB set up at all? ----------
    // Asked once. Until the answer is in, screens draw nothing; when it's no,
    // they go on drawing nothing and say nothing about it — this is a thing
    // Jason may simply not have turned on.

    let health = null; // Promise<bool>
    const available = () => {
        if (!health) {
            health = request(base() + '/tmdb/health', {})
                .then((v) => !!(v && v.configured))
                .catch(() => false);
        }
        return health;
    };

    // ---------- The rows ----------

    const kindOf = (k) => (k === 'show' || k === 'tv' || k === 'series' || k === 'tvshows' ? 'show' : 'movie');

    const row = async (kind, key, opts = {}) => {
        const k = kindOf(kind);
        if (!(await available())) return null;
        try {
            const res = await get(`/tmdb/row?kind=${k}&row=${encodeURIComponent(key)}`, ROW_TTL, opts);
            const items = (res && res.items) || [];
            return items.length ? { key, kind: k, label: (res && res.label) || label(k, key), items } : null;
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            console.warn('[HOMER TMDB] row', key, 'failed:', err.message || err);
            return null;
        }
    };

    // every row for a screen, at once; the ones that answer are the ones drawn
    const rows = async (kind, opts = {}) => {
        const k = kindOf(kind);
        if (!(await available())) return [];
        const list = await Promise.all(ROWS[k].map((r) => row(k, r.key, opts).catch(() => null)));
        return list.filter((r) => r && r.items.length);
    };

    const similar = async (kind, tmdbId, opts = {}) => {
        const k = kindOf(kind);
        if (!tmdbId || !(await available())) return [];
        try {
            const res = await get(`/tmdb/similar?kind=${k}&id=${encodeURIComponent(tmdbId)}`, ROW_TTL, opts);
            return (res && res.items) || [];
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            console.warn('[HOMER TMDB] similar failed:', err.message || err);
            return [];
        }
    };

    // ---------- What's already his ----------
    // shared/arr.js already knows how to tell a show or movie from a Jellyfin
    // item (Tvdb/Tmdb ids, else title and year): this is that, not a second one.

    const A = () => window.HomerArr || null;
    const ownedBy = (card, library) => {
        const arr = A();
        if (!card || !arr || !library) return null;
        const v = peek(card) || asView(card);
        return library.find((it) => arr.sameAs(v, it)) || null;
    };
    const drop = (cards, library) => (cards || []).filter((c) => !ownedBy(c, library));

    // ---------- Handing a card to Sonarr or Radarr ----------

    // a card as shared/arr.js says things: enough for its chips, its actions
    // and its runner. Nothing is claimed about Sonarr or Radarr here — a
    // status() fills that in when one comes back.
    const asView = (card) => (card.kind === 'show'
        ? {
            kind: 'show', tvdbId: card.tvdbId || 0, tmdbId: card.tmdbId, title: card.title, year: card.year,
            overview: card.overview, poster: card.poster, fanart: card.fanart, status: '',
            added: false, monitored: false, newEpisodes: false, episodes: 0, episodeFiles: 0
        }
        : {
            kind: 'movie', tmdbId: card.tmdbId, title: card.title, year: card.year,
            overview: card.overview, poster: card.poster, fanart: card.fanart, status: '',
            added: false, monitored: false, hasFile: false, runtime: 0
        });

    const ids = new Map(); // 'show:<tmdbId>' -> { at, tvdbId }
    const views = new Map(); // 'movie:<tmdbId>' | 'show:<tmdbId>' -> view
    const ckey = (card) => (card ? card.kind + ':' + card.tmdbId : '');

    // what we already hold for a card: an add's answer or a status if one has
    // come back, else nothing. Never makes a request.
    const peek = (card) => {
        const arr = A();
        const had = views.get(ckey(card));
        return had && arr ? arr.latest(had) : had || null;
    };

    // A show's TheTVDB id: TMDB hands out TMDB ids and Sonarr wants TheTVDB's.
    // TMDB's external_ids has it; a show too new or too obscure to have one
    // falls back to Sonarr's own search for the title, which is what the rest
    // of HOMER uses anyway. 0 when neither knows it.
    const tvdbFor = async (card) => {
        if (card.kind !== 'show') return 0;
        if (card.tvdbId) return card.tvdbId;
        const k = ckey(card);
        const had = ids.get(k);
        if (had && Date.now() - had.at < IDS_TTL) return had.tvdbId;
        let tvdbId = 0;
        try {
            const res = await get(`/tmdb/external?id=${encodeURIComponent(card.tmdbId)}`, IDS_TTL);
            tvdbId = Number(res && res.tvdbId) || 0;
        } catch (err) {
            console.warn('[HOMER TMDB] external ids failed:', err.message || err);
        }
        if (!tvdbId && A()) {
            try {
                const hit = await A().findShow(card.title, { year: card.year });
                tvdbId = (hit && Number(hit.tvdbId)) || 0;
            } catch { /* Sonarr didn't answer either */ }
        }
        ids.set(k, { at: Date.now(), tvdbId });
        return tvdbId;
    };

    // The view a card's Add button acts on. For a movie that's ready at once.
    // For a show it waits on TheTVDB id, so pressing Get never runs into a
    // missing one. Throws when a show can't be pinned down at all.
    const view = async (card) => {
        if (!card) return null;
        const k = ckey(card);
        const had = peek(card);
        if (had && (had.kind === 'movie' || had.tvdbId)) return had;
        const v = asView(card);
        if (v.kind === 'show') {
            v.tvdbId = await tvdbFor(card);
            if (!v.tvdbId) {
                const err = new Error(`Sonarr doesn't know ${card.title}`);
                err.code = 'no_tvdb';
                throw err;
            }
        }
        const held = views.get(k);
        views.set(k, held ? Object.assign({}, v, held) : v);
        return views.get(k);
    };

    // Sonarr's or Radarr's word on a card (added? downloading? already there?).
    // One request; whatever comes back is what peek() hands out afterwards.
    const status = async (card) => {
        const arr = A();
        if (!arr) return null;
        const v = await view(card);
        if (!v) return null;
        try {
            const fresh = await arr.status(v.kind === 'movie' ? { tmdbId: v.tmdbId } : { tvdbId: v.tvdbId });
            if (fresh && fresh.kind) {
                // TMDB's picture is usually the better one; Sonarr's is the
                // truth about what's downloaded
                views.set(ckey(card), Object.assign({}, fresh, {
                    poster: fresh.poster || v.poster,
                    fanart: fresh.fanart || v.fanart
                }));
            }
            return peek(card);
        } catch (err) {
            if (err && err.message === 'not found') return v; // not in their reach; the add still works
            console.warn('[HOMER TMDB] status failed:', err.message || err);
            return v;
        }
    };

    // a view that came back changed (an add, a fresh status): keep it
    if (window.HomerArr) {
        window.HomerArr.onChange((v) => {
            if (!v || !v.tmdbId) return;
            const k = (v.kind === 'movie' ? 'movie:' : 'show:') + v.tmdbId;
            if (views.has(k)) views.set(k, v);
        });
    }

    const img = (url, size) => (A() ? A().img(url, size) : url || '');

    // "2025 · ★ 7.8", "Coming Friday"
    const when = (card) => {
        if (!card || !card.date) return '';
        const d = new Date(card.date + 'T12:00:00');
        if (isNaN(d)) return '';
        const days = Math.round((d - new Date(new Date().setHours(12, 0, 0, 0))) / 86400000);
        if (days <= 0) return '';
        if (days === 1) return 'Tomorrow';
        if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    window.HomerTmdb = {
        version: VERSION,
        base,
        ROWS,
        label,
        available,
        rows,
        row,
        similar,
        ownedBy,
        drop,
        view,
        peek,
        status,
        tvdbFor,
        asView,
        img,
        when
    };
})();
