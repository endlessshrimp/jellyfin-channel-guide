/*
 * HOMER Settings: a small cable-box style settings screen that stands in for
 * Jellyfin Web's preference pages, so a stock Jellyfin page never shows.
 *
 * Takes over #/mypreferencesmenu (Home's Settings item goes there). A list of
 * settings on the left, the selected one's choices in the middle with a check on
 * the current value, and a preview window with a short explanation on the right.
 * Every choice saves the moment you pick it.
 *
 *   Audio language      user Configuration.AudioLanguagePreference (server)
 *   Subtitles           user Configuration.SubtitleMode (server)
 *   Subtitle language   user Configuration.SubtitleLanguagePreference (server)
 *   Streaming quality   Jellyfin Web's per-device max bitrate (localStorage)
 *   Guide size          Standard or Large: how big the channel guide draws
 *                       (ChannelGuide.setSize, localStorage; the Apple TV app
 *                       starts on Large)
 *   Weather location    where the clock's weather comes from (HomerWeather, localStorage)
 *   Home Assistant      Connect (Home Assistant's own sign-in), the address, and
 *                       Disconnect, which asks for a second OK (HomerHA, localStorage)
 *   Sign out            Jellyfin Web's own logout, after a second OK
 *
 * Remote/keyboard: ▲▼ move, ◀▶ between the list and the choices, OK selects,
 * Esc/Backspace goes back, H goes Home.
 *
 * On a phone (shared/layout.js) Settings draws settings/settings-phone.js
 * instead: one column, each setting's choices opening under it. Both layouts
 * draw from the same settings (createModel below).
 *
 * window.HomerSettings = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerSettings && typeof window.HomerSettings.destroy === 'function') {
        window.HomerSettings.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="settings.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/settings\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'settings/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const HOME_ROUTE = '#/home';
    const OUR_ROUTE = '#/mypreferencesmenu';

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
        if (!res.ok) {
            const err = new Error(`${method} ${path.split('?')[0]} → ${res.status}`);
            err.status = res.status;
            throw err;
        }
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
        if (cssReady && document.getElementById('hx-css')) return cssReady;
        // both layouts' (the phone one is scoped to .hx-phone)
        const link = (id, file) => {
            document.getElementById(id)?.remove();
            const css = document.createElement('link');
            css.id = id;
            css.rel = 'stylesheet';
            css.href = BASE + file + QUERY;
            document.head.appendChild(css);
            return new Promise((resolve) => {
                css.onload = css.onerror = resolve;
                setTimeout(resolve, 2000);
            });
        };
        cssReady = Promise.all([link('hx-css', 'settings.css'), link('hx-phone-css', 'settings-phone.css')]);
        return cssReady;
    };

    // ---------- Navigation (HomerPlayer when it's there, the address bar when not) ----------
    // HOMER screens can sit on top of Jellyfin's #/video page while a video plays
    // docked in the preview; HomerPlayer then navigates virtually and knows the
    // real route.

    const player = () => {
        const hp = window.HomerPlayer;
        return hp && typeof hp === 'object' ? hp : null;
    };
    const currentRoute = () => {
        const hp = player();
        if (hp && typeof hp.route === 'function') {
            try {
                const r = hp.route();
                if (typeof r === 'string') return r;
            } catch { /* fall back to the address */ }
        }
        return location.hash || '';
    };
    const isOurs = (route) => /^#?!?\/?mypreferencesmenu(?:\.html)?(?:\?.*)?$/i.test(route || '');
    // pages that are never overlaid: after signing out, always get out of the way
    const isSignedOutPage = () => /^#!?\/(login|selectserver|startup|forgotpassword)/i.test(location.hash || '');

    const go = (hash) => {
        const hp = player();
        if (hp && typeof hp.go === 'function') hp.go(hash);
        else location.hash = hash;
    };

    // Back, like a remote: the previous page, or Home when this was the first page
    // in the tab.
    const goBack = () => {
        const hp = player();
        if (hp && typeof hp.docked === 'function' && hp.docked() && typeof hp.back === 'function') {
            hp.back();
            return;
        }
        const before = location.href;
        history.back();
        setTimeout(() => {
            if (location.href === before && isOurs(currentRoute())) go(HOME_ROUTE);
        }, 400);
    };

    const goHome = () => {
        const hp = player();
        if (hp && typeof hp.goHome === 'function') hp.goHome();
        else if (window.HomerHome && typeof window.HomerHome.goHome === 'function') window.HomerHome.goHome();
        else location.hash = HOME_ROUTE;
    };

    // ---------- What the settings offer ----------

    // Languages offered for audio and subtitles, by ISO 639-2 code. The saved
    // value is whatever code the server's /Localization/Cultures lists for the
    // language (Jellyfin Web does the same), so "fre" and "fra" both match French.
    const LANGUAGES = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'],
        ['ita', 'Italian'], ['por', 'Portuguese'], ['jpn', 'Japanese'], ['kor', 'Korean'],
        ['zho', 'Chinese'], ['rus', 'Russian'], ['hin', 'Hindi'], ['ara', 'Arabic']
    ];
    // Server enum SubtitlePlaybackMode (10.11): Default, Always, OnlyForced, None, Smart
    const SUBTITLE_MODES = [
        { value: 'Default', label: 'Default', sub: 'Whatever the video marks as its default' },
        { value: 'Always', label: 'Always', sub: 'On whenever there are subtitles in your language' },
        { value: 'OnlyForced', label: 'Only forced', sub: 'Only subtitles marked as forced' },
        { value: 'Smart', label: 'Smart', sub: 'On when the audio isn\'t in your language' },
        { value: 'None', label: 'None', sub: 'Off, until you turn them on while watching' }
    ];
    // Jellyfin Web's own bitrate steps (qualityOptions.js); 0 is Auto
    const QUALITY = [0, 120000000, 80000000, 40000000, 20000000, 10000000, 4000000];
    const mbps = (b) => (b ? `${b / 1000000} Mbps` : 'Auto');

    // Jellyfin Web's appSettings (src/scripts/settings/appSettings.js, 10.11):
    //   enableautobitratebitrate-Video-<inNetwork>  'true' | 'false' (missing = true)
    //   maxbitrate-Video-<inNetwork>                bits per second, as a string
    // where <inNetwork> is the server endpoint's IsInNetwork. Jellyfin's own
    // settings page writes only the current network's pair; HOMER writes both, so
    // "this device" means this device on any network.
    const NETS = ['true', 'false'];
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
    const readQuality = (inNetwork) => {
        const net = String(inNetwork);
        if (lsGet(`enableautobitratebitrate-Video-${net}`) !== 'false') return 0;
        const max = parseInt(lsGet(`maxbitrate-Video-${net}`) || '0', 10) || 1500000;
        // same rule as Jellyfin Web: the highest step that doesn't exceed the limit
        return QUALITY.find((b) => b > 0 && b <= max) || QUALITY[QUALITY.length - 1];
    };
    const writeQuality = (bitrate) => {
        for (const net of NETS) {
            if (bitrate) {
                lsSet(`maxbitrate-Video-${net}`, String(bitrate));
                lsSet(`enableautobitratebitrate-Video-${net}`, 'false');
            } else {
                // Auto: Jellyfin measures the connection and records what it finds
                lsSet(`enableautobitratebitrate-Video-${net}`, 'true');
            }
        }
    };

    // The endpoint's IsInNetwork, which picks the key Jellyfin Web reads
    const savedInNetwork = () => {
        try {
            const e = window.ApiClient && window.ApiClient.getSavedEndpointInfo && window.ApiClient.getSavedEndpointInfo();
            if (e && typeof e.IsInNetwork === 'boolean') return e.IsInNetwork;
        } catch { /* ask the server */ }
        return null;
    };

    // Jellyfin 10.11 documents POST /Users/Configuration?userId=; Jellyfin Web
    // itself still posts to the older /Users/{id}/Configuration, which the
    // server also accepts. Always send the whole Configuration, freshly read, so
    // a change made elsewhere since this screen opened isn't overwritten.
    let saveChain = Promise.resolve();
    const saveUserField = (uid, field, value) => {
        const job = saveChain.then(async () => {
            const user = await api(`/Users/${uid}`);
            const cfg = Object.assign({}, user.Configuration, { [field]: value });
            try {
                await request('POST', `/Users/Configuration?userId=${encodeURIComponent(uid)}`, cfg);
            } catch (err) {
                if (err.status !== 404 && err.status !== 405) throw err;
                await request('POST', `/Users/${uid}/Configuration`, cfg);
            }
            return cfg;
        });
        saveChain = job.catch(() => {});
        return job;
    };

    // Sign out the way Jellyfin Web does (its user menu calls Dashboard.logout():
    // end the session on the server, forget the token, go to the login page).
    const signOut = () => {
        const dash = window.Dashboard;
        if (dash && typeof dash.logout === 'function') {
            dash.logout();
            return;
        }
        const ac = window.ApiClient;
        const ended = ac && typeof ac.logout === 'function' ? ac.logout() : request('POST', '/Sessions/Logout');
        Promise.resolve(ended).catch(() => {}).finally(() => {
            try {
                const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
                for (const s of creds.Servers || []) {
                    s.AccessToken = null;
                    s.UserId = null;
                }
                localStorage.setItem('jellyfin_credentials', JSON.stringify(creds));
            } catch { /* the reload still lands on login */ }
            location.hash = '#/login';
            location.reload();
        });
    };

    // ---------- The settings (both layouts draw from these) ----------
    // What each setting offers, what it's set to, and saving a choice. The TV
    // screen and the phone layout (settings/settings-phone.js) each make one
    // when they open.

    const wx = () => window.HomerWeather || null;
    const ha = () => window.HomerHA || null;
    // the guide (guide/guide.js), for the Guide size choice; it isn't there when
    // Settings is used on its own
    const CG = () => (window.ChannelGuide && typeof window.ChannelGuide.setSize === 'function' ? window.ChannelGuide : null);

    // Home Assistant: what this device's connection is, as a choice list
    const HA_STATUS = {
        connecting: 'Connecting…',
        offline: 'Can\'t reach it right now',
        signin: 'Signed out: connect again',
        blocked: 'Can\'t reach it from this page'
    };
    const haOptions = () => {
        const h = ha();
        if (!h) return [];
        const url = h.address();
        const problem = h.addressProblem(url);
        const address = { value: 'address', label: 'Address', sub: url ? '' : 'Type it, then press Enter', input: 'url', url };
        if (!h.isSetUp() || h.status() === 'signin') {
            return [
                { value: 'connect', label: h.status() === 'signin' ? 'Connect again' : 'Connect', sub: problem || 'Sign in on Home Assistant\'s own page', done: 'Opening Home Assistant…' },
                address
            ];
        }
        const house = h.status() === 'ready' ? h.house() : null;
        return [
            {
                value: 'connected',
                label: house ? `Connected to ${house.name}` : HA_STATUS[h.status()] || 'Connecting…',
                sub: [house && house.user ? `Signed in as ${house.user}` : '', url.replace(/^https?:\/\//, '')].filter(Boolean).join(' · '),
                info: true
            },
            { value: 'disconnect', label: 'Disconnect', sub: 'Sign this device out of Home Assistant', confirm: 'Disconnect? OK to confirm', confirmTap: 'Tap again to disconnect', done: 'Disconnected' }
        ];
    };
    const haSetting = () => ({
        id: 'ha', icon: 'lightbulb', label: 'Home Assistant', scope: 'device',
        desc: () => {
            const h = ha();
            const base = 'Your lights, thermostat and cameras, in Rooms and over whatever\'s playing (press L). You sign in on Home Assistant\'s own page; this device keeps its sign-in.';
            const problem = h && (h.status() === 'blocked' ? h.problem() : !h.isSetUp() && h.address() ? h.addressProblem() : '');
            return problem ? `${base} ${problem}` : base;
        },
        options: haOptions,
        current: () => (ha() && ha().isSetUp() && ha().status() !== 'signin' ? 'connected' : null),
        matches: (o, v) => o.value === v,
        valueLabel: () => {
            const h = ha();
            if (!h || !h.isSetUp()) return 'Not connected';
            return h.status() === 'ready' ? `Connected · ${h.house().name}` : HA_STATUS[h.status()] || 'Connecting…';
        },
        save: async (value) => {
            const h = ha();
            if (!h) return;
            if (value === 'connect') h.signIn(OUR_ROUTE); // off to Home Assistant's sign-in, and back here
            else if (value === 'disconnect') await h.disconnect();
        }
    });

    const SCOPES = {
        device: { icon: 'devices', label: 'This device only' },
        account: { icon: 'account_circle', label: 'Saved to your account' }
    };

    const createModel = (server) => {
        const uid = server.UserId;
        const m = {
            status: 'loading', // loading | ready | error
            cfg: {}, // the user's Configuration
            cultures: null,
            inNetwork: savedInNetwork(),
            canTranscode: true,
            user: null, // once loaded
            info: null // the server's public info
        };
        let alive = true;

        // ----- languages, checked against the server's cultures -----
        const culture = (code) => (m.cultures || []).find((c) => lc(c.ThreeLetterISOLanguageName) === code
            || (c.ThreeLetterISOLanguageNames || []).some((n) => lc(n) === code));
        const langMatches = (o, v) => lc(o.value) === lc(v) || (o.aliases || []).includes(lc(v));
        const languageOptions = (current) => {
            const list = [{ value: '', label: 'Any', sub: 'Use each video\'s own default' }];
            for (const [code, name] of LANGUAGES) {
                const c = culture(code);
                if (m.cultures && !c) continue; // the server doesn't know it
                list.push({
                    value: c ? c.ThreeLetterISOLanguageName : code,
                    label: name,
                    aliases: c ? [lc(c.ThreeLetterISOLanguageName), ...(c.ThreeLetterISOLanguageNames || []).map(lc)] : [code]
                });
            }
            // a language set elsewhere that isn't on the short list still shows, checked
            if (current && !list.some((o) => langMatches(o, current))) {
                const c = culture(lc(current));
                list.push({ value: current, label: c ? c.DisplayName : String(current).toUpperCase(), aliases: [lc(current)] });
            }
            return list;
        };

        // ----- the settings -----
        const userSetting = (field) => ({
            field,
            current: () => m.cfg[field] || '',
            matches: langMatches,
            save: async (value) => {
                const saved = await saveUserField(uid, field, value);
                if (alive) m.cfg = saved;
            }
        });
        const SETTINGS = [
            {
                id: 'audio', icon: 'record_voice_over', label: 'Audio language', scope: 'account',
                desc: 'When a movie or show has more than one audio track, play this language.',
                options: () => languageOptions(m.cfg.AudioLanguagePreference),
                ...userSetting('AudioLanguagePreference')
            },
            {
                id: 'subs', icon: 'subtitles', label: 'Subtitles', scope: 'account',
                desc: 'When subtitles come on by themselves. You can always change them while watching.',
                options: () => SUBTITLE_MODES,
                ...userSetting('SubtitleMode'),
                current: () => m.cfg.SubtitleMode || 'Default',
                matches: (o, v) => o.value === v
            },
            {
                id: 'sublang', icon: 'translate', label: 'Subtitle language', scope: 'account',
                desc: 'The language to use when subtitles come on.',
                options: () => languageOptions(m.cfg.SubtitleLanguagePreference),
                ...userSetting('SubtitleLanguagePreference')
            },
            {
                id: 'quality', icon: 'speed', label: 'Streaming quality', scope: 'device',
                desc: 'The most this device asks the server for. Pick a lower limit if video stutters; Auto measures your connection.',
                options: () => QUALITY.map((b) => ({ value: b, label: mbps(b), sub: b ? '' : 'Adjusts to your connection' })),
                current: () => readQuality(m.inNetwork == null ? true : m.inNetwork),
                matches: (o, v) => o.value === v,
                save: async (value) => writeQuality(value)
            },
            {
                id: 'guidesize', icon: 'grid_view', label: 'Guide size', scope: 'device',
                desc: 'How big the channel guide draws on this device. Large shows four channels and two hours at a time instead of five and three, with bigger titles and channel names — easier to read from a couch. The Apple TV app starts on Large.',
                options: () => (CG() ? CG().sizes().map((o) => Object.assign({
                    sub: o.value === 'large'
                        ? 'Four channels, two hours, bigger type'
                        : 'Five channels, three hours'
                }, o)) : []),
                current: () => (CG() ? CG().size() : ''),
                matches: (o, v) => o.value === v,
                // an open guide redraws itself at the new size; nothing reloads
                save: async (value) => { if (CG()) CG().setSize(value); }
            },
            {
                id: 'weather', icon: 'wb_sunny', label: 'Weather location', scope: 'device',
                desc: () => 'Where the temperature next to the clock comes from.'
                    + (wx() && !wx().canUseDevice()
                        ? ' Browsers only share their own location over a secure (HTTPS) connection, so this device uses a ZIP code.'
                        : ''),
                options: () => {
                    const W = wx();
                    if (!W) return [];
                    const list = [];
                    if (W.canUseDevice()) {
                        list.push({
                            value: 'device', label: 'This device\'s location',
                            sub: W.deviceState() === 'denied' ? 'Blocked in this browser, so the ZIP code is used' : 'The browser asks once'
                        });
                    }
                    const z = W.zip();
                    list.push({ value: 'zip', label: 'ZIP code', sub: z.name, zip: z.zip, input: true });
                    return list;
                },
                current: () => (wx() ? wx().mode() : ''),
                matches: (o, v) => o.value === v,
                valueLabel: () => {
                    const W = wx();
                    if (!W) return '';
                    const z = W.zip();
                    const here = W.mode() === 'device' && W.place() && W.place().mode === 'device' ? W.place().name : '';
                    return W.mode() === 'device' ? (here && here !== 'This device\'s location' ? `This device · ${here}` : 'This device\'s location') : `${z.zip} · ${z.name}`;
                },
                save: async (value) => { if (value === 'device') await wx().useDevice(); }
            },
            haSetting(),
            {
                id: 'signout', icon: 'exit_to_app', label: 'Sign out', scope: 'device', action: true,
                desc: 'Sign out of HOMER on this device and go to the sign-in screen.',
                options: () => [{ value: 'signout', label: 'Sign out' }],
                current: () => null,
                matches: () => false
            }
        ];
        // a setting whose screen isn't loaded doesn't show at all
        const offered = (s) => s.id !== 'guidesize' || !!CG();
        m.all = SETTINGS;
        m.visible = SETTINGS.filter(offered);
        m.scope = (s) => SCOPES[s.scope] || SCOPES.device;
        m.desc = (s) => (typeof s.desc === 'function' ? s.desc() : s.desc);
        m.valueLabel = (s) => {
            if (s.action || m.status !== 'ready') return '';
            if (s.valueLabel) return s.valueLabel();
            const list = s.options();
            const v = s.current();
            const o = list.find((x) => s.matches(x, v));
            return o ? o.label : '';
        };
        // who's signed in, and the server (HTML)
        m.userLine = () => (m.user ? `Signed in as <b>${esc(m.user.Name || '')}</b>` : '');
        m.serverLine = () => (m.info
            ? `<b>${esc(m.info.ServerName || 'Jellyfin')}</b>${m.info.Version ? ` · Jellyfin ${esc(m.info.Version)}` : ''}`
            : '');

        // resolves true once the settings are in (false if closed meanwhile);
        // throws when they can't be loaded
        m.load = async () => {
            m.status = 'loading';
            try {
                const [user, cults, info, endpoint] = await Promise.all([
                    api(`/Users/${uid}`),
                    api('/Localization/Cultures').catch(() => null),
                    api('/System/Info/Public').catch(() => null),
                    m.inNetwork == null ? api('/System/Endpoint').catch(() => null) : null
                ]);
                if (!alive) return false;
                m.cfg = (user && user.Configuration) || {};
                m.cultures = Array.isArray(cults) && cults.length ? cults : null;
                if (m.inNetwork == null && endpoint && typeof endpoint.IsInNetwork === 'boolean') m.inNetwork = endpoint.IsInNetwork;
                // Jellyfin Web hides the quality choice from accounts that can't transcode
                m.canTranscode = !(user.Policy && user.Policy.EnableVideoPlaybackTranscoding === false);
                m.visible = SETTINGS.filter((s) => offered(s) && (s.id !== 'quality' || m.canTranscode));
                m.user = user;
                m.info = info;
                m.status = 'ready';
                return true;
            } catch (err) {
                console.warn('[HOMER Settings] load failed', err);
                if (alive) m.status = 'error';
                throw err;
            }
        };

        // Save a choice. The new value shows at once (before this resolves)
        // and goes back if the save fails (then this throws).
        m.save = async (s, o) => {
            const before = m.cfg;
            if (s.field) m.cfg = Object.assign({}, m.cfg, { [s.field]: o.value });
            try {
                await s.save(o.value);
            } catch (err) {
                if (alive) m.cfg = before;
                throw err;
            }
        };

        m.dispose = () => { alive = false; };
        return m;
    };

    // ---------- Pixel scrolling (the choices list) ----------
    // The trackpad moves the list freely; keyboard selection nudges it just
    // enough to keep the highlight in view. Hover never scrolls.
    const makeScroller = (viewport, inner) => {
        let pos = 0;
        const set = (p, animate) => {
            const max = Math.max(0, inner.offsetHeight - viewport.clientHeight);
            pos = clamp(p, 0, max);
            inner.style.transition = animate ? 'transform 160ms ease' : 'none';
            inner.style.transform = `translateY(${-pos}px)`;
            // fade the edge that has more beyond it
            viewport.classList.toggle('more-above', pos > 1);
            viewport.classList.toggle('more-below', pos < max - 1);
        };
        return {
            reset() { set(0, false); },
            reveal(start, size, animate = true) {
                const view = viewport.clientHeight;
                // keep a peek of the next row in view, clear of the edge fade
                const pad = 64;
                if (start - pad < pos) set(start - pad, animate);
                else if (start + size + pad > pos + view) set(start + size + pad - view, animate);
            },
            wheel(ev) {
                const px = ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaMode === 2 ? ev.deltaY * viewport.clientHeight : ev.deltaY;
                set(pos + px, false);
            }
        };
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

    // ---------- The screen ----------

    const createScreen = (server, from) => {
        const model = createModel(server);
        const root = el('div', 'homer-screen hx-root');
        root.id = 'hx-root';
        root.style.visibility = 'hidden'; // until settings.css has loaded
        root.style.zIndex = Z;
        const stage = el('div', 'hx-stage');
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hx-topbar">
                <div class="hx-brand homer-home" role="button" title="Home (H)"><span class="hx-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hx-brand-sub">Settings</span></div>
                <div class="hx-clock"><div class="hx-clock-time"></div><div class="hx-clock-date"></div></div>
            </div>
            <div class="hx-toast" role="status" aria-live="polite"></div>
            <div class="hx-body">
                <div class="hx-list">
                    <div class="hx-items"></div>
                    <div class="hx-account">
                        <div class="hx-account-row"><span class="material-icons" aria-hidden="true">person</span><span class="hx-account-user"></span></div>
                        <div class="hx-account-row"><span class="material-icons" aria-hidden="true">dns</span><span class="hx-account-server"></span></div>
                    </div>
                </div>
                <div class="hx-options">
                    <div class="hx-opts"><div class="hx-opts-inner"></div></div>
                    <div class="hx-state"></div>
                </div>
                <div class="hx-info">
                    <div class="hx-preview" data-homer-preview>
                        <div class="hx-preview-idle"><span class="hx-preview-mark"></span><span class="hx-preview-word">HOMER</span></div>
                    </div>
                    <div class="hx-info-scope"></div>
                    <div class="hx-info-title"></div>
                    <div class="hx-info-desc"></div>
                </div>
            </div>
            <div class="hx-legend"></div>`;
        document.body.appendChild(root);

        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), matching
        // the other HOMER screens, so the screen fills the window instead of
        // letterboxing
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
            $('.hx-clock-time').textContent = fmtTime(d);
            $('.hx-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.hx-clock')) : () => {};

        const toastEl = $('.hx-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `<span class="material-icons" aria-hidden="true">${kind === 'err' ? 'error_outline' : 'check_circle'}</span><span class="hx-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hx-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hx-toast'; }, 2200);
        };

        // ----- state -----
        // (the settings, their values and whether they've loaded: model)
        let sel = Math.max(0, model.visible.findIndex((s) => from && s.id === from.id)); // setting
        let zone = 'list'; // list | options
        let opt = 0; // highlighted choice
        let armed = false; // sign out (or a choice that asks first, like Disconnect) asked once
        let armedOpt = -1; // which choice is armed
        let armTimer = 0;
        let signingOut = false;
        let alive = true;

        let options = [];

        const setting = () => model.visible[sel];
        const curIndex = (s) => {
            const list = s === setting() ? options : s.options();
            const v = s.current();
            return list.findIndex((o) => s.matches(o, v));
        };
        const valueLabel = model.valueLabel;

        // ----- drawing -----
        const itemsBox = $('.hx-items');
        const optsView = $('.hx-opts');
        const optsInner = $('.hx-opts-inner');
        const scroller = makeScroller(optsView, optsInner);
        const stateEl = $('.hx-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const drawList = () => {
            itemsBox.innerHTML = model.visible.map((s, i) => `
                <div class="hx-item${i === sel ? ' sel' : ''}${s.action ? ' action' : ''}" role="button" data-i="${i}">
                    <span class="material-icons hx-item-icon" aria-hidden="true">${s.icon}</span>
                    <div class="hx-item-text"><div class="hx-item-label">${esc(s.label)}</div>${s.action ? '' : `<div class="hx-item-value">${esc(valueLabel(s)) || '&nbsp;'}</div>`}</div>
                    <span class="material-icons hx-item-go" aria-hidden="true">chevron_right</span>
                </div>`).join('');
        };

        const markList = () => {
            itemsBox.querySelectorAll('.hx-item').forEach((r, i) => r.classList.toggle('sel', i === sel));
        };

        const drawInfo = () => {
            const s = setting();
            const scope = model.scope(s);
            $('.hx-info-scope').innerHTML = `<span class="material-icons" aria-hidden="true">${scope.icon}</span>${scope.label}`;
            $('.hx-info-title').textContent = s.label;
            $('.hx-info-desc').textContent = model.desc(s);
        };

        const drawOptions = (revealCurrent) => {
            const s = setting();
            options = s.options();
            const cur = curIndex(s);
            if (revealCurrent) opt = cur >= 0 ? cur : 0;
            opt = clamp(opt, 0, Math.max(0, options.length - 1));
            optsInner.innerHTML = options.map((o, i) => {
                const isArmed = armed && (s.action || (o.confirm && i === armedOpt));
                const label = isArmed ? o.confirm || 'Sign out? OK to confirm' : o.label;
                const lead = s.action ? `<span class="material-icons hx-opt-lead" aria-hidden="true">${s.icon}</span>` : '<span class="material-icons hx-opt-check" aria-hidden="true">check</span>';
                const input = o.input === 'url'
                    ? `<input class="hx-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="http://homeassistant.local:8123" value="${esc(o.url)}" aria-label="Home Assistant address">`
                    : o.input
                        ? `<input class="hx-zip" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" value="${esc(o.zip)}" aria-label="ZIP code">`
                        : '';
                return `<div class="hx-opt${i === cur ? ' cur' : ''}${i === opt ? ' sel' : ''}${o.sub ? ' two' : ''}${s.action || o.confirm ? ' action' : ''}${isArmed ? ' armed' : ''}${o.input === 'url' ? ' url' : ''}" role="button" data-i="${i}">
                    ${lead}<div class="hx-opt-text"><div class="hx-opt-label">${esc(label)}</div>${o.sub ? `<div class="hx-opt-sub">${esc(o.sub)}</div>` : ''}</div>${input}
                </div>`;
            }).join('');
            if (revealCurrent) scroller.reset();
            revealOpt(false);
        };

        const revealOpt = (animate) => {
            const r = optsInner.children[opt];
            if (r) scroller.reveal(r.offsetTop, r.offsetHeight, animate);
        };

        const markOptions = () => {
            const cur = curIndex(setting());
            [...optsInner.children].forEach((r, i) => {
                r.classList.toggle('sel', i === opt);
                r.classList.toggle('cur', i === cur);
            });
        };

        const updateLegend = () => {
            const items = [];
            if (model.status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (model.status === 'ready' && zone === 'list') {
                items.push({ key: '▲▼', label: 'Settings' }, { key: 'OK', label: 'Choices', action: 'ok' });
            } else if (model.status === 'ready') {
                const s = setting();
                const o = options[opt] || {};
                items.push({ key: '▲▼', label: 'Choices' }, { key: '◀', label: 'Settings' },
                    { key: 'OK', label: s.action ? (armed ? 'Confirm sign out' : 'Sign out') : o.confirm && armed ? 'Confirm' : o.input === 'url' ? 'Type the address' : 'Select', action: 'ok' });
            }
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' }, { key: 'ESC', label: 'Back', action: 'back' });
            $('.hx-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hx-key">${i.key}</span>${esc(i.label)}</span>`)).join('');
        };

        const setZone = (z) => {
            zone = z;
            stage.classList.toggle('hx-zone-list', z === 'list');
            stage.classList.toggle('hx-zone-options', z === 'options');
            updateLegend();
        };

        const disarm = () => {
            clearTimeout(armTimer);
            if (!armed) return;
            armed = false;
            armedOpt = -1;
            drawOptions(false);
            updateLegend();
        };

        const selectSetting = (i) => {
            i = clamp(i, 0, model.visible.length - 1);
            if (i === sel && options.length) return;
            disarm();
            sel = i;
            markList();
            drawInfo();
            drawOptions(true);
        };

        const moveOpt = (d) => {
            const n = clamp(opt + d, 0, options.length - 1);
            if (n === opt) return;
            opt = n;
            markOptions();
            revealOpt(true);
        };

        // ----- choosing -----
        const choose = async (i) => {
            const s = setting();
            const o = options[i];
            if (!o || model.status !== 'ready' || signingOut) return;
            if (s.action) {
                if (!armed) {
                    armed = true;
                    drawOptions(false);
                    updateLegend();
                    clearTimeout(armTimer);
                    armTimer = setTimeout(disarm, 8000);
                    return;
                }
                clearTimeout(armTimer);
                signingOut = true;
                optsInner.querySelector('.hx-opt-label').textContent = 'Signing out…';
                signOut();
                return;
            }
            // a choice that asks first (Disconnect): the first OK arms it
            if (o.confirm) {
                if (!armed || armedOpt !== i) {
                    armed = true;
                    armedOpt = i;
                    drawOptions(false);
                    updateLegend();
                    clearTimeout(armTimer);
                    armTimer = setTimeout(disarm, 8000);
                    return;
                }
                clearTimeout(armTimer);
                armed = false;
                armedOpt = -1;
            }
            // the address row: OK puts the cursor in its box; Enter there saves
            if (o.input === 'url') {
                editUrl();
                return;
            }
            // the ZIP row: OK puts the cursor in its box; Enter there saves
            if (o.input) {
                editZip();
                return;
            }
            if (o.info) return; // says how things are; nothing to pick
            if (s.matches(o, s.current()) && !o.confirm) {
                toast('Saved');
                return;
            }
            // show the new check at once; it goes back if the save fails
            const saving = model.save(s, o);
            markOptions();
            drawList();
            try {
                await saving;
                if (!alive) return;
                toast(o.done || 'Saved');
            } catch (err) {
                console.warn('[HOMER Settings] save failed', err);
                if (!alive) return;
                toast('Couldn\'t save that. Try again.', 'err');
            }
            if (!alive) return;
            markOptions();
            drawList();
        };

        // ----- the ZIP code box -----
        const zipBox = () => optsInner.querySelector('.hx-zip');
        let zipBusy = false;
        const editZip = (clear) => {
            const box = zipBox();
            if (!box || zipBusy) return;
            if (clear) box.value = '';
            box.focus();
            if (!clear) box.select();
        };
        const endZip = () => {
            const box = zipBox();
            if (box && wx()) box.value = wx().zip().zip;
            if (box) box.blur();
        };
        const submitZip = async () => {
            const box = zipBox();
            if (!box || zipBusy || !wx()) return;
            const zip = box.value.trim();
            if (!/^\d{5}$/.test(zip)) { toast('Enter a 5-digit ZIP code', 'err'); return; }
            zipBusy = true;
            const sub = box.closest('.hx-opt').querySelector('.hx-opt-sub');
            if (sub) sub.textContent = 'Looking it up…';
            let hit = null;
            let failed = false;
            try { hit = await wx().useZip(zip); } catch { failed = true; }
            zipBusy = false;
            if (!alive) return;
            if (hit) toast(`Saved · ${hit.name}`);
            else toast(failed ? 'Couldn\'t look that up. Try again.' : `Couldn't find ZIP ${zip}`, 'err');
            drawOptions(false);
            drawList();
            if (!hit) editZip();
        };
        // typing in the box: digits and editing keys stay in it, Enter saves,
        // Esc puts the saved ZIP back, ▲▼ leave it
        const onZipKey = (ev) => {
            const k = ev.key;
            ev.stopPropagation(); // nothing underneath should see it
            if (k === 'Enter') { ev.preventDefault(); submitZip(); return; }
            if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') { ev.preventDefault(); endZip(); return; }
            if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); endZip(); moveOpt(k === 'ArrowUp' ? -1 : 1); return; }
            if (k.length === 1 && !/\d/.test(k) && !ev.ctrlKey && !ev.metaKey) ev.preventDefault();
        };
        // ----- the Home Assistant address box -----
        const urlBox = () => optsInner.querySelector('.hx-url');
        const editUrl = () => {
            const box = urlBox();
            if (!box) return;
            box.focus();
            box.select();
        };
        const endUrl = () => {
            const box = urlBox();
            if (box && ha()) box.value = ha().address();
            if (box) box.blur();
        };
        const submitUrl = () => {
            const box = urlBox();
            if (!box || !ha()) return;
            if (!ha().setAddress(box.value)) { toast('That isn\'t an address', 'err'); return; }
            const problem = ha().addressProblem();
            box.blur();
            if (problem) toast(problem, 'err');
            else toast('Saved · ' + ha().address());
            opt = 0; // on Connect, the next thing to press
            drawOptions(false);
            drawInfo();
            drawList();
            updateLegend();
        };
        // typing in the address box: Enter saves, Esc puts it back, ▲▼ leave it
        const onUrlKey = (ev) => {
            const k = ev.key;
            ev.stopPropagation();
            if (k === 'Enter') { ev.preventDefault(); submitUrl(); return; }
            if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') { ev.preventDefault(); endUrl(); return; }
            if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); endUrl(); moveOpt(k === 'ArrowUp' ? -1 : 1); }
        };
        const onZipBlur = (ev) => {
            if (ev.target.classList && ev.target.classList.contains('hx-zip') && !zipBusy && wx()) {
                ev.target.value = wx().zip().zip;
            }
        };

        // ----- keys -----
        const onKey = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const t = ev.target;
            if (t && t.classList && t.classList.contains('hx-zip') && root.contains(t)) { onZipKey(ev); return; }
            if (t && t.classList && t.classList.contains('hx-url') && root.contains(t)) { onUrlKey(ev); return; }
            // a digit on the ZIP row starts a new ZIP
            if (zone === 'options' && model.status === 'ready' && /^\d$/.test(ev.key) && options[opt] && options[opt].input) {
                ev.stopPropagation();
                editZip(true);
                return;
            }
            if (t && t !== document.body && !root.contains(t) && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') { stop(ev); goHome(); return; }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                if (zone === 'options' && model.status === 'ready') { disarm(); setZone('list'); }
                else goBack();
                return;
            }
            const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k);
            if (!nav) return;
            stop(ev); // nothing underneath should see the remote while Settings is up
            if (model.status === 'error') { if (k === 'Enter') load(); return; }
            if (model.status !== 'ready') return;
            if (zone === 'list') {
                if (k === 'ArrowUp') selectSetting(sel - 1);
                else if (k === 'ArrowDown') selectSetting(sel + 1);
                else if (k === 'ArrowRight' || k === 'Enter' || k === ' ') {
                    opt = Math.max(0, curIndex(setting()));
                    markOptions();
                    revealOpt(false);
                    setZone('options');
                }
            } else {
                if (k === 'ArrowUp') { disarm(); moveOpt(-1); }
                else if (k === 'ArrowDown') { disarm(); moveOpt(1); }
                else if (k === 'ArrowLeft') { disarm(); setZone('list'); }
                else if (k === 'Enter' || k === ' ') choose(opt);
            }
        };

        // Jellyfin's player turns the scroll wheel into volume, so while Settings
        // is up the wheel stops here (at the window, ahead of everything), even
        // over a video docked in the preview.
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (optsView.contains(ev.target)) scroller.wheel(ev);
        };

        const moved = hoverTracker();
        const onMove = (ev) => {
            if (!moved(ev) || model.status !== 'ready' || signingOut) return;
            const item = ev.target.closest('.hx-item');
            if (item) {
                if (zone !== 'list') { disarm(); setZone('list'); }
                selectSetting(Number(item.dataset.i));
                return;
            }
            const o = ev.target.closest('.hx-opt');
            if (o) {
                const i = Number(o.dataset.i);
                if (zone !== 'options') setZone('options');
                if (i !== opt) { opt = i; markOptions(); }
            }
        };
        const onClick = (ev) => {
            if (ev.target.closest('.hx-brand')) { goHome(); return; }
            const leg = ev.target.closest('.hx-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') goBack();
                else if (a === 'ok') {
                    if (model.status === 'error') load();
                    else if (model.status !== 'ready') return;
                    else if (zone === 'list') { opt = Math.max(0, curIndex(setting())); markOptions(); setZone('options'); }
                    else choose(opt);
                }
                return;
            }
            if (model.status !== 'ready' || signingOut) return;
            const item = ev.target.closest('.hx-item');
            if (item) {
                selectSetting(Number(item.dataset.i));
                opt = Math.max(0, curIndex(setting()));
                markOptions();
                setZone('options');
                return;
            }
            const o = ev.target.closest('.hx-opt');
            if (o) {
                opt = Number(o.dataset.i);
                markOptions();
                setZone('options');
                choose(opt);
            }
        };

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('mousemove', onMove);
        stage.addEventListener('click', onClick);
        stage.addEventListener('focusout', onZipBlur);

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- data -----
        const load = async () => {
            const current = setting();
            const loading = model.load(); // loading now
            setState('<div class="hx-spinner"></div><b>Loading settings…</b>');
            optsInner.innerHTML = '';
            drawList();
            drawInfo();
            updateLegend();
            try {
                if (!await loading || !alive) return;
                // the list may be shorter now (no Streaming quality)
                sel = Math.max(0, model.visible.indexOf(current));
                $('.hx-account-user').innerHTML = model.userLine();
                $('.hx-account-server').innerHTML = model.serverLine();
                setState('');
                drawList();
                drawInfo();
                drawOptions(true);
                updateLegend();
            } catch {
                if (!alive) return;
                setState('<b>Couldn\'t load your settings</b><span>Press OK to try again.</span>');
                updateLegend();
            }
        };

        // Home Assistant's connection coming and going changes its row
        const offHA = ha() ? ha().onChange(() => {
            if (!alive || model.status !== 'ready') return;
            drawList();
            const box = urlBox();
            if (setting() && setting().id === 'ha' && !(box && document.activeElement === box)) {
                drawOptions(false);
                drawInfo();
                updateLegend();
            }
        }) : () => {};

        setZone('list');
        load();

        return {
            root,
            phone: false,
            show() { root.style.visibility = ''; },
            // where Settings is, for the phone layout
            state: () => ({ id: setting() ? setting().id : null }),
            teardown() {
                alive = false;
                model.dispose();
                offHA();
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                wxDetach();
                clearTimeout(toastTimer);
                clearTimeout(armTimer);
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false; // closed via close(); stay out of the way until the route changes
    let destroyed = false;

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const sync = () => {
        if (destroyed) return;
        const route = currentRoute();
        const ours = isOurs(route) && !isSignedOutPage();
        if (!ours) suppressed = false;
        const server = getServer();
        if (!ours || !server || suppressed) {
            closeScreen();
            return;
        }
        if (screen) return;
        const s = draw(server, null);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    // The phone layout: shared/layout.js says when; settings/settings-phone.js
    // draws it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerSettingsPhone && window.HomerLayout.usePhone('settings'));
    const draw = (server, from) => (phoneLayout()
        ? window.HomerSettingsPhone.create({ model: createModel(server), state: from, goHome, goBack, signOut })
        : createScreen(server, from));

    // The phone and TV layouts switch places (a window resized across the
    // line, mostly): draw the other one, at the same setting.
    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        const server = getServer();
        const from = screen.state();
        closeScreen();
        if (!server || destroyed) return;
        const s = draw(server, from);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    // HomerPlayer may load after this script; subscribe once it's there.
    let unsubscribe = null;
    const subscribe = () => {
        if (unsubscribe) return;
        const hp = player();
        if (!hp || typeof hp.onChange !== 'function') return;
        try {
            const off = hp.onChange(() => onRouteChange());
            unsubscribe = typeof off === 'function' ? off : () => {};
        } catch { /* keep watching the address */ }
    };

    let lastRoute = null;
    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued) return;
        syncQueued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            subscribe();
            const key = currentRoute() + '|' + location.hash;
            if (key === lastRoute && (screen || !isOurs(currentRoute()))) return;
            lastRoute = key;
            sync();
        }, 50);
    };
    const onRouteChange = () => {
        lastRoute = null;
        queueSync();
    };

    let observer = null;
    const start = () => {
        // Jellyfin's router uses pushState, which fires no event; watch the DOM
        // (it re-renders on every navigation) and check the route.
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerSettings = {
        version: VERSION,
        // open(): go to Settings (or take over the route if we're already there)
        open() {
            suppressed = false;
            if (!isOurs(currentRoute())) {
                go(OUR_ROUTE);
                return;
            }
            onRouteChange();
        },
        // close(): step aside until the route changes
        close() {
            if (!screen) return;
            suppressed = true;
            closeScreen();
        },
        destroy() {
            destroyed = true;
            closeScreen();
            offLayout();
            if (observer) observer.disconnect();
            if (unsubscribe) { try { unsubscribe(); } catch { /* gone */ } }
            unsubscribe = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('hx-css')?.remove();
            document.getElementById('hx-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
