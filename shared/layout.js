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
 * On a phone every HOMER screen gets the phone chrome: a top bar (HOMER, the
 * screen's name, the weather, Search) and a tab bar (Home, Guide, Movies,
 * Shows, Recordings). Navigation still goes through HomerPlayer, so a video
 * playing in a preview window keeps playing.
 *
 * window.HomerLayout = { isPhone, isTouch, onChange, register, usePhone,
 *                        stageBox, chromeShown, force, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

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
    const isPhone = () => (forced.phone != null ? forced.phone : !!(phoneMq && phoneMq.matches));
    const isTouch = () => (forced.touch != null ? forced.touch : !!(touchMq && touchMq.matches));

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
        if (/^#\/sports(\?|$)/.test(h)) return { tab: null, name: 'Sports' };
        if (/^#\/news(\?|$)/.test(h)) return { tab: null, name: 'News' };
        if (/^#\/books(\?|$)/.test(h)) return { tab: null, name: 'Books' };
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
            <div class="hp-brand" role="button" aria-label="Home"><span class="hp-mark"></span>HOMER<span class="hp-sub"></span></div>
            <span class="hp-spacer"></span>
            <div class="hp-wx"><div class="hp-clock"></div></div>
            <button type="button" class="hp-icon hp-search" aria-label="Search"><span class="material-icons" aria-hidden="true">search</span></button>`;
        tabs = document.createElement('nav');
        tabs.id = 'homer-phone-tabs';
        tabs.setAttribute('aria-label', 'HOMER');
        tabs.innerHTML = TABS.map((t) => `<button type="button" class="hp-tab" data-tab="${t.key}"><span class="material-icons" aria-hidden="true">${t.icon}</span><span class="hp-tab-label">${t.label}</span></button>`).join('');
        document.body.appendChild(top);
        document.body.appendChild(tabs);
        top.querySelector('.hp-brand').addEventListener('click', goHome);
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

    const syncChrome = () => {
        const want = isPhone() && screenUp();
        if (want && !top && document.body) build();
        if (top) {
            const where = want ? whereAmI() : null;
            if (where) {
                top.querySelector('.hp-sub').textContent = where.name;
                tabs.querySelectorAll('.hp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === where.tab));
            }
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
        sync();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerLayout = {
        version: VERSION,
        isPhone,
        isTouch,
        onChange,
        register,
        usePhone,
        stageBox,
        chromeShown: () => shown,
        force,
        destroy() {
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
            document.documentElement.classList.remove('homer-phone', 'homer-touch', 'homer-chrome');
            listeners.clear();
        }
    };
})();
