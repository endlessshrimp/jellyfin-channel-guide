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
 *   localStorage['homer-menu'] = 'rows' | 'rail'      (default: rows)
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
 * window.HomerMenu = { style, setStyle, STYLES, items, build, width, onChange,
 *                      destroy, version }
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
    const DEFAULT_STYLE = 'rows';
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
            { id: 'guide', icon: 'live_tv', label: 'Live TV Guide', hint: 'G', act: openGuide },
            // everything playing anywhere in the house (playing/playing.js)
            { id: 'playing', icon: 'graphic_eq', label: 'Now Playing', act: () => go('#/playing') },
            { id: 'movies', icon: 'movie', label: 'Movies', act: () => goLibrary('movies') },
            { id: 'shows', icon: 'tv', label: 'TV Shows', act: () => goLibrary('tvshows') },
            // the audiobooks (books/books.js)
            { id: 'books', icon: 'auto_stories', label: 'Books', act: () => go('#/books') },
            // the music library (music/music.js); it keeps playing while you browse
            { id: 'music', icon: 'library_music', label: 'Music', act: () => go('#/music') },
            { id: 'recordings', icon: 'fiber_smart_record', label: 'Recordings', act: () => go('#/livetv?tab=3') },
            { id: 'weather', icon: 'wb_sunny', label: 'Weather', act: () => go('#/weather') },
            // the hubs: a TV window, their channels, scores or headlines, a ticker
            { id: 'sports', icon: 'sports_football', label: 'Sports', act: () => go('#/sports') },
            { id: 'news', icon: 'newspaper', label: 'News', act: () => go('#/news') },
            // Home Assistant's rooms, once it's connected on this device (Settings)
            { id: 'rooms', icon: 'lightbulb', label: 'Rooms', act: () => go('#/rooms'), when: haUp },
            // the cameras' wall, with the doorbell's rings and clips
            { id: 'cameras', icon: 'videocam', label: 'Cameras', act: () => go('#/cameras'), when: haUp },
            // (Search isn't in the menu: its box is right above it, ▲ from the
            // first item or / gets there)
            { id: 'settings', icon: 'settings', label: 'Settings', act: () => go('#/mypreferencesmenu') }
        ].filter((m) => !m.when || m.when());
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
        destroy() {
            live.forEach((m) => m.destroy());
            live.clear();
            listeners.clear();
            document.getElementById('hm-menu-css')?.remove();
        }
    };
})();
