/*
 * HOMER library screens, phone layout. library/library.js draws this instead
 * of the TV screens when shared/layout.js says it's a phone; both draw from
 * library/library-model.js.
 *
 * Movies and TV Shows: a poster grid (three across, more in landscape) under
 * a filter field and the sort chips (A–Z, Recently added) with the count.
 * Posters carry their state: a blue dot for unwatched, a progress bar for in
 * progress, a check for watched, and a show's unwatched count. A tap opens
 * the title's page.
 *
 * A movie's page: its art, title, chips (year, rating, runtime, score,
 * genres), when it would end, Resume and Restart (or Play), the overview, and
 * the About rows (director, writers, cast, studio, video, audio, subtitles).
 *
 * A show's page: the same top, with Resume/Play for the next episode, then
 * the seasons as chips and the season's episodes as a list (still, number,
 * title, runtime, progress). A tap on an episode plays it, or resumes it if
 * it's in progress; ↺ on one in progress starts it over. A season's or an
 * episode's page is its show's, at that season (and that episode).
 *
 * Play goes full screen through HomerPlayer, as on TV; Back from there docks
 * the video in a strip at the top of whichever of these screens you land on.
 * A tap on the strip goes full screen again, ✕ stops it.
 *
 * window.HomerLibraryPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const PLAY_GUARD_MS = 1500; // a second tap while playback starts doesn't start it again

    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    const create = (ctx) => {
        const M = window.HomerLibraryModel;
        const {
            el, esc, lc, fmtDate, fmtMins, runtime, posOf, played, pctOf, minsLeft, endsAt,
            epCode, yearsOf, plural, isNew, posterUrl, backdropUrl, stillUrl
        } = M.util;
        const { kind, server, route } = ctx;
        const P = M.P;
        const isTv = kind === 'show' || (kind === 'library' && route.collection === 'tvshows');

        // ---------- Page ----------
        const root = el('div', `hl-phone homer-screen lp-${kind}`);
        root.id = 'hl-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <span class="hl-brand-sub" hidden>${isTv ? 'TV SHOWS' : 'MOVIES'}</span>
            <div class="lp-dock" data-homer-preview>
                <div class="lp-dock-idle"><div class="lp-dock-loading">Loading…</div></div>
                <span class="lp-badge">Live</span>
                <div class="lp-dock-ctl">
                    <button type="button" class="lp-dock-btn lp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                    <button type="button" class="lp-dock-btn lp-dock-stop" aria-label="Stop">${icon('close')}</button>
                </div>
                <div class="lp-dock-cap"><span class="lp-dock-what"></span><span class="lp-dock-left"></span></div>
                <div class="lp-dock-bar"><b></b></div>
            </div>
            <div class="lp-main"></div>
            <div class="lp-toast" role="status" aria-live="polite"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const main = $('.lp-main');
        let alive = true;
        // the stylesheet is in and the page is showing: scroll positions mean
        // something from here on
        let markShown = null;
        const shown = new Promise((resolve) => { markShown = resolve; });

        // don't leave a Jellyfin control underneath focused
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ---------- Toast ----------
        const toastEl = $('.lp-toast');
        let toastTimer = 0;
        const toast = (msg, kindCls = '') => {
            toastEl.innerHTML = `<span class="lp-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'lp-toast show' + (kindCls ? ' ' + kindCls : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'lp-toast'; }, 3200);
        };

        // ---------- Playing ----------
        let lastPlay = 0;
        const playItem = (it, fromStart) => {
            if (Date.now() - lastPlay < PLAY_GUARD_MS) return;
            lastPlay = Date.now();
            const resume = !fromStart && posOf(it) > 0;
            const name = it.Type === 'Episode' ? `${it.SeriesName || ''} ${epCode(it)}`.trim() || it.Name : it.Name;
            toast(`${resume ? 'Resuming' : posOf(it) > 0 ? 'Restarting' : 'Playing'} ${name}`);
            M.play(it.Id, resume ? posOf(it) : 0).catch((err) => {
                console.error('[HOMER Library] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        // ---------- Pieces the pages share ----------
        const stateHtml = (title, sub, retry) => `<div class="lp-state-box">${title === 'loading' ? '<div class="lp-spinner"></div>' : ''}`
            + `<b>${esc(title === 'loading' ? sub : title)}</b>${title !== 'loading' && sub ? `<span>${esc(sub)}</span>` : ''}`
            + `${retry ? '<button type="button" class="lp-retry">Try again</button>' : ''}</div>`;

        // Art fades in once it has loaded instead of popping in.
        const fadeArt = (box, url) => {
            if ((url || '') === (box.dataset.url || '')) return; // drawn already
            box.dataset.url = url || '';
            box.classList.remove('in');
            box.style.backgroundImage = 'none';
            if (!url) return;
            const img = new Image();
            img.onload = () => {
                if (!alive || box.dataset.url !== url) return;
                box.style.backgroundImage = `url("${url}")`;
                box.classList.add('in');
            };
            img.src = url;
        };

        const HERO_HTML = `
            <div class="lp-hero">
                <div class="lp-art"></div>
                <div class="lp-poster"></div>
                <div class="lp-hero-badge"></div>
                <div class="lp-hero-bar"><i></i></div>
            </div>`;
        const BODY_HTML = `
            <div class="lp-body">
                <h1 class="lp-title"></h1>
                <div class="lp-kicker"></div>
                <div class="lp-pills"></div>
                <div class="lp-when"></div>
                <div class="lp-acts"></div>
                <p class="lp-desc"></p>
                <button type="button" class="lp-more" hidden>More</button>
            </div>`;

        const drawHero = (page, { art, poster, badge, pct }) => {
            fadeArt(page.querySelector('.lp-art'), art);
            page.querySelector('.lp-poster').innerHTML = !art && poster ? `<img src="${esc(poster)}" alt="">` : '';
            page.querySelector('.lp-hero-badge').innerHTML = badge || '';
            const bar = page.querySelector('.lp-hero-bar');
            bar.hidden = !pct;
            bar.firstElementChild.style.width = (pct || 0) + '%';
        };

        const pillsHtml = (list) => list.filter((c) => c && c.text)
            .map((c) => `<span class="lp-pill${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>`).join('');

        // [{ act, icon, label, primary }]
        const actsHtml = (list) => list.map((a) => `<button type="button" class="lp-act${a.primary ? ' primary' : ''}" data-act="${a.act}">${icon(a.icon)}<span>${esc(a.label)}</span></button>`).join('');

        const factsHtml = (rows) => rows.map(([k, v]) => `<div class="lp-fact"><div class="lp-fact-k">${esc(k)}</div><div class="lp-fact-v">${esc(v)}</div></div>`).join('');

        // The overview, four lines of it until More.
        const drawDesc = (page, text) => {
            const desc = page.querySelector('.lp-desc');
            const more = page.querySelector('.lp-more');
            desc.textContent = text || '';
            desc.classList.add('clamp');
            more.hidden = true;
            more.textContent = 'More';
            // measured once it's laid out (a hidden page measures 0)
            setTimeout(() => {
                if (alive && desc.scrollHeight > desc.clientHeight + 2) more.hidden = false;
            }, 0);
        };
        const onMore = (page) => {
            const desc = page.querySelector('.lp-desc');
            const more = page.querySelector('.lp-more');
            const open = desc.classList.toggle('clamp');
            more.textContent = open ? 'More' : 'Less';
        };

        const badgeFor = (it) => {
            if (posOf(it) > 0) return '<span class="lp-flag resume">In progress</span>';
            if (played(it)) return '<span class="lp-flag">Watched</span>';
            if (isNew(it)) return '<span class="lp-flag new">New</span>';
            return '';
        };

        // ---------- The views ----------
        let view = null;
        if (kind === 'library') view = listView();
        else if (kind === 'movie') view = movieView(ctx.item);
        else view = showView(ctx.item);

        // ---------- Movies / TV Shows: the poster grid ----------
        function listView() {
            const nouns = isTv ? 'shows' : 'movies';
            const noun = isTv ? 'show' : 'movie';
            const saved = M.memory.get(route.key) || {};
            const SORT_KEY = 'homer-library-sort-' + route.collection; // shared with the TV layout
            let sortMode = 'az';
            try { sortMode = localStorage.getItem(SORT_KEY) === 'added' ? 'added' : 'az'; } catch { /* default */ }

            main.innerHTML = `
                <div class="lp-head">
                    <label class="lp-filter">
                        ${icon('search')}
                        <input class="lp-filter-input" type="text" placeholder="Filter ${nouns}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Filter ${nouns}">
                        <button type="button" class="lp-filter-clear" aria-label="Clear the filter" hidden>${icon('close')}</button>
                    </label>
                    <div class="lp-sorts" role="group" aria-label="Sort">
                        <button type="button" class="lp-chip" data-sort="az">A–Z</button>
                        <button type="button" class="lp-chip" data-sort="added">Recently added</button>
                        <span class="lp-count"></span>
                    </div>
                </div>
                <div class="lp-scroll"><div class="lp-grid"></div><div class="lp-state"></div></div>`;
            const scroll = main.querySelector('.lp-scroll');
            const grid = main.querySelector('.lp-grid');
            const stateEl = main.querySelector('.lp-state');
            const input = main.querySelector('.lp-filter-input');
            const clearBtn = main.querySelector('.lp-filter-clear');
            const countEl = main.querySelector('.lp-count');
            const setState = (html) => {
                stateEl.innerHTML = html || '';
                stateEl.hidden = !html;
            };

            let tiles = []; // { it, el }
            let query = '';
            let status = 'loading';

            const tileSub = (it) => {
                if (it.Type === 'Series') return yearsOf(it);
                if (posOf(it) > 0) return `<em>${esc(fmtMins(minsLeft(it)))} left</em>`;
                return esc([it.ProductionYear, runtime(it)].filter(Boolean).join(' · '));
            };
            const tileFlag = (it) => {
                if (it.Type === 'Series') {
                    const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                    return n ? `<span class="lp-count-dot" aria-label="${plural(n, 'unwatched episode')}">${n}</span>` : `<span class="lp-check" aria-label="Watched">${icon('check')}</span>`;
                }
                if (posOf(it) > 0) return '';
                if (played(it)) return `<span class="lp-check" aria-label="Watched">${icon('check')}</span>`;
                return '<span class="lp-dot" aria-label="Unwatched"></span>';
            };
            const makeTile = (it, i) => {
                const t = el('button', 'lp-tile' + (played(it) && it.Type !== 'Series' ? ' played' : ''));
                t.type = 'button';
                t.dataset.i = i;
                const poster = posterUrl(it, 330);
                const pct = it.Type === 'Series' ? 0 : pctOf(it);
                t.innerHTML = `
                    <span class="lp-tile-art"><span class="lp-tile-letter">${esc((it.Name || '?').slice(0, 1))}</span>${poster ? `<img loading="lazy" decoding="async" src="${esc(poster)}" alt="">` : ''}
                        <span class="lp-tile-flag">${tileFlag(it)}</span>
                        ${pct ? `<span class="lp-tile-bar"><i style="width:${pct}%"></i></span>` : ''}
                    </span>
                    <span class="lp-tile-name">${esc(it.Name)}</span>
                    <span class="lp-tile-sub">${tileSub(it)}</span>`;
                const img = t.querySelector('img');
                if (img) {
                    img.onload = () => img.classList.add('in');
                    img.onerror = () => img.remove();
                }
                return t;
            };

            const markSort = () => main.querySelectorAll('.lp-chip[data-sort]').forEach((c) => {
                const on = c.dataset.sort === sortMode;
                c.classList.toggle('on', on);
                c.setAttribute('aria-pressed', String(on));
            });
            markSort();
            const sortKey = (it) => lc(it.SortName || it.Name);
            const applyView = () => {
                const order = tiles.slice();
                if (sortMode === 'added') order.sort((a, b) => String(b.it.DateCreated || '').localeCompare(String(a.it.DateCreated || '')));
                else order.sort((a, b) => sortKey(a.it).localeCompare(sortKey(b.it), undefined, { numeric: true }));
                let shown = 0;
                for (const t of order) {
                    const it = t.it;
                    const match = !query || lc(`${it.Name} ${it.OriginalTitle || ''} ${it.ProductionYear || ''} ${(it.Genres || []).join(' ')}`).includes(query);
                    t.el.hidden = !match;
                    if (match) shown++;
                    grid.appendChild(t.el); // DOM order = display order
                }
                markSort();
                countEl.textContent = query ? `${shown} of ${tiles.length}` : plural(tiles.length, noun);
                clearBtn.hidden = !input.value;
                setState(!shown && tiles.length ? `<div class="lp-state-box"><b>Nothing matches “${esc(query)}”</b><button type="button" class="lp-retry lp-clear">Clear the filter</button></div>` : '');
            };

            const setSort = (mode) => {
                if (mode === sortMode) return;
                sortMode = mode;
                try { localStorage.setItem(SORT_KEY, mode); } catch { /* per-viewer nicety only */ }
                applyView();
                scroll.scrollTop = 0; // a new order starts at its top
            };
            const clearFilter = () => {
                input.value = '';
                query = '';
                applyView();
            };

            main.querySelector('.lp-sorts').addEventListener('click', (ev) => {
                const c = ev.target.closest('.lp-chip[data-sort]');
                if (c) setSort(c.dataset.sort);
            });
            input.addEventListener('input', () => {
                query = lc(input.value).trim();
                applyView();
                scroll.scrollTop = 0;
            });
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur(); // the keyboard goes away; the grid is filtered already
            });
            clearBtn.addEventListener('click', (ev) => {
                ev.preventDefault(); // (inside the label: don't hand focus back to the field)
                clearFilter();
            });

            // the first tile on screen, for coming back (and for the TV layout)
            const firstVisible = () => {
                const top = scroll.getBoundingClientRect().top;
                const t = tiles.find((x) => !x.el.hidden && x.el.getBoundingClientRect().bottom > top + 8);
                return t ? t.it.Id : null;
            };
            let opened = null; // the title tapped last
            scroll.addEventListener('click', (ev) => {
                if (ev.target.closest('.lp-retry')) {
                    if (ev.target.closest('.lp-clear')) clearFilter();
                    else loadList();
                    return;
                }
                const t = ev.target.closest('.lp-tile');
                const tile = t && tiles[Number(t.dataset.i)];
                if (!tile) return;
                const it = tile.it;
                opened = it.Id;
                M.memory.set(route.key, { id: it.Id, scroll: scroll.scrollTop });
                M.typeCache.set(it.Id, it.Type);
                M.fresh.set(it.Id, it); // its page can draw its top at once
                M.nav(M.detailsHash(it.Id));
            });

            const loadList = async () => {
                status = 'loading';
                grid.innerHTML = '';
                tiles = [];
                countEl.textContent = '';
                setState(stateHtml('loading', `Loading ${nouns}…`));
                try {
                    const { items } = await M.load.library(server, route.parentId, isTv);
                    if (!alive) return;
                    status = 'ready';
                    tiles = items.map((it, i) => ({ it, el: makeTile(it, i) }));
                    if (!tiles.length) {
                        countEl.textContent = `0 ${nouns}`;
                        setState(stateHtml(`No ${nouns} here yet`, 'Anything added to this library in Jellyfin shows up here.'));
                        return;
                    }
                    applyView();
                    // back where you were: the same place, or the title you were on
                    await shown;
                    if (!alive) return;
                    const at = saved.id && tiles.find((x) => x.it.Id === saved.id);
                    if (saved.scroll != null) scroll.scrollTop = saved.scroll;
                    if (at && (saved.scroll == null || !inView(at.el))) at.el.scrollIntoView({ block: 'center' });
                } catch (err) {
                    console.error('[HOMER Library]', err);
                    if (!alive) return;
                    status = 'error';
                    setState(stateHtml(`Couldn't load ${nouns}`, 'Jellyfin didn\'t answer.', true));
                }
            };
            const inView = (e) => {
                const r = e.getBoundingClientRect();
                const s = scroll.getBoundingClientRect();
                return r.top >= s.top && r.bottom <= s.bottom;
            };
            loadList();

            return {
                back() {
                    if (document.activeElement === input && input.value) { clearFilter(); return; }
                    if (document.activeElement === input) { input.blur(); return; }
                    if (query) { clearFilter(); return; }
                    M.goBack('#/home');
                },
                isTyping: () => document.activeElement === input,
                keep() {
                    if (status !== 'ready' || opened) return;
                    const id = firstVisible();
                    if (id) M.memory.set(route.key, { id, scroll: scroll.scrollTop });
                }
            };
        }

        // ---------- A movie ----------
        function movieView(item) {
            main.innerHTML = `<div class="lp-scroll lp-page">${HERO_HTML}${BODY_HTML}
                <section class="lp-about" hidden><h2 class="lp-label">About</h2><div class="lp-facts"></div></section>
                <div class="lp-state"></div></div>`;
            const page = main.querySelector('.lp-page');
            const stateEl = page.querySelector('.lp-state');
            const setState = (html) => {
                stateEl.innerHTML = html || '';
                stateEl.hidden = !html;
            };
            let it = item;
            let status = 'loading';

            const render = (full) => {
                const chips = [
                    { text: it.ProductionYear ? String(it.ProductionYear) : '' },
                    { text: it.OfficialRating },
                    { text: runtime(it) }
                ];
                if (it.CommunityRating) chips.push({ text: `★ ${it.CommunityRating.toFixed(1)}`, cls: 'score' });
                for (const g of (it.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });
                drawHero(page, { art: backdropUrl(it, 1280), poster: posterUrl(it, 420), badge: badgeFor(it), pct: pctOf(it) });
                page.querySelector('.lp-kicker').innerHTML = it.Taglines && it.Taglines[0] ? `<i>${esc(it.Taglines[0])}</i>` : '';
                page.querySelector('.lp-title').textContent = it.Name || '';
                page.querySelector('.lp-pills').innerHTML = pillsHtml(chips);
                const left = posOf(it) > 0 ? `${fmtMins(minsLeft(it))} left` : '';
                page.querySelector('.lp-when').textContent = [left, endsAt(it)].filter(Boolean).join(' · ');
                page.querySelector('.lp-acts').innerHTML = actsHtml(posOf(it) > 0
                    ? [{ act: 'resume', icon: 'play_arrow', label: 'Resume', primary: true }, { act: 'restart', icon: 'replay', label: 'Restart' }]
                    : [{ act: 'play', icon: 'play_arrow', label: 'Play', primary: true }]);
                drawDesc(page, it.Overview);
                if (!full) return;
                const rows = M.facts(it);
                page.querySelector('.lp-facts').innerHTML = factsHtml(rows);
                page.querySelector('.lp-about').hidden = !rows.length;
            };

            const load = async () => {
                status = 'loading';
                setState(stateHtml('loading', 'Loading…'));
                try {
                    const full = await M.load.item(server, item.Id);
                    if (!alive) return;
                    it = full;
                    status = 'ready';
                    setState('');
                    render(true);
                } catch (err) {
                    console.error('[HOMER Library]', err);
                    if (!alive) return;
                    status = 'error';
                    setState(stateHtml('Couldn\'t load this movie', 'Jellyfin didn\'t answer.', true));
                }
            };

            page.addEventListener('click', (ev) => {
                if (ev.target.closest('.lp-retry')) { load(); return; }
                if (ev.target.closest('.lp-more')) { onMore(page); return; }
                const a = ev.target.closest('.lp-act');
                if (!a || status !== 'ready') return;
                playItem(it, a.dataset.act === 'restart');
            });

            const saved = M.memory.get(route.key) || {};
            if (item.People || item.MediaSources) {
                // the route lookup already fetched the full item; draw it at once
                status = 'ready';
                setState('');
                render(true);
            } else {
                if (item.Name) render(false); // the list's copy: the top, while the rest loads
                load();
            }
            if (saved.scroll) shown.then(() => { if (alive) page.scrollTop = saved.scroll; });
            return {
                back: () => M.goBack('#/home'),
                keep() { M.memory.set(route.key, { scroll: page.scrollTop }); }
            };
        }

        // ---------- A show (or one of its seasons or episodes) ----------
        function showView(item) {
            main.innerHTML = `<div class="lp-scroll lp-page">${HERO_HTML}${BODY_HTML}
                <div class="lp-seasons-bar"><div class="lp-seasons" role="tablist" aria-label="Seasons"></div></div>
                <div class="lp-eps-head"></div>
                <div class="lp-eps"></div>
                <div class="lp-state"></div>
                <section class="lp-about" hidden><h2 class="lp-label">About</h2><div class="lp-facts"></div></section>
                </div>`;
            const page = main.querySelector('.lp-page');
            const seasonsEl = page.querySelector('.lp-seasons');
            const epsEl = page.querySelector('.lp-eps');
            const stateEl = page.querySelector('.lp-state');
            const setState = (html) => {
                stateEl.innerHTML = html || '';
                stateEl.hidden = !html;
            };
            const seriesId = item.Type === 'Series' ? item.Id : item.SeriesId;
            const saved = M.memory.get(route.key) || {};
            let series = item.Type === 'Series' && item.Name ? item : null;
            let seasons = [];
            let seasonIdx = -1;
            let eps = [];
            let next = null; // the episode Resume/Play is for
            let status = 'loading';
            let loadToken = 0;
            let focusId = item.Type === 'Episode' ? item.Id : saved.epId || null; // an episode to show on arrival
            const epCache = new Map(); // seasonId -> episodes

            // the top: the show, and Resume/Play for its next episode (or for
            // the episode this page is for)
            const drawTop = () => {
                const s = series || {};
                const chips = [{ text: yearsOf(s) }, { text: s.OfficialRating }];
                if (s.ChildCount) chips.push({ text: plural(s.ChildCount, 'season') });
                if (s.CommunityRating) chips.push({ text: `★ ${s.CommunityRating.toFixed(1)}`, cls: 'score' });
                for (const g of (s.Genres || []).slice(0, 3)) chips.push({ text: g, cls: 'genre' });
                const n = (s.UserData && s.UserData.UnplayedItemCount) || 0;
                const badge = series ? (n ? `<span class="lp-flag new">${n} unwatched</span>` : '<span class="lp-flag">Watched</span>') : '';
                drawHero(page, { art: series ? backdropUrl(series, 1280) : null, poster: series ? posterUrl(series, 420) : null, badge, pct: 0 });
                page.querySelector('.lp-title').textContent = s.Name || item.SeriesName || item.Name || '';
                page.querySelector('.lp-pills').innerHTML = pillsHtml(chips);
                drawDesc(page, s.Overview);
                drawNext();
            };
            const drawNext = () => {
                const when = page.querySelector('.lp-when');
                const acts = page.querySelector('.lp-acts');
                if (!next) {
                    when.textContent = '';
                    acts.innerHTML = '';
                    return;
                }
                const code = epCode(next);
                when.innerHTML = `<b>${esc(code || 'Next')}</b>${esc(next.Name || '')}${posOf(next) > 0 ? ` · <em>${esc(fmtMins(minsLeft(next)))} left</em>` : ''}`;
                acts.innerHTML = actsHtml(posOf(next) > 0
                    ? [{ act: 'resume', icon: 'play_arrow', label: code ? `Resume ${code}` : 'Resume', primary: true }, { act: 'restart', icon: 'replay', label: 'Restart' }]
                    : [{ act: 'play', icon: 'play_arrow', label: code ? `Play ${code}` : 'Play', primary: true }]);
            };

            // ----- seasons -----
            const drawSeasons = () => {
                seasonsEl.innerHTML = seasons.map((s, i) => {
                    const n = (s.UserData && s.UserData.UnplayedItemCount) || 0;
                    return `<button type="button" class="lp-chip${i === seasonIdx ? ' on' : ''}" role="tab" aria-selected="${i === seasonIdx}" data-i="${i}">${esc(s.Name)}${n ? '<i class="lp-chip-dot" aria-label="unwatched"></i>' : ''}</button>`;
                }).join('');
                const on = seasonsEl.querySelector('.lp-chip.on');
                if (on) seasonsEl.scrollLeft = Math.max(0, on.offsetLeft - 16);
            };

            const selectSeason = async (i, first = false) => {
                if (i < 0 || i >= seasons.length) return;
                const changed = first || i !== seasonIdx;
                seasonIdx = i;
                seasonsEl.querySelectorAll('.lp-chip').forEach((c, k) => {
                    c.classList.toggle('on', k === i);
                    c.setAttribute('aria-selected', String(k === i));
                });
                if (!changed && eps.length) return;
                const token = ++loadToken;
                const season = seasons[i];
                eps = [];
                epsEl.innerHTML = '';
                page.querySelector('.lp-eps-head').textContent = '';
                let list = epCache.get(season.Id);
                if (!list) {
                    setState(stateHtml('loading', 'Loading episodes…'));
                    try {
                        list = await M.load.episodes(server, seriesId, season);
                        epCache.set(season.Id, list);
                    } catch (err) {
                        console.error('[HOMER Library]', err);
                        if (alive && token === loadToken) setState(stateHtml('Couldn\'t load these episodes', 'Pick the season again to retry.'));
                        return;
                    }
                }
                if (!alive || token !== loadToken) return;
                eps = list;
                const unplayed = eps.filter((e) => !played(e)).length;
                page.querySelector('.lp-eps-head').textContent = eps.length ? `${plural(eps.length, 'episode')}${unplayed ? ` · ${unplayed} unwatched` : ''}` : '';
                setState(eps.length ? '' : stateHtml('No episodes in this season'));
                epsEl.innerHTML = eps.map(epHtml).join('');
                epsEl.querySelectorAll('img').forEach((img) => {
                    img.onload = () => img.classList.add('in');
                    img.onerror = () => img.remove();
                });
                M.memory.set(route.key, { seasonId: season.Id, epId: focusId || undefined });
            };

            const epHtml = (ep, i) => {
                const still = stillUrl(ep, 400);
                const num = ep.IndexNumber != null
                    ? `E${ep.IndexNumber}${ep.IndexNumberEnd && ep.IndexNumberEnd !== ep.IndexNumber ? '–' + ep.IndexNumberEnd : ''}`
                    : (ep.PremiereDate ? fmtDate(ep.PremiereDate) : '');
                const meta = [num, runtime(ep)].filter(Boolean).join(' · ');
                const pct = pctOf(ep);
                let flag = '<span class="lp-dot" aria-label="Unwatched"></span>';
                let state = '';
                if (posOf(ep) > 0) {
                    flag = '';
                    state = `<em>${esc(fmtMins(minsLeft(ep)))} left</em>`;
                } else if (played(ep)) {
                    flag = `<span class="lp-check" aria-label="Watched">${icon('check')}</span>`;
                } else if (ep.PremiereDate) state = esc(`Aired ${fmtDate(ep.PremiereDate)}`);
                const cls = ['lp-ep', played(ep) ? 'played' : '', next && next.Id === ep.Id ? 'next' : '', focusId === ep.Id ? 'focus' : ''].filter(Boolean).join(' ');
                const verb = posOf(ep) > 0 ? 'Resume' : 'Play';
                return `<div class="${cls}" role="button" tabindex="0" data-i="${i}" aria-label="${esc(`${verb} ${epCode(ep)} ${ep.Name || ''}`)}">
                    <div class="lp-ep-thumb">${still ? `<img loading="lazy" decoding="async" src="${esc(still)}" alt="">` : ''}${icon('play_arrow')}
                        ${pct ? `<div class="lp-ep-bar"><i style="width:${pct}%"></i></div>` : ''}</div>
                    <div class="lp-ep-text">
                        <div class="lp-ep-num">${esc(meta)}${next && next.Id === ep.Id ? '<span class="lp-ep-next">Up next</span>' : ''}</div>
                        <div class="lp-ep-title">${esc(ep.Name)}</div>
                        ${state ? `<div class="lp-ep-state">${state}</div>` : ''}
                    </div>
                    ${posOf(ep) > 0 ? `<button type="button" class="lp-ep-restart" aria-label="Restart ${esc(epCode(ep))}">${icon('replay')}</button>` : `<div class="lp-ep-flag">${flag}</div>`}
                </div>`;
            };

            // an episode this page is for (or the one you were on): in view, marked
            const revealFocus = () => {
                const i = eps.findIndex((e) => e.Id === focusId);
                const row = i >= 0 ? epsEl.children[i] : null;
                if (!row) return;
                const bar = page.querySelector('.lp-seasons-bar');
                page.scrollTop = Math.max(0, row.offsetTop - bar.offsetHeight - 12);
            };

            // ----- input -----
            page.addEventListener('click', (ev) => {
                if (ev.target.closest('.lp-retry')) { load(); return; }
                if (ev.target.closest('.lp-more')) { onMore(page); return; }
                const chip = ev.target.closest('.lp-seasons .lp-chip');
                if (chip) {
                    focusId = null;
                    const top = page.querySelector('.lp-seasons-bar').offsetTop;
                    selectSeason(Number(chip.dataset.i)).then(() => {
                        // keep the season chips where they were (stuck at the top)
                        if (alive && page.scrollTop > top) page.scrollTop = top;
                    });
                    return;
                }
                const a = ev.target.closest('.lp-act');
                if (a) {
                    if (next && status === 'ready') playItem(next, a.dataset.act === 'restart');
                    return;
                }
                const row = ev.target.closest('.lp-ep');
                const ep = row && eps[Number(row.dataset.i)];
                if (!ep) return;
                focusId = ep.Id;
                epsEl.querySelectorAll('.lp-ep.focus').forEach((r) => r.classList.remove('focus'));
                row.classList.add('focus');
                M.memory.set(route.key, { seasonId: seasons[seasonIdx] && seasons[seasonIdx].Id, epId: ep.Id });
                playItem(ep, !!ev.target.closest('.lp-ep-restart'));
            });
            epsEl.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                const row = ev.target.closest('.lp-ep');
                if (!row || ev.target.closest('.lp-ep-restart')) return;
                ev.preventDefault();
                row.click();
            });

            // ----- data -----
            const load = async () => {
                status = 'loading';
                setState(stateHtml('loading', 'Loading episodes…'));
                drawTop();
                try {
                    const [s, seasonList, nu] = await Promise.all([
                        series && series.People ? Promise.resolve(series) : M.load.item(server, seriesId),
                        M.load.seasons(server, seriesId),
                        item.Type === 'Episode' ? Promise.resolve(item) : M.load.nextUp(server, seriesId).catch(() => null)
                    ]);
                    if (!alive) return;
                    series = s;
                    M.remember([s]);
                    next = nu;
                    seasons = seasonList.length ? seasonList : [{ Id: 'all', Name: 'Episodes', _all: true }];
                    status = 'ready';
                    drawTop();
                    const rows = M.facts(series).filter(([k]) => k !== 'Video' && k !== 'Audio' && k !== 'Subtitles');
                    page.querySelector('.lp-facts').innerHTML = factsHtml(rows);
                    page.querySelector('.lp-about').hidden = !rows.length;
                    let seasonId = saved.seasonId;
                    if (item.Type === 'Episode') seasonId = item.SeasonId;
                    else if (item.Type === 'Season') seasonId = item.Id;
                    else if (!seasonId && next) seasonId = next.SeasonId;
                    else if (!seasonId) {
                        const firstUnplayed = seasons.find((x) => x.UserData && x.UserData.UnplayedItemCount && x.IndexNumber !== 0);
                        seasonId = (firstUnplayed || seasons.find((x) => x.IndexNumber !== 0) || seasons[0]).Id;
                    }
                    seasonIdx = Math.max(0, seasons.findIndex((x) => x.Id === seasonId));
                    drawSeasons();
                    await selectSeason(seasonIdx, true);
                    await shown;
                    if (!alive) return;
                    if (item.Type === 'Episode') revealFocus();
                    else if (saved.scroll != null) page.scrollTop = saved.scroll;
                } catch (err) {
                    console.error('[HOMER Library]', err);
                    if (!alive) return;
                    status = 'error';
                    setState(stateHtml('Couldn\'t load this show', 'Jellyfin didn\'t answer.', true));
                }
            };
            load();

            return {
                back: () => M.goBack(item.Type === 'Series' ? '#/home' : M.detailsHash(seriesId)),
                keep() {
                    if (status !== 'ready') return;
                    M.memory.set(route.key, { seasonId: seasons[seasonIdx] && seasons[seasonIdx].Id, epId: focusId || undefined, scroll: page.scrollTop });
                }
            };
        }

        // ---------- The docked video ----------
        // HomerPlayer pins the real video over [data-homer-preview]; this draws
        // what's around it: what's playing, time left, full screen and stop.
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked());
            root.classList.toggle('lp-docked', on);
            if (!on) {
                root.classList.remove('lp-dock-live');
                return;
            }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('lp-dock-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying();
            const p = np && np.program; // live TV
            const it = np && np.item;
            let what = '';
            let left = '';
            let pct = 0;
            if (p) {
                const now = Date.now();
                const s = Date.parse(p.StartDate);
                const e = Date.parse(p.EndDate);
                what = [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ');
                if (e > now) left = `${fmtMins((e - now) / 60000)} left`;
                if (s && e > s) pct = Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100));
            } else if (it) {
                what = it.Type === 'Episode' ? [it.SeriesName, epCode(it), it.Name].filter(Boolean).join(' · ') : it.Name || '';
                if (v && Number.isFinite(v.duration) && v.duration > 0) {
                    left = v.duration - v.currentTime > 30 ? `${fmtMins((v.duration - v.currentTime) / 60)} left` : '';
                    pct = (v.currentTime / v.duration) * 100;
                }
            }
            $('.lp-dock-what').textContent = what;
            $('.lp-dock-left').textContent = left;
            $('.lp-dock-bar b').style.width = pct + '%';
            $('.lp-badge').hidden = !p;
            $('.lp-dock-loading').textContent = p ? 'Tuning…' : 'Loading…';
        };
        $('.lp-dock').addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            ev.stopPropagation();
            if (ev.target.closest('.lp-dock-stop')) hp.stop();
            else hp.fullscreen(); // the strip, or its full-screen button
        });
        const offPlayer = P() ? P().onChange(syncDock) : () => {};
        const dockTimer = setInterval(syncDock, 500); // the video coming in, time left
        syncDock();

        // ---------- Keys and scrolling ----------
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            if (ev.key === 'Backspace' && view.isTyping && view.isTyping()) return; // deleting a letter
            ev.preventDefault();
            ev.stopPropagation();
            view.back();
        };
        document.addEventListener('keydown', onKey, true);
        // Scrolling here is this screen's alone: Jellyfin's player page turns
        // scroll gestures into volume changes. (The page still scrolls.)
        const onWheelCapture = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });

        return {
            phone: true,
            key: route.key,
            show() {
                root.style.visibility = '';
                markShown();
            },
            teardown() {
                if (!alive) return;
                try { view.keep(); } catch { /* nothing to keep */ }
                alive = false;
                clearTimeout(toastTimer);
                clearInterval(dockTimer);
                offPlayer();
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                root.remove();
            }
        };
    };

    window.HomerLibraryPhone = { version: VERSION, create };
    // tell the layout the library has a phone layout (a library screen already
    // open on a phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('library', { phone: true });
})();
