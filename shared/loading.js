/*
 * HOMER loading: what HOMER puts up while one of its own pages opens.
 *
 * Jellyfin Web routes before HOMER does, and it knows none of HOMER's own
 * pages (#/weather, #/rooms, #/cameras, #/planes, #/sports, #/news, #/books,
 * #/music, #/playing). So it answers every one of them with its own "Page not
 * found", and titles the tab that, for as long as HOMER's files take to
 * arrive: a second or two warm, longer on a cold load, and every single
 * launch in the Apple TV app, where the web view starts empty.
 *
 * This covers that gap with HOMER's own loading state — the mark, the
 * screen's name and a quiet pulse on HOMER's ground — from the moment HOMER
 * loads until the screen is drawn. homer.js claims the page before any of
 * this is fetched (html.homer-booting, which blanks Jellyfin's page); this is
 * what goes over the top of it, and takes both down together.
 *
 * Coming down: as soon as a HOMER screen root is up and visible. It is never
 * left behind — if nothing has drawn after LATE_MS it says so honestly
 * ("Couldn't open Sports") with Try again and Home, and it goes the moment
 * the address leaves HOMER's pages. An address that was never HOMER's is left
 * alone, so Jellyfin's real 404 still answers for it.
 *
 * Moving between HOMER's own pages is usually instant, so there the loading
 * screen waits GRACE_MS before showing itself: a screen that draws straight
 * away never flickers, and one held up (a stylesheet still coming) is covered.
 *
 * The tab title is HOMER's too while one of its pages is up: Jellyfin sets
 * "Page not found" whenever it routes one, so the screen's name is put back.
 *
 * Everything here is self-contained — its own styles, no other HOMER module,
 * no stylesheet to fetch — because it runs before any of the rest has loaded.
 *
 * window.HomerLoading = { show, hide, nameFor, covering, version, destroy }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerLoading && typeof window.HomerLoading.destroy === 'function') {
        window.HomerLoading.destroy();
    }

    // HOMER's own pages: Jellyfin has none of them (shared/player.js's
    // isWeatherHash is the same list) and homer.js claims the same ones.
    const SCREENS = [
        [/^#\/weather(\?|$)/, 'Weather'],
        [/^#\/rooms(\?|$)/, 'Rooms'],
        [/^#\/cameras(\?|$)/, 'Cameras'],
        [/^#\/planes(\?|$)/, 'Planes'],
        [/^#\/sports(\?|$)/, 'Sports'],
        [/^#\/news(\?|$)/, 'News'],
        [/^#\/books(\?|$)/, 'Books'],
        [/^#\/music(\?|$)/, 'Music'],
        [/^#\/playing(\?|$)/, 'Now Playing']
    ];
    const nameFor = (hash) => {
        const h = hash == null ? location.hash : hash;
        for (const [re, name] of SCREENS) if (re.test(h)) return name;
        return null;
    };

    const LATE_MS = 15000; // nothing drew: say so rather than spin forever
    const GRACE_MS = 200; // moving between HOMER's pages: only cover if it's held up
    const TICK_MS = 80;
    const SCREEN_ROOTS = '#hm-root, #hl-root, #cg-root, .homer-screen';
    const HOME = '#/home';

    const signedIn = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return !!(server && server.AccessToken && server.UserId);
        } catch {
            return false;
        }
    };

    // the HOMER screen that's up, if one is drawn and showing (a screen puts
    // its root up hidden while its stylesheet is still coming)
    const visibleRoot = () => {
        for (const el of document.querySelectorAll(SCREEN_ROOTS)) {
            if (el.style.visibility === 'hidden') continue;
            if (!el.getClientRects().length) continue;
            return el;
        }
        return null;
    };

    // ---------- Styles ----------

    const style = document.createElement('style');
    style.id = 'homer-loading-css';
    // Written out rather than taken from shared/tokens.css: this draws before
    // any HOMER stylesheet has loaded, so it can't wait on one. The values are
    // tokens.css's, and the tokens win once they're in.
    style.textContent = `
        #homer-loading {
            position: fixed;
            inset: 0;
            z-index: 100000; /* over everything HOMER draws: the screens (99990),
                                a docked video (99995), the phone's bars (99996),
                                the phone screens and the menu (99997) and the
                                TV guide (99999). While this is up, it is the page. */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: clamp(22px, 4vmin, 52px);
            padding: 24px;
            box-sizing: border-box;
            background: var(--homer-bg0, #02050a);
            background-image: var(--homer-backdrop,
                radial-gradient(1200px 700px at 12% -10%, rgba(47, 140, 255, 0.22), transparent 60%),
                radial-gradient(900px 600px at 100% 0%, rgba(111, 211, 255, 0.10), transparent 55%),
                linear-gradient(180deg, #07142a 0%, #02050a 70%));
            color: var(--homer-text, #f4f7fb);
            font-family: var(--homer-font, "Barlow", "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
            -webkit-font-smoothing: antialiased;
            user-select: none;
            -webkit-user-select: none;
            opacity: 1;
            transition: opacity 160ms ease;
        }

        /* on a phone it sits between HOMER's bars, the way every phone screen
           does (shared/phone.css), so they stay up and usable behind it. On a
           cold load there are no bars yet and it simply fills the window. */
        html.homer-chrome #homer-loading {
            top: var(--homer-phone-top, 52px);
            bottom: var(--homer-phone-tabs, 56px);
        }

        #homer-loading.hlo-going { opacity: 0; pointer-events: none; }

        /* the brand lockup, as the top bars draw it: mark, HOMER, the screen */
        #homer-loading .hlo-brand {
            display: flex;
            align-items: center;
            gap: clamp(12px, 2.2vmin, 28px);
            max-width: 100%;
        }

        #homer-loading .hlo-mark {
            flex: none;
            width: clamp(46px, 9vmin, 104px);
            height: clamp(46px, 9vmin, 104px);
            border-radius: clamp(13px, 2.6vmin, 30px);
            display: grid;
            place-items: center;
            background: linear-gradient(145deg, var(--homer-accent-2, #6fd3ff), var(--homer-accent, #2f8cff) 60%, #1450c8);
            box-shadow: 0 10px 34px rgba(47, 140, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }

        #homer-loading .hlo-mark::before {
            content: "";
            width: 42%;
            height: 31%;
            border: max(2px, 0.42vmin) solid #fff;
            border-radius: max(3px, 0.6vmin);
        }

        #homer-loading .hlo-word {
            font-weight: 800;
            letter-spacing: 0.24em;
            font-size: clamp(23px, 5vmin, 60px);
            line-height: 1;
        }

        #homer-loading .hlo-name {
            padding-left: clamp(12px, 2.2vmin, 28px);
            border-left: max(1.5px, 0.16vmin) solid var(--homer-line-strong, rgba(160, 190, 230, 0.24));
            color: var(--homer-dim, #8ea3bd);
            font-weight: 600;
            letter-spacing: 0.3em;
            font-size: clamp(12px, 2.6vmin, 30px);
            text-transform: uppercase;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* a quiet pulse: a sheen crossing a hairline track, no spinner */
        #homer-loading .hlo-pulse {
            width: clamp(170px, 32vmin, 430px);
            height: max(3px, 0.4vmin);
            border-radius: 99px;
            background: var(--homer-line-strong, rgba(160, 190, 230, 0.24));
            overflow: hidden;
        }

        #homer-loading .hlo-pulse::after {
            content: "";
            display: block;
            width: 40%;
            height: 100%;
            border-radius: 99px;
            background: linear-gradient(90deg, transparent, var(--homer-accent, #2f8cff), var(--homer-accent-2, #6fd3ff), transparent);
            animation: hlo-sweep 1500ms cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }

        @keyframes hlo-sweep {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
        }

        @media (prefers-reduced-motion: reduce) {
            #homer-loading .hlo-pulse::after {
                width: 100%;
                animation: hlo-breathe 2400ms ease-in-out infinite;
            }
            @keyframes hlo-breathe { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.9; } }
        }

        /* ---------- Nothing drew ---------- */

        #homer-loading .hlo-late { display: none; text-align: center; max-width: 34em; }
        #homer-loading.hlo-failed .hlo-pulse { display: none; }
        #homer-loading.hlo-failed .hlo-late { display: block; }

        #homer-loading .hlo-late-head {
            font-weight: 700;
            font-size: clamp(24px, 4.4vmin, 54px);
            line-height: 1.15;
            margin: 0 0 0.35em;
        }

        #homer-loading .hlo-late-sub {
            color: var(--homer-dim, #8ea3bd);
            font-size: clamp(15px, 2.4vmin, 30px);
            line-height: 1.45;
            margin: 0 0 clamp(18px, 2.6vmin, 34px);
        }

        #homer-loading .hlo-btns {
            display: flex;
            flex-wrap: wrap;
            gap: clamp(10px, 1.4vmin, 18px);
            justify-content: center;
        }

        #homer-loading .hlo-btn {
            appearance: none;
            -webkit-appearance: none;
            border: 1px solid var(--homer-line-strong, rgba(160, 190, 230, 0.24));
            background: var(--homer-cell, rgba(20, 36, 60, 0.78));
            color: inherit;
            font: inherit;
            font-weight: 700;
            letter-spacing: 0.06em;
            font-size: clamp(15px, 2.2vmin, 28px);
            min-height: 44px;
            padding: clamp(0px, 1.2vmin, 14px) clamp(20px, 3vmin, 40px);
            border-radius: var(--homer-radius-sm, 10px);
            cursor: pointer;
        }

        #homer-loading .hlo-btn:focus-visible,
        #homer-loading .hlo-btn:hover {
            outline: none;
            border-color: transparent;
            background: var(--homer-focus-fill, linear-gradient(180deg, #3a95ff, #1c64d8));
            box-shadow: var(--homer-focus-ring, 0 0 0 3px #fff, 0 10px 30px rgba(47, 140, 255, 0.55));
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // ---------- The screen ----------

    let el = null;
    const build = () => {
        el = document.createElement('div');
        el.id = 'homer-loading';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-busy', 'true');
        el.innerHTML = `
            <div class="hlo-brand"><span class="hlo-mark" aria-hidden="true"></span><span class="hlo-word">HOMER</span><span class="hlo-name"></span></div>
            <div class="hlo-pulse" aria-hidden="true"></div>
            <div class="hlo-late">
                <p class="hlo-late-head"></p>
                <p class="hlo-late-sub">HOMER didn't finish loading this screen.</p>
                <div class="hlo-btns">
                    <button type="button" class="hlo-btn" data-hlo="retry">Try again</button>
                    <button type="button" class="hlo-btn" data-hlo="home">Home</button>
                </div>
            </div>`;
        el.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-hlo]');
            if (!b) return;
            if (b.dataset.hlo === 'retry') location.reload();
            else goHome();
        });
        return el;
    };

    const goHome = () => {
        hide();
        const p = window.HomerPlayer;
        if (p && typeof p.goHome === 'function') p.goHome();
        else location.hash = HOME;
    };

    const mount = () => {
        if (!el) build();
        const parent = document.body || document.documentElement;
        if (el.parentNode !== parent) parent.appendChild(el);
    };

    // The Apple TV app zooms Jellyfin's own pages (apple/…/homer-app.js sets
    // zoom on <html> while no HOMER screen is up) and this goes up before one
    // is, so take the zoom back off for the loading screen: it's HOMER's, and
    // it sizes itself to the screen already.
    let zoomIs = '';
    const syncZoom = () => {
        if (!el) return;
        const z = parseFloat(document.documentElement.style.zoom) || 1;
        const want = z === 1 ? '' : String(1 / z);
        if (want === zoomIs) return;
        zoomIs = want;
        el.style.zoom = want;
    };

    // ---------- Showing and hiding ----------

    // covering: { name, at, was, failed } while the loading screen is up.
    // pending: the same, waiting out GRACE_MS before it shows itself.
    let covering = null;
    let pending = null;
    let going = null; // the fade-out timer

    const paint = () => {
        if (!el || !covering) return;
        el.querySelector('.hlo-name').textContent = covering.name;
        el.querySelector('.hlo-late-head').textContent = `Couldn't open ${covering.name}`;
        el.classList.toggle('hlo-failed', !!covering.failed);
        el.setAttribute('aria-busy', covering.failed ? 'false' : 'true');
    };

    // Jellyfin titles an address it doesn't know "Page not found", and it
    // routes every one of HOMER's own pages. Put the screen's name back.
    const syncTitle = () => {
        const name = nameFor();
        if (name && document.title !== name) document.title = name;
    };

    const show = (name, { delay = 0 } = {}) => {
        const screen = name || nameFor();
        if (!screen) return;
        if (covering) {
            if (covering.name !== screen) {
                covering.name = screen;
                covering.at = Date.now();
                covering.failed = false;
                paint();
            }
            return;
        }
        const next = { name: screen, at: Date.now(), was: visibleRoot(), failed: false };
        if (delay > 0) { pending = next; return; }
        pending = null;
        covering = next;
        clearTimeout(going);
        going = null;
        document.documentElement.classList.add('homer-booting');
        mount();
        el.classList.remove('hlo-going');
        paint();
        syncZoom();
        syncTitle();
    };

    const hide = () => {
        pending = null;
        if (!covering) return;
        covering = null;
        document.documentElement.classList.remove('homer-booting');
        if (!el) return;
        el.classList.add('hlo-going');
        clearTimeout(going);
        going = setTimeout(() => { if (!covering && el) el.remove(); }, 260);
    };

    // Let the screen paint a frame before uncovering, so there's no blank
    // between the two. (Two frames, with a timer behind them: rAF never fires
    // in a background tab.)
    let settling = false;
    const settle = () => {
        if (settling) return;
        settling = true;
        const done = () => { settling = false; hide(); };
        let ran = false;
        const once = () => { if (ran) return; ran = true; done(); };
        requestAnimationFrame(() => requestAnimationFrame(once));
        setTimeout(once, 120);
    };

    const fail = () => {
        if (!covering || covering.failed) return;
        covering.failed = true;
        paint();
        const btn = el && el.querySelector('[data-hlo="retry"]');
        if (btn) try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
    };

    // ---------- Watching ----------

    const tick = () => {
        syncTitle();
        const name = nameFor();

        if (pending) {
            const root = visibleRoot();
            if (!name || (root && root !== pending.was)) pending = null; // drew, or left
            else if (Date.now() - pending.at >= GRACE_MS) show(pending.name);
        }

        if (!covering) {
            // homer.js blanked Jellyfin's page before any of this was fetched.
            // Nothing is covering it now — signed out, or an address that isn't
            // HOMER's — so give it back rather than leave the page dark.
            if (started) document.documentElement.classList.remove('homer-booting');
            return;
        }
        if (!name) { hide(); return; } // the address left HOMER's pages
        if (name !== covering.name) show(name);
        const root = visibleRoot();
        // a screen that wasn't there when this went up is the one being waited for
        if (root && root !== covering.was) { settle(); return; }
        if (!covering.failed && Date.now() - covering.at > LATE_MS) fail();
        mount();
        syncZoom();
    };

    const onRoute = () => {
        const name = nameFor();
        if (!name) { hide(); return; }
        if (!signedIn()) return; // Jellyfin's sign-in comes first
        // On the way in from anywhere else, wait out GRACE_MS: moving between
        // HOMER's own screens is usually instant and shouldn't flicker.
        show(name, { delay: covering ? 0 : GRACE_MS });
    };

    // A key on the failure screen: the Apple TV's remote and a keyboard both
    // need to reach the two buttons. This listens on window in the capture
    // phase, the way every HOMER screen does, and loads before all of them, so
    // it is first in line — a screen still up underneath never sees the key.
    // The Apple apps dispatch a real key event and only fall back to their own
    // focus moving when nothing called preventDefault, so they defer to this.
    const onKey = (ev) => {
        if (!covering || !covering.failed || !el) return;
        const btns = [...el.querySelectorAll('.hlo-btn')];
        const at = btns.indexOf(document.activeElement);
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
            const next = btns[(Math.max(at, 0) + (ev.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
            next && next.focus();
        } else if (ev.key === 'Escape' || ev.key === 'Backspace' || ev.key === 'GoBack' || ev.key === 'BrowserBack') {
            goHome();
        } else if ((ev.key === 'Enter' || ev.key === ' ') && at >= 0) {
            btns[at].click();
        } else return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
    };

    const timer = setInterval(tick, TICK_MS);
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('popstate', onRoute);
    window.addEventListener('keydown', onKey, true);

    // The first time through: HOMER has just loaded, so cover now, without the
    // grace — this is the load homer.js already claimed the page for.
    // started: until this has run, homer.js's claim stands on its own and tick
    // must not take it down (the first tick can beat DOMContentLoaded).
    let started = false;
    const start = () => {
        started = true;
        if (nameFor() && signedIn()) show(nameFor());
        tick();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerLoading = {
        version: VERSION,
        nameFor,
        show,
        hide,
        covering: () => (covering ? { name: covering.name, failed: !!covering.failed, since: covering.at } : null),
        destroy() {
            clearInterval(timer);
            clearTimeout(going);
            window.removeEventListener('hashchange', onRoute);
            window.removeEventListener('popstate', onRoute);
            window.removeEventListener('keydown', onKey, true);
            document.removeEventListener('DOMContentLoaded', start);
            covering = null;
            pending = null;
            document.documentElement.classList.remove('homer-booting');
            el && el.remove();
            el = null;
            style.remove();
        }
    };
})();
