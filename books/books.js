/*
 * HOMER Books for Jellyfin Web: the audiobooks, on the same 1080-tall stage
 * as the other HOMER screens. HOMER's own page at #/books (Home's Books item).
 *
 *   Shelf     the book you're on, big: its cover, title, author, narrator,
 *             length, and where you are as a chapter ruler (every chapter a
 *             segment, as long as the chapter; the amber needle is you), with
 *             Continue / Start over / Chapters. Under it the shelf: every book
 *             face-out on a lit ledge, in progress first. The whole room takes
 *             the color of the cover you're on.
 *   Book      one book: the cover large, the description, the chapters as
 *             tiles (OK plays from one), Continue and Start over.
 *   Listening what's playing: the cover, the chapter and how far into it, the
 *             book's ruler, when you'll finish at this speed, and the controls
 *             (chapter back/next, 30 s back/forward, play/pause, speed, sleep).
 *
 * Data and the player: books/books-model.js (HomerBooksModel). Playback is
 * Jellyfin's stream in an <audio> element, so the resume position lands in
 * Jellyfin as you listen. Leaving Books pauses the book.
 *
 * #/books?id=<Jellyfin item id> opens that book's page (for links from
 * Search and elsewhere).
 *
 * Remote/keyboard: arrows move, OK selects, Esc/Backspace goes back a view
 * (then back a screen), H goes Home. Play/Pause (or P) pauses and resumes
 * anywhere on the screen; the media keys skip.
 *
 * On a phone (shared/layout.js) Books draws books/books-phone.js instead.
 *
 * window.HomerBooks = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerBooks && typeof window.HomerBooks.destroy === 'function') {
        window.HomerBooks.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="books/books.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/books\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'books/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const M = () => window.HomerBooksModel;

    // ---------- HomerPlayer (optional) ----------

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Books]', err); return fallback; }
    };
    const currentRoute = () => {
        const p = HP();
        if (p && typeof p.route === 'function') {
            const r = safe(() => p.route(), null);
            if (typeof r === 'string') return r;
        }
        return location.hash || '';
    };
    const go = (hash) => {
        const p = HP();
        if (p && typeof p.go === 'function') p.go(hash);
        else location.hash = hash;
    };
    const docked = () => {
        const p = HP();
        return !!(p && typeof p.docked === 'function' && safe(() => p.docked(), false));
    };
    const goBack = () => {
        const p = HP();
        if (docked() && typeof p.back === 'function') { p.back(); return; }
        const before = location.href;
        history.back();
        setTimeout(() => { if (location.href === before) go('#/home'); }, 400);
    };
    const goHome = () => {
        const p = HP();
        if (p && typeof p.goHome === 'function') p.goHome();
        else if (window.HomerHome && window.HomerHome.goHome) window.HomerHome.goHome();
        else location.hash = '#/home';
    };

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };
    const pct = (b, pos) => (b && b.duration ? Math.max(0, Math.min(1, (pos != null ? pos : b.position) / b.duration)) : 0);
    // a chapter's name when it says more than its number
    const namedChapters = (list) => !!list && list.some((c, k) => !new RegExp(`^(chapter|track|part)?\\s*0*${k + 1}\\.?$`, 'i').test(c.name.trim()));
    const chapterLabel = (list, i) => (namedChapters(list) ? list[i].name : `Chapter ${i + 1}`);

    // ---------- Pieces both views draw ----------

    // The chapter ruler: the whole book as a bar, a segment per chapter, filled
    // up to where you are, with the needle on you.
    const rulerHtml = (b, pos, opts = {}) => {
        const dur = (b && b.duration) || 0;
        const list = b && b.chapters && b.chapters.length > 1 ? b.chapters : null;
        const p = dur ? Math.max(0, Math.min(dur, pos)) : 0;
        const segs = [];
        if (list && dur) {
            list.forEach((c, i) => {
                const end = i + 1 < list.length ? list[i + 1].start : dur;
                const len = Math.max(0, end - c.start);
                const fill = p >= end ? 1 : p <= c.start ? 0 : (p - c.start) / len;
                segs.push(`<i style="flex-grow:${len.toFixed(1)}" class="${fill >= 1 ? 'done' : fill > 0 ? 'cur' : ''}"><b style="width:${(fill * 100).toFixed(2)}%"></b></i>`);
            });
        } else {
            segs.push(`<i style="flex-grow:1" class="${p > 0 ? 'cur' : ''}"><b style="width:${(dur ? p / dur * 100 : 0).toFixed(2)}%"></b></i>`);
        }
        const needle = p > 0 && dur ? `<span class="bk-needle" style="left:${(p / dur * 100).toFixed(3)}%"></span>` : '';
        const dense = list && list.length > 90 ? ' dense' : '';
        return `<div class="bk-ruler${opts.big ? ' big' : ''}${dense}"><div class="bk-ruler-segs">${segs.join('')}</div>${needle}</div>`;
    };

    // "Chapter 44 of 57 · 3 h 10 m left" (or "Not started · 12 h 53 m")
    const whereLine = (b, pos) => {
        const f = M().fmt;
        if (!b) return '';
        if (b.played && !(pos > 0)) return `<span class="bk-done-mark">${icon('check_circle')}Finished</span><span>${f.len(b.duration)}</span>`;
        if (!(pos > 0)) return `<span>Not started</span><span>${f.len(b.duration)}</span>`;
        const at = M().chapterAt(b, pos);
        const parts = [];
        if (at) parts.push(`<span><b>${esc(chapterLabel(b.chapters, at.index))}</b>${namedChapters(b.chapters) ? '' : ` of ${at.count}`}</span>`);
        parts.push(`<span><b>${f.len(b.duration - pos)}</b> left</span>`);
        const pc = pct(b, pos);
        parts.push(`<span class="bk-pct">${pc > 0 && pc < 0.01 ? '&lt;1' : Math.floor(pc * 100)}%</span>`);
        return parts.join('');
    };

    const peopleLine = (b) => {
        if (!b) return '';
        const who = b.author ? `<span class="bk-author">${esc(b.author)}</span>` : '';
        const nar = b.narrators && b.narrators.length ? `<span class="bk-narr">Read by ${esc(b.narrators.slice(0, 2).join(' & '))}</span>` : '';
        return who + nar;
    };
    const metaLine = (b) => {
        if (!b) return '';
        const f = M().fmt;
        const bits = [f.len(b.duration)];
        if (b.chapters && b.chapters.length > 1) bits.push(`${b.chapters.length} chapters`);
        const yr = b.year || (b.extra && b.extra.firstYear);
        if (yr) bits.push(String(yr));
        if (b.series) bits.push(`${b.series}${b.seriesIndex ? ` #${b.seriesIndex}` : ''}`);
        const subj = M().subjects(b);
        return bits.map((x) => `<span>${esc(x)}</span>`).join('') + subj.map((s) => `<span class="bk-subj">${esc(s)}</span>`).join('');
    };
    const coverImg = (b, h, cls) => {
        const url = M().coverUrl(b, h);
        const initials = esc((b && b.title) || '');
        return url
            ? `<img class="${cls || ''}" src="${esc(url)}" alt="" draggable="false" data-bk-cover="${esc(b.id)}">`
            : `<div class="${cls || ''} bk-nocover"><span>${initials}</span></div>`;
    };

    // ---------- The screen ----------

    const createScreen = () => {
        const root = el('div', 'homer-screen');
        root.id = 'bk-root';
        root.style.visibility = 'hidden'; // until books.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'bk-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="bk-wash"><div class="bk-wash-layer"></div><div class="bk-wash-layer"></div></div>
            <div class="bk-topbar">
                <div class="bk-brand homer-home" role="button" title="Home (H)"><span class="bk-brand-mark">${icon('home')}</span>HOMER<span class="bk-brand-sub">Books</span></div>
                <div class="bk-np" role="button"></div>
                <div class="bk-clock"><div class="bk-clock-time"></div><div class="bk-clock-date"></div></div>
            </div>
            <div class="bk-preview" data-homer-preview>${icon('live_tv')}</div>
            <div class="bk-view bk-shelf-view"></div>
            <div class="bk-view bk-book-view"></div>
            <div class="bk-view bk-listen-view"></div>
            <div class="bk-state"></div>
            <div class="bk-toast"><span class="bk-toast-text"></span></div>
            <div class="bk-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        const fit = () => {
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
            $('.bk-clock-time').textContent = M().fmt.time(d);
            $('.bk-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.bk-clock')) : () => {};

        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- state -----
        let view = 'shelf'; // shelf | book | listen
        let viewFrom = []; // where Back goes
        let heroId = null; // the book the shelf's big panel shows
        let bookId = null; // the Book view's book
        let focused = null;
        const remembered = {}; // per view: the focused element's key
        const player = () => M().player;

        // ----- toast -----
        let toastTimer = null;
        const toast = (text, err) => {
            const t = $('.bk-toast');
            t.querySelector('.bk-toast-text').textContent = text;
            t.classList.toggle('err', !!err);
            t.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
        };

        // ----- the room's color: the cover you're on -----
        let washFor = '';
        let washFlip = 0;
        const setWash = (b) => {
            const key = b ? b.id + '|' + M().coverUrl(b, 200) : '';
            if (key === washFor) return;
            washFor = key;
            const layers = stage.querySelectorAll('.bk-wash-layer');
            const next = layers[washFlip = 1 - washFlip];
            const prev = layers[1 - washFlip];
            const paint = (rgb) => {
                if (washFor !== key) return;
                const c = rgb ? rgb.join(',') : '47,140,255';
                const url = b ? M().coverUrl(b, 200) : '';
                next.style.setProperty('--wash', c);
                next.style.setProperty('--img', url ? `url("${url}")` : 'none');
                next.classList.add('on');
                prev.classList.remove('on');
                stage.style.setProperty('--book', c);
            };
            if (!b) { paint(null); return; }
            if (b.rgb) paint(b.rgb);
            else M().color(b).then(paint);
        };

        // ----- focus (spatial, like Home) -----
        const viewEl = (v) => $(`.bk-${v === 'book' ? 'book' : v}-view`);
        const focusables = () => [...viewEl(view).querySelectorAll('.bk-focusable')]
            .filter((e) => e.offsetParent !== null && !e.classList.contains('off'));
        const keyOf = (e) => (e && e.dataset.key) || '';
        const setFocus = (e, opts = {}) => {
            if (!e) return;
            if (focused && focused !== e) focused.classList.remove('focus');
            focused = e;
            e.classList.add('focus');
            remembered[view] = keyOf(e);
            reveal(e, opts.instant);
            if (typeof e._onFocus === 'function') e._onFocus();
            updateLegend();
        };
        const reveal = (e, instant) => {
            // a sideways row scrolls to keep the focus in it; a list scrolls down
            const row = e.closest('.bk-scroll-x');
            if (row) {
                const r = e.offsetLeft - row.clientWidth / 2 + e.offsetWidth / 2;
                row.scrollTo({ left: Math.max(0, r), behavior: instant ? 'auto' : 'smooth' });
            }
            const col = e.closest('.bk-scroll-y');
            if (col) {
                // in stage pixels (the stage is scaled): a shelf's whole row, or the tile
                const unit = e.closest('.bk-row') || e;
                const k = stage.getBoundingClientRect().height / 1080 || 1;
                const top = (unit.getBoundingClientRect().top - col.getBoundingClientRect().top) / k + col.scrollTop;
                const h = unit.offsetHeight;
                const pad = 16;
                if (top - pad < col.scrollTop) col.scrollTo({ top: Math.max(0, top - pad), behavior: instant ? 'auto' : 'smooth' });
                else if (top + h + pad > col.scrollTop + col.clientHeight) {
                    col.scrollTo({ top: top + h + pad - col.clientHeight, behavior: instant ? 'auto' : 'smooth' });
                }
            }
        };
        const move = (dir) => {
            const list = focusables();
            if (!focused || !list.includes(focused)) { setFocus(list[0]); return; }
            if (typeof focused._move === 'function' && focused._move(dir)) return;
            const a = focused.getBoundingClientRect();
            const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
            let best = null;
            let bestScore = Infinity;
            list.forEach((e) => {
                if (e === focused) return;
                const r = e.getBoundingClientRect();
                const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                let main;
                let cross;
                if (dir === 'left') { main = a.left - r.right; cross = Math.abs(c.y - ac.y); if (c.x >= ac.x - 2) return; }
                else if (dir === 'right') { main = r.left - a.right; cross = Math.abs(c.y - ac.y); if (c.x <= ac.x + 2) return; }
                else if (dir === 'up') { main = a.top - r.bottom; cross = Math.abs(c.x - ac.x); if (c.y >= ac.y - 2) return; }
                else { main = r.top - a.bottom; cross = Math.abs(c.x - ac.x); if (c.y <= ac.y + 2) return; }
                // same row/column first: overlap on the other axis is cheap
                const overlap = (dir === 'left' || dir === 'right')
                    ? Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)
                    : Math.min(a.right, r.right) - Math.max(a.left, r.left);
                const score = Math.max(0, main) + cross * (overlap > 0 ? 0.5 : 2.5);
                if (score < bestScore) { bestScore = score; best = e; }
            });
            if (best) setFocus(best);
        };
        const ok = () => { if (focused && typeof focused._ok === 'function') focused._ok(); };
        const focusable = (e, key, okFn, label) => {
            e.classList.add('bk-focusable');
            e.dataset.key = key;
            e._ok = okFn;
            if (label) e.dataset.okLabel = label;
            return e;
        };
        const restoreFocus = (fallback) => {
            const list = focusables();
            const want = remembered[view];
            const e = (want && list.find((x) => keyOf(x) === want)) || (fallback && list.find((x) => keyOf(x) === fallback)) || list[0];
            if (e) setFocus(e, { instant: true });
            else { focused = null; updateLegend(); }
        };

        // ----- views -----
        const showView = (v, opts = {}) => {
            if (v !== view && !opts.back) viewFrom.push(view);
            view = v;
            root.dataset.view = v;
            stage.querySelectorAll('.bk-view').forEach((x) => x.classList.toggle('on', x === viewEl(v)));
            if (v === 'shelf') drawShelf();
            else if (v === 'book') drawBook();
            else drawListen();
            restoreFocus(opts.focus);
            syncNp();
        };
        const back = () => {
            if (view !== 'shelf' || viewFrom.length) {
                const to = viewFrom.pop() || 'shelf';
                showView(to === view ? 'shelf' : to, { back: true });
                return;
            }
            goBack();
        };

        // ----- actions -----
        const listen = (b, from) => {
            if (!b) return;
            player().play(b, from);
            bookId = b.id;
            heroId = b.id;
            remembered.listen = 'play';
            showView('listen');
        };
        const isCur = (b) => { const s = player().state(); return !!(b && s.book && s.book.id === b.id); };

        // ============ Shelf ============
        const drawShelf = () => {
            const box = viewEl('shelf');
            const books = M().books();
            box.innerHTML = '';
            if (!books.length) return;
            if (!heroId || !M().book(heroId)) heroId = (M().nowListening() || books[0]).id;
            box.innerHTML = `
                <section class="bk-hero">
                    <div class="bk-hero-cover"></div>
                    <div class="bk-hero-text">
                        <div class="bk-eyebrow"></div>
                        <h1 class="bk-title"></h1>
                        <div class="bk-subtitle"></div>
                        <div class="bk-people"></div>
                        <div class="bk-meta"></div>
                        <p class="bk-desc"></p>
                        <div class="bk-progress">
                            <div class="bk-ruler-box"></div>
                            <div class="bk-where"></div>
                        </div>
                        <div class="bk-acts"></div>
                    </div>
                </section>
                <section class="bk-shelf">
                    <div class="bk-shelf-head"><span class="bk-shelf-title">Your shelf</span><span class="bk-shelf-count"></span></div>
                    <div class="bk-shelf-rows bk-scroll-y"></div>
                </section>`;
            drawShelfRows();
            drawHero();
        };

        // rows: one shelf for a small library; by status for a bigger one
        const shelfRows = () => {
            const books = M().books();
            if (books.length <= 7) return [{ key: 'all', label: '', items: books }];
            const rows = [
                { key: 'reading', label: 'Listening', items: books.filter((b) => !b.played && b.position > 0) },
                { key: 'next', label: 'Not started', items: books.filter((b) => !b.played && !(b.position > 0)) },
                { key: 'done', label: 'Finished', items: books.filter((b) => b.played) },
            ];
            return rows.filter((r) => r.items.length);
        };
        const drawShelfRows = () => {
            const box = viewEl('shelf').querySelector('.bk-shelf-rows');
            if (!box) return;
            const books = M().books();
            const f = M().fmt;
            const total = books.reduce((s, b) => s + (b.duration || 0), 0);
            viewEl('shelf').querySelector('.bk-shelf-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'} · ${f.len(total).replace(/ \d+ m$/, '')} of listening`;
            const rows = shelfRows();
            box.classList.toggle('multi', rows.length > 1);
            // a small library: each book's title and where you are beside its cover
            const roomy = rows.length === 1 && books.length * 560 <= stage.offsetWidth - 144;
            box.classList.toggle('roomy', roomy);
            box.innerHTML = '';
            rows.forEach((row, r) => {
                const rowEl = el('div', 'bk-row');
                if (row.label) rowEl.appendChild(el('div', 'bk-row-label', esc(row.label)));
                const track = el('div', 'bk-row-track bk-scroll-x');
                row.items.forEach((b) => {
                    const p = pct(b, isCur(b) ? player().state().position : b.position);
                    const tag = b.played ? `<span class="bk-tag done">${icon('check')}</span>`
                        : p > 0 ? `<span class="bk-tag">${p < 0.01 ? '&lt;1' : Math.floor(p * 100)}%</span>` : '';
                    const card = el('div', 'bk-book', `
                        <div class="bk-book-cover" style="--ar:${Math.max(0.6, Math.min(1.2, b.aspect || 1))}">${coverImg(b, 360, 'bk-cover-img')}${tag}
                            ${isCur(b) && player().state().playing ? '<span class="bk-eq"><i></i><i></i><i></i></span>' : ''}
                            ${p > 0 && !b.played ? `<div class="bk-book-bar"><b style="width:${(p * 100).toFixed(1)}%"></b></div>` : ''}</div>
                        ${roomy ? `<div class="bk-book-cap">
                            <div class="bk-book-t">${esc(b.title)}</div>
                            <div class="bk-book-a">${esc(b.author || '')}</div>
                            <div class="bk-book-s">${b.played ? `<span class="done">${icon('check')}Finished</span>`
                                : p > 0 ? `<span class="amber">${f.len(b.duration * (1 - p))} left</span>`
                                    : `<span>${f.len(b.duration)}</span>`}</div>
                        </div>` : ''}`);
                    card.dataset.id = b.id;
                    focusable(card, 'b:' + row.key + ':' + b.id, () => { bookId = b.id; remembered.book = null; showView('book'); }, 'Details');
                    card._onFocus = () => { if (heroId !== b.id) { heroId = b.id; drawHero(); } };
                    track.appendChild(card);
                });
                rowEl.appendChild(track);
                rowEl.appendChild(el('div', 'bk-ledge'));
                box.appendChild(rowEl);
                void r;
            });
        };

        const drawHero = () => {
            const box = viewEl('shelf');
            const b = M().book(heroId);
            if (!b || !box.querySelector('.bk-hero')) return;
            const s = player().state();
            const cur = isCur(b);
            const pos = cur ? s.position : b.position;
            const now = M().nowListening();
            const q = (sel) => box.querySelector(sel);
            setWash(b);
            // the cover (only swapped when it's another book, so it doesn't flash)
            const cov = q('.bk-hero-cover');
            const covKey = b.id + '|' + M().coverUrl(b, 720);
            if (cov.dataset.key !== covKey) {
                const again = cov.dataset.id === b.id; // the same book, a better cover: no bounce
                cov.dataset.key = covKey;
                cov.dataset.id = b.id;
                cov.style.setProperty('--ar', Math.max(0.6, Math.min(1.2, b.aspect || 1)));
                cov.innerHTML = coverImg(b, 720, 'bk-cover-img');
                if (!again) { cov.classList.remove('in'); void cov.offsetWidth; cov.classList.add('in'); }
            }
            const eyebrow = cur && s.playing ? `<span class="bk-chip live"><span class="bk-eq"><i></i><i></i><i></i></span>Now listening</span>`
                : cur || (now && now.id === b.id) ? `<span class="bk-chip amber">${icon('bookmark')}Now listening</span>`
                    : b.played ? `<span class="bk-chip green">${icon('check')}Finished</span>`
                        : pos > 0 ? `<span class="bk-chip amber">${icon('bookmark')}In progress</span>`
                            : `<span class="bk-chip">${icon('headphones')}Not started</span>`;
            q('.bk-eyebrow').innerHTML = eyebrow;
            q('.bk-title').textContent = b.title;
            q('.bk-title').classList.toggle('long', b.title.length > 28);
            q('.bk-subtitle').textContent = b.subtitle || '';
            q('.bk-people').innerHTML = peopleLine(b);
            q('.bk-meta').innerHTML = metaLine(b);
            q('.bk-desc').textContent = M().description(b);
            q('.bk-ruler-box').innerHTML = rulerHtml(b, pos);
            q('.bk-where').innerHTML = whereLine(b, pos);
            // the buttons: what OK means for this book right now
            const acts = q('.bk-acts');
            const had = focused && acts.contains(focused) ? keyOf(focused) : null;
            acts.innerHTML = '';
            const btn = (key, ic, label, fn, primary) => {
                const e = el('div', `bk-btn${primary ? ' primary' : ''}`, `${icon(ic)}<span>${esc(label)}</span>`);
                focusable(e, key, fn);
                acts.appendChild(e);
                return e;
            };
            if (cur && s.playing) {
                btn('a:main', 'graphic_eq', 'Now playing', () => showView('listen'), true);
                btn('a:pause', 'pause', 'Pause', () => { player().pause(); drawHero(); });
            } else if (pos > 0 && !b.played) {
                const at = M().chapterAt(b, pos);
                btn('a:main', 'play_arrow', at ? `Continue · ${chapterLabel(b.chapters, at.index).replace(/^Chapter /, 'Ch. ')}` : 'Continue', () => listen(b, null), true);
                btn('a:over', 'replay', 'Start over', () => listen(b, 0));
            } else {
                btn('a:main', 'play_arrow', b.played ? 'Listen again' : 'Start listening', () => listen(b, 0), true);
            }
            btn('a:book', 'format_list_numbered', 'Chapters', () => { bookId = b.id; remembered.book = 'chapters'; showView('book', { focus: 'chapters' }); });
            if (had) {
                const e = [...acts.children].find((x) => keyOf(x) === had) || acts.firstChild;
                setFocus(e, { instant: true });
            }
            fitHero();
            // fill in what Jellyfin didn't have
            if (!b.chapters) M().chapters(b);
            if (!b.extra) M().enrich(b);
        };
        // a long title or a long meta line: the description gives up lines, then goes
        const fitHero = () => {
            const text = viewEl('shelf').querySelector('.bk-hero-text');
            const desc = text && text.querySelector('.bk-desc');
            if (!desc) return;
            desc.style.display = '';
            desc.style.webkitLineClamp = '';
            const over = () => text.scrollHeight > text.clientHeight + 1;
            if (!over()) return;
            desc.style.webkitLineClamp = '1';
            if (over()) desc.style.display = 'none';
        };

        // ============ Book ============
        const drawBook = () => {
            const box = viewEl('book');
            const b = M().book(bookId);
            box.innerHTML = '';
            if (!b) return;
            setWash(b);
            const s = player().state();
            const cur = isCur(b);
            const pos = cur ? s.position : b.position;
            box.innerHTML = `
                <div class="bk-bv-left">
                    <div class="bk-bv-cover" style="--ar:${Math.max(0.6, Math.min(1.2, b.aspect || 1))}">${coverImg(b, 900, 'bk-cover-img')}</div>
                    <div class="bk-bv-acts"></div>
                </div>
                <div class="bk-bv-right">
                    <h1 class="bk-title">${esc(b.title)}</h1>
                    ${b.subtitle ? `<div class="bk-subtitle">${esc(b.subtitle)}</div>` : ''}
                    <div class="bk-people">${peopleLine(b)}</div>
                    <div class="bk-meta">${metaLine(b)}</div>
                    <p class="bk-bv-desc">${esc(M().description(b) || 'No description.')}</p>
                    <div class="bk-progress">${rulerHtml(b, pos)}<div class="bk-where">${whereLine(b, pos)}</div></div>
                    <div class="bk-ch-head">Chapters</div>
                    <div class="bk-chapters bk-scroll-y"></div>
                </div>`;
            box.querySelector('.bk-title').classList.toggle('long', b.title.length > 28);
            const acts = box.querySelector('.bk-bv-acts');
            const btn = (key, ic, label, fn, primary) => {
                const e = el('div', `bk-btn${primary ? ' primary' : ''}`, `${icon(ic)}<span>${esc(label)}</span>`);
                focusable(e, key, fn);
                acts.appendChild(e);
            };
            if (cur && s.playing) btn('a:main', 'graphic_eq', 'Now playing', () => showView('listen'), true);
            else if (pos > 0 && !b.played) {
                btn('a:main', 'play_arrow', 'Continue', () => listen(b, null), true);
                btn('a:over', 'replay', 'Start over', () => listen(b, 0));
            } else btn('a:main', 'play_arrow', b.played ? 'Listen again' : 'Start listening', () => listen(b, 0), true);
            drawChapters(b, pos);
            if (!b.chapters) M().chapters(b);
            if (!b.extra) M().enrich(b);
        };
        const drawChapters = (b, pos) => {
            const box = viewEl('book').querySelector('.bk-chapters');
            if (!box) return;
            const list = b.chapters;
            box.innerHTML = '';
            if (!list || list.length < 2) {
                box.innerHTML = `<div class="bk-ch-none">${b.chapters === null ? 'Reading the chapters…' : 'This book has no chapters.'}</div>`;
                // no chapters: the list's place still takes the focus, so ▶ from the buttons lands somewhere
                return;
            }
            const f = M().fmt;
            const named = namedChapters(list);
            box.classList.toggle('named', named);
            const at = M().chapterAt(b, pos);
            list.forEach((c, i) => {
                const end = i + 1 < list.length ? list[i + 1].start : b.duration;
                const len = end - c.start;
                const fill = pos >= end ? 1 : pos <= c.start ? 0 : (pos - c.start) / len;
                const here = at && at.index === i && pos > 0;
                const t = el('div', `bk-ch${fill >= 1 ? ' done' : ''}${here ? ' here' : ''}`, named
                    ? `<span class="bk-ch-n">${i + 1}</span><span class="bk-ch-name">${esc(c.name)}</span><span class="bk-ch-len">${f.len(len)}</span><b style="width:${(fill * 100).toFixed(1)}%"></b>`
                    : `<span class="bk-ch-n">${i + 1}</span><span class="bk-ch-len">${f.len(len)}</span><b style="width:${(fill * 100).toFixed(1)}%"></b>`);
                // the chapter you're in is "chapters": where Chapters (on the shelf) lands
                focusable(t, i === (at ? at.index : 0) ? 'chapters' : 'ch:' + i, () => listen(b, c.start), 'Play from here');
                box.appendChild(t);
            });
            // the chapter you're in, in view (a row above it showing)
            const here = box.querySelector('.bk-ch.here');
            if (here) {
                const k = stage.getBoundingClientRect().height / 1080 || 1;
                const top = (here.getBoundingClientRect().top - box.getBoundingClientRect().top) / k;
                box.scrollTop = Math.max(0, top - here.offsetHeight - 24);
            }
        };

        // ============ Listening ============
        const drawListen = () => {
            const box = viewEl('listen');
            const s = player().state();
            const b = s.book || M().book(bookId);
            box.innerHTML = '';
            if (!b) return;
            setWash(b);
            box.innerHTML = `
                <div class="bk-lv-cover" style="--ar:${Math.max(0.6, Math.min(1.2, b.aspect || 1))}">${coverImg(b, 1000, 'bk-cover-img')}</div>
                <div class="bk-lv-text">
                    <div class="bk-eyebrow"></div>
                    <h1 class="bk-title">${esc(b.title)}</h1>
                    <div class="bk-people">${peopleLine(b)}</div>
                    <div class="bk-lv-chapter"><span class="bk-lv-chname"></span><span class="bk-lv-chof"></span></div>
                    <div class="bk-lv-chbar"><div class="bk-lv-chtrack"><b></b></div><span class="bk-lv-chin"></span><span class="bk-lv-chleft"></span></div>
                    <div class="bk-lv-book">
                        <div class="bk-ruler-box"></div>
                        <div class="bk-lv-bookline"><span class="bk-lv-in"></span><span class="bk-lv-left"></span></div>
                    </div>
                    <div class="bk-lv-ctl">
                        <div class="bk-round" data-k="prev">${icon('skip_previous')}</div>
                        <div class="bk-round" data-k="back">${icon('replay_30')}</div>
                        <div class="bk-round big" data-k="play">${icon('play_arrow')}</div>
                        <div class="bk-round" data-k="fwd">${icon('forward_30')}</div>
                        <div class="bk-round" data-k="next">${icon('skip_next')}</div>
                        <span class="bk-lv-gap"></span>
                        <div class="bk-pill" data-k="rate"><span class="bk-pill-k">Speed</span><span class="bk-pill-v"></span></div>
                        <div class="bk-pill" data-k="sleep"><span class="bk-pill-k">Sleep</span><span class="bk-pill-v"></span></div>
                    </div>
                    <div class="bk-lv-err"></div>
                </div>`;
            box.querySelector('.bk-title').classList.toggle('long', b.title.length > 28);
            const P = player();
            const acts = {
                prev: [() => P.chapterJump(-1), 'Chapter back'],
                back: [() => P.skip(-30), 'Back 30 s'],
                play: [() => { if (!P.state().book) listen(b, null); else P.toggle(); }, 'Play / pause'],
                fwd: [() => P.skip(30), 'Forward 30 s'],
                next: [() => P.chapterJump(1), 'Next chapter'],
                rate: [() => { P.cycleRate(); toast(`Speed ${P.state().rate}×`); }, 'Change speed'],
                sleep: [() => { P.cycleSleep(); const sl = P.state().sleep; toast(sl ? (sl.mode === 'chapter' ? 'Sleep at the end of this chapter' : `Sleep in ${sl.mode} minutes`) : 'Sleep timer off'); }, 'Sleep timer'],
            };
            box.querySelectorAll('[data-k]').forEach((e) => focusable(e, e.dataset.k, acts[e.dataset.k][0], acts[e.dataset.k][1]));
            paintListen();
            if (!b.chapters) M().chapters(b);
        };
        const paintListen = () => {
            const box = viewEl('listen');
            if (!box.querySelector('.bk-lv-text')) return;
            const s = player().state();
            const b = s.book || M().book(bookId);
            if (!b) return;
            const f = M().fmt;
            const q = (sel) => box.querySelector(sel);
            const pos = s.book ? s.position : b.position;
            const dur = s.duration || b.duration;
            q('.bk-eyebrow').innerHTML = s.playing
                ? `<span class="bk-chip live"><span class="bk-eq"><i></i><i></i><i></i></span>${s.buffering ? 'Loading' : 'Now listening'}</span>`
                : `<span class="bk-chip amber">${icon('pause')}Paused</span>`;
            const at = M().chapterAt(b, pos);
            if (at) {
                q('.bk-lv-chname').textContent = chapterLabel(b.chapters, at.index);
                q('.bk-lv-chof').textContent = namedChapters(b.chapters) ? `${at.index + 1} of ${at.count}` : `of ${at.count}`;
                const len = at.end - at.start;
                q('.bk-lv-chtrack b').style.width = `${(len ? at.into / len * 100 : 0).toFixed(2)}%`;
                q('.bk-lv-chin').textContent = f.clock(at.into / 1);
                q('.bk-lv-chleft').textContent = '−' + f.clock(at.left);
                q('.bk-lv-chbar').style.visibility = '';
            } else {
                q('.bk-lv-chname').textContent = b.chapters === null ? '' : 'Whole book';
                q('.bk-lv-chof').textContent = '';
                q('.bk-lv-chbar').style.visibility = 'hidden';
            }
            q('.bk-ruler-box').innerHTML = rulerHtml(b, pos, { big: true });
            q('.bk-lv-in').textContent = `${f.clock(pos)} in`;
            const left = Math.max(0, dur - pos);
            const wall = left / (s.rate || 1);
            const end = new Date(Date.now() + wall * 1000);
            const sameDay = end.toDateString() === new Date().toDateString();
            q('.bk-lv-left').innerHTML = `<b>${f.len(wall)}</b> left${s.rate !== 1 ? ` at ${s.rate}×` : ''}${s.playing && wall < 20 * 3600 ? ` · done ${sameDay ? 'at' : end.toLocaleDateString([], { weekday: 'short' })} ${f.time(end)}` : ''}`;
            const play = q('[data-k="play"]');
            play.innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
            play.dataset.okLabel = s.playing ? 'Pause' : 'Play';
            q('[data-k="rate"] .bk-pill-v').textContent = `${s.rate}×`;
            const sl = s.sleep;
            q('[data-k="sleep"] .bk-pill-v').textContent = !sl ? 'Off' : sl.mode === 'chapter' ? 'End of chapter' : `${Math.ceil(sl.left / 60000)} min`;
            q('[data-k="sleep"]').classList.toggle('set', !!sl);
            q('.bk-lv-err').textContent = s.error || '';
            const chOk = !!(b.chapters && b.chapters.length > 1);
            q('[data-k="prev"]').classList.toggle('dim', !chOk);
            q('[data-k="next"]').classList.toggle('dim', !chOk);
            if (focused && focused.dataset.k === 'play') updateLegend();
        };

        // ----- the Now playing pill in the top bar (outside Listening) -----
        const syncNp = () => {
            const s = player().state();
            const np = $('.bk-np');
            const show = !!(s.book && view !== 'listen');
            np.classList.toggle('on', show);
            if (!show) return;
            const f = M().fmt;
            np.innerHTML = `${s.playing ? '<span class="bk-eq"><i></i><i></i><i></i></span>' : icon('pause')}<span class="bk-np-t">${esc(s.book.title)}</span><span class="bk-np-l">${f.len(Math.max(0, s.duration - s.position))} left</span>`;
        };

        // ----- model changes -----
        let lastPaint = 0;
        const onModel = (what) => {
            if (what === 'player') {
                const now = Date.now();
                if (view === 'listen') paintListen();
                // the rest only needs a repaint now and then (timeupdate is ~4 a second)
                if (now - lastPaint > 1000 || !player().state().playing) {
                    lastPaint = now;
                    syncNp();
                    if (view === 'shelf') {
                        const b = M().book(heroId);
                        if (b && isCur(b)) {
                            const pos = player().state().position;
                            const rb = viewEl('shelf').querySelector('.bk-ruler-box');
                            if (rb) rb.innerHTML = rulerHtml(b, pos);
                            const w = viewEl('shelf').querySelector('.bk-where');
                            if (w) w.innerHTML = whereLine(b, pos);
                        }
                    }
                }
                return;
            }
            if (what === 'books') { render(); return; }
            // chapters or Open Library arrived: repaint the view that shows them
            if (view === 'shelf') {
                drawHero();
                drawShelfRows();
                restoreFocus();
            } else if (view === 'book') {
                const k = focused ? keyOf(focused) : null;
                drawBook();
                const e = k && focusables().find((x) => keyOf(x) === k);
                setFocus(e || focusables()[0], { instant: true });
            } else paintListen();
        };
        const offModel = M().onChange(onModel);

        // ----- loading / empty -----
        const setState = (kind) => {
            const box = $('.bk-state');
            root.dataset.state = kind || '';
            if (!kind) { box.classList.remove('show'); box.innerHTML = ''; return; }
            box.classList.add('show');
            if (kind === 'loading') box.innerHTML = `<b>Getting your books…</b>`;
            else if (kind === 'error') box.innerHTML = `<div class="bk-state-icon">${icon('cloud_off')}</div><b>Jellyfin didn't answer</b><span>Press <em>OK</em> to try again.</span>`;
            else if (kind === 'empty') {
                box.innerHTML = `
                    <div class="bk-state-icon">${icon('auto_stories')}</div>
                    <b>No audiobooks yet</b>
                    <span>${M().library()
                        ? 'The Books library is empty, or Jellyfin is still scanning it. Books show up here as soon as it finds them.'
                        : 'Jellyfin has no Books library. In Jellyfin\'s Dashboard → Libraries, add one with content type <em>Books</em>, pointed at the folder with your .m4b files.'}</span>`;
            }
            updateLegend();
        };
        const render = () => {
            const books = M().books();
            if (!M().loaded()) { setState(M().error() ? 'error' : 'loading'); return; }
            if (!books.length) {
                viewEl('shelf').innerHTML = '';
                viewEl('book').innerHTML = '';
                setState('empty');
                setWash(null);
                return;
            }
            setState(null);
            // #/books?id=…: that book's page, once it's in the list
            if (openId && M().book(openId)) {
                bookId = heroId = openId;
                openId = null;
                viewFrom = ['shelf'];
                view = 'book';
                remembered.book = 'a:main';
            }
            if (view === 'book' && !M().book(bookId)) view = 'shelf';
            const k = focused ? keyOf(focused) : null;
            if (view === 'shelf') { drawShelf(); }
            else if (view === 'book') drawBook();
            else drawListen();
            stage.querySelectorAll('.bk-view').forEach((x) => x.classList.toggle('on', x === viewEl(view)));
            root.dataset.view = view;
            const e = k && focusables().find((x) => keyOf(x) === k);
            if (e) setFocus(e, { instant: true });
            else restoreFocus(view === 'shelf' ? 'a:main' : null);
            syncNp();
        };
        const reload = () => {
            setState(M().loaded() && M().books().length ? null : 'loading');
            M().load(true).catch(() => { if (!M().books().length) setState('error'); });
        };

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            const st = root.dataset.state;
            if (st === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (focused && focused.dataset.okLabel) items.push({ key: 'OK', label: focused.dataset.okLabel, action: 'ok' });
            else if (focused) items.push({ key: 'OK', label: 'Select', action: 'ok' });
            if (view === 'shelf' && M().books().length > 1) items.push({ key: '◀▶', label: 'Books' });
            if (player().state().book && view !== 'listen') items.push({ key: 'P', label: player().state().playing ? 'Pause' : 'Play', action: 'toggle' });
            items.push('spacer',
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: view === 'book' ? 'Shelf' : view === 'listen' && player().state().playing ? 'Back (keeps playing)' : 'Back', action: 'back' });
            $('.bk-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="bk-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        // ----- docked video (a TV channel playing when Books opened) -----
        const syncDocked = () => {
            root.classList.toggle('bk-docked', docked());
            updateLegend();
        };

        // ----- idle: a book playing on a TV for hours ----- after two minutes
        // without a key, the top bar and legend dim and Listening drifts a few
        // pixels a minute, so nothing sits still on the screen
        let lastInput = Date.now();
        const IDLE_MS = 120000;
        const idleTimer = setInterval(() => {
            const idle = view === 'listen' && player().state().playing && Date.now() - lastInput > IDLE_MS;
            root.classList.toggle('bk-idle', idle);
            const lv = viewEl('listen');
            if (idle) lv.style.transform = `translate(${Math.round(Math.random() * 40 - 20)}px, ${Math.round(Math.random() * 30 - 15)}px)`;
            else if (lv.style.transform) lv.style.transform = '';
        }, 60000);
        const wake = () => {
            lastInput = Date.now();
            if (root.classList.contains('bk-idle')) {
                root.classList.remove('bk-idle');
                viewEl('listen').style.transform = '';
            }
        };

        // ----- input -----
        // what P does: pause or resume the book that's loaded, or start the one
        // whose page you're on
        const togglePlay = () => {
            const P = player();
            if (P.state().book) P.toggle();
            else if (view === 'book' && M().book(bookId)) listen(M().book(bookId), null);
            if (view === 'shelf') drawHero();
        };
        const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        const onKey = (ev) => {
            wake();
            if (document.getElementById('cg-root')) return; // the guide is on top
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            const P = player();
            if (k === 'h' || k === 'H') { eat(ev); if (!ev.repeat) goHome(); return; }
            if (BACK_KEYS.includes(k)) { eat(ev); if (!ev.repeat) back(); return; }
            if (k === 'p' || k === 'P' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') {
                eat(ev);
                if (ev.repeat) return;
                togglePlay();
                return;
            }
            if (k === 'MediaTrackNext') { eat(ev); P.chapterJump(1); return; }
            if (k === 'MediaTrackPrevious') { eat(ev); P.chapterJump(-1); return; }
            if (k === 'MediaFastForward') { eat(ev); P.skip(30); return; }
            if (k === 'MediaRewind') { eat(ev); P.skip(-30); return; }
            if (k === 'MediaStop') { eat(ev); P.pause(); return; }
            const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
            if (dirs[k]) { eat(ev); move(dirs[k]); return; }
            if (k === 'Enter' || k === ' ') {
                eat(ev);
                if (ev.repeat) return;
                if (root.dataset.state === 'error') { reload(); return; }
                ok();
                return;
            }
            if (['PageUp', 'PageDown', 'Home', 'End'].includes(k)) eat(ev);
            // F, G and the rest pass through
        };
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            const col = ev.target.closest && ev.target.closest('.bk-scroll-y, .bk-scroll-x');
            if (col) { col.scrollBy({ top: ev.deltaY, left: ev.deltaX || (col.classList.contains('bk-scroll-x') ? ev.deltaY : 0) }); }
            ev.preventDefault();
            ev.stopImmediatePropagation();
        };
        const onClick = (ev) => {
            if (ev.target.closest('.bk-brand')) { goHome(); return; }
            if (ev.target.closest('.bk-np')) { showView('listen'); return; }
            if (ev.target.closest('.bk-preview')) { const p = HP(); if (p && p.fullscreen) p.fullscreen(); return; }
            const leg = ev.target.closest('.bk-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') back();
                else if (a === 'ok') { if (root.dataset.state === 'error') reload(); else ok(); }
                else if (a === 'toggle') { player().toggle(); if (view === 'shelf') drawHero(); }
                return;
            }
            const f = ev.target.closest('.bk-focusable');
            if (f && root.contains(f)) {
                if (f === focused) ok();
                else { setFocus(f); ok(); }
            }
        };
        const onMouse = (ev) => {
            wake();
            const f = ev.target.closest && ev.target.closest('.bk-focusable');
            if (f && f !== focused && root.contains(f) && !window.HomerLayout?.isTouch?.()) setFocus(f);
        };

        // a cover's real shape (Open Library's are 2:3, Audible's square): its box follows
        const onImgLoad = (ev) => {
            const img = ev.target;
            if (!img || !img.dataset || !img.dataset.bkCover || !img.naturalHeight) return;
            const ar = Math.max(0.6, Math.min(1.2, img.naturalWidth / img.naturalHeight));
            const b = M().book(img.dataset.bkCover);
            if (b) b.aspect = ar;
            const box = img.parentElement;
            if (box && Math.abs((parseFloat(box.style.getPropertyValue('--ar')) || 1) - ar) > 0.01) {
                box.style.setProperty('--ar', ar.toFixed(3));
                if (box.classList.contains('bk-hero-cover')) fitHero();
            }
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);
        stage.addEventListener('load', onImgLoad, true);
        stage.addEventListener('mouseover', onMouse);

        // open on the book you're listening to, if any (or the one the address names)
        let openId = (/[?&]id=([^&]+)/.exec(currentRoute()) || [])[1] || null;
        const startView = () => {
            const s = player().state();
            view = 'shelf';
            viewFrom = [];
            root.dataset.view = 'shelf';
            if (s.book) heroId = s.book.id;
            remembered.shelf = 'a:main';
            render();
        };
        // ----- the Actions strip (shared/actions.js) -----
        // Play/Pause is what you reach for on Books, so it's the main action: a
        // swipe up on the remote does it without opening the strip.
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            if (root.dataset.state === 'error') out.push({ id: 'retry', icon: 'refresh', label: 'Try again', run: () => reload() });
            const s = player().state();
            const start = !s.book && view === 'book' ? M().book(bookId) : null;
            out.push({
                id: 'play',
                key: 'P',
                icon: s.playing ? 'pause' : 'play_arrow',
                label: s.book && s.playing ? 'Pause' : 'Play',
                sub: s.book ? s.book.title : start ? start.title : '',
                main: true,
                run: togglePlay,
                disabled: !s.book && !start
            });
            return out;
        }, { id: 'books', title: 'Books' }) : () => {};

        // The top of this screen (the phone top bar's name, and the menu's own
        // Books item on a desktop): back out to the shelf.
        const offScreenHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (view === 'shelf') return false;
                viewFrom = [];
                showView('shelf', { back: true });
                return true;
            }, { atTop: () => view === 'shelf' })
            : () => {};

        startView();
        syncDocked();
        reload();

        return {
            phone: false,
            show() { root.style.visibility = ''; },
            sync: syncDocked,
            teardown() {
                offScreenHome();
                offActions();
                // leaving Books pauses the book (Jellyfin gets told where you are)
                safe(() => player().pause());
                offModel();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearInterval(idleTimer);
                clearTimeout(toastTimer);
                wxDetach();
                root.remove();
            },
        };
    };

    // ---------- Stylesheets ----------

    let cssReady = null;
    const ensureCss = () => {
        if (!document.getElementById('homer-tokens')) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE + '../shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
        if (cssReady && document.getElementById('bk-css')) return cssReady;
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
        cssReady = Promise.all([link('bk-css', 'books.css'), link('bk-phone-css', 'books-phone.css')]);
        return cssReady;
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false;
    let destroyed = false;

    const isOurRoute = () => /^#!?\/books(\?|$)/i.test(currentRoute());

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const phoneLayout = () => !!(window.HomerLayout && window.HomerBooksPhone && window.HomerLayout.usePhone('books'));
    const PHONE_CTX = { goHome, goBack, go, docked, esc, icon, rulerHtml, whereLine, peopleLine, metaLine, coverImg, chapterLabel, namedChapters, pct };
    const draw = () => (phoneLayout() ? window.HomerBooksPhone.create(PHONE_CTX) : createScreen());

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed || !M()) {
            closeScreen();
            return;
        }
        if (screen) { screen.sync(); return; }
        const s = draw();
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        closeScreen();
        lastSig = '';
        sync();
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    let unsubscribe = null;
    const subscribe = () => {
        const p = HP();
        if (unsubscribe || !p || typeof p.onChange !== 'function') return;
        const off = safe(() => p.onChange(onRouteChange), null);
        unsubscribe = typeof off === 'function' ? off : () => {};
    };

    let lastSig = '';
    let syncQueued = false;
    const queueSync = () => {
        if (syncQueued || destroyed) return;
        syncQueued = true;
        setTimeout(() => {
            syncQueued = false;
            subscribe();
            const sig = currentRoute() + '|' + location.href;
            if (sig === lastSig && (screen || !isOurRoute())) return;
            lastSig = sig;
            sync();
        }, 50);
    };
    const onRouteChange = () => {
        lastSig = '';
        queueSync();
    };

    let observer = null;
    const start = () => {
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerBooks = {
        version: VERSION,
        open() {
            suppressed = false;
            if (!isOurRoute()) { go('#/books'); return; }
            lastSig = '';
            sync();
        },
        close() {
            if (!screen) return;
            suppressed = true;
            closeScreen();
        },
        destroy() {
            destroyed = true;
            closeScreen();
            offLayout();
            observer && observer.disconnect();
            if (unsubscribe) safe(unsubscribe);
            unsubscribe = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('bk-css')?.remove();
            document.getElementById('bk-phone-css')?.remove();
            cssReady = null;
        },
    };
})();
