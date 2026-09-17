/*
 * HOMER layout: which layout a screen draws (TV or phone), and touch.
 *
 * Phone layout when the window's shortest side is under 600px, in either
 * orientation. Touch behavior when the device can't hover, on either layout
 * (so a tablet keeps the TV layout, with touch). Both come from CSS media
 * queries, never the browser's name, and are checked again whenever they
 * change (rotating, resizing). <html> carries homer-phone and homer-touch.
 *
 * A screen with a phone layout registers it once, register('guide', { phone:
 * true }), and asks usePhone('guide') when it draws; onChange() tells it to
 * draw again (from the same state) when the answer flips. A screen that
 * hasn't been given a phone layout yet keeps its TV layout on a phone, shrunk
 * to fit between the phone's top bar and tab bar: its fit() asks stageBox()
 * how much room there is.
 *
 * HOMER's Apple apps (apple/) set window.HOMER_APP = { platform, version }
 * before the page loads, and the platform decides, whatever the web view
 * reports:
 *   tvos    the TV layout, no touch, and <html> carries homer-tvapp (no
 *           mouse cursor: shell.css)
 *   ipados  the TV layout, with touch
 *   ios     nothing forced: the phone layouts, as in any phone browser
 * window.HOMER_TVAPP, the app's older flag, still means tvos.
 *
 * On a phone every HOMER screen gets the phone chrome: a top bar (HOMER, the
 * screen's name, the weather, Search) and a tab bar (Home, Guide, Movies,
 * Shows, Recordings). Navigation still goes through HomerPlayer, so a video
 * playing in a preview window keeps playing.
 *
 * The top bar's two halves do two different things:
 *   the HOMER mark   opens the menu sheet (shared/menu.js): every screen
 *                    there is, in one list, since the tab bar only has five
 *   the screen name  goes back to the top of the screen you're on — Music's
 *                    browse page from an album, Cameras' wall from one
 *                    camera, the library's grid from a show's page
 *
 * A screen says what its top is while it's mounted:
 *
 *   const off = HomerLayout.setScreenHome(() => {
 *       if (!sheetOpen) return false;   // already at the top: not mine
 *       closeSheets();
 *       return true;                    // handled
 *   }, { atTop: () => !sheetOpen });    // optional: hides the ‹ when there's
 *   // …and off() in teardown()            nowhere to go
 *
 * Nothing registered, or a registration that returns false, falls through to
 * the defaults, which need no cooperation from the screen: the same route
 * with its query stripped (#/music?album=… → #/music), then the tab a
 * details page belongs to (#/details?id=… → the Movies or TV Shows grid),
 * then a rebuild of the screen's own module, which lands it at its top. At
 * the top of a flat screen it does nothing, and the ‹ isn't drawn.
 *
 * window.HomerLayout = { platform, isPhone, isTouch, onChange, register, usePhone,
 *                        stageBox, chromeShown, force, setScreenHome,
 *                        screenHome, canScreenHome, destroy, version }
 */
(() => {
    const VERSION = '0.3.0';

    if (window.HomerLayout && typeof window.HomerLayout.destroy === 'function') {
        window.HomerLayout.destroy();
    }

    const PHONE_QUERY = '(max-width: 599.98px), (max-height: 599.98px)';
    const TOUCH_QUERY = '(hover: none)';
    const HOME = '#/home';
    const GUIDE = '#/livetv?tab=1';
    const RECORDINGS = '#/livetv?tab=3';

    const mq = (q) => (window.matchMedia ? window.matchMedia(q) : null);
    const phoneMq = mq(PHONE_QUERY);
    const touchMq = mq(TOUCH_QUERY);
    // force({ phone, touch }): for testing (an iframe can't be a phone that
    // can't hover); null goes back to the media query
    let forced = { phone: null, touch: null };
    // which of HOMER's Apple apps this is, if any
    const platform = () => {
        const app = window.HOMER_APP;
        if (app && app.platform) return app.platform;
        return window.HOMER_TVAPP === true ? 'tvos' : null; // the app's older flag
    };
    const tvApp = () => platform() === 'tvos';
    // an Apple TV and an iPad both draw the TV layout; only the Apple TV has
    // no touch (its remote sends keys)
    const bigScreen = () => tvApp() || platform() === 'ipados';
    const isPhone = () => (bigScreen() ? false : forced.phone != null ? forced.phone : !!(phoneMq && phoneMq.matches));
    const isTouch = () => {
        if (tvApp()) return false;
        if (platform() === 'ipados') return true;
        return forced.touch != null ? forced.touch : !!(touchMq && touchMq.matches);
    };

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
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* token only */ }
        parts.push(`Token="${server.AccessToken}"`);
        return 'MediaBrowser ' + parts.join(', ');
    };
    const api = async (path) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, { headers: { Authorization: authHeader(server) } });
        if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };

    // ---------- Screens ----------

    // A screen registers its phone layout when that code has loaded; on a
    // phone, that's a change of layout for it (onChange hears it).
    const screens = new Map(); // name -> { phone: bool }
    const register = (name, opts = {}) => {
        const had = !!(screens.get(name) || {}).phone;
        screens.set(name, { phone: !!opts.phone });
        if (had !== !!opts.phone && isPhone()) notify({ phone: true, touch: isTouch(), screen: name });
    };
    const usePhone = (name) => isPhone() && !!(screens.get(name) || {}).phone;

    // ---------- Change events ----------

    const listeners = new Set();
    const notify = (what) => listeners.forEach((fn) => {
        try { fn(what); } catch (err) { console.error('[HOMER Layout]', err); }
    });
    let last = { phone: null, touch: null };
    const sync = () => {
        const now = { phone: isPhone(), touch: isTouch() };
        const html = document.documentElement;
        html.classList.toggle('homer-phone', now.phone);
        html.classList.toggle('homer-touch', now.touch);
        html.classList.toggle('homer-tvapp', tvApp());
        if (now.phone) ensureViewportFit();
        const changed = now.phone !== last.phone || now.touch !== last.touch;
        const first = last.phone === null;
        last = now;
        syncChrome();
        if (!changed || first) return;
        notify(now);
    };
    const onChange = (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    };
    const force = (f = {}) => {
        forced = { phone: f.phone != null ? !!f.phone : null, touch: f.touch != null ? !!f.touch : null };
        sync();
        window.dispatchEvent(new Event('resize'));
        return { phone: isPhone(), touch: isTouch() };
    };

    // The page runs edge to edge on a phone (under the status bar and the home
    // indicator), with the safe-area insets keeping HOMER's own bars clear of
    // them. Jellyfin's viewport tag already asks for that; if it ever
    // doesn't, ask for it here, on phones only.
    const ensureViewportFit = () => {
        const m = document.querySelector('meta[name="viewport"]');
        if (m && !/viewport-fit\s*=\s*cover/.test(m.content || '')) m.content = (m.content ? m.content + ',' : '') + 'viewport-fit=cover';
    };

    // ---------- Phone chrome ----------

    const P = () => window.HomerPlayer || null;
    const route = () => (P() ? P().route() : location.hash) || HOME;
    const go = (hash) => {
        if (P()) P().go(hash);
        else location.hash = hash;
    };
    const goHome = () => {
        if (P()) P().goHome();
        else location.hash = HOME;
    };
    // The HOMER mark's tap: the menu sheet, or Home when menu.js isn't loaded.
    const M = () => (window.HomerMenu && typeof window.HomerMenu.toggleSheet === 'function' ? window.HomerMenu : null);
    const openMenu = () => {
        const m = M();
        if (m) m.toggleSheet();
        else goHome();
        syncChrome();
    };

    // ---------- The top of the screen you're on ----------
    //
    // The top bar's screen name is a button back to the top of that screen.
    // A screen registers what that means while it's mounted; the defaults
    // below cover the ones that don't.

    const screenHomes = [];
    const setScreenHome = (fn, opts = {}) => {
        if (typeof fn !== 'function') return () => {};
        const entry = { fn, atTop: typeof opts.atTop === 'function' ? opts.atTop : null };
        screenHomes.push(entry);
        queue();
        return () => {
            const i = screenHomes.indexOf(entry);
            if (i >= 0) screenHomes.splice(i, 1);
            queue();
        };
    };
    // the screen in front: the last one still registered
    const topScreenHome = () => screenHomes[screenHomes.length - 1] || null;

    // HOMER's own single-route screens: everything after the '?' is a way in
    // (#/music?album=…, #/rooms?remote=…, #/books?id=…), so dropping it is
    // the top of that screen. Jellyfin's own routes carry what they need in
    // the query (#/movies?topParentId=…), so they're not in here.
    const OWN_SCREEN = /^#!?\/(weather|rooms|cameras|sports|news|books|music|playing)(\?|$)/i;
    // The last resort, for a screen that keeps its sub-views to itself (they're
    // in no route, so there's nothing to strip) and hasn't registered a
    // setScreenHome: rebuild its module, which opens it at its top. It costs a
    // reload of that screen and it can't tell whether you're already at the
    // top, so a registration is always better — this is only here so a screen
    // works before it has one. Books, Cameras and Rooms register and never
    // reach it; flat screens (Weather, Now Playing, Home) have no sub-views,
    // so they're not in here and their name stays a plain label.
    const SCREEN_MODULES = [
        [/^#!?\/music(\?|$)/i, 'HomerMusic']
    ];
    const moduleFor = (h) => {
        const hit = SCREEN_MODULES.find(([re]) => re.test(h));
        const mod = hit && window[hit[1]];
        return mod && typeof mod.close === 'function' && typeof mod.open === 'function' ? mod : null;
    };
    // a details page belongs to the library grid it came from
    const tabHome = () => {
        const where = whereAmI();
        const h = route();
        if (where.tab === 'movies' && !/^#!?\/movies(\.html)?\?/i.test(h)) return () => goLibrary('movies');
        if (where.tab === 'shows' && !/^#!?\/tv(\.html)?\?/i.test(h)) return () => goLibrary('tvshows');
        return null;
    };

    // canScreenHome(): is there anywhere above where we are? (what draws the ‹)
    const canScreenHome = () => {
        if (!screenUp()) return false;
        const top = topScreenHome();
        if (top && top.atTop) return !top.atTop();
        if (top) return true; // it hasn't said; assume it can
        const h = route();
        if (OWN_SCREEN.test(h)) return h.includes('?') || !!moduleFor(h);
        return !!tabHome();
    };

    // screenHome(): go there
    const screenHome = () => {
        for (let i = screenHomes.length - 1; i >= 0; i--) {
            const e = screenHomes[i];
            let handled = false;
            try { handled = !!e.fn(); } catch (err) { console.error('[HOMER Layout]', err); }
            if (handled) { queue(); return true; }
        }
        const h = route();
        // the same screen without its way in
        if (OWN_SCREEN.test(h) && h.includes('?')) { go(h.split('?')[0]); return true; }
        // a show's or movie's page: the grid it belongs to
        const tab = tabHome();
        if (tab) { tab(); return true; }
        // nothing said otherwise: rebuild the screen, which opens it at its top
        const mod = moduleFor(h);
        if (mod) {
            try {
                mod.close();
                setTimeout(() => { try { mod.open(); } catch (err) { console.error('[HOMER Layout]', err); } }, 0);
                return true;
            } catch (err) { console.error('[HOMER Layout]', err); }
        }
        return false; // already at the top of a flat screen
    };

    // the library views, for the Movies and Shows tabs (fetched once)
    let viewsP = null;
    const views = () => {
        if (!viewsP) {
            const server = getServer();
            viewsP = server
                ? api(`/Users/${server.UserId}/Views`).then((r) => (r && r.Items) || []).catch(() => { viewsP = null; return []; })
                : Promise.resolve([]);
        }
        return viewsP;
    };
    const goLibrary = async (type) => {
        const v = (await views()).find((x) => x.CollectionType === type);
        if (!v) return;
        go(type === 'movies'
            ? `#/movies?topParentId=${v.Id}&collectionType=movies`
            : `#/tv?topParentId=${v.Id}&collectionType=tvshows`);
    };
    // the guide takes over its route (Jellyfin's Live TV → Guide tab)
    const goGuide = () => {
        if (document.getElementById('cg-root')) return;
        go(GUIDE);
    };

    const TABS = [
        { key: 'home', icon: 'home', label: 'Home', act: goHome },
        { key: 'guide', icon: 'live_tv', label: 'Guide', act: goGuide },
        { key: 'movies', icon: 'movie', label: 'Movies', act: () => goLibrary('movies') },
        { key: 'shows', icon: 'tv', label: 'Shows', act: () => goLibrary('tvshows') },
        { key: 'recordings', icon: 'fiber_smart_record', label: 'Recordings', act: () => go(RECORDINGS) }
    ];

    // which screen is up: its tab (if it has one) and its name for the top bar
    const whereAmI = () => {
        if (document.getElementById('cg-root')) return { tab: 'guide', name: 'Guide' };
        const h = route();
        if (/^#\/livetv(\.html)?\?(.*&)?tab=3(&|$)/.test(h)) return { tab: 'recordings', name: 'Recordings' };
        if (/^#\/movies(\.html)?\?/.test(h)) return { tab: 'movies', name: 'Movies' };
        if (/^#\/tv(\.html)?\?/.test(h)) return { tab: 'shows', name: 'Shows' };
        if (/^#\/details(\.html)?\?/.test(h)) {
            // a show's or movie's page: the library screen says which
            const sub = document.querySelector('#hl-root .hl-brand-sub');
            const tv = sub && /tv|show/i.test(sub.textContent || '');
            return { tab: tv ? 'shows' : 'movies', name: tv ? 'Shows' : 'Movies' };
        }
        if (/^#\/search(\.html)?(\?|$)/.test(h)) return { tab: null, name: 'Search' };
        if (/^#\/mypreferencesmenu(\.html)?(\?|$)/.test(h)) return { tab: null, name: 'Settings' };
        if (/^#\/weather(\?|$)/.test(h)) return { tab: null, name: 'Weather' };
        if (/^#\/rooms(\?|$)/.test(h)) return { tab: null, name: 'Rooms' };
        if (/^#\/cameras(\?|$)/.test(h)) return { tab: null, name: 'Cameras' };
        if (/^#\/sports(\?|$)/.test(h)) return { tab: null, name: 'Sports' };
        if (/^#\/news(\?|$)/.test(h)) return { tab: null, name: 'News' };
        if (/^#\/books(\?|$)/.test(h)) return { tab: null, name: 'Books' };
        if (/^#\/music(\?|$)/.test(h)) return { tab: null, name: 'Music' };
        if (/^#\/playing(\?|$)/.test(h)) return { tab: null, name: 'Now Playing' };
        return { tab: 'home', name: 'Home' };
    };

    const SCREEN_ROOTS = '#hm-root, #hl-root, #cg-root, .homer-screen';
    const isVideoRoute = () => /^#\/video/.test(location.hash);
    // a HOMER screen is up (not Jellyfin's full-screen player, sign-in or dashboard)
    const screenUp = () => !!getServer() && !!document.querySelector(SCREEN_ROOTS)
        && !(isVideoRoute() && !(P() && P().docked()) && !document.getElementById('cg-root'));

    let top = null;
    let tabs = null;
    let wxDetach = () => {};
    let shown = false;
    const build = () => {
        top = document.createElement('div');
        top.id = 'homer-phone-top';
        top.innerHTML = `
            <div class="hp-brand" role="button" tabindex="0" aria-label="Menu" aria-haspopup="dialog" aria-expanded="false"><span class="hp-mark"></span>HOMER<span class="material-icons hp-brand-caret" aria-hidden="true">expand_more</span></div>
            <button type="button" class="hp-here" hidden><span class="material-icons hp-here-back" aria-hidden="true">chevron_left</span><span class="hp-sub"></span></button>
            <span class="hp-spacer"></span>
            <div class="hp-wx"><div class="hp-clock"></div></div>
            <button type="button" class="hp-icon hp-search" aria-label="Search"><span class="material-icons" aria-hidden="true">search</span></button>`;
        tabs = document.createElement('nav');
        tabs.id = 'homer-phone-tabs';
        tabs.setAttribute('aria-label', 'HOMER');
        tabs.innerHTML = TABS.map((t) => `<button type="button" class="hp-tab" data-tab="${t.key}"><span class="material-icons" aria-hidden="true">${t.icon}</span><span class="hp-tab-label">${t.label}</span></button>`).join('');
        document.body.appendChild(top);
        document.body.appendChild(tabs);
        // The mark opens the menu sheet (shared/menu.js): every screen in one
        // list, Home first. Without menu.js it does what it always did and
        // goes Home.
        top.querySelector('.hp-brand').addEventListener('click', openMenu);
        top.querySelector('.hp-brand').addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openMenu(); }
        });
        // the screen's name goes back to the top of that screen
        top.querySelector('.hp-here').addEventListener('click', () => {
            const m = M();
            if (m && m.isSheetOpen()) m.closeSheet(); // the sheet is over it
            if (!canScreenHome()) return; // already at the top of this screen
            screenHome();
            syncHere();
        });
        top.querySelector('.hp-search').addEventListener('click', () => {
            // the phone search takes the tap when it can: back to its box if
            // it's up, else the keyboard starts coming up (inside the tap, as
            // an iPhone wants) while it opens
            const s = window.HomerSearch;
            if (s && typeof s.phoneTap === 'function' && s.phoneTap()) return;
            go('#/search');
        });
        tabs.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hp-tab');
            const t = b && TABS.find((x) => x.key === b.dataset.tab);
            if (t) t.act();
        });
        // the weather bug opens the Weather screen by itself
        if (window.HomerWeather) wxDetach = window.HomerWeather.attach(top.querySelector('.hp-clock'));
    };

    // The name is drawn as a button only while there's somewhere above to go.
    // Opening a sub-view inside a screen changes no route and adds nothing to
    // <body>, so nothing tells the chrome it happened: this one boolean is
    // checked on a slow timer instead (it's a class toggle, nothing more).
    let hereName = '';
    const syncHere = (name) => {
        if (!top) return;
        const here = top.querySelector('.hp-here');
        if (!here || here.hidden) return;
        if (name) hereName = name;
        const can = canScreenHome();
        if (here.classList.contains('can') === can) return;
        here.classList.toggle('can', can);
        here.setAttribute('aria-label', can ? `Back to ${hereName}` : hereName);
    };

    const syncChrome = () => {
        const want = isPhone() && screenUp();
        if (want && !top && document.body) build();
        if (top) {
            const where = want ? whereAmI() : null;
            if (where) {
                top.querySelector('.hp-sub').textContent = where.name;
                tabs.querySelectorAll('.hp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === where.tab));
                top.querySelector('.hp-here').hidden = false;
                syncHere(where.name);
            }
            const m = M();
            top.querySelector('.hp-brand').setAttribute('aria-expanded', String(!!(m && m.isSheetOpen())));
        }
        document.documentElement.classList.toggle('homer-chrome', want);
        if (want !== shown) {
            shown = want;
            // screens re-fit their stage to the room between the bars
            window.dispatchEvent(new Event('resize'));
        }
    };

    // The room a TV-layout stage has: the window, less the phone's bars when
    // they're up.
    const stageBox = () => {
        if (shown && top && tabs) {
            const t = top.getBoundingClientRect().bottom;
            const b = tabs.getBoundingClientRect().top;
            if (b - t > 50) return { width: window.innerWidth, height: b - t };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    };

    let queued = false;
    const queue = () => {
        if (queued) return;
        queued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            queued = false;
            syncChrome();
        }, 30);
    };

    let hereTimer = 0;
    const onMq = () => sync();
    if (phoneMq && phoneMq.addEventListener) phoneMq.addEventListener('change', onMq);
    if (touchMq && touchMq.addEventListener) touchMq.addEventListener('change', onMq);
    window.addEventListener('hashchange', queue);
    window.addEventListener('popstate', queue);
    let observer = null;
    let offPlayer = null;
    const hookPlayer = () => {
        if (offPlayer || !P()) return;
        offPlayer = P().onChange(queue);
    };
    const start = () => {
        hookPlayer();
        // screens put their roots straight on <body>
        observer = new MutationObserver(() => { hookPlayer(); queue(); });
        observer.observe(document.body, { childList: true });
        hereTimer = setInterval(() => { if (shown && !document.hidden) syncHere(); }, 500);
        sync();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerLayout = {
        version: VERSION,
        platform,
        isPhone,
        isTouch,
        onChange,
        register,
        usePhone,
        stageBox,
        chromeShown: () => shown,
        force,
        // a screen says what the top bar's name goes back to, while it's up
        setScreenHome,
        screenHome,
        canScreenHome,
        destroy() {
            screenHomes.length = 0;
            clearInterval(hereTimer);
            if (M()) M().closeSheet();
            if (phoneMq && phoneMq.removeEventListener) phoneMq.removeEventListener('change', onMq);
            if (touchMq && touchMq.removeEventListener) touchMq.removeEventListener('change', onMq);
            window.removeEventListener('hashchange', queue);
            window.removeEventListener('popstate', queue);
            document.removeEventListener('DOMContentLoaded', start);
            observer && observer.disconnect();
            if (offPlayer) offPlayer();
            wxDetach();
            top && top.remove();
            tabs && tabs.remove();
            document.documentElement.classList.remove('homer-phone', 'homer-touch', 'homer-chrome', 'homer-tvapp');
            listeners.clear();
        }
    };
})();
