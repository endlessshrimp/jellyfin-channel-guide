/*
 * HOMER Books, phone layout: drawn instead of the TV screen when
 * shared/layout.js says phone (books/books.js decides). The same books and
 * player (books/books-model.js) and the same ruler and lines (books.js hands
 * them over), sized for a thumb:
 *
 *   Now listening   the book you're in: cover, where you are, Continue
 *   Your shelf      every book, two across: cover, title, author, time left
 *   A book          (tap one) its cover, description, Continue / Start over,
 *                   and the chapters (tap one to play from it)
 *   Listening       (Continue, or the bar at the bottom) the cover, the
 *                   chapter, the book's ruler and the controls
 *
 * A bar along the bottom shows what's playing while you browse; tap it for
 * Listening. Leaving Books pauses the book, like the TV layout.
 *
 * window.HomerBooksPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';
    const M = () => window.HomerBooksModel;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    const create = (ctx) => {
        const { esc, icon, rulerHtml, whereLine, peopleLine, metaLine, coverImg, chapterLabel, namedChapters, pct } = ctx;
        const player = () => M().player;
        const f = () => M().fmt;

        const root = el('div', 'homer-screen bk-phone');
        root.id = 'bk-root';
        root.style.visibility = 'hidden';
        root.innerHTML = `
            <div class="bkp-wash"></div>
            <div class="bkp-scroll">
                <section class="bkp-now"></section>
                <section class="bkp-shelf">
                    <h2 class="bkp-head"><span>Your shelf</span><span class="bkp-count"></span></h2>
                    <div class="bkp-grid"></div>
                </section>
                <div class="bkp-state"></div>
            </div>
            <button type="button" class="bkp-mini"></button>
            <div class="bkp-sheet bkp-book"></div>
            <div class="bkp-sheet bkp-listen"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const isCur = (b) => { const s = player().state(); return !!(b && s.book && s.book.id === b.id); };
        const posOf = (b) => (isCur(b) ? player().state().position : b.position);

        let sheets = []; // the open sheets ('book', 'listen'), the last on top
        let open = null; // the top one
        let bookId = null;
        const push = (k) => { sheets = sheets.filter((x) => x !== k); sheets.push(k); open = k; };

        const setWash = (b) => {
            const w = $('.bkp-wash');
            const paint = (rgb) => { w.style.setProperty('--wash', (rgb || [47, 140, 255]).join(',')); };
            if (!b) { paint(null); return; }
            if (b.rgb) paint(b.rgb); else M().color(b).then(paint);
        };

        // ----- Now listening -----
        const drawNow = () => {
            const box = $('.bkp-now');
            const b = M().nowListening() || M().books()[0];
            if (!b) { box.innerHTML = ''; return; }
            setWash(b);
            const s = player().state();
            const pos = posOf(b);
            const started = pos > 0 && !b.played;
            box.innerHTML = `
                <div class="bkp-now-cover">${coverImg(b, 600, 'bk-cover-img')}</div>
                <div class="bkp-eyebrow">${isCur(b) && s.playing ? 'Now listening' : started ? 'Now listening' : b.played ? 'Finished' : 'Start here'}</div>
                <h1 class="bkp-title">${esc(b.title)}</h1>
                <div class="bkp-people">${peopleLine(b)}</div>
                <div class="bkp-progress">${rulerHtml(b, pos)}<div class="bk-where">${whereLine(b, pos)}</div></div>
                <div class="bkp-acts">
                    <button type="button" class="bkp-btn primary" data-a="go">${icon(isCur(b) && s.playing ? 'graphic_eq' : 'play_arrow')}${isCur(b) && s.playing ? 'Now playing' : started ? 'Continue' : b.played ? 'Listen again' : 'Start listening'}</button>
                    <button type="button" class="bkp-btn" data-a="book">${icon('format_list_numbered')}Chapters</button>
                </div>`;
            box.querySelector('[data-a="go"]').onclick = () => {
                if (isCur(b) && s.playing) showListen();
                else listen(b, started ? null : 0);
            };
            box.querySelector('[data-a="book"]').onclick = () => showBook(b.id);
            if (!b.chapters) M().chapters(b);
            if (!b.extra) M().enrich(b);
        };

        // ----- the shelf -----
        const drawShelf = () => {
            const books = M().books();
            const grid = $('.bkp-grid');
            const total = books.reduce((t, b) => t + (b.duration || 0), 0);
            $('.bkp-count').textContent = books.length ? `${books.length} · ${f().len(total).replace(/ \d+ m$/, '')}` : '';
            grid.innerHTML = '';
            books.forEach((b) => {
                const p = pct(b, posOf(b));
                const card = el('button', 'bkp-card', `
                    <div class="bkp-card-cover">${coverImg(b, 400, 'bk-cover-img')}
                        ${p > 0 && !b.played ? `<div class="bkp-card-bar"><b style="width:${(p * 100).toFixed(1)}%"></b></div>` : ''}</div>
                    <div class="bkp-card-t">${esc(b.title)}</div>
                    <div class="bkp-card-a">${esc(b.author || '')}</div>
                    <div class="bkp-card-s">${b.played ? `<span class="done">${icon('check')}Finished</span>` : p > 0 ? `<span class="amber">${f().len(b.duration * (1 - p))} left</span>` : f().len(b.duration)}</div>`);
                card.type = 'button';
                card.onclick = () => showBook(b.id);
                grid.appendChild(card);
                if (!b.extra) M().enrich(b);
            });
        };

        // ----- a book -----
        const showBook = (id) => { bookId = id; push('book'); drawBook(); syncSheets(); };
        const drawBook = () => {
            const box = $('.bkp-book');
            const b = M().book(bookId);
            if (!b) { box.innerHTML = ''; return; }
            const pos = posOf(b);
            const started = pos > 0 && !b.played;
            const at = M().chapterAt(b, pos);
            box.innerHTML = `
                <div class="bkp-sheet-bar"><button type="button" class="bkp-back">${icon('arrow_back')}</button><span>${esc(b.title)}</span></div>
                <div class="bkp-sheet-body">
                    <div class="bkp-book-top">
                        <div class="bkp-book-cover">${coverImg(b, 600, 'bk-cover-img')}</div>
                        <div>
                            <h1 class="bkp-title">${esc(b.title)}</h1>
                            ${b.subtitle ? `<div class="bkp-sub">${esc(b.subtitle)}</div>` : ''}
                            <div class="bkp-people">${peopleLine(b)}</div>
                        </div>
                    </div>
                    <div class="bk-meta bkp-meta">${metaLine(b)}</div>
                    <div class="bkp-progress">${rulerHtml(b, pos)}<div class="bk-where">${whereLine(b, pos)}</div></div>
                    <div class="bkp-acts">
                        <button type="button" class="bkp-btn primary" data-a="go">${icon('play_arrow')}${started ? 'Continue' : b.played ? 'Listen again' : 'Start listening'}</button>
                        ${started ? `<button type="button" class="bkp-btn" data-a="over">${icon('replay')}Start over</button>` : ''}
                    </div>
                    <p class="bkp-desc">${esc(M().description(b) || '')}</p>
                    <h2 class="bkp-head"><span>Chapters</span><span class="bkp-count">${b.chapters && b.chapters.length > 1 ? b.chapters.length : ''}</span></h2>
                    <div class="bkp-chs">${b.chapters && b.chapters.length > 1 ? b.chapters.map((c, i) => {
                        const end = i + 1 < b.chapters.length ? b.chapters[i + 1].start : b.duration;
                        const fill = pos >= end ? 1 : pos <= c.start ? 0 : (pos - c.start) / (end - c.start);
                        const here = at && at.index === i && pos > 0;
                        return `<button type="button" class="bkp-ch${fill >= 1 ? ' done' : ''}${here ? ' here' : ''}" data-i="${i}">
                            <span class="bkp-ch-n">${i + 1}</span><span class="bkp-ch-name">${esc(namedChapters(b.chapters) ? c.name : `Chapter ${i + 1}`)}</span>
                            <span class="bkp-ch-len">${f().len(end - c.start)}</span><b style="width:${(fill * 100).toFixed(1)}%"></b></button>`;
                    }).join('') : `<div class="bkp-none">${b.chapters === null ? 'Reading the chapters…' : 'No chapters.'}</div>`}</div>
                </div>`;
            box.querySelector('.bkp-back').onclick = closeSheet;
            box.querySelector('[data-a="go"]').onclick = () => listen(b, started ? null : 0);
            const over = box.querySelector('[data-a="over"]');
            if (over) over.onclick = () => listen(b, 0);
            box.querySelectorAll('.bkp-ch').forEach((c) => { c.onclick = () => listen(b, b.chapters[+c.dataset.i].start); });
            setWash(b);
            if (!b.chapters) M().chapters(b);
            if (!b.extra) M().enrich(b);
        };

        // ----- Listening -----
        const listen = (b, from) => {
            player().play(b, from);
            bookId = b.id;
            showListen();
        };
        const showListen = () => { push('listen'); drawListen(); syncSheets(); };
        const drawListen = () => {
            const box = $('.bkp-listen');
            const s = player().state();
            const b = s.book || M().book(bookId);
            if (!b) { box.innerHTML = ''; return; }
            box.innerHTML = `
                <div class="bkp-sheet-bar"><button type="button" class="bkp-back">${icon('expand_more')}</button><span>Listening</span></div>
                <div class="bkp-sheet-body bkp-lv">
                    <div class="bkp-lv-cover">${coverImg(b, 800, 'bk-cover-img')}</div>
                    <h1 class="bkp-title">${esc(b.title)}</h1>
                    <div class="bkp-people">${peopleLine(b)}</div>
                    <div class="bkp-lv-ch"></div>
                    <div class="bkp-lv-chbar"><div class="bkp-lv-track"><b></b></div><div class="bkp-lv-times"><span class="a"></span><span class="b"></span></div></div>
                    <div class="bkp-lv-book"></div>
                    <div class="bkp-lv-ctl">
                        <button type="button" data-k="prev">${icon('skip_previous')}</button>
                        <button type="button" data-k="back">${icon('replay_30')}</button>
                        <button type="button" data-k="play" class="big">${icon('play_arrow')}</button>
                        <button type="button" data-k="fwd">${icon('forward_30')}</button>
                        <button type="button" data-k="next">${icon('skip_next')}</button>
                    </div>
                    <div class="bkp-lv-pills">
                        <button type="button" data-k="rate"><span>Speed</span><b></b></button>
                        <button type="button" data-k="sleep"><span>Sleep</span><b></b></button>
                    </div>
                    <div class="bkp-lv-err"></div>
                </div>`;
            box.querySelector('.bkp-back').onclick = closeSheet;
            const P = player();
            const acts = {
                prev: () => P.chapterJump(-1),
                back: () => P.skip(-30),
                play: () => { if (!P.state().book) listen(b, null); else P.toggle(); },
                fwd: () => P.skip(30),
                next: () => P.chapterJump(1),
                rate: () => P.cycleRate(),
                sleep: () => P.cycleSleep(),
            };
            box.querySelectorAll('[data-k]').forEach((btn) => { btn.onclick = acts[btn.dataset.k]; });
            setWash(b);
            paintListen();
        };
        const paintListen = () => {
            const box = $('.bkp-listen');
            if (!box.querySelector('.bkp-lv')) return;
            const s = player().state();
            const b = s.book || M().book(bookId);
            if (!b) return;
            const pos = s.book ? s.position : b.position;
            const at = M().chapterAt(b, pos);
            const q = (sel) => box.querySelector(sel);
            q('.bkp-lv-ch').innerHTML = at ? `<b>${esc(chapterLabel(b.chapters, at.index))}</b> <span>${namedChapters(b.chapters) ? `${at.index + 1} of ${at.count}` : `of ${at.count}`}</span>` : '';
            q('.bkp-lv-chbar').style.visibility = at ? '' : 'hidden';
            if (at) {
                q('.bkp-lv-track b').style.width = `${((at.into / Math.max(1, at.end - at.start)) * 100).toFixed(2)}%`;
                q('.bkp-lv-times .a').textContent = f().clock(at.into);
                q('.bkp-lv-times .b').textContent = '−' + f().clock(at.left);
            }
            const left = Math.max(0, (s.duration || b.duration) - pos) / (s.rate || 1);
            q('.bkp-lv-book').innerHTML = `${rulerHtml(b, pos)}<div class="bkp-lv-bookline"><span>${f().clock(pos)} in</span><span><b>${f().len(left)}</b> left</span></div>`;
            q('[data-k="play"]').innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
            q('[data-k="rate"] b').textContent = `${s.rate}×`;
            const sl = s.sleep;
            q('[data-k="sleep"] b').textContent = !sl ? 'Off' : sl.mode === 'chapter' ? 'Chapter end' : `${Math.ceil(sl.left / 60000)} min`;
            q('[data-k="sleep"]').classList.toggle('set', !!sl);
            q('.bkp-lv-err').textContent = s.error || '';
        };

        // ----- the bar along the bottom: what's playing -----
        const syncMini = () => {
            const s = player().state();
            const mini = $('.bkp-mini');
            const show = !!(s.book && open !== 'listen');
            root.classList.toggle('bkp-has-mini', show);
            if (!show) return;
            const at = M().chapterAt(s.book, s.position);
            mini.innerHTML = `<span class="bkp-mini-cover">${coverImg(s.book, 160, 'bk-cover-img')}</span>
                <span class="bkp-mini-text"><b>${esc(s.book.title)}</b><span>${at ? esc(chapterLabel(s.book.chapters, at.index)) + ' · ' : ''}${f().len(Math.max(0, s.duration - s.position))} left</span></span>
                <span class="bkp-mini-play" role="button">${icon(s.playing ? 'pause' : 'play_arrow')}</span>
                <i style="width:${(pct(s.book, s.position) * 100).toFixed(2)}%"></i>`;
        };
        $('.bkp-mini').onclick = (ev) => {
            if (ev.target.closest('.bkp-mini-play')) { player().toggle(); return; }
            showListen();
        };

        const syncSheets = () => {
            root.classList.toggle('bkp-open-book', sheets.includes('book'));
            root.classList.toggle('bkp-open-listen', open === 'listen');
            syncMini();
        };
        const closeSheet = () => {
            sheets.pop();
            open = sheets[sheets.length - 1] || null;
            if (open === 'book') drawBook();
            syncSheets();
            drawNow();
            drawShelf();
        };

        // ----- all of it -----
        const setState = (kind) => {
            const box = $('.bkp-state');
            box.innerHTML = kind === 'loading' ? '<b>Getting your books…</b>'
                : kind === 'error' ? '<b>Jellyfin didn\'t answer</b><button type="button" class="bkp-btn">Try again</button>'
                    : kind === 'empty' ? `<b>No audiobooks yet</b><span>${M().library() ? 'The Books library is empty, or Jellyfin is still scanning it.' : 'Jellyfin has no Books library. Add one (content type Books) in Jellyfin\'s Dashboard → Libraries.'}</span>` : '';
            root.dataset.state = kind || '';
            const retry = box.querySelector('button');
            if (retry) retry.onclick = reload;
        };
        const render = () => {
            if (!M().loaded()) { setState(M().error() ? 'error' : 'loading'); return; }
            if (!M().books().length) { setState('empty'); $('.bkp-now').innerHTML = ''; $('.bkp-grid').innerHTML = ''; return; }
            setState(null);
            drawNow();
            drawShelf();
            if (open === 'book') drawBook();
            else if (open === 'listen') drawListen();
            syncMini();
        };
        const reload = () => { if (!M().books().length) setState('loading'); M().load(true).catch(() => { if (!M().books().length) setState('error'); }); };

        let lastPaint = 0;
        const off = M().onChange((what) => {
            if (what === 'player') {
                if (open === 'listen') paintListen();
                if (Date.now() - lastPaint > 1000 || !player().state().playing) {
                    lastPaint = Date.now();
                    syncMini();
                }
                return;
            }
            render();
        });

        const onKey = (ev) => {
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            const t = ev.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (open) closeSheet(); else ctx.goBack();
        };
        document.addEventListener('keydown', onKey, true);

        // the top bar's name (BOOKS) closes the book and listening sheets and
        // leaves the shelf (shared/layout.js)
        const offHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (!open) return false;
                while (sheets.length) closeSheet();
                return true;
            }, { atTop: () => !open })
            : () => {};

        render();
        reload();

        return {
            phone: true,
            show() { root.style.visibility = ''; },
            sync() {},
            teardown() {
                try { player().pause(); } catch { /* nothing loaded */ }
                offHome();
                off();
                document.removeEventListener('keydown', onKey, true);
                root.remove();
            },
        };
    };

    window.HomerBooksPhone = { version: VERSION, create };
    if (window.HomerLayout) window.HomerLayout.register('books', { phone: true });
})();
