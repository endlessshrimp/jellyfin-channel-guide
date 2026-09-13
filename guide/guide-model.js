/*
 * Channel Guide model: the guide's data and actions, shared by its TV layout
 * (guide/guide.js) and its phone layout (guide/guide-phone.js).
 *
 * - The Jellyfin session and API.
 * - Channels, and their categories and countries (worked out from the name).
 * - Listings, loaded 3 hours at a time as they're needed, plus the next 3
 *   hours ahead, one request at a time, and kept while the guide is open.
 * - Recordings: Jellyfin's timers by program, and scheduling and cancelling,
 *   one request at a time and never a second one for the same program.
 * - Watching a channel.
 *
 * A guide opens a model with create(server) and lets it go with dispose().
 * The layout that's showing attaches to it (attach()) and says which stretch
 * of time it's showing; the model loads that first and tells it when
 * listings arrive. Switching layouts keeps the model, so nothing loads twice.
 *
 * window.HomerGuideModel = { create, CATEGORIES, COUNTRIES, categorize,
 *                            countryOf, playChannel, getServer, api, request,
 *                            util, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Listings load a screen's worth (3 hours) at a time, as they're needed, plus
    // the next 3 hours ahead of time. One request at a time: the NAS is slow
    // under load, and the whole EPG is several days of ~400 channels.
    const CHUNK_MIN = 180;
    const RETRY_MS = 15000; // a chunk that failed is tried again after this
    const MIN_MS = 60000;
    const SLOT_MIN = 30;
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

    // ---------- Time ----------

    // the half hour a time falls in (local time, so slots stay on :00 and :30)
    const floorSlot = (t) => {
        const d = new Date(t);
        d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
        return d.getTime();
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtShort = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/i, '');
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

    // Programs with a recording request on its way to Jellyfin, from any guide
    // opened in this tab. Jellyfin can take half a minute to answer one, and a
    // guide closed and reopened in the meantime mustn't send a second.
    const scheduling = new Set();

    // ---------- A guide's model ----------

    const create = (server) => {
        let disposed = false;
        let view = null; // { window() -> { start, end }, onChunk(i), onProbed() }

        // Listing chunks count from the half hour the guide opened in.
        const base = floorSlot(Date.now());
        const earliest = () => floorSlot(Date.now());
        // how far ahead there are real listings: found once the first chunk is
        // in (see probeEnd), and pushed later by any chunk that goes further.
        // Until then, a week.
        let listingsEnd = 0;
        // the latest a window of windowMin can start and still end on listings
        const latest = (windowMin) => {
            const end = listingsEnd || base + 7 * 1440 * MIN_MS;
            return Math.max(earliest(), floorSlot(end - 1) + SLOT_MIN * MIN_MS - windowMin * MIN_MS);
        };

        // ---------- Recordings ----------

        // programId -> Jellyfin timer, or null when we just created one and
        // couldn't read it back yet
        const timersByProgram = new Map();
        const loadTimers = async () => {
            const res = await api('/LiveTv/Timers');
            timersByProgram.clear();
            for (const t of (res && res.Items) || []) {
                if (t.ProgramId && t.Status !== 'Cancelled') timersByProgram.set(t.ProgramId, t);
            }
        };

        // A listing item, as the layouts hold them: { p (the program), s, e
        // (Dates), unknown (no real listing) }.
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

        // One request at a time; Jellyfin is slow to answer.
        let recBusy = false;
        let busyText = ''; // what a press says while a request is still out
        const isBusy = (programId) => recBusy || scheduling.has(programId);

        // Jellyfin can take 20 seconds or more to set a recording up (seen on the
        // NAS: 6 s for the defaults, 21 s for the POST), so it checks again just
        // before sending that nothing else (another tab, a guide closed and
        // reopened) has set it up meanwhile. Resolves true once it's set.
        const schedule = async (p) => {
            const id = p.Id;
            recBusy = true;
            busyText = `Still scheduling ${p.Name}…`;
            scheduling.add(id);
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
                return true;
            } catch (err) {
                console.error('[Channel Guide] Recording failed:', err);
                return false;
            } finally {
                recBusy = false;
                busyText = '';
                scheduling.delete(id);
            }
        };

        // Deleting the timer also stops a recording that's in progress. Resolves
        // 'gone' (cancelled or stopped), 'unset' (it wasn't set to record),
        // 'kept' (Jellyfin still has it) or 'failed'.
        const cancel = async (p, stopping) => {
            recBusy = true;
            busyText = `Still ${stopping ? 'stopping' : 'cancelling'} ${p.Name}…`;
            const gone = () => !timersByProgram.has(p.Id);
            try {
                let t = timersByProgram.get(p.Id);
                if (!t || !t.Id) {
                    // scheduled from here but not read back yet: look up its id
                    await loadTimers();
                    t = timersByProgram.get(p.Id);
                }
                if (t && t.Id) {
                    await request('DELETE', `/LiveTv/Timers/${encodeURIComponent(t.Id)}`);
                    timersByProgram.delete(p.Id);
                    try {
                        await loadTimers();
                    } catch { /* keep the local delete */ }
                }
                if (!t || !t.Id) return 'unset';
                return gone() ? 'gone' : 'kept';
            } catch (err) {
                console.error('[Channel Guide] Cancelling the recording failed:', err);
                // it may be gone anyway (cancelled somewhere else): go by what the server has
                try {
                    await loadTimers();
                } catch { /* leave the dots as they were */ }
                return gone() ? 'unset' : 'failed';
            } finally {
                recBusy = false;
                busyText = '';
            }
        };

        // ---------- Channels ----------

        let channelsP = null;
        // the channels, by number, once (with Jellyfin's timers alongside)
        const channels = () => {
            if (!channelsP) {
                channelsP = Promise.all([
                    api(`/LiveTv/Channels?userId=${server.UserId}&limit=1000&EnableImages=true&ImageTypeLimit=1&EnableUserData=true`),
                    loadTimers().catch((err) => console.warn('[Channel Guide] Could not read timers:', err))
                ]).then(([ch]) => ch.Items.sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0) || a.Name.localeCompare(b.Name)));
                channelsP.catch(() => { channelsP = null; });
            }
            return channelsP;
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
        // a channel's programs so far, by start time
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
            else listingsEnd = base + CHUNK_MS; // no listings at all
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
            if (loadingChunk || disposed || !view) return;
            const win = view.window();
            const first = chunkOf(win.start);
            const last = chunkOf(win.end - 1);
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
                        if (disposed) return;
                        if (view) view.onProbed();
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
                if (disposed) return;
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
            if (disposed) return;
            if (view) view.onChunk(i); // in the grid, if it's on screen
            pump();
        };

        return {
            server,
            base,
            CHUNK_MS,
            earliest,
            latest,
            listingsEnd: () => listingsEnd,
            chunkOf,
            chunkStart,
            chunkDone,
            chunkReady,
            chunkFailed,
            sortedFor,
            pump,
            channels,
            timersByProgram,
            loadTimers,
            recordable,
            isSet,
            airing,
            recordingNow,
            isBusy,
            busyText: () => busyText,
            schedule,
            cancel,
            // the layout that's showing: it says what time it shows, and hears
            // about listings arriving. Returns a detach function.
            attach(v) {
                view = v;
                return () => { if (view === v) view = null; };
            },
            dispose() {
                disposed = true;
                view = null;
                clearTimeout(retryTimer);
            }
        };
    };

    window.HomerGuideModel = {
        version: VERSION,
        create,
        CATEGORIES,
        COUNTRIES,
        categorize,
        countryOf,
        playChannel,
        getServer,
        api,
        request,
        PLACEHOLDER,
        util: { floorSlot, fmtTime, fmtShort, dayWord, genreOf, genreLabel, SLOT_MIN, MIN_MS, CHUNK_MIN }
    };
})();
