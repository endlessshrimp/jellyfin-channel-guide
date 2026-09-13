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
 *   Sign out            Jellyfin Web's own logout, after a second OK
 *
 * Remote/keyboard: ▲▼ move, ◀▶ between the list and the choices, OK selects,
 * Esc/Backspace goes back, H goes Home.
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
        if (cssReady && document.getElementById('hs-css')) return cssReady;
        const css = document.createElement('link');
        css.id = 'hs-css';
        css.rel = 'stylesheet';
        css.href = BASE + 'settings.css' + QUERY;
        cssReady = new Promise((resolve) => {
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
        });
        document.head.appendChild(css);
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

    const createScreen = (server) => {
        const uid = server.UserId;
        const root = el('div', 'homer-screen hs-root');
        root.id = 'hx-root';
        root.style.visibility = 'hidden'; // until settings.css has loaded
        root.style.zIndex = Z;
        const stage = el('div', 'hs-stage');
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hs-topbar">
                <div class="hs-brand homer-home" role="button" title="Home (H)"><span class="hs-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hs-brand-sub">Settings</span></div>
                <div class="hs-clock"><div class="hs-clock-time"></div><div class="hs-clock-date"></div></div>
            </div>
            <div class="hs-toast" role="status" aria-live="polite"></div>
            <div class="hs-body">
                <div class="hs-list">
                    <div class="hs-items"></div>
                    <div class="hs-account">
                        <div class="hs-account-row"><span class="material-icons" aria-hidden="true">person</span><span class="hs-account-user"></span></div>
                        <div class="hs-account-row"><span class="material-icons" aria-hidden="true">dns</span><span class="hs-account-server"></span></div>
                    </div>
                </div>
                <div class="hs-options">
                    <div class="hs-opts"><div class="hs-opts-inner"></div></div>
                    <div class="hs-state"></div>
                </div>
                <div class="hs-info">
                    <div class="hs-preview" data-homer-preview>
                        <div class="hs-preview-idle"><span class="hs-preview-mark"></span><span class="hs-preview-word">HOMER</span></div>
                    </div>
                    <div class="hs-info-scope"></div>
                    <div class="hs-info-title"></div>
                    <div class="hs-info-desc"></div>
                </div>
            </div>
            <div class="hs-legend"></div>`;
        document.body.appendChild(root);

        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), matching
        // the other HOMER screens, so the screen fills the window instead of
        // letterboxing
        const fit = () => {
            let s = window.innerHeight / 1080;
            let w = window.innerWidth / s;
            if (w < 1600) { s = window.innerWidth / 1600; w = 1600; }
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

        const toastEl = $('.hs-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `<span class="material-icons" aria-hidden="true">${kind === 'err' ? 'error_outline' : 'check_circle'}</span><span class="hs-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hs-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hs-toast'; }, 2200);
        };

        // ----- state -----
        let status = 'loading'; // loading | ready | error
        let cfg = {};
        let cultures = null;
        let inNetwork = savedInNetwork();
        let canTranscode = true;
        let sel = 0; // setting
        let zone = 'list'; // list | options
        let opt = 0; // highlighted choice
        let armed = false; // sign out asked once
        let armTimer = 0;
        let signingOut = false;
        let alive = true;

        // ----- languages, checked against the server's cultures -----
        const culture = (code) => (cultures || []).find((c) => lc(c.ThreeLetterISOLanguageName) === code
            || (c.ThreeLetterISOLanguageNames || []).some((n) => lc(n) === code));
        const langMatches = (o, v) => lc(o.value) === lc(v) || (o.aliases || []).includes(lc(v));
        const languageOptions = (current) => {
            const list = [{ value: '', label: 'Any', sub: 'Use each video\'s own default' }];
            for (const [code, name] of LANGUAGES) {
                const c = culture(code);
                if (cultures && !c) continue; // the server doesn't know it
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
            current: () => cfg[field] || '',
            matches: langMatches,
            save: async (value) => {
                const saved = await saveUserField(uid, field, value);
                if (alive) cfg = saved;
            }
        });
        const SETTINGS = [
            {
                id: 'audio', icon: 'record_voice_over', label: 'Audio language', scope: 'account',
                desc: 'When a movie or show has more than one audio track, play this language.',
                options: () => languageOptions(cfg.AudioLanguagePreference),
                ...userSetting('AudioLanguagePreference')
            },
            {
                id: 'subs', icon: 'subtitles', label: 'Subtitles', scope: 'account',
                desc: 'When subtitles come on by themselves. You can always change them while watching.',
                options: () => SUBTITLE_MODES,
                ...userSetting('SubtitleMode'),
                current: () => cfg.SubtitleMode || 'Default',
                matches: (o, v) => o.value === v
            },
            {
                id: 'sublang', icon: 'translate', label: 'Subtitle language', scope: 'account',
                desc: 'The language to use when subtitles come on.',
                options: () => languageOptions(cfg.SubtitleLanguagePreference),
                ...userSetting('SubtitleLanguagePreference')
            },
            {
                id: 'quality', icon: 'speed', label: 'Streaming quality', scope: 'device',
                desc: 'The most this device asks the server for. Pick a lower limit if video stutters; Auto measures your connection.',
                options: () => QUALITY.map((b) => ({ value: b, label: mbps(b), sub: b ? '' : 'Adjusts to your connection' })),
                current: () => readQuality(inNetwork == null ? true : inNetwork),
                matches: (o, v) => o.value === v,
                save: async (value) => writeQuality(value)
            },
            {
                id: 'signout', icon: 'exit_to_app', label: 'Sign out', scope: 'device', action: true,
                desc: 'Sign out of HOMER on this device and go to the sign-in screen.',
                options: () => [{ value: 'signout', label: 'Sign out' }],
                current: () => null,
                matches: () => false
            }
        ];
        let visible = SETTINGS.slice();
        let options = [];

        const setting = () => visible[sel];
        const curIndex = (s) => {
            const list = s === setting() ? options : s.options();
            const v = s.current();
            return list.findIndex((o) => s.matches(o, v));
        };
        const valueLabel = (s) => {
            if (s.action || status !== 'ready') return '';
            const list = s.options();
            const v = s.current();
            const o = list.find((x) => s.matches(x, v));
            return o ? o.label : '';
        };

        // ----- drawing -----
        const itemsBox = $('.hs-items');
        const optsView = $('.hs-opts');
        const optsInner = $('.hs-opts-inner');
        const scroller = makeScroller(optsView, optsInner);
        const stateEl = $('.hs-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const drawList = () => {
            itemsBox.innerHTML = visible.map((s, i) => `
                <div class="hs-item${i === sel ? ' sel' : ''}${s.action ? ' action' : ''}" role="button" data-i="${i}">
                    <span class="material-icons hs-item-icon" aria-hidden="true">${s.icon}</span>
                    <div class="hs-item-text"><div class="hs-item-label">${esc(s.label)}</div>${s.action ? '' : `<div class="hs-item-value">${esc(valueLabel(s)) || '&nbsp;'}</div>`}</div>
                    <span class="material-icons hs-item-go" aria-hidden="true">chevron_right</span>
                </div>`).join('');
        };

        const markList = () => {
            itemsBox.querySelectorAll('.hs-item').forEach((r, i) => r.classList.toggle('sel', i === sel));
        };

        const drawInfo = () => {
            const s = setting();
            $('.hs-info-scope').innerHTML = s.scope === 'device'
                ? '<span class="material-icons" aria-hidden="true">devices</span>This device only'
                : '<span class="material-icons" aria-hidden="true">account_circle</span>Saved to your account';
            $('.hs-info-title').textContent = s.label;
            $('.hs-info-desc').textContent = s.desc;
        };

        const drawOptions = (revealCurrent) => {
            const s = setting();
            options = s.options();
            const cur = curIndex(s);
            if (revealCurrent) opt = cur >= 0 ? cur : 0;
            opt = clamp(opt, 0, Math.max(0, options.length - 1));
            optsInner.innerHTML = options.map((o, i) => {
                const label = s.action && armed ? 'Sign out? OK to confirm' : o.label;
                const lead = s.action ? `<span class="material-icons hs-opt-lead" aria-hidden="true">${s.icon}</span>` : '<span class="material-icons hs-opt-check" aria-hidden="true">check</span>';
                return `<div class="hs-opt${i === cur ? ' cur' : ''}${i === opt ? ' sel' : ''}${o.sub ? ' two' : ''}${s.action ? ' action' : ''}${s.action && armed ? ' armed' : ''}" role="button" data-i="${i}">
                    ${lead}<div class="hs-opt-text"><div class="hs-opt-label">${esc(label)}</div>${o.sub ? `<div class="hs-opt-sub">${esc(o.sub)}</div>` : ''}</div>
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
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (status === 'ready' && zone === 'list') {
                items.push({ key: '▲▼', label: 'Settings' }, { key: 'OK', label: 'Choices', action: 'ok' });
            } else if (status === 'ready') {
                const s = setting();
                items.push({ key: '▲▼', label: 'Choices' }, { key: '◀', label: 'Settings' },
                    { key: 'OK', label: s.action ? (armed ? 'Confirm sign out' : 'Sign out') : 'Select', action: 'ok' });
            }
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' }, { key: 'ESC', label: 'Back', action: 'back' });
            $('.hs-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hs-key">${i.key}</span>${esc(i.label)}</span>`)).join('');
        };

        const setZone = (z) => {
            zone = z;
            stage.classList.toggle('hs-zone-list', z === 'list');
            stage.classList.toggle('hs-zone-options', z === 'options');
            updateLegend();
        };

        const disarm = () => {
            clearTimeout(armTimer);
            if (!armed) return;
            armed = false;
            if (setting().action) drawOptions(false);
            updateLegend();
        };

        const selectSetting = (i) => {
            i = clamp(i, 0, visible.length - 1);
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
            if (!o || status !== 'ready' || signingOut) return;
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
                optsInner.querySelector('.hs-opt-label').textContent = 'Signing out…';
                signOut();
                return;
            }
            if (s.matches(o, s.current())) {
                toast('Saved');
                return;
            }
            // show the new check at once; put it back if the save fails
            const before = { cfg };
            if (s.field) cfg = Object.assign({}, cfg, { [s.field]: o.value });
            markOptions();
            drawList();
            try {
                await s.save(o.value);
                if (!alive) return;
                toast('Saved');
            } catch (err) {
                console.warn('[HOMER Settings] save failed', err);
                if (!alive) return;
                cfg = before.cfg;
                toast('Couldn\'t save that. Try again.', 'err');
            }
            if (!alive) return;
            markOptions();
            drawList();
        };

        // ----- keys -----
        const onKey = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const t = ev.target;
            if (t && t !== document.body && !root.contains(t) && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') { stop(ev); goHome(); return; }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                if (zone === 'options' && status === 'ready') { disarm(); setZone('list'); }
                else goBack();
                return;
            }
            const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k);
            if (!nav) return;
            stop(ev); // nothing underneath should see the remote while Settings is up
            if (status === 'error') { if (k === 'Enter') load(); return; }
            if (status !== 'ready') return;
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
            if (!moved(ev) || status !== 'ready' || signingOut) return;
            const item = ev.target.closest('.hs-item');
            if (item) {
                if (zone !== 'list') { disarm(); setZone('list'); }
                selectSetting(Number(item.dataset.i));
                return;
            }
            const o = ev.target.closest('.hs-opt');
            if (o) {
                const i = Number(o.dataset.i);
                if (zone !== 'options') setZone('options');
                if (i !== opt) { opt = i; markOptions(); }
            }
        };
        const onClick = (ev) => {
            if (ev.target.closest('.hs-brand')) { goHome(); return; }
            const leg = ev.target.closest('.hs-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') goBack();
                else if (a === 'ok') {
                    if (status === 'error') load();
                    else if (status !== 'ready') return;
                    else if (zone === 'list') { opt = Math.max(0, curIndex(setting())); markOptions(); setZone('options'); }
                    else choose(opt);
                }
                return;
            }
            if (status !== 'ready' || signingOut) return;
            const item = ev.target.closest('.hs-item');
            if (item) {
                selectSetting(Number(item.dataset.i));
                opt = Math.max(0, curIndex(setting()));
                markOptions();
                setZone('options');
                return;
            }
            const o = ev.target.closest('.hs-opt');
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

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- data -----
        const load = async () => {
            status = 'loading';
            setState('<div class="hs-spinner"></div><b>Loading settings…</b>');
            optsInner.innerHTML = '';
            drawList();
            drawInfo();
            updateLegend();
            try {
                const [user, cults, info, endpoint] = await Promise.all([
                    api(`/Users/${uid}`),
                    api('/Localization/Cultures').catch(() => null),
                    api('/System/Info/Public').catch(() => null),
                    inNetwork == null ? api('/System/Endpoint').catch(() => null) : null
                ]);
                if (!alive) return;
                cfg = (user && user.Configuration) || {};
                cultures = Array.isArray(cults) && cults.length ? cults : null;
                if (inNetwork == null && endpoint && typeof endpoint.IsInNetwork === 'boolean') inNetwork = endpoint.IsInNetwork;
                // Jellyfin Web hides the quality choice from accounts that can't transcode
                canTranscode = !(user.Policy && user.Policy.EnableVideoPlaybackTranscoding === false);
                const current = setting();
                visible = SETTINGS.filter((s) => s.id !== 'quality' || canTranscode);
                sel = Math.max(0, visible.indexOf(current));
                $('.hs-account-user').innerHTML = `Signed in as <b>${esc(user.Name || '')}</b>`;
                $('.hs-account-server').innerHTML = info
                    ? `<b>${esc(info.ServerName || 'Jellyfin')}</b>${info.Version ? ` · Jellyfin ${esc(info.Version)}` : ''}`
                    : '';
                status = 'ready';
                setState('');
                drawList();
                drawInfo();
                drawOptions(true);
                updateLegend();
            } catch (err) {
                console.warn('[HOMER Settings] load failed', err);
                if (!alive) return;
                status = 'error';
                setState('<b>Couldn\'t load your settings</b><span>Press OK to try again.</span>');
                updateLegend();
            }
        };

        setZone('list');
        load();

        return {
            root,
            show() { root.style.visibility = ''; },
            teardown() {
                alive = false;
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
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
        const s = createScreen(server);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

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
            if (observer) observer.disconnect();
            if (unsubscribe) { try { unsubscribe(); } catch { /* gone */ } }
            unsubscribe = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('hs-css')?.remove();
            cssReady = null;
        }
    };
})();
