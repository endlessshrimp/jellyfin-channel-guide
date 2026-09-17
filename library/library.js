/*
 * HOMER library screens for Jellyfin Web: Movies, TV Shows and item details,
 * drawn as a full-screen set-top-box UI on the same 1920×1080 stage as the
 * guide.
 *
 * Takes over these Jellyfin routes while they're showing (Jellyfin's own page
 * stays underneath, untouched):
 *   #/movies?topParentId=…   Movies library
 *   #/tv?topParentId=…       TV Shows library
 *   #/details?id=…           Movie, Series, Season and Episode items only
 *
 * Remote/keyboard: arrows move, OK/Enter activates, Esc/Back goes back.
 *
 * Movies and TV Shows carry two rows of chips above the list — how the list is
 * ordered, and what it's narrowed to (genre, decade, Unwatched, Favourites,
 * 4K, all combining, each chip saying how many titles it would leave). ▲ off
 * the top title goes up into them, ◀▶ run along a row, ▲▼ change rows, OK
 * presses, and ▼ off the bottom row drops back onto the title you left. Esc
 * clears the lot in one press.
 *
 * This file draws the TV layout. On a phone (shared/layout.js) the same routes
 * draw library/library-phone.js instead; both take their data from
 * library/library-model.js.
 *
 * window.HomerLibrary = { open(route), close, destroy, version }
 */
(() => {
    const VERSION = '0.4.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerLibrary && typeof window.HomerLibrary.destroy === 'function') {
        window.HomerLibrary.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="library.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/library\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'library/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    // The data (session, loads, watched state, playback, routing) is in
    // library/library-model.js, shared with the phone layout
    // (library/library-phone.js). homer.js loads them just before and after
    // this file; used on its own, this loads them, then itself again.
    if (!window.HomerLibraryModel) {
        const add = (file, then) => {
            const s = document.createElement('script');
            s.src = BASE + file + QUERY;
            if (then) s.onload = then;
            document.head.appendChild(s);
        };
        add('library-model.js', () => add('library.js', () => add('library-phone.js')));
        return;
    }
    const M = window.HomerLibraryModel;
    const { SUPPORTED, getServer, typeCache, remember, memory, fresh, P, docked, currentRoute, nav, detailsHash, goBack, goHome, play } = M;
    const {
        el, esc, lc, clamp, fmtTime, fmtDate, fmtMins, runtime, posOf, played, pctOf, minsLeft, endsAt,
        epCode, yearsOf, plural, isNew, posterUrl, backdropUrl, stillUrl
    } = M.util;

    const Z = 99990; // just under the guide, so the guide can open on top

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
        if (cssReady && document.getElementById('hl-css')) return cssReady;
        // both layouts' stylesheets (the phone one is scoped to .hl-phone)
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
        cssReady = Promise.all([link('hl-css', 'library.css'), link('hl-phone-css', 'library-phone.css')]);
        return cssReady;
    };

    // The phone layout: shared/layout.js says when; library/library-phone.js
    // draws it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerLibraryPhone && window.HomerLayout.usePhone('library'));
    const createPhone = (kind, server, route, item) => window.HomerLibraryPhone.create({ kind, server, route, item });

    // ---------- Pixel scrolling (lists and the season tabs) ----------
    // The trackpad moves a list freely; keyboard selection nudges it just enough
    // to keep the highlight in view. Wheel never moves the selection.
    const makeScroller = (viewport, inner, horizontal = false, onMove = null) => {
        let pos = 0;
        const viewSize = () => (horizontal ? viewport.clientWidth : viewport.clientHeight);
        const contentSize = () => (horizontal ? inner.scrollWidth : inner.offsetHeight);
        const set = (p, animate) => {
            pos = clamp(p, 0, Math.max(0, contentSize() - viewSize()));
            inner.style.transition = animate ? 'transform 160ms ease' : 'none';
            inner.style.transform = horizontal ? `translateX(${-pos}px)` : `translateY(${-pos}px)`;
            if (onMove) onMove(pos, viewSize());
        };
        return {
            set,
            reset() { set(0, false); },
            refresh() { set(pos, false); },
            reveal(start, size, animate = true) {
                if (start < pos) set(start, animate);
                else if (start + size > pos + viewSize()) set(start + size - viewSize(), animate);
            },
            wheel(ev) {
                const d = horizontal && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : (horizontal ? ev.deltaY || ev.deltaX : ev.deltaY);
                const px = ev.deltaMode === 1 ? d * 40 : ev.deltaMode === 2 ? d * viewSize() : d;
                set(pos + px, false);
            }
        };
    };

    // Row art loads for what's on screen plus a screen either side. (Native lazy
    // loading can't see these rows: they move by transform inside a clipped box.)
    const loadNear = (inner) => (pos, size) => {
        for (const img of inner.querySelectorAll('img[data-src]')) {
            const row = img.parentNode.parentNode;
            if (row.style.display === 'none') continue;
            const top = row.offsetTop;
            if (top + row.offsetHeight >= pos - size && top <= pos + size * 2) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            }
        }
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

    // ---------- Shared chrome: stage, top bar, info panel, legend ----------

    const PREVIEW_HTML = `
        <div class="hl-preview">
            <div class="hl-preview-art"></div>
            <div class="hl-preview-poster"></div>
            <div class="hl-preview-badge"></div>
            <div class="hl-preview-bar"><span class="hl-preview-left"></span><span class="hl-preview-right"></span></div>
            <div class="hl-progress"><i></i></div>
        </div>`;

    const TEXT_HTML = `
        <div class="hl-text">
            <div class="hl-kicker"></div>
            <div class="hl-title"></div>
            <div class="hl-meta"></div>
            <div class="hl-desc"></div>
            <div class="hl-actions"></div>
        </div>`;

    const createShell = ({ kind, brand, search }) => {
        const root = el('div');
        root.id = 'hl-root';
        root.className = 'hl-' + kind;
        root.style.visibility = 'hidden'; // until library.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hl-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hl-ambient"></div>
            <div class="hl-topbar">
                <div class="hl-brand homer-home" role="button" title="Home (H)"><span class="hl-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hl-brand-sub">${esc(brand)}</span></div>
                ${search ? `<label class="hl-search">
                    <span class="material-icons hl-search-icon" aria-hidden="true">search</span>
                    <input class="hl-search-input" type="text" placeholder="${esc(search)}" autocomplete="off" spellcheck="false" aria-label="${esc(search)}">
                    <span class="hl-search-count"></span>
                </label>` : ''}
                <div class="hl-clock"><div class="hl-clock-time"></div><div class="hl-clock-date"></div></div>
            </div>
            <div class="hl-toast" role="status" aria-live="polite"></div>
            <div class="hl-body"></div>
            <div class="hl-legend"></div>`;
        document.body.appendChild(root);

        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), matching
        // Home and the guide, so the screen fills the window instead of letterboxing
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
            $('.hl-clock-time').textContent = fmtTime(d);
            $('.hl-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.hl-clock')) : () => {};

        const toastEl = $('.hl-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '', ms = 3200) => {
            toastEl.innerHTML = `<span class="hl-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hl-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hl-toast'; }, ms);
        };

        // legend: [{ key, label, action }] with 'spacer' for the gap. Every screen
        // gets H Home, just before Back.
        const HOME_ITEM = { key: 'H', label: 'Home', action: 'home' };
        const FULL_ITEM = { key: 'F', label: 'Full screen', action: 'fullscreen' };
        let lastLegend = [];
        const setLegend = (list) => {
            lastLegend = list;
            const items = list.slice();
            const at = items.indexOf('spacer');
            if (at >= 0) items.splice(at, 0, ...(docked() ? [FULL_ITEM] : []));
            const sp = items.indexOf('spacer');
            if (sp >= 0) items.splice(sp + 1, 0, HOME_ITEM);
            else items.push(...(docked() ? [FULL_ITEM] : []), 'spacer', HOME_ITEM);
            $('.hl-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hl-key">${i.key}</span>${esc(i.label)}</span>`)).join('');
        };

        const setAmbient = (url) => {
            const a = $('.hl-ambient');
            a.style.backgroundImage = url ? `url("${url}")` : 'none';
            a.classList.toggle('on', !!url);
        };

        // Art fades in once it has loaded, like a channel change, instead of the
        // window sitting blank (or showing the previous title) while it downloads.
        let artUrl = null;
        const setArt = (url) => {
            if (url === artUrl) return;
            artUrl = url;
            const art = $('.hl-preview-art');
            art.classList.remove('in');
            if (!url) {
                art.style.backgroundImage = 'none';
                return;
            }
            const img = new Image();
            img.onload = () => {
                if (artUrl !== url) return;
                art.style.backgroundImage = `url("${url}")`;
                art.classList.add('in');
            };
            img.src = url;
        };

        // info panel: text column + preview window
        const renderInfo = (info) => {
            $('.hl-kicker').innerHTML = info.kicker || '';
            $('.hl-kicker').style.display = info.kicker ? '' : 'none';
            const title = $('.hl-title');
            title.textContent = info.title || '';
            title.classList.toggle('long', (info.title || '').length > 34);
            $('.hl-meta').innerHTML = (info.chips || []).filter((c) => c && c.text)
                .map((c) => `<span class="hl-chip${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>`).join('');
            $('.hl-desc').textContent = info.desc || '';
            $('.hl-desc').classList.toggle('empty', !info.desc);
            setArt(info.art);
            const poster = $('.hl-preview-poster');
            poster.innerHTML = !info.art && info.poster ? `<img src="${esc(info.poster)}" alt="">` : '';
            $('.hl-preview-badge').innerHTML = info.badge || '';
            $('.hl-preview-left').textContent = info.barLeft || '';
            $('.hl-preview-right').textContent = info.barRight || '';
            $('.hl-progress').style.display = info.progress ? '' : 'none';
            $('.hl-progress > i').style.width = (info.progress || 0) + '%';
        };

        // action buttons: [{ id, icon, label }]
        const renderActions = (list, focusIdx, focused) => {
            const box = $('.hl-actions');
            box.innerHTML = list.map((a, i) => `<div class="hl-btn${i === focusIdx ? ' cur' : ''}${i === focusIdx && focused ? ' focus' : ''}" role="button" data-i="${i}">
                <span class="material-icons" aria-hidden="true">${a.icon}</span><span>${esc(a.label)}</span></div>`).join('');
        };

        let onKey = null;
        let onWheel = null;
        const keyHandler = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (onKey) onKey(ev);
        };
        const wheelHandler = (ev) => {
            ev.preventDefault(); // never let the Jellyfin page underneath scroll
            if (onWheel) onWheel(ev);
        };
        document.addEventListener('keydown', keyHandler, true);
        window.addEventListener('resize', fit);
        $('.hl-brand').addEventListener('click', (ev) => {
            // the mark and HOMER wordmark go Home; the screen's own name
            // (Movies or Shows) is the desktop's screen-home button — the
            // grid a details page belongs to, or nothing from the grid itself
            if (ev.target.closest('.hl-brand-sub')) {
                const l = window.HomerLayout;
                if (l && typeof l.canScreenHome === 'function' && l.canScreenHome()) l.screenHome();
                return;
            }
            goHome();
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            if (ev.target.closest('[data-action="home"]')) goHome();
            else if (ev.target.closest('[data-action="fullscreen"]') && P()) P().fullscreen();
        });
        root.addEventListener('wheel', wheelHandler, { passive: false });

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        return {
            root,
            stage,
            $,
            toast,
            setLegend,
            refreshLegend() { setLegend(lastLegend); },
            setAmbient,
            renderInfo,
            renderActions,
            setKeys(fn) { onKey = fn; },
            setWheel(fn) { onWheel = fn; },
            show() { root.style.visibility = ''; },
            teardown() {
                document.removeEventListener('keydown', keyHandler, true);
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                wxDetach();
                clearTimeout(toastTimer);
                root.remove();
            }
        };
    };

    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const stop = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    };


    // ---------- More like this (shared/tmdb.js) ----------
    // On a details screen: what TMDB says is like the thing he's looking at,
    // with Sonarr's and Radarr's own buttons on it (shared/arr.js), so the
    // answer to "what else?" is one press from being downloaded. The details
    // screens hand it a box to draw in and take back the actions it wants
    // drawn; with no TMDB key on the NAS it never draws anything.
    const createLikes = ({ shell, box, inner, scroller, toast, onActions, label = 'More like this', head: withHead = true }) => {
        const T = () => window.HomerTmdb || null;
        const A = () => window.HomerArr || null;
        const head = el('div', 'hl-like-head', `<b>${esc(label)}</b><i>TMDB</i>`);
        let rows = []; // { card, el }
        let sel = -1;
        let alive = true;
        let timer = 0;

        const mark = (g) => {
            const v = T() && T().peek(g.card);
            const flag = A() && v ? A().flagHtml(v) : '';
            g.el.querySelector('.hl-row-flag').innerHTML = flag || '<span class="material-icons hl-getmark">add</span>';
        };

        const make = (card) => {
            const r = el('div', 'hl-row hl-getrow');
            const poster = T() ? T().img(card.poster, 'thumb') : card.poster;
            const sub = [card.year ? String(card.year) : '', card.rating ? `★ ${Number(card.rating).toFixed(1)}` : ''].filter(Boolean).join(' · ');
            r.innerHTML = `
                <div class="hl-thumb">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((card.title || '?').slice(0, 1))}</span>`}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(card.title)}</div><div class="hl-row-sub">${esc(sub)}</div></div>
                <div class="hl-row-flag"></div>`;
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => { img.parentNode.innerHTML = `<span>${esc((card.title || '?').slice(0, 1))}</span>`; };
            }
            return r;
        };

        const runner = A() ? A().runner({
            hint: 'Press OK again',
            toast: (m) => toast(m.text, m.kind === 'err' ? 'err' : '', m.ms || 3200),
            update: () => {
                const g = rows[sel];
                if (g) { mark(g); info(g); }
            }
        }) : null;
        const offChange = A() ? A().onChange(() => {
            const g = rows[sel];
            if (g) { mark(g); info(g); }
        }) : () => {};

        const actionsFor = (g) => {
            const arr = A();
            const t = T();
            if (!arr || !t || !runner) return [];
            const v = t.peek(g.card) || t.asView(g.card);
            const busy = runner.busy(v);
            return arr.actions(v).map((a) => ({
                id: 'arr-' + a.id,
                icon: busy ? 'hourglass_empty' : a.icon,
                label: busy ? 'Asking…' : runner.label(a, v),
                arr: a,
                view: v
            }));
        };

        const info = (g) => {
            const t = T();
            const arr = A();
            const c = g.card;
            const v = t ? (t.peek(c) || t.asView(c)) : null;
            const soon = t ? t.when(c) : '';
            shell.renderInfo({
                kicker: `<b>${esc(label)}</b>${esc(soon ? (c.kind === 'movie' ? `In theaters ${soon}` : `Starts ${soon}`) : '')}`,
                title: c.title,
                chips: [
                    { text: c.year ? String(c.year) : '' },
                    { text: c.kind === 'show' ? 'Series' : 'Movie' },
                    { text: c.rating ? `★ ${Number(c.rating).toFixed(1)}` : '' }
                ],
                desc: c.overview || '',
                art: t ? t.img(c.fanart, 'art') : c.fanart,
                poster: t ? t.img(c.poster, 'poster') : c.poster,
                badge: arr && v ? arr.chipHtml(v) : '',
                barLeft: c.date ? fmtDate(c.date + 'T12:00:00') : '',
                barRight: 'TMDB'
            });
            onActions(actionsFor(g));
        };

        // what Sonarr or Radarr already know about the one he's settled on
        const queueStatus = (g) => {
            clearTimeout(timer);
            const t = T();
            if (!t || !A() || t.peek(g.card)) return;
            timer = setTimeout(async () => {
                if (!alive) return;
                try {
                    await t.status(g.card);
                } catch {
                    return;
                }
                if (!alive || !t.peek(g.card)) return;
                mark(g);
                if (rows[sel] === g) info(g);
            }, 600);
        };

        const select = (i, { scroll = true } = {}) => {
            if (!rows[i]) return;
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            sel = i;
            rows[i].el.classList.add('sel');
            if (scroll && scroller) scroller.reveal(rows[i].el.offsetTop - 46, rows[i].el.offsetHeight + 58);
            info(rows[i]);
            queueStatus(rows[i]);
        };

        return {
            count: () => rows.length,
            at: () => sel,
            rows: () => rows,
            // the head and the rows, back in the box (a details screen redraws
            // its list when the season changes)
            append() {
                if (!rows.length) return;
                if (withHead) inner.appendChild(head);
                for (const g of rows) inner.appendChild(g.el);
            },
            async load(kind, tmdbId) {
                const t = T();
                if (!t || !tmdbId) return 0;
                let items = [];
                try {
                    if (!(await t.available())) return 0;
                    items = await t.similar(kind, tmdbId);
                } catch (err) {
                    console.warn('[HOMER Library] TMDB recommendations:', err);
                    return 0;
                }
                if (!alive || !items.length) return 0;
                rows = items.slice(0, 12).map((card) => {
                    const g = { card, el: make(card) };
                    mark(g);
                    return g;
                });
                this.append();
                if (box) box.classList.add('has-like');
                if (scroller) scroller.refresh();
                return rows.length;
            },
            select,
            step(d) {
                if (!rows.length) return;
                select(clamp((sel < 0 ? 0 : sel) + d, 0, rows.length - 1));
            },
            enter() {
                if (!rows.length) return false;
                select(sel < 0 ? 0 : sel);
                return true;
            },
            leave() {
                if (rows[sel]) rows[sel].el.classList.remove('sel');
                sel = -1;
                clearTimeout(timer);
                if (runner) runner.disarm();
            },
            // OK on one of them: Sonarr and Radarr, through shared/arr.js. A
            // show is a TMDB id and Sonarr wants TheTVDB's, so that is settled
            // first — the button is never dead.
            async press(a) {
                const g = rows[sel];
                const t = T();
                if (!g || !a || !a.arr || !runner || !t) return;
                let v;
                try {
                    v = await t.view(g.card);
                } catch (err) {
                    console.warn('[HOMER Library] TMDB → arr:', err);
                    if (alive) toast(`Couldn't look ${g.card.title} up in ${g.card.kind === 'show' ? 'Sonarr' : 'Radarr'}`, 'err');
                    return;
                }
                if (!alive || rows[sel] !== g) return;
                runner.press(a.arr, v);
            },
            // the pointer over one of them
            rowAt(node) {
                return rows.findIndex((g) => g.el === node);
            },
            dispose() {
                alive = false;
                clearTimeout(timer);
                offChange();
                if (runner) runner.dispose();
            }
        };
    };

    // ---------- Library screen (Movies / TV Shows) ----------

    const createLibrary = (server, route) => {
        const isTv = route.collection === 'tvshows';
        const nouns = isTv ? 'shows' : 'movies';
        const shell = createShell({ kind: 'library', brand: isTv ? 'TV SHOWS' : 'MOVIES', search: isTv ? 'Search shows' : 'Search movies' });
        const { root, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-filters" role="toolbar" aria-label="Sort and filter">
                <div class="hl-frow" data-row="0"></div>
                <div class="hl-frow" data-row="1"></div>
            </div>
            <div class="hl-list">
                <div class="hl-list-head">
                    <div class="hl-active"></div>
                    <div class="hl-count"></div>
                </div>
                <div class="hl-rows"><div class="hl-rows-inner"></div><div class="hl-state"></div></div>
            </div>
            <div class="hl-detail">${PREVIEW_HTML}${TEXT_HTML}</div>`;

        const saved = memory.get(route.key) || {};
        const sorts = M.sortsFor(isTv);
        let sortMode = M.sortStore.get(route.collection, isTv);

        let rows = []; // { it, el }
        let view = []; // row indices in display order
        let sel = -1;
        let zone = 'list'; // list | actions | bar
        let act = 0;
        let actions = [];
        let query = '';
        let status = 'loading'; // loading | ready | error
        // The chips above the list: one genre, one decade, Unwatched,
        // Favourites and 4K, all combining (library/library-model.js). Empty
        // until the library is in.
        let F = M.makeFilters([], new Set());
        let barRow = 1; // the row nearest the list is the one ▲ lands in
        let barFocus = 0;
        const chipMap = new Map(); // a chip's key -> what pressing it does
        const nextUp = new Map(); // seriesId -> episode | null
        let nextUpTimer = 0;

        const rowsView = $('.hl-rows');
        const inner = $('.hl-rows-inner');
        const scroller = makeScroller(rowsView, inner, false, loadNear(inner));
        const moved = hoverTracker();
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const current = () => (rows[sel] ? rows[sel].it : null);

        // ----- rows -----
        const rowSub = (it) => {
            if (it.Type === 'Series') {
                const n = it.RecursiveItemCount || 0;
                return [yearsOf(it), n ? plural(n, 'episode') : '', it.ChildCount > 1 ? plural(it.ChildCount, 'season') : ''].filter(Boolean).join(' · ');
            }
            return [it.ProductionYear, runtime(it), it.OfficialRating].filter(Boolean).join(' · ');
        };
        const rowFlag = (it) => {
            if (it.Type === 'Series') {
                const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                return n ? `<span class="hl-count-dot">${n}</span>` : '<span class="material-icons hl-check">check</span>';
            }
            if (posOf(it) > 0) return `<span class="hl-left">${fmtMins(minsLeft(it))} left</span>`;
            if (played(it)) return '<span class="material-icons hl-check">check</span>';
            return '<span class="hl-dot" title="Unwatched"></span>';
        };
        const makeRow = (it) => {
            const r = el('div', 'hl-row');
            const poster = posterUrl(it, 180);
            r.innerHTML = `
                <div class="hl-thumb">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((it.Name || '?').slice(0, 1))}</span>`}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(it.Name)}</div><div class="hl-row-sub">${esc(rowSub(it))}</div></div>
                <div class="hl-row-flag">${rowFlag(it)}</div>
                ${pctOf(it) ? `<div class="hl-row-progress"><i style="width:${pctOf(it)}%"></i></div>` : ''}`;
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => { img.parentNode.innerHTML = `<span>${esc((it.Name || '?').slice(0, 1))}</span>`; };
            }
            return r;
        };

        // ----- the chip rows above the list -----
        // Two rows, both reachable with the arrows the way the guide's category
        // chips are: the top one is how the list is ordered plus the state
        // filters, the bottom one is decade and genre. Every chip carries the
        // number of titles pressing it would leave, counted against everything
        // else that's already on, so a dead end shows itself before you press it.
        const bar = $('.hl-filters');
        const frow = (n) => bar.querySelector(`.hl-frow[data-row="${n}"]`);
        const rowEls = (n) => (frow(n) ? [...frow(n).querySelectorAll('.hl-fchip, .hl-fsort')] : []);

        const renderBar = (pool) => {
            chipMap.clear();
            const chips = F.chips(pool);
            for (const c of chips) chipMap.set(c.key, c);
            const chipHtml = (c) => `<button type="button" class="hl-fchip hl-f-${c.group}${c.on ? ' on' : ''}${!c.count && !c.on ? ' none' : ''}"`
                + ` data-key="${esc(c.key)}" aria-pressed="${c.on}">${esc(c.label)}<span class="hl-fcount">${c.count}</span></button>`;
            frow(0).innerHTML = `<div class="hl-fseg" role="group" aria-label="Sort">`
                + sorts.map((s) => `<button type="button" class="hl-fsort${s.key === sortMode ? ' on' : ''}" data-key="s${s.key}" aria-pressed="${s.key === sortMode}">${esc(s.label)}</button>`).join('')
                + '</div>'
                + chips.filter((c) => c.row === 0).map(chipHtml).join('')
                + '<span class="hl-fspace"></span>'
                + (F.on() ? '<button type="button" class="hl-fchip hl-fclear" data-key="clear"><span class="material-icons" aria-hidden="true">close</span>Clear</button>' : '');
            frow(1).innerHTML = chips.filter((c) => c.row === 1).map(chipHtml).join('');
            frow(1).hidden = !chips.some((c) => c.row === 1);
            bar.classList.toggle('on', F.on());
        };

        const markBar = () => {
            // a rebuild can leave the remote past the end of a row (the Clear
            // chip came or went, a genre dropped out): pull it back in
            barFocus = clamp(barFocus, 0, Math.max(0, rowEls(barRow).length - 1));
            for (const n of [0, 1]) {
                rowEls(n).forEach((b, i) => b.classList.toggle('foc', zone === 'bar' && n === barRow && i === barFocus));
            }
            if (zone !== 'bar') {
                // nobody's in the rows: they sit at their left, except that a
                // chip that's *on* is kept in sight — a row of nine decades is
                // wider than the stage, and what's on mustn't hide off the end
                for (const n of [0, 1]) {
                    const lit = rowEls(n).find((b) => b.classList.contains('on') && !b.closest('.hl-fseg'));
                    frow(n).scrollLeft = 0;
                    if (lit) lit.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
                return;
            }
            const b = rowEls(barRow)[barFocus];
            if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };

        // what OK would do to the chip the remote is on
        const focusedChip = () => {
            const b = rowEls(barRow)[barFocus];
            if (!b) return null;
            const key = b.dataset.key;
            if (key === 'clear') return { label: 'Clear filters', sub: F.summary() };
            const s = sorts.find((x) => 's' + x.key === key);
            if (s) return { label: s.label, sub: 'Sort' };
            const c = chipMap.get(key);
            if (!c) return null;
            return { label: c.on ? `${c.label} off` : c.label, sub: c.on ? '' : plural(c.count, isTv ? 'show' : 'movie') };
        };

        const matchesQuery = (it) => !query
            || lc(`${it.Name} ${it.OriginalTitle || ''} ${it.ProductionYear || ''} ${(it.Genres || []).join(' ')}`).includes(query);

        const applyView = (keepId) => {
            const cmp = M.sortCompare(sortMode);
            const order = rows.map((_, i) => i).sort((a, b) => cmp(rows[a].it, rows[b].it));
            const pool = order.filter((i) => matchesQuery(rows[i].it)); // what the search box left
            view = pool.filter((i) => F.matches(rows[i].it));           // and then the chips
            const shown = new Set(view);
            for (const i of order) {
                rows[i].el.style.display = shown.has(i) ? '' : 'none';
                inner.appendChild(rows[i].el); // DOM order = display order
            }
            appendGet(); // what's out there stays under what's his
            renderBar(pool.map((i) => rows[i].it));
            markBar();
            const total = rows.length;
            const narrowed = !!query || F.on();
            $('.hl-count').textContent = narrowed ? `${view.length} of ${total}` : plural(total, isTv ? 'show' : 'movie');
            const active = $('.hl-active');
            active.textContent = [F.summary(), query ? `“${query}”` : ''].filter(Boolean).join(' · ') || `All ${nouns}`;
            active.classList.toggle('on', narrowed);
            $('.hl-search-count').textContent = query ? `${view.length} ${view.length === 1 ? nouns.slice(0, -1) : nouns}` : '';
            root.classList.toggle('filtering', narrowed);
            root.classList.toggle('no-results', !view.length); // no title to preview: no preview
            applyGetView();
            scroller.reset();
            if (!view.length) {
                const why = [F.summary(), query ? `“${query}”` : ''].filter(Boolean).join(' · ');
                setState(rows.length && narrowed
                    ? `<b>No ${nouns} match ${esc(why)}</b><span>Clear it to see all ${plural(total, isTv ? 'show' : 'movie')} again.</span>`
                        + '<button type="button" class="hl-clear-btn">Clear</button>'
                    : '');
                if (rows[sel]) rows[sel].el.classList.remove('sel');
                sel = -1;
                showEmptyInfo();
                return;
            }
            setState('');
            const keep = rows.findIndex((r) => r.it.Id === keepId);
            select(keep >= 0 && shown.has(keep) ? keep : view[0]);
            updateLegend();
        };

        const rememberFilters = () => M.filters.set(route.key, F.state);
        const pressChip = (key) => {
            if (key === 'clear') return clearAll();
            const s = sorts.find((x) => 's' + x.key === key);
            if (s) return setSort(s.key);
            const c = chipMap.get(key);
            if (!c) return;
            F.press(c);
            rememberFilters();
            applyView(current() && current().Id);
        };

        const select = (i, { scroll = true } = {}) => {
            if (!rows[i] || view.indexOf(i) < 0) return;
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            if (getRows[getSel]) getRows[getSel].el.classList.remove('sel');
            getSel = -1;
            actOn = 'list';
            const changed = sel !== i;
            sel = i;
            rows[i].el.classList.add('sel');
            if (scroll) scroller.reveal(rows[i].el.offsetTop - 8, rows[i].el.offsetHeight + 16);
            memory.set(route.key, { id: rows[i].it.Id });
            if (changed) act = 0;
            showInfo(rows[i].it);
        };

        const step = (d) => {
            if (!view.length) return;
            const v = clamp(view.indexOf(sel) + d, 0, view.length - 1);
            select(view[v]);
        };

        // ----- info panel -----
        const actionsFor = (it) => {
            if (it.Type === 'Series') {
                const list = [{ id: 'episodes', icon: 'video_library', label: 'Episodes' }];
                const nu = nextUp.get(it.Id);
                if (nu) {
                    const code = epCode(nu);
                    if (posOf(nu) > 0) {
                        list.push({ id: 'resume', icon: 'play_arrow', label: code ? `Resume ${code}` : 'Resume', item: nu });
                        list.push({ id: 'restart', icon: 'replay', label: 'Restart', item: nu });
                    } else {
                        list.push({ id: 'play', icon: 'play_arrow', label: code ? `Play ${code}` : 'Play next', item: nu });
                    }
                }
                return list;
            }
            if (posOf(it) > 0) {
                return [{ id: 'resume', icon: 'play_arrow', label: 'Resume', item: it },
                    { id: 'restart', icon: 'replay', label: 'Restart', item: it }];
            }
            return [{ id: 'play', icon: 'play_arrow', label: 'Play', item: it }];
        };

        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, zone === 'actions');
        };

        const updateLegend = () => {
            // Back means "undo the narrowing" while anything is narrowed — one
            // press takes the search box and every chip off together.
            const narrowed = !!query || F.on();
            const back = ['spacer', { key: 'ESC', label: narrowed ? 'Clear filters' : 'Back', action: 'back' }];
            if (status === 'error') return shell.setLegend([{ key: 'OK', label: 'Try again', action: 'ok' }, ...back]);
            if (status !== 'ready' || !rows.length) return shell.setLegend(back);
            if (zone === 'bar') {
                const c = focusedChip();
                return shell.setLegend([
                    { key: '◀▶', label: 'Move' },
                    { key: '▲▼', label: 'Rows' },
                    ...(c ? [{ key: 'OK', label: c.label, action: 'ok' }] : []),
                    ...back
                ]);
            }
            // nothing left to browse: the only useful keys are the way back up
            if (!view.length) {
                return shell.setLegend([{ key: '▲', label: 'Filters' }, { key: '/', label: 'Search', action: 'filter' }, ...back]);
            }
            const ok = actions[zone === 'actions' ? act : 0];
            if (zone === 'get' || actOn === 'get') {
                return shell.setLegend([
                    { key: '▲▼', label: 'Browse' },
                    ...(actions.length > 1 ? [{ key: '◀▶', label: 'Options' }] : []),
                    ...(ok ? [{ key: 'OK', label: ok.label, action: 'ok' }] : []),
                    ...back
                ]);
            }
            shell.setLegend([
                { key: '▲▼', label: 'Browse' },
                { key: '◀▶', label: 'Options' },
                ...(ok ? [{ key: 'OK', label: ok.label.replace(/ S\d+.*$/, ''), action: 'ok' }] : []),
                { key: '/', label: 'Search', action: 'filter' },
                ...back
            ]);
        };

        const showInfo = (it) => {
            const chips = [];
            if (it.Type === 'Series') {
                chips.push({ text: yearsOf(it) }, { text: it.OfficialRating });
                if (it.ChildCount) chips.push({ text: plural(it.ChildCount, 'season') });
            } else {
                chips.push({ text: it.ProductionYear ? String(it.ProductionYear) : '' }, { text: it.OfficialRating }, { text: runtime(it) });
            }
            if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
            for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });

            let badge = '';
            let barRight = '';
            if (it.Type === 'Series') {
                const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                badge = n ? `<span class="hl-chip hl-chip-new">${n} unwatched</span>` : '<span class="hl-chip">Watched</span>';
                barRight = plural(it.RecursiveItemCount || 0, 'episode');
            } else if (posOf(it) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(it))} left`;
            } else {
                badge = played(it) ? '<span class="hl-chip">Watched</span>' : isNew(it) ? '<span class="hl-chip hl-chip-new">New</span>' : '';
                barRight = runtime(it);
            }
            shell.renderInfo({
                title: it.Name,
                chips,
                desc: it.Overview || '',
                art: backdropUrl(it, 1280),
                poster: posterUrl(it, 420),
                badge,
                barLeft: it.DateCreated ? `Added ${fmtDate(it.DateCreated)}` : '',
                barRight,
                progress: it.Type === 'Series' ? 0 : pctOf(it)
            });
            actions = actionsFor(it);
            drawActions();
            updateLegend();
            if (it.Type === 'Series' && !nextUp.has(it.Id)) queueNextUp(it);
        };

        const showEmptyInfo = () => {
            actions = [];
            shell.renderInfo({ title: '', chips: [], desc: '' });
            drawActions();
            updateLegend();
        };

        // a show's next episode (for Play/Resume), looked up once you settle on it
        const queueNextUp = (it) => {
            clearTimeout(nextUpTimer);
            nextUpTimer = setTimeout(async () => {
                try {
                    nextUp.set(it.Id, await M.load.nextUp(server, it.Id, true));
                } catch {
                    return; // just no Play button
                }
                if (alive && current() === it) {
                    actions = actionsFor(it);
                    drawActions();
                    updateLegend();
                }
            }, 180);
        };

        // ----- actions -----
        const run = (a) => {
            if (!a) return;
            if (a.arr) { pressGet(a); return; } // Get it: Sonarr or Radarr (shared/arr.js)
            if (a.id === 'open' && a.item) { // something in More like this he already has
                typeCache.set(a.item.Id, a.item.Type);
                fresh.set(a.item.Id, a.item);
                nav(detailsHash(a.item.Id));
                return;
            }
            const it = current();
            if (a.id === 'episodes') {
                typeCache.set(it.Id, 'Series');
                fresh.set(it.Id, it); // the show screen can draw its header at once
                nav(detailsHash(it.Id));
                return;
            }
            const target = a.item;
            const start = a.id === 'resume' ? posOf(target) : 0;
            const name = target.Type === 'Episode' ? `${target.SeriesName || ''} ${epCode(target)}`.trim() : target.Name;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${name}`);
            play(target.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        const setZone = (z) => {
            zone = z;
            root.classList.remove('hl-zone-list', 'hl-zone-actions', 'hl-zone-bar', 'hl-zone-get');
            root.classList.add('hl-zone-' + z);
            markBar();
            drawActions();
            updateLegend();
        };


        // ----- What's out there (shared/tmdb.js) -----
        // Under his own titles, rows of what he hasn't got: trending this week,
        // what's on now, what's coming. Every one of them is one press from
        // Sonarr or Radarr going and getting it (shared/arr.js does the adding,
        // and its matcher says which of them he already has, so those are left
        // out). With no TMDB key on the NAS none of this draws and nothing else
        // about the screen changes.
        const T = () => window.HomerTmdb || null;
        const MAX_GET = 12; // per row; enough to browse, not enough to scroll forever
        let getRows = []; // { card, sec, el, owned? } one per card drawn
        let getEls = []; // the headings and the rows together, in the order they're drawn
        let getView = []; // indices into getRows that the search box left
        let getSel = -1;
        let getOn = false; // the rows are in
        let getStatusTimer = 0;
        let actOn = 'list'; // which list the buttons belong to: 'list' | 'get'

        const resetGet = () => {
            clearTimeout(getStatusTimer);
            getRows = [];
            getEls = [];
            getView = [];
            getSel = -1;
            getOn = false;
            actOn = 'list';
        };

        const makeGetRow = (card) => {
            const r = el('div', 'hl-row hl-getrow');
            const poster = T() ? T().img(card.poster, 'thumb') : card.poster;
            const sub = [card.year ? String(card.year) : '', card.rating ? `★ ${Number(card.rating).toFixed(1)}` : ''].filter(Boolean).join(' · ');
            r.innerHTML = `
                <div class="hl-thumb">${poster ? `<img data-src="${esc(poster)}" alt="">` : `<span>${esc((card.title || '?').slice(0, 1))}</span>`}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(card.title)}</div><div class="hl-row-sub">${esc(sub)}</div></div>
                <div class="hl-row-flag"></div>`;
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => { img.parentNode.innerHTML = `<span>${esc((card.title || '?').slice(0, 1))}</span>`; };
            }
            return r;
        };

        // the right-hand end of a row: what Sonarr or Radarr says about it once
        // they've said anything, else the mark that says this one can be got
        const markGetRow = (g) => {
            const arr = window.HomerArr;
            const v = T() && T().peek(g.card);
            const flag = arr && v ? arr.flagHtml(v) : '';
            g.el.querySelector('.hl-row-flag').innerHTML = flag
                || (g.owned ? '<span class="material-icons hl-check">check</span>'
                    : '<span class="material-icons hl-getmark">add</span>');
        };

        const makeGetHead = (sec, first) => {
            const h = el('div', 'hl-get-head');
            h.innerHTML = `<b>${esc(sec.label)}</b>${first ? '<i>Not in your library</i>' : ''}`;
            return h;
        };

        const appendGet = () => {
            if (!getOn) return;
            for (const e of getEls) inner.appendChild(e);
        };

        // The chips narrow his own library and have nothing to say about what
        // TMDB knows, so while any of them is on these rows stand down; the
        // search box does narrow them, by title.
        const applyGetView = () => {
            if (!getOn) return;
            const off = F.on() || !view.length;
            const hit = (g) => !off && (!query || lc(`${g.card.title} ${g.card.year || ''}`).includes(query));
            for (const g of getRows) g.el.style.display = hit(g) ? '' : 'none';
            for (const sec of new Set(getRows.map((g) => g.sec))) {
                const any = getRows.some((g) => g.sec === sec && g.el.style.display !== 'none');
                if (sec.head) sec.head.style.display = any ? '' : 'none';
            }
            getView = getRows.map((g, i) => i).filter((i) => getRows[i].el.style.display !== 'none');
            if (getSel >= 0 && getView.indexOf(getSel) < 0) {
                if (getRows[getSel]) getRows[getSel].el.classList.remove('sel');
                getSel = -1;
                actOn = 'list';
                if (zone === 'get' || zone === 'actions') setZone('list');
            }
        };

        const showGetInfo = (g) => {
            const t = T();
            const arr = window.HomerArr;
            const card = g.card;
            const v = t ? (t.peek(card) || t.asView(card)) : null;
            const soon = t ? t.when(card) : '';
            const lead = soon ? (card.kind === 'movie' ? `In theaters ${soon}` : `Starts ${soon}`) : '';
            shell.renderInfo({
                kicker: `<b>${esc(g.sec.label)}</b>${esc(lead)}`,
                title: card.title,
                chips: [
                    { text: card.year ? String(card.year) : '' },
                    { text: card.kind === 'show' ? 'Series' : 'Movie' },
                    { text: card.rating ? `★ ${Number(card.rating).toFixed(1)}` : '' }
                ],
                desc: card.overview || '',
                art: t ? t.img(card.fanart, 'art') : card.fanart,
                poster: t ? t.img(card.poster, 'poster') : card.poster,
                badge: g.owned ? '<span class="hl-chip">In your library</span>' : (arr && v ? arr.chipHtml(v) : ''),
                barLeft: card.date ? fmtDate(card.date + 'T12:00:00') : '',
                barRight: 'TMDB'
            });
            actions = getActions(g);
            drawActions();
            updateLegend();
        };

        // What a TMDB row offers: whatever shared/arr.js says can be done with
        // it — "Get this movie", "Get every episode" — or, for something in
        // More like this he already has, the way to it.
        const getActions = (g) => {
            const arr = window.HomerArr;
            const t = T();
            if (g.owned) return [{ id: 'open', icon: 'video_library', label: 'Open', item: g.owned }];
            if (!arr || !t || !arrRun) return [];
            const v = t.peek(g.card) || t.asView(g.card);
            const busy = arrRun.busy(v);
            return arr.actions(v).map((a) => ({
                id: 'arr-' + a.id,
                icon: busy ? 'hourglass_empty' : a.icon,
                label: busy ? 'Asking…' : arrRun.label(a, v),
                arr: a,
                view: v
            }));
        };

        // Sonarr's and Radarr's side of it: the confirm ("Press OK again"), the
        // add, and the toasts on the way — all shared/arr.js's, so this screen
        // says it exactly the way Search and the guide do.
        const arrRun = window.HomerArr ? window.HomerArr.runner({
            hint: 'Press OK again',
            toast: (m) => toast(m.text, m.kind === 'err' ? 'err' : '', m.ms || 3200),
            update: () => {
                const g = getRows[getSel];
                if (!g) return;
                markGetRow(g);
                showGetInfo(g);
            }
        }) : null;
        const offArrChange = window.HomerArr ? window.HomerArr.onChange(() => {
            const g = getRows[getSel];
            if (!g) return;
            markGetRow(g);
            if (zone === 'get' || actOn === 'get') showGetInfo(g);
        }) : () => {};

        // Pressing Get. A show is a TMDB id and Sonarr wants TheTVDB's, so that
        // is settled first (TMDB's external ids, then Sonarr's own search):
        // the button is never dead, and it says so when neither knows the show.
        const pressGet = async (a) => {
            const g = getRows[getSel];
            const t = T();
            if (!g || !a || !a.arr || !arrRun || !t) return;
            let v;
            try {
                v = await t.view(g.card);
            } catch (err) {
                console.warn('[HOMER Library] TMDB → arr:', err);
                if (alive) toast(`Couldn't look ${g.card.title} up in ${g.card.kind === 'show' ? 'Sonarr' : 'Radarr'}`, 'err');
                return;
            }
            if (!alive || getRows[getSel] !== g) return;
            arrRun.press(a.arr, v);
        };

        // What Sonarr or Radarr already know about the one he's settled on
        // (he may have added it months ago and never got the file). One
        // request, once he stops moving.
        const queueGetStatus = (g) => {
            clearTimeout(getStatusTimer);
            const t = T();
            if (!t || !window.HomerArr || g.owned || t.peek(g.card)) return;
            getStatusTimer = setTimeout(async () => {
                if (!alive) return;
                try {
                    await t.status(g.card);
                } catch {
                    return; // no word from them: the row stays as it is
                }
                if (!alive || !t.peek(g.card)) return;
                markGetRow(g);
                if (getRows[getSel] === g) showGetInfo(g);
            }, 600);
        };

        const selectGet = (i, { scroll = true } = {}) => {
            if (!getRows[i] || getView.indexOf(i) < 0) return;
            if (getRows[getSel]) getRows[getSel].el.classList.remove('sel');
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            const changed = getSel !== i;
            getSel = i;
            actOn = 'get';
            getRows[i].el.classList.add('sel');
            if (scroll) scroller.reveal(getRows[i].el.offsetTop - 46, getRows[i].el.offsetHeight + 58);
            if (changed) act = 0;
            showGetInfo(getRows[i]);
            queueGetStatus(getRows[i]);
        };

        const stepGet = (d) => {
            if (!getView.length) return;
            const at = getView.indexOf(getSel);
            selectGet(getView[clamp(at + d, 0, getView.length - 1)]);
        };

        const enterGet = () => {
            if (!getView.length) return false;
            setZone('get');
            selectGet(getView[0]);
            return true;
        };

        const leaveGet = () => {
            if (getRows[getSel]) getRows[getSel].el.classList.remove('sel');
            getSel = -1;
            actOn = 'list';
            setZone('list');
            if (view.length) select(view[view.length - 1]);
        };

        // TMDB's rows, once the library is in (it's what says which of them he
        // already has). Nothing here draws before available() says there's a
        // key, and nothing is said when there isn't one.
        const loadGet = async () => {
            const t = T();
            if (!t || getOn || status !== 'ready' || !rows.length) return;
            let list = [];
            try {
                if (!(await t.available())) return;
                list = await t.rows(isTv ? 'show' : 'movie');
            } catch (err) {
                console.warn('[HOMER Library] TMDB:', err);
                return;
            }
            if (!alive || !list.length || status !== 'ready') return;
            const library = rows.map((r) => r.it);
            let first = true;
            for (const sec of list) {
                const items = t.drop(sec.items, library).slice(0, MAX_GET);
                if (!items.length) continue;
                sec.head = makeGetHead(sec, first);
                first = false;
                getEls.push(sec.head);
                for (const card of items) {
                    const g = { card, sec, el: makeGetRow(card) };
                    markGetRow(g);
                    getRows.push(g);
                    getEls.push(g.el);
                }
            }
            if (!getRows.length) return;
            getOn = true;
            appendGet();
            applyGetView();
            scroller.refresh(); // the list is taller now; stay where he is
            updateLegend();
        };

        // ----- moving about the chip rows -----
        const focusChip = (n, i) => {
            barRow = n;
            barFocus = i;
            markBar();
            updateLegend();
        };
        // ▲ off the top title goes up into the bottom row (decade and genre),
        // ▲ again into the top one, ▼ comes back down to the title you left.
        const enterBar = (n) => {
            let row = rowEls(n).length ? n : (n === 1 ? 0 : 1);
            const els = rowEls(row);
            if (!els.length) return;
            const at = Math.max(0, els.findIndex((b) => b.classList.contains('on'))); // start on what's applied
            barRow = row;
            barFocus = at;
            setZone('bar');
        };
        const moveChip = (d) => {
            const els = rowEls(barRow);
            if (!els.length) return;
            focusChip(barRow, clamp(barFocus + d, 0, els.length - 1));
        };
        // between the rows: the chip nearest where you were, not the first one
        const crossRow = (d) => {
            const to = barRow + d;
            const els = rowEls(to);
            if (!els.length) return false;
            const from = rowEls(barRow)[barFocus];
            const mid = (e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
            const x = from ? mid(from) : 0;
            let best = 0;
            els.forEach((b, i) => { if (Math.abs(mid(b) - x) < Math.abs(mid(els[best]) - x)) best = i; });
            focusChip(to, best);
            return true;
        };
        const runChip = () => {
            const b = rowEls(barRow)[barFocus];
            if (b) pressChip(b.dataset.key);
        };

        const setSort = (mode) => {
            if (mode === sortMode || !sorts.some((s) => s.key === mode)) return;
            sortMode = mode;
            M.sortStore.set(route.collection, mode);
            applyView(null); // a new order starts at its top
        };

        // ----- filter -----
        const searchInput = $('.hl-search-input');
        // typing lands on the first match; clearing returns to the title you were on
        let beforeFilter = null;
        const applyFilter = (text) => {
            const next = lc(text).trim();
            if (next && !query) beforeFilter = current() && current().Id;
            query = next;
            applyView(query ? null : beforeFilter);
        };
        searchInput.addEventListener('input', () => applyFilter(searchInput.value));
        const clearFilter = () => {
            searchInput.value = '';
            applyFilter('');
        };
        // The whole library back in one press: the Clear chip, ESC from the
        // list, and the button on an empty screen all land here.
        const clearAll = () => {
            const was = beforeFilter;
            searchInput.value = '';
            query = '';
            F.clear();
            rememberFilters();
            applyView((current() && current().Id) || was);
        };
        const focusSearch = () => {
            if (zone !== 'list') setZone('list');
            searchInput.focus();
            searchInput.select();
        };

        // ----- the Actions strip (shared/actions.js) -----
        // The same things this screen's keys do, for a remote that hasn't got any
        // letters. Asked for fresh each time the strip opens, so it can name the
        // title the remote is on.
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const list = [];
            const it = current();
            const name = getRows[getSel] ? getRows[getSel].card.title : (it && it.Name) || '';
            const primary = actions[zone === 'actions' ? act : 0];
            if (name && primary) {
                list.push({ id: 'ok', key: 'OK', icon: primary.icon, label: primary.label, sub: name, run: () => run(primary) });
            }
            if (rows.length) {
                list.push({
                    id: 'filters',
                    key: '▲',
                    icon: 'filter_alt',
                    label: 'Filters',
                    sub: F.summary() || `All ${nouns}`,
                    run: () => enterBar(1)
                });
                if (F.on() || query) {
                    list.push({
                        id: 'clear',
                        key: 'ESC',
                        icon: 'filter_alt_off',
                        label: 'Clear filters',
                        sub: [F.summary(), query ? `“${query}”` : ''].filter(Boolean).join(' · '),
                        run: clearAll
                    });
                }
                list.push({
                    id: 'sort',
                    key: '▲▲',
                    icon: 'sort',
                    label: 'Sort',
                    sub: (sorts.find((s) => s.key === sortMode) || {}).label || '',
                    run: () => enterBar(0)
                });
            }
            list.push({ id: 'filter', key: '/', icon: 'search', label: isTv ? 'Search shows' : 'Search movies', sub: query || '', run: focusSearch });
            return list;
        }, { id: 'library', title: isTv ? 'TV Shows' : 'Movies' }) : () => {};

        // ----- input -----
        const retry = () => {
            if (status !== 'error') return;
            load();
        };
        shell.setKeys((ev) => {
            const k = ev.key;
            if (ev.target === searchInput) {
                if (k === 'Escape') {
                    stop(ev);
                    if (searchInput.value) clearFilter();
                    else searchInput.blur();
                } else if (k === 'Enter' || k === 'ArrowDown' || k === 'Tab') {
                    stop(ev);
                    searchInput.blur();
                    setZone('list');
                } else {
                    ev.stopPropagation();
                }
                return;
            }
            if (k === '/') {
                stop(ev);
                focusSearch();
                return;
            }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                if (zone === 'bar') setZone('list'); // out of the chips, back on the title you left
                else if (query || F.on()) clearAll();
                else goBack('#/home');
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return;
            stop(ev);
            if (status === 'error' && k === 'Enter') return retry();
            if (status !== 'ready' || (ev.repeat && (k === 'Enter' || k === ' '))) return;
            if (zone === 'bar') {
                if (k === 'ArrowLeft') moveChip(-1);
                else if (k === 'ArrowRight') moveChip(1);
                else if (k === 'Home') focusChip(barRow, 0);
                else if (k === 'End') focusChip(barRow, Math.max(0, rowEls(barRow).length - 1));
                else if (k === 'ArrowUp') { if (!crossRow(-1)) focusSearch(); } // nothing above the top row but the search box
                else if (k === 'ArrowDown') { if (!crossRow(1)) setZone('list'); }
                else if (k === 'Enter' || k === ' ') runChip();
                return;
            }
            // nothing matched the chips: the only way out is back up into them
            if (!view.length) {
                if (k === 'ArrowUp' && rows.length) enterBar(1);
                return;
            }
            if (zone === 'list') {
                if (k === 'ArrowDown') {
                    // off the bottom of his own titles and into what's out there
                    if (view.indexOf(sel) === view.length - 1 && enterGet()) return;
                    step(1);
                } else if (k === 'ArrowUp') {
                    if (view.indexOf(sel) === 0) enterBar(1);
                    else step(-1);
                } else if (k === 'PageDown') step(8);
                else if (k === 'PageUp') step(-8);
                else if (k === 'Home') step(-view.length);
                else if (k === 'End') step(view.length);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'Enter') run(actions[0]);
            } else if (zone === 'get') {
                if (k === 'ArrowDown') stepGet(1);
                else if (k === 'ArrowUp') {
                    if (getView.indexOf(getSel) <= 0) leaveGet(); // back up onto his own titles
                    else stepGet(-1);
                } else if (k === 'PageDown') stepGet(8);
                else if (k === 'PageUp') stepGet(-8);
                else if (k === 'Home') stepGet(-getView.length);
                else if (k === 'End') stepGet(getView.length);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'Enter') run(actions[0]);
            } else if (zone === 'actions') {
                if (k === 'ArrowRight') { act = Math.min(actions.length - 1, act + 1); drawActions(); updateLegend(); }
                else if (k === 'ArrowLeft') {
                    if (act === 0) setZone(actOn === 'get' ? 'get' : 'list');
                    else { act -= 1; drawActions(); updateLegend(); }
                } else if (k === 'ArrowUp' || k === 'ArrowDown') {
                    if (actOn === 'get') {
                        setZone('get');
                        stepGet(k === 'ArrowDown' ? 1 : -1);
                    } else {
                        setZone('list');
                        step(k === 'ArrowDown' ? 1 : -1);
                    }
                } else if (k === 'Enter') run(actions[act]);
            }
        });

        shell.setWheel((ev) => {
            if (rowsView.contains(ev.target) && view.length) scroller.wheel(ev);
        });

        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const r = ev.target.closest('.hl-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) {
                const j = getRows.findIndex((x) => x.el === r);
                if (j < 0 || getView.indexOf(j) < 0) return;
                actOn = 'get';
                if (zone !== 'get') setZone('get');
                if (j !== getSel) selectGet(j, { scroll: false });
                return;
            }
            if (zone !== 'list') setZone('list');
            if (i !== sel) select(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            if (ev.target.closest('.hl-clear-btn')) { clearAll(); return; }
            const r = ev.target.closest('.hl-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) {
                const j = getRows.findIndex((x) => x.el === r);
                if (j < 0 || getView.indexOf(j) < 0) return;
                actOn = 'get';
                if (zone !== 'get') setZone('get');
                selectGet(j, { scroll: false });
                run(actions[0]);
                return;
            }
            select(i, { scroll: false });
            run(actions[0]);
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        // the chip rows with a pointer: the highlight follows it, a click presses
        bar.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const b = ev.target.closest('.hl-fchip, .hl-fsort');
            if (!b) return;
            const n = Number(b.closest('.hl-frow').dataset.row);
            const i = rowEls(n).indexOf(b);
            if (i < 0 || (zone === 'bar' && n === barRow && i === barFocus)) return;
            barRow = n;
            barFocus = i;
            if (zone !== 'bar') setZone('bar');
            else focusChip(n, i);
        });
        bar.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-fchip, .hl-fsort');
            if (b) pressChip(b.dataset.key);
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const a = item.dataset.action;
            if (a === 'ok') {
                if (status === 'error') retry();
                else if (zone === 'bar') runChip();
                else run(zone === 'actions' ? actions[act] : actions[0]);
            } else if (a === 'filter') focusSearch();
            else if (a === 'back') {
                if (query || F.on()) clearAll();
                else goBack('#/home');
            }
        });

        // ----- data -----
        let alive = true;
        const load = async () => {
            status = 'loading';
            inner.innerHTML = '';
            rows = [];
            view = [];
            sel = -1;
            resetGet();
            setState(`<div class="hl-spinner"></div><b>Loading ${nouns}…</b>`);
            shell.renderInfo({ title: '', chips: [], desc: '' });
            $('.hl-count').textContent = '';
            $('.hl-active').textContent = '';
            actions = [];
            drawActions();
            updateLegend();
            try {
                // the titles and, beside them, which of them are 4K (one small
                // extra query, so the chip knows whether it's worth offering)
                const [{ items, name }, uhd] = await Promise.all([
                    M.load.library(server, route.parentId, isTv),
                    M.load.uhd(server, route.parentId, isTv)
                ]);
                if (!alive) return;
                if (name) $('.hl-brand-sub').textContent = name;
                status = 'ready';
                F = M.makeFilters(items, uhd);
                F.restore(M.filters.get(route.key)); // where you left this screen, this sitting
                rows = items.map((it) => ({ it, el: makeRow(it) }));
                if (!rows.length) {
                    setState(`<b>No ${nouns} here yet</b><span>Anything added to this library in Jellyfin shows up here.</span>`);
                    $('.hl-count').textContent = `0 ${nouns}`;
                    showEmptyInfo();
                    return;
                }
                setZone('list');
                applyView(saved.id);
                loadGet(); // and, under them, what he hasn't got (nothing at all without a TMDB key)
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState(`<b>Couldn't load ${nouns}</b><span>Jellyfin didn't answer. Press OK to try again.</span>`);
                shell.renderInfo({ title: `Couldn't load ${nouns}`, chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                updateLegend();
            }
        };
        setZone('list');
        load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                clearTimeout(nextUpTimer);
                clearTimeout(getStatusTimer);
                offArrChange();
                if (arrRun) arrRun.dispose();
                offActions();
                shell.teardown();
            }
        };
    };

    // ---------- Details: Series / Season / Episode ----------
    // One screen for all three: season tabs, the season's episodes, and the
    // highlighted episode in the info panel with Play / Resume / Restart.

    const createShow = (server, route, item) => {
        const shell = createShell({ kind: 'show', brand: 'TV SHOWS' });
        const { root, stage, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-info">${TEXT_HTML}${PREVIEW_HTML}</div>
            <div class="hl-panel">
                <div class="hl-tabs-head">
                    <div class="hl-tabs"><div class="hl-tabs-inner"></div></div>
                    <div class="hl-count"></div>
                </div>
                <div class="hl-rows"><div class="hl-rows-inner"></div><div class="hl-state"></div></div>
            </div>`;

        const seriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
        const saved = memory.get(route.key) || {};
        let series = item.Type === 'Series' && item.Name ? item : null;
        let seasons = []; // season items (or one pseudo-season when the show has none)
        let seasonIdx = -1;
        let eps = [];
        let epRows = [];
        let sel = -1;
        let zone = item.Type === 'Episode' ? 'actions' : 'episodes'; // actions | seasons | episodes
        let lastBelow = 'episodes'; // where Down from the buttons goes back to
        let act = 0;
        let actions = [];
        let status = 'loading';
        let alive = true;
        let loadToken = 0;
        const epCache = new Map(); // seasonId -> episodes

        const rowsView = $('.hl-rows');
        const inner = $('.hl-rows-inner');
        const tabsInner = $('.hl-tabs-inner');
        const scroller = makeScroller(rowsView, inner, false, loadNear(inner));
        const tabScroller = makeScroller($('.hl-tabs'), tabsInner, true);
        // More like this, under the season's episodes (shared/tmdb.js)
        const likes = createLikes({
            shell,
            inner,
            scroller,
            toast,
            onActions: (list) => {
                actions = list;
                act = clamp(act, 0, Math.max(0, list.length - 1));
                drawActions();
                updateLegend();
            }
        });
        const moved = hoverTracker();
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };
        const current = () => eps[sel] || null;

        // ----- info -----
        const actionsFor = (ep) => {
            if (!ep) return [];
            const list = posOf(ep) > 0
                ? [{ id: 'resume', icon: 'play_arrow', label: 'Resume' }, { id: 'restart', icon: 'replay', label: 'Restart' }]
                : [{ id: 'play', icon: 'play_arrow', label: 'Play' }];
            if (canPlayOn()) list.push({ id: 'playon', icon: 'cast', label: 'Play on…', item: ep });
            return list;
        };
        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, zone === 'actions' || zone === 'likes');
        };
        const updateLegend = () => {
            const items = [];
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (zone === 'likes') {
                items.push({ key: '▲▼', label: 'More like this' });
                if (actions.length > 1) items.push({ key: '◀▶', label: 'Options' });
                if (actions[act]) items.push({ key: 'OK', label: actions[act].label, action: 'ok' });
            } else if (zone === 'episodes') {
                items.push({ key: '▲▼', label: 'Episodes' }, { key: '▶', label: 'Options' });
                if (actions[0]) items.push({ key: 'OK', label: actions[0].label, action: 'ok' });
            } else if (zone === 'seasons') {
                items.push({ key: '◀▶', label: 'Season' }, { key: '▼', label: 'Episodes' });
            } else {
                items.push({ key: '◀▶', label: 'Options' }, { key: '▼', label: 'Episodes' });
                if (actions[act]) items.push({ key: 'OK', label: actions[act].label, action: 'ok' });
            }
            items.push('spacer', { key: 'ESC', label: 'Back', action: 'back' });
            shell.setLegend(items);
        };

        // Home Assistant and /Sessions both usually settle after this screen
        // has already drawn once: redraw the actions when either changes,
        // rather than deciding whether Play on… belongs here just once.
        const offCV = CV() ? CV().onChange(() => {
            actions = actionsFor(current());
            drawActions();
            updateLegend();
        }) : () => {};

        const showInfo = (ep) => {
            if (!ep) {
                actions = [];
                shell.renderInfo({
                    kicker: series ? `<b>${esc(yearsOf(series))}</b>${esc(series.Name)}` : '',
                    title: series ? series.Name : '',
                    chips: series ? [{ text: series.OfficialRating }, ...(series.Genres || []).slice(0, 3).map((g) => ({ text: g, cls: 'genre' }))] : [],
                    desc: series ? series.Overview : '',
                    art: series ? backdropUrl(series, 900) : null,
                    poster: series ? posterUrl(series, 420) : null
                });
                drawActions();
                updateLegend();
                return;
            }
            const code = epCode(ep);
            const chips = [
                { text: ep.PremiereDate ? fmtDate(ep.PremiereDate) : '' },
                { text: runtime(ep) },
                { text: ep.OfficialRating || (series && series.OfficialRating) }
            ];
            if (ep.CommunityRating) chips.push({ text: `★ ${ep.CommunityRating.toFixed(1)}` });
            let badge = '';
            let barRight = runtime(ep);
            if (posOf(ep) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(ep))} left`;
            } else if (played(ep)) badge = '<span class="hl-chip">Watched</span>';
            else if (isNew(ep)) badge = '<span class="hl-chip hl-chip-new">New</span>';
            shell.renderInfo({
                kicker: `${code ? `<b>${esc(code)}</b>` : ''}${esc(ep.SeriesName || (series && series.Name) || '')}`,
                title: ep.Name,
                chips,
                desc: ep.Overview || '',
                art: stillUrl(ep, 900),
                badge,
                barLeft: endsAt(ep),
                barRight,
                progress: pctOf(ep)
            });
            actions = actionsFor(ep);
            drawActions();
            updateLegend();
        };

        // ----- seasons -----
        const renderTabs = () => {
            tabsInner.innerHTML = seasons.map((s, i) => {
                const n = (s.UserData && s.UserData.UnplayedItemCount) || 0;
                return `<div class="hl-tab" data-i="${i}">${esc(s.Name)}${n ? '<span class="hl-tab-dot"></span>' : ''}</div>`;
            }).join('');
        };
        const markTabs = () => {
            tabsInner.querySelectorAll('.hl-tab').forEach((t, i) => {
                t.classList.toggle('on', i === seasonIdx);
                t.classList.toggle('focus', i === seasonIdx && zone === 'seasons');
            });
            const t = tabsInner.children[seasonIdx];
            if (t) tabScroller.reveal(t.offsetLeft - 40, t.offsetWidth + 80); // clear of the fade at the edge
        };

        const pickEpisode = (list, preferId) => {
            let i = preferId ? list.findIndex((e) => e.Id === preferId) : -1;
            if (i < 0) i = list.findIndex((e) => posOf(e) > 0);
            if (i < 0) i = list.findIndex((e) => !played(e));
            return Math.max(0, i);
        };

        const selectSeason = async (i, preferId) => {
            if (i < 0 || i >= seasons.length) return;
            const changed = i !== seasonIdx;
            seasonIdx = i;
            markTabs();
            if (!changed && eps.length) return;
            const token = ++loadToken;
            const season = seasons[i];
            eps = [];
            epRows = [];
            sel = -1;
            inner.innerHTML = '';
            scroller.reset();
            $('.hl-count').textContent = '';
            let list = epCache.get(season.Id);
            if (!list) {
                setState('<div class="hl-spinner"></div><b>Loading episodes…</b>');
                try {
                    list = await M.load.episodes(server, seriesId, season);
                    epCache.set(season.Id, list);
                } catch (err) {
                    console.error('[HOMER Library]', err);
                    if (alive && token === loadToken) {
                        setState('<b>Couldn\'t load these episodes</b><span>Pick the season again to retry.</span>');
                        showInfo(null);
                    }
                    return;
                }
            }
            if (!alive || token !== loadToken) return;
            eps = list;
            const unplayed = eps.filter((e) => !played(e)).length;
            $('.hl-count').textContent = eps.length ? `${plural(eps.length, 'episode')}${unplayed ? ` · ${unplayed} unwatched` : ''}` : '';
            if (!eps.length) {
                setState('<b>No episodes in this season</b>');
                showInfo(null);
                return;
            }
            setState('');
            epRows = eps.map((ep) => {
                const r = makeEpRow(ep);
                inner.appendChild(r);
                return r;
            });
            likes.append(); // the season's list was redrawn: put them back under it
            selectEp(pickEpisode(eps, preferId));
            scroller.refresh(); // load the art for the rows now on screen
        };

        const makeEpRow = (ep) => {
            const r = el('div', 'hl-ep');
            const still = stillUrl(ep, 320);
            const num = ep.IndexNumber != null
                ? `<small>EP</small>${ep.IndexNumber}${ep.IndexNumberEnd && ep.IndexNumberEnd !== ep.IndexNumber ? '–' + ep.IndexNumberEnd : ''}`
                : (ep.PremiereDate ? `<small>${esc(new Date(ep.PremiereDate).toLocaleDateString([], { month: 'short', timeZone: 'UTC' }))}</small>${new Date(ep.PremiereDate).getUTCDate()}` : '<small>EP</small>–');
            const sub = [ep.PremiereDate ? `Aired ${fmtDate(ep.PremiereDate)}` : '', runtime(ep)].filter(Boolean).join(' · ');
            let flag = '<span class="hl-dot" title="Unwatched"></span>';
            if (posOf(ep) > 0) flag = `<span class="hl-left">${fmtMins(minsLeft(ep))} left</span>`;
            else if (played(ep)) flag = '<span class="material-icons hl-check">check</span>';
            r.innerHTML = `
                <div class="hl-ep-num">${num}</div>
                <div class="hl-ep-thumb">${still ? `<img data-src="${esc(still)}" alt="">` : ''}</div>
                <div class="hl-row-text"><div class="hl-row-title">${esc(ep.Name)}</div><div class="hl-row-sub">${esc(sub)}</div></div>
                <div class="hl-row-flag">${flag}</div>
                ${pctOf(ep) ? `<div class="hl-row-progress"><i style="width:${pctOf(ep)}%"></i></div>` : ''}`;
            if (played(ep)) r.classList.add('played');
            const img = r.querySelector('img');
            if (img) {
                img.onload = () => img.classList.add('in');
                img.onerror = () => img.remove();
            }
            return r;
        };

        const selectEp = (i, { scroll = true } = {}) => {
            if (!epRows[i]) return;
            if (epRows[sel]) epRows[sel].classList.remove('sel');
            if (sel !== i) act = 0;
            sel = i;
            epRows[i].classList.add('sel');
            if (scroll) scroller.reveal(epRows[i].offsetTop - 8, epRows[i].offsetHeight + 16);
            memory.set(route.key, { seasonId: seasons[seasonIdx] && seasons[seasonIdx].Id, epId: eps[i].Id });
            showInfo(eps[i]);
        };

        const setZone = (z) => {
            if (z !== 'actions' && z !== 'likes') lastBelow = z;
            if (z !== 'likes') likes.leave();
            zone = z;
            root.classList.remove('hl-zone-actions', 'hl-zone-seasons', 'hl-zone-episodes', 'hl-zone-likes');
            root.classList.add('hl-zone-' + z);
            markTabs();
            drawActions();
            updateLegend();
        };

        // ----- actions -----
        const openPlayOn = (ep) => {
            const c = CV();
            if (!c || !ep) return;
            c.open(stage, {
                tv: true,
                item: ep,
                startTicks: posOf(ep),
                toast,
                onNowPlaying: () => nav('#/playing'),
            });
        };
        const run = (a) => {
            if (a && a.arr) { likes.press(a); return; } // one of More like this
            if (a && a.id === 'playon') { openPlayOn(a.item || current()); return; }
            const ep = current();
            if (!a || !ep) return;
            const start = a.id === 'resume' ? posOf(ep) : 0;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${epCode(ep) || ep.Name}`);
            play(ep.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        // ----- input -----
        shell.setKeys((ev) => {
            const k = ev.key;
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                goBack(item.Type === 'Series' ? '#/home' : detailsHash(seriesId));
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return;
            stop(ev);
            if (status === 'error') {
                if (k === 'Enter') load();
                return;
            }
            if (status !== 'ready' || (ev.repeat && k === 'Enter')) return;
            if (zone === 'likes') {
                if (k === 'ArrowDown') likes.step(1);
                else if (k === 'ArrowUp') {
                    if (likes.at() <= 0) { // back up onto the last episode
                        setZone('episodes');
                        selectEp(eps.length - 1);
                    } else likes.step(-1);
                } else if (k === 'ArrowRight') { act = Math.min(actions.length - 1, act + 1); drawActions(); updateLegend(); }
                else if (k === 'ArrowLeft') { act = Math.max(0, act - 1); drawActions(); updateLegend(); }
                else if (k === 'Enter') run(actions[act]);
                return;
            }
            if (zone === 'episodes') {
                if (k === 'ArrowDown') {
                    // off the bottom of the season and into More like this
                    if (sel >= eps.length - 1 && likes.count()) {
                        setZone('likes');
                        likes.enter();
                    } else selectEp(Math.min(eps.length - 1, sel + 1));
                } else if (k === 'ArrowUp') {
                    if (sel <= 0) setZone('seasons');
                    else selectEp(sel - 1);
                } else if (k === 'PageDown') selectEp(Math.min(eps.length - 1, sel + 4));
                else if (k === 'PageUp') selectEp(Math.max(0, sel - 4));
                else if (k === 'Home') selectEp(0);
                else if (k === 'End') selectEp(eps.length - 1);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'Enter') run(actions[0]);
            } else if (zone === 'seasons') {
                if (k === 'ArrowLeft') selectSeason(seasonIdx - 1);
                else if (k === 'ArrowRight') selectSeason(seasonIdx + 1);
                else if ((k === 'ArrowDown' || k === 'Enter') && eps.length) setZone('episodes');
                else if (k === 'ArrowUp' && actions.length) setZone('actions');
            } else if (zone === 'actions') {
                if (k === 'ArrowRight') { act = Math.min(actions.length - 1, act + 1); drawActions(); updateLegend(); }
                else if (k === 'ArrowLeft') {
                    if (act > 0) { act -= 1; drawActions(); updateLegend(); }
                    else if (eps.length) setZone('episodes');
                } else if (k === 'ArrowDown') setZone(lastBelow === 'seasons' || !eps.length ? 'seasons' : 'episodes');
                else if (k === 'Enter') run(actions[act]);
            }
        });

        shell.setWheel((ev) => {
            if (rowsView.contains(ev.target) && eps.length) scroller.wheel(ev);
            else if ($('.hl-tabs').contains(ev.target)) tabScroller.wheel(ev);
        });

        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const i = epRows.indexOf(ev.target.closest('.hl-ep'));
            if (i < 0) return;
            if (zone !== 'episodes') setZone('episodes');
            if (i !== sel) selectEp(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            const like = likes.rowAt(ev.target.closest('.hl-row'));
            if (like >= 0) {
                if (zone !== 'likes') setZone('likes');
                likes.select(like, { scroll: false });
                run(actions[0]);
                return;
            }
            const i = epRows.indexOf(ev.target.closest('.hl-ep'));
            if (i < 0) return;
            selectEp(i, { scroll: false });
            run(actions[0]);
        });
        tabsInner.addEventListener('click', (ev) => {
            const t = ev.target.closest('.hl-tab');
            if (!t) return;
            setZone('seasons');
            selectSeason(Number(t.dataset.i));
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        $('.hl-legend').addEventListener('click', (ev) => {
            const itemEl = ev.target.closest('[data-action]');
            if (!itemEl) return;
            const a = itemEl.dataset.action;
            if (a === 'ok') {
                if (status === 'error') load();
                else run(zone === 'actions' ? actions[act] : actions[0]);
            } else if (a === 'back') goBack(item.Type === 'Series' ? '#/home' : detailsHash(seriesId));
        });

        // ----- data -----
        const load = async () => {
            status = 'loading';
            seasonIdx = -1;
            eps = [];
            epRows = [];
            inner.innerHTML = '';
            tabsInner.innerHTML = '';
            setState('<div class="hl-spinner"></div><b>Loading episodes…</b>');
            shell.renderInfo({ title: item.Type === 'Series' ? item.Name : (item.SeriesName || ''), chips: [], desc: '' });
            updateLegend();
            try {
                const [s, seasonList, next] = await Promise.all([
                    series ? Promise.resolve(series) : M.load.item(server, seriesId),
                    M.load.seasons(server, seriesId),
                    item.Type === 'Series' && !saved.epId
                        ? M.load.nextUp(server, seriesId).catch(() => null)
                        : Promise.resolve(null)
                ]);
                if (!alive) return;
                series = s;
                remember([s]);
                shell.setAmbient(backdropUrl(s, 1280));
                seasons = seasonList;
                if (!seasons.length) seasons = [{ Id: 'all', Name: 'Episodes', _all: true }];
                status = 'ready';
                renderTabs();
                let seasonId = saved.seasonId;
                let preferId = saved.epId;
                if (!seasonId) {
                    if (item.Type === 'Episode') { seasonId = item.SeasonId; preferId = item.Id; }
                    else if (item.Type === 'Season') seasonId = item.Id;
                    // a show that's still airing opens on its newest season (what's
                    // new); one that's ended opens where you are
                    else if (next && s.Status !== 'Continuing') { seasonId = next.SeasonId; preferId = next.Id; }
                    else seasonId = (seasons.find((x) => x.IndexNumber !== 0) || seasons[0]).Id;
                }
                const idx = Math.max(0, seasons.findIndex((x) => x.Id === seasonId));
                setZone(zone);
                await selectSeason(idx, preferId);
                if (alive && !eps.length && zone !== 'seasons') setZone('seasons');
                // and, under the episodes, what TMDB says is like this show
                if (alive) {
                    let tmdbId = (s.ProviderIds && Number(s.ProviderIds.Tmdb)) || 0;
                    if (!tmdbId) {
                        const full = await M.load.item(server, seriesId).catch(() => null);
                        tmdbId = (full && full.ProviderIds && Number(full.ProviderIds.Tmdb)) || 0;
                    }
                    if (alive && tmdbId) likes.load('show', tmdbId);
                }
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState('<b>Couldn\'t load this show</b><span>Jellyfin didn\'t answer. Press OK to try again.</span>');
                shell.renderInfo({ title: 'Couldn\'t load this show', chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                updateLegend();
            }
        };
        setZone(zone);
        load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                likes.dispose();
                offCV();
                shell.teardown();
            }
        };
    };

    // ---------- Details: Movie ----------

    // "Play on…" (library/castvideo.js): a movie or episode on another
    // screen, the same picker on both. Home Assistant and Jellyfin's own
    // /Sessions both settle after a screen has usually already drawn once,
    // so canPlayOn() is asked again on CV().onChange rather than decided
    // once — the same shape music.js uses for HomerHA.onChange.
    const CV = () => window.HomerCastVideo || null;
    const canPlayOn = () => { const c = CV(); return !!c && c.ready(); };

    const createMovie = (server, route, item) => {
        const shell = createShell({ kind: 'movie', brand: 'MOVIES' });
        const { root, stage, $, toast } = shell;
        $('.hl-body').innerHTML = `
            <div class="hl-info">${TEXT_HTML}${PREVIEW_HTML}</div>
            <div class="hl-panel hl-panel-split">
                <div class="hl-pane hl-pane-about">
                    <div class="hl-tabs-head"><div class="hl-panel-label"><b>ABOUT</b></div><div class="hl-count"></div></div>
                    <div class="hl-facts"></div>
                    <div class="hl-state"></div>
                </div>
                <div class="hl-pane hl-pane-like">
                    <div class="hl-tabs-head"><div class="hl-panel-label"><b>MORE LIKE THIS</b></div></div>
                    <div class="hl-rows"><div class="hl-rows-inner"></div></div>
                </div>
            </div>`;
        root.classList.add('hl-zone-actions');
        let it = item;
        let act = 0;
        let actions = [];
        let status = 'loading';
        let alive = true;
        let zone = 'actions'; // actions | likes
        const stateEl = $('.hl-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        // More like this, in the panel beside About (shared/tmdb.js)
        const likesBox = $('.hl-panel');
        const likesInner = $('.hl-pane-like .hl-rows-inner');
        const likesScroller = makeScroller($('.hl-pane-like .hl-rows'), likesInner, false, loadNear(likesInner));
        const likes = createLikes({
            shell,
            box: likesBox,
            inner: likesInner,
            scroller: likesScroller,
            toast,
            head: false, // the pane is headed already
            onActions: (list) => {
                actions = list;
                drawActions();
            }
        });

        const setZone = (z) => {
            zone = z;
            root.classList.remove('hl-zone-actions', 'hl-zone-likes');
            root.classList.add('hl-zone-' + z);
        };

        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            shell.renderActions(actions, act, true);
            const many = actions.length > 1;
            shell.setLegend([
                ...(status === 'error' ? [{ key: 'OK', label: 'Try again', action: 'ok' }] : [
                    ...(zone === 'likes' ? [{ key: '▲▼', label: 'More like this' }] : []),
                    ...(many || zone !== 'likes' ? [{ key: '◀▶', label: 'Options' }] : []),
                    ...(actions[act] ? [{ key: 'OK', label: actions[act].label, action: 'ok' }] : []),
                    ...(zone === 'actions' && likes.count() ? [{ key: '▼', label: 'More like this' }] : [])
                ]),
                'spacer',
                { key: 'ESC', label: 'Back', action: 'back' }
            ]);
        };

        const render = () => {
            const chips = [
                { text: it.ProductionYear ? String(it.ProductionYear) : '' },
                { text: it.OfficialRating },
                { text: runtime(it) }
            ];
            if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}` });
            for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });
            let badge = '';
            let barRight = runtime(it);
            if (posOf(it) > 0) {
                badge = '<span class="hl-chip hl-chip-resume">In progress</span>';
                barRight = `${fmtMins(minsLeft(it))} left`;
            } else if (played(it)) badge = '<span class="hl-chip">Watched</span>';
            else if (isNew(it)) badge = '<span class="hl-chip hl-chip-new">New</span>';
            shell.renderInfo({
                kicker: (it.Taglines && it.Taglines[0]) ? `<i>${esc(it.Taglines[0])}</i>` : '',
                title: it.Name,
                chips,
                desc: it.Overview || '',
                art: backdropUrl(it, 1280),
                poster: posterUrl(it, 420),
                badge,
                barLeft: endsAt(it),
                barRight,
                progress: pctOf(it)
            });
            shell.setAmbient(backdropUrl(it, 1280));
            actions = posOf(it) > 0
                ? [{ id: 'resume', icon: 'play_arrow', label: 'Resume' }, { id: 'restart', icon: 'replay', label: 'Restart' }]
                : [{ id: 'play', icon: 'play_arrow', label: 'Play' }];
            if (canPlayOn()) actions.push({ id: 'playon', icon: 'cast', label: 'Play on…' });
            drawActions();
            const rows = M.facts(it);
            $('.hl-facts').innerHTML = rows.map(([k, v]) => `<div class="hl-fact"><div class="hl-fact-k">${esc(k)}</div><div class="hl-fact-v">${esc(v)}</div></div>`).join('');
            setState(rows.length ? '' : '<b>No cast or media details for this movie</b>');
        };

        // Home Assistant and /Sessions both usually settle after this screen
        // has already drawn once: redraw when either changes, rather than
        // deciding whether Play on… belongs here just once.
        const offCV = CV() ? CV().onChange(() => { if (status === 'ready') render(); }) : () => {};

        const openPlayOn = () => {
            const c = CV();
            if (!c) return;
            c.open(stage, {
                tv: true,
                item: it,
                startTicks: posOf(it),
                toast,
                onNowPlaying: () => nav('#/playing'),
            });
        };
        const run = (a) => {
            if (!a || status !== 'ready') return;
            if (a.arr) { likes.press(a); return; } // one of More like this: Sonarr or Radarr
            if (a.id === 'playon') { openPlayOn(); return; }
            const start = a.id === 'resume' ? posOf(it) : 0;
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${it.Name}`);
            play(it.Id, start).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        shell.setKeys((ev) => {
            const k = ev.key;
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                goBack('#/home');
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(k)) return;
            stop(ev);
            if (status === 'error') {
                if (k === 'Enter') load();
                return;
            }
            if (ev.repeat && k === 'Enter') return;
            if (k === 'ArrowRight') act = Math.min(actions.length - 1, act + 1);
            else if (k === 'ArrowLeft') act = Math.max(0, act - 1);
            else if (k === 'ArrowDown') {
                if (zone === 'likes') { likes.step(1); return; }
                if (likes.count()) { setZone('likes'); likes.enter(); return; }
            } else if (k === 'ArrowUp') {
                if (zone !== 'likes') return;
                if (likes.at() <= 0) { // back up onto the movie itself
                    likes.leave();
                    setZone('actions');
                    render();
                    return;
                }
                likes.step(-1);
                return;
            } else if (k === 'Enter') return run(actions[act]);
            drawActions();
        });
        const actionsBox = $('.hl-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (!b || Number(b.dataset.i) === act) return;
            act = Number(b.dataset.i);
            drawActions();
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hl-btn');
            if (b) run(actions[Number(b.dataset.i)]);
        });
        // More like this, with a pointer
        $('.hl-pane-like').addEventListener('click', (ev) => {
            const i = likes.rowAt(ev.target.closest('.hl-row'));
            if (i < 0) return;
            setZone('likes');
            likes.select(i, { scroll: false });
            run(actions[0]);
        });
        $('.hl-pane-like').addEventListener('wheel', (ev) => likesScroller.wheel(ev), { passive: true });
        $('.hl-legend').addEventListener('click', (ev) => {
            const itemEl = ev.target.closest('[data-action]');
            if (!itemEl) return;
            if (itemEl.dataset.action === 'ok') {
                if (status === 'error') load();
                else run(actions[act]);
            } else if (itemEl.dataset.action === 'back') goBack('#/home');
        });

        const load = async () => {
            status = 'loading';
            setState('<div class="hl-spinner"></div><b>Loading…</b>');
            try {
                const full = await M.load.item(server, item.Id);
                if (!alive) return;
                it = full;
                status = 'ready';
                render();
                // and, beside it, what TMDB says is like it
                likes.load('movie', (it.ProviderIds && Number(it.ProviderIds.Tmdb)) || 0).then(() => {
                    if (alive && zone === 'actions') drawActions();
                });
            } catch (err) {
                console.error('[HOMER Library]', err);
                if (!alive) return;
                status = 'error';
                setState('<b>Couldn\'t load this movie</b><span>Jellyfin didn\'t answer. Press OK to try again.</span>');
                shell.renderInfo({ title: 'Couldn\'t load this movie', chips: [], desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                drawActions();
            }
        };
        // the route lookup already fetched the full item; draw it at once
        if (item.People || item.MediaSources) {
            status = 'ready';
            render();
            likes.load('movie', (it.ProviderIds && Number(it.ProviderIds.Tmdb)) || 0).then(() => {
                if (alive && zone === 'actions') drawActions();
            });
        } else load();

        return {
            key: route.key,
            show: shell.show,
            refreshLegend: shell.refreshLegend,
            teardown() {
                alive = false;
                likes.dispose();
                offCV();
                shell.teardown();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null; // the open screen, or null
    let suppressedKey = null; // closed via close(); stay out of the way until the route changes
    let lookup = null; // details id being looked up

    const parseRoute = (hash = currentRoute()) => {
        const m = (hash || '').match(/^#!?\/([a-z]+)(?:\.html)?(?:\?(.*))?$/i);
        if (!m) return null;
        const page = m[1].toLowerCase();
        const q = new URLSearchParams(m[2] || '');
        if ((page === 'movies' || page === 'tv') && q.get('topParentId')) {
            const tab = q.get('tab');
            if (tab && tab !== '0') return null; // Suggestions, Genres, … stay Jellyfin's
            return { kind: 'library', collection: page === 'movies' ? 'movies' : 'tvshows', parentId: q.get('topParentId'), key: 'lib:' + q.get('topParentId') };
        }
        if (page === 'details' && q.get('id')) return { kind: 'details', id: q.get('id'), key: 'det:' + q.get('id') };
        return null;
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const openScreen = (route, server) => {
        let s;
        const phone = phoneLayout();
        if (route.kind === 'library') s = phone ? createPhone('library', server, route) : createLibrary(server, route);
        else {
            const item = fresh.get(route.id) || { Id: route.id, Type: typeCache.get(route.id) };
            fresh.delete(route.id);
            if (item.Type === 'Movie') s = phone ? createPhone('movie', server, route, item) : createMovie(server, route, item);
            else if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Episode') {
                if (item.Type !== 'Series' && !item.SeriesId) {
                    // need the parent show; look it up first
                    typeCache.delete(route.id);
                    sync();
                    return;
                }
                s = phone ? createPhone('show', server, route, item) : createShow(server, route, item);
            } else return;
        }
        if (destroyed) return s.teardown();
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    let destroyed = false;
    const sync = () => {
        if (destroyed) return;
        const route = parseRoute();
        const server = getServer();
        if (!route || route.key !== suppressedKey) suppressedKey = null;
        if (!route || !server || suppressedKey) {
            closeScreen();
            return;
        }
        if (screen && screen.key === route.key) return;
        if (route.kind === 'details') {
            const known = fresh.get(route.id);
            const type = known ? known.Type : typeCache.get(route.id);
            if (type && !SUPPORTED.has(type)) {
                // people, channels, collections, …: not a HOMER page, and Jellyfin's
                // pages don't show; go back where you were (or Home)
                closeScreen();
                if (docked()) P().back();
                else if (history.length > 1) history.back();
                else location.replace('#/home');
                return;
            }
            // Seasons/episodes need their show's id, so fetch the item itself.
            if (!type || (!known && (type === 'Season' || type === 'Episode'))) {
                closeScreen();
                if (lookup === route.id) return;
                lookup = route.id;
                M.load.item(server, route.id).then((it) => {
                    typeCache.set(route.id, it.Type);
                    if (SUPPORTED.has(it.Type)) fresh.set(route.id, it);
                }).catch(() => {
                    typeCache.set(route.id, 'Unknown');
                }).finally(() => {
                    lookup = null;
                    sync();
                });
                return;
            }
        }
        closeScreen();
        openScreen(route, server);
    };

    let lastHref = '';
    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued) return;
        syncQueued = true;
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            const here = location.href + '|' + currentRoute();
            if (here === lastHref && (screen || !parseRoute())) return;
            lastHref = here;
            sync();
        }, 50);
    };
    const onRouteChange = () => {
        lastHref = '';
        queueSync();
    };

    let observer = null;
    const start = () => {
        // Jellyfin's router uses pushState, which fires no event; watch the DOM
        // (it re-renders on every navigation) and check the address.
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    // The phone and TV layouts switch places (a window resized across the
    // line, or the phone layout arriving): draw the other one. Where it was
    // (the title, the season) is in memory, which both layouts keep.
    const onLayout = () => {
        if (!screen || !!screen.phone === phoneLayout()) return;
        const route = parseRoute();
        const server = getServer();
        closeScreen();
        if (route && server && !suppressedKey) openScreen(route, server);
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    // docking, Back and Home change the route without changing the address
    let offPlayer = null;
    const hookPlayer = () => {
        if (offPlayer || !P()) return;
        offPlayer = P().onChange(() => {
            onRouteChange();
            if (screen && screen.refreshLegend) screen.refreshLegend();
        });
    };
    hookPlayer();
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerLibrary = {
        version: VERSION,
        // open(): take over the current route if it's a library/details page;
        // open('#/movies?topParentId=…'): go there (and take it over).
        open(route) {
            suppressedKey = null;
            if (typeof route === 'string' && route && currentRoute() !== route) {
                nav(route.startsWith('#') ? route : '#' + route);
                return;
            }
            lastHref = '';
            sync();
        },
        // close(): reveal Jellyfin's own page until the route changes
        close() {
            if (!screen) return;
            suppressedKey = screen.key;
            closeScreen();
        },
        destroy() {
            destroyed = true;
            closeScreen();
            observer && observer.disconnect();
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            if (offPlayer) offPlayer();
            offLayout();
            document.getElementById('hl-css')?.remove();
            document.getElementById('hl-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
