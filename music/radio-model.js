/*
 * HOMER Radio: internet radio beside the library on the Music screen — SomaFM,
 * the local DFW stations, and anything else worth finding. The data and the
 * plumbing live here; the Radio tab itself is drawn by music/music.js (TV) and
 * music/music-phone.js (phone).
 *
 * Where the stations come from
 *
 *   SomaFM      https://somafm.com/channels.json — the whole channel list with
 *               its descriptions, artwork and streams, straight from the
 *               browser (it answers CORS "*", and everything it hands back is
 *               https). Its own row, because they're the best of it.
 *   Radio       https://all.api.radio-browser.info — the open, volunteer-run
 *   Browser     catalogue behind most radio apps, and the closest thing to an
 *               open TuneIn. It's how Local and Search work, and it's why a
 *               station HOMER knows is a *lookup*, not a pasted URL: a seed
 *               below is a name and a station UUID, resolved fresh, so a
 *               stream that dies can be resolved again instead of 404-ing
 *               forever. HOMER goes through the NAS helper (homerfeeds
 *               /radio/rb) so the calls carry a real User-Agent — a browser
 *               can't set one — and are cached for ten minutes, which is
 *               their etiquette. Without the helper it asks them directly.
 *
 * https, and what it breaks
 *
 * HOMER on the LAN is plain http and can play anything. At https://media.nel.sn
 * a plain-http stream is mixed content and the browser kills it dead, so those
 * go through the helper's narrow relay (/radio/stream, http-only, audio-only).
 * With no helper they're marked unplayable here and stay playable on a speaker.
 * SomaFM needs none of this: it's https all the way down.
 *
 * What's actually playing on the station
 *
 *   SomaFM      publishes it: /songs/<id>.json, artist, title and album.
 *   Everyone    mostly sends ICY metadata inside the audio, which a browser
 *   else        cannot read off an <audio> element at all. The helper can, so
 *               HOMER asks it (/radio/icy) — one metadata block, cached. Talk
 *               and sports stations usually send nothing but their own name,
 *               and that is a real answer: HOMER shows the station and stops
 *               there rather than inventing a track.
 *   On a        Music Assistant reads the ICY itself, server-side, so a
 *   speaker     station playing on a speaker names its track even when the
 *               browser couldn't.
 *
 * Favourites are HOMER's, not Jellyfin's. Every other star in Music is a
 * Jellyfin favourite, the same in every client, because those are Jellyfin
 * items. A radio station isn't one — Jellyfin has never heard of it — so a
 * starred station is kept per device in localStorage (homer-radio-favorites),
 * with enough of the station saved that the star still works when Radio
 * Browser is unreachable. Stars don't follow you to another device.
 *
 * window.HomerRadioModel = { load, loaded, error, soma, local, favorites,
 *   stations, station, search, isFavorite, setFavorite, toggleFavorite,
 *   asTrack, playUrl, nowPlaying, speakers, sendTo, sent, art, helper,
 *   onChange, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerRadioModel && typeof window.HomerRadioModel.destroy === 'function') {
        window.HomerRadioModel.destroy();
    }

    const FAV_KEY = 'homer-radio-favorites';
    const SEEN_KEY = 'homer-radio-seen'; // stations met through Search, so a favourite of one survives
    const SENT_KEY = 'homer-radio-sent'; // entity id -> the station HOMER put there
    const SENT_TTL = 12 * 3600 * 1000;
    const SOMA_URL = 'https://somafm.com/channels.json';
    const RB_URL = 'https://all.api.radio-browser.info';
    const warn = (...a) => console.warn('[HOMER Radio]', ...a);

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };
    const listeners = new Set();
    const emit = (what) => listeners.forEach((fn) => {
        try { fn(what); } catch (err) { console.error('[HOMER Radio]', err); }
    });

    // ---------- The NAS helper ----------
    // Same address rule as music/playon.js and the news hub: through the https
    // name's /homer-feeds, or port 8095 on the LAN.

    const helper = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');
    let helperOk = null; // null = not asked yet
    let helperJob = null;
    const askHelper = () => {
        if (helperOk !== null) return Promise.resolve(helperOk);
        if (helperJob) return helperJob;
        helperJob = fetch(helper() + '/health', { cache: 'no-store' })
            .then((r) => r.ok)
            .catch(() => false)
            .then((ok) => { helperOk = ok; helperJob = null; emit('helper'); return ok; });
        return helperJob;
    };
    askHelper();

    // ---------- Radio Browser ----------
    //
    // Through the helper when it's there (a real User-Agent, and a cache in
    // front of a service run on donated hardware), directly when it isn't.

    const rb = async (path, params) => {
        const query = new URLSearchParams(Object.assign({ hidebroken: 'true' }, params || {})).toString();
        if (await askHelper()) {
            const url = `${helper()}/radio/rb?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Radio Browser said ${res.status}`);
            const out = await res.json();
            if (out && out.error) throw new Error(out.error);
            return out;
        }
        const res = await fetch(`${RB_URL}${path}?${query}`);
        if (!res.ok) throw new Error(`Radio Browser said ${res.status}`);
        return res.json();
    };

    // ---------- Normalizing a station ----------

    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    // Radio Browser names carry their call sign, city and codec: "KKXT 'KXT
    // 91.7' Dallas, TX (AAC)". The list reads better with the quotes unpicked.
    const tidyName = (name) => {
        const quoted = /["“']([^"“”']{3,40})["”']/.exec(name || '');
        return clean(quoted ? quoted[1] : (name || '')).replace(/\s*\((MP3|AAC\+?|OGG|HLS)\)\s*$/i, '');
    };

    const somaStation = (c) => {
        // The highest-quality stream SomaFM offers, preferring the one a
        // browser is surest of: AAC at 128 or MP3 at 128, both https.
        const pls = (c.playlists || []).slice().sort((a, b) => {
            const rank = (p) => (p.quality === 'highest' ? 0 : p.quality === 'high' ? 1 : 2)
                + (p.format === 'aac' ? 0 : p.format === 'mp3' ? 0.1 : 0.2);
            return rank(a) - rank(b);
        });
        return {
            kind: 'station',
            source: 'soma',
            id: 'soma:' + c.id,
            somaId: c.id,
            name: clean(c.title),
            sub: clean(c.genre || '').replace(/\|/g, ' · '),
            overview: clean(c.description),
            artUrl: c.xlimage || c.largeimage || c.image || '',
            artSmall: c.largeimage || c.image || c.xlimage || '',
            homepage: 'https://somafm.com/' + c.id + '/',
            listeners: +c.listeners || 0,
            lastPlaying: clean(c.lastPlaying),
            playlists: pls.map((p) => ({ url: p.url, format: p.format, quality: p.quality })),
            url: '', // filled in by resolveSoma, from the .pls
            codec: (pls[0] || {}).format || '',
            bitrate: 0,
            tags: (c.genre || '').split('|').filter(Boolean),
        };
    };

    const rbStation = (s) => ({
        kind: 'station',
        source: 'rb',
        id: 'rb:' + s.stationuuid,
        uuid: s.stationuuid,
        name: tidyName(s.name) || clean(s.name),
        fullName: clean(s.name),
        sub: [s.state, s.country === 'The United States Of America' ? 'US' : s.country].filter(Boolean).join(' · '),
        overview: '',
        // an http favicon is mixed content on https HOMER, and most of them are
        // a 16px .ico anyway: a letter tile reads better than a blurry crumb
        artUrl: /^https:/i.test(s.favicon || '') ? s.favicon : '',
        homepage: s.homepage || '',
        url: s.url_resolved || s.url || '',
        codec: s.codec || '',
        bitrate: +s.bitrate || 0,
        hls: !!s.hls,
        votes: +s.votes || 0,
        working: s.lastcheckok !== 0,
        tags: String(s.tags || '').split(',').map(clean).filter(Boolean),
        country: s.countrycode || '',
    });

    // ---------- The local seeds ----------
    //
    // Jason's four. Each is a Radio Browser lookup, not a URL: the UUID first
    // (so the name on screen is HOMER's, not whatever the catalogue calls it
    // this week), then a name search if that UUID has gone. 105.3 The Fan is
    // the exception — Audacy's own feed, which Radio Browser does not list at
    // all — so it carries a direct address and says so.

    const SEEDS = [
        { key: 'kera', name: 'KERA 90.1', sub: 'Dallas · NPR news and talk',
            uuid: '96255788-0601-11e8-ae97-52543be04c81', find: 'KERA 90.1' },
        { key: 'kxt', name: 'KXT 91.7', sub: 'Dallas · music, publicly funded',
            uuid: '56a468c9-3eca-4079-a758-b4051e1afb2b', find: 'KXT' },
        { key: 'ticket', name: 'The Ticket 1310', sub: 'Dallas · sports talk',
            uuid: 'f63cde9f-f826-44cc-98d5-98cc74b258c2', find: 'The Ticket' },
        { key: 'fan', name: '105.3 The Fan', sub: 'Dallas · sports talk',
            url: 'https://live.amperwave.net/direct/audacy-krldfmaac-imc', codec: 'AAC+',
            note: 'Audacy’s own feed — Radio Browser doesn’t list this one' },
    ];

    // ---------- Loading ----------

    let somaList = [];
    let localList = [];
    let loaded = false;
    let lastError = null;
    let loading = null;

    // A SomaFM channel's playlists are .pls files, not streams. They're small,
    // https and CORS-open, so read the first entry out of one.
    const plsCache = new Map();
    const resolveSoma = async (st) => {
        if (st.url) return st.url;
        for (const p of st.playlists) {
            if (plsCache.has(p.url)) {
                const hit = plsCache.get(p.url);
                if (hit) { st.url = hit; st.codec = p.format; return hit; }
                continue;
            }
            try {
                const text = await fetch(p.url).then((r) => (r.ok ? r.text() : ''));
                const m = /^File\d+\s*=\s*(\S+)/m.exec(text || '');
                plsCache.set(p.url, m ? m[1] : '');
                if (m) { st.url = m[1]; st.codec = p.format; return m[1]; }
            } catch (err) {
                plsCache.set(p.url, '');
                warn('pls', p.url, err.message);
            }
        }
        return '';
    };

    const loadSoma = async () => {
        const res = await fetch(SOMA_URL);
        if (!res.ok) throw new Error(`SomaFM said ${res.status}`);
        const data = await res.json();
        somaList = (data.channels || []).map(somaStation)
            .sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name));
        remember(somaList);
        emit('soma');
    };

    const loadSeed = async (seed) => {
        const base = {
            kind: 'station', source: seed.uuid ? 'rb' : 'seed', id: 'seed:' + seed.key,
            name: seed.name, sub: seed.sub, overview: seed.note || '', artUrl: '',
            url: seed.url || '', codec: seed.codec || '', bitrate: 0, tags: ['local'], local: true,
        };
        if (!seed.uuid) return base;
        const take = (row) => {
            const st = rbStation(row);
            return Object.assign(base, {
                uuid: st.uuid, url: st.url, codec: st.codec, bitrate: st.bitrate,
                homepage: st.homepage, artUrl: st.artUrl, working: st.working,
                rbId: st.id, rbName: st.fullName,
            });
        };
        try {
            const byId = await rb('/json/stations/byuuid/' + seed.uuid, {});
            if (byId && byId[0] && (byId[0].url_resolved || byId[0].url)) return take(byId[0]);
        } catch (err) {
            warn('seed', seed.key, err.message);
        }
        try {
            // the UUID is gone or broken: find it again by name, best-voted first
            const found = await rb('/json/stations/search', {
                name: seed.find || seed.name, countrycode: 'US', limit: '5', order: 'votes', reverse: 'true',
            });
            if (found && found[0]) return Object.assign(take(found[0]), { reresolved: true });
        } catch (err) {
            warn('seed search', seed.key, err.message);
        }
        return base;
    };

    const loadLocal = async () => {
        localList = await Promise.all(SEEDS.map(loadSeed));
        remember(localList);
        emit('local');
    };

    const load = (force) => {
        if (loading) return loading;
        if (loaded && !force) return Promise.resolve();
        lastError = null;
        loading = Promise.all([
            loadSoma().catch((err) => { warn(err); lastError = err.message; }),
            loadLocal().catch((err) => { warn(err); lastError = lastError || err.message; }),
        ]).then(() => {
            loaded = true;
            loading = null;
            emit('loaded');
        });
        return loading;
    };

    // ---------- Search ----------

    const searchJobs = new Map();
    const search = (text) => {
        const term = clean(text);
        if (term.length < 2) return Promise.resolve([]);
        if (searchJobs.has(term)) return searchJobs.get(term);
        const job = rb('/json/stations/search', {
            name: term, limit: '60', order: 'votes', reverse: 'true',
        }).then((rows) => {
            const seen = new Set();
            const out = [];
            for (const row of rows || []) {
                const st = rbStation(row);
                if (!st.url || seen.has(st.url)) continue; // the same feed listed twice
                seen.add(st.url);
                out.push(st);
            }
            remember(out);
            return out;
        }).finally(() => searchJobs.delete(term));
        searchJobs.set(term, job);
        return job;
    };

    // ---------- Every station HOMER has met ----------
    //
    // So a favourite, a "what's this that's playing" or a station sent to a
    // speaker still has a name and a picture after a reload, with nothing
    // fetched.

    const seen = new Map(Object.entries(store.get(SEEN_KEY, {}) || {}));
    let seenDirty = false;
    const remember = (list) => {
        (Array.isArray(list) ? list : [list]).forEach((st) => {
            if (st && st.id) { seen.set(st.id, st); seenDirty = true; }
        });
        if (!seenDirty) return;
        seenDirty = false;
        // only what's starred or local is worth keeping across reloads
        const keep = {};
        for (const [id, st] of seen) if (favs[id] || st.local) keep[id] = st;
        store.set(SEEN_KEY, keep);
    };
    const stations = () => [...seen.values()];
    const station = (id) => seen.get(id) || favs[id] || null;

    // ---------- Favourites (HOMER's own, per device) ----------

    let favs = store.get(FAV_KEY, {}) || {};
    const isFavorite = (st) => {
        const id = typeof st === 'string' ? st : (st && st.id);
        return !!(id && favs[id]);
    };
    const favorites = () => Object.values(favs).sort((a, b) => (b.at || 0) - (a.at || 0));
    const setFavorite = (st, on) => {
        const id = typeof st === 'string' ? st : (st && st.id);
        if (!id) return;
        const it = typeof st === 'string' ? station(st) : st;
        const want = on == null ? !favs[id] : !!on;
        if (want) {
            if (!it) return;
            favs[id] = Object.assign({}, it, { at: Date.now() });
        } else {
            delete favs[id];
        }
        store.set(FAV_KEY, favs);
        if (it) remember(it);
        emit('favorites');
    };
    const toggleFavorite = (st) => setFavorite(st, !isFavorite(st));

    // ---------- Playing it here ----------

    // What the <audio> element should actually be given, and whether it can be
    // given anything at all.
    // Some stations (the BBC's among them) only publish HLS. Safari plays it;
    // Chrome doesn't without a library, and HOMER isn't going to carry one for
    // radio. Music Assistant handles it either way.
    let hlsOk = null;
    const canHls = () => {
        if (hlsOk === null) {
            try { hlsOk = !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl'); }
            catch { hlsOk = false; }
        }
        return hlsOk;
    };
    const isHls = (st) => !!(st && (st.hls || /\.m3u8(\?|$)/i.test(st.url || '')));

    const playUrl = (st) => {
        if (isHls(st) && !canHls()) {
            return { url: '', why: 'This station only streams HLS, which this browser won\u2019t play. It still plays on a speaker.' };
        }
        // A SomaFM channel's address is inside a .pls that hasn't been read
        // yet. It's https either way, so it counts as playable; tune() fetches
        // it at the moment it's wanted.
        if (st && !st.url && st.source === 'soma' && (st.playlists || []).length) return { url: '', pending: true };
        if (!st || !st.url) return { url: '', why: 'HOMER has no address for this station yet' };
        if (/^https:/i.test(st.url)) return { url: st.url };
        if (location.protocol !== 'https:') return { url: st.url }; // HOMER on the LAN: play it as it is
        if (helperOk) {
            return { url: helper() + '/radio/stream?url=' + encodeURIComponent(st.url), proxied: true };
        }
        return {
            url: '',
            proxied: false,
            why: 'This station is plain http, and HOMER is on https. The NAS helper would relay it, but it isn’t answering — it will still play on a speaker.',
        };
    };
    const playable = (st) => {
        const p = playUrl(st);
        return !!(p.url || p.pending);
    };

    // The station as something music/music-model.js's player can hold: a track
    // with `live` on it, no duration, and its own address. The player knows not
    // to preload a next track, not to look for lyrics and not to report a live
    // station to Jellyfin, which has never heard of it.
    const asTrack = (st) => {
        const p = playUrl(st);
        if (!p.url) return null;
        remember(st);
        return {
            kind: 'track',
            live: true,
            stationId: st.id,
            id: st.id,
            name: st.name,
            artists: st.sub ? [st.sub] : [],
            artist: st.sub || '',
            albumArtist: '',
            album: '',
            artistIds: [],
            albumId: '',
            imageTag: '',
            artUrl: st.artUrl || '',
            duration: 0,
            year: null,
            genres: st.tags || [],
            favorite: isFavorite(st),
            streamUrl: p.url,
            proxied: !!p.proxied,
            overview: st.overview || '',
        };
    };

    // tune(station) -> Promise<track | null>. asTrack() is the same thing for a
    // station whose address is already known; this one reads a SomaFM .pls
    // first, at the moment somebody actually presses play.
    const tune = async (st) => {
        if (st && !st.url && st.source === 'soma') await resolveSoma(st);
        return asTrack(st);
    };

    // ---------- What's playing on the station ----------

    const npCache = new Map(); // station id -> { at, np }
    const NP_TTL = 15000;

    const somaNowPlaying = async (st) => {
        const res = await fetch(`https://somafm.com/songs/${encodeURIComponent(st.somaId)}.json`);
        if (!res.ok) throw new Error(`SomaFM said ${res.status}`);
        const data = await res.json();
        const s = (data.songs || [])[0];
        if (!s || !s.title) return null;
        return {
            title: clean(s.title),
            artist: clean(s.artist),
            album: clean(s.album),
            from: 'SomaFM',
        };
    };
    const icyNowPlaying = async (st) => {
        if (!(await askHelper())) return null;
        const res = await fetch(`${helper()}/radio/icy?url=${encodeURIComponent(st.url)}`);
        if (!res.ok) return null;
        const out = await res.json();
        const raw = clean(out && out.title);
        if (!raw) return out && out.name ? { title: '', artist: '', station: clean(out.name), from: 'ICY' } : null;
        // almost everyone sends "Artist - Title"; a few send just the title
        const m = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(raw);
        return m
            ? { artist: clean(m[1]), title: clean(m[2]), album: '', from: 'ICY' }
            : { artist: '', title: raw, album: '', from: 'ICY' };
    };

    // nowPlaying(station) -> { title, artist, album, from } | null
    // null is an honest answer: plenty of stations publish nothing at all.
    const nowPlaying = (st) => {
        if (!st) return Promise.resolve(null);
        const hit = npCache.get(st.id);
        if (hit && Date.now() - hit.at < NP_TTL) return Promise.resolve(hit.np);
        const job = (st.source === 'soma' ? somaNowPlaying(st) : icyNowPlaying(st))
            .catch((err) => { warn('now playing', st.id, err.message); return null; })
            .then((np) => { npCache.set(st.id, { at: Date.now(), np }); return np; });
        return job;
    };

    // ---------- Playing it on a speaker (Music Assistant) ----------
    //
    // Music Assistant is the one thing in the house that takes a radio station
    // as a radio station: music_assistant.play_media with media_type "radio"
    // and the stream's own address, which it turns into builtin://radio/<url>.
    // It fetches the stream itself, so a plain-http station is no trouble at
    // all, and it reads the ICY metadata a browser can't.
    //
    // Its players are separate entities from the speakers' own (a WiiM shows up
    // twice in Home Assistant: once as linkplay, once as Music Assistant), and
    // they carry no area, so they aren't in music/playon.js's room-ordered
    // list. This is its own list, of Music Assistant's players only.

    const HA = () => window.HomerHA || null;
    const speakers = () => {
        const h = HA();
        if (!h || !h.isSetUp || !h.isSetUp() || !h.massPlay) return [];
        let all = [];
        try { all = h.players(); } catch (err) { warn(err); return []; }
        const out = [];
        for (const id of all) {
            const s = h.entity(id);
            if (!s || !s.attributes || !s.attributes.mass_player_type) continue;
            const a = s.attributes;
            const members = (Array.isArray(a.group_members) ? a.group_members : []).filter((m) => m !== id);
            // A player can be tied to others (the two WiiMs are one Music
            // Assistant group), and sending to it sounds all of them. The row
            // has to say so, or you tune one room and hear two.
            const withNames = members
                .map((m) => clean(((h.entity(m) || { attributes: {} }).attributes.friendly_name) || h.name(m, '') || ''))
                .filter(Boolean);
            out.push({
                id,
                name: clean(a.friendly_name || h.name(id, '') || id),
                group: a.mass_player_type === 'group',
                members,
                withNames,
                state: s.state,
                away: s.state === 'unavailable',
                busy: s.state === 'playing' || s.state === 'paused',
                playing: clean(a.media_title || ''),
                icon: a.mass_player_type === 'group' ? 'speaker_group' : 'speaker',
            });
        }
        out.sort((a, b) => Number(a.away) - Number(b.away)
            || Number(b.group) - Number(a.group)
            || a.name.localeCompare(b.name));
        return out;
    };

    // What HOMER put where, so Now Playing can name the station a speaker is
    // reporting only as a URL. Same idea (and TTL) as music/playon.js's sent().
    const readSent = () => {
        const all = store.get(SENT_KEY, {}) || {};
        const now = Date.now();
        let changed = false;
        for (const k of Object.keys(all)) {
            if (!all[k] || now - (all[k].at || 0) > SENT_TTL) { delete all[k]; changed = true; }
        }
        if (changed) store.set(SENT_KEY, all);
        return all;
    };
    const sent = (entityId) => {
        const all = readSent();
        return entityId ? all[entityId] || null : all;
    };
    const rememberSent = (entityId, st) => {
        const all = readSent();
        all[entityId] = { at: Date.now(), id: st.id, name: st.name, sub: st.sub || '', art: st.artUrl || '' };
        store.set(SENT_KEY, all);
    };

    // Send the station's real address, never the helper's relay: Music
    // Assistant is on the NAS's side of the https problem, not the browser's.
    const sendTo = async (speaker, st) => {
        const h = HA();
        if (!h || !h.massPlay) throw new Error('Home Assistant is not connected');
        if (!speaker || !speaker.id) throw new Error('No speaker');
        if (!st || !st.url) throw new Error('HOMER has no address for that station');
        await h.massPlay(speaker.id, st.url, 'radio');
        rememberSent(speaker.id, st);
        remember(st);
        return { name: speaker.name };
    };

    // ---------- Art ----------
    //
    // SomaFM draws its own channels. A Radio Browser station usually has
    // nothing usable, so it gets a letter tile in the station's own color,
    // which at least tells one row from the next at a glance.

    // art(station, h): SomaFM draws three sizes; a card doesn't need the 512.
    const art = (st, h) => {
        if (!st) return '';
        return (h && h <= 320 && st.artSmall) ? st.artSmall : (st.artUrl || '');
    };
    const hue = (st) => {
        const s = String((st && st.id) || '');
        let n = 0;
        for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 360;
        return n;
    };
    // The two or three characters that stand for a station with no picture. A
    // call sign if it has one (KERA, KXT, WBAP), otherwise the initials of its
    // words, otherwise the frequency it's named after.
    const initials = (st) => {
        const name = clean((st && st.name) || '');
        if (!name) return '?';
        const call = /\b([KW][A-Z]{2,3})\b/.exec(name);
        if (call) return call[1];
        const words = name.replace(/^(the|a|la|el)\s+/i, '').split(/[\s\u2013\u2014/]+/).filter(Boolean);
        const wordy = words.filter((w) => /^[A-Za-z]/.test(w));
        if (wordy.length >= 2) return (wordy[0][0] + wordy[1][0]).toUpperCase();
        if (wordy.length === 1) return wordy[0].slice(0, 2).toUpperCase();
        const num = /\d{2,4}(?:\.\d)?/.exec(name);
        return num ? num[0] : (name[0] || '?').toUpperCase();
    };

    window.HomerRadioModel = {
        version: VERSION,
        load,
        loaded: () => loaded,
        error: () => lastError,
        helper: () => ({ url: helper(), ok: helperOk }),
        soma: () => somaList,
        local: () => localList,
        favorites,
        stations,
        station,
        search,
        resolveSoma,
        isFavorite,
        setFavorite,
        toggleFavorite,
        asTrack,
        tune,
        playUrl,
        playable,
        nowPlaying,
        speakers,
        sendTo,
        sent,
        art,
        hue,
        initials,
        seeds: () => SEEDS.slice(),
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        destroy() {
            listeners.clear();
            npCache.clear();
            searchJobs.clear();
        },
    };
})();
