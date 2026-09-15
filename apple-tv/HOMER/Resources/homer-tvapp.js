/*
 * HOMER's Apple TV app, the page side. The app injects this at document start
 * in the main frame, just after a line that sets window.__homerTvAppBoot to
 * { origin, saved }: HOMER's origin and the sign-in the app saved last time.
 *
 * - window.HOMER_TVAPP = true: HOMER keeps its TV layout and hides the cursor
 *   (shared/layout.js).
 * - Jellyfin and HOMER see a desktop: Jellyfin treats navigator.maxTouchPoints
 *   > 1 on a Mac user agent as an iPad, and both read (hover: none) as touch.
 * - Puts the saved sign-in back into localStorage before Jellyfin reads it,
 *   and tells the app whenever it changes (tvOS can purge the web view's
 *   storage; the app keeps a copy in the Keychain).
 * - The remote's buttons arrive as key events: window.__homerTvApp.key().
 * - The three that aren't keys (OK held down, and swiping up or down) arrive
 *   as window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action } }))
 *   with action 'menu', 'swipe-up' or 'swipe-down', for HOMER's letter
 *   shortcuts, which a remote can't type.
 * - Jellyfin's own pages (its sign-in, its dashboard) are zoomed, since
 *   they're built for a desk; HOMER's screens size themselves and stay at 1.
 * - A text box getting focus asks the app for the tvOS keyboard; the app
 *   hands the text back with window.__homerTvApp.text().
 * - Tells the app when video or audio is playing (the screensaver waits).
 * - Where no HOMER screen is up (Jellyfin's sign-in page), arrows move focus
 *   and OK clicks, since Jellyfin's desktop layout ignores arrows.
 */
(() => {
    'use strict';
    if (window.__homerTvApp) return;

    const boot = window.__homerTvAppBoot || {};
    try { delete window.__homerTvAppBoot; } catch { window.__homerTvAppBoot = undefined; }

    window.HOMER_TVAPP = true;

    const post = (msg) => {
        try { window.webkit.messageHandlers.homer.postMessage(msg); } catch { /* not in the app */ }
    };
    const onHomer = () => !!boot.origin && location.origin === boot.origin;

    // ---------- Report page errors to Xcode's console ----------

    window.addEventListener('error', (ev) => post({ type: 'log', text: `${ev.message} (${ev.filename}:${ev.lineno})` }));
    window.addEventListener('unhandledrejection', (ev) => post({ type: 'log', text: 'Unhandled rejection: ' + String(ev.reason) }));

    // ---------- A desktop, not a TV or an iPad ----------

    try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, configurable: true }); } catch { /* keep it */ }
    for (let o = window; o; o = Object.getPrototypeOf(o)) {
        try { if (Object.prototype.hasOwnProperty.call(o, 'ontouchstart')) delete o.ontouchstart; } catch { /* keep it */ }
    }
    // tvOS's web view matches (hover: none), which HOMER (before its tvapp
    // flag, v0.4.1 and older) and Jellyfin read as a touch screen. The remote
    // drives it like a keyboard, so pointer queries answer as a desktop's do.
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

    // ---------- No cursor; a focus ring where the app moves focus ----------

    const style = document.createElement('style');
    style.id = 'homer-tvapp-style';
    style.textContent = `
        html, html * { cursor: none !important; -webkit-tap-highlight-color: transparent; }
        [data-homer-tvapp-nav]:focus { outline: 4px solid #2f8cff !important; outline-offset: 3px !important; }
    `;
    (document.head || document.documentElement).appendChild(style);

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

    // ---------- Keys ----------

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

    document.addEventListener('focusin', (ev) => {
        const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!isText(t)) return;
        if (quiet.el === t && Date.now() < quiet.until) return;
        // a page that focuses a box and blurs it at once isn't asking
        setTimeout(() => {
            if (deepActive() === t && shown(t) && !(quiet.el === t && Date.now() < quiet.until)) askKeyboard(t);
        }, 150);
    }, true);

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

    // Arrows move focus and OK clicks there, and they're zoomed. HOMER's own
    // screens (and Jellyfin's full-screen player, which fills the TV by
    // itself) keep their own size and their own keys.
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

    // ---------- Zoom on Jellyfin's own pages ----------

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
    window.addEventListener('hashchange', syncZoom);
    window.addEventListener('popstate', syncZoom);
    if (document.body) watchZoom();
    else document.addEventListener('DOMContentLoaded', watchZoom, { once: true });

    // ---------- Media: keep the screensaver away while something plays ----------

    let playing = null;
    const syncMedia = () => {
        const now = [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended);
        if (now === playing) return;
        playing = now;
        post({ type: 'media', playing: now });
    };
    for (const e of ['play', 'playing', 'pause', 'ended', 'emptied']) {
        document.addEventListener(e, () => setTimeout(syncMedia, 0), true);
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
            if (key === 'Enter' && isText(t)) {
                if (phase !== 'up') askKeyboard(t);
                return true;
            }
            let handled = false;
            if (phase === 'down' || phase === 'press') {
                handled = fire('keydown', key, repeat);
                if (!handled && plainPage()) {
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

        /**
         * A button that isn't a key: HOMER's menu (OK held down) and swiping
         * up or down. HOMER listens for these on the window.
         */
        action(name) {
            window.dispatchEvent(new CustomEvent('homer-tv', { detail: { action: String(name) } }));
            return true;
        },

        /** Zoom from inside the page, when the app's own can't. */
        cssZoom(value) {
            document.documentElement.style.zoom = Number(value) === 1 ? '' : String(value);
            return true;
        },

        /** What the app saves: HOMER's sign-in and settings. */
        snapshot() {
            return onHomer() ? snapshot() : null;
        }
    };
    Object.defineProperty(window, '__homerTvApp', { value: Object.freeze(api), configurable: false, writable: false });
})();
