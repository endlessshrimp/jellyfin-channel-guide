/*
 * HOMER's Apple apps, the page side. The app injects this at document start
 * in the main frame, just after a line that sets window.__homerAppBoot to
 * { platform, version, origin, zoom, nowPlaying, saved }.
 *
 * What HOMER reads:
 *
 *   window.HOMER_APP = { platform: 'tvos' | 'ios' | 'ipados', version }
 *   window.HOMER_TVAPP = true            the old name, on the Apple TV only
 *   window.dispatchEvent(new CustomEvent('homer-app', { detail: { action } }))
 *   window.dispatchEvent(new CustomEvent('homer-tv', …))   the old name, Apple TV only
 *
 * with action 'menu' (OK held down), 'swipe-up' or 'swipe-down' — HOMER's
 * letter shortcuts, which a remote can't type.
 *
 * Everywhere:
 *  - puts the saved sign-in back into localStorage before Jellyfin reads it,
 *    and tells the app whenever it changes (a web view's storage isn't
 *    promised to survive, so the app keeps a copy in the Keychain);
 *  - tells the app when video or audio is playing (the screensaver waits),
 *    and on iOS what's playing, for the lock screen.
 *
 * Apple TV only (the remote drives a page that takes no touches):
 *  - the buttons arrive as key events (window.__homerApp.key);
 *  - a text box that takes focus asks for the tvOS keyboard, and the app
 *    hands the text back with window.__homerApp.text();
 *  - Jellyfin's own pages are zoomed, HOMER's screens are left alone;
 *  - the page is a desktop to Jellyfin (its layout and player follow the user
 *    agent, navigator.maxTouchPoints and (hover: none)), and has no cursor;
 *  - where no HOMER screen is up (Jellyfin's sign-in), arrows move focus and
 *    OK clicks.
 */
(() => {
    'use strict';
    if (window.__homerApp) return;

    const boot = window.__homerAppBoot || {};
    try { delete window.__homerAppBoot; } catch { window.__homerAppBoot = undefined; }

    const platform = boot.platform || 'tvos';
    const onTV = platform === 'tvos';

    const post = (msg) => {
        try { window.webkit.messageHandlers.homer.postMessage(msg); } catch { /* not in the app */ }
    };
    const onHomer = () => !!boot.origin && location.origin === boot.origin;

    window.HOMER_APP = { platform, version: boot.version || '' };
    if (onTV) window.HOMER_TVAPP = true; // what HOMER v0.4.6 and older read

    // ---------- Report page errors to Xcode's console ----------

    window.addEventListener('error', (ev) => post({ type: 'log', text: `${ev.message} (${ev.filename}:${ev.lineno})` }));
    window.addEventListener('unhandledrejection', (ev) => post({ type: 'log', text: 'Unhandled rejection: ' + String(ev.reason) }));

    // ---------- The Apple TV is a desktop, not a TV, an iPad or a phone ----------

    if (onTV) {
        try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, configurable: true }); } catch { /* keep it */ }
        for (let o = window; o; o = Object.getPrototypeOf(o)) {
            try { if (Object.prototype.hasOwnProperty.call(o, 'ontouchstart')) delete o.ontouchstart; } catch { /* keep it */ }
        }
        // tvOS's web view matches (hover: none), which HOMER (before its app
        // flag, v0.4.1 and older) and Jellyfin read as a touch screen. The
        // remote drives it like a keyboard, so pointer queries answer as a
        // desktop's do.
        const YES = '(min-width: 0px)';
        const NO = '(max-width: 0px) and (min-width: 1px)';
        const DESKTOP_QUERIES = [
            [/\(\s*(any-)?hover\s*:\s*none\s*\)/gi, NO],
            [/\(\s*(any-)?hover\s*:\s*hover\s*\)/gi, YES],
            [/\(\s*(any-)?pointer\s*:\s*(coarse|none)\s*\)/gi, NO],
            [/\(\s*(any-)?pointer\s*:\s*fine\s*\)/gi, YES]
        ];
        const matchMedia = window.matchMedia;
        if (typeof matchMedia === 'function') {
            window.matchMedia = function (query) {
                let q = String(query);
                for (const [re, v] of DESKTOP_QUERIES) q = q.replace(re, v);
                return matchMedia.call(window, q);
            };
        }

        // no cursor; a focus ring where the app moves focus
        const style = document.createElement('style');
        style.id = 'homer-app-style';
        style.textContent = `
            html, html * { cursor: none !important; -webkit-tap-highlight-color: transparent; }
            [data-homer-tvapp-nav]:focus { outline: 4px solid #2f8cff !important; outline-offset: 3px !important; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------- The saved sign-in ----------

    // Jellyfin's sign-in and device id, and HOMER's own settings; not HOMER's
    // dev-only keys or a Home Assistant sign-in that's half done.
    const keep = (k) => k === 'jellyfin_credentials' || k === '_deviceId2'
        || (/^homer-/.test(k) && !/^homer-ha-(dev|mock|pending)$/.test(k));
    const MAX_VALUE = 16 * 1024;
    const MAX_TOTAL = 96 * 1024; // well under tvOS's 500 KB
    const rank = (k) => (k === 'jellyfin_credentials' ? 0 : k === '_deviceId2' ? 1 : 2);

    if (onHomer() && boot.saved && typeof boot.saved === 'object') {
        for (const [k, v] of Object.entries(boot.saved)) {
            try {
                if (keep(k) && typeof v === 'string' && localStorage.getItem(k) === null) localStorage.setItem(k, v);
            } catch { /* storage full or off */ }
        }
    }

    const snapshot = () => {
        const out = {};
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            let total = 0;
            for (const k of keys.filter(keep).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
                const v = localStorage.getItem(k);
                if (v == null || v.length > MAX_VALUE || total + k.length + v.length > MAX_TOTAL) continue;
                out[k] = v;
                total += k.length + v.length;
            }
        } catch { /* storage off */ }
        return out;
    };

    let saveTimer = 0;
    const saveSoon = () => {
        if (!onHomer()) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => post({ type: 'storage', data: snapshot() }), 800);
    };
    for (const name of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function (...args) {
            const result = original.apply(this, args);
            try { if (this === window.localStorage) saveSoon(); } catch { /* storage off */ }
            return result;
        };
    }
    window.addEventListener('load', saveSoon);

    // ---------- Keys (the Apple TV's remote) ----------

    // key → [code, keyCode]: HOMER reads ev.key, Jellyfin reads keyCode, then code
    const KEYS = {
        ArrowUp: ['ArrowUp', 38],
        ArrowDown: ['ArrowDown', 40],
        ArrowLeft: ['ArrowLeft', 37],
        ArrowRight: ['ArrowRight', 39],
        Enter: ['Enter', 13],
        Escape: ['Escape', 27],
        ' ': ['Space', 32],
        h: ['KeyH', 72],
        PageUp: ['PageUp', 33],
        PageDown: ['PageDown', 34],
        MediaPlayPause: ['MediaPlayPause', 179]
    };
    const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    // the focused element, inside shadow roots too (Home Assistant's sign-in page)
    const deepActive = () => {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    };

    // true when a listener called preventDefault (it handled the key)
    const fire = (type, key, repeat, target) => {
        const [code, keyCode] = KEYS[key] || ['', 0];
        const t = target || deepActive() || document.body || document.documentElement;
        let ev;
        try {
            ev = new KeyboardEvent(type, {
                key, code, keyCode, which: keyCode, repeat: !!repeat,
                bubbles: true, cancelable: true, composed: true, view: window
            });
        } catch {
            return false;
        }
        // older WebKit ignores keyCode/which in the init dictionary
        for (const p of ['keyCode', 'which']) {
            if (ev[p] !== keyCode) {
                try { Object.defineProperty(ev, p, { get: () => keyCode }); } catch { /* read-only */ }
            }
        }
        return !t.dispatchEvent(ev);
    };

    // ---------- Text boxes: the tvOS keyboard ----------

    const NOT_TEXT = ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file', 'hidden'];
    const isText = (t) => !!t && !t.disabled && !t.readOnly && (t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !NOT_TEXT.includes((t.type || 'text').toLowerCase())));
    const shown = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none';
    };
    const valueOf = (t) => ('value' in t ? String(t.value || '') : String(t.textContent || ''));

    let box = null; // the text box the keyboard is for
    let boxId = 0;
    let quiet = { el: null, until: 0 }; // just handed text back: its focus events aren't a new request

    const askKeyboard = (t) => {
        box = t;
        boxId += 1;
        post({
            type: 'keyboard',
            id: boxId,
            value: valueOf(t),
            placeholder: t.getAttribute('placeholder') || t.getAttribute('aria-label') || '',
            kind: (t.getAttribute('type') || 'text').toLowerCase(),
            inputMode: t.getAttribute('inputmode') || '',
            enterKeyHint: t.getAttribute('enterkeyhint') || '',
            secure: (t.getAttribute('type') || '').toLowerCase() === 'password'
        });
    };

    if (onTV) {
        document.addEventListener('focusin', (ev) => {
            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
            if (!isText(t)) return;
            if (quiet.el === t && Date.now() < quiet.until) return;
            // a page that focuses a box and blurs it at once isn't asking
            setTimeout(() => {
                if (deepActive() === t && shown(t) && !(quiet.el === t && Date.now() < quiet.until)) askKeyboard(t);
            }, 150);
        }, true);
    }

    const setValue = (t, value) => {
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
            // the prototype's setter, so frameworks that track value notice
            const proto = t.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(t, value);
            else t.value = value;
        } else {
            t.textContent = value;
        }
        t.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        t.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    };

    // ---------- Pages without a HOMER screen ----------

    // On the Apple TV, arrows move focus and OK clicks there, and they're
    // zoomed. HOMER's own screens (and Jellyfin's full-screen player, which
    // fills the TV by itself) keep their own size and their own keys.
    const HOMER_SCREENS = '#hm-root, #hl-root, #cg-root, .homer-screen';
    const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]';
    const plainPage = () => !document.querySelector(HOMER_SCREENS) && !/^#\/video/.test(location.hash);

    const focusables = (root = document, out = []) => {
        for (const el of root.querySelectorAll('*')) {
            if (el.matches(FOCUSABLE) && !el.disabled && shown(el)) out.push(el);
            if (el.shadowRoot) focusables(el.shadowRoot, out);
        }
        return out;
    };
    const focusEl = (el) => {
        el.setAttribute('data-homer-tvapp-nav', '');
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old WebKit */ }
    };
    // the nearest focusable in the arrow's direction
    const move = (key) => {
        const all = focusables();
        if (!all.length) return false;
        const cur = deepActive();
        if (!cur || !all.includes(cur)) { focusEl(all[0]); return true; }
        const a = cur.getBoundingClientRect();
        const ax = a.left + a.width / 2;
        const ay = a.top + a.height / 2;
        let best = null;
        let bestScore = Infinity;
        for (const el of all) {
            if (el === cur) continue;
            const b = el.getBoundingClientRect();
            const dx = b.left + b.width / 2 - ax;
            const dy = b.top + b.height / 2 - ay;
            const along = key === 'ArrowDown' ? dy : key === 'ArrowUp' ? -dy : key === 'ArrowRight' ? dx : -dx;
            const across = key === 'ArrowDown' || key === 'ArrowUp' ? dx : dy;
            if (along <= 1) continue;
            const score = along + Math.abs(across) * 2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (best) focusEl(best);
        return !!best;
    };
    // after typing in a form on a plain page: on to the next field or button
    const next = (t) => {
        const all = focusables();
        const i = all.indexOf(t);
        if (i >= 0 && i + 1 < all.length) focusEl(all[i + 1]);
    };

    // ---------- Zoom on Jellyfin's own pages (the Apple TV) ----------

    const stockZoom = Number(boot.zoom) > 0 ? Number(boot.zoom) : 1;
    let zoom = 1;
    const syncZoom = () => {
        const want = plainPage() ? stockZoom : 1;
        if (want === zoom) return;
        zoom = want;
        post({ type: 'zoom', value: want });
    };
    const watchZoom = () => {
        syncZoom();
        // HOMER's screens come and go as children of <body>
        if (document.body) new MutationObserver(() => syncZoom()).observe(document.body, { childList: true });
        setInterval(syncZoom, 2000); // a screen that only hides itself
    };
    if (stockZoom !== 1) {
        window.addEventListener('hashchange', syncZoom);
        window.addEventListener('popstate', syncZoom);
        if (document.body) watchZoom();
        else document.addEventListener('DOMContentLoaded', watchZoom, { once: true });
    }

    // ---------- Media: the screensaver, and the lock screen ----------

    const media = () => [...document.querySelectorAll('video, audio')];
    const anyPlaying = () => media().some((m) => !m.paused && !m.ended);

    let playing = null;
    const syncMedia = () => {
        const now = anyPlaying();
        if (now === playing) return;
        playing = now;
        post({ type: 'media', playing: now });
    };
    for (const e of ['play', 'playing', 'pause', 'ended', 'emptied']) {
        document.addEventListener(e, () => setTimeout(syncMedia, 0), true);
    }

    // What HOMER's Music is playing, for iOS's lock screen and Control Centre.
    const musicPlayer = () => {
        const m = window.HomerMusicModel;
        return m && m.player ? m : null;
    };
    const nowPlaying = () => {
        const m = musicPlayer();
        if (!m) return null;
        let s;
        try { s = m.player.state(); } catch { return null; }
        const t = s && s.track;
        if (!t) return null;
        let artwork = '';
        try {
            const path = m.art && m.art(t, 600);
            if (path) artwork = new URL(path, location.origin).href;
        } catch { /* no cover */ }
        return {
            type: 'nowplaying',
            title: t.name || '',
            artist: t.artist || '',
            album: t.album || '',
            duration: Number(s.duration) || 0,
            position: Number(s.position) || 0,
            playing: !!s.playing,
            artwork
        };
    };
    if (boot.nowPlaying) {
        let last = '';
        const syncNowPlaying = () => {
            const info = nowPlaying();
            // the position moves on its own; only a real change is worth sending
            const id = info ? [info.title, info.artist, info.playing, Math.round(info.position)].join('|') : '';
            if (id === last) return;
            last = id;
            post(info || { type: 'nowplaying', title: null });
        };
        setInterval(syncNowPlaying, 1000);
        for (const e of ['play', 'playing', 'pause', 'ended', 'loadedmetadata']) {
            document.addEventListener(e, () => setTimeout(syncNowPlaying, 0), true);
        }
    }

    // ---------- What the app calls ----------

    const api = {
        /**
         * A remote button. phase: 'down' (pressed), 'up' (let go) or 'press'
         * (both at once); repeat: an arrow still held down.
         */
        key(key, phase, repeat) {
            const t = deepActive();
            // OK on a text box brings the keyboard back
            if (onTV && key === 'Enter' && isText(t)) {
                if (phase !== 'up') askKeyboard(t);
                return true;
            }
            let handled = false;
            if (phase === 'down' || phase === 'press') {
                handled = fire('keydown', key, repeat);
                if (!handled && onTV && plainPage()) {
                    if (ARROWS.includes(key)) handled = move(key);
                    else if (key === 'Enter' && !repeat && t && t !== document.body && typeof t.click === 'function') {
                        t.click();
                        handled = true;
                    }
                }
            }
            if (phase === 'up' || phase === 'press') fire('keyup', key, false);
            return handled;
        },

        /**
         * A button that isn't a key: HOMER's menu (OK held down) and swiping
         * up or down. HOMER listens for these on the window.
         */
        action(name) {
            const detail = { action: String(name), platform };
            window.dispatchEvent(new CustomEvent('homer-app', { detail }));
            // the name HOMER v0.4.6 and older listen for
            if (onTV) window.dispatchEvent(new CustomEvent('homer-tv', { detail }));
            return true;
        },

        /**
         * The keyboard's answer for request `id`: the text (null when
         * cancelled), and submit when Done was pressed (then Enter follows).
         */
        text(id, value, submit) {
            const t = box;
            if (!t || id !== boxId || !t.isConnected) return false;
            quiet = { el: t, until: Date.now() + 1200 };
            if (value != null && value !== valueOf(t)) setValue(t, String(value));
            if (submit) {
                const handled = fire('keydown', 'Enter', false, t);
                fire('keyup', 'Enter', false, t);
                if (!handled && plainPage()) next(t);
            }
            return true;
        },

        /** A lock-screen or Control Centre button (iOS). */
        remote(action, value) {
            const m = musicPlayer();
            const p = m && m.player;
            if (p) {
                if (action === 'play') p.resume();
                else if (action === 'pause') p.pause();
                else if (action === 'toggle') p.toggle();
                else if (action === 'next') p.next();
                else if (action === 'previous') p.prev();
                else if (action === 'seek' && Number.isFinite(value)) p.seek(Number(value));
                return true;
            }
            // no Music screen: whatever media the page has
            const el = media().find((x) => !x.ended && x.currentSrc);
            if (!el) return false;
            if (action === 'pause') el.pause();
            else if (action === 'play') el.play().catch(() => {});
            else if (action === 'toggle') { if (el.paused) el.play().catch(() => {}); else el.pause(); }
            else if (action === 'seek' && Number.isFinite(value)) el.currentTime = Number(value);
            return true;
        },

        /** Zoom from inside the page (the app asks). */
        cssZoom(value) {
            document.documentElement.style.zoom = Number(value) === 1 ? '' : String(value);
            return true;
        },

        /** What the app saves: HOMER's sign-in and settings. */
        snapshot() {
            return onHomer() ? snapshot() : null;
        }
    };
    Object.defineProperty(window, '__homerApp', { value: Object.freeze(api), configurable: false, writable: false });
    // the name the Apple TV app's older builds use
    Object.defineProperty(window, '__homerTvApp', { value: window.__homerApp, configurable: false, writable: false });
})();
