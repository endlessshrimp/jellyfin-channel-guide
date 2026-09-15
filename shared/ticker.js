/*
 * HOMER ticker: a BottomLine-style strip along the bottom of a hub (Sports,
 * News). A segment at a time: a label chip on the left ("MLB", "TOP
 * STORIES") and its items to the right of it, a page at a time ("flip": each
 * page holds, then the next slides up) or as one crawl ("crawl": the row
 * glides right to left, for headlines).
 *
 * Items flagged priority (a favorite team's game) lead their segment, and
 * are also gathered into a segment of their own (priorityLabel, "MY TEAMS")
 * that comes round after every priorityEvery other segments, so they're on
 * screen more often.
 *
 * The hub feeds it: source() (sync or a Promise) returns the segments and is
 * asked again every refreshMs; new segments take over at the next segment
 * boundary, so the page on screen never jumps. setSegments() pushes them
 * instead.
 *
 * Focus (the hub's focus engine calls these): pause() holds the page; step(±1)
 * goes to the next/previous page (or nudges the crawl); resume() carries on.
 * OK on the ticker runs the first item on the page with an act().
 *
 *   const t = HomerTicker.create(el, { source, refreshMs, mode, pageMs,
 *                                      priorityLabel, priorityEvery });
 *   t.setSegments([{ label: 'MLB', color: '#2f8cff', logo: url, mode?,
 *                    items: [item, …] }]);
 *   item = { html } | { text } plus optional { priority, act, key }
 *   HomerTicker.score(game) -> item   (game: see HomerHub.ui.scoreCard)
 *   HomerTicker.text(text, { tag, priority, act }) -> item
 *   t.pause(); t.resume(); t.step(1); t.ok(); t.refresh(); t.destroy();
 *
 * window.HomerTicker = { create, score, text, version }
 */
(() => {
    const VERSION = '0.1.0';

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ---------- Items ----------

    // a team in a score item: logo, abbreviation, score (the winner bright)
    const side = (t, showScore, dim) => {
        if (!t) return '';
        const logo = t.logo ? `<img class="hb-tk-logo" src="${esc(t.logo)}" alt="" draggable="false" onerror="this.remove()">` : '';
        const rank = t.rank && t.rank <= 25 ? `<span class="hb-tk-rank">${t.rank}</span>` : '';
        return `<span class="hb-tk-team${dim ? ' dim' : ''}">${logo}${rank}<b>${esc(t.abbr || t.short || t.name || '')}</b>${showScore ? `<span class="hb-tk-num">${esc(t.score ?? '')}</span>` : ''}</span>`;
    };
    // A game as an item: "TEX 5  SEA 3  FINAL", "NYM @ TEX  7:05 PM  ESPN 1300",
    // "TEX 3  NYM 2  ▲ 7th". game is a normalized game (HomerHub.ui.scoreCard).
    const score = (g, opts = {}) => {
        const pre = g.state === 'pre';
        const post = g.state === 'post';
        const live = g.state === 'in';
        const a = g.away || {};
        const h = g.home || {};
        const dimA = post && h.winner && !a.winner;
        const dimH = post && a.winner && !h.winner;
        let status = '';
        if (live) status = `<span class="hb-tk-status live"><i></i>${esc(g.status || 'Live')}</span>`;
        else if (post) status = `<span class="hb-tk-status final">${esc(g.status || 'Final')}</span>`;
        else {
            const net = g.channel ? `<span class="hb-tk-net">${esc(g.network || g.channel.name)} <b>${esc(g.channel.number)}</b></span>`
                : g.network ? `<span class="hb-tk-net">${esc(g.network)}</span>` : '';
            status = `<span class="hb-tk-status">${esc(g.status || '')}</span>${net}`;
        }
        const sep = pre ? '<span class="hb-tk-at">@</span>' : '';
        const html = `<span class="hb-tk-game${g.priority ? ' fav' : ''}">${side(a, !pre, dimA)}${sep}${side(h, !pre, dimH)}${status}</span>`;
        return { html, priority: !!(opts.priority ?? g.priority), act: opts.act || g.act || null, key: g.id };
    };
    // a line of text (a headline): an optional tag in front ("BREAKING", "RANGERS")
    const text = (t, opts = {}) => ({
        html: `<span class="hb-tk-text">${opts.tag ? `<span class="hb-tk-tag">${esc(opts.tag)}</span>` : ''}${esc(t)}</span>`,
        priority: !!opts.priority,
        act: opts.act || null,
        key: opts.key || t
    });

    // ---------- The strip ----------

    const create = (host, opts = {}) => {
        const cfg = Object.assign({
            mode: 'flip', // or 'crawl'
            pageMs: 5500, // a flip page's time on screen
            crawlSpeed: 130, // px a second, on the 1080-tall stage
            refreshMs: 60000,
            priorityLabel: 'MY TEAMS',
            priorityColor: '',
            priorityEvery: 2,
            source: null,
            empty: 'Loading…'
        }, opts);

        host.classList.add('hb-tk');
        host.innerHTML = `
            <div class="hb-tk-label"><span class="hb-tk-label-in"></span></div>
            <div class="hb-tk-view"><div class="hb-tk-measure" aria-hidden="true"></div></div>
            <div class="hb-tk-paused" aria-hidden="true"><span class="material-icons">pause</span></div>`;
        const labelEl = host.querySelector('.hb-tk-label');
        const view = host.querySelector('.hb-tk-view');
        const measure = host.querySelector('.hb-tk-measure');

        let segments = []; // as given
        let queue = []; // the running order (with the priority segment woven in)
        let pending = null; // segments waiting for the next boundary
        let si = -1; // segment index in queue
        let pages = []; // current segment's pages: [[item, …], …]
        let pi = 0;
        let pageEl = null;
        let timer = 0;
        let refreshTimer = 0;
        let paused = false;
        let anim = null; // the crawl's Web Animation
        let destroyed = false;
        let sinceFav = 0;

        const order = (segs) => {
            // priority items lead each segment, and get a segment of their own
            const clean = segs.filter((s) => s && s.items && s.items.length).map((s) => Object.assign({}, s, {
                items: [...s.items.filter((i) => i.priority), ...s.items.filter((i) => !i.priority)]
            }));
            const fav = [];
            const seen = new Set();
            for (const s of clean) {
                for (const i of s.items) {
                    if (!i.priority || seen.has(i.key || i.html)) continue;
                    seen.add(i.key || i.html);
                    fav.push(i);
                }
            }
            const out = [];
            const favSeg = fav.length ? { label: cfg.priorityLabel, color: cfg.priorityColor, fav: true, items: fav } : null;
            if (favSeg) out.push(favSeg);
            clean.forEach((s, k) => {
                out.push(s);
                if (favSeg && cfg.priorityEvery > 0 && (k + 1) % cfg.priorityEvery === 0 && k < clean.length - 1) out.push(favSeg);
            });
            return out;
        };

        const itemEl = (item) => {
            const e = document.createElement('span');
            e.className = 'hb-tk-item' + (item.priority ? ' pri' : '') + (item.act ? ' act' : '');
            e.innerHTML = item.html != null ? item.html : `<span class="hb-tk-text">${esc(item.text || '')}</span>`;
            e._item = item;
            return e;
        };

        // pack a segment's items into pages that fit the view
        const paginate = (seg) => {
            const w = view.clientWidth || 1200;
            measure.innerHTML = '';
            const els = seg.items.map((i) => {
                const e = itemEl(i);
                measure.appendChild(e);
                return e;
            });
            const gap = 56;
            const out = [];
            let cur = [];
            let used = 0;
            els.forEach((e, k) => {
                const iw = e.offsetWidth || 300;
                if (cur.length && used + gap + iw > w) {
                    out.push(cur);
                    cur = [];
                    used = 0;
                }
                cur.push(seg.items[k]);
                used += (cur.length > 1 ? gap : 0) + iw;
            });
            if (cur.length) out.push(cur);
            measure.innerHTML = '';
            return out;
        };

        const paintLabel = (seg) => {
            const inner = document.createElement('span');
            inner.className = 'hb-tk-label-in';
            inner.innerHTML = `${seg.logo ? `<img src="${esc(seg.logo)}" alt="" draggable="false" onerror="this.remove()">` : ''}<b>${esc(seg.label || '')}</b>${seg.sub ? `<small>${esc(seg.sub)}</small>` : ''}`;
            labelEl.classList.toggle('fav', !!seg.fav);
            labelEl.style.setProperty('--tk-color', seg.color || '');
            const old = labelEl.querySelector('.hb-tk-label-in');
            if (old && old.innerHTML === inner.innerHTML) return;
            labelEl.appendChild(inner);
            if (old) {
                old.classList.add('out');
                setTimeout(() => old.remove(), 450);
            }
        };

        const clearTimers = () => {
            clearTimeout(timer);
            timer = 0;
            if (anim) {
                anim.cancel();
                anim = null;
            }
        };

        const showPage = (dir = 1) => {
            const seg = queue[si];
            if (!seg) return;
            const mode = seg.mode || cfg.mode;
            const page = document.createElement('div');
            page.className = 'hb-tk-page' + (mode === 'crawl' ? ' crawl' : '');
            const items = mode === 'crawl' ? seg.items : pages[pi] || [];
            items.forEach((i) => page.appendChild(itemEl(i)));
            page.classList.add(dir > 0 ? 'in-below' : 'in-above');
            view.appendChild(page);
            void page.offsetWidth;
            page.classList.remove('in-below', 'in-above');
            const old = pageEl;
            pageEl = page;
            if (old) {
                old.classList.add(dir > 0 ? 'out-above' : 'out-below');
                setTimeout(() => old.remove(), 450);
            }
            if (mode === 'crawl') startCrawl(page);
            else if (!paused) timer = setTimeout(nextPage, cfg.pageMs + Math.max(0, items.length - 3) * 600);
        };

        const startCrawl = (page) => {
            const w = view.clientWidth || 1200;
            const rowW = page.scrollWidth;
            const dist = w + rowW;
            const ms = (dist / cfg.crawlSpeed) * 1000;
            if (typeof page.animate !== 'function') {
                if (!paused) timer = setTimeout(nextSegment, Math.max(4000, ms));
                return;
            }
            anim = page.animate([{ transform: `translateX(${w}px)` }, { transform: `translateX(${-rowW}px)` }], { duration: ms, easing: 'linear', fill: 'forwards' });
            anim.onfinish = () => { if (!destroyed && !paused) nextSegment(); };
            if (paused) anim.pause();
        };

        const startSegment = (k, dir = 1, lastPage = false) => {
            if (pending) {
                segments = pending;
                queue = order(segments);
                pending = null;
                k = Math.min(Math.max(0, k), queue.length - 1);
            }
            clearTimers();
            if (!queue.length) {
                si = -1;
                paintEmpty();
                return;
            }
            si = ((k % queue.length) + queue.length) % queue.length;
            const seg = queue[si];
            if (seg.fav) sinceFav = 0;
            pages = (seg.mode || cfg.mode) === 'crawl' ? [seg.items] : paginate(seg);
            pi = lastPage ? pages.length - 1 : 0;
            paintLabel(seg);
            showPage(dir);
        };
        const nextSegment = () => startSegment(si + 1, 1);
        const nextPage = () => {
            if (destroyed) return;
            if (pi + 1 < pages.length) {
                pi++;
                showPage(1);
            } else nextSegment();
        };
        const prevPage = () => {
            if (pi > 0) {
                pi--;
                showPage(-1);
            } else startSegment(si - 1, -1, true);
        };

        const paintEmpty = () => {
            labelEl.classList.remove('fav');
            labelEl.innerHTML = '<span class="hb-tk-label-in"><b>HOMER</b></span>';
            view.querySelectorAll('.hb-tk-page').forEach((p) => p.remove());
            const page = document.createElement('div');
            page.className = 'hb-tk-page';
            page.innerHTML = `<span class="hb-tk-item"><span class="hb-tk-text dim">${esc(cfg.empty)}</span></span>`;
            view.appendChild(page);
            pageEl = page;
        };

        const setSegments = (segs) => {
            const list = Array.isArray(segs) ? segs : [];
            if (si < 0 || !queue.length) {
                segments = list;
                queue = order(list);
                pending = null;
                startSegment(0);
            } else {
                pending = list; // takes over at the next segment
            }
        };

        const refresh = async () => {
            clearTimeout(refreshTimer);
            if (destroyed || typeof cfg.source !== 'function') return;
            try {
                const segs = await cfg.source();
                if (!destroyed && segs) setSegments(segs);
            } catch (err) {
                console.warn('[HOMER Ticker]', err);
            }
            if (!destroyed && cfg.refreshMs > 0) refreshTimer = setTimeout(refresh, cfg.refreshMs);
        };

        paintEmpty();
        if (cfg.source) refresh();

        return {
            setSegments,
            refresh,
            pause() {
                paused = true;
                host.classList.add('paused');
                clearTimeout(timer);
                timer = 0;
                if (anim) anim.pause();
            },
            resume() {
                if (!paused) return;
                paused = false;
                host.classList.remove('paused');
                if (anim) anim.play();
                else if (si >= 0) timer = setTimeout(nextPage, cfg.pageMs);
            },
            // ◀▶ while it has the focus
            step(dir) {
                if (si < 0) return;
                const seg = queue[si];
                if ((seg.mode || cfg.mode) === 'crawl' && anim) {
                    const t = anim.currentTime || 0;
                    const total = anim.effect.getTiming().duration;
                    const jump = (500 / cfg.crawlSpeed) * 1000;
                    const nt = t + dir * jump;
                    if (nt < 0) { startSegment(si - 1, -1); return; }
                    if (nt >= total) { nextSegment(); return; }
                    anim.currentTime = nt;
                    return;
                }
                if (dir > 0) nextPage();
                else prevPage();
                if (paused) clearTimeout(timer);
            },
            // OK: the first item on screen that does something
            ok() {
                const e = pageEl && [...pageEl.querySelectorAll('.hb-tk-item')].find((x) => x._item && x._item.act);
                if (e) e._item.act();
                return !!e;
            },
            // the item on screen that OK would run (for the legend)
            actionable() {
                return !!(pageEl && [...pageEl.querySelectorAll('.hb-tk-item')].some((x) => x._item && x._item.act));
            },
            segments: () => segments,
            destroy() {
                destroyed = true;
                clearTimers();
                clearTimeout(refreshTimer);
                host.innerHTML = '';
                host.classList.remove('hb-tk', 'paused');
            }
        };
    };

    window.HomerTicker = { create, score, text, version: VERSION };
})();
