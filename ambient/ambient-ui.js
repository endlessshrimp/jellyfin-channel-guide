/*
 * HOMER Ambience: the panel — pick a storm/nature/noise preset or a radio
 * station, two independent volume sliders (the book/music, and the
 * ambience), a sleep timer that fades both out. Data and playback live in
 * ambient/ambient-model.js; this is only the UI, styled like the app's other
 * pickers (music/playon.js's device sheet is the closest relative).
 *
 * Reachable from: Books' Listening view (a pill next to Speed/Sleep,
 * books/books.js) and, from anywhere a book or track is loaded, the Actions
 * strip (hold OK, or M on a keyboard) — registered here as a global action so
 * Music gets it too without editing music.js.
 *
 * Nav: ▲▼ moves between rows (the two sliders, section headers and — inside
 * an expanded one — its sources, sleep, Stop); ◀▶ adjusts a slider or the
 * sleep choice; Enter/OK plays a source, toggles a section header open/
 * closed, or (on a slider) does nothing special — arrows are how a slider
 * moves. A collapsed section's rows are never in the DOM, so ▲▼ skips them
 * without any special-casing. Mouse/touch: click a source row or a section
 * header; drag or click-to-position a slider; tap a sleep chip. Esc/
 * Backspace, or a click on the scrim, closes it. The book/music keeps
 * playing underneath the whole time — this never pauses it.
 *
 * Sections (Storms/Nature/Noise, Local/Favorites/SomaFM) remember expanded/
 * collapsed per section, per device (localStorage, HOME-104 layout pass) —
 * see the "Section collapse/expand" comment below for the default before
 * any of that exists yet.
 *
 * window.HomerAmbient = { open, close, toggle, isOpen, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerAmbient && typeof window.HomerAmbient.destroy === 'function') {
        window.HomerAmbient.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="ambient/ambient-ui.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc.replace(/ambient-ui\.js(\?.*)?$/, '');
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const AM = () => window.HomerAmbientModel || null;
    const RM = () => window.HomerRadioModel || null;
    const L = window.HomerAmbientLogic; // pure helpers: initialSectionState, sectionHeaderSuffix
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (n) => `<span class="material-icons" aria-hidden="true">${n}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

    // ---------- Styles ----------

    const ensureCss = () => {
        if (document.getElementById('am-css')) return;
        const l = document.createElement('link');
        l.id = 'am-css';
        l.rel = 'stylesheet';
        l.href = BASE + 'ambient.css' + QUERY;
        document.head.appendChild(l);
    };

    // ---------- The sheet ----------

    const layer = document.createElement('div');
    layer.id = 'am-root';
    layer.hidden = true;
    layer.innerHTML = `
        <div class="am-scrim"></div>
        <div class="am-sheet" role="dialog" aria-label="Ambience">
            <div class="am-head">${icon('cloud')}<span>Ambience</span><span class="am-head-sub">background sound alongside the book</span><span class="am-close" role="button" aria-label="Close">${icon('close')}</span></div>
            <div class="am-hint" hidden></div>
            <div class="am-body">
                <div class="am-sliders"></div>
                <div class="am-list"></div>
                <div class="am-sleep"></div>
            </div>
            <div class="am-foot">
                <div class="am-row am-off" data-k="off">${icon('stop_circle')}<span>Stop ambience</span></div>
            </div>
            <div class="am-legend">
                <span><span class="am-key">▲▼</span>Move</span>
                <span><span class="am-key">◀▶</span>Adjust</span>
                <span><span class="am-key">OK</span>Play</span>
                <span><span class="am-key">ESC</span>Close</span>
            </div>
        </div>`;

    const listEl = layer.querySelector('.am-list');
    const slidersEl = layer.querySelector('.am-sliders');
    const sleepEl = layer.querySelector('.am-sleep');
    const hintEl = layer.querySelector('.am-hint');
    const offRow = layer.querySelector('.am-off');

    // drawn in 1080-tall units and scaled to the window, like actions.js's strip
    const phone = () => !!(window.HomerLayout && window.HomerLayout.isPhone());
    const scale = () => {
        layer.style.setProperty('--am-s', String(phone() ? 1 : window.innerHeight / 1080));
        layer.classList.toggle('phone', phone());
    };
    scale();
    window.addEventListener('resize', scale);

    // ---------- Slider (its own tiny focusable widget) ----------
    //
    // A plain div-based bar rather than <input type=range>, so it fits the
    // same ▲▼◀▶/OK focus model as the rest of the sheet, and so a click or a
    // drag anywhere on the bar (mouse or touch — Pointer Events cover both)
    // sets the value directly, not just nudges it.

    const makeSlider = (host, key, label, get, set) => {
        const el = document.createElement('div');
        el.className = 'am-slider';
        el.dataset.k = key;
        el.tabIndex = -1;
        el.innerHTML = `
            <div class="am-slider-label"><span>${esc(label)}</span><span class="am-slider-val"></span></div>
            <div class="am-slider-track"><div class="am-slider-fill"></div><div class="am-slider-handle"></div></div>`;
        host.appendChild(el);
        const track = el.querySelector('.am-slider-track');
        const fill = el.querySelector('.am-slider-fill');
        const handle = el.querySelector('.am-slider-handle');
        const val = el.querySelector('.am-slider-val');
        const paint = () => {
            const v = Math.max(0, Math.min(1, get()));
            fill.style.width = (v * 100) + '%';
            handle.style.left = (v * 100) + '%';
            val.textContent = Math.round(v * 100) + '%';
        };
        const setFromClientX = (clientX) => {
            const r = track.getBoundingClientRect();
            const v = r.width ? (clientX - r.left) / r.width : 0;
            set(Math.max(0, Math.min(1, v)));
            paint();
        };
        track.addEventListener('pointerdown', (ev) => {
            track.setPointerCapture(ev.pointerId);
            setFromClientX(ev.clientX);
        });
        track.addEventListener('pointermove', (ev) => {
            if (ev.buttons) setFromClientX(ev.clientX);
        });
        el._move = (dir) => {
            if (dir !== 'left' && dir !== 'right') return false;
            set(Math.max(0, Math.min(1, get() + (dir === 'right' ? 0.05 : -0.05))));
            paint();
            return true;
        };
        el._ok = () => {}; // nothing to "select" on a slider; arrows do the work
        el._paint = paint;
        paint();
        return el;
    };

    // ---------- State ----------

    let open = false;
    let items = []; // flat focus order: DOM elements with _move()/_ok(), in row order
    let sel = 0;
    let renderTimer = null;

    // ---------- Section collapse/expand (HOME-104 layout pass) ----------
    //
    // Storms/Nature/Noise and Local/Favorites/SomaFM are each a collapsible
    // section now. Per-device state, namespaced like the rest of this
    // feature's remembered settings (ambient-model.js's homer-ambient-*).
    // `sectionState` is null until the first caret is ever touched on this
    // device — while it's null, render() recomputes a default fresh every
    // time (ambient-logic.js's initialSectionState, mirroring what's
    // actually playing), so it keeps tracking playback — including a radio
    // station that's still loading in when the panel first opens — right up
    // until the user makes their own choice. The first toggle freezes that
    // moment's picture into a real preference and it's remembered from then
    // on (see toggleSection below).
    const SECTIONS_KEY = 'homer-ambient-sections';
    const loadSectionState = () => {
        try { const v = localStorage.getItem(SECTIONS_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
    };
    const saveSectionState = (v) => {
        try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(v)); } catch { /* full or blocked */ }
    };
    let sectionState = loadSectionState();

    // Which sections actually have anything in them right now (order:
    // presets' Storms/Nature/Noise, then radio's Local/Favorites/SomaFM —
    // same order the list has always rendered in), and which one (if any)
    // holds the currently-playing source. Shared by render() and a caret
    // toggle so the two never compute this differently.
    const computeSections = (model) => {
        const cur = model.current();
        const presets = model.presets();
        const radios = model.radioSources();
        const byRadioGroup = {};
        radios.forEach((r) => { (byRadioGroup[r.group] = byRadioGroup[r.group] || []).push(r); });
        const sectionDefs = [];
        ['Storms', 'Nature', 'Noise'].forEach((g) => {
            if (presets[g] && presets[g].length) sectionDefs.push({ name: g, rows: presets[g] });
        });
        ['Local', 'Favorites', 'SomaFM'].forEach((g) => {
            if (byRadioGroup[g] && byRadioGroup[g].length) sectionDefs.push({ name: g, rows: byRadioGroup[g] });
        });
        let playingSection = null;
        if (cur.active) {
            sectionDefs.forEach((s) => {
                if (s.rows.some((r) => r.kind === cur.sourceKind && r.id === cur.sourceId)) playingSection = s.name;
            });
        }
        return { cur, presets, radios, sectionDefs, playingSection };
    };

    const toggleSection = (name) => {
        const model = AM();
        if (!model) return;
        const { sectionDefs, playingSection } = computeSections(model);
        const presentNames = sectionDefs.map((s) => s.name);
        const base = sectionState || L.initialSectionState(presentNames, playingSection);
        sectionState = Object.assign({}, base, { [name]: !base[name] });
        saveSectionState(sectionState);
        render();
    };

    const sectionHead = (name, expanded, playingLabel) => {
        const h = document.createElement('div');
        h.className = 'am-section-head' + (expanded ? ' open' : '');
        h.dataset.section = name;
        const suffix = (!expanded && playingLabel) ? L.sectionHeaderSuffix(playingLabel) : '';
        h.innerHTML = `<span class="am-caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span><span class="am-section-title">${esc(name)}</span><span class="am-section-suffix">${esc(suffix)}</span>`;
        h._ok = () => toggleSection(name);
        h._move = () => false;
        return h;
    };

    const setFocus = (i, opts = {}) => {
        if (!items.length) return;
        sel = Math.max(0, Math.min(items.length - 1, i));
        items.forEach((e, k) => e.classList.toggle('sel', k === sel));
        if (opts.scroll !== false) items[sel].scrollIntoView({ block: 'nearest' });
    };

    const sourceRow = (src, isActive) => {
        const row = document.createElement('div');
        row.className = 'am-row am-source' + (isActive ? ' active' : '');
        row.innerHTML = `${icon(isActive ? 'graphic_eq' : (src.kind === 'radio' ? 'radio' : 'cloud'))}
            <span class="am-row-text"><b>${esc(src.label)}</b>${src.sub ? `<i>${esc(src.sub)}</i>` : ''}</span>
            ${isActive ? `<span class="am-row-tag">Playing</span>` : ''}`;
        row._ok = () => {
            const model = AM();
            if (!model) return;
            if (src.kind === 'radio') model.start({ kind: 'radio', id: src.id, station: src.station });
            else model.start({ kind: 'preset', id: src.id });
            render(); // repaint "Playing" tags right away
        };
        row._move = () => false;
        return row;
    };

    // opts.reset=false (the once-a-second tick, for the sleep countdown and
    // "Playing" tags): rebuilds the same content but keeps whatever the user
    // was looking at — otherwise every tick yanked the list back to the top.
    const render = (opts = {}) => {
        const model = AM();
        if (!model) return;
        const { cur, presets, radios, sectionDefs, playingSection } = computeSections(model);
        const body = layer.querySelector('.am-body');
        const prevScroll = body ? body.scrollTop : 0;

        // hint: casting, or a degraded (fallback) source
        if (cur.casting) {
            hintEl.hidden = false;
            hintEl.innerHTML = `${icon('info')}Music/radio looks like it's on a speaker right now — ambience only plays here in the browser, not on the speaker.`;
        } else if (cur.degraded) {
            hintEl.hidden = false;
            hintEl.innerHTML = `${icon('info')}Using a placeholder sound — this preset's real recording didn't load.`;
        } else {
            hintEl.hidden = true;
        }

        items = [];

        // ---- mixer (HOME-104 layout pass: moved above the sources list) ----
        slidersEl.innerHTML = '';
        const fgLabel = cur.foregroundKind === 'music' ? 'Music volume' : 'Book volume';
        const fgSlider = makeSlider(slidersEl, 'vol-fg', fgLabel,
            () => (AM().current().foregroundVolume == null ? 1 : AM().current().foregroundVolume),
            (v) => AM().setForegroundVolume(v));
        if (!cur.foregroundKind) fgSlider.classList.add('dim');
        items.push(fgSlider);
        const ambSlider = makeSlider(slidersEl, 'vol-amb', 'Ambience volume',
            () => AM().current().ambientVolume,
            (v) => AM().setAmbientVolume(v));
        items.push(ambSlider);

        // ---- sources, grouped into collapsible sections ----
        listEl.innerHTML = '';
        const presentNames = sectionDefs.map((s) => s.name);
        // sectionState is null until the first-ever toggle on this device —
        // until then, mirror what's playing (see the note by its
        // declaration above).
        const shownState = sectionState || L.initialSectionState(presentNames, playingSection);
        sectionDefs.forEach((s) => {
            const expanded = !!shownState[s.name];
            const head = sectionHead(s.name, expanded, playingSection === s.name ? cur.sourceLabel : '');
            listEl.appendChild(head);
            items.push(head);
            if (!expanded) return; // collapsed: its rows are never in the DOM, so focus can't land on them and ▲▼ skips straight past
            s.rows.forEach((r) => {
                const isActive = cur.active && cur.sourceKind === r.kind && cur.sourceId === r.id;
                const row = sourceRow(r, isActive);
                listEl.appendChild(row);
                items.push(row);
            });
        });
        if (!sectionDefs.length) {
            const empty = document.createElement('div');
            empty.className = 'am-empty';
            empty.textContent = radios.length === 0 && Object.keys(presets).length === 0
                ? 'Nothing to play yet.' : 'Loading stations…';
            listEl.appendChild(empty);
        }

        // sleep timer
        sleepEl.innerHTML = '<div class="am-group">Sleep timer</div>';
        const chipsRow = document.createElement('div');
        chipsRow.className = 'am-chips';
        const options = [null].concat(model.sleepOptions());
        if (cur.foregroundKind === 'books') options.push('chapter');
        options.forEach((mode) => {
            const chip = document.createElement('div');
            const isSel = cur.sleep ? cur.sleep.mode === mode : mode === null;
            chip.className = 'am-chip' + (isSel ? ' sel' : '');
            chip.textContent = mode == null ? 'Off' : mode === 'chapter' ? 'End of chapter' : mode + ' min';
            chip.dataset.mode = mode == null ? '' : mode;
            chipsRow.appendChild(chip);
        });
        sleepEl.appendChild(chipsRow);
        const chipEls = [...chipsRow.children];
        let chipSel = Math.max(0, options.findIndex((m) => (cur.sleep ? cur.sleep.mode === m : m === null)));
        const paintChips = () => chipEls.forEach((c, i) => c.classList.toggle('sel', i === chipSel));
        const sleepWidget = document.createElement('div'); // an invisible focus target that owns the chip row
        sleepWidget.style.display = 'none';
        sleepWidget._move = (dir) => {
            if (dir !== 'left' && dir !== 'right') return false;
            chipSel = Math.max(0, Math.min(options.length - 1, chipSel + (dir === 'right' ? 1 : -1)));
            paintChips();
            return true;
        };
        sleepWidget._ok = () => {
            const m = options[chipSel];
            AM().setSleep(m === 'chapter' ? 'chapter' : m);
        };
        sleepEl.appendChild(sleepWidget);
        items.push(sleepWidget);
        chipEls.forEach((c, i) => c.addEventListener('click', () => {
            chipSel = i;
            paintChips();
            AM().setSleep(options[i] === 'chapter' ? 'chapter' : options[i]);
        }));
        if (cur.sleep && cur.sleep.mode !== 'chapter' && cur.sleep.remainingMs != null) {
            const left = document.createElement('div');
            left.className = 'am-sleep-left';
            left.textContent = Math.ceil(cur.sleep.remainingMs / 60000) + ' min left, fading out';
            sleepEl.appendChild(left);
        }

        // off row
        offRow.classList.toggle('dim', !cur.active);
        offRow._ok = () => { AM().stop(); render(); };
        offRow._move = () => false;
        items.push(offRow);

        sel = Math.min(sel, items.length - 1);
        setFocus(Math.max(0, sel), { scroll: opts.reset !== false });
        if (body && opts.reset === false) body.scrollTop = prevScroll;
    };

    // ---------- Input ----------

    const onKey = (ev) => {
        if (!open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        if (BACK_KEYS.includes(k)) { ev.preventDefault(); ev.stopImmediatePropagation(); closePanel(); return; }
        const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
        if (dirs[k]) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const dir = dirs[k];
            if (dir === 'up') { setFocus(sel - 1); return; }
            if (dir === 'down') { setFocus(sel + 1); return; }
            const cur = items[sel];
            if (cur && typeof cur._move === 'function') cur._move(dir);
            return;
        }
        if (k === 'Enter' || k === ' ') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const cur = items[sel];
            if (cur && typeof cur._ok === 'function') cur._ok();
        }
    };
    const onClick = (ev) => {
        if (ev.target.closest('.am-close')) { closePanel(); return; }
        if (ev.target.closest('.am-sheet')) {
            const row = ev.target.closest('.am-source, .am-off, .am-section-head');
            if (row && typeof row._ok === 'function') { row._ok(); }
            return;
        }
        closePanel();
    };

    document.addEventListener('keydown', onKey, true);
    layer.addEventListener('click', onClick);

    // ---------- Open / close ----------

    const openPanel = () => {
        if (open) return;
        ensureCss();
        if (!layer.isConnected) document.body.appendChild(layer);
        if (RM() && typeof RM().load === 'function') RM().load(); // stations for the picker
        open = true;
        layer.hidden = false;
        scale();
        render();
        clearInterval(renderTimer);
        renderTimer = setInterval(() => render({ reset: false }), 1000); // the sleep countdown, and "Playing" tags
        requestAnimationFrame(() => layer.classList.add('show'));
    };
    const closePanel = () => {
        if (!open) return;
        open = false;
        clearInterval(renderTimer);
        renderTimer = null;
        layer.classList.remove('show');
        setTimeout(() => { if (!open) layer.hidden = true; }, 180);
    };

    // Reachable from anywhere a book or track is loaded, not just Books' own
    // screen — this is what makes it work for Music too without editing
    // music.js. Books also gets an explicit pill (books/books.js). When
    // ambience is actually playing, a second entry stops it outright, even
    // from a screen with no book/track loaded at all (HOME-104: ambience
    // could outlive the thing it started alongside — Now Playing showing
    // nothing while ambience kept going — so "stop" has to be reachable
    // independent of "open").
    const offAction = window.HomerActions ? window.HomerActions.provide(() => {
        const bp = window.HomerBooksModel && window.HomerBooksModel.player;
        const mp = window.HomerMusicModel && window.HomerMusicModel.player;
        const fgActive = !!((bp && bp.state().book) || (mp && mp.state().track));
        const model = AM();
        const cur = model && model.current();
        const ambActive = !!(cur && cur.active);
        if (!fgActive && !ambActive) return [];
        const out = [];
        if (fgActive) {
            out.push({
                id: 'ambience', key: 'A', icon: 'cloud', label: 'Ambience',
                sub: 'Background sound', run: openPanel,
            });
        }
        if (ambActive) {
            out.push({
                id: 'ambience-stop', icon: 'stop_circle', label: 'Stop ambience',
                sub: cur.sourceLabel || '', run: () => model.stop(),
            });
        }
        return out;
    }, { id: 'ambience', global: true }) : () => {};

    // ---------- Persistent indicator: "Ambience — <preset>" ----------
    //
    // The picker sheet only exists while it's open; this is a small,
    // always-there badge (every screen — it's fixed over the whole window,
    // like the picker itself) so ambience is never invisible once you've
    // closed the picker and moved on. HOME-104: Jason's report was exactly
    // that — it kept playing, unnoticed, after he'd wandered off. One press
    // on its own stop icon kills it from wherever you are; clicking the
    // rest of it opens the picker.
    ensureCss();
    const indicator = document.createElement('div');
    indicator.id = 'am-indicator';
    indicator.hidden = true;
    indicator.innerHTML = `${icon('cloud')}<span class="am-ind-label"></span>`
        + `<span class="am-ind-stop" role="button" aria-label="Stop ambience">${icon('stop_circle')}</span>`;
    document.body.appendChild(indicator);
    const updateIndicator = () => {
        const model = AM();
        const cur = model && model.current();
        if (!cur || !cur.active) { indicator.hidden = true; return; }
        indicator.hidden = false;
        indicator.querySelector('.am-ind-label').textContent = 'Ambience — ' + (cur.sourceLabel || 'On');
        indicator.querySelector('.material-icons').textContent = cur.sourceKind === 'radio' ? 'radio' : 'cloud';
    };
    const onIndicatorClick = (ev) => {
        if (ev.target.closest('.am-ind-stop')) { ev.stopPropagation(); if (AM()) AM().stop(); return; }
        openPanel();
    };
    indicator.addEventListener('click', onIndicatorClick);
    const offIndicator = (AM() && AM().onChange) ? AM().onChange(updateIndicator) : () => {};
    updateIndicator();

    window.HomerAmbient = {
        version: VERSION,
        open: openPanel,
        close: closePanel,
        toggle() { return open ? (closePanel(), false) : (openPanel(), true); },
        isOpen: () => open,
        destroy() {
            closePanel();
            offAction();
            offIndicator();
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', scale);
            layer.removeEventListener('click', onClick);
            indicator.removeEventListener('click', onIndicatorClick);
            indicator.remove();
            layer.remove();
            document.getElementById('am-css')?.remove();
        },
    };
})();
