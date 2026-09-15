/*
 * HOMER Search, phone layout. search/search.js draws this instead of the TV
 * screen when shared/layout.js says Search is on a phone. Both search the
 * same way: search.js hands this layout its search (and the minute's cache),
 * where Back returns to, its navigation and its formatting, through ctx.
 *
 * The search box is at the top, where the phone's keyboard can't cover it; on
 * an empty search it has the focus, so the keyboard comes up. The kinds of
 * result are a sideways row of chips under it (All, Movies, TV Shows,
 * Episodes, Channels, On TV), and the results one list, grouped by kind:
 * posters and stills with the title and year for the library, channel logos
 * with what's on for Channels and On TV.
 *
 * Touch: a movie, show or episode opens its details screen. A channel, or a
 * program that's on now, plays in a strip under the top bar (HomerPlayer
 * docks the real video there) and the list keeps scrolling under it; a tap on
 * the strip goes full screen, ✕ stops it. An upcoming program records
 * instead (a toast says so), and ● on any program records it. On one that's
 * set to record, the first tap arms it ("Cancel?") and a second tap within a
 * few seconds cancels. Recording goes through the guide's model
 * (guide/guide-model.js), so it's one request at a time and never twice.
 *
 * Get it (shared/arr.js): shows and movies Sonarr and Radarr can get that
 * aren't in the library join the list once typing settles. A tap opens one
 * (what it is, its status, what can be done); a get button takes a second
 * tap. A library show Sonarr isn't getting new episodes of has a button for
 * that under its title.
 *
 * window.HomerSearchPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const CONFIRM_MS = 4000;
    const TICK_MS = 30000;
    const DEBOUNCE_MS = 280;
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const stop = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    };

    const create = (ctx) => {
        const U = ctx.util;
        const { esc, fmtTime, fmtMins, plural, runtime, posOf, played, pctOf, minsLeft, epCode, yearsOf,
            startOf, endOf, airing, elapsedPct, chNum, posterUrl, stillUrl, logoUrl, PLACEHOLDER } = U;
        const route = ctx.route;
        const P = () => window.HomerPlayer || null;

        // what the box asks for, by the kind of library the search came from
        const ct = String(route.collectionType || '').toLowerCase();
        const placeholder = ct === 'movies' ? 'Search movies' : ct === 'tvshows' ? 'Search shows and episodes'
            : ct === 'livetv' ? 'Search channels and TV' : 'Search movies, shows and TV';

        // ---------- Page ----------
        const root = el('div', 'homer-screen hs-phone');
        root.id = 'hs-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="sp-main">
                <div class="sp-dock">
                    <div class="sp-dock-video" data-homer-preview>
                        <div class="sp-dock-idle"><div class="sp-dock-logo"></div><div class="sp-dock-tuning">Tuning…</div></div>
                    </div>
                    <span class="sp-badge">Live</span>
                    <div class="sp-dock-ctl">
                        <button type="button" class="sp-dock-btn sp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                        <button type="button" class="sp-dock-btn sp-dock-stop" aria-label="Stop">${icon('close')}</button>
                    </div>
                    <div class="sp-dock-cap"><span class="sp-dock-what"></span><span class="sp-dock-left"></span></div>
                    <div class="sp-dock-bar"><b></b></div>
                </div>
                <div class="sp-head">
                    <form class="sp-search" role="search">
                        <span class="sp-search-icon">${icon('search')}<i class="sp-spin"></i></span>
                        <input class="sp-input" type="search" enterkeyhint="search" inputmode="search" placeholder="${esc(placeholder)}"
                            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search">
                        <button type="button" class="sp-clear" aria-label="Clear the search">${icon('close')}</button>
                    </form>
                    <div class="sp-chips" role="tablist" aria-label="Kinds of result"></div>
                </div>
                <div class="sp-body">
                    <div class="sp-list"><div class="sp-results"></div><div class="sp-state"></div></div>
                    <div class="sp-toast" role="status" aria-live="polite"></div>
                </div>
            </div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const input = $('.sp-input');
        const list = $('.sp-list');
        const resultsEl = $('.sp-results');
        const chipsEl = $('.sp-chips');
        const stateEl = $('.sp-state');

        let alive = true;
        let visible = false;
        let wantFocus = false; // the box gets the focus (and the keyboard) once it's showing
        let routeQuery = route.query; // the query in the address
        let query = null; // the query the results are for
        let status = 'idle'; // idle | loading | ready | error
        let results = []; // the last search's groups, all of them
        let filter = 'all'; // 'all', or the one kind shown
        let rows = []; // { kind, it, el, text?, btn? }
        let debounceTimer = 0;
        let searchToken = 0;
        let controller = null;
        let baseResults = []; // the last search's Jellyfin groups (results adds Get it)
        let lastTypeAt = 0;
        let arrFor = null; // { q, group } once Sonarr and Radarr have answered for q
        let arrPending = false;
        let arrTimer = 0;
        let arrCtl = null;
        let arrOpen = ''; // the Get it row that's open (its HomerArr key)

        const A = () => window.HomerArr || null;
        const rowKey = (r) => r && (r.kind === 'arr' && A() ? 'arr:' + A().key(r.it) : r.kind + ':' + r.it.Id);

        // ---------- Toast ----------
        const toastEl = $('.sp-toast');
        let toastTimer = 0;
        const showToast = (html, kind = '', ms = 3200) => {
            toastEl.innerHTML = html;
            toastEl.className = 'sp-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'sp-toast'; }, ms);
        };
        const toast = (msg, kind, ms) => showToast(`<span class="sp-toast-text">${esc(msg)}</span>`, kind, ms);

        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        // ---------- Channel logos, on the dark chip ----------
        const logoChip = (x, name) => {
            const url = logoUrl(x);
            const chip = el('div', 'sp-logo');
            const fallback = () => { chip.innerHTML = `<span class="sp-logo-name">${esc(name || '')}</span>`; };
            if (!url) {
                fallback();
                return chip;
            }
            const img = new Image();
            img.alt = '';
            img.decoding = 'async';
            img.onerror = fallback;
            img.src = url;
            chip.appendChild(img);
            if (window.HomerLogos) window.HomerLogos.watch(img, chip); // a dark logo is knocked out to white
            return chip;
        };

        // ---------- Recording (the guide's model: one request at a time, never twice) ----------
        let recModel = null;
        let timersLoaded = false;
        const rec = () => {
            if (!recModel && window.HomerGuideModel) recModel = window.HomerGuideModel.create(ctx.server);
            return recModel;
        };
        // a program as the guide's model holds one
        const itemOf = (p) => ({ p, s: new Date(startOf(p)), e: new Date(endOf(p)), unknown: false });
        const loadTimers = () => {
            const m = rec();
            if (!m || timersLoaded) return;
            timersLoaded = true;
            m.loadTimers().then(() => { if (alive) refillLive(); }).catch(() => { timersLoaded = false; });
        };

        let armed = null; // { id, timer } while a cancel waits for its second tap
        const disarm = () => {
            if (!armed) return;
            clearTimeout(armed.timer);
            armed = null;
            refillLive();
        };
        const arm = (item) => {
            const stopping = rec().recordingNow(item);
            armed = { id: item.p.Id, timer: setTimeout(disarm, CONFIRM_MS) };
            showToast(`<span class="sp-toast-q">${stopping ? 'Stop recording' : 'Cancel recording of'} <b>${esc(item.p.Name)}</b>?</span>`
                + '<span class="sp-toast-hint">Tap again</span>', 'confirm', CONFIRM_MS);
        };
        const schedule = async (item) => {
            const m = rec();
            toast(`Scheduling ${item.p.Name}…`, '', 60000);
            const ok = await m.schedule(item.p);
            if (!alive) return;
            refillLive();
            if (ok) toast(`${m.recordingNow(item) ? 'Recording' : 'Set to record'} ${item.p.Name}`, 'rec');
            else toast('Couldn\'t schedule that recording', 'err');
        };
        const cancel = async (item) => {
            const m = rec();
            const stopping = m.recordingNow(item);
            toast(`${stopping ? 'Stopping' : 'Cancelling'} ${item.p.Name}…`, '', 60000);
            const result = await m.cancel(item.p, stopping);
            if (!alive) return;
            refillLive();
            if (result === 'gone') toast(`${stopping ? 'Recording stopped' : 'Recording cancelled'}: ${item.p.Name}`);
            else if (result === 'unset') toast(`${item.p.Name} isn't set to record`);
            else if (result === 'kept') toast('Jellyfin still has that recording scheduled', 'err');
            else toast('Couldn\'t cancel that recording', 'err');
        };
        // ● on a program, or a tap on one that hasn't started
        const toggleRecord = (p) => {
            const m = rec();
            if (!m) {
                toast('Recording isn\'t available here', 'err');
                return;
            }
            const item = itemOf(p);
            if (m.isBusy(p.Id)) {
                toast(m.busyText() || `Still scheduling ${p.Name}…`);
                return;
            }
            const again = !!armed && armed.id === p.Id;
            if (armed) {
                clearTimeout(armed.timer);
                armed = null;
            }
            if (!m.recordable(item)) toast('No listing to record', 'err');
            else if (item.e <= new Date()) toast('That program has already ended', 'err');
            else if (!m.timersByProgram.has(p.Id)) schedule(item);
            else if (again) cancel(item);
            else arm(item);
            refillLive();
        };

        // ---------- Rows ----------
        // A library row: its art, title, year and the rest, and how far you've got.
        const libraryRow = (r) => {
            const it = r.it;
            let art = '';
            let meta = '';
            let flag = '';
            if (r.kind === 'movies' || r.kind === 'series') {
                const url = posterUrl(it, 180);
                art = `<div class="sp-art poster">${url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}">` : `<span>${esc((it.Name || '?').slice(0, 1))}</span>`}</div>`;
                if (r.kind === 'series') {
                    meta = [yearsOf(it), it.ChildCount ? plural(it.ChildCount, 'season') : '', it.OfficialRating].filter(Boolean).join(' · ');
                    const n = (it.UserData && it.UserData.UnplayedItemCount) || 0;
                    flag = n ? `<span class="sp-count">${n}</span>` : (played(it) ? `<span class="sp-check">${icon('check')}</span>` : '');
                } else {
                    meta = [it.ProductionYear, runtime(it), it.OfficialRating].filter(Boolean).join(' · ');
                }
            } else {
                const url = stillUrl(it, 320);
                art = `<div class="sp-art still">${url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}">` : ''}</div>`;
                meta = [epCode(it), it.SeriesName].filter(Boolean).join(' · ');
            }
            if (r.kind !== 'series') {
                if (posOf(it) > 0) flag = `<span class="sp-left">${fmtMins(minsLeft(it))} left</span>`;
                else if (played(it)) flag = `<span class="sp-check">${icon('check')}</span>`;
            }
            const pct = r.kind === 'series' ? 0 : pctOf(it);
            const e = el('div', 'sp-row sp-kind-' + r.kind, `${art}
                <div class="sp-text">
                    <div class="sp-title">${esc(it.Name)}</div>
                    <div class="sp-meta">${esc(meta)}</div>
                    ${pct ? `<div class="sp-bar"><b style="width:${pct}%"></b></div>` : ''}
                </div>
                ${flag ? `<div class="sp-flag">${flag}</div>` : ''}`);
            e.setAttribute('role', 'button');
            const img = e.querySelector('img');
            if (img) {
                img.onload = () => img.parentNode && img.parentNode.classList.add('has-img');
                img.onerror = () => img.remove();
            }
            return e;
        };

        // A channel or a program: the logo chip and number, then the text and
        // button that change with the time (fillLive).
        const liveRow = (r) => {
            const it = r.it;
            const e = el('div', 'sp-row sp-kind-' + r.kind);
            e.setAttribute('role', 'button');
            const chan = el('div', 'sp-chan');
            chan.appendChild(logoChip(it, r.kind === 'channels' ? it.Name : it.ChannelName));
            if (chNum(it)) chan.appendChild(el('span', 'sp-num', esc(chNum(it))));
            e.appendChild(chan);
            r.text = el('div', 'sp-text');
            e.appendChild(r.text);
            if (r.kind === 'channels') {
                e.appendChild(el('span', 'sp-go', icon('play_arrow')));
            } else {
                r.btn = el('button', 'sp-rec', '<i></i><span class="sp-rec-label"></span>');
                r.btn.type = 'button';
                e.appendChild(r.btn);
            }
            r.el = e;
            fillLive(r);
            return e;
        };

        const leftText = (end) => `${fmtMins((end - Date.now()) / 60000)} left`;
        const range = (p) => `${fmtTime(new Date(startOf(p))).replace(/\s?(AM|PM)$/i, '')} – ${fmtTime(new Date(endOf(p)))}`;
        const whenText = (p) => {
            const mins = Math.round((startOf(p) - Date.now()) / 60000);
            if (mins < 1) return 'Starting';
            if (mins < 60) return `In ${mins}m`;
            // later tonight, tomorrow, or later in the week: say when
            return ctx.startsLabel ? ctx.startsLabel(p) : `In ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
        };

        const fillLive = (r) => {
            const it = r.it;
            const now = Date.now();
            if (r.kind === 'channels') {
                const p = it.CurrentProgram && !PLACEHOLDER.test(it.CurrentProgram.Name || '') && airing(it.CurrentProgram, now) ? it.CurrentProgram : null;
                r.text.innerHTML = `<div class="sp-title">${esc(it.Name)}</div>`
                    + (p
                        ? `<div class="sp-meta"><span class="sp-now">Now</span>${esc(p.Name)}</div>`
                            + `<div class="sp-bar"><b style="width:${elapsedPct(p)}%"></b></div>`
                        : '<div class="sp-meta sp-none">No listings right now</div>');
                r.el.setAttribute('aria-label', `Watch ${it.Name}`);
                return;
            }
            const m = rec();
            const item = itemOf(it);
            const live = airing(it, now);
            const ended = endOf(it) <= now;
            const on = !!m && m.isSet(item);
            const recNow = on && m.recordingNow(item);
            const isArmed = !!armed && armed.id === it.Id;
            r.el.className = 'sp-row sp-kind-programs' + (live ? ' live' : '') + (on ? ' set' : '') + (recNow ? ' rec-now' : '') + (isArmed ? ' armed' : '');
            const when = ended ? '<span class="sp-when">Ended</span>'
                : live ? '<span class="sp-when live">Live</span>'
                    : `<span class="sp-when soon">${esc(whenText(it))}</span>`;
            const meta = range(it) + (live ? ` · ${leftText(endOf(it))}` : '');
            r.text.innerHTML = `<div class="sp-title">${on ? '<i class="sp-dot"></i>' : ''}${esc(it.Name)}</div>`
                + `<div class="sp-meta">${recNow ? '<span class="sp-recword">Recording · </span>' : on ? '<span class="sp-recword">Set to record · </span>' : ''}${when}${esc(meta)}</div>`
                + (live ? `<div class="sp-bar"><b style="width:${elapsedPct(it)}%"></b></div>` : '')
                + `<div class="sp-sub">${esc(it.ChannelName || '')}</div>`;
            const canRec = !!m && !ended && m.recordable(item);
            r.btn.hidden = !canRec;
            if (canRec) {
                const verb = !on ? 'Record' : recNow ? 'Stop' : 'Cancel';
                r.btn.querySelector('.sp-rec-label').textContent = isArmed ? verb + '?' : '';
                r.btn.setAttribute('aria-label', isArmed ? `Tap again to ${verb.toLowerCase()} this recording` : `${verb} ${it.Name}`);
            }
            r.el.setAttribute('aria-label', live ? `Watch ${it.ChannelName || it.Name}` : `${on ? 'Set to record' : 'Record'}: ${it.Name}`);
        };
        const refillLive = () => {
            for (const r of rows) if (r.text) fillLive(r);
        };

        // ---------- Get it: Sonarr and Radarr ----------
        const arrToast = (m) => {
            if (m.kind === 'confirm') {
                showToast(`<span class="sp-toast-q">${esc(m.question)}</span><span class="sp-toast-hint">${esc(m.hint)}</span>`, 'confirm arr', m.ms);
            } else {
                toast(m.text, m.kind === 'err' ? 'err' : m.kind === 'ok' ? 'got' : '', m.ms);
            }
        };
        // a view changed (an add, a fresh status): the rows that show it
        const refreshArr = () => {
            if (!alive) return;
            for (const r of rows) {
                if (r.kind === 'arr') fillArr(r);
                else if (r.arrLine) fillSeriesArr(r);
            }
        };
        const arrRun = A() ? A().runner({ hint: 'Tap again', toast: arrToast, update: refreshArr }) : null;
        const offArr = A() ? A().onChange(refreshArr) : () => {};
        const arrBtn = (a, v, cls) => {
            const busy = arrRun.busy(v);
            return `<button type="button" class="${cls}${arrRun.armed(a, v) ? ' armed' : ''}" data-a="${a.id}">${icon(busy ? 'hourglass_empty' : a.icon)}<span>${esc(busy ? 'Asking…' : arrRun.armed(a, v) ? a.label + '? Tap again' : a.label)}</span></button>`;
        };

        // A Get it row: poster, title, what it is and its flag; open, it says
        // more and has the get buttons
        const arrRow = (r) => {
            const H = A();
            const v = H.latest(r.it);
            const url = H.img(v.poster, 'thumb');
            const meta = v.kind === 'show'
                ? ['TV show', v.status === 'continuing' && v.year ? `Since ${v.year}` : v.year, v.network, v.seasons ? plural(v.seasons, 'season') : '']
                : ['Movie', v.year, v.runtime ? fmtMins(v.runtime) : '', v.studio];
            const e = el('div', 'sp-row sp-kind-arr', `<div class="sp-art poster">${url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}">` : `<span>${esc((v.title || '?').slice(0, 1))}</span>`}</div>
                <div class="sp-text">
                    <div class="sp-title">${esc(v.title)}</div>
                    <div class="sp-meta">${esc(meta.filter(Boolean).join(' · '))}</div>
                    <div class="sp-arr-flag"></div>
                </div>
                <div class="sp-arr-more"></div>`);
            e.setAttribute('role', 'button');
            const img = e.querySelector('img');
            if (img) {
                img.onload = () => img.parentNode && img.parentNode.classList.add('has-img');
                img.onerror = () => img.remove();
            }
            r.el = e;
            fillArr(r);
            return e;
        };
        const fillArr = (r) => {
            const H = A();
            if (!H || !r.el) return;
            const v = H.latest(r.it);
            const open = arrOpen === H.key(v);
            r.el.classList.toggle('open', open);
            r.el.querySelector('.sp-arr-flag').innerHTML = H.flagHtml(v);
            const more = r.el.querySelector('.sp-arr-more');
            if (!open) {
                more.innerHTML = '';
                return;
            }
            const detail = H.detailText(v);
            const acts = arrRun ? H.actions(v) : [];
            more.innerHTML = `<div class="sp-arr-status">${H.chipHtml(v)}${detail ? `<span>${esc(detail)}</span>` : ''}</div>`
                + (v.overview ? `<p class="sp-arr-desc">${esc(v.overview)}</p>` : '')
                + (acts.length ? `<div class="sp-arr-acts">${acts.map((a) => arrBtn(a, v, 'sp-arr-btn')).join('')}</div>` : '');
        };
        // A library show: whether Sonarr is getting its new episodes, and a
        // button to when it isn't
        const askedSeries = new Set();
        const wantSeries = (it) => {
            const id = ctx.tvdbOf(it);
            if (!id || !A() || askedSeries.has(id)) return;
            askedSeries.add(id);
            A().status({ tvdbId: id }).then(refreshArr).catch(() => { /* not in Sonarr's reach */ });
        };
        const seriesArr = (it) => {
            const id = ctx.tvdbOf(it);
            return id && A() ? A().peekStatus({ tvdbId: id }) : null;
        };
        const fillSeriesArr = (r) => {
            const v = seriesArr(r.it);
            if (!v || !arrRun) {
                r.arrLine.innerHTML = '';
                return;
            }
            const a = A().actions(v, { inLibrary: true }).find((x) => x.id === 'new');
            r.arrLine.innerHTML = a ? arrBtn(a, v, 'sp-arr-get') : A().flagHtml(v, { inLibrary: true });
        };

        // ---------- The list: every kind under its heading, or one ----------
        const countOf = (g) => `${g.items.length}${g.more ? '+' : ''}`;
        const build = (keepKey) => {
            resultsEl.innerHTML = '';
            rows = [];
            const found = results.filter((g) => g.items.length);
            if (filter !== 'all' && !found.some((g) => g.key === filter)) filter = 'all';
            const shown = found.filter((g) => filter === 'all' || g.key === filter);
            const frag = document.createDocumentFragment();
            for (const g of shown) {
                const sec = el('section', 'sp-group sp-group-' + g.key);
                // one kind chosen: its chip says what it is
                if (filter === 'all') sec.appendChild(el('h3', 'sp-group-head', `<span>${esc(g.label)}</span><i>${countOf(g)}</i>`));
                const box = el('div', 'sp-group-rows');
                for (const it of g.items) {
                    const r = { kind: g.key, it };
                    const e = g.key === 'arr' ? arrRow(r) : g.key === 'channels' || g.key === 'programs' ? liveRow(r) : libraryRow(r);
                    r.el = e;
                    // a library show: Sonarr's word on it under its title
                    if (g.key === 'series' && ctx.tvdbOf(it) && A()) {
                        r.arrLine = el('div', 'sp-arr-line');
                        e.querySelector('.sp-text').appendChild(r.arrLine);
                        fillSeriesArr(r);
                    }
                    e.dataset.i = rows.length;
                    box.appendChild(e);
                    rows.push(r);
                }
                sec.appendChild(box);
                frag.appendChild(sec);
            }
            // nothing still to come on TV: say so under the results
            const note = filter === 'all' && rows.length && ctx.tvNote ? ctx.tvNote(results) : null;
            if (note) {
                const n = el('div', 'sp-tvnote', `${icon('live_tv')}<div><b>${esc(note.text)}</b>${note.sub ? `<span>${esc(note.sub)}</span>` : ''}</div>`);
                // above Get it: it's about what's on TV
                const getIt = frag.querySelector('.sp-group-arr');
                if (getIt) frag.insertBefore(n, getIt);
                else frag.appendChild(n);
            }
            // Sonarr and Radarr are still looking: say so where Get it will go
            if (filter === 'all' && rows.length && arrPending) frag.appendChild(el('div', 'sp-arrnote', `${icon('hourglass_empty')}<span>Looking in Sonarr and Radarr…</span>`));
            resultsEl.appendChild(frag);
            // All, then one chip per kind found (a lone kind needs none)
            const total = found.reduce((a, g) => a + g.items.length, 0);
            const chips = found.length > 1
                ? [{ key: 'all', label: 'All', n: `${total}${found.some((g) => g.more) ? '+' : ''}` }, ...found.map((g) => ({ key: g.key, label: g.label, n: countOf(g) }))]
                : [];
            chipsEl.innerHTML = chips.map((c) => `<button type="button" class="sp-chip${c.key === filter ? ' on' : ''}" data-key="${c.key}" role="tab" aria-selected="${c.key === filter}">${esc(c.label)} <i>${c.n}</i></button>`).join('');
            root.classList.toggle('sp-has-chips', chips.length > 0);
            if (results.some((g) => g.key === 'programs' && g.items.length)) loadTimers();
            // back where you were: the row you picked (or had at the top)
            const keep = keepKey ? rows.findIndex((r) => rowKey(r) === keepKey) : -1;
            list.scrollTop = 0;
            if (keep >= 0) {
                const e = rows[keep].el;
                const head = e.closest('.sp-group').querySelector('.sp-group-head');
                list.scrollTop = Math.max(0, e.offsetTop - (head ? head.offsetHeight : 0) - 8);
            }
        };
        const setFilter = (key) => {
            if (key === filter) return;
            filter = key;
            build(null); // a new kind starts at its top
            const on = chipsEl.querySelector('.sp-chip.on');
            if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        chipsEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('.sp-chip');
            if (b) setFilter(b.dataset.key);
        });

        // the row at the top of the list, for coming back to it
        const topRow = () => {
            const y = list.scrollTop;
            return rows.find((r) => r.el.offsetTop + r.el.offsetHeight > y + 30) || null;
        };

        // ---------- Searching ----------
        const syncClear = () => root.classList.toggle('sp-has-text', !!input.value);
        const stopArr = () => {
            clearTimeout(arrTimer);
            if (arrCtl) arrCtl.abort();
            arrCtl = null;
            arrPending = false;
        };
        const withArr = (list) => (arrFor && arrFor.q === query && arrFor.group && arrFor.group.items.length ? list.concat([arrFor.group]) : list);
        // what the list says when it has nothing to show
        const showState = () => {
            if (rows.length) setState('');
            else if (baseResults.some((g) => g.failed)) {
                status = 'error';
                setState('<b>Couldn\'t search everything</b><span>Part of Jellyfin didn\'t answer.</span><button type="button" class="sp-retry">Try again</button>');
            } else if (arrPending) {
                setState(`<b>Nothing in your library for “${esc(query)}”</b><span>Looking in Sonarr and Radarr…</span>`);
            } else {
                // nothing anywhere; a show that was on TV earlier says when
                const note = ctx.tvNote ? ctx.tvNote(baseResults) : null;
                setState(`<b>Nothing found for “${esc(query)}”</b>`
                    + (note && note.sub ? `<span>${esc(note.text)}. ${esc(note.sub)}.</span>` : '')
                    + '<span>Try fewer letters, or another spelling.</span>');
            }
        };
        // Sonarr and Radarr are asked once typing has settled on a query (and
        // its Jellyfin results are in, for what to leave out); Get it joins the
        // list where it is
        const armArr = (q, found) => {
            stopArr();
            if (!A() || !ctx.arrKinds.length || (arrFor && arrFor.q === q)) return;
            arrPending = true;
            arrTimer = setTimeout(async () => {
                if (!alive || query !== q) return;
                const shows = (found.find((g) => g.key === 'series') || { items: [] }).items;
                shows.slice(0, 6).forEach(wantSeries);
                const ctl = new AbortController();
                arrCtl = ctl;
                let group = null;
                try {
                    group = await ctx.arrGroup(q, found, ctl.signal);
                } catch (err) {
                    if (ctl.signal.aborted) return;
                    console.warn('[HOMER Search] Sonarr/Radarr:', err);
                }
                if (!alive || ctl.signal.aborted || query !== q) return;
                arrCtl = null;
                arrPending = false;
                arrFor = { q, group };
                const y = list.scrollTop;
                results = withArr(baseResults);
                build(null);
                list.scrollTop = y;
                showState();
            }, Math.max(0, lastTypeAt + 650 - Date.now()));
        };
        const showIdle = () => {
            status = 'idle';
            clearTimeout(debounceTimer);
            stopArr();
            if (controller) controller.abort();
            query = '';
            results = [];
            build(null);
            root.classList.remove('sp-busy');
            setState(`<div class="sp-state-icon">${icon('search')}</div><b>${esc(placeholder)}</b><span>Results show up as you type.</span>`);
        };
        const runSearch = async (text, { keepKey = null, force = false } = {}) => {
            clearTimeout(debounceTimer);
            const q = String(text || '').trim();
            if (!force && q === query && status !== 'error') return;
            if (!q) {
                showIdle();
                return;
            }
            query = q;
            const token = ++searchToken;
            if (controller) controller.abort();
            controller = new AbortController();
            const signal = controller.signal;
            let found = force ? null : ctx.cached(q);
            if (!found) {
                status = 'loading';
                // keep the old results up while typing; only an empty list shows the spinner
                root.classList.add('sp-busy');
                if (!rows.length) setState('<div class="sp-spinner"></div><b>Searching…</b>');
                try {
                    found = await ctx.search(q, { force, signal });
                } catch (err) {
                    if (signal.aborted || !alive || token !== searchToken) return;
                    console.error('[HOMER Search]', err);
                    stopArr();
                    status = 'error';
                    root.classList.remove('sp-busy');
                    results = [];
                    build(null);
                    setState('<b>Couldn\'t search</b><span>Jellyfin didn\'t answer.</span><button type="button" class="sp-retry">Try again</button>');
                    return;
                }
            }
            if (!alive || token !== searchToken) return;
            status = 'ready';
            root.classList.remove('sp-busy');
            armArr(q, found);
            baseResults = found;
            results = withArr(found);
            build(keepKey);
            showState();
        };

        const focusInput = () => {
            if (!visible) {
                wantFocus = true;
                return;
            }
            try { input.focus({ preventScroll: true }); } catch { input.focus(); }
            try { input.setSelectionRange(0, input.value.length); } catch { /* not selectable */ }
        };

        input.addEventListener('input', () => {
            syncClear();
            lastTypeAt = Date.now();
            clearTimeout(debounceTimer);
            const text = input.value;
            debounceTimer = setTimeout(() => runSearch(text), text.trim() ? DEBOUNCE_MS : 0);
        });
        // the keyboard's Search key: search now, and put the keyboard away to show the results
        $('.sp-search').addEventListener('submit', (ev) => {
            ev.preventDefault();
            runSearch(input.value);
            input.blur();
        });
        $('.sp-clear').addEventListener('click', () => {
            input.value = '';
            syncClear();
            showIdle();
            focusInput();
        });
        input.addEventListener('focus', () => root.classList.add('sp-typing'));
        input.addEventListener('blur', () => root.classList.remove('sp-typing'));
        stateEl.addEventListener('click', (ev) => {
            if (ev.target.closest('.sp-retry')) runSearch(input.value, { force: true });
        });

        // ---------- Tapping a result ----------
        const watch = (r) => {
            const it = r.it;
            const channelId = r.kind === 'channels' ? it.Id : it.ChannelId;
            const name = r.kind === 'channels' ? it.Name : it.ChannelName;
            let program;
            if (r.kind === 'programs' && airing(it)) program = it;
            else if (r.kind === 'channels' && it.CurrentProgram && airing(it.CurrentProgram)) {
                program = { ...it.CurrentProgram, ChannelName: it.Name, ChannelNumber: chNum(it) };
            } else {
                program = { Name: name, ChannelId: channelId, ChannelName: name, ChannelNumber: chNum(it) };
            }
            input.blur();
            toast(`Tuning ${name || 'channel'}`);
            try {
                ctx.watchChannel(channelId, program);
            } catch (err) {
                console.error('[HOMER Search] Watch failed:', err);
                toast('Couldn\'t start the channel', 'err');
            }
            syncDock();
        };
        const onListClick = (ev) => {
            const e = ev.target.closest('.sp-row');
            const r = e && rows[Number(e.dataset.i)];
            if (!r) return;
            // a get button (on a Get it row, or under a library show's title)
            const get = ev.target.closest('.sp-arr-btn, .sp-arr-get');
            if (get && arrRun) {
                const v = r.kind === 'arr' ? r.it : seriesArr(r.it);
                const a = v && A().actions(v, { inLibrary: r.kind !== 'arr' }).find((x) => x.id === get.dataset.a);
                if (a) arrRun.press(a, v);
                return;
            }
            if (r.kind === 'arr') {
                // open it (one at a time), or close it
                const k = A().key(r.it);
                arrOpen = arrOpen === k ? '' : k;
                for (const x of rows) if (x.kind === 'arr') fillArr(x);
                if (arrOpen) setTimeout(() => { if (alive) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 0);
                return;
            }
            if (r.kind === 'programs') {
                // ● records; the row watches what's on now, and records what's still to come
                if (ev.target.closest('.sp-rec') || !airing(r.it)) {
                    if (endOf(r.it) > Date.now()) toggleRecord(r.it);
                    return;
                }
                watch(r);
                return;
            }
            if (r.kind === 'channels') {
                watch(r);
                return;
            }
            // Back comes back to this search, at this result
            ctx.remember(routeQuery, { query, key: rowKey(r), filter, at: Date.now() });
            ctx.go(ctx.detailsHash(r.it.Id));
        };
        list.addEventListener('click', onListClick);
        // a finger on the results puts the keyboard away, so they can be seen
        const onTouchMove = () => {
            if (document.activeElement === input) input.blur();
        };
        list.addEventListener('touchmove', onTouchMove, { passive: true });

        // ---------- The keyboard ----------
        // The phone's keyboard covers the bottom of the window without making it
        // any smaller (iPhones; Android's Chrome too): the list gets room at
        // its end so its last results can come up above it.
        const vv = window.visualViewport || null;
        const onViewport = () => {
            if (!vv) return;
            const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
            root.style.setProperty('--sp-kb', kb + 'px');
        };
        if (vv) {
            vv.addEventListener('resize', onViewport);
            vv.addEventListener('scroll', onViewport);
        }

        // ---------- Docked video ----------
        // The strip a video plays in: HomerPlayer pins the real video over
        // [data-homer-preview] (and a tap there goes full screen); this draws
        // what's around it.
        const dockLogo = $('.sp-dock-logo');
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked());
            root.classList.toggle('sp-docked', on);
            if (!on) {
                root.classList.remove('sp-dock-live');
                dockFor = null;
                return;
            }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('sp-dock-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying();
            const p = np && np.program;
            const item = np && np.item;
            const now = Date.now();
            const s = p && Date.parse(p.StartDate);
            const e = p && Date.parse(p.EndDate);
            $('.sp-dock-what').textContent = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ')
                : item ? item.Name || '' : '';
            $('.sp-dock-left').textContent = p && e > now ? leftText(e) : '';
            $('.sp-dock-bar b').style.width = p && s && e > s ? Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100)) + '%' : '0';
            $('.sp-badge').hidden = !p;
            const key = p ? p.ChannelId : item ? item.Id : '';
            if (key !== dockFor) {
                dockFor = key;
                dockLogo.innerHTML = '';
                if (p && p.ChannelId) dockLogo.appendChild(logoChip({ ChannelId: p.ChannelId }, p.ChannelName));
            }
        };
        $('.sp-dock-ctl').addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            if (ev.target.closest('.sp-dock-stop')) hp.stop();
            else if (ev.target.closest('.sp-dock-full')) hp.fullscreen();
            syncDock();
        });
        const offPlayer = P() && typeof P().onChange === 'function' ? P().onChange(syncDock) : () => {};

        // ---------- Keys (a hardware keyboard), scrolling, focus ----------
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key;
            if (ev.target === input) {
                if (k === 'Escape') {
                    stop(ev);
                    input.blur();
                } else {
                    ev.stopPropagation(); // typing; keep Jellyfin's shortcuts out of it (Enter still submits)
                }
                return;
            }
            if (BACK_KEYS.includes(k)) {
                stop(ev);
                ctx.goBack();
            } else if (k === '/') {
                stop(ev);
                focusInput();
            }
        };
        document.addEventListener('keydown', onKey, true);
        // Scrolling here is Search's alone: Jellyfin's player page turns scroll
        // gestures into volume changes. (The list still scrolls.)
        const onWheelCapture = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });
        // Jellyfin's search page underneath focuses its own search box when it
        // renders; typing must land in ours (moving the focus straight across
        // keeps the phone's keyboard up).
        const onFocusIn = (ev) => {
            const t = ev.target;
            if (!alive || root.contains(t) || !ctx.isTyping(t)) return;
            if (t.closest && t.closest('.homer-screen, #cg-root, .hs-kb-proxy')) return;
            if (visible && (wantFocus || root.classList.contains('sp-typing'))) focusInput();
            else if (!ctx.refocusKeyboard()) t.blur();
        };
        document.addEventListener('focusin', onFocusIn, true);

        // Now moves on: progress bars, time left, programs that start and end.
        const tickTimer = setInterval(refillLive, TICK_MS);
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing

        // don't leave a Jellyfin control underneath focused
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && !(ae.classList && ae.classList.contains('hs-kb-proxy')) && typeof ae.blur === 'function') ae.blur();

        // ---------- Start: back where you left off, or the address's query ----------
        const start = (q) => {
            const saved = ctx.recall(routeQuery);
            const text = saved ? saved.query : q;
            filter = saved && saved.filter ? saved.filter : 'all';
            input.value = text || '';
            syncClear();
            if (!input.value.trim()) {
                showIdle();
                focusInput(); // an empty search: the keyboard comes up
                return;
            }
            wantFocus = false;
            runSearch(input.value, { keepKey: saved && saved.key });
        };
        start(routeQuery);
        syncDock();
        onViewport();

        return {
            phone: true,
            key: route.key,
            show() {
                root.style.visibility = '';
                visible = true;
                // anything typed into the stand-in box while this was opening
                const held = ctx.heldKeyboard();
                if (held != null) {
                    wantFocus = true;
                    if (held && !input.value) {
                        input.value = held;
                        syncClear();
                        runSearch(held);
                    }
                }
                if (wantFocus) {
                    wantFocus = false;
                    focusInput();
                }
                ctx.dropKeyboard();
            },
            // the top bar's Search while this is up: back to the box
            focusInput() {
                if (list.scrollTop > 0 && !input.value) list.scrollTop = 0;
                focusInput();
            },
            // the address changed to another query while the screen is up
            update(next) {
                if (next.query === routeQuery) return;
                routeQuery = next.query;
                start(routeQuery);
            },
            // where this search is, for the TV layout (or coming back)
            remember() {
                const r = topRow();
                ctx.remember(routeQuery, { query: input.value.trim() || query || '', key: rowKey(r), filter, at: Date.now() });
            },
            teardown() {
                alive = false;
                clearTimeout(debounceTimer);
                clearTimeout(toastTimer);
                clearInterval(tickTimer);
                clearInterval(dockTimer);
                stopArr();
                if (arrRun) arrRun.dispose();
                offArr();
                if (armed) clearTimeout(armed.timer);
                if (controller) controller.abort();
                if (recModel) recModel.dispose();
                offPlayer();
                if (vv) {
                    vv.removeEventListener('resize', onViewport);
                    vv.removeEventListener('scroll', onViewport);
                }
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('focusin', onFocusIn, true);
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                root.remove();
            }
        };
    };

    window.HomerSearchPhone = { version: VERSION, create };
    // tell the layout Search has a phone layout (a search already open on a
    // phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('search', { phone: true });
})();
