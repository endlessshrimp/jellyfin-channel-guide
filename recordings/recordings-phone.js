/*
 * HOMER Recordings, phone layout. recordings/recordings.js draws this instead
 * of the TV screen when shared/layout.js says it's on a phone; both load the
 * DVR through recordings/recordings-model.js.
 *
 * Recorded / Scheduled / Series as a segmented control, and a list under it:
 *   Recorded   newest first; a show with several recordings is one row (a
 *              folder, as on TV), and a tap opens its episodes
 *   Scheduled  by day, soonest first
 *   Series     by name, with what's coming up
 *
 * A tap on anything else opens a sheet: what it is, and big buttons. Play (or
 * Resume and Restart) and Delete for a recording, Cancel recording (Stop
 * recording while it's recording) for a scheduled one, Cancel series for a
 * series. Delete and the cancels take a second tap on the same button within
 * a few seconds ("Tap again to delete"); nothing asks through a browser
 * dialog, and nothing needs a long-press or a hover.
 *
 * A video playing in a preview window (started from the guide or Home) keeps
 * playing in a strip under the top bar. A recording always plays full screen.
 *
 * window.HomerRecordingsPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const CONFIRM_MS = 4000; // an armed Delete/Cancel gives up after this
    const CONFIRM_MIN_MS = 400; // …and ignores a second tap sooner than this (a double tap)
    const REFRESH_MS = 60000;
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };

    const create = (ctx) => {
        const M = window.HomerRecordingsModel;
        const { esc, clamp, plural, fmtTime, fmtDay, fmtRange, fmtMins, fmtIn, logoUrl, TICKS_PER_MIN } = M.util;
        const TABS = M.TABS;
        const P = () => window.HomerPlayer || null;
        const memory = ctx.memory || { tab: 'recorded', sel: {}, folder: null };

        // ---------- Where it is ----------
        let tab = TABS.some((t) => t.id === ctx.tab) ? ctx.tab : (TABS.some((t) => t.id === memory.tab) ? memory.tab : 'recorded');
        memory.tab = tab;
        let folder = null; // a show's key while its folder is open (Recorded)
        const data = {
            recorded: { status: 'loading', items: [] },
            scheduled: { status: 'loading', items: [] },
            series: { status: 'loading', items: [] }
        };

        // ---------- Page ----------
        const root = el('div', 'homer-screen hr-phone');
        root.id = 'hr-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="rp-main">
                <div class="rp-dock" data-homer-preview>
                    <div class="rp-dock-idle"><div class="rp-dock-logo"></div><div class="rp-dock-tuning">Tuning…</div></div>
                    <span class="rp-badge">Live</span>
                    <div class="rp-dock-ctl">
                        <button type="button" class="rp-dock-btn rp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                        <button type="button" class="rp-dock-btn rp-dock-stop" aria-label="Stop">${icon('close')}</button>
                    </div>
                    <div class="rp-dock-cap"><span class="rp-dock-what"></span><span class="rp-dock-left"></span></div>
                    <div class="rp-dock-bar"><b></b></div>
                </div>
                <div class="rp-side">
                    <div class="rp-head">
                        <div class="rp-seg" role="tablist" aria-label="Recordings">${TABS.map((t) => `<button type="button" class="rp-seg-btn" data-tab="${t.id}" role="tab"><span>${t.label}</span><i></i></button>`).join('')}</div>
                        <div class="rp-crumb" hidden>
                            <button type="button" class="rp-up">${icon('chevron_left')}<span>All recordings</span></button>
                            <span class="rp-crumb-title"></span>
                        </div>
                    </div>
                    <div class="rp-list"><div class="rp-rows"></div><div class="rp-state"></div></div>
                </div>
            </div>
            <div class="rp-toast" role="status" aria-live="polite"></div>
            <div class="rp-scrim"></div>
            <div class="rp-sheet" role="dialog" aria-modal="true"><div class="rp-grab"></div><div class="rp-sheet-body"></div></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const list = $('.rp-list');
        const rowsEl = $('.rp-rows');
        const stateEl = $('.rp-state');

        // don't leave a Jellyfin control underneath focused (Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        let alive = true;
        const isOpen = () => alive && ctx.isOpen(self);

        // ---------- Toast ----------
        const toastEl = $('.rp-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '', ms = 3200) => {
            toastEl.innerHTML = `<span class="rp-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'rp-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'rp-toast'; }, ms);
        };

        // ---------- Channel logos: the dark chip (shared/logos.js), or the name ----------
        const logoChip = (chId, chName, chTag) => {
            const chip = el('div', 'rp-logo');
            if (chId) {
                const im = document.createElement('img');
                im.alt = '';
                im.decoding = 'async';
                im.src = logoUrl(chId, chTag);
                im.onerror = () => {
                    chip.classList.add('text');
                    chip.innerHTML = `<span>${esc(chName || 'TV')}</span>`;
                };
                chip.appendChild(im);
                if (window.HomerLogos) window.HomerLogos.watch(im, chip);
            } else if (chName) {
                chip.classList.add('text');
                chip.innerHTML = `<span>${esc(chName)}</span>`;
            } else {
                chip.classList.add('none');
                chip.innerHTML = icon('live_tv');
            }
            return chip;
        };

        // ---------- The list ----------
        const entries = () => {
            const d = data[tab];
            if (tab !== 'recorded') return d.items;
            const top = M.groupRecordings(d.items);
            if (!folder) return top;
            const g = top.find((x) => x.key === folder);
            return g ? g.children : null;
        };
        const findEntry = (key) => {
            for (const t of TABS) {
                const items = t.id === 'recorded' ? M.groupRecordings(data.recorded.items) : data[t.id].items;
                for (const e of items) {
                    if (e.key === key) return e;
                    if (e.children) {
                        const kid = e.children.find((k) => k.key === key);
                        if (kid) return kid;
                    }
                }
            }
            return null;
        };

        const leftText = (e) => `${fmtMins((e.ticks - e.pos) / TICKS_PER_MIN)} left`;
        const airTime = (e) => (e.start ? `${fmtDay(e.start)} ${fmtTime(e.start)}` : '');
        const epLine = (e) => [e.code, e.episode].filter(Boolean).join(' · ');

        // 16:9 art, the channel on its chip in the corner; the chip alone
        // when there's no art (or it won't load)
        const thumb = (e) => {
            const box = el('div', 'rp-thumb' + (e.thumb ? '' : ' bare'));
            if (e.thumb) {
                const im = document.createElement('img');
                im.alt = '';
                im.loading = 'lazy';
                im.decoding = 'async';
                im.onload = () => im.classList.add('in');
                im.onerror = () => {
                    im.remove();
                    box.classList.add('bare');
                };
                im.src = e.thumb;
                box.appendChild(im);
            }
            if (e.chId || e.chName) box.appendChild(logoChip(e.chId, e.chName, e.chTag));
            else if (!e.thumb) box.insertAdjacentHTML('beforeend', icon('fiber_smart_record'));
            if (e.pct) box.insertAdjacentHTML('beforeend', `<div class="rp-thumb-bar"><b style="width:${e.pct}%"></b></div>`);
            return box;
        };

        const flagFor = (e) => {
            if (e.recording) return '<span class="rp-rec-pill">REC</span>';
            if (e.kind === 'group') return `${e.unwatched ? `<span class="rp-count">${e.unwatched}</span>` : ''}${icon('chevron_right')}`;
            if (e.kind === 'rec') {
                if (e.played) return `<span class="rp-check">${icon('check')}</span>`;
                if (!(e.pos > 0)) return '<span class="rp-new" title="Not watched yet"></span>';
                return '';
            }
            if (e.kind === 'timer' && e.conflict) return '<span class="rp-warn">Conflict</span>';
            return '';
        };

        const makeRow = (e) => {
            const r = el('div', `rp-row rp-row-${e.kind}`);
            r.setAttribute('role', 'button');
            r.tabIndex = 0;
            r.dataset.key = e.key;
            if (e.recording) r.classList.add('rec-now');
            if (e.played) r.classList.add('played');
            let title = e.title;
            let sub = '';
            let meta = '';
            if (e.kind === 'rec') {
                if (folder) { // the show's name is the folder; each row is its episode
                    title = e.episode || airTime(e) || e.title;
                    sub = [e.code, e.episode ? airTime(e) : ''].filter(Boolean).join(' · ');
                } else sub = epLine(e);
                meta = e.recording ? 'Recording now'
                    : [folder ? '' : fmtDay(e.start), e.pos > 0 && e.ticks ? leftText(e) : e.mins ? fmtMins(e.mins) : ''].filter(Boolean).join(' · ');
            } else if (e.kind === 'group') {
                sub = plural(e.children.length, 'recording');
                meta = e.recording ? 'Recording now' : e.newest.start ? `Latest ${fmtDay(e.newest.start)}` : '';
                r.classList.add('folder');
            } else if (e.kind === 'timer') {
                sub = epLine(e);
                meta = [e.recording ? 'Recording now' : fmtRange(e.start, e.end), e.chName].filter(Boolean).join(' · ');
            } else if (e.kind === 'series') {
                const next = e.upcoming.find((t) => t.start && t.start > Date.now());
                sub = [e.chName, e.which].filter(Boolean).join(' · ');
                meta = next ? `Next: ${fmtDay(next.start)} ${fmtTime(next.start)} · ${e.upcoming.length} coming up` : 'Nothing coming up yet';
            }
            if (e.kind === 'timer') {
                r.appendChild(logoChip(e.chId, e.chName, e.chTag));
            } else r.appendChild(thumb(e));
            const dot = e.kind === 'timer' ? '<i class="rp-dot"></i>' : '';
            r.insertAdjacentHTML('beforeend', `<div class="rp-text">`
                + `<div class="rp-title${sub ? '' : ' wrap'}">${dot}${esc(title)}</div>`
                + (sub ? `<div class="rp-sub">${esc(sub)}</div>` : '')
                + (meta ? `<div class="rp-meta${e.recording ? ' live' : ''}">${esc(meta)}</div>` : '')
                + '</div>');
            const flag = flagFor(e);
            if (flag) r.insertAdjacentHTML('beforeend', `<div class="rp-flag">${flag}</div>`);
            return r;
        };

        const EMPTY = {
            recorded: ['Nothing recorded yet', 'Tap ● on a show in the Guide to record it.'],
            scheduled: ['Nothing scheduled to record', 'Tap ● on a show in the Guide to record it.'],
            series: ['No series recordings', 'A series recording records every new episode of a show. Set one up from a show in Jellyfin and it shows up here.']
        };
        const NOUNS = { recorded: 'recordings', scheduled: 'scheduled recordings', series: 'series recordings' };
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };

        const paintTabs = () => {
            root.querySelectorAll('.rp-seg-btn').forEach((b) => {
                const on = b.dataset.tab === tab;
                b.classList.toggle('on', on);
                b.setAttribute('aria-selected', String(on));
                const d = data[b.dataset.tab];
                b.querySelector('i').textContent = d.status === 'ready' && d.items.length ? d.items.length : '';
            });
        };

        // Draw the tab (or the folder). keepScroll: a quiet refresh leaves the
        // list where it was.
        const render = ({ keepScroll = false } = {}) => {
            const d = data[tab];
            const top = list.scrollTop;
            let items = entries();
            if (folder && !items) { // the folder emptied out (or is down to one recording)
                folder = null;
                memory.folder = null;
                items = entries();
            }
            paintTabs();
            const crumb = $('.rp-crumb');
            crumb.hidden = !folder;
            root.classList.toggle('rp-in-folder', !!folder);
            if (folder) {
                const g = M.groupRecordings(d.items).find((x) => x.key === folder);
                $('.rp-crumb-title').textContent = g ? `${g.title} · ${g.children.length}` : '';
            }
            rowsEl.innerHTML = '';
            if (d.status === 'loading') {
                setState('<div class="rp-spinner"></div><b>Loading…</b>');
                return;
            }
            if (d.status === 'error') {
                setState(`<b>Couldn't load ${NOUNS[tab]}</b><span>Jellyfin didn't answer.</span><button type="button" class="rp-state-btn" data-do="retry">${icon('refresh')}<span>Try again</span></button>`);
                return;
            }
            if (!items.length) {
                const [head, body] = EMPTY[tab];
                setState(`${icon('fiber_smart_record')}<b>${esc(head)}</b><span>${esc(body)}</span>`
                    + (tab !== 'series' ? `<button type="button" class="rp-state-btn" data-do="guide">${icon('live_tv')}<span>Open the Guide</span></button>` : ''));
                return;
            }
            setState('');
            const frag = document.createDocumentFragment();
            let day = null;
            for (const e of items) {
                // Scheduled goes by day, under a heading for each
                if (tab === 'scheduled') {
                    const label = e.start ? fmtDay(e.start) : 'Later';
                    if (label !== day) {
                        day = label;
                        frag.appendChild(el('div', 'rp-day', esc(label)));
                    }
                }
                frag.appendChild(makeRow(e));
            }
            rowsEl.appendChild(frag);
            list.scrollTop = keepScroll ? top : 0;
        };

        const setTab = (id) => {
            if (!TABS.some((t) => t.id === id)) return;
            if (id === tab && !folder) {
                list.scrollTo({ top: 0, behavior: 'smooth' }); // a tap on the tab you're on: back to the top
                return;
            }
            tab = id;
            memory.tab = id;
            folder = null;
            memory.folder = null;
            closeSheet();
            render();
        };
        const openFolder = (g) => {
            folder = g.key;
            memory.folder = g.key;
            render();
        };
        const closeFolder = () => {
            if (!folder) return;
            const key = folder;
            folder = null;
            memory.folder = null;
            render();
            const r = rowsEl.querySelector(`.rp-row[data-key="${CSS.escape(key)}"]`);
            if (r) r.scrollIntoView({ block: 'nearest' });
        };

        // ---------- The sheet ----------
        const scrim = $('.rp-scrim');
        const sheetEl = $('.rp-sheet');
        const sheetBody = $('.rp-sheet-body');
        let sheet = null; // the entry's key while its sheet is up
        let armed = null; // { key, at, timer } while a Delete/Cancel waits for its second tap
        let busy = null; // the action being done: one at a time, and never twice

        const disarm = () => {
            if (!armed) return;
            clearTimeout(armed.timer);
            armed = null;
            paintSheet();
        };
        const closeSheet = () => {
            if (!sheet) return;
            if (armed) {
                clearTimeout(armed.timer);
                armed = null;
            }
            sheet = null;
            root.classList.remove('rp-sheet-open');
            sheetEl.style.removeProperty('--rp-drag');
        };
        const openSheet = (e) => {
            sheet = e.key;
            paintSheet();
            sheetBody.scrollTop = 0;
            root.classList.add('rp-sheet-open');
        };

        const actionsFor = (e) => {
            if (e.kind === 'rec') {
                const list = e.pos > 0
                    ? [{ id: 'resume', icon: 'play_arrow', label: 'Resume', primary: true }, { id: 'restart', icon: 'replay', label: 'Restart' }]
                    : [{ id: 'play', icon: 'play_arrow', label: 'Play', primary: true }];
                if (e.canDelete) list.push({ id: 'delete', icon: 'delete', label: 'Delete', confirm: 'Tap again to delete', busy: 'Deleting…', danger: true });
                return list;
            }
            if (e.kind === 'timer') {
                return e.recording
                    ? [{ id: 'cancel', rec: true, label: 'Stop recording', confirm: 'Tap again to stop', busy: 'Stopping…', danger: true }]
                    : [{ id: 'cancel', rec: true, label: 'Cancel recording', confirm: 'Tap again to cancel', busy: 'Cancelling…', danger: true }];
            }
            if (e.kind === 'series') return [{ id: 'cancelSeries', icon: 'event_busy', label: 'Cancel series', confirm: 'Tap again to cancel series', busy: 'Cancelling…', danger: true }];
            return [];
        };
        const armKey = (e, a) => e.key + '|' + a.id;

        const pill = (text, cls = '') => (text ? `<span class="rp-pill${cls ? ' ' + cls : ''}">${esc(text)}</span>` : '');

        const paintSheet = () => {
            if (!sheet) return;
            const e = findEntry(sheet);
            if (!e) { // it went away (deleted elsewhere, or the recording finished)
                closeSheet();
                return;
            }
            const head = el('div', 'rp-sheet-hd');
            head.appendChild(logoChip(e.chId, e.chName, e.chTag));
            const where = [];
            const pills = [];
            let extra = '';
            let episode = '';
            if (e.kind === 'rec') {
                where.push(e.chName, !e.start ? '' : e.recording ? `Recording since ${fmtTime(e.start)}` : `Recorded ${airTime(e)}`);
                if (e.recording) pills.push(pill('Recording now', 'rec'));
                else if (e.pos > 0) pills.push(pill('In progress', 'resume'));
                else if (e.played) pills.push(pill('Watched'));
                pills.push(pill(fmtRange(e.start, e.end)), pill(e.mins ? fmtMins(e.mins) : ''), pill(e.rating));
                episode = epLine(e);
                if (e.pct) {
                    extra = `<div class="rp-progress"><div class="rp-progress-bar"><b style="width:${e.pct}%"></b></div><span>${esc(leftText(e))}</span></div>`;
                }
            } else if (e.kind === 'timer') {
                where.push(e.chName);
                pills.push(e.recording ? pill('Recording now', 'rec') : pill('Set to record', 'set'));
                const day = e.start ? fmtDay(e.start) : '';
                pills.push(pill([day === 'Today' ? '' : day, fmtRange(e.start, e.end)].filter(Boolean).join(' · ')));
                if (!e.recording && e.start) pills.push(pill(fmtIn(e.start)));
                pills.push(pill(e.mins ? fmtMins(e.mins) : ''));
                if (e.fromSeries) pills.push(pill('Series', 'series'));
                if (e.conflict) pills.push(pill('Tuner conflict', 'warn'));
                pills.push(pill(e.rating));
                episode = epLine(e);
            } else if (e.kind === 'series') {
                where.push(e.chName);
                pills.push(pill('Series recording', 'set'), pill(e.which), pill(e.when), pill(e.days), pill(e.keep));
                const next = e.upcoming.filter((t) => t.start && t.end > Date.now()).slice(0, 3);
                extra = `<div class="rp-upcoming"><h3>${e.upcoming.length ? plural(e.upcoming.length, 'upcoming recording') : 'Nothing coming up in the guide yet'}</h3>`
                    + next.map((t) => `<div class="rp-up-row"><b>${esc(fmtDay(t.start))} ${esc(fmtTime(t.start))}</b><span>${esc(epLine(t) || t.chName || '')}</span></div>`).join('')
                    + '</div>';
            }
            head.appendChild(el('span', 'rp-sheet-ch', esc(where.filter(Boolean).join(' · '))));
            const acts = actionsFor(e).map((a) => {
                const on = !!armed && armed.key === armKey(e, a);
                const working = busy && busy.key === armKey(e, a);
                const cls = ['rp-act', a.primary ? 'primary' : '', a.danger ? 'danger' : '', a.rec ? 'rec' : '', on ? 'armed' : '', working ? 'busy' : ''].filter(Boolean).join(' ');
                const lead = a.rec ? '<i></i>' : icon(on && !working ? 'warning' : a.icon);
                return `<button type="button" class="${cls}" data-act="${a.id}">${lead}<span>${esc(working ? a.busy : on ? a.confirm : a.label)}</span></button>`;
            }).join('');
            sheetBody.innerHTML = '';
            sheetBody.appendChild(head);
            sheetBody.insertAdjacentHTML('beforeend', `<h2 class="rp-sheet-title">${esc(e.title)}</h2>`
                + (episode ? `<div class="rp-sheet-ep">${esc(episode)}</div>` : '')
                + `<div class="rp-pills">${pills.join('')}</div>`
                + extra
                + (e.overview ? `<p class="rp-desc">${esc(e.overview)}</p>` : '')
                + (acts ? `<div class="rp-acts">${acts}</div>` : ''));
        };

        // ---------- Doing things ----------
        const perform = async (e, a) => {
            busy = { key: armKey(e, a) };
            paintSheet();
            const label = e.kind === 'rec' ? [e.title, e.episode].filter(Boolean).join(': ') : e.title;
            try {
                await M.remove(a.id, e.id);
                if (!isOpen()) return;
                busy = null;
                armed = null;
                toast(a.id === 'delete' ? `Deleted ${label}`
                    : a.id === 'cancelSeries' ? `Cancelled the series recording of ${label}`
                        : e.recording ? `Stopped recording ${label}` : `Won't record ${label}`);
                // drop it now; the refresh below brings the rest up to date
                const tabId = a.id === 'delete' ? 'recorded' : a.id === 'cancel' ? 'scheduled' : 'series';
                data[tabId].items = data[tabId].items.filter((x) => x.id !== e.id);
                closeSheet();
                render({ keepScroll: true });
                refresh();
            } catch (err) {
                console.error('[HOMER Recordings]', err);
                if (!isOpen()) return;
                busy = null;
                if (armed) clearTimeout(armed.timer);
                armed = null;
                const what = a.id === 'delete' ? 'delete this recording' : a.id === 'cancel' ? 'cancel this recording' : 'cancel this series';
                toast(/→ 403/.test(err.message) ? `You don't have permission to ${what}` : `Couldn't ${what}`, 'err');
                paintSheet();
            }
        };

        const run = (e, a) => {
            if (!e || !a || busy) return;
            if (a.confirm) {
                const key = armKey(e, a);
                if (!armed || armed.key !== key) {
                    if (armed) clearTimeout(armed.timer);
                    armed = { key, at: Date.now(), timer: setTimeout(disarm, CONFIRM_MS) };
                    paintSheet();
                    return;
                }
                if (Date.now() - armed.at < CONFIRM_MIN_MS) return; // a double tap isn't a decision
                clearTimeout(armed.timer);
                perform(e, a);
                return;
            }
            disarm();
            const start = a.id === 'resume' ? e.pos : 0;
            const name = [e.title, e.episode].filter(Boolean).join(': ');
            closeSheet();
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${name}`);
            M.play(e.id, start).catch((err) => {
                console.error('[HOMER Recordings] Playback failed:', err);
                if (isOpen()) toast('Couldn\'t start playback', 'err');
            });
        };

        // ---------- Taps ----------
        root.querySelector('.rp-seg').addEventListener('click', (ev) => {
            const b = ev.target.closest('.rp-seg-btn');
            if (b) setTab(b.dataset.tab);
        });
        $('.rp-up').addEventListener('click', closeFolder);
        const onRow = (r) => {
            const e = findEntry(r.dataset.key);
            if (!e) return;
            memory.sel[folder || tab] = e.key;
            if (e.kind === 'group') openFolder(e);
            else openSheet(e);
        };
        rowsEl.addEventListener('click', (ev) => {
            const r = ev.target.closest('.rp-row');
            if (r) onRow(r);
        });
        stateEl.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-do]');
            if (!b) return;
            if (b.dataset.do === 'retry') load();
            else if (b.dataset.do === 'guide') ctx.openGuide();
        });
        sheetBody.addEventListener('click', (ev) => {
            const b = ev.target.closest('.rp-act');
            if (!b || !sheet) return;
            const e = findEntry(sheet);
            if (!e) return;
            run(e, actionsFor(e).find((a) => a.id === b.dataset.act));
        });
        // a tap anywhere else in the sheet puts an armed button back
        sheetEl.addEventListener('click', (ev) => {
            if (armed && !ev.target.closest('.rp-act')) disarm();
        });
        scrim.addEventListener('click', closeSheet);

        // drag the sheet down to put it away
        let sheetDrag = null;
        sheetEl.addEventListener('pointerdown', (ev) => {
            if (!ev.target.closest('.rp-grab, .rp-sheet-hd, .rp-sheet-title')) return;
            sheetDrag = { id: ev.pointerId, y: ev.clientY, dy: 0 };
            try { sheetEl.setPointerCapture(ev.pointerId); } catch { /* it's gone */ }
        });
        sheetEl.addEventListener('pointermove', (ev) => {
            if (!sheetDrag || ev.pointerId !== sheetDrag.id) return;
            sheetDrag.dy = Math.max(0, ev.clientY - sheetDrag.y);
            sheetEl.style.transition = 'none';
            sheetEl.style.setProperty('--rp-drag', sheetDrag.dy + 'px');
        });
        const endSheetDrag = (ev) => {
            if (!sheetDrag || ev.pointerId !== sheetDrag.id) return;
            const far = sheetDrag.dy > 90;
            sheetDrag = null;
            sheetEl.style.transition = '';
            sheetEl.style.removeProperty('--rp-drag');
            if (far) closeSheet();
        };
        sheetEl.addEventListener('pointerup', endSheetDrag);
        sheetEl.addEventListener('pointercancel', endSheetDrag);

        // ---------- A docked video ----------
        // HomerPlayer pins the real video over [data-homer-preview]; this draws
        // what's around it.
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked());
            root.classList.toggle('rp-docked', on);
            if (!on) {
                root.classList.remove('rp-dock-live');
                dockFor = null;
                return;
            }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('rp-dock-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying();
            const p = np && np.program;
            const item = np && np.item;
            const now = Date.now();
            const s = p && Date.parse(p.StartDate);
            const e = p && Date.parse(p.EndDate);
            $('.rp-dock-what').textContent = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ')
                : item ? item.Name || '' : '';
            const mins = p && e > now ? Math.round((e - now) / 60000) : 0;
            $('.rp-dock-left').textContent = mins ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`) : '';
            $('.rp-dock-bar b').style.width = p && s && e > s ? clamp(((now - s) / (e - s)) * 100, 0, 100) + '%' : '0';
            $('.rp-badge').hidden = !p;
            const key = p ? p.ChannelId : item ? item.Id : '';
            if (key !== dockFor) {
                dockFor = key;
                const logo = $('.rp-dock-logo');
                logo.innerHTML = '';
                if (p && p.ChannelId) logo.appendChild(logoChip(p.ChannelId, p.ChannelName, null));
            }
        };
        $('.rp-dock').addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            ev.stopPropagation();
            if (ev.target.closest('.rp-dock-stop')) hp.stop();
            else hp.fullscreen(); // the strip, or its full-screen button
        });
        const offPlayer = P() ? P().onChange(syncDock) : () => {};
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing

        // ---------- Keys (a phone with a keyboard, or a desktop window this small) ----------
        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            if (BACK_KEYS.includes(ev.key)) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                if (ev.repeat) return;
                if (armed) disarm();
                else if (sheet) closeSheet();
                else if (folder) closeFolder();
                else ctx.goBack();
                return;
            }
            if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('rp-row')) {
                ev.preventDefault();
                onRow(ev.target);
            }
        };
        window.addEventListener('keydown', onKey, true);
        // Jellyfin's player page turns scrolling into volume changes; scrolling
        // here is this screen's alone. (The list still scrolls.)
        const onWheel = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        window.addEventListener('wheel', onWheel, { capture: true, passive: true });

        // ---------- Data ----------
        let loadToken = 0;
        let lastSig = '';
        const load = async () => {
            const token = ++loadToken;
            for (const t of TABS) data[t.id] = { status: 'loading', items: [] };
            render();
            let res = null;
            try {
                res = await M.load(ctx.server);
            } catch (err) {
                console.error('[HOMER Recordings]', err);
            }
            if (!isOpen() || token !== loadToken) return;
            if (res) {
                lastSig = res.sig;
                Object.assign(data, res.data);
            } else for (const t of TABS) data[t.id] = { status: 'error', items: [] };
            if (memory.folder && tab === 'recorded') folder = memory.folder;
            render();
        };
        // quiet refresh: after a delete or cancel, and every minute (recordings
        // finish, scheduled ones start); never while a confirm is waiting
        const refresh = async () => {
            if (busy || armed) return;
            const token = ++loadToken;
            let res = null;
            try {
                res = await M.load(ctx.server);
            } catch { /* next time */ }
            if (!res || !isOpen() || token !== loadToken || busy || armed || res.sig === lastSig) return;
            lastSig = res.sig;
            Object.assign(data, res.data);
            render({ keepScroll: true });
            paintSheet();
        };
        const refreshTimer = setInterval(refresh, REFRESH_MS);

        const self = {
            phone: true,
            show() { root.style.visibility = ''; },
            setTab,
            teardown() {
                alive = false;
                clearInterval(refreshTimer);
                clearInterval(dockTimer);
                clearTimeout(toastTimer);
                if (armed) clearTimeout(armed.timer);
                offPlayer();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                root.remove();
            }
        };

        syncDock();
        (async () => {
            await null; // until create() returns, the screen isn't this one yet
            load();
        })();
        return self;
    };

    window.HomerRecordingsPhone = { version: VERSION, create };
    // tell the layout Recordings has a phone layout (a Recordings screen already
    // open on a phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('recordings', { phone: true });
})();
