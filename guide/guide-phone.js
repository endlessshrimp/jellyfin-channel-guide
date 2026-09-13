/*
 * Channel Guide, phone layout. guide/guide.js draws this instead of the TV
 * grid when shared/layout.js says the guide is on a phone; both draw from the
 * same model (guide/guide-model.js).
 *
 * One row per channel: its logo and number, what's on (with how long is left
 * and a progress bar), what's next, and a ● button that records it. A time
 * rail picks what the rows show (Now, or any half hour ahead, TiVo-style);
 * category and country chips narrow the list, as on TV. Channels with nothing
 * listed get a slim row.
 *
 * Touch: ● records (a toast says so). On a program that's set to record, the
 * first tap arms it ("Cancel?", or "Stop?" while it's recording) and a second
 * tap within a few seconds cancels. A tap anywhere else on a row opens a sheet
 * with the program, a Record button, and Watch for what's on now.
 *
 * Watch plays the channel in a strip under the top bar (HomerPlayer docks the
 * real video there), and the list keeps scrolling under it. A tap on the strip
 * goes full screen, ✕ stops it.
 *
 * Only the rows on screen (and a few either side) are in the page, so 270-odd
 * channels scroll like a short list.
 *
 * window.HomerGuidePhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Row heights come from the stylesheet (--gp-row-h, --gp-slim-h), which
    // makes them shorter in landscape; these are the portrait ones.
    const ROW_H = 84; // a channel with a program
    const SLIM_H = 52; // a channel with nothing listed
    const GAP = 7;
    const OVERSCAN = 6; // rows drawn above and below the screen
    const RAIL_DAYS = 7; // the time rail goes this far ahead (or to the end of the listings)
    const CONFIRM_MS = 4000;
    const TICK_MS = 30000;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    const create = (ctx) => {
        const M = window.HomerGuideModel;
        const { fmtTime, fmtShort, floorSlot, dayWord, genreOf, genreLabel, MIN_MS, CHUNK_MIN } = M.util;
        const m = ctx.model;
        const P = () => window.HomerPlayer || null;
        const saved = ctx.state || {};

        // ---------- Where the guide is ----------
        let category = saved.category || 'all';
        let country = saved.country || 'all';
        let at = null; // the time the rows show: null for now, else a half hour ahead
        if (saved.start && saved.start >= floorSlot(Date.now()) + 30 * MIN_MS) at = floorSlot(saved.start);
        const shownTime = () => at || Date.now();

        // ---------- Page ----------
        const root = el('div', 'cg-phone');
        root.id = 'cg-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="gp-main">
                <div class="gp-dock" data-homer-preview>
                    <div class="gp-dock-idle"><div class="gp-dock-logo"></div><div class="gp-dock-tuning">Tuning…</div></div>
                    <span class="gp-badge">Live</span>
                    <div class="gp-dock-ctl">
                        <button type="button" class="gp-dock-btn gp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                        <button type="button" class="gp-dock-btn gp-dock-stop" aria-label="Stop">${icon('close')}</button>
                    </div>
                    <div class="gp-dock-cap"><span class="gp-dock-what"></span><span class="gp-dock-left"></span></div>
                    <div class="gp-dock-bar"><b></b></div>
                </div>
                <div class="gp-side">
                    <div class="gp-head">
                        <div class="gp-chips" role="tablist" aria-label="Channel categories"></div>
                        <div class="gp-rail" aria-label="Time"><span class="gp-day"></span><div class="gp-slots"></div></div>
                    </div>
                    <div class="gp-list"><div class="gp-canvas"></div><div class="gp-empty"></div></div>
                </div>
            </div>
            <div class="gp-toast" role="status" aria-live="polite"></div>
            <div class="gp-scrim"></div>
            <div class="gp-sheet" role="dialog" aria-modal="true"><div class="gp-grab"></div><div class="gp-sheet-body"></div></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const list = $('.gp-list');
        const canvas = $('.gp-canvas');

        // ---------- Toast ----------
        const toastEl = $('.gp-toast');
        let toastTimer = 0;
        const showToast = (html, kind = '', ms = 3200) => {
            toastEl.innerHTML = html;
            toastEl.className = 'gp-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'gp-toast'; }, ms);
        };
        const toast = (msg, kind, ms) => showToast(`<span class="gp-toast-text">${esc(msg)}</span>`, kind, ms);

        // ---------- Channels ----------
        let rows = []; // { i, ch, cats, country }
        let order = []; // the rows in this category and country
        const byId = new Map(); // channel id -> row
        const inScope = (row) => row.cats.has(category) && (country === 'all' || row.country === country);

        // What a row shows at time t: the program airing then (item), the one
        // after it, and what kind of row that makes.
        const lookup = (row, t) => {
            let cur = null;
            let next = null;
            for (const p of m.sortedFor(row.ch.Id)) {
                if (p._e <= t) continue;
                if (p._s <= t) {
                    if (!cur) cur = p;
                    continue;
                }
                if (!M.PLACEHOLDER.test(p.Name)) {
                    next = p;
                    break;
                }
            }
            const i = m.chunkOf(t);
            if (!cur || M.PLACEHOLDER.test(cur.Name)) {
                const kind = cur || m.chunkReady(i) ? 'none' : m.chunkFailed(i) ? 'failed' : 'loading';
                return { kind, item: null, next };
            }
            const item = { p: cur, s: new Date(cur._s), e: new Date(cur._e), unknown: false };
            return { kind: 'prog', item, next };
        };

        // ---------- Recording ----------
        let armed = null; // { id, timer } while a cancel waits for its second tap
        const disarm = () => {
            if (!armed) return;
            clearTimeout(armed.timer);
            armed = null;
            refresh();
        };
        const arm = (it) => {
            const stopping = m.recordingNow(it);
            armed = { id: it.p.Id, timer: setTimeout(disarm, CONFIRM_MS) };
            refresh();
            showToast(`<span class="gp-toast-q">${stopping ? 'Stop recording' : 'Cancel recording of'} <b>${esc(it.p.Name)}</b>?</span>`
                + '<span class="gp-toast-hint">Tap again</span>', 'confirm', CONFIRM_MS);
        };
        const alive = () => ctx.isOpen(self);

        const schedule = async (it) => {
            toast(`Scheduling ${it.p.Name}…`, '', 60000);
            const ok = await m.schedule(it.p);
            if (!alive()) return;
            refresh();
            if (ok) toast(`${m.recordingNow(it) ? 'Recording' : 'Set to record'} ${it.p.Name}`, 'rec');
            else toast('Couldn\'t schedule that recording', 'err');
        };
        const cancel = async (it) => {
            const stopping = m.recordingNow(it);
            toast(`${stopping ? 'Stopping' : 'Cancelling'} ${it.p.Name}…`, '', 60000);
            const result = await m.cancel(it.p, stopping);
            if (!alive()) return;
            refresh();
            if (result === 'gone') toast(`${stopping ? 'Recording stopped' : 'Recording cancelled'}: ${it.p.Name}`);
            else if (result === 'unset') toast(`${it.p.Name} isn't set to record`);
            else if (result === 'kept') toast('Jellyfin still has that recording scheduled', 'err');
            else toast('Couldn\'t cancel that recording', 'err');
        };
        // ● on a row, or Record in the sheet
        const toggleRecord = (it) => {
            if (!it) return;
            if (m.isBusy(it.p.Id)) {
                toast(m.busyText() || `Still scheduling ${it.p.Name}…`);
                return;
            }
            const again = !!armed && armed.id === it.p.Id;
            if (armed) {
                clearTimeout(armed.timer);
                armed = null;
            }
            if (!m.recordable(it)) toast('No listing to record', 'err');
            else if (it.e <= new Date()) toast('That program has already ended', 'err');
            else if (!m.timersByProgram.has(it.p.Id)) schedule(it);
            else if (again) cancel(it);
            else arm(it);
            refresh();
        };

        // ---------- Rows: only the ones on screen are in the page ----------
        // Row heights depend on what's listed at the shown time (a slim row
        // for nothing listed), so the layout is worked out from the data, and
        // the rows on screen (plus a few) are drawn at their offsets.
        let tops = []; // tops[k]: offset of order[k]; tops[order.length] is the total
        let looks = []; // lookup() for order[k] at the shown time
        let gen = 0; // bumped when what a row shows may have changed
        const drawn = new Map(); // row.i -> { el, prog, rec, gen }

        const layout = () => {
            const t = shownTime();
            const cs = getComputedStyle(root);
            const rowH = parseFloat(cs.getPropertyValue('--gp-row-h')) || ROW_H;
            const slimH = parseFloat(cs.getPropertyValue('--gp-slim-h')) || SLIM_H;
            tops = new Array(order.length + 1);
            looks = new Array(order.length);
            let y = 0;
            for (let k = 0; k < order.length; k++) {
                tops[k] = y;
                looks[k] = lookup(order[k], t);
                y += (looks[k].kind === 'none' ? slimH : rowH) + GAP;
            }
            tops[order.length] = y;
            canvas.style.height = Math.max(0, y) + 'px';
        };
        // the first row whose bottom is below y
        const rowAt = (y) => {
            let lo = 0;
            let hi = order.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (tops[mid + 1] <= y) lo = mid + 1;
                else hi = mid;
            }
            return Math.max(0, lo);
        };

        const timeRange = (s, e) => `${fmtShort(s)} – ${fmtTime(e)}`;
        const leftText = (e) => {
            const mins = Math.max(0, Math.round((e - Date.now()) / MIN_MS));
            return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
        };

        const buildRow = (row) => {
            const r = el('div', 'gp-row');
            r.dataset.i = row.i;
            const chan = el('div', 'gp-chan');
            chan.appendChild(ctx.logoChip(row.ch));
            chan.appendChild(el('span', 'gp-num', esc(row.ch.Number)));
            r.appendChild(chan);
            const prog = el('div', 'gp-prog');
            r.appendChild(prog);
            const rec = el('button', 'gp-rec', '<i></i><span class="gp-rec-label"></span>');
            rec.type = 'button';
            r.appendChild(rec);
            canvas.appendChild(r);
            return { el: r, prog, rec, gen: -1 };
        };

        const fillRow = (d, row, look) => {
            const { kind, item, next } = look;
            const now = new Date();
            const on = !!item && m.isSet(item);
            const recNow = on && m.recordingNow(item);
            const isArmed = !!item && !!armed && armed.id === item.p.Id;
            const g = item && genreOf(item.p);
            d.el.className = 'gp-row' + (kind === 'none' ? ' slim' : '') + (kind === 'loading' ? ' loading' : '')
                + (on ? ' set' : '') + (recNow ? ' rec-now' : '') + (isArmed ? ' armed' : '');
            d.el.style.setProperty('--genre', g ? `var(--homer-${g})` : 'transparent');
            if (kind === 'prog') {
                const airingNow = item.s <= now && item.e > now;
                const nowMode = at === null;
                const meta = timeRange(item.s, item.e) + (airingNow && nowMode ? ` · ${leftText(item.e)}` : '');
                const pct = airingNow ? Math.round(((now - item.s) / (item.e - item.s)) * 100) : 0;
                d.prog.innerHTML = `<div class="gp-title">${on ? '<i class="gp-dot"></i>' : ''}${esc(item.p.Name)}</div>`
                    + `<div class="gp-meta">${recNow ? '<span class="gp-recword">Recording · </span>' : on ? '<span class="gp-recword">Set to record · </span>' : ''}${esc(meta)}</div>`
                    + (airingNow ? `<div class="gp-bar"><b style="width:${pct}%"></b></div>` : '')
                    + (next ? `<div class="gp-next"><em>Next ${esc(fmtShort(new Date(next._s)))}</em>${esc(next.Name)}</div>` : '');
            } else if (kind === 'none') {
                d.prog.innerHTML = '<div class="gp-none">No listings</div>';
            } else if (kind === 'failed') {
                d.prog.innerHTML = '<div class="gp-none">Listings didn\'t load</div>';
            } else {
                d.prog.innerHTML = '<div class="gp-loading"><i></i><i></i></div>';
            }
            // ● on anything that can still be recorded
            const canRec = kind === 'prog' && m.recordable(item) && item.e > now;
            d.rec.hidden = !canRec;
            if (canRec) {
                const verb = !on ? 'Record' : recNow ? 'Stop' : 'Cancel';
                d.rec.querySelector('.gp-rec-label').textContent = isArmed ? verb + '?' : '';
                d.rec.setAttribute('aria-label', isArmed ? `Tap again to ${verb.toLowerCase()} this recording` : `${verb} ${item.p.Name}`);
            }
        };

        // Draw the rows on screen (and OVERSCAN either side); drop the rest.
        const draw = () => {
            if (!order.length) {
                drawn.forEach((d) => d.el.remove());
                drawn.clear();
                return;
            }
            const top = list.scrollTop;
            const first = Math.max(0, rowAt(top) - OVERSCAN);
            const last = Math.min(order.length - 1, rowAt(top + list.clientHeight) + OVERSCAN);
            const keep = new Set();
            for (let k = first; k <= last; k++) {
                const row = order[k];
                keep.add(row.i);
                let d = drawn.get(row.i);
                if (!d) {
                    d = buildRow(row);
                    drawn.set(row.i, d);
                }
                d.el.style.transform = `translateY(${tops[k]}px)`;
                d.el.style.height = (tops[k + 1] - tops[k] - GAP) + 'px';
                d.k = k;
                if (d.gen !== gen) {
                    fillRow(d, row, looks[k]);
                    d.gen = gen;
                }
            }
            drawn.forEach((d, i) => {
                if (keep.has(i)) return;
                d.el.remove();
                drawn.delete(i);
            });
        };

        // The data or the time changed: work the layout out again, keeping the
        // row at the top of the list where it is.
        const refresh = () => {
            let anchor = null;
            if (order.length && tops.length) {
                const k = rowAt(list.scrollTop);
                anchor = { row: order[k], off: list.scrollTop - tops[k] };
            }
            gen++;
            layout();
            if (anchor) {
                const k = order.indexOf(anchor.row);
                if (k >= 0) list.scrollTop = tops[k] + Math.min(anchor.off, tops[k + 1] - tops[k]);
            }
            draw();
            if (sheet) paintSheet();
        };

        const onListClick = (ev) => {
            const r = ev.target.closest('.gp-row');
            if (!r) return;
            const d = drawn.get(+r.dataset.i);
            if (!d || d.k == null) return;
            const look = looks[d.k];
            if (ev.target.closest('.gp-rec')) {
                toggleRecord(look.item);
                return;
            }
            openSheet(order[d.k], look);
        };

        // ---------- Chips: category and country ----------
        const chipsEl = $('.gp-chips');
        const COUNTRY_WORD = { all: 'All countries', us: 'USA', uk: 'UK', fr: 'France' };
        const buildChips = () => {
            const inCountry = (r) => country === 'all' || r.country === country;
            const n = country === 'all' ? rows.length : rows.filter((r) => r.country === country).length;
            let html = `<button type="button" class="gp-chip gp-country" aria-haspopup="dialog">${icon('public')}${esc(COUNTRY_WORD[country] || country)} <i>${n}</i></button><span class="gp-chips-rule"></span>`;
            for (const c of M.CATEGORIES) {
                const count = rows.filter((r) => r.cats.has(c.key) && inCountry(r)).length;
                html += `<button type="button" class="gp-chip${c.key === category ? ' on' : ''}" data-cat="${c.key}" role="tab" aria-selected="${c.key === category}">${esc(c.label)} <i>${count}</i></button>`;
            }
            chipsEl.innerHTML = html;
        };
        const applyScope = () => {
            order = rows.filter(inScope);
            const empty = $('.gp-empty');
            const label = [
                category !== 'all' ? (M.CATEGORIES.find((c) => c.key === category) || {}).label : '',
                country !== 'all' ? COUNTRY_WORD[country] : ''
            ].filter(Boolean).join(' · ') || 'these';
            empty.textContent = order.length ? ''
                : category === 'fav' ? 'No favorite channels yet. Heart a channel in Jellyfin to add it here.'
                    : `No ${label} channels`;
            empty.classList.toggle('show', !order.length && rows.length > 0);
            list.scrollTop = 0;
            tops = [];
            refresh();
        };
        const setCategory = (key) => {
            if (!M.CATEGORIES.some((c) => c.key === key) || key === category) return;
            category = key;
            buildChips();
            applyScope();
            const on = chipsEl.querySelector('.gp-chip.on');
            if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        const setCountry = (key) => {
            if (!M.COUNTRIES.some((c) => c.key === key)) return;
            country = key;
            buildChips(); // category counts follow the country
            applyScope();
        };
        chipsEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('.gp-chip');
            if (!b) return;
            if (b.classList.contains('gp-country')) openCountries();
            else setCategory(b.dataset.cat);
        });

        // ---------- Time rail ----------
        // Now, then every half hour to as far as the listings go (a week at most).
        // The chip at its left names the day of the time the rows show.
        const slotsEl = $('.gp-slots');
        const dayEl = $('.gp-day');
        let railFrom = 0; // the half hour the rail was built from
        let railTo = 0;
        const buildRail = () => {
            const first = floorSlot(Date.now()) + 30 * MIN_MS;
            const end = Math.min(m.listingsEnd() || Infinity, Date.now() + RAIL_DAYS * 1440 * MIN_MS);
            const to = Number.isFinite(end) ? end : Date.now() + 1440 * MIN_MS;
            if (first === railFrom && Math.abs(to - railTo) < 30 * MIN_MS) return;
            railFrom = first;
            railTo = to;
            let html = '<button type="button" class="gp-slot gp-slot-now" data-t="now">Now</button>';
            for (let t = first; t < to; t += 30 * MIN_MS) {
                const d = new Date(t);
                const newDay = d.getHours() === 0 && d.getMinutes() === 0;
                html += `<button type="button" class="gp-slot${newDay ? ' newday' : ''}" data-t="${t}">`
                    + (newDay ? `<small>${esc(d.toLocaleDateString([], { weekday: 'short' }))}</small>` : '')
                    + `${esc(fmtShort(d))}</button>`;
            }
            slotsEl.innerHTML = html;
            if (at !== null && (at < first || at >= to)) at = null;
            paintRail();
        };
        const paintRail = () => {
            slotsEl.querySelectorAll('.gp-slot').forEach((b) => {
                const on = b.dataset.t === 'now' ? at === null : +b.dataset.t === at;
                b.classList.toggle('on', on);
                b.setAttribute('aria-pressed', String(on));
            });
            const day = dayWord(shownTime()).replace(',', '');
            dayEl.textContent = day;
            dayEl.classList.toggle('later', day !== 'Today');
        };
        const setTime = (t) => {
            at = t;
            if (armed) {
                clearTimeout(armed.timer);
                armed = null;
            }
            paintRail();
            const on = slotsEl.querySelector('.gp-slot.on');
            if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            m.pump();
            refresh();
        };
        slotsEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('.gp-slot');
            if (b) setTime(b.dataset.t === 'now' ? null : +b.dataset.t);
        });

        // ---------- The sheet: a program, or the countries ----------
        const scrim = $('.gp-scrim');
        const sheetEl = $('.gp-sheet');
        const sheetBody = $('.gp-sheet-body');
        let sheet = null; // { kind: 'program', row, look } | { kind: 'countries' }
        const closeSheet = () => {
            if (!sheet) return;
            sheet = null;
            root.classList.remove('gp-sheet-open');
            sheetEl.style.transform = '';
        };
        const openSheet = (row, look) => {
            sheet = { kind: 'program', row, look };
            paintSheet();
            root.classList.add('gp-sheet-open');
        };
        const openCountries = () => {
            sheet = { kind: 'countries' };
            paintSheet();
            root.classList.add('gp-sheet-open');
        };
        const paintSheet = () => {
            if (!sheet) return;
            if (sheet.kind === 'countries') {
                sheetBody.innerHTML = '<h2 class="gp-sheet-title">Country</h2><div class="gp-options">'
                    + M.COUNTRIES.map((c) => {
                        const n = c.key === 'all' ? rows.length : rows.filter((r) => r.country === c.key).length;
                        return `<button type="button" class="gp-option${c.key === country ? ' on' : ''}" data-country="${c.key}">`
                            + `<span>${esc(COUNTRY_WORD[c.key])}</span><i>${n}</i>${c.key === country ? icon('check') : ''}</button>`;
                    }).join('') + '</div>';
                return;
            }
            const { row } = sheet;
            // look again: the program may have ended, or been set to record, since
            const look = lookup(row, shownTime());
            sheet.look = look;
            const it = look.item;
            const ch = row.ch;
            const now = new Date();
            const airing = !it || (it.s <= now && it.e > now);
            const head = el('div', 'gp-sheet-hd');
            head.appendChild(ctx.logoChip(ch));
            head.appendChild(el('span', 'gp-sheet-ch', `${esc(ch.Number)} · ${esc(ch.Name)}`));
            const pills = [];
            if (it) {
                const on = m.isSet(it);
                const recNow = on && m.recordingNow(it);
                if (recNow) pills.push('<span class="gp-pill rec">Recording</span>');
                else if (on) pills.push('<span class="gp-pill rec">Set to record</span>');
                if (airing) pills.push('<span class="gp-pill live">Live</span>');
                const day = dayWord(it.s);
                pills.push(`<span class="gp-pill">${esc((day === 'Today' ? '' : day + ' · ') + timeRange(it.s, it.e))}</span>`);
                if (airing) pills.push(`<span class="gp-pill">${esc(leftText(it.e))}</span>`);
                else {
                    const mins = Math.round((it.s - now) / MIN_MS);
                    pills.push(`<span class="gp-pill">Starts in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}</span>`);
                }
                const g = genreOf(it.p);
                if (g) pills.push(`<span class="gp-pill genre" style="background:var(--homer-${g})">${genreLabel[g]}</span>`);
                if (it.p.ParentIndexNumber && it.p.IndexNumber) pills.push(`<span class="gp-pill">S${it.p.ParentIndexNumber} E${it.p.IndexNumber}</span>`);
                if (it.p.OfficialRating) pills.push(`<span class="gp-pill">${esc(it.p.OfficialRating)}</span>`);
            }
            const desc = it ? [it.p.EpisodeTitle, it.p.Overview].filter(Boolean).join(' — ') : 'No listing information from this channel\'s guide.';
            let rec = '';
            if (it && m.recordable(it) && it.e > now) {
                const on = m.isSet(it);
                const recNow = on && m.recordingNow(it);
                const isArmed = !!armed && armed.id === it.p.Id;
                const verb = !on ? 'Record' : recNow ? 'Stop recording' : 'Cancel recording';
                rec = `<button type="button" class="gp-act gp-act-rec${on ? ' set' : ''}${isArmed ? ' armed' : ''}">`
                    + `<i></i>${isArmed ? `Tap again to ${recNow ? 'stop' : 'cancel'}` : verb}</button>`;
            }
            const watch = airing ? `<button type="button" class="gp-act gp-act-watch">${icon('play_arrow')}<span>Watch ${esc(ch.Name.replace(/\s*\(.*$/, ''))}</span></button>` : '';
            sheetBody.innerHTML = '';
            sheetBody.appendChild(head);
            sheetBody.insertAdjacentHTML('beforeend', `<h2 class="gp-sheet-title">${esc(it ? it.p.Name : ch.Name)}</h2>`
                + (pills.length ? `<div class="gp-pills">${pills.join('')}</div>` : '')
                + `<p class="gp-desc">${esc(desc)}</p>`
                + ((rec || watch) ? `<div class="gp-acts">${rec}${watch}</div>` : ''));
        };
        sheetBody.addEventListener('click', (ev) => {
            if (!sheet) return;
            const opt = ev.target.closest('.gp-option');
            if (opt) {
                setCountry(opt.dataset.country);
                closeSheet();
                return;
            }
            if (ev.target.closest('.gp-act-rec')) {
                toggleRecord(sheet.look && sheet.look.item);
                return;
            }
            if (ev.target.closest('.gp-act-watch')) watch(sheet.row, sheet.look);
        });
        scrim.addEventListener('click', closeSheet);

        // drag the sheet down to put it away
        let sheetDrag = null;
        sheetEl.addEventListener('pointerdown', (ev) => {
            if (!ev.target.closest('.gp-grab, .gp-sheet-hd, .gp-sheet-title')) return;
            sheetDrag = { id: ev.pointerId, y: ev.clientY, dy: 0 };
            try { sheetEl.setPointerCapture(ev.pointerId); } catch { /* it's gone */ }
        });
        sheetEl.addEventListener('pointermove', (ev) => {
            if (!sheetDrag || ev.pointerId !== sheetDrag.id) return;
            sheetDrag.dy = Math.max(0, ev.clientY - sheetDrag.y);
            sheetEl.style.transition = 'none';
            sheetEl.style.transform = `translateY(${sheetDrag.dy}px)`;
        });
        const endSheetDrag = (ev) => {
            if (!sheetDrag || ev.pointerId !== sheetDrag.id) return;
            const far = sheetDrag.dy > 90;
            sheetDrag = null;
            sheetEl.style.transition = '';
            sheetEl.style.transform = '';
            if (far) closeSheet();
        };
        sheetEl.addEventListener('pointerup', endSheetDrag);
        sheetEl.addEventListener('pointercancel', endSheetDrag);

        // ---------- Watching ----------
        const watch = (row, look) => {
            const ch = row.ch;
            const p = look && look.item ? look.item.p : null;
            const program = Object.assign({}, p || { Name: ch.Name }, { ChannelId: ch.Id, ChannelName: ch.Name, ChannelNumber: ch.Number });
            closeSheet();
            ctx.watching(ch);
            const hp = P();
            // in the strip under the top bar; without HomerPlayer, full screen
            if (hp && typeof hp.watch === 'function') hp.watch(ch.Id, { program });
            else M.playChannel(ch).catch((err) => console.error('[Channel Guide] Playback failed:', err));
            syncDock();
        };

        // The strip a docked video plays in: HomerPlayer pins the real video
        // over [data-homer-preview]; this draws what's around it.
        const dockEl = $('.gp-dock');
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked());
            root.classList.toggle('gp-docked', on);
            if (!on) {
                root.classList.remove('gp-dock-live');
                dockFor = null;
                return;
            }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('gp-dock-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying();
            const p = np && np.program;
            const item = np && np.item;
            const now = Date.now();
            const s = p && Date.parse(p.StartDate);
            const e = p && Date.parse(p.EndDate);
            $('.gp-dock-what').textContent = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ')
                : item ? item.Name || '' : '';
            $('.gp-dock-left').textContent = p && e > now ? leftText(new Date(e)) : '';
            $('.gp-dock-bar b').style.width = p && s && e > s ? Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100)) + '%' : '0';
            $('.gp-badge').hidden = !p;
            const key = p ? p.ChannelId : item ? item.Id : '';
            if (key !== dockFor) {
                dockFor = key;
                const logo = $('.gp-dock-logo');
                logo.innerHTML = '';
                const row = p && byId.get(p.ChannelId);
                if (row) logo.appendChild(ctx.logoChip(row.ch));
            }
        };
        dockEl.addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            ev.stopPropagation();
            if (ev.target.closest('.gp-dock-stop')) hp.stop();
            else hp.fullscreen(); // the strip, or its full-screen button
        });
        const offPlayer = P() ? P().onChange(syncDock) : () => {};

        // ---------- Input ----------
        list.addEventListener('scroll', draw, { passive: true });
        list.addEventListener('click', onListClick);
        // Scrolling here is the guide's alone: Jellyfin's player page turns
        // scroll gestures into volume changes. (The list still scrolls.)
        const onWheelCapture = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (ev.key === 'Escape' || ev.key === 'Backspace' || ev.key === 'GoBack' || ev.key === 'BrowserBack') {
                ev.preventDefault();
                ev.stopPropagation();
                if (sheet) closeSheet();
                else ctx.goHome();
            }
        };
        document.addEventListener('keydown', onKey, true);
        const onResize = () => refresh(); // turning the phone changes the row heights
        window.addEventListener('resize', onResize);

        // Now moves on: progress bars, time left, and programs that end.
        const tick = () => {
            buildRail();
            if (at === null) refresh();
            syncDock();
        };
        const tickTimer = setInterval(tick, TICK_MS);
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing

        // ---------- Data ----------
        const detachModel = m.attach({
            window: () => {
                const start = floorSlot(shownTime());
                return { start, end: start + CHUNK_MIN * MIN_MS };
            },
            onChunk: () => refresh(),
            onProbed: () => {
                buildRail();
                refresh();
            }
        });

        const self = {
            phone: true,
            show() {
                root.style.visibility = '';
                draw();
            },
            // where the guide is, for the TV layout (or the next time it opens)
            state() {
                const k = order.length && tops.length ? rowAt(list.scrollTop) : -1;
                const row = k >= 0 ? order[k] : null;
                return { category, country, start: at || floorSlot(Date.now()), channelId: row ? row.ch.Id : null, time: at || Date.now() };
            },
            teardown() {
                clearInterval(tickTimer);
                clearInterval(dockTimer);
                clearTimeout(toastTimer);
                if (armed) clearTimeout(armed.timer);
                offPlayer();
                detachModel();
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                window.removeEventListener('resize', onResize);
                document.removeEventListener('keydown', onKey, true);
                root.remove();
            }
        };

        buildRail();
        syncDock();
        (async () => {
            await null; // until create() returns, the guide isn't this one yet
            m.pump();
            m.loadTimers().then(() => { if (alive()) refresh(); }).catch(() => {}); // fresh dots, for a kept model
            const channels = await m.channels();
            if (!alive()) return;
            rows = channels.map((ch, i) => ({ i, ch, cats: M.categorize(ch), country: M.countryOf(ch) }));
            rows.forEach((r) => byId.set(r.ch.Id, r));
            if (!M.COUNTRIES.some((c) => c.key === country)) country = 'all';
            if (!M.CATEGORIES.some((c) => c.key === category)) category = 'all';
            buildChips();
            order = rows.filter(inScope);
            if (!order.length && (category !== 'all' || country !== 'all')) {
                category = 'all';
                country = 'all';
                buildChips();
                order = rows;
            }
            applyScope();
            // back where it was: the same channel at the top
            const k = saved.channelId ? order.findIndex((r) => r.ch.Id === saved.channelId) : -1;
            if (k > 0) {
                list.scrollTop = tops[k];
                draw();
            }
            syncDock();
        })().catch((err) => {
            console.error('[Channel Guide]', err);
            if (alive()) {
                const empty = $('.gp-empty');
                empty.textContent = 'Couldn\'t load the guide';
                empty.classList.add('show');
            }
        });

        return self;
    };

    window.HomerGuidePhone = { version: VERSION, create };
    // tell the layout the guide has a phone layout (a guide already open on a
    // phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('guide', { phone: true });
})();
