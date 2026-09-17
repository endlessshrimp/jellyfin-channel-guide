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
 *                    location, people, peopleIn,
 *                    entity, lightOn, toggle, setBrightness, setTemperature,
 *                    setMode, scene, snapshotUrl, playCamera, browseMedia,
 *                    resolveMedia, history, rings, onRing,
 *                    color, setColor, supports, playPause, mediaCommand,
 *                    playMedia, players,
 *                    setVolume, stepVolume, mute, setSource, power,
 *                    setFanSpeed, setPreset, setOption, setNumber, run,
 *                    extras, device, siblings, pictureUrl, pictureUrls,
 *                    loadPicture, remoteFor,
 *                    sendRemote,
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
    // and what else a room can have: outlets, players, fans, automations and
    // helpers, and the settings (selects, numbers) of a device already shown
    const MORE = ['switch', 'media_player', 'fan', 'automation', 'input_boolean', 'script', 'button', 'select', 'number'];
    // who's home: person entities are Home Assistant's deduplicated view of a
    // person across their phones, so they win; device trackers are the fallback
    const PRESENCE = ['person', 'device_tracker'];
    // the few sensors a room's "at a glance" line shows, by device class
    const GLANCE_SENSOR = { temperature: 'temps', humidity: 'hums', pm25: 'air', aqi: 'air', carbon_dioxide: 'air' };
    const GLANCE_BINARY = {
        door: 'doors', window: 'doors', opening: 'doors', garage_door: 'doors',
        motion: 'motion', occupancy: 'motion',
        smoke: 'alerts', carbon_monoxide: 'alerts', gas: 'alerts', moisture: 'alerts'
    };
    // never shown: anything that sounds a siren or an alarm
    const ALARMING = /\bsiren|\balarm/i;
    const HARDWARE_SETTING = /audio output|output (hardware )?mode/i;
    // buttons left out: the ones that restart, reset or identify a device
    // a camera's own controls, which Home Assistant marks config/diagnostic:
    // HOMER keeps these current so the Cameras screen can offer them
    const CAMERA_CONTROL = /^siren\.|^switch\..*privacy|^select\..*(doorbell_led|status_led|quick_reply)|^sensor\..*battery/i;
    const RISKY_BUTTON = /restart|reboot|reset|factory|shut ?down|power ?off|format|erase|delete|unpair|identify|update|firmware/i;
    const RISKY_BUTTON_CLASS = ['restart', 'identify', 'update'];
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
    let homeLoc = null; // { lat, lon } from Home Assistant's own config, for the weather alerts
    let tempUnit = '°F';
    let userName = '';
    let areas = []; // [{ area_id, name, icon, floor_id, temperature_entity_id }]
    let floors = [];
    let placeOf = new Map(); // entity_id -> area_id
    let deviceOf = new Map(); // entity_id -> device_id
    let devInfo = new Map(); // device_id -> { name, model, maker }
    let ownName = new Map(); // entity_id -> its own name, without the device's ("Amplifier")
    let mainOf = new Set(); // entities that are their device (a power strip's "all outlets")
    let platformOf = new Map(); // entity_id -> integration ("hue")
    let remotesOn = null; // device_id -> { id, platform }: its remote.* (Apple TV, Samsung TV), built when first asked
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
        devInfo = new Map();
        ownName = new Map();
        mainOf = new Set();
        platformOf = new Map();
        remotesOn = null;
        hidden = new Set();
        wallSwitches = new Set();
        states = {};
        doorbells = [];
        built = null;
        overlay.clear();
        ringCache.clear();
        houseName = '';
        userName = '';
        homeLoc = null;
    };

    const domainOf = (id) => id.split('.')[0];

    // Wall switches (TP-Link Kasa's HS200/HS210/KS200… in-wall switches) are
    // "switch" entities in Home Assistant, not lights, but they're a room's
    // lights (or its fan): Rooms shows them with the lights, on/off only.
    // Plugs and power strips (KP303, HS103…) are left out.
    const WALL_SWITCH_MODELS = /^(HS2\d\d|KS2\d\d|ES2\d)/i;
    const isWallSwitchDevice = (d) => /tp-?link|kasa/i.test(d.manufacturer || '') && WALL_SWITCH_MODELS.test(String(d.model || '').trim());
    let wallSwitches = new Set();
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
        homeLoc = config && typeof config.latitude === 'number' && typeof config.longitude === 'number'
            ? { lat: config.latitude, lon: config.longitude }
            : null;
        userName = (user && user.name) || '';
        areas = areaList || [];
        floors = floorList || [];
        const devArea = new Map((devices || []).map((d) => [d.id, d.area_id]));
        const wallDevice = new Set((devices || []).filter(isWallSwitchDevice).map((d) => d.id));
        devInfo = new Map((devices || []).map((d) => [d.id, { name: d.name_by_user || d.name || '', model: d.model || '', maker: d.manufacturer || '' }]));
        wallSwitches = new Set();
        placeOf = new Map();
        deviceOf = new Map();
        ownName = new Map();
        mainOf = new Set();
        platformOf = new Map();
        remotesOn = null;
        hidden = new Set();
        for (const e of (registry && registry.entities) || []) {
            if (e.di) deviceOf.set(e.ei, e.di);
            if (e.pl) platformOf.set(e.ei, e.pl);
            // has_entity_name: its own name is en, or none when it's the device itself
            if (e.hn && e.en) ownName.set(e.ei, e.en);
            else if (e.hn && e.di) mainOf.add(e.ei);
            const area = e.ai || (e.di && devArea.get(e.di)) || null;
            if (area) placeOf.set(e.ei, area);
            if (e.hb || e.ec != null) hidden.add(e.ei); // hidden, or a config/diagnostic entity
            else if (domainOf(e.ei) === 'switch' && e.di && wallDevice.has(e.di)) wallSwitches.add(e.ei);
        }
        // what HOMER shows: lights, thermostats, cameras, scenes, outlets,
        // players, fans, automations and helpers, the few sensors a room's
        // "at a glance" line uses, and anything that says the doorbell rang
        const wanted = new Set();
        states = {};
        for (const s of all || []) {
            const id = s.entity_id;
            const d = domainOf(id);
            const dc = (s.attributes && s.attributes.device_class) || '';
            const glance = (d === 'sensor' && GLANCE_SENSOR[dc]) || (d === 'binary_sensor' && GLANCE_BINARY[dc]);
            if (((DOMAINS.includes(d) || MORE.includes(d) || PRESENCE.includes(d) || glance) && !hidden.has(id)) || wallSwitches.has(id) || isDoorbellSensor(s)) wanted.add(id);
        }
        // A camera's own controls and its battery, which Home Assistant files
        // as config or diagnostic entities (so they stay out of the rooms:
        // kindOf still calls them hidden). The Cameras screen offers them
        // beside the live view, where they make sense.
        const camDevices = new Set();
        for (const s of all || []) {
            if (domainOf(s.entity_id) !== 'camera') continue;
            const dev = deviceOf.get(s.entity_id);
            if (dev) camDevices.add(dev);
        }
        if (camDevices.size) {
            for (const s of all || []) {
                const id = s.entity_id;
                if (CAMERA_CONTROL.test(id) && camDevices.has(deviceOf.get(id))) wanted.add(id);
            }
        }
        areas.forEach((a) => {
            if (a.temperature_entity_id) wanted.add(a.temperature_entity_id);
            if (a.humidity_entity_id) wanted.add(a.humidity_entity_id);
        });
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

    // An entity Home Assistant only remembers (its integration isn't running).
    // SmartThings appliances like that (the disconnected fridge, the oven, the
    // old TVs) are left out, with their devices; anything else (the Hue Sync
    // Box) stays, dimmed as unavailable, so it's clear it's there but down.
    const gone = (id) => {
        const s = states[id];
        if (!s) return true;
        return !!(s.attributes && s.attributes.restored) && platformOf.get(id) === 'smartthings';
    };
    const isGroup = (id) => { const a = (states[id] && states[id].attributes) || {}; return Array.isArray(a.entity_id) || !!a.is_hue_group; };

    // Players: one card per real player. The same speaker or TV often comes
    // in through two or three integrations (a WiiM as itself, as a DLNA
    // renderer and as a Cast target; a Samsung TV as itself and over DLNA):
    // when two players share a name or a model, the one from the device's own
    // integration stays and the generic ones go (DLNA, UPnP and SmartThings
    // below Cast, Cast below the rest). Two of a kind (two Nest Hubs) stay.
    const GENERIC_PLAYER = { dlna_dmr: 0, upnp: 0, smartthings: 0, cast: 1 };
    const playerRank = (id) => { const p = platformOf.get(id); return p in GENERIC_PLAYER ? GENERIC_PLAYER[p] : 2; };
    const plainName = (id) => String((states[id] && states[id].attributes.friendly_name) || id.split('.')[1]).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const players = () => {
        const list = Object.keys(states).filter((id) => domainOf(id) === 'media_player' && !hidden.has(id) && !gone(id));
        const modelOf = (id) => { const d = devInfo.get(deviceOf.get(id)); return d && d.model ? d.model.toLowerCase() : ''; };
        return new Set(list.filter((id) => !list.some((o) => o !== id && playerRank(o) > playerRank(id)
            && (plainName(o) === plainName(id) || (modelOf(id) && modelOf(o) === modelOf(id))))));
    };

    // where an entity goes in a room (or null: not shown). 'extra' is a
    // device's own setting (a purifier's child lock, a thermostat's mode
    // select), shown with that device, and 'glance' a sensor.
    const KIND = { light: 'lights', climate: 'climates', camera: 'cameras', scene: 'scenes', fan: 'fans', automation: 'auto', script: 'auto', input_boolean: 'auto' };
    const kindOf = (id, shownPlayers, owners) => {
        const d = domainOf(id);
        if (hidden.has(id) || gone(id)) return null;
        if (wallSwitches.has(id)) return 'lights';
        const s = states[id];
        const a = s.attributes || {};
        const label = (a.friendly_name || '') + ' ' + id;
        if (d === 'media_player') return shownPlayers.has(id) ? 'media' : null;
        if (d === 'camera') return twin(id) ? null : 'cameras';
        if (KIND[d]) return d === 'input_boolean' && ALARMING.test(label) ? null : KIND[d];
        const owner = owners.get(deviceOf.get(id));
        if (d === 'switch') {
            if (ALARMING.test(label)) return null;
            if (owner && owner !== id) {
                // "Power" on a purifier is the fan's own on/off, already there
                return /\bpower\b/i.test(ownName.get(id) || a.friendly_name || '') ? null : 'extra';
            }
            return 'switches';
        }
        if (d === 'button') {
            if (RISKY_BUTTON.test(label) || ALARMING.test(label) || RISKY_BUTTON_CLASS.includes(a.device_class)) return null;
            return owner ? 'extra' : 'auto';
        }
        // hardware settings a stray press could break (a WiiM's audio output
        // can silence the amp) stay in Home Assistant
        if (d === 'select' || d === 'number') return owner && !ALARMING.test(label) && !HARDWARE_SETTING.test(label) ? 'extra' : null;
        if (d === 'sensor' && GLANCE_SENSOR[a.device_class]) return 'glance';
        if (d === 'binary_sensor' && GLANCE_BINARY[a.device_class]) return 'glance';
        return null;
    };
    let extrasOf = new Map(); // a fan, player or thermostat -> its device's settings

    const emptyRoom = (props) => Object.assign({
        lights: [], climates: [], cameras: [], scenes: [], switches: [], media: [], fans: [], auto: [],
        glance: { temps: [], hums: [], doors: [], motion: [], air: [], alerts: [] }
    }, props);
    const controls = (r) => r.lights.length + r.cameras.length + r.scenes.length + r.switches.length + r.media.length + r.fans.length + r.auto.length;

    // house(): the rooms as HOMER shows them, each with its lights, cameras,
    // scenes, outlets, players, fans, automations and a few sensors (only
    // rooms with something to control; the thermostats are the house's, in
    // house.climates), then "Other" for what has no room. Floors order the
    // rooms when there are any.
    const house = () => {
        if (built) return built;
        const rooms = new Map();
        const floorLevel = new Map(floors.map((f) => [f.floor_id, f.level == null ? 0 : f.level]));
        const floorName = new Map(floors.map((f) => [f.floor_id, f.name]));
        const skipped = new Set(areas.filter((a) => HIDDEN_ROOMS.includes(String(a.name || '').trim().toLowerCase())).map((a) => a.area_id));
        for (const a of areas) {
            if (skipped.has(a.area_id)) continue;
            rooms.set(a.area_id, emptyRoom({
                id: a.area_id, name: a.name, icon: a.icon || '', floor: floorName.get(a.floor_id) || '',
                level: floorLevel.has(a.floor_id) ? floorLevel.get(a.floor_id) : 99,
                temperature: a.temperature_entity_id || null,
                humidity: a.humidity_entity_id || null
            }));
        }
        const other = emptyRoom({ id: '_other', name: 'Other', icon: '', floor: '', level: 100, temperature: null, humidity: null });
        const shownPlayers = players();
        // the devices whose settings are shown with them: a fan's, a player's,
        // a thermostat's
        const owners = new Map();
        for (const id of Object.keys(states)) {
            const d = domainOf(id);
            if (hidden.has(id) || gone(id) || !deviceOf.get(id)) continue;
            if (d === 'fan' || d === 'climate' || shownPlayers.has(id)) {
                if (!owners.has(deviceOf.get(id))) owners.set(deviceOf.get(id), id);
            }
        }
        extrasOf = new Map();
        for (const id of Object.keys(states)) {
            const kind = kindOf(id, shownPlayers, owners);
            if (!kind || skipped.has(placeOf.get(id))) continue;
            if (kind === 'extra') {
                const owner = owners.get(deviceOf.get(id));
                if (!extrasOf.has(owner)) extrasOf.set(owner, []);
                extrasOf.get(owner).push(id);
                continue;
            }
            const room = rooms.get(placeOf.get(id)) || other;
            if (kind === 'glance') {
                const a = states[id].attributes;
                room.glance[(domainOf(id) === 'sensor' ? GLANCE_SENSOR : GLANCE_BINARY)[a.device_class]].push(id);
            } else room[kind].push(id);
        }
        // a room's own temperature and humidity (set in Home Assistant's area) win
        for (const r of rooms.values()) {
            if (r.temperature && states[r.temperature]) r.glance.temps = [r.temperature];
            if (r.humidity && states[r.humidity]) r.glance.hums = [r.humidity];
        }
        let list = [...rooms.values(), other].filter((r) => controls(r) + r.climates.length > 0);
        for (const r of list) {
            const nm = (id) => nameOf(id, r.name);
            const byNm = (a, b) => nm(a).localeCompare(nm(b));
            // wall switches first, then the room's light group ("All lights"),
            // then the bulbs, each by name
            const group = (id) => (wallSwitches.has(id) ? 0 : isGroup(id) ? 1 : 2);
            r.lights.sort((a, b) => group(a) - group(b) || byNm(a, b));
            r.scenes.sort(byNm);
            r.cameras.sort(byNm);
            r.climates.sort(byNm);
            r.media.sort(byNm);
            r.fans.sort(byNm);
            // a power strip's outlets together, its "all outlets" first
            const strip = (id) => (devInfo.get(deviceOf.get(id)) || {}).name || nm(id);
            r.switches.sort((a, b) => strip(a).localeCompare(strip(b)) || Number(mainOf.has(b)) - Number(mainOf.has(a)) || byNm(a, b));
            // automations, then helpers, then scripts and buttons
            const order = { automation: 0, input_boolean: 1, script: 2, button: 2 };
            r.auto.sort((a, b) => order[domainOf(a)] - order[domainOf(b)] || byNm(a, b));
        }
        for (const list2 of extrasOf.values()) {
            // switches, then choices, then numbers, then buttons
            const order = { switch: 0, select: 1, number: 2, button: 3 };
            list2.sort((a, b) => order[domainOf(a)] - order[domainOf(b)] || nameOf(a, '').localeCompare(nameOf(b, '')));
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
        list = list.filter((r) => controls(r) > 0);
        list.sort((a, b) => a.level - b.level || (a.id === '_other' ? 1 : b.id === '_other' ? -1 : byName(a, b)));
        const cameras = list.flatMap((r) => r.cameras);
        built = { name: houseName, version: haVersion, user: userName, url: address(), unit: tempUnit, rooms: list, cameras, climates, doorbells: doorbells.slice() };
        return built;
    };
    // registries don't change often; the states do, so the house is rebuilt
    // only when an entity comes or goes (or an integration comes back)
    const countSig = () => {
        const ids = Object.keys(states);
        return ids.length + ':' + ids.filter((id) => states[id].attributes && states[id].attributes.restored).length;
    };
    listeners.add(() => {
        if (built && countSig() !== built._count) built = null;
    });
    const houseWithCount = () => {
        const h = house();
        h._count = countSig();
        return h;
    };
    // a fan's, player's or thermostat's own settings (switches, selects,
    // numbers, buttons on the same device)
    const extras = (id) => { house(); return (extrasOf.get(id) || []).filter((x) => states[x]); };
    // { name, model, maker } of an entity's device
    const device = (id) => devInfo.get(deviceOf.get(id)) || null;
    // every other entity on the same device that HOMER keeps current: a
    // doorbell's siren, its quick replies, its LED, its privacy switch, its
    // battery. (Home Assistant files most of those as config or diagnostic
    // entities, which keeps them out of the rooms; the Cameras screen asks
    // for them by name.)
    const siblings = (id) => {
        const dev = deviceOf.get(id);
        if (!dev) return [];
        return Object.keys(states).filter((x) => x !== id && deviceOf.get(x) === dev);
    };
    // an entity's name next to its device ("Amplifier", "Child lock"): its
    // own name when it has one, less the room's name
    const ALIASES = [[/^physical control(s)? lock(ed)?$/i, 'Child lock'], [/^custom[- ]service /i, ''], [/\s+hardware mode$/i, '']];
    const shortName = (id, areaName) => {
        let n = ownName.get(id);
        if (!n) return nameOf(id, areaName);
        n = n.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
        for (const [re, to] of ALIASES) n = n.replace(re, to).trim();
        if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + ' ') && n.length > areaName.length + 2) n = n.slice(areaName.length + 1);
        return n.charAt(0).toUpperCase() + n.slice(1);
    };

    // ---------- Who's home ----------
    //
    // Home Assistant keeps two views of where someone is. A person entity is
    // the deduplicated one: one entity per person, following whichever of
    // their phones or trackers last had something to say, with their picture
    // on it. A device_tracker is one device. So people() answers with the
    // person entities when the house has any, and falls back to the trackers
    // for a house that never set people up. Read only: nothing here calls a
    // service, and nothing here changes anything in Home Assistant.
    //
    // state is Home Assistant's own: 'home', 'not_home', or the name of a
    // zone the person is in ("Work", "School").
    const initialsOf = (name) => String(name || '').trim().split(/[\s._-]+/).filter(Boolean)
        .slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
    const whereText = (state) => (state === 'home' ? 'Home'
        : state === 'not_home' ? 'Away'
            : !state || state === 'unknown' || state === 'unavailable' ? 'Unknown' : state);
    const oneperson = (id) => {
        const s = states[id];
        if (!s) return null;
        const a = s.attributes || {};
        let name = a.friendly_name || id.split('.')[1].replace(/_/g, ' ');
        name = name.charAt(0).toUpperCase() + name.slice(1);
        // person.source names the tracker that decided; that tracker is the
        // one Home Assistant may have put in an area
        const src = a.source && states[a.source] ? a.source : id;
        return {
            id,
            name,
            initials: initialsOf(name),
            // the proxy URL; loadPicture(id) is the one that checks it draws
            picture: pictureUrl(id),
            state: s.state,
            home: s.state === 'home',
            away: s.state === 'not_home',
            where: whereText(s.state),
            since: Date.parse(s.last_changed) || 0,
            source: src,
            area: placeOf.get(src) || placeOf.get(id) || null
        };
    };
    const people = () => {
        const live = (id) => !hidden.has(id) && !gone(id) && states[id];
        const persons = Object.keys(states).filter((id) => domainOf(id) === 'person' && live(id));
        const list = persons.length
            ? persons
            : Object.keys(states).filter((id) => domainOf(id) === 'device_tracker' && live(id));
        // home first, then by name, so "who's in" reads left to right
        return list.map(oneperson).filter(Boolean)
            .sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name));
    };
    // the people Home Assistant places in a room, for that room's own line
    const peopleIn = (areaId) => (areaId ? people().filter((p) => p.home && p.area === areaId) : []);

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

    // ---------- A bulb's color ----------

    const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
    const hsToRgb = ([h, s]) => {
        const f = (n) => {
            const k = (n + h / 60) % 6;
            return Math.round(255 * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1))));
        };
        return [f(5), f(3), f(1)];
    };
    // a white's color on screen (Tanner Helland's approximation)
    const kelvinToRgb = (k) => {
        const t = k / 100;
        const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
        const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
        const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
        return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))));
    };
    // what a bulb can do with color, and what it's showing: { color, white,
    // min, max (kelvin), kelvin, hs, rgb (null when off) }, or null for a
    // bulb that only dims
    const color = (id) => {
        const s = entity(id);
        if (!s || domainOf(id) !== 'light') return null;
        const a = s.attributes;
        const modes = a.supported_color_modes || [];
        const hasColor = modes.some((m) => COLOR_MODES.includes(m));
        const white = modes.includes('color_temp');
        if (!hasColor && !white) return null;
        const on = s.state === 'on';
        const kelvin = a.color_mode === 'color_temp' ? a.color_temp_kelvin : null;
        const rgb = !on ? null : a.rgb_color || (kelvin ? kelvinToRgb(kelvin) : a.hs_color ? hsToRgb(a.hs_color) : null);
        return {
            color: hasColor,
            white,
            min: a.min_color_temp_kelvin || 2000,
            max: a.max_color_temp_kelvin || 6500,
            kelvin: on ? kelvin : null,
            hs: on && a.color_mode !== 'color_temp' && a.hs_color ? a.hs_color : null,
            rgb
        };
    };
    // setColor(id, { hs: [h, s] }) or ({ kelvin }): turns the bulb on in that
    // color (hs_color works for any color bulb; Home Assistant converts it to
    // the bulb's own xy or rgb). The remote's presses are sent as one.
    const setColor = (id, { hs, kelvin }) => {
        const c = color(id);
        if (!c) return;
        const hueNear = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 10;
        if (hs) {
            expect(id, 'on', { color_mode: 'hs', hs_color: hs, rgb_color: hsToRgb(hs), color_temp_kelvin: null },
                (x) => x.state === 'on' && x.attributes.color_mode !== 'color_temp' && !!x.attributes.hs_color && hueNear(x.attributes.hs_color[0], hs[0]), 8000);
        } else {
            kelvin = Math.round(Math.max(c.min, Math.min(c.max, kelvin)));
            expect(id, 'on', { color_mode: 'color_temp', color_temp_kelvin: kelvin, rgb_color: kelvinToRgb(kelvin) },
                (x) => x.state === 'on' && x.attributes.color_mode === 'color_temp' && Math.abs((x.attributes.color_temp_kelvin || 0) - kelvin) < 150, 8000);
        }
        later('c:' + id, 350, () => {
            call('light', 'turn_on', hs ? { hs_color: hs.map((v) => Math.round(v)) } : { color_temp_kelvin: kelvin }, id).catch(failed(id));
        });
    };

    // ---------- Players ----------

    // Home Assistant's media player features
    const MF = {
        pause: 1, volumeSet: 4, mute: 8, previous: 16, next: 32, turnOn: 128, turnOff: 256,
        volumeStep: 1024, source: 2048, stop: 4096, play: 16384
    };
    const supports = (id, what) => {
        const s = entity(id);
        const bit = typeof what === 'number' ? what : MF[what];
        return !!s && ((s.attributes.supported_features || 0) & bit) === bit;
    };
    const playPause = (id) => {
        const s = entity(id);
        if (!s) return Promise.resolve();
        const playing = s.state === 'playing';
        const service = playing ? (supports(id, 'pause') ? 'media_pause' : 'media_stop') : 'media_play';
        expect(id, playing ? 'paused' : 'playing', null, (x) => x.state !== s.state);
        return call('media_player', service, {}, id).catch(failed(id));
    };
    // 'media_next_track', 'media_previous_track', 'clear_playlist'
    const mediaCommand = (id, service, data) => call('media_player', service, data || {}, id);
    // Hand a player something to play. `extra` is where enqueue goes, for the
    // integrations that take it: { enqueue: 'replace' | 'add' | 'next' }.
    const playMedia = (id, contentId, contentType, extra) => call('media_player', 'play_media',
        Object.assign({ media_content_id: contentId, media_content_type: contentType || 'music' }, extra || {}), id);
    // 0–1; the remote's presses are sent as one
    const setVolume = (id, v) => {
        v = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
        expect(id, null, { volume_level: v }, (x) => Math.abs((x.attributes.volume_level || 0) - v) < 0.02, 8000);
        later('v:' + id, 300, () => call('media_player', 'volume_set', { volume_level: v }, id).catch(failed(id)));
    };
    // for players that only step (up and down, no level)
    const stepVolume = (id, d) => call('media_player', d > 0 ? 'volume_up' : 'volume_down', {}, id);
    const mute = (id) => {
        const s = entity(id);
        const m = !(s && s.attributes.is_volume_muted);
        expect(id, null, { is_volume_muted: m }, (x) => !!x.attributes.is_volume_muted === m);
        return call('media_player', 'volume_mute', { is_volume_muted: m }, id).catch(failed(id));
    };
    const setSource = (id, source) => {
        expect(id, null, { source }, (x) => x.attributes.source === source, 8000);
        return call('media_player', 'select_source', { source }, id).catch(failed(id));
    };
    // a player (a TV) on or off
    const power = (id) => {
        const s = entity(id);
        const on = !!s && (s.state === 'off' || s.state === 'standby');
        expect(id, on ? 'on' : 'off', null, (x) => (x.state !== 'off' && x.state !== 'standby') === on, 12000);
        return call('media_player', on ? 'turn_on' : 'turn_off', {}, id).catch(failed(id));
    };
    // a player's picture (album art, a TV's app), for an <img> (the player's
    // own token is in the address, like a camera still's)
    const pictureUrl = (id) => {
        const s = entity(id);
        const pic = s && s.attributes.entity_picture;
        if (!pic) return '';
        if (/^(https?:|data:)/.test(pic)) return pic;
        return address() + pic;
    };

    // The artwork's own address, where Home Assistant's proxy URL carries it.
    //
    // Home Assistant builds a player's entity_picture as
    //   /api/media_player_proxy/<entity>?token=<the player's>&cache=<hash>
    // and for some integrations (the Apple TV's) that cache= is not a hash at
    // all but the artwork's real address, straight from the music service:
    //   https://is1-ssl.mzstatic.com/image/thumb/…/{w}x{h}{c}.{f}
    // — a template Apple fills in, so it has to be filled in here: a size, a
    // crop and a format. It matters because the proxy itself answers 200 with
    // an image/heic body for an Apple TV, and no browser but Safari can draw
    // HEIC, so the <img> fails on a perfectly good reply. This address gives
    // the same cover as a JPEG that every browser reads.
    const ART_SIZE = 600;
    const remoteArt = (pic) => {
        const q = String(pic || '').split('?')[1] || '';
        const hit = q.split('&').map((p) => p.split('=')).find((p) => p[0] === 'cache');
        let url = hit ? decodeURIComponent(hit.slice(1).join('=')) : '';
        if (!/^https?:\/\//i.test(url)) return '';
        url = url.replace(/\{w\}|\{width\}/gi, ART_SIZE).replace(/\{h\}|\{height\}/gi, ART_SIZE)
            .replace(/\{c\}/gi, 'bb').replace(/\{f\}/gi, 'jpg');
        return /[{}]/.test(url) ? '' : url; // a placeholder left over: not ours to fill
    };

    // Every picture worth trying for a player, best first: Home Assistant's
    // own proxy (local, and right for nearly every integration), then the
    // artwork's own address where the proxy URL carries one.
    const pictureUrls = (id) => {
        const s = entity(id);
        const pic = (s && s.attributes.entity_picture) || '';
        if (!pic) return [];
        if (/^(https?:|data:)/.test(pic)) return [pic];
        const out = [address() + pic];
        const far = remoteArt(pic);
        if (far) out.push(far);
        return out;
    };

    // The first of those an <img> can actually draw, or '' when none of them
    // can. Answers the same promise while a picture is unchanged, so a screen
    // that repaints ten times a second asks the network once. A picture that
    // fails is remembered only briefly: a token that went stale, or a Wi-Fi
    // blip, is worth another try.
    const PICTURE_MS = 12000; // how long one <img> gets before it counts as failed
    const PICTURE_MISS_MS = 30000; // how long a failure is remembered
    const pictureTried = new Map(); // the candidates, joined -> Promise<url>
    const drawable = (url) => new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const end = (ok) => { if (!done) { done = true; resolve(ok); } };
        img.onload = () => end(img.naturalWidth > 0);
        img.onerror = () => end(false);
        img.src = url;
        setTimeout(() => end(false), PICTURE_MS);
    });
    const loadPicture = (id) => {
        const list = pictureUrls(id);
        if (!list.length) return Promise.resolve('');
        const key = list.join('\n');
        const had = pictureTried.get(key);
        if (had) return had;
        const next = (i) => (i >= list.length
            ? Promise.resolve('')
            : drawable(list[i]).then((ok) => (ok ? list[i] : next(i + 1))));
        const p = next(0).then((url) => {
            if (url) return url;
            // nothing drew: the player's token may have been replaced while
            // this ran (Home Assistant mints a new one when it restarts), so
            // rebuild from the state as it stands now and try that once
            const again = pictureUrls(id);
            if (again.length && again.join('\n') !== key) return loadPicture(id);
            setTimeout(() => { if (pictureTried.get(key) === p) pictureTried.delete(key); }, PICTURE_MISS_MS);
            return '';
        }, () => '');
        pictureTried.set(key, p);
        if (pictureTried.size > 60) pictureTried.delete(pictureTried.keys().next().value);
        return p;
    };

    // ---------- A player's remote (Apple TV, Samsung TV) ----------
    //
    // A player whose device also has a remote.* entity from the Apple TV or
    // Samsung TV integration gets a whole remote in Rooms. Matched through the
    // device registry (same device_id), the integration from the entity
    // registry. HOMER's key names are the Apple TV's; each integration's own
    // command names, as its remote.send_command takes them:
    //
    //   Apple TV  https://www.home-assistant.io/integrations/apple_tv/#remote
    //     (up, down, left, right, select, menu, home, top_menu, play, pause,
    //     skip_forward, skip_backward, volume_up, volume_down, …). A name
    //     that isn't in the docs' list is looked up on pyatv's RemoteControl
    //     (homeassistant/components/apple_tv/remote.py), which is how
    //     play_pause works: https://pyatv.dev/api/interface/#pyatv.interface.RemoteControl
    //   Samsung TV  https://www.home-assistant.io/integrations/samsungtv/#remote
    //     KEY_ codes, from https://github.com/jaruba/ha-samsungtv-tizen/blob/master/Key_codes.md
    //     (KEY_UP … KEY_ENTER, KEY_RETURN, KEY_HOME, KEY_VOLUP, KEY_VOLDOWN,
    //     KEY_MUTE, KEY_PLAY, KEY_PAUSE, KEY_FF, KEY_REWIND). There's no
    //     play/pause key: play_pause sends KEY_PAUSE or KEY_PLAY (below).
    //
    // delay_secs: 0 on every command. remote.send_command waits delay_secs
    // (0.4 s unless it's given: remote's DEFAULT_DELAY_SECS) after each
    // command before it answers (the Apple TV's does), which would hold
    // every press 0.4 s for nothing.
    const REMOTE_COMMANDS = {
        apple_tv: {
            up: 'up', down: 'down', left: 'left', right: 'right', select: 'select',
            menu: 'menu', home: 'home', top_menu: 'top_menu', play_pause: 'play_pause',
            skip_forward: 'skip_forward', skip_backward: 'skip_backward',
            volume_up: 'volume_up', volume_down: 'volume_down'
        },
        samsungtv: {
            up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', select: 'KEY_ENTER',
            menu: 'KEY_RETURN', home: 'KEY_HOME', play: 'KEY_PLAY', pause: 'KEY_PAUSE',
            skip_forward: 'KEY_FF', skip_backward: 'KEY_REWIND',
            volume_up: 'KEY_VOLUP', volume_down: 'KEY_VOLDOWN', mute: 'KEY_MUTE'
        }
    };
    // the remote on a player's device: { id, platform } or null
    const remoteFor = (playerId) => {
        if (!remotesOn) {
            remotesOn = new Map();
            for (const [id, dev] of deviceOf) {
                const p = platformOf.get(id);
                if (domainOf(id) === 'remote' && REMOTE_COMMANDS[p] && !remotesOn.has(dev)) remotesOn.set(dev, { id, platform: p });
            }
        }
        return remotesOn.get(deviceOf.get(playerId)) || null;
    };
    const remoteBusy = new Map(); // remote id -> presses sent, not answered yet
    const lastPlayKey = new Map(); // a Samsung's remote id -> KEY_PLAY or KEY_PAUSE, whichever went last
    const remoteLog = []; // the last presses sent (for testing: HomerHA._remoteLog())
    // A key pressed on a player's remote (a key name above). Sent at once,
    // straight over the connection: it never waits for an earlier press. A
    // key held down (repeat: true) is dropped while two presses are still
    // unanswered, so a held arrow never piles up behind a slow device.
    // Resolves true when sent, false when dropped.
    const sendRemote = (playerId, key, opts = {}) => {
        const R = remoteFor(playerId);
        if (!R) return Promise.reject(new Error('no remote for ' + playerId));
        let command = REMOTE_COMMANDS[R.platform][key];
        if (key === 'play_pause' && !command) {
            // Samsung: pause what's playing, play what's paused; its player
            // seldom says which, so otherwise the opposite of the last one
            const s = entity(playerId);
            const st = s && s.state;
            command = st === 'playing' ? 'KEY_PAUSE' : st === 'paused' ? 'KEY_PLAY' : lastPlayKey.get(R.id) === 'KEY_PAUSE' ? 'KEY_PLAY' : 'KEY_PAUSE';
            lastPlayKey.set(R.id, command);
        }
        if (!command && key === 'mute' && supports(playerId, 'mute')) return mute(playerId).then(() => true);
        if (!command) return Promise.reject(new Error(`${R.platform} has no ${key} key`));
        const busy = remoteBusy.get(R.id) || 0;
        if (opts.repeat && busy >= 2) return Promise.resolve(false);
        remoteBusy.set(R.id, busy + 1);
        remoteLog.push({ at: Date.now(), remote: R.id, platform: R.platform, key, command });
        if (remoteLog.length > 50) remoteLog.shift();
        const done = () => remoteBusy.set(R.id, Math.max(0, (remoteBusy.get(R.id) || 1) - 1));
        return call('remote', 'send_command', { command, delay_secs: 0 }, R.id).then(() => { done(); return true; }, (err) => {
            done();
            warn('remote key failed', R.id, command, err && err.message);
            throw err;
        });
    };

    // ---------- Fans, choices, numbers, buttons ----------

    // 0–100; the remote's presses are sent as one
    const setFanSpeed = (id, pct) => {
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        expect(id, pct > 0 ? 'on' : 'off', { percentage: pct }, (x) => (pct > 0 ? x.attributes.percentage === pct : x.state === 'off'), 8000);
        later('f:' + id, 400, () => call('fan', 'set_percentage', { percentage: pct }, id).catch(failed(id)));
    };
    const setPreset = (id, mode) => {
        expect(id, 'on', { preset_mode: mode }, (x) => x.attributes.preset_mode === mode);
        return call('fan', 'set_preset_mode', { preset_mode: mode }, id).catch(failed(id));
    };
    const setOption = (id, option) => {
        expect(id, option, null, (x) => x.state === option);
        return call(domainOf(id), 'select_option', { option }, id).catch(failed(id));
    };
    const setNumber = (id, value) => {
        const s = entity(id);
        if (!s) return;
        const a = s.attributes;
        const v = Math.max(a.min != null ? a.min : -Infinity, Math.min(a.max != null ? a.max : Infinity, value));
        expect(id, String(v), null, (x) => Math.abs(parseFloat(x.state) - v) < 1e-6, 8000);
        later('n:' + id, 500, () => call(domainOf(id), 'set_value', { value: v }, id).catch(failed(id)));
    };
    // a button pressed, a script run
    const run = (id) => {
        const d = domainOf(id);
        if (d === 'button') return call('button', 'press', {}, id);
        if (d === 'script') return call('script', 'turn_on', {}, id);
        return call(d, 'turn_on', {}, id);
    };

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

    // ---------- Media sources (the cameras' own recordings) ----------

    // Home Assistant's media browser over the WebSocket. The Reolink
    // integration puts the doorbell's recordings at media-source://reolink,
    // a tree of camera → resolution → day → clip; browse() walks it and
    // resolve() turns a clip into a URL a <video> can load. The URL carries
    // its own signature (?authSig=…), like a camera still's token, so it
    // isn't CORS-gated — but it also isn't readable by fetch() from another
    // origin, so it can only be handed to a media element, never inspected.
    const browseMedia = (id) => {
        if (mocking()) return mockBrowse(id);
        return send({ type: 'media_source/browse_media', ...(id ? { media_content_id: id } : {}) });
    };
    const resolveMedia = async (id) => {
        if (mocking()) return mockResolve(id);
        const r = await send({ type: 'media_source/resolve_media', media_content_id: id });
        const url = r && r.url ? r.url : '';
        return { url: /^https?:/i.test(url) ? url : address() + url, mime: (r && r.mime_type) || '' };
    };

    // Every state an entity was in over a stretch of time, oldest first:
    // [{ state, at }]. HOMER's fallback for a camera's events when the
    // camera itself keeps no clips (or Home Assistant's recorder has more
    // than the camera does).
    const history = async (ids, hours = 24) => {
        const list = Array.isArray(ids) ? ids : [ids];
        if (mocking()) return mockHistory(list, hours);
        const r = await send({
            type: 'history/history_during_period',
            start_time: new Date(Date.now() - hours * 3600000).toISOString(),
            entity_ids: list,
            minimal_response: true,
            no_attributes: true,
            significant_changes_only: false
        });
        const out = {};
        for (const id of list) {
            out[id] = ((r && r[id]) || []).map((x) => ({
                state: x.s !== undefined ? x.s : x.state,
                at: x.lu != null ? x.lu * 1000 : x.lc != null ? x.lc * 1000 : Date.parse(x.last_changed || x.last_updated)
            })).filter((x) => isFinite(x.at));
        }
        return out;
    };

    // ---------- The made-up house (DEV ONLY: localStorage homer-ha-mock = 1) ----------

    let mockTimer = 0;
    const MOCK_AREAS = [
        ['living_room', 'Living Room', 'first'], ['kitchen', 'Kitchen', 'first'], ['dining_room', 'Dining Room', 'first'],
        ['hallway', 'Hallway', 'first'], ['front_door', 'Front Door', 'outside'], ['backyard', 'Backyard', 'outside'],
        ['garage', 'Garage', 'outside'], ['primary_bedroom', 'Primary Bedroom', 'second'], ['office', 'Office', 'second']
    ];
    const MOCK_LIGHTS = [
        ['living_room', 'Living Room', 'on', 70, true], ['living_room', 'Floor Lamp', 'on', 55], ['living_room', 'Ceiling', 'off', 0],
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
            // Hue-like bulbs: white and color; the plain ones only dim or switch
            const hue = pct != null && !/ceiling|cabinet|chandelier/i.test(name);
            const attrs = {
                friendly_name: name,
                supported_color_modes: pct == null ? ['onoff'] : hue ? ['color_temp', 'xy'] : ['brightness'],
                min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6535
            };
            if (pct != null && st === 'on') attrs.brightness = Math.round(pct * 2.55);
            if (hue && st === 'on') {
                if (/backlight/i.test(name)) Object.assign(attrs, { color_mode: 'xy', hs_color: [262, 70], rgb_color: hsToRgb([262, 70]) });
                else Object.assign(attrs, { color_mode: 'color_temp', color_temp_kelvin: 2700, rgb_color: kelvinToRgb(2700) });
            }
            if (isGroup) Object.assign(attrs, { entity_id: ['light.floor_lamp', 'light.ceiling', 'light.tv_backlight'], is_hue_group: true });
            put(id, st, attrs);
            placeOf.set(id, area);
            platformOf.set(id, 'hue');
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
        // the doorbell's own controls, as a Reolink video doorbell has them,
        // so the Cameras screen's buttons can be seen without the real one
        const bell = (id, state, attrs) => {
            put(id, state, attrs);
            deviceOf.set(id, 'dev_front_door');
            placeOf.set(id, 'front_door');
        };
        bell('siren.front_door_siren', 'off', { friendly_name: 'Front Door Siren' });
        bell('switch.front_door_privacy_mode', 'off', { friendly_name: 'Front Door Privacy mode' });
        bell('select.front_door_doorbell_led', 'auto', { friendly_name: 'Front Door Doorbell LED', options: ['stayoff', 'auto', 'alwaysonatnight', 'alwayson'] });
        bell('select.front_door_play_quick_reply_message', 'unknown', {
            friendly_name: 'Front Door Play quick reply message',
            options: ['I\'m sorry. I think you\'ve knocked on the wrong door.', 'Hi, we will be right there. Please wait a moment.', 'Hi, please leave the package at the door. We will get it later.']
        });
        bell('sensor.front_door_battery', '62', { friendly_name: 'Front Door Battery', unit_of_measurement: '%', device_class: 'battery' });
        bell('binary_sensor.front_door_person', 'off', { friendly_name: 'Front Door Person' });
        bell('binary_sensor.front_door_motion', 'off', { friendly_name: 'Front Door Motion', device_class: 'motion' });
        put('climate.hallway_thermostat', 'cool', {
            friendly_name: 'Hallway Thermostat', current_temperature: 74, temperature: 72, min_temp: 50, max_temp: 90,
            hvac_modes: ['off', 'heat', 'cool', 'heat_cool', 'fan_only'], hvac_action: 'cooling', target_temp_step: 1, current_humidity: 48
        });
        placeOf.set('climate.hallway_thermostat', 'hallway');
        put('sensor.living_room_temperature', '72.5', { friendly_name: 'Living Room Temperature', unit_of_measurement: '°F', device_class: 'temperature' });
        mockMore(put);
        mockPeople(put);
        homeLoc = { lat: 32.589, lon: -96.3089 }; // Kaufman, TX: the same place HOMER's weather falls back to
        mockRingTimes = [new Date(Date.now() - 42 * 60000), new Date(Date.now() - 5.2 * 3600000), new Date(Date.now() - 20 * 3600000)];
        findDoorbells();
        clearInterval(mockTimer);
        // the cameras' clocks tick
        mockTimer = setInterval(emit, 1000);
        setStatus('ready');
        emit();
    };
    // the rest of the made-up house: outlets and power strips, players (a
    // Sonos group across two rooms), a purifier with its settings, sensors,
    // automations, and the things HOMER must leave out (a siren, a fridge
    // that's gone)
    const mockArt = (a, b, text) => {
        const c = document.createElement('canvas');
        c.width = c.height = 240;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 240, 240);
        grad.addColorStop(0, a);
        grad.addColorStop(1, b);
        g.fillStyle = grad;
        g.fillRect(0, 0, 240, 240);
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.font = '800 30px Barlow, sans-serif';
        g.fillText(text, 20, 214);
        return c.toDataURL('image/jpeg', 0.85);
    };
    const mockMore = (put) => {
        const dev = (entity, device, info, own) => {
            deviceOf.set(entity, device);
            if (!devInfo.has(device)) devInfo.set(device, info);
            if (own === null) mainOf.add(entity);
            else if (own) ownName.set(entity, own);
        };
        const at = (id, area) => placeOf.set(id, area);
        // wall switches with the living room's lights
        const kasa = { model: 'HS200', maker: 'TP-Link' };
        put('switch.living_room_fan_light', 'on', { friendly_name: 'Living Room Fan Light' });
        dev('switch.living_room_fan_light', 'dev_lr_fanlight', Object.assign({ name: 'Living Room Fan Light' }, kasa), null);
        put('switch.living_room_fan', 'off', { friendly_name: 'Living Room Fan' });
        dev('switch.living_room_fan', 'dev_lr_fan', Object.assign({ name: 'Living Room Fan' }, kasa), null);
        ['switch.living_room_fan_light', 'switch.living_room_fan'].forEach((id) => { at(id, 'living_room'); wallSwitches.add(id); });
        // power strips
        const strip = (area, device, name, outlets) => {
            const base = 'switch.' + slug(name);
            put(base, outlets.some((o) => o[1] === 'on') ? 'on' : 'off', { friendly_name: name });
            dev(base, device, { name, model: 'KP303', maker: 'TP-Link' }, null);
            at(base, area);
            for (const [own, st] of outlets) {
                const id = base + '_' + slug(own);
                put(id, st, { friendly_name: name + ' ' + own });
                dev(id, device, null, own);
                at(id, area);
            }
        };
        strip('living_room', 'dev_strip_lr', 'TP-LINK_Power Strip_7085', [['Amplifier', 'on'], ['Turntable', 'off'], ['Bookshelf', 'off']]);
        strip('office', 'dev_strip_office', 'Office Power Strip', [['Office Amplifier', 'on'], ['Office Turntable', 'on'], ['Plug 3', 'off']]);
        put('switch.garage', 'on', { friendly_name: 'Garage', device_class: 'outlet' });
        // players: a Sonos group (the living room leads, the kitchen follows), a TV, a WiiM
        const sonos = 4127295;
        const song = {
            media_title: 'Harvest Moon', media_artist: 'Neil Young', media_album_name: 'Harvest Moon', media_content_type: 'music',
            media_duration: 302, media_position: 74, media_position_updated_at: new Date().toISOString()
        };
        const art = mockArt('#c9743a', '#3b2a5c', 'HARVEST MOON');
        put('media_player.living_room_sonos', 'playing', Object.assign({
            friendly_name: 'Living Room', volume_level: 0.32, is_volume_muted: false, supported_features: sonos, source_list: ['TV', 'Line-in'],
            group_members: ['media_player.living_room_sonos', 'media_player.kitchen_sonos'], entity_picture: art
        }, song));
        dev('media_player.living_room_sonos', 'dev_sonos_lr', { name: 'Living Room', model: 'SYMFONISK Picture frame', maker: 'Sonos' }, null);
        at('media_player.living_room_sonos', 'living_room');
        platformOf.set('media_player.living_room_sonos', 'sonos');
        put('media_player.kitchen_sonos', 'playing', Object.assign({
            friendly_name: 'Kitchen', volume_level: 0.2, is_volume_muted: false, supported_features: sonos,
            group_members: ['media_player.living_room_sonos', 'media_player.kitchen_sonos'], entity_picture: art
        }, song));
        dev('media_player.kitchen_sonos', 'dev_sonos_k', { name: 'Kitchen', model: 'One SL', maker: 'Sonos' }, null);
        at('media_player.kitchen_sonos', 'kitchen');
        platformOf.set('media_player.kitchen_sonos', 'sonos');
        put('media_player.living_room_tv', 'on', {
            friendly_name: 'Living Room TV', volume_level: 0.18, is_volume_muted: false, supported_features: 24509,
            source_list: ['TV', 'HDMI 1', 'HDMI 2', 'HDMI 3'], source: 'HDMI 1', device_class: 'tv'
        });
        dev('media_player.living_room_tv', 'dev_tv_lr', { name: 'Living Room TV', model: 'QN65Q80', maker: 'Samsung' }, null);
        at('media_player.living_room_tv', 'living_room');
        platformOf.set('media_player.living_room_tv', 'samsungtv');
        // and its remote (Samsung TV's remote.*, on the same device)
        put('remote.living_room_tv', 'on', { friendly_name: 'Living Room TV' });
        dev('remote.living_room_tv', 'dev_tv_lr', null, null);
        at('remote.living_room_tv', 'living_room');
        platformOf.set('remote.living_room_tv', 'samsungtv');
        // an Apple TV in the bedroom, with its remote (like the real one)
        const atv = { name: 'Apple TV', model: 'Apple TV 4K (gen 3)', maker: 'Apple' };
        put('media_player.apple_tv', 'playing', {
            friendly_name: 'Apple TV', supported_features: 22449, app_name: 'Jellyfin', app_id: 'org.jellyfin.swiftfin',
            media_title: 'Fishes', media_series_title: 'The Bear', media_season: 2, media_episode: 6, media_content_type: 'tvshow',
            media_duration: 3960, media_position: 1512, media_position_updated_at: new Date().toISOString(),
            entity_picture: mockArt('#1d4f7a', '#0b1a2e', 'THE BEAR')
        });
        dev('media_player.apple_tv', 'dev_atv_bed', atv, null);
        at('media_player.apple_tv', 'primary_bedroom');
        platformOf.set('media_player.apple_tv', 'apple_tv');
        put('remote.apple_tv', 'on', { friendly_name: 'Apple TV' });
        dev('remote.apple_tv', 'dev_atv_bed', null, null);
        at('remote.apple_tv', 'primary_bedroom');
        platformOf.set('remote.apple_tv', 'apple_tv');
        // the same TV again over DLNA: left out
        put('media_player.living_room_tv_dlna', 'unavailable', { friendly_name: 'Living Room TV', supported_features: 0 });
        dev('media_player.living_room_tv_dlna', 'dev_tv_lr_dlna', { name: 'Living Room TV', model: 'QN65Q80', maker: 'Samsung' }, null);
        at('media_player.living_room_tv_dlna', 'living_room');
        platformOf.set('media_player.living_room_tv_dlna', 'dlna_dmr');
        put('media_player.office_wiim', 'unavailable', { friendly_name: 'Office Wiim', supported_features: 743949 });
        dev('media_player.office_wiim', 'dev_wiim_office', { name: 'Office Wiim', model: 'WiiM Mini', maker: 'WiiM' }, null);
        at('media_player.office_wiim', 'office');
        platformOf.set('media_player.office_wiim', 'linkplay');
        // switched on but not playing anything: Now Playing's quiet "Ready" strip
        put('media_player.kitchen_display', 'off', { friendly_name: 'Kitchen Display', supported_features: 152461 });
        dev('media_player.kitchen_display', 'dev_nest_kitchen', { name: 'Kitchen Display', model: 'Nest Hub', maker: 'Google' }, null);
        at('media_player.kitchen_display', 'kitchen');
        platformOf.set('media_player.kitchen_display', 'cast');
        put('media_player.office_speaker', 'idle', { friendly_name: 'Office Speaker', volume_level: 0.35, supported_features: 84045 });
        dev('media_player.office_speaker', 'dev_office_speaker', { name: 'Office Speaker', model: 'One SL', maker: 'Sonos' }, null);
        at('media_player.office_speaker', 'office');
        platformOf.set('media_player.office_speaker', 'sonos');
        put('media_player.primary_bedroom_tv', 'standby', { friendly_name: 'Primary Bedroom TV', device_class: 'tv', supported_features: 24509 });
        dev('media_player.primary_bedroom_tv', 'dev_tv_bed', { name: 'Primary Bedroom TV', model: 'TCL 55S5', maker: 'TCL' }, null);
        at('media_player.primary_bedroom_tv', 'primary_bedroom');
        platformOf.set('media_player.primary_bedroom_tv', 'samsungtv');
        // the purifier, and its own settings
        const pur = { name: 'Xiaomi Smart Air Purifier 4 Compact', model: 'zhimi.airp.cpa4', maker: 'zhimi' };
        put('fan.air_purifier', 'on', { friendly_name: pur.name + ' Air Purifier', preset_modes: ['Auto', 'Sleep', 'Favorite'], preset_mode: 'Favorite', supported_features: 56 });
        dev('fan.air_purifier', 'dev_purifier', pur, 'Air Purifier');
        put('number.air_purifier_favorite_level', '11', { friendly_name: pur.name + ' custom-service favorite-level', min: 0, max: 14, step: 1 });
        dev('number.air_purifier_favorite_level', 'dev_purifier', pur, 'custom-service favorite-level');
        put('switch.air_purifier_child_lock', 'off', { friendly_name: pur.name + ' Physical Control Locked' });
        dev('switch.air_purifier_child_lock', 'dev_purifier', pur, 'Physical Control Locked');
        put('switch.air_purifier_power', 'on', { friendly_name: pur.name + ' Air Purifier Power' });
        dev('switch.air_purifier_power', 'dev_purifier', pur, 'Air Purifier Power');
        put('switch.air_purifier_alarm', 'off', { friendly_name: pur.name + ' Alarm' });
        dev('switch.air_purifier_alarm', 'dev_purifier', pur, 'Alarm');
        put('sensor.air_purifier_pm25', '5', { friendly_name: pur.name + ' PM2.5', device_class: 'pm25', unit_of_measurement: 'µg/m³' });
        dev('sensor.air_purifier_pm25', 'dev_purifier', pur, 'PM2.5');
        ['fan.air_purifier', 'number.air_purifier_favorite_level', 'switch.air_purifier_child_lock', 'switch.air_purifier_power', 'switch.air_purifier_alarm', 'sensor.air_purifier_pm25'].forEach((id) => at(id, 'living_room'));
        // sensors
        put('sensor.living_room_humidity', '48', { friendly_name: 'Living Room Humidity', device_class: 'humidity', unit_of_measurement: '%' });
        at('sensor.living_room_humidity', 'living_room');
        put('binary_sensor.living_room_motion', 'on', { friendly_name: 'Living Room Motion', device_class: 'motion' });
        at('binary_sensor.living_room_motion', 'living_room');
        put('binary_sensor.front_door_door', 'on', { friendly_name: 'Front Door Door', device_class: 'door' });
        at('binary_sensor.front_door_door', 'front_door');
        put('binary_sensor.kitchen_outside_door', 'off', { friendly_name: 'Kitchen Outside Door Door', device_class: 'door' });
        at('binary_sensor.kitchen_outside_door', 'kitchen');
        // the thermostat's own settings
        const eco = { name: 'Home', model: 'ECB601', maker: 'ecobee Inc.' };
        dev('climate.hallway_thermostat', 'dev_thermostat', eco, null);
        put('select.hallway_current_mode', 'home', { friendly_name: 'Home Current Mode', options: ['home', 'sleep', 'away'] });
        dev('select.hallway_current_mode', 'dev_thermostat', eco, 'Current Mode');
        put('button.hallway_clear_hold', 'unknown', { friendly_name: 'Home Clear Hold' });
        dev('button.hallway_clear_hold', 'dev_thermostat', eco, 'Clear Hold');
        put('button.hallway_identify', 'unknown', { friendly_name: 'Home Identify', device_class: 'identify' });
        dev('button.hallway_identify', 'dev_thermostat', eco, 'Identify');
        ['select.hallway_current_mode', 'button.hallway_clear_hold', 'button.hallway_identify'].forEach((id) => at(id, 'hallway'));
        // automations and helpers (no room, like most)
        put('automation.living_room_lamps', 'on', { friendly_name: 'Living Room Lamps' });
        put('automation.party_mode', 'off', { friendly_name: 'Party Mode' });
        put('input_boolean.party_lights_toggle', 'on', { friendly_name: 'Party Lights Toggle' });
        put('script.movie_time', 'off', { friendly_name: 'Movie Time' });
        // never shown: a siren, a switch that sets one off, a fridge that's gone
        put('siren.front_door_siren', 'unknown', { friendly_name: 'Front Door Siren' });
        put('switch.front_door_siren_on_event', 'off', { friendly_name: 'Front Door Siren on event' });
        at('switch.front_door_siren_on_event', 'front_door');
        put('switch.refrigerator_cubed_ice', 'unavailable', { friendly_name: 'Cubed ice', restored: true });
        at('switch.refrigerator_cubed_ice', 'kitchen');
    };
    // Who's home, and the few house conditions the alert crawl watches
    // (shared/alerts.js), in the made-up house. The front door has been open
    // half an hour, which is long enough for the crawl's rule to raise it;
    // nothing else is tripped, so nothing alarming shows up uninvited.
    const MOCK_PEOPLE = [
        ['Jason', 'home', 'office'], ['Sarah', 'not_home', null], ['Ellie', 'School', null]
    ];
    const mockPeople = (put) => {
        for (const [name, state, area] of MOCK_PEOPLE) {
            const tracker = 'device_tracker.' + slug(name) + '_phone';
            put(tracker, state, { friendly_name: name + '\u2019s Phone', source_type: 'gps' });
            const id = 'person.' + slug(name);
            put(id, state, { friendly_name: name, source: tracker, device_trackers: [tracker], user_id: null });
            if (area) placeOf.set(tracker, area);
        }
        // a door that has been open a while, a garage that is shut, and a leak
        // sensor that is dry
        const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
        states['binary_sensor.front_door_door'].last_changed = ago(31);
        states['binary_sensor.front_door_door'].last_updated = ago(31);
        put('binary_sensor.garage_door', 'off', { friendly_name: 'Garage Door', device_class: 'garage_door' });
        placeOf.set('binary_sensor.garage_door', 'garage');
        put('binary_sensor.kitchen_leak', 'off', { friendly_name: 'Kitchen Leak', device_class: 'moisture' });
        placeOf.set('binary_sensor.kitchen_leak', 'kitchen');
        put('binary_sensor.hallway_smoke', 'off', { friendly_name: 'Hallway Smoke', device_class: 'smoke' });
        placeOf.set('binary_sensor.hallway_smoke', 'hallway');
    };
    // for testing the crawl in the made-up house: flip one of those on or off
    const mockTrip = (id, on = true) => {
        const s = states[id];
        if (!s) return false;
        s.state = on ? 'on' : 'off';
        s.last_changed = s.last_updated = new Date(Date.now() - (on && /door/.test(id) ? 31 * 60000 : 0)).toISOString();
        built = null;
        emit();
        return true;
    };

    const mockCall = async (domain, service, data, id) => {
        if (domain === 'remote') return mockRemote(service, data, id);
        await new Promise((r) => setTimeout(r, 250));
        const s = states[id];
        if (!s) throw new Error('no such entity');
        const x = Object.assign({}, s, { attributes: Object.assign({}, s.attributes), last_changed: new Date().toISOString() });
        const A = x.attributes;
        if (domain === 'light' || domain === 'switch' || domain === 'automation' || domain === 'input_boolean' || domain === 'fan') {
            if (service === 'turn_off') { x.state = 'off'; delete A.brightness; }
            if (service === 'turn_on') {
                x.state = 'on';
                if (data.brightness_pct != null) A.brightness = Math.round(data.brightness_pct * 2.55);
                else if (domain === 'light' && A.brightness == null && (A.supported_color_modes || []).some((m) => m !== 'onoff')) A.brightness = 255;
                if (data.hs_color) Object.assign(A, { color_mode: 'xy', hs_color: data.hs_color, rgb_color: hsToRgb(data.hs_color), color_temp_kelvin: null });
                if (data.color_temp_kelvin) Object.assign(A, { color_mode: 'color_temp', color_temp_kelvin: data.color_temp_kelvin, rgb_color: kelvinToRgb(data.color_temp_kelvin) });
                if (domain === 'light' && !data.hs_color && !data.color_temp_kelvin && !A.color_mode && (A.supported_color_modes || []).includes('color_temp')) {
                    Object.assign(A, { color_mode: 'color_temp', color_temp_kelvin: 2700, rgb_color: kelvinToRgb(2700) });
                }
            }
            if (service === 'set_percentage') { A.percentage = data.percentage; x.state = data.percentage > 0 ? 'on' : 'off'; }
            if (service === 'set_preset_mode') { A.preset_mode = data.preset_mode; x.state = 'on'; }
        } else if (domain === 'climate') {
            if (service === 'set_temperature') Object.assign(A, data);
            if (service === 'set_hvac_mode') x.state = data.hvac_mode;
        } else if (domain === 'media_player') {
            if (service === 'media_play') x.state = 'playing';
            if (service === 'media_pause' || service === 'media_stop') x.state = 'paused';
            if (service === 'volume_set') A.volume_level = data.volume_level;
            if (service === 'volume_up' || service === 'volume_down') A.volume_level = Math.max(0, Math.min(1, (A.volume_level || 0) + (service === 'volume_up' ? 0.02 : -0.02)));
            if (service === 'volume_mute') A.is_volume_muted = data.is_volume_muted;
            if (service === 'select_source') A.source = data.source;
            if (service === 'turn_on') x.state = 'on';
            if (service === 'turn_off') x.state = 'off';
            if (service === 'media_next_track') A.media_title = 'Old Man';
            if (service === 'media_previous_track') A.media_title = 'Harvest Moon';
        } else if (domain === 'select' || domain === 'input_select') {
            x.state = data.option;
        } else if (domain === 'number' || domain === 'input_number') {
            x.state = String(data.value);
        }
        states[id] = x;
        const o = overlay.get(id);
        if (o && o.settled && o.settled(x)) overlay.delete(id);
        emit();
    };
    // a key on a made-up remote: the player on its device answers
    // (play/pause, the volume) the way the real one would
    const mockRemote = async (service, data, id) => {
        await new Promise((r) => setTimeout(r, 60));
        if (!states[id] || service !== 'send_command') throw new Error('no such remote');
        const dev = deviceOf.get(id);
        const player = Object.keys(states).find((x) => domainOf(x) === 'media_player' && deviceOf.get(x) === dev);
        const s = player && states[player];
        if (!s) return;
        const c = String(data.command).toLowerCase().replace(/^key_/, '');
        const x = Object.assign({}, s, { attributes: Object.assign({}, s.attributes) });
        if (c === 'play_pause') x.state = s.state === 'playing' ? 'paused' : 'playing';
        else if (c === 'play') x.state = 'playing';
        else if (c === 'pause') x.state = 'paused';
        else if ((c === 'volup' || c === 'voldown' || c === 'volume_up' || c === 'volume_down') && x.attributes.volume_level != null) {
            x.attributes.volume_level = Math.max(0, Math.min(1, Math.round((x.attributes.volume_level + (/up/.test(c) ? 0.01 : -0.01)) * 100) / 100));
        } else if (c === 'mute') x.attributes.is_volume_muted = !x.attributes.is_volume_muted;
        else return;
        states[player] = x;
        emit();
    };
    const mockRings = async () => mockRingTimes.slice();

    // The made-up house's media source: a Reolink-shaped tree
    // (reolink → camera → resolution → day → clip) over the mock doorbell,
    // with the same titles the real integration writes
    // ("19:00:39 0:02:32 Motion Vehicle Person Doorbell"). Unlike the real
    // one, these clips carry a thumbnail, so the events strip can be seen
    // without anybody's front door in it.
    const MOCK_CLIPS = [ // [minutes ago, seconds long, what it saw]
        [6, 47, 'Motion Vehicle Person Doorbell'], [23, 31, 'Motion Person'], [64, 22, 'Motion Vehicle'],
        [150, 18, 'Motion'], [214, 96, 'Motion Animal Person'], [327, 40, 'Vehicle'],
        [402, 27, 'Motion Person Doorbell'], [560, 15, 'Motion'], [733, 52, 'Motion Vehicle'],
        [1090, 33, 'Motion Pet'], [1340, 24, 'Motion Person'], [1610, 19, 'Motion']
    ];
    const mockCamId = () => (doorbells[0] && doorbells[0].camera) || 'camera.front_door_doorbell';
    const two = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const mockClipList = () => MOCK_CLIPS.map(([mins, secs, kinds]) => {
        const at = new Date(Date.now() - mins * 60000);
        const end = new Date(at.getTime() + secs * 1000);
        const dur = `${Math.floor(secs / 3600)}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}`;
        return {
            title: `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())} ${dur} ${kinds}`,
            media_class: 'video',
            media_content_type: 'video',
            media_content_id: `media-source://reolink/FILE|MOCK|0|sub|Mp4Record/mock.mp4|${stamp(at)}|${stamp(end)}`,
            can_play: true,
            can_expand: false,
            thumbnail: mockSnapshot(mockCamId() + '#' + Math.round(at.getTime() / 60000))
        };
    });
    const mockDays = () => {
        const days = new Map();
        for (const c of mockClipList()) {
            const at = new Date(Date.parse(
                c.media_content_id.split('|')[5].replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3T$4:$5:$6')));
            const key = `${at.getFullYear()}|${at.getMonth() + 1}|${at.getDate()}`;
            if (!days.has(key)) days.set(key, at);
        }
        return [...days.entries()].sort((a, b) => a[1] - b[1]).map(([key, at]) => ({
            title: key.replace(/\|/g, '/'),
            media_class: 'directory',
            media_content_type: 'playlist',
            media_content_id: `media-source://reolink/DAY|MOCK|0|sub|${key.replace(/\|/g, '|')}`,
            can_play: false,
            can_expand: true,
            thumbnail: null,
            _at: at
        }));
    };
    const mockNode = (title, id, children, cls = 'channel') => ({
        title, media_class: cls, media_content_type: 'playlist', media_content_id: id,
        can_play: false, can_expand: true, thumbnail: null, children
    });
    const mockBrowse = async (id) => {
        const cam = mockCamId();
        if (!id || id === 'media-source://') {
            return mockNode('Media sources', 'media-source://', [mockNode('Reolink', 'media-source://reolink', undefined, 'app')], 'app');
        }
        if (id === 'media-source://reolink') {
            const one = mockNode(nameOf(cam), 'media-source://reolink/CAM|MOCK|0', undefined);
            one.thumbnail = '/api/camera_proxy/' + cam;
            return mockNode('Reolink', id, [one], 'app');
        }
        if (/^media-source:\/\/reolink\/CAM\|/.test(id)) {
            return mockNode(nameOf(cam), id, [
                mockNode('Low resolution', 'media-source://reolink/RES|MOCK|0|sub'),
                mockNode('High resolution', 'media-source://reolink/RES|MOCK|0|main')
            ]);
        }
        if (/^media-source:\/\/reolink\/RES\|/.test(id)) return mockNode(nameOf(cam) + ' Low res.', id, mockDays());
        if (/^media-source:\/\/reolink\/DAY\|/.test(id)) {
            const want = id.split('|').slice(4).join('/');
            const mine = mockClipList().filter((c) => {
                const s = c.media_content_id.split('|')[5];
                return `${+s.slice(0, 4)}/${+s.slice(4, 6)}/${+s.slice(6, 8)}` === want;
            });
            return mockNode(want, id, mine, 'directory');
        }
        throw new Error('no such media source in the mock house');
    };
    // A real, playable stand-in clip: a few seconds of the mock camera's
    // picture recorded off a canvas. One is made the first time something
    // asks, and every mock clip plays it.
    let mockClipUrl = null;
    const mockResolve = async () => {
        if (mockClipUrl) return { url: mockClipUrl, mime: 'video/mp4' };
        if (typeof MediaRecorder === 'undefined') return { url: '', mime: '' };
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        const g = c.getContext('2d');
        const cam = mockCamId();
        const type = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
        if (!type) return { url: '', mime: '' };
        const rec = new MediaRecorder(c.captureStream(10), { mimeType: type });
        const parts = [];
        rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
        const done = new Promise((resolve) => { rec.onstop = resolve; });
        rec.start();
        const paint = () => {
            const img = new Image();
            img.onload = () => g.drawImage(img, 0, 0, 640, 360);
            img.src = mockSnapshot(cam);
        };
        const t = setInterval(paint, 100);
        paint();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        clearInterval(t);
        rec.stop();
        await done;
        mockClipUrl = URL.createObjectURL(new Blob(parts, { type }));
        return { url: mockClipUrl, mime: type };
    };
    // the made-up house's history: the doorbell's rings, and motion every
    // so often, so the fallback has something to show
    const mockHistory = async (ids, hours) => {
        const out = {};
        const since = Date.now() - hours * 3600000;
        for (const id of ids) {
            const hits = /visitor|doorbell/i.test(id)
                ? mockRingTimes.map((d) => d.getTime())
                : MOCK_CLIPS.map(([mins]) => Date.now() - mins * 60000).filter((_, i) => i % 2 === 0);
            const list = [{ state: 'off', at: since }];
            for (const at of hits.filter((a) => a > since).sort((a, b) => a - b)) {
                list.push({ state: 'on', at }, { state: 'off', at: at + 20000 });
            }
            out[id] = list;
        }
        return out;
    };

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
        // where the house is, from Home Assistant's own config (the weather alerts use it)
        location: () => (homeLoc ? { lat: homeLoc.lat, lon: homeLoc.lon } : null),
        people,
        peopleIn,
        entity,
        name: nameOf,
        lightOn,
        // a light row's icon: a fan for a wall switch that runs a fan
        glyph: (id) => (wallSwitches.has(id) && /\bfan\b/i.test(nameOf(id, '')) && !/light/i.test(nameOf(id, '')) ? 'air' : 'lightbulb'),
        brightness,
        toggle,
        setBrightness,
        setTemperature,
        setMode,
        scene,
        color,
        setColor,
        kelvinToRgb,
        hsToRgb,
        supports,
        playPause,
        mediaCommand,
        playMedia,
        players: () => [...players()],
        setVolume,
        stepVolume,
        mute,
        setSource,
        power,
        pictureUrl,
        pictureUrls,
        loadPicture,
        remoteFor,
        sendRemote,
        _remoteLog: () => remoteLog.slice(),
        setFanSpeed,
        setPreset,
        setOption,
        setNumber,
        run,
        extras,
        device,
        siblings,
        shortName,
        platform: (id) => platformOf.get(id) || '',
        isGroup,
        isWallSwitch: (id) => wallSwitches.has(id),
        isMain: (id) => mainOf.has(id),
        snapshotUrl,
        playCamera,
        browseMedia,
        resolveMedia,
        history,
        rings,
        lastRing,
        onRing(fn) { ringers.add(fn); return () => ringers.delete(fn); },
        _mockRing: mockRing,
        _mockTrip: mockTrip, // DEV ONLY (mock house): flip a door, leak or smoke sensor
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
            pictureTried.clear();
        }
    };
})();
