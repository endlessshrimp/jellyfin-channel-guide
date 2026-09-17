/*
 * HOMER main menu: the one list of screens, shared by Home and Now Playing.
 *
 * Home's menu used to live in home/home.js and shrink every time an item was
 * added (.hm-menu-8 … .hm-menu-12 in home/home.css): thirteen items later the
 * rows are 30px tall and you can't read them from a sofa. The list is here
 * now, once, in one of two treatments:
 *
 *   rows   Big rows, back to the largest size (52px tall, 27px text), about
 *          seven of them visible. The column scrolls with the arrows and
 *          says when there's more above or below; focus never leaves it.
 *   rail   A narrow column of large icons down the side of the screen, the
 *          focused one naming itself beside it. Fits any number of items,
 *          and the rest of the screen gets the width back.
 *
 * Which one is a device setting, so both can be looked at side by side:
 *   localStorage['homer-menu'] = 'rows' | 'rail'      (default: rail)
 * A screen picks it up the next time it draws; HomerMenu.setStyle() redraws
 * every open menu at once.
 *
 * A screen builds one into an element it has already placed:
 *
 *   const menu = HomerMenu.build(hostEl, { go, openGuide, current: 'home' });
 *   // menu.move('down') while focus is inside it; false means "I'm at the
 *   // end, take the focus back"
 *   // …and menu.destroy() in teardown()
 *
 * The items carry the same classes Home has always used (.hm-menu-item
 * .hm-focusable, with ._act), so a screen's own focus and click handling
 * doesn't have to know which treatment is up.
 *
 * On a phone there's no column to put a menu in, so the same list is a sheet:
 * a tap on the HOMER mark in the phone's top bar (shared/layout.js) slides it
 * up from the bottom with every screen on it, Home first, the one you're on
 * marked. A tap on a row goes there; a tap outside, a swipe down, or Back
 * closes it. Back closes the sheet rather than leaving the screen because
 * opening it puts one history entry at the same address on top (the trick
 * shared/player.js already uses for a docked video), which the browser's Back
 * takes away instead of the page.
 *
 * window.HomerMenu = { style, setStyle, STYLES, items, build, width, onChange,
 *                      openSheet, closeSheet, toggleSheet, isSheetOpen,
 *                      currentId, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerMenu && typeof window.HomerMenu.destroy === 'function') {
        window.HomerMenu.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="menu.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc.replace(/menu\.js(\?.*)?$/, '');
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const STYLE_KEY = 'homer-menu';
    const STYLES = ['rows', 'rail'];
    const DEFAULT_STYLE = 'rail';
    // the column's width on a 1920-wide stage, per treatment: what a screen
    // has to leave clear to the left of everything else
    const WIDTH = { rows: 400, rail: 104 };

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    // ---------- Which treatment ----------

    let forced = null; // setStyle() before anything has drawn
    const style = () => {
        if (forced) return forced;
        let s = '';
        try { s = localStorage.getItem(STYLE_KEY) || ''; } catch { /* private mode */ }
        return STYLES.includes(s) ? s : DEFAULT_STYLE;
    };
    const listeners = new Set();
    const onChange = (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    };
    const setStyle = (s) => {
        forced = STYLES.includes(s) ? s : null;
        try {
            if (forced) localStorage.setItem(STYLE_KEY, forced);
            else localStorage.removeItem(STYLE_KEY);
        } catch { /* this session only */ }
        live.forEach((m) => m.redraw());
        listeners.forEach((fn) => {
            try { fn(style()); } catch (err) { console.warn('[HOMER Menu]', err); }
        });
        return style();
    };

    // ---------- The list ----------

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
    // the library views (Movies, TV Shows), fetched once per page
    let viewsP = null;
    const views = () => {
        if (!viewsP) {
            const server = getServer();
            viewsP = server
                ? fetch(`/Users/${server.UserId}/Views`, { headers: { Authorization: authHeader(server) } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((r) => (r && r.Items) || [])
                    .catch(() => { viewsP = null; return []; })
                : Promise.resolve([]);
        }
        return viewsP;
    };

    const haUp = () => !!(window.HomerHA && window.HomerHA.isSetUp());

    // ---------- The item for the screen you're already on ----------
    //
    // Picking Music while Music is up used to navigate to #/music again, which
    // does nothing at all from inside an album: the album is a view the screen
    // keeps to itself, not an address. The phone's top bar has always had this
    // right — its screen name goes to the top of the screen you're on
    // (HomerLayout.setScreenHome) — and this is the same thing for the menu,
    // in both treatments and under OK as much as a click.
    //
    // At the top of a flat screen it does nothing on purpose. Going Home from
    // the item for the screen you're standing on is the bug, not the feature.
    const LO = () => window.HomerLayout || null;
    const here = (m) => {
        const l = LO();
        if (!l || typeof l.screenHome !== 'function') return null;
        if (!m.id || m.id !== currentId()) return null;
        return l;
    };
    // wrap(item): the same item, with "already there" handled. A screen that
    // has somewhere above (an album, a camera, a room, a recording's folder)
    // goes there; one that's already at its top falls through to what the item
    // always did, which for the screen you're on is its own address — a no-op,
    // not a trip Home.
    const wrap = (m) => Object.assign({}, m, {
        act: () => {
            const l = here(m);
            if (l && typeof l.canScreenHome === 'function' && l.canScreenHome() && l.screenHome()) return;
            m.act();
        }
    });

    // items(ctx): what the menu offers right now. ctx.go(hash) navigates,
    // ctx.openGuide() opens the guide over whatever is up, ctx.views() (if
    // given) is a screen's already-loaded library views.
    const items = (ctx = {}) => {
        const go = ctx.go || ((h) => { location.hash = h; });
        const myViews = ctx.views || views;
        const openGuide = ctx.openGuide || (() => {
            if (window.ChannelGuide && window.ChannelGuide.open) window.ChannelGuide.open();
            else go('#/livetv?tab=1');
        });
        const goLibrary = async (type) => {
            const list = await myViews();
            const v = (list || []).find((x) => x.CollectionType === type);
            if (!v) return;
            go(type === 'movies'
                ? `#/movies?topParentId=${v.Id}&collectionType=movies`
                : `#/tv?topParentId=${v.Id}&collectionType=tvshows`);
        };
        return [
            // Live TV: the guide, and the DVR on its tabs (guide/guide.js and
            // recordings/recordings.js draw the same Guide · Recorded ·
            // Scheduled · Series row, so they're one item here)
            { id: 'livetv', icon: 'live_tv', label: 'Live TV', hint: 'G', act: openGuide },
            // everything playing anywhere in the house (playing/playing.js)
            { id: 'playing', icon: 'graphic_eq', label: 'Now Playing', act: () => go('#/playing') },
            { id: 'movies', icon: 'movie', label: 'Movies', act: () => goLibrary('movies') },
            { id: 'shows', icon: 'tv', label: 'TV Shows', act: () => goLibrary('tvshows') },
            // the music library (music/music.js); it keeps playing while you browse
            { id: 'music', icon: 'library_music', label: 'Music', act: () => go('#/music') },
            // internet radio: the same screen as Music, drawn in radio mode
            { id: 'radio', icon: 'radio', label: 'Radio', act: () => go('#/radio') },
            // the audiobooks (books/books.js)
            { id: 'books', icon: 'auto_stories', label: 'Books', act: () => go('#/books') },
            // the hubs: a TV window, their channels, scores or headlines, a ticker
            { id: 'sports', icon: 'sports_football', label: 'Sports', act: () => go('#/sports') },
            { id: 'news', icon: 'newspaper', label: 'News', act: () => go('#/news') },
            // Home Assistant, once it's connected on this device (Settings):
            // who's home, the rooms, and the cameras on their own tab
            { id: 'house', icon: 'house', label: 'House', act: () => go('#/rooms'), when: haUp },
            // what's flying over the house, on a map (planes/planes.js)
            { id: 'planes', icon: 'flight', label: 'Planes', act: () => go('#/planes') },
            // (Weather isn't in the menu: the bug in every screen's top bar
            // opens it, and the alert crawl says when it matters. Search isn't
            // either: its box is right above the menu, ▲ from the first item
            // or / gets there.)
            { id: 'settings', icon: 'settings', label: 'Settings', act: () => go('#/mypreferencesmenu') }
        ].filter((m) => !m.when || m.when()).map(wrap);
    };

    // ---------- A menu on a screen ----------

    const live = new Set();

    const build = (host, opts = {}) => {
        if (!host) throw new Error('HomerMenu.build needs an element');
        let nodes = [];
        let track = null;
        let offset = 0; // rows: how far the column is scrolled, in px
        let mine = style();

        const paint = () => {
            mine = opts.style && STYLES.includes(opts.style) ? opts.style : style();
            host.classList.add('hm-menu');
            host.classList.toggle('hm-menu-rows', mine === 'rows');
            host.classList.toggle('hm-menu-rail', mine === 'rail');
            // the old "shrink a little more each time" classes are gone
            host.classList.remove('hm-menu-8', 'hm-menu-9', 'hm-menu-10', 'hm-menu-11', 'hm-menu-12');
            host.innerHTML = `
                <div class="hm-menu-more up" aria-hidden="true"><span class="material-icons">keyboard_arrow_up</span></div>
                <div class="hm-menu-track"></div>
                <div class="hm-menu-more down" aria-hidden="true"><span class="material-icons">keyboard_arrow_down</span></div>`;
            track = host.querySelector('.hm-menu-track');
            nodes = items(opts).map((m) => {
                const item = el('div', 'hm-menu-item hm-focusable' + (m.id === opts.current ? ' hm-here' : ''),
                    `<span class="material-icons" aria-hidden="true">${esc(m.icon)}</span>`
                    + `<span class="hm-menu-label">${esc(m.label)}</span>`
                    + (m.hint ? `<span class="hm-menu-hint">${esc(m.hint)}</span>` : ''));
                item.dataset.menu = m.id;
                item.title = m.label;
                item._act = m.act;
                track.appendChild(item);
                return item;
            });
            offset = 0;
            apply();
        };

        // rows: how far the column can scroll (0 in the rail, which always fits)
        const maxScroll = () => (mine === 'rail' ? 0 : Math.max(0, track.scrollHeight - host.clientHeight));
        const apply = () => {
            const max = maxScroll();
            offset = Math.max(0, Math.min(max, offset));
            track.style.transform = `translateY(${-offset}px)`;
            host.classList.toggle('hm-menu-more-up', offset > 1);
            host.classList.toggle('hm-menu-more-down', offset < max - 1);
        };
        // keep a focused row inside the column (the rail never scrolls)
        const reveal = (node) => {
            if (!node || mine === 'rail' || !track.contains(node)) return;
            const pad = 4;
            const top = node.offsetTop;
            const bottom = top + node.offsetHeight;
            if (top - pad < offset) offset = top - pad;
            else if (bottom + pad > offset + host.clientHeight) offset = bottom + pad - host.clientHeight;
            apply();
        };

        const index = (node) => nodes.indexOf(node);
        // move(dir, from): the next item in the column, or false when there
        // isn't one and the screen should take the focus back
        const move = (dir, from) => {
            if (dir !== 'up' && dir !== 'down') return false;
            const i = index(from || document.querySelector('.hm-menu-item.hm-focus'));
            if (i < 0) return false;
            const next = nodes[i + (dir === 'down' ? 1 : -1)];
            if (!next) return false;
            reveal(next);
            return next;
        };

        const onWheel = (ev) => {
            if (mine === 'rail' || !maxScroll()) return;
            ev.preventDefault();
            offset += ev.deltaY;
            apply();
        };
        const onMore = (ev) => {
            const more = ev.target.closest('.hm-menu-more');
            if (!more) return;
            ev.stopPropagation();
            offset += (more.classList.contains('up') ? -1 : 1) * Math.max(120, host.clientHeight - 104);
            apply();
        };
        host.addEventListener('wheel', onWheel, { passive: false });
        host.addEventListener('click', onMore, true);
        const onResize = () => apply();
        window.addEventListener('resize', onResize);

        const self = {
            get style() { return mine; },
            get nodes() { return nodes; },
            get width() { return WIDTH[mine]; },
            first: () => nodes[0] || null,
            last: () => nodes[nodes.length - 1] || null,
            node: (id) => nodes.find((n) => n.dataset.menu === id) || null,
            move,
            reveal,
            // the list's conditions changed (Home Assistant connected): redraw
            redraw() {
                const was = document.querySelector('.hm-menu-item.hm-focus');
                const id = was && was.dataset.menu;
                paint();
                const back = id && self.node(id);
                if (back && opts.onRedraw) opts.onRedraw(back);
                else if (opts.onRedraw) opts.onRedraw(nodes[0] || null);
            },
            destroy() {
                live.delete(self);
                host.removeEventListener('wheel', onWheel);
                host.removeEventListener('click', onMore, true);
                window.removeEventListener('resize', onResize);
            }
        };
        paint();
        live.add(self);
        return self;
    };

    // ---------- The phone's menu sheet ----------

    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const MARK = 'homerPhoneMenu'; // our history entry, so Back closes the sheet
    const SWIPE_CLOSE = 70; // px dragged down before it goes away

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Menu]', err); return fallback; }
    };
    // the route HOMER thinks it's on (a docked video keeps the address on
    // Jellyfin's player page, so the address bar isn't the answer)
    const routeNow = () => {
        const p = HP();
        if (p && typeof p.route === 'function') {
            const r = safe(() => p.route(), null);
            if (typeof r === 'string') return r;
        }
        return location.hash || '';
    };
    const goTo = (hash) => {
        const p = HP();
        if (p && typeof p.go === 'function') p.go(hash);
        else location.hash = hash;
    };
    const goHome = () => {
        const p = HP();
        if (p && typeof p.goHome === 'function') p.goHome();
        else if (window.HomerHome && window.HomerHome.goHome) window.HomerHome.goHome();
        else location.hash = '#/home';
    };

    // currentId(): which item in the list is the screen that's up, or ''
    const currentId = () => {
        if (document.getElementById('cg-root')) return 'livetv';
        const h = routeNow();
        // the guide and the DVR are tabs of the one Live TV item
        if (/^#!?\/livetv(\.html)?(\?|$)/.test(h)) return 'livetv';
        if (/^#!?\/movies(\.html)?\?/.test(h)) return 'movies';
        if (/^#!?\/tv(\.html)?\?/.test(h)) return 'shows';
        if (/^#!?\/mypreferencesmenu(\.html)?(\?|$)/.test(h)) return 'settings';
        // Rooms and Cameras are tabs of the one House item
        if (/^#!?\/(rooms|cameras)(\?|$)/.test(h)) return 'house';
        const own = h.match(/^#!?\/(radio|planes|sports|news|books|music|playing)(\?|$)/);
        if (own) return own[1];
        // Weather is off the menu: nothing to mark (the top bar's bug opens it)
        if (/^#!?\/weather(\?|$)/.test(h)) return '';
        if (h === '' || h === '#/' || /^#!?\/(home(\.html)?)?(\?.*)?$/.test(h)) return 'home';
        return '';
    };

    // The list the sheet shows: Home, then the same items in the same order
    // as the rail. (The mark used to go Home on its own, so Home stays the
    // first thing under your thumb — and the tab bar still has it.)
    const sheetItems = () => [{ id: 'home', icon: 'home', label: 'Home', act: goHome }]
        .concat(items({ go: goTo }));

    let sheet = null; // { root, teardown } while it's up
    let pushed = false; // our history entry is on top
    let dropping = null; // taking it away ourselves: what to do once it's gone
    let dropTimer = 0;

    const pushEntry = () => {
        // keep whatever state was there (shared/player.js keeps its own mark
        // in it) and add ours, at the same address, so no router sees a change
        try {
            history.pushState(Object.assign({}, history.state, { [MARK]: true }), '', location.href);
            pushed = true;
        } catch { pushed = false; } // no history API: Back just leaves, as before
    };
    // Take our entry away, then do `then`. Never the other way round: a
    // history.back() is asynchronous, so navigating first and popping after
    // would pop the page we just went to. (shared/player.js drops its docked
    // mark the same way.)
    const dropEntry = (then) => {
        const done = then || (() => {});
        if (!pushed || !(history.state && history.state[MARK])) {
            pushed = false;
            done();
            return;
        }
        pushed = false;
        dropping = done;
        history.back();
        clearTimeout(dropTimer);
        dropTimer = setTimeout(() => {
            if (dropping !== done) return;
            dropping = null;
            done();
        }, 600); // in case the popstate never comes
    };

    // One listener for both jobs: the Back that closes the sheet, and the
    // history.back() we do ourselves when it closes some other way.
    const onPop = () => {
        if (dropping) {
            const then = dropping;
            dropping = null;
            clearTimeout(dropTimer);
            then();
            return;
        }
        if (!sheet) return;
        pushed = false; // that Back was our entry going away
        closeSheet({ history: false });
    };
    window.addEventListener('popstate', onPop);

    // closeSheet({ history: false }) when a Back has already taken the entry;
    // closeSheet(fn) runs fn once the entry is gone (a row going somewhere).
    const closeSheet = (opts) => {
        if (!sheet) {
            if (typeof opts === 'function') opts();
            return false;
        }
        const s = sheet;
        sheet = null;
        s.teardown();
        if (typeof opts === 'function') dropEntry(opts);
        else if (!opts || opts.history !== false) dropEntry();
        else pushed = false;
        return true;
    };

    const openSheet = () => {
        if (sheet) return false;
        ensureCss();
        const list = sheetItems();
        const here = currentId();

        const root = el('div', 'hm-sheet');
        root.id = 'hm-sheet-root';
        root.innerHTML = `
            <div class="hm-sheet-scrim"></div>
            <div class="hm-sheet-panel" role="dialog" aria-modal="true" aria-label="HOMER menu">
                <div class="hm-sheet-grip" aria-hidden="true"></div>
                <div class="hm-sheet-head">HOMER</div>
                <div class="hm-sheet-list"></div>
            </div>`;
        const panel = root.querySelector('.hm-sheet-panel');
        const rows = root.querySelector('.hm-sheet-list');
        rows.innerHTML = list.map((m) => `
            <button type="button" class="hm-sheet-row${m.id === here ? ' on' : ''}" data-menu="${esc(m.id)}"${m.id === here ? ' aria-current="page"' : ''}>
                <span class="material-icons" aria-hidden="true">${esc(m.icon)}</span>
                <span class="hm-sheet-label">${esc(m.label)}</span>
                <span class="material-icons hm-sheet-tick" aria-hidden="true">check</span>
            </button>`).join('');
        document.body.appendChild(root);
        requestAnimationFrame(() => root.classList.add('show'));

        const pick = (id) => {
            const m = list.find((x) => x.id === id);
            // the sheet goes, our history entry goes, and only then does the
            // screen change — so Back from there lands where you started
            closeSheet(() => { if (m) setTimeout(() => safe(m.act), 0); });
        };
        const onClick = (ev) => {
            const row = ev.target.closest('.hm-sheet-row');
            if (row) { pick(row.dataset.menu); return; }
            if (!ev.target.closest('.hm-sheet-panel')) closeSheet();
        };
        // A tap anywhere else — the top bar and the tab bar included, which
        // stay visible and unblocked — puts the sheet away and does nothing
        // else, the way a sheet anywhere else on a phone behaves. Tap again to
        // use what's under it.
        const onOutside = (ev) => {
            if (ev.target.closest('#hm-sheet-root')) return;
            if (ev.target.closest('.hp-brand')) return; // the mark toggles it itself
            ev.preventDefault();
            ev.stopPropagation();
            closeSheet();
        };
        const onKey = (ev) => {
            if (!BACK_KEYS.includes(ev.key)) return;
            ev.preventDefault();
            ev.stopImmediatePropagation(); // the screen underneath doesn't go back too
            closeSheet();
        };

        // a swipe down puts it away, but only from the top of the list
        let startY = null;
        let dy = 0;
        const onStart = (ev) => {
            if (rows.scrollTop > 0 || ev.touches.length !== 1) { startY = null; return; }
            startY = ev.touches[0].clientY;
            dy = 0;
        };
        const onMove = (ev) => {
            if (startY == null) return;
            dy = ev.touches[0].clientY - startY;
            if (dy <= 0) { panel.style.transform = ''; return; }
            panel.style.transition = 'none';
            panel.style.transform = `translateY(${dy}px)`;
        };
        const onEnd = () => {
            if (startY == null) return;
            startY = null;
            panel.style.transition = '';
            panel.style.transform = '';
            if (dy > SWIPE_CLOSE) closeSheet();
            dy = 0;
        };

        root.addEventListener('click', onClick);
        panel.addEventListener('touchstart', onStart, { passive: true });
        panel.addEventListener('touchmove', onMove, { passive: true });
        panel.addEventListener('touchend', onEnd);
        panel.addEventListener('touchcancel', onEnd);
        document.addEventListener('keydown', onKey, true);
        // not this same tap: it's still on its way up from the mark
        const armOutside = setTimeout(() => document.addEventListener('click', onOutside, true), 0);

        pushEntry();
        sheet = {
            root,
            teardown() {
                clearTimeout(armOutside);
                root.removeEventListener('click', onClick);
                document.removeEventListener('click', onOutside, true);
                document.removeEventListener('keydown', onKey, true);
                root.classList.remove('show');
                setTimeout(() => root.remove(), 200);
            }
        };
        return true;
    };

    // the phone layout going away (rotating onto a tablet, a screen closing)
    // takes the sheet with it
    if (window.HomerLayout && typeof window.HomerLayout.onChange === 'function') {
        window.HomerLayout.onChange((now) => { if (now && now.phone === false) closeSheet(); });
    }

    // The stylesheet: screens that draw a menu load their own CSS, but the
    // menu's own rules live here so both treatments look the same everywhere.
    const ensureCss = () => {
        if (document.getElementById('hm-menu-css') || !BASE) return;
        const l = document.createElement('link');
        l.id = 'hm-menu-css';
        l.rel = 'stylesheet';
        l.href = BASE + 'menu.css' + QUERY;
        document.head.appendChild(l);
    };
    ensureCss();

    window.HomerMenu = {
        version: VERSION,
        STYLES,
        style,
        setStyle,
        onChange,
        items,
        build,
        // what a screen should leave clear on the left, in stage px
        width: (s) => WIDTH[s || style()],
        // the phone's sheet (the HOMER mark in the top bar opens it)
        openSheet,
        closeSheet,
        toggleSheet() { return sheet ? (closeSheet(), false) : openSheet(); },
        isSheetOpen: () => !!sheet,
        currentId,
        destroy() {
            closeSheet();
            window.removeEventListener('popstate', onPop);
            clearTimeout(dropTimer);
            live.forEach((m) => m.destroy());
            live.clear();
            listeners.clear();
            document.getElementById('hm-menu-css')?.remove();
        }
    };
})();
