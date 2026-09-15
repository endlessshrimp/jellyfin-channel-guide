/*
 * HOMER Home Assistant: the one connection every HOMER screen shares (Rooms,
 * the quick controls over a video, the doorbell's picture-in-picture, and
 * Settings' Connect).
 *
 * Signing in is Home Assistant's own: Settings → Home Assistant → Connect
 * sends this tab to Home Assistant's sign-in page (/auth/authorize, with this
 * page's origin as the client_id), and Home Assistant sends it back to
 * #/rooms?homer-ha=signin&code=… . The code is traded for tokens at
 * /auth/token, and the refresh token is kept in this device's localStorage,
 * per origin. No password or token is ever in HOMER's code or the injector
 * config. Disconnect revokes the refresh token and forgets it.
 *
 * What the browser allows (checked against Home Assistant 2025.12):
 *   /auth/token, /auth/revoke  answer any origin (CORS), so the sign-in works
 *                              with no Home Assistant config change
 *   /api/websocket             isn't CORS-gated: states, areas, service calls,
 *                              camera streams and history all go over it
 *   /api/camera_proxy/…?token  an <img>, not CORS-gated (the token is the
 *                              camera's own short-lived access token)
 *   /api/hls/…                 answers any origin (CORS), so hls.js can play it
 * HOMER never calls Home Assistant's REST API (/api/states etc.), which is
 * the part that would need http: cors_allowed_origins.
 *
 * An https:// HOMER page (Tailscale, Caddy) can only reach an https:// Home
 * Assistant: the browser blocks ws:// and http:// from it. See the README.
 *
 * The address comes from Settings (typed on this device), or the injector
 * config: window.HomerConfig = { homeAssistant: 'http://…:8123' }, or a map
 * of HOMER origin → address.
 *
 * window.HomerHA = { status, problem, isSetUp, address, setAddress,
 *                    addressProblem, signIn, disconnect, onChange, house,
 *                    entity, lightOn, toggle, setBrightness, setTemperature,
 *                    setMode, scene, snapshotUrl, playCamera, rings, onRing,
 *                    destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerHA && typeof window.HomerHA.destroy === 'function') {
        window.HomerHA.destroy();
    }

    const AUTH_KEY = 'homer-ha'; // { url, clientId, access, refresh, expires }
    const URL_KEY = 'homer-ha-url'; // the address typed in Settings
    const PENDING_KEY = 'homer-ha-pending'; // { state, url, back, at } while signing in
    const DEV_KEY = 'homer-ha-dev'; // DEV ONLY: { url, token } (a long-lived token), for testing in a browser tab
    const MOCK_KEY = 'homer-ha-mock'; // DEV ONLY: '1' draws a made-up house, no Home Assistant needed
    const CALLBACK = '#/rooms?homer-ha=signin';
    const DOMAINS = ['light', 'climate', 'camera', 'scene'];
    const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
    const PING_MS = 30000;
    const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';

    const log = (...a) => console.info('[HOMER HA]', ...a);
    const warn = (...a) => console.warn('[HOMER HA]', ...a);

    // ---------- Storage ----------

    const read = (k, store = localStorage) => {
        try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; }
    };
    const write = (k, v) => {
        try {
            if (v == null) localStorage.removeItem(k);
            else localStorage.setItem(k, JSON.stringify(v));
        } catch { /* private mode: this session only */ }
    };
    const dev = () => {
        const d = read(DEV_KEY);
        return d && d.url && d.token ? d : null;
    };
    const mocking = () => {
        try { return localStorage.getItem(MOCK_KEY) === '1'; } catch { return false; }
    };

    // ---------- The address ----------

    // "192.168.1.5:8123" → "http://192.168.1.5:8123"; no path, no trailing slash
    const cleanUrl = (u) => {
        let s = String(u || '').trim();
        if (!s) return '';
        if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
        try {
            const p = new URL(s);
            return p.protocol + '//' + p.host;
        } catch {
            return '';
        }
    };
    const fromConfig = () => {
        const c = window.HomerConfig && window.HomerConfig.homeAssistant;
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') return c[location.origin] || '';
        return '';
    };
    let auth = read(AUTH_KEY);
    const address = () => {
        const d = dev();
        if (d) return cleanUrl(d.url);
        if (auth && auth.url) return auth.url;
        let typed = '';
        try { typed = localStorage.getItem(URL_KEY) || ''; } catch { /* none */ }
        return cleanUrl(typed || fromConfig());
    };
    // why an address can't work from this page (or '')
    const addressProblem = (u = address()) => {
        if (!u) return 'Enter your Home Assistant\'s address.';
        if (location.protocol === 'https:' && /^http:/i.test(u)) {
            return 'This page is https://, so the browser only lets it reach an https:// Home Assistant.';
        }
        return '';
    };
    const setAddress = (u) => {
        const clean = cleanUrl(u);
        if (!clean) return false;
        try { localStorage.setItem(URL_KEY, clean); } catch { /* this session only */ }
        emit();
        return true;
    };

    // ---------- Change events ----------

    const listeners = new Set();
    let emitQueued = false;
    const emitNow = () => {
        emitQueued = false;
        listeners.forEach((fn) => {
            try { fn(); } catch (err) { console.error('[HOMER HA]', err); }
        });
    };
    // many state changes arrive together; tell the screens once
    const emit = () => {
        if (emitQueued) return;
        emitQueued = true;
        setTimeout(emitNow, 30); // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
    };
    const ringers = new Set();

    // ---------- Status ----------
    // off         not set up on this device
    // connecting  signing in or opening the connection
    // ready       connected; house() has the rooms
    // offline     can't reach Home Assistant (trying again by itself)
    // signin      the sign-in was revoked or ran out: Connect again
    // blocked     the address can't work from this page (addressProblem)

    let status = 'off';
    let problem = '';
    const setStatus = (s, why = '') => {
        if (s === status && why === problem) return;
        status = s;
        problem = why;
        emit();
    };
    const isSetUp = () => mocking() || !!dev() || !!(auth && auth.refresh);

    // ---------- Sign-in (Home Assistant's own) ----------

    const clientId = () => location.origin + '/';
    // Back to /web/index.html with a query of its own, never the bare /web/:
    // the browser can answer an address it has seen from its cache, and a
    // copy of Jellyfin's page from before the injector has no HOMER in it (so
    // no one would be there to finish the sign-in).
    const RETURN_PATH = '/web/index.html?homer-ha=return';
    const redirectUri = () => location.origin + RETURN_PATH + CALLBACK;
    const randomHex = () => {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    const route = () => {
        const p = window.HomerPlayer;
        return (p && typeof p.route === 'function' ? p.route() : location.hash) || '#/home';
    };

    // Off to Home Assistant's sign-in page, in this tab. back: where to land after.
    const signIn = (back) => {
        const url = address();
        const why = addressProblem(url);
        if (why) throw new Error(why);
        const state = randomHex();
        write(PENDING_KEY, { state, url, back: back || route(), at: Date.now() });
        location.href = url + '/auth/authorize?' + new URLSearchParams({
            response_type: 'code',
            client_id: clientId(),
            redirect_uri: redirectUri(),
            state
        });
    };

    const tokenRequest = async (url, path, body) => {
        const res = await fetch(url + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body)
        });
        const text = await res.text();
        let j = {};
        try { j = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
        if (!res.ok) {
            const err = new Error(j.error_description || j.error || `HTTP ${res.status}`);
            err.status = res.status;
            err.code = j.error || '';
            throw err;
        }
        return j;
    };

    // Back from Home Assistant: #/rooms?homer-ha=signin&code=…&state=…
    const finishSignIn = async () => {
        const h = location.hash || '';
        if (!/^#\/rooms\?(.*&)?homer-ha=signin(&|$)/.test(h)) return;
        const q = new URLSearchParams(h.slice(h.indexOf('?') + 1));
        const code = q.get('code');
        const state = q.get('state');
        const pending = read(PENDING_KEY);
        write(PENDING_KEY, null);
        // out of the address bar (and the history) at once: the code is single-use
        const back = pending && /^#\//.test(pending.back || '') && !/homer-ha=/.test(pending.back) ? pending.back : '#/rooms';
        // replaceState, not location.replace: dropping the query would reload
        // the page and cut off the token exchange below; tell the screens by hand
        const search = location.search.replace(/[?&]homer-ha=return\b/, '').replace(/^&/, '?');
        history.replaceState(history.state, '', location.pathname + search + back);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        // Rooms may not be loaded yet, or Jellyfin's router may still be
        // settling on the new address: open it again once things are up
        const showRooms = () => {
            if (window.HomerRooms && /^#\/rooms(\?|$)/.test(location.hash)) window.HomerRooms.open();
        };
        [400, 1500, 4000].forEach((ms) => setTimeout(showRooms, ms));
        if (!code || !pending || pending.state !== state || Date.now() - pending.at > 15 * 60000) {
            warn('sign-in answer didn\'t match a sign-in from this device; ignored');
            setStatus(isSetUp() ? status : 'off', 'The sign-in didn\'t finish. Try Connect again.');
            return;
        }
        setStatus('connecting');
        try {
            const j = await tokenRequest(pending.url, '/auth/token', {
                grant_type: 'authorization_code',
                code,
                client_id: clientId()
            });
            auth = {
                url: pending.url,
                clientId: clientId(),
                access: j.access_token,
                refresh: j.refresh_token,
                expires: Date.now() + (j.expires_in || 1800) * 1000
            };
            write(AUTH_KEY, auth);
            log('signed in to', pending.url);
            retry = 0;
            open();
            showRooms();
        } catch (err) {
            warn('sign-in failed', err.message);
            setStatus('off', 'Home Assistant didn\'t accept the sign-in. Try Connect again.');
        }
    };

    // A usable access token: the dev token, or ours (refreshed when it's
    // about to run out; Home Assistant's last 30 minutes)
    let refreshing = null;
    const accessToken = async () => {
        const d = dev();
        if (d) return d.token;
        if (!auth || !auth.refresh) throw Object.assign(new Error('not signed in'), { signin: true });
        if (auth.access && auth.expires - Date.now() > 60000) return auth.access;
        if (!refreshing) {
            const a = auth;
            refreshing = tokenRequest(a.url, '/auth/token', {
                grant_type: 'refresh_token',
                refresh_token: a.refresh,
                client_id: a.clientId || clientId()
            }).then((j) => {
                if (auth !== a) throw new Error('signed out meanwhile');
                auth.access = j.access_token;
                auth.expires = Date.now() + (j.expires_in || 1800) * 1000;
                write(AUTH_KEY, auth);
                return auth.access;
            }, (err) => {
                // a refused refresh token (revoked, or deleted in Home
                // Assistant's profile page) needs a new sign-in; anything else
                // (no network) is tried again later
                if (err.status === 400 || err.status === 403) err.signin = true;
                throw err;
            }).finally(() => { refreshing = null; });
        }
        return refreshing;
    };

    const disconnect = async () => {
        const a = auth;
        auth = null;
        write(AUTH_KEY, null);
        write(DEV_KEY, null);
        try { localStorage.removeItem(MOCK_KEY); } catch { /* none */ }
        close();
        clearHouse();
        setStatus('off');
        if (a && a.refresh) {
            // tell Home Assistant to forget it too (it shows under the profile's refresh tokens)
            await tokenRequest(a.url, '/auth/revoke', { token: a.refresh }).catch((err) => warn('revoke failed', err.message));
        }
    };

    // ---------- The WebSocket ----------

    let ws = null;
    let msgId = 0;
    let pending = new Map(); // id -> { resolve, reject }
    let subs = new Map(); // id -> fn(event)
    let retry = 0;
    let retryTimer = 0;
    let pingTimer = 0;
    let pongWait = 0;
    let destroyed = false;
    let triedFresh = false;

    const wsUrl = (u) => u.replace(/^http/i, 'ws') + '/api/websocket';

    const send = (msg) => new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1 || !ws._authed) {
            reject(new Error('Home Assistant isn\'t connected'));
            return;
        }
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(Object.assign({ id }, msg)));
    });
    const subscribe = async (msg, fn) => {
        const id = msgId + 1;
        subs.set(id, fn);
        try {
            await send(msg);
        } catch (err) {
            subs.delete(id);
            throw err;
        }
        return id;
    };

    const scheduleRetry = () => {
        clearTimeout(retryTimer);
        if (destroyed || !isSetUp() || mocking()) return;
        const wait = RETRY_MS[Math.min(retry, RETRY_MS.length - 1)];
        retry++;
        retryTimer = setTimeout(open, wait);
    };

    const close = () => {
        clearTimeout(retryTimer);
        clearInterval(pingTimer);
        clearTimeout(pongWait);
        if (ws) {
            const w = ws;
            ws = null;
            w.onopen = w.onmessage = w.onclose = w.onerror = null;
            try { w.close(); } catch { /* gone */ }
        }
        pending.forEach((p) => p.reject(new Error('connection closed')));
        pending = new Map();
        subs = new Map();
    };

    const open = async () => {
        if (destroyed) return;
        close();
        if (mocking()) { startMock(); return; }
        if (!isSetUp()) { setStatus('off'); return; }
        const url = address();
        const why = addressProblem(url);
        if (why) { setStatus('blocked', why); return; }
        setStatus('connecting');
        let token;
        try {
            token = await accessToken();
        } catch (err) {
            if (err.signin) {
                setStatus('signin', 'Home Assistant signed this device out. Connect again in Settings.');
                return;
            }
            setStatus('offline', 'Can\'t reach Home Assistant. Trying again…');
            scheduleRetry();
            return;
        }
        if (destroyed) return;
        let sock;
        try {
            sock = new WebSocket(wsUrl(url));
        } catch (err) {
            setStatus('blocked', err.message);
            return;
        }
        ws = sock;
        sock.onmessage = (ev) => {
            if (ws !== sock) return;
            let m;
            try { m = JSON.parse(ev.data); } catch { return; }
            const list = Array.isArray(m) ? m : [m];
            list.forEach(onMessage(sock, token));
        };
        sock.onclose = () => {
            if (ws !== sock) return;
            ws = null;
            clearInterval(pingTimer);
            pending.forEach((p) => p.reject(new Error('connection closed')));
            pending = new Map();
            subs = new Map();
            if (status !== 'signin' && status !== 'off') {
                setStatus('offline', 'Lost Home Assistant. Reconnecting…');
                scheduleRetry();
            }
        };
        sock.onerror = () => { /* onclose follows */ };
    };

    const onMessage = (sock, token) => (m) => {
        if (m.type === 'auth_required') {
            sock.send(JSON.stringify({ type: 'auth', access_token: token }));
            return;
        }
        if (m.type === 'auth_invalid') {
            // an access token Home Assistant no longer takes: one fresh try
            if (auth && !triedFresh && !dev()) {
                triedFresh = true;
                auth.expires = 0;
                open();
                return;
            }
            setStatus('signin', 'Home Assistant signed this device out. Connect again in Settings.');
            close();
            return;
        }
        if (m.type === 'auth_ok') {
            sock._authed = true;
            triedFresh = false;
            retry = 0;
            haVersion = m.ha_version || '';
            startPing();
            load().catch((err) => {
                warn('loading the house failed', err.message);
                setStatus('offline', 'Home Assistant didn\'t answer. Trying again…');
                close();
                scheduleRetry();
            });
            return;
        }
        if (m.type === 'result' || m.type === 'pong') {
            if (m.type === 'pong') clearTimeout(pongWait);
            const p = pending.get(m.id);
            if (!p) return;
            pending.delete(m.id);
            if (m.type === 'pong' || m.success) p.resolve(m.result);
            else p.reject(Object.assign(new Error((m.error && m.error.message) || 'failed'), { code: m.error && m.error.code }));
            return;
        }
        if (m.type === 'event') {
            const fn = subs.get(m.id);
            if (fn) {
                try { fn(m.event); } catch (err) { console.error('[HOMER HA]', err); }
            }
        }
    };

    // a quiet connection can die without a close (Wi-Fi changes, a sleeping
    // laptop): ping, and start over when nothing comes back
    const startPing = () => {
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
            if (!ws || ws.readyState !== 1) return;
            const id = ++msgId;
            pending.set(id, { resolve: () => {}, reject: () => {} });
            ws.send(JSON.stringify({ id, type: 'ping' }));
            clearTimeout(pongWait);
            pongWait = setTimeout(() => {
                warn('no pong; reconnecting');
                open();
            }, 10000);
        }, PING_MS);
    };

    // ---------- The house: rooms, devices, states ----------

    let haVersion = '';
    let houseName = '';
    let tempUnit = '°F';
    let userName = '';
    let areas = []; // [{ area_id, name, icon, floor_id, temperature_entity_id }]
    let floors = [];
    let placeOf = new Map(); // entity_id -> area_id
    let deviceOf = new Map(); // entity_id -> device_id
    let hidden = new Set();
    let states = {}; // entity_id -> state object
    let doorbells = []; // [{ id, camera, name }]
    let built = null; // house(), rebuilt when the registries change
    const overlay = new Map(); // entity_id -> { state, attributes, until }: what we just asked for

    const clearHouse = () => {
        areas = [];
        floors = [];
        placeOf = new Map();
        deviceOf = new Map();
        hidden = new Set();
        states = {};
        doorbells = [];
        built = null;
        overlay.clear();
        ringCache.clear();
        houseName = '';
        userName = '';
    };

    const domainOf = (id) => id.split('.')[0];
    const isDoorbellSensor = (s) => {
        const id = s.entity_id;
        const d = domainOf(id);
        const a = s.attributes || {};
        if (d === 'event') return a.device_class === 'doorbell' || /doorbell|visitor/i.test(id);
        if (d === 'binary_sensor') return /visitor|doorbell|ding/i.test(id) || /doorbell|visitor/i.test(a.friendly_name || '');
        return false;
    };

    const load = async () => {
        const [config, user, areaList, floorList, devices, registry, all] = await Promise.all([
            send({ type: 'get_config' }),
            send({ type: 'auth/current_user' }).catch(() => null),
            send({ type: 'config/area_registry/list' }).catch(() => []),
            send({ type: 'config/floor_registry/list' }).catch(() => []),
            send({ type: 'config/device_registry/list' }).catch(() => []),
            send({ type: 'config/entity_registry/list_for_display' }).catch(() => ({ entities: [] })),
            send({ type: 'get_states' })
        ]);
        houseName = (config && config.location_name) || 'Home';
        tempUnit = (config && config.unit_system && config.unit_system.temperature) || '°F';
        userName = (user && user.name) || '';
        areas = areaList || [];
        floors = floorList || [];
        const devArea = new Map((devices || []).map((d) => [d.id, d.area_id]));
        placeOf = new Map();
        deviceOf = new Map();
        hidden = new Set();
        for (const e of (registry && registry.entities) || []) {
            if (e.di) deviceOf.set(e.ei, e.di);
            const area = e.ai || (e.di && devArea.get(e.di)) || null;
            if (area) placeOf.set(e.ei, area);
            if (e.hb || e.ec != null) hidden.add(e.ei); // hidden, or a config/diagnostic entity
        }
        // what HOMER shows: lights, thermostats, cameras, scenes, the rooms'
        // temperatures, and anything that says the doorbell rang
        const wanted = new Set();
        states = {};
        for (const s of all || []) {
            const d = domainOf(s.entity_id);
            if ((DOMAINS.includes(d) && !hidden.has(s.entity_id)) || isDoorbellSensor(s)) wanted.add(s.entity_id);
        }
        areas.forEach((a) => { if (a.temperature_entity_id) wanted.add(a.temperature_entity_id); });
        built = null;
        // then keep them current (initial states come first, then changes)
        let first = true;
        await subscribe({ type: 'subscribe_entities', entity_ids: [...wanted] }, (ev) => {
            applyUpdates(ev, first);
            if (first) {
                first = false;
                findDoorbells();
                setStatus('ready');
                log('connected:', houseName, 'Home Assistant', haVersion, '·', Object.keys(states).length, 'entities');
            }
            emit();
        });
    };

    const iso = (sec) => new Date(sec * 1000).toISOString();
    const applyUpdates = (u, quiet) => {
        if (u.a) {
            for (const [id, x] of Object.entries(u.a)) {
                states[id] = { entity_id: id, state: x.s, attributes: x.a || {}, last_changed: iso(x.lc), last_updated: iso(x.lu || x.lc) };
            }
        }
        if (u.r) u.r.forEach((id) => { delete states[id]; });
        if (u.c) {
            for (const [id, diff] of Object.entries(u.c)) {
                const was = states[id];
                if (!was) continue;
                const s = Object.assign({}, was);
                const add = diff['+'];
                const rem = diff['-'];
                if ((add && add.a) || (rem && rem.a)) s.attributes = Object.assign({}, was.attributes);
                if (add) {
                    if (add.s !== undefined) s.state = add.s;
                    if (add.lc) s.last_changed = s.last_updated = iso(add.lc);
                    else if (add.lu) s.last_updated = iso(add.lu);
                    if (add.a) Object.assign(s.attributes, add.a);
                }
                if (rem && rem.a) rem.a.forEach((k) => { delete s.attributes[k]; });
                states[id] = s;
                const o = overlay.get(id);
                if (o && o.settled && o.settled(s)) overlay.delete(id);
                if (!quiet) checkRing(was, s);
            }
        }
    };

    // ---------- The doorbell ----------

    // a camera that streams (not a stills-only twin, like Reolink's "Snapshots" cameras)
    const streams = (id) => !!states[id] && ((states[id].attributes.supported_features || 0) & 2) === 2;
    // stills-only cameras that have a streaming camera on the same device
    // (Reolink makes one of each) are left out
    const twin = (id) => {
        if (streams(id)) return false;
        const dev = deviceOf.get(id);
        return !!dev && Object.keys(states).some((c) => c !== id && domainOf(c) === 'camera' && deviceOf.get(c) === dev && streams(c));
    };

    const findDoorbells = () => {
        const cams = Object.keys(states).filter((id) => domainOf(id) === 'camera' && !twin(id))
            .sort((a, b) => Number(streams(b)) - Number(streams(a)));
        doorbells = Object.values(states).filter(isDoorbellSensor).map((s) => {
            const dev = deviceOf.get(s.entity_id);
            // its camera: on the same device, else one with "door" in its name
            const camera = cams.find((c) => dev && deviceOf.get(c) === dev)
                || cams.find((c) => /door|bell/i.test(c + ' ' + (states[c].attributes.friendly_name || '')))
                || null;
            return { id: s.entity_id, camera, name: camera ? nameOf(camera) : nameOf(s.entity_id) };
        });
        // one ring source per camera: an event entity beats a binary sensor
        const seen = new Map();
        for (const d of doorbells) {
            const key = d.camera || d.id;
            const had = seen.get(key);
            if (!had || (domainOf(d.id) === 'event' && domainOf(had.id) !== 'event')) seen.set(key, d);
        }
        doorbells = [...seen.values()];
    };
    const checkRing = (was, now) => {
        const d = doorbells.find((x) => x.id === now.entity_id);
        if (!d) return;
        const rang = domainOf(now.entity_id) === 'event'
            ? now.state !== was.state && now.state !== 'unavailable' && was.state !== 'unavailable'
            : now.state === 'on' && was.state !== 'on';
        if (!rang) return;
        log('doorbell:', d.name);
        ringCache.set(d.id, { at: new Date(), fetched: Date.now() });
        ringers.forEach((fn) => {
            try { fn(d); } catch (err) { console.error('[HOMER HA]', err); }
        });
    };

    // The last day's rings, newest first (Date objects)
    const rings = async (doorbellId, hours = 24) => {
        if (mocking()) return mockRings();
        const start = new Date(Date.now() - hours * 3600000).toISOString();
        const r = await send({
            type: 'history/history_during_period',
            start_time: start,
            entity_ids: [doorbellId],
            minimal_response: true,
            no_attributes: true,
            significant_changes_only: false
        });
        const list = (r && r[doorbellId]) || [];
        const event = domainOf(doorbellId) === 'event';
        const out = [];
        let prev = null;
        for (const x of list) {
            const st = x.s !== undefined ? x.s : x.state;
            const at = x.lu != null ? x.lu * 1000 : x.lc != null ? x.lc * 1000 : Date.parse(x.last_changed || x.last_updated);
            const rang = event ? prev !== null && st !== prev && st !== 'unavailable' : st === 'on' && prev !== 'on';
            if (rang && isFinite(at) && at > Date.now() - hours * 3600000) out.push(new Date(at));
            prev = st;
        }
        return out.reverse();
    };

    // When it last rang (from the last week's history, fetched now and then;
    // a sensor's last_changed won't do: it also moves when the doorbell drops
    // off the network and comes back). A Date, null for none in a week, or
    // undefined until the history is in (a change event follows).
    const ringCache = new Map(); // doorbell id -> { at, fetched, loading }
    const lastRing = (id) => {
        const c = ringCache.get(id);
        if (!c || (!c.loading && Date.now() - c.fetched > 5 * 60000)) {
            const entry = c || { at: undefined, fetched: 0 };
            entry.loading = true;
            ringCache.set(id, entry);
            rings(id, 24 * 7)
                .then((list) => { entry.at = list[0] || null; })
                .catch(() => {})
                .finally(() => { entry.loading = false; entry.fetched = Date.now(); emit(); });
        }
        return c ? c.at : undefined;
    };

    // ---------- Names and the house ----------

    // "Living Room Floor Lamp" in the Living Room is "Floor Lamp"
    const nameOf = (id, areaName) => {
        const s = states[id];
        let n = (s && s.attributes && s.attributes.friendly_name) || id.split('.')[1].replace(/_/g, ' ');
        if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + ' ') && n.length > areaName.length + 2) {
            n = n.slice(areaName.length + 1);
            n = n.charAt(0).toUpperCase() + n.slice(1);
        }
        return n;
    };

    const byName = (a, b) => a.name.localeCompare(b.name);

    // Home Assistant rooms HOMER leaves out, with everything in them (by name,
    // any case): a place for things that aren't in use.
    const HIDDEN_ROOMS = ['unused'];

    // house(): the rooms as HOMER shows them, each with its lights, cameras
    // and scenes (only rooms with any of those; the thermostats are the
    // house's, in house.climates), then
    // "Other" for what has no room. Floors order the rooms when there are any.
    const house = () => {
        if (built) return built;
        const rooms = new Map();
        const floorLevel = new Map(floors.map((f) => [f.floor_id, f.level == null ? 0 : f.level]));
        const floorName = new Map(floors.map((f) => [f.floor_id, f.name]));
        const skipped = new Set(areas.filter((a) => HIDDEN_ROOMS.includes(String(a.name || '').trim().toLowerCase())).map((a) => a.area_id));
        for (const a of areas) {
            if (skipped.has(a.area_id)) continue;
            rooms.set(a.area_id, {
                id: a.area_id, name: a.name, icon: a.icon || '', floor: floorName.get(a.floor_id) || '',
                level: floorLevel.has(a.floor_id) ? floorLevel.get(a.floor_id) : 99,
                temperature: a.temperature_entity_id || null,
                lights: [], climates: [], cameras: [], scenes: []
            });
        }
        const other = { id: '_other', name: 'Other', icon: '', floor: '', level: 100, temperature: null, lights: [], climates: [], cameras: [], scenes: [] };
        const KIND = { light: 'lights', climate: 'climates', camera: 'cameras', scene: 'scenes' };
        for (const id of Object.keys(states)) {
            const kind = KIND[domainOf(id)];
            if (!kind || hidden.has(id) || (kind === 'cameras' && twin(id)) || skipped.has(placeOf.get(id))) continue;
            const room = rooms.get(placeOf.get(id)) || other;
            room[kind].push(id);
        }
        let list = [...rooms.values(), other].filter((r) => r.lights.length + r.climates.length + r.cameras.length + r.scenes.length > 0);
        for (const r of list) {
            const nm = (id) => nameOf(id, r.name);
            // light groups (a room's "all lights") first, then by name
            const group = (id) => { const a = states[id].attributes; return Array.isArray(a.entity_id) || a.is_hue_group ? 0 : 1; };
            r.lights.sort((a, b) => group(a) - group(b) || nm(a).localeCompare(nm(b)));
            r.scenes.sort((a, b) => nm(a).localeCompare(nm(b)));
            r.cameras.sort((a, b) => nm(a).localeCompare(nm(b)));
            r.climates.sort((a, b) => nm(a).localeCompare(nm(b)));
        }
        // Thermostats are the house's, not a room's: they move to house.climates
        // (Rooms' own Climate item). A room keeps them only for its temperature.
        const climates = [];
        for (const r of list) {
            climates.push(...r.climates);
            r.climateTemp = r.climates;
            r.climates = [];
        }
        climates.sort((a, b) => nameOf(a, '').localeCompare(nameOf(b, '')));
        list = list.filter((r) => r.lights.length + r.cameras.length + r.scenes.length > 0);
        list.sort((a, b) => a.level - b.level || (a.id === '_other' ? 1 : b.id === '_other' ? -1 : byName(a, b)));
        const cameras = list.flatMap((r) => r.cameras);
        built = { name: houseName, version: haVersion, user: userName, url: address(), unit: tempUnit, rooms: list, cameras, climates, doorbells: doorbells.slice() };
        return built;
    };
    // registries don't change often; the states do, so the house is rebuilt
    // only when an entity comes or goes
    listeners.add(() => {
        if (built && Object.keys(states).length !== built._count) built = null;
    });
    const houseWithCount = () => {
        const h = house();
        h._count = Object.keys(states).length;
        return h;
    };

    // an entity's state, with anything just asked for already showing
    const entity = (id) => {
        const s = states[id];
        if (!s) return null;
        const o = overlay.get(id);
        if (!o) return s;
        if (Date.now() > o.until) { overlay.delete(id); return s; }
        return Object.assign({}, s, { state: o.state != null ? o.state : s.state, attributes: Object.assign({}, s.attributes, o.attributes || {}) });
    };

    // ---------- Controls ----------

    const call = (domain, service, data, entityId) => {
        if (mocking()) return mockCall(domain, service, data, entityId);
        return send({ type: 'call_service', domain, service, service_data: data || {}, target: { entity_id: entityId } });
    };
    // show it at once; settled() says when Home Assistant has caught up
    const expect = (id, state, attributes, settled, ms = 6000) => {
        overlay.set(id, { state, attributes, settled, until: Date.now() + ms });
        emit();
    };
    const failed = (id) => (err) => {
        overlay.delete(id);
        emit();
        warn('control failed', id, err && err.message);
        throw err;
    };

    const lightOn = (id) => { const s = entity(id); return !!s && s.state === 'on'; };
    // 0–100, or null for a light that only switches
    const brightness = (id) => {
        const s = entity(id);
        if (!s) return null;
        const modes = s.attributes.supported_color_modes || [];
        const dims = modes.some((m) => m !== 'onoff') || s.attributes.brightness != null;
        if (!dims) return null;
        if (s.state !== 'on') return 0;
        return Math.max(1, Math.round((s.attributes.brightness || 0) / 2.55));
    };
    const toggle = (id) => {
        const on = !lightOn(id);
        expect(id, on ? 'on' : 'off', null, (s) => (s.state === 'on') === on);
        return call(domainOf(id), on ? 'turn_on' : 'turn_off', {}, id).catch(failed(id));
    };

    // remote presses come fast: show each step, send the last one
    const debounced = new Map(); // key -> timer
    const later = (key, ms, fn) => {
        clearTimeout(debounced.get(key));
        debounced.set(key, setTimeout(() => { debounced.delete(key); fn(); }, ms));
    };
    const setBrightness = (id, pct) => {
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        const on = pct > 0;
        expect(id, on ? 'on' : 'off', on ? { brightness: Math.round(pct * 2.55) } : null,
            (s) => (on ? s.state === 'on' && Math.abs((s.attributes.brightness || 0) / 2.55 - pct) <= 2 : s.state === 'off'), 8000);
        later('b:' + id, 350, () => {
            const p = on ? call('light', 'turn_on', { brightness_pct: pct }, id) : call('light', 'turn_off', {}, id);
            p.catch(failed(id));
        });
    };

    // which: 'temperature', 'target_temp_low' or 'target_temp_high'
    const setTemperature = (id, which, value) => {
        const s = entity(id);
        if (!s) return;
        const a = s.attributes;
        const v = Math.max(a.min_temp != null ? a.min_temp : -Infinity, Math.min(a.max_temp != null ? a.max_temp : Infinity, value));
        const attrs = { [which]: v };
        expect(id, null, attrs, (x) => x.attributes[which] === v, 10000);
        later('t:' + id, 900, () => {
            const now = entity(id);
            const data = which === 'temperature'
                ? { temperature: v }
                : { target_temp_low: now.attributes.target_temp_low, target_temp_high: now.attributes.target_temp_high };
            call('climate', 'set_temperature', data, id).catch(failed(id));
        });
    };
    const setMode = (id, mode) => {
        expect(id, mode, null, (x) => x.state === mode);
        return call('climate', 'set_hvac_mode', { hvac_mode: mode }, id).catch(failed(id));
    };
    const scene = (id) => call('scene', 'turn_on', {}, id);

    // ---------- Cameras ----------

    // a still from the camera (an <img> can load it from any page); fresh
    // asks for a new one instead of the browser's copy
    const snapshotUrl = (id, fresh) => {
        if (mocking()) return mockSnapshot(id);
        const s = states[id];
        const pic = s && s.attributes.entity_picture;
        if (!pic) return '';
        return (/^https?:/.test(pic) ? pic : address() + pic) + (fresh ? '&t=' + Date.now() : '');
    };

    let hlsLoading = null;
    const loadHls = () => {
        if (window.Hls) return Promise.resolve(window.Hls);
        if (!hlsLoading) {
            hlsLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = HLS_JS;
                s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js didn\'t load')));
                s.onerror = () => { hlsLoading = null; reject(new Error('hls.js didn\'t load')); };
                document.head.appendChild(s);
            });
        }
        return hlsLoading;
    };

    // Live video from a camera into a <video>: Home Assistant's HLS stream
    // (hls.js, or the browser's own on an iPhone/Safari). Resolves once it's
    // playing; returns stop(). Cameras that can't stream reject, and the
    // caller keeps refreshing the still instead.
    const playCamera = (id, video) => {
        let hls = null;
        let stopped = false;
        const stop = () => {
            stopped = true;
            if (hls) { try { hls.destroy(); } catch { /* gone */ } hls = null; }
            try { video.removeAttribute('src'); video.load(); } catch { /* gone */ }
        };
        const started = (async () => {
            if (mocking()) throw new Error('no streams in the mock house');
            const r = await send({ type: 'camera/stream', entity_id: id, format: 'hls' });
            if (stopped) return;
            const src = address() + r.url;
            video.muted = true;
            video.playsInline = true;
            const native = video.canPlayType('application/vnd.apple.mpegurl');
            const Hls = await loadHls().catch(() => null);
            if (stopped) return;
            if (Hls && Hls.isSupported()) {
                hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 2, maxBufferLength: 8, backBufferLength: 0 });
                hls.on(Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) warn('camera stream', d.type, d.details); });
                hls.loadSource(src);
                hls.attachMedia(video);
            } else if (native) {
                video.src = src;
            } else {
                throw new Error('this browser can\'t play the stream');
            }
            await video.play().catch(() => {});
            await new Promise((resolve, reject) => {
                if (video.readyState >= 2) { resolve(); return; }
                const t = setTimeout(() => reject(new Error('the stream didn\'t start')), 15000);
                video.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
            });
        })();
        return { started, stop };
    };

    // ---------- The made-up house (DEV ONLY: localStorage homer-ha-mock = 1) ----------

    let mockTimer = 0;
    const MOCK_AREAS = [
        ['living_room', 'Living Room', 'first'], ['kitchen', 'Kitchen', 'first'], ['dining_room', 'Dining Room', 'first'],
        ['hallway', 'Hallway', 'first'], ['front_door', 'Front Door', 'outside'], ['backyard', 'Backyard', 'outside'],
        ['garage', 'Garage', 'outside'], ['primary_bedroom', 'Primary Bedroom', 'second'], ['office', 'Office', 'second']
    ];
    const MOCK_LIGHTS = [
        ['living_room', 'Living Room Lights', 'on', 70, true], ['living_room', 'Floor Lamp', 'on', 55], ['living_room', 'Ceiling', 'off', 0],
        ['living_room', 'TV Backlight', 'on', 30], ['kitchen', 'Kitchen Pendants', 'on', 100], ['kitchen', 'Under Cabinet', 'off', 0],
        ['dining_room', 'Chandelier', 'off', 0], ['hallway', 'Hallway Ceiling', 'off', 0], ['front_door', 'Porch Light', 'on', 80],
        ['backyard', 'Patio String Lights', 'off', 0], ['primary_bedroom', 'Bedside Left', 'off', 0], ['primary_bedroom', 'Bedside Right', 'off', 0],
        ['office', 'Desk Lamp', 'on', 90], ['garage', 'Garage Opener Light', 'off', null]
    ];
    const MOCK_SCENES = [
        ['living_room', 'Living Room Relax'], ['living_room', 'Living Room Bright'], ['living_room', 'Living Room Movie Night'],
        ['living_room', 'Living Room Nightlight'], ['kitchen', 'Kitchen Cooking'], ['kitchen', 'Kitchen Dimmed'],
        ['primary_bedroom', 'Primary Bedroom Read'], ['primary_bedroom', 'Primary Bedroom Nightlight']
    ];
    const MOCK_CAMS = [['front_door', 'Front Door Doorbell'], ['backyard', 'Backyard'], ['garage', 'Garage']];
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    let mockRingTimes = [];
    const startMock = () => {
        clearHouse();
        houseName = 'Home';
        userName = 'Jason';
        haVersion = '2025.12.0';
        const now = new Date().toISOString();
        const put = (id, state, attributes) => { states[id] = { entity_id: id, state, attributes, last_changed: now, last_updated: now }; };
        floors = [{ floor_id: 'first', name: 'First floor', level: 0 }, { floor_id: 'second', name: 'Second floor', level: 1 }, { floor_id: 'outside', name: 'Outside', level: 2 }];
        areas = MOCK_AREAS.map(([id, name, floor]) => ({ area_id: id, name, floor_id: floor, temperature_entity_id: id === 'living_room' ? 'sensor.living_room_temperature' : null }));
        for (const [area, name, st, pct, isGroup] of MOCK_LIGHTS) {
            const id = 'light.' + slug(name);
            const attrs = { friendly_name: name, supported_color_modes: pct == null ? ['onoff'] : ['color_temp'] };
            if (pct != null && st === 'on') attrs.brightness = Math.round(pct * 2.55);
            if (isGroup) attrs.entity_id = ['light.floor_lamp', 'light.ceiling', 'light.tv_backlight'];
            put(id, st, attrs);
            placeOf.set(id, area);
        }
        for (const [area, name] of MOCK_SCENES) {
            const id = 'scene.' + slug(name);
            put(id, '2026-09-14T20:00:00+00:00', { friendly_name: name });
            placeOf.set(id, area);
        }
        for (const [area, name] of MOCK_CAMS) {
            const id = 'camera.' + slug(name);
            put(id, 'idle', { friendly_name: name, entity_picture: '' });
            placeOf.set(id, area);
            deviceOf.set(id, 'dev_' + area);
        }
        put('binary_sensor.front_door_visitor', 'off', { friendly_name: 'Front Door Visitor' });
        deviceOf.set('binary_sensor.front_door_visitor', 'dev_front_door');
        put('climate.hallway_thermostat', 'cool', {
            friendly_name: 'Hallway Thermostat', current_temperature: 74, temperature: 72, min_temp: 50, max_temp: 90,
            hvac_modes: ['off', 'heat', 'cool', 'heat_cool', 'fan_only'], hvac_action: 'cooling', target_temp_step: 1, current_humidity: 48
        });
        placeOf.set('climate.hallway_thermostat', 'hallway');
        put('sensor.living_room_temperature', '72.5', { friendly_name: 'Living Room Temperature', unit_of_measurement: '°F' });
        mockRingTimes = [new Date(Date.now() - 42 * 60000), new Date(Date.now() - 5.2 * 3600000), new Date(Date.now() - 20 * 3600000)];
        findDoorbells();
        clearInterval(mockTimer);
        // the cameras' clocks tick
        mockTimer = setInterval(emit, 1000);
        setStatus('ready');
        emit();
    };
    const mockCall = async (domain, service, data, id) => {
        await new Promise((r) => setTimeout(r, 250));
        const s = states[id];
        if (!s) throw new Error('no such entity');
        const x = Object.assign({}, s, { attributes: Object.assign({}, s.attributes), last_changed: new Date().toISOString() });
        if (domain === 'light' || domain === 'switch') {
            if (service === 'turn_off') { x.state = 'off'; delete x.attributes.brightness; }
            if (service === 'turn_on') {
                x.state = 'on';
                if (data.brightness_pct != null) x.attributes.brightness = Math.round(data.brightness_pct * 2.55);
                else if (x.attributes.brightness == null && (x.attributes.supported_color_modes || []).some((m) => m !== 'onoff')) x.attributes.brightness = 255;
            }
        } else if (domain === 'climate') {
            if (service === 'set_temperature') Object.assign(x.attributes, data);
            if (service === 'set_hvac_mode') x.state = data.hvac_mode;
        }
        states[id] = x;
        const o = overlay.get(id);
        if (o && o.settled && o.settled(x)) overlay.delete(id);
        emit();
    };
    const mockRings = async () => mockRingTimes.slice();
    const mockShots = new Map();
    // a stand-in camera picture: a sky, a ground, and the camera's clock
    const mockSnapshot = (id) => {
        const second = Math.floor(Date.now() / 1000);
        const key = id + '@' + second;
        if (mockShots.has(key)) return mockShots.get(key);
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        const g = c.getContext('2d');
        const n = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const sky = g.createLinearGradient(0, 0, 0, 360);
        sky.addColorStop(0, `hsl(${205 + (n % 20)}, 35%, ${38 + (n % 9)}%)`);
        sky.addColorStop(1, `hsl(${210 + (n % 12)}, 22%, 70%)`);
        g.fillStyle = sky;
        g.fillRect(0, 0, 640, 360);
        g.fillStyle = `hsl(${100 + (n % 30)}, 18%, 30%)`;
        g.fillRect(0, 240, 640, 120);
        g.fillStyle = 'rgba(40, 44, 52, 0.85)';
        if (/door/.test(id)) { g.fillRect(250, 90, 140, 200); g.fillStyle = '#c8a24a'; g.beginPath(); g.arc(370, 200, 6, 0, 7); g.fill(); }
        else if (/garage/.test(id)) { g.fillRect(120, 120, 400, 170); g.strokeStyle = 'rgba(255,255,255,.2)'; for (let y = 150; y < 290; y += 30) { g.beginPath(); g.moveTo(120, y); g.lineTo(520, y); g.stroke(); } }
        else { g.fillStyle = 'rgba(30, 60, 40, 0.9)'; g.beginPath(); g.arc(470, 230, 70, 0, 7); g.fill(); g.fillRect(80, 200, 160, 60); }
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.fillRect(0, 0, 640, 34);
        g.fillStyle = '#fff';
        g.font = '600 18px Barlow, sans-serif';
        g.fillText(nameOf(id) + '   ' + new Date(second * 1000).toLocaleTimeString(), 14, 23);
        const url = c.toDataURL('image/jpeg', 0.8);
        if (mockShots.size > 20) mockShots.clear();
        mockShots.set(key, url);
        return url;
    };
    // for testing: the doorbell rings
    const mockRing = () => {
        const d = doorbells[0];
        if (!d) return;
        mockRingTimes.unshift(new Date());
        ringers.forEach((fn) => { try { fn(d); } catch (err) { console.error('[HOMER HA]', err); } });
    };

    // ---------- Start ----------

    const onOnline = () => {
        if (status === 'offline') { retry = 0; open(); }
    };
    // a tab coming back from the background checks its connection
    const onVisible = () => {
        if (!document.hidden && status === 'offline') { retry = 0; open(); }
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hashchange', finishSignIn);

    finishSignIn();
    if (isSetUp() && !/homer-ha=signin/.test(location.hash)) open();

    window.HomerHA = {
        version: VERSION,
        status: () => status,
        problem: () => problem,
        isSetUp,
        address,
        setAddress,
        addressProblem,
        signIn,
        disconnect,
        reconnect() { retry = 0; open(); },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        house: houseWithCount,
        entity,
        name: nameOf,
        lightOn,
        brightness,
        toggle,
        setBrightness,
        setTemperature,
        setMode,
        scene,
        snapshotUrl,
        playCamera,
        rings,
        lastRing,
        onRing(fn) { ringers.add(fn); return () => ringers.delete(fn); },
        _mockRing: mockRing,
        destroy() {
            destroyed = true;
            close();
            clearInterval(mockTimer);
            debounced.forEach((t) => clearTimeout(t));
            window.removeEventListener('online', onOnline);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('hashchange', finishSignIn);
            listeners.clear();
            ringers.clear();
        }
    };
})();
