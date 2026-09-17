/*
 * HOMER Planes, the data: what is in the sky over the house right now.
 *
 * Where it comes from
 * -------------------
 * Two donated ADS-B feeds — adsb.fi (opendata.adsb.fi) and adsb.lol — neither
 * of which sends CORS headers, so this page can't call them itself. HOMER's
 * helper on the NAS (homerfeeds, /homer-feeds over https, port 8095 on the
 * LAN) asks them instead, at GET /planes?lat=&lon=&dist=, and hands back one
 * normalised list. adsb.fi answers first because its aircraft carry a
 * description and an operator; adsb.lol is the reserve. A flight's destination
 * isn't in an ADS-B message at all, so the helper looks callsigns up once in
 * adsbdb.com and keeps the answer for a day.
 *
 * Being polite to feeds someone else pays for
 * -------------------------------------------
 *   * One request every POLL_MS (7 seconds) while a Planes screen is open,
 *     and none when it isn't: nothing here has a timer until a screen calls
 *     watch(), and the timer stops when the last one lets go.
 *   * Nothing while the page is hidden. The tab comes back, the poll resumes.
 *   * The helper caches by place, so a second TV in the same house costs the
 *     feeds nothing at all — and if the feed is down it serves the last good
 *     answer rather than asking again and again.
 *   * A failed request backs off (7s, 14s, 28s, up to a minute) instead of
 *     retrying at full speed.
 *
 * Where the house is: Home Assistant's own config (HomerHA.location(), added
 * in v0.4.18), then HOMER's weather location, then nothing — which is a state
 * the screens draw rather than a crash.
 *
 * One model for every screen: create() hands back the same instance, so the
 * TV layout and the phone layout share one poll and one list.
 *
 * window.HomerPlanesModel = { create, RANGES, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerPlanesModel && typeof window.HomerPlanesModel.destroy === 'function') {
        window.HomerPlanesModel.destroy();
    }

    const POLL_MS = 7000; // one request per screen-open, every 7 seconds
    const BACKOFF_MAX = 60000;
    const TRAIL_MS = 6 * 60000; // how much of an aircraft's track is remembered
    const TRAIL_MAX = 240; // …and how many points of it
    const GONE_MS = 90000; // an aircraft not seen for this long is forgotten

    // the ranges the screens offer, in nautical miles
    const RANGES = [10, 25, 50, 100, 150];
    const DEFAULT_RANGE = 50;
    const RANGE_KEY = 'homer-planes-range';

    // HOMER's helper on the NAS: through the https name's /homer-feeds, or
    // port 8095 on the LAN (the same rule the hubs, Search and Music use)
    const base = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');

    const HA = () => window.HomerHA || null;
    const WX = () => window.HomerWeather || null;

    // ---------- Where the house is ----------

    let place = null; // { lat, lon, from: 'ha' | 'weather' }
    let placeTried = false;
    let placeInflight = null;

    const haPlace = () => {
        const h = HA();
        if (!h || typeof h.location !== 'function') return null;
        try {
            const l = h.location();
            return l && typeof l.lat === 'number' && typeof l.lon === 'number'
                ? { lat: l.lat, lon: l.lon, from: 'ha' }
                : null;
        } catch {
            return null;
        }
    };

    const findPlace = () => {
        const fromHA = haPlace();
        if (fromHA) { place = fromHA; placeTried = true; return Promise.resolve(place); }
        if (placeInflight) return placeInflight;
        const w = WX();
        if (!w || typeof w.forecast !== 'function') { placeTried = true; return Promise.resolve(place); }
        // the weather screen's place, which falls back to HOMER's own ZIP
        placeInflight = w.forecast()
            .then((f) => {
                const p = (f && f.place) || (typeof w.place === 'function' ? w.place() : null);
                if (p && typeof p.lat === 'number') place = { lat: p.lat, lon: p.lon, from: 'weather', name: p.name || '' };
                return place;
            })
            .catch(() => place)
            .finally(() => { placeInflight = null; placeTried = true; });
        return placeInflight;
    };

    // The order the screens read: nearest first, which is what the helper
    // already hands back — except that aircraft parked on a ramp come last.
    // DFW is 40-odd miles from the house, so at the wider ranges a plain
    // distance sort buries everything actually overhead under a hundred
    // airliners sitting still at their gates. They're still on the list, and
    // still in distance order; they're just not the headline.
    const order = (list) => {
        const by = (a, b) => (a.dst == null ? 9999 : a.dst) - (b.dst == null ? 9999 : b.dst);
        const flying = list.filter((p) => !p.ground).sort(by);
        const parked = list.filter((p) => p.ground).sort(by);
        return flying.concat(parked);
    };

    // ---------- The model ----------

    const create = () => {
        if (shared) return shared;

        const listeners = new Set();
        let range = readRange();
        let planes = []; // nearest first, as the helper sorted them
        let byHex = new Map();
        const trails = new Map(); // hex -> [{ lat, lon, at }]
        let state = 'loading'; // loading | ok | empty | error | nolocation
        let problem = '';
        let at = 0; // when the list came in
        let stale = false;
        let source = '';
        let watchers = 0;
        let timer = 0;
        let inflight = null;
        let fails = 0;

        const emit = () => listeners.forEach((fn) => {
            try { fn(); } catch (err) { console.warn('[HOMER Planes]', err); }
        });

        const remember = (list) => {
            const now = Date.now();
            for (const p of list) {
                if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
                let t = trails.get(p.hex);
                if (!t) { t = []; trails.set(p.hex, t); }
                const last = t[t.length - 1];
                // only a real move is worth a point
                if (!last || Math.abs(last.lat - p.lat) > 1e-5 || Math.abs(last.lon - p.lon) > 1e-5) {
                    t.push({ lat: p.lat, lon: p.lon, at: now });
                }
                while (t.length > TRAIL_MAX || (t.length > 1 && now - t[0].at > TRAIL_MS)) t.shift();
            }
            // an aircraft that has flown out of range, or landed, lets its
            // track go rather than growing this map for the life of the page
            for (const [hex, t] of trails) {
                const last = t[t.length - 1];
                if (!last || now - last.at > GONE_MS) trails.delete(hex);
            }
        };

        const load = () => {
            if (inflight) return inflight;
            inflight = findPlace().then((p) => {
                if (!p) {
                    state = 'nolocation';
                    problem = '';
                    emit();
                    return null;
                }
                const url = `${base()}/planes?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&dist=${range}`;
                return fetch(url, { cache: 'no-store' })
                    .then((r) => (r.ok ? r.json() : r.json().catch(() => ({})).then((j) => Promise.reject(new Error(j.error || 'HTTP ' + r.status)))))
                    .then((j) => {
                        planes = order(Array.isArray(j.aircraft) ? j.aircraft : []);
                        byHex = new Map(planes.map((x) => [x.hex, x]));
                        source = j.source || '';
                        stale = !!j.stale;
                        at = Date.now();
                        fails = 0;
                        problem = '';
                        remember(planes);
                        state = planes.length ? 'ok' : 'empty';
                        emit();
                        return j;
                    })
                    .catch((err) => {
                        fails += 1;
                        problem = String((err && err.message) || err);
                        // a list we already have beats an error message
                        state = planes.length && Date.now() - at < 120000 ? 'ok' : 'error';
                        stale = true;
                        emit();
                        return null;
                    });
            }).finally(() => { inflight = null; });
            return inflight;
        };

        const tick = () => {
            clearTimeout(timer);
            if (!watchers) return;
            const wait = fails ? Math.min(BACKOFF_MAX, POLL_MS * Math.pow(2, fails - 1)) : POLL_MS;
            timer = setTimeout(() => {
                if (!watchers) return;
                if (document.hidden) { tick(); return; } // nothing asked while nobody's looking
                load().then(tick);
            }, wait);
        };

        const onVisible = () => {
            if (!watchers || document.hidden) return;
            if (Date.now() - at > POLL_MS) load().then(tick);
        };
        document.addEventListener('visibilitychange', onVisible);

        // Home Assistant arriving later can give a better location than the
        // weather's; take it and start over from there
        const offHA = HA() && HA().onChange ? HA().onChange(() => {
            const better = haPlace();
            if (!better || (place && place.from === 'ha')) return;
            place = better;
            trails.clear();
            if (watchers) load().then(tick);
        }) : () => {};

        const self = {
            get range() { return range; },
            get planes() { return planes; },
            get state() { return state; },
            get problem() { return problem; },
            get stale() { return stale; },
            get source() { return source; },
            get at() { return at; },
            get place() { return place; },
            plane: (hex) => byHex.get(hex) || null,
            trail: (hex) => trails.get(hex) || [],
            RANGES,

            // watch(): a screen is open. The returned function says it isn't.
            watch(fn) {
                if (typeof fn === 'function') listeners.add(fn);
                watchers += 1;
                if (watchers === 1) {
                    if (!at || Date.now() - at > POLL_MS) load().then(tick);
                    else tick();
                } else if (fn) {
                    setTimeout(fn, 0); // whoever just joined gets what's here now
                }
                let off = false;
                return () => {
                    if (off) return;
                    off = true;
                    if (typeof fn === 'function') listeners.delete(fn);
                    watchers = Math.max(0, watchers - 1);
                    if (!watchers) clearTimeout(timer); // nothing asked with no screen open
                };
            },

            setRange(nm) {
                const next = RANGES.includes(nm) ? nm : DEFAULT_RANGE;
                if (next === range) return range;
                range = next;
                writeRange(range);
                fails = 0;
                if (watchers) load().then(tick);
                return range;
            },
            stepRange(dir) {
                const i = RANGES.indexOf(range);
                return self.setRange(RANGES[Math.max(0, Math.min(RANGES.length - 1, i + (dir > 0 ? 1 : -1)))]);
            },
            refresh() {
                fails = 0;
                placeTried = false;
                return load().then(() => { tick(); });
            },
            destroy() {
                clearTimeout(timer);
                listeners.clear();
                trails.clear();
                place = null; // a fresh model looks the house up again
                placeTried = false;
                offHA();
                document.removeEventListener('visibilitychange', onVisible);
                shared = null;
            }
        };
        shared = self;
        return self;
    };

    function readRange() {
        try {
            const n = Number(localStorage.getItem(RANGE_KEY));
            return RANGES.includes(n) ? n : DEFAULT_RANGE;
        } catch {
            return DEFAULT_RANGE;
        }
    }
    function writeRange(n) {
        try { localStorage.setItem(RANGE_KEY, String(n)); } catch { /* this session only */ }
    }

    let shared = null;

    window.HomerPlanesModel = {
        version: VERSION,
        RANGES,
        create,
        destroy() {
            if (shared) shared.destroy();
            shared = null;
        }
    };
})();
