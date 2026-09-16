/*
 * HOMER Actions: the letter shortcuts, as something a remote can press.
 *
 * The Apple TV's Siri Remote has no keyboard, so HOMER's letter keys (G guide,
 * R record, E get new episodes, H home, L quick controls, / filter…) are out of
 * reach there. Holding OK on the remote (or M on a keyboard) opens a strip over
 * whatever screen is up, listing the actions that screen offers right now —
 * each with its name, its icon and its letter, so the strip teaches the
 * shortcut instead of replacing it. Arrows move, OK runs, Back/Esc closes.
 *
 * Screens register what they offer while they're open:
 *
 *   const off = HomerActions.provide(() => [
 *       { id: 'record', key: 'R', icon: 'fiber_manual_record', label: 'Record',
 *         sub: 'Sports Center', run: () => record(), disabled: !recordable() },
 *       { id: 'guide', key: 'G', icon: 'live_tv', label: 'Guide', main: true, run: open }
 *   ], { id: 'guide', title: 'Guide' });
 *   // …and off() in teardown()
 *
 *   id        what the action is (unique within the screen)
 *   key       the keyboard key it teaches, e.g. 'R', '/', '[ ]'
 *   icon      a Material Icons name
 *   label     what it does, in a word or three
 *   sub       (optional) what it will act on, e.g. the highlighted program
 *   run       does it (the strip closes first)
 *   disabled  (optional) shown greyed out and not runnable
 *   main      (optional) the screen's one main action: a swipe up runs it
 *             straight away, without the strip
 *
 * The strip shows the actions of the screen on top (the last one to register
 * that still offers anything), then the ones that work anywhere: Guide, Home
 * and Quick controls. A provider that returns [] is skipped, so a screen that
 * is up but not in front doesn't have to unregister.
 *
 * HOMER's Apple apps (apple/) fire these on window, with the platform in the
 * same detail:
 *   new CustomEvent('homer-app', { detail: { action: 'menu' } })       OK held
 *   new CustomEvent('homer-app', { detail: { action: 'swipe-up' } })   clickpad
 *   new CustomEvent('homer-app', { detail: { action: 'swipe-down' } })
 * (The Apple TV app fires them as 'homer-tv' as well, the name HOMER v0.4.6
 * and older listen for; this file has moved on to 'homer-app'.)
 * menu opens the strip, swipe-up runs the screen's main action (the Guide from
 * anywhere that hasn't got one), swipe-down closes what's open.
 *
 * window.HomerActions = { provide, open, close, toggle, isOpen, main, list, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerActions && typeof window.HomerActions.destroy === 'function') {
        window.HomerActions.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="actions.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc.replace(/actions\.js(\?.*)?$/, '');
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const OPEN_KEYS = ['m', 'M'];

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const phone = () => !!(window.HomerLayout && window.HomerLayout.isPhone());
    const signedIn = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const s = (creds.Servers || [])[0];
            return !!(s && s.AccessToken && s.UserId);
        } catch {
            return false;
        }
    };
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };

    // ---------- What screens have registered ----------

    const providers = [];
    let seq = 0;
    const provide = (source, opts = {}) => {
        const p = {
            fn: typeof source === 'function' ? source : () => source,
            global: !!opts.global,
            id: opts.id || '',
            title: opts.title || '', // the screen's name, shown next to "Actions"
            seq: ++seq
        };
        providers.push(p);
        return () => {
            const i = providers.indexOf(p);
            if (i >= 0) providers.splice(i, 1);
        };
    };

    const listOf = (p) => {
        let raw;
        try {
            raw = p.fn();
        } catch (err) {
            console.warn('[HOMER Actions] a provider failed', p.id, err);
            return [];
        }
        return (Array.isArray(raw) ? raw : [])
            .filter((a) => a && typeof a.run === 'function' && a.label)
            .map((a) => Object.assign({ from: p.id }, a));
    };

    // The screen in front: the last one to register that still offers something.
    const topScreen = () => {
        for (let i = providers.length - 1; i >= 0; i--) {
            if (providers[i].global) continue;
            const list = listOf(providers[i]);
            if (list.length) return { p: providers[i], list };
        }
        return null;
    };

    // Actions that work on any screen, from the keys HOMER binds globally.
    const builtins = () => {
        const out = [];
        const guideUp = !!document.getElementById('cg-root');
        if (window.ChannelGuide && !guideUp) {
            out.push({ id: 'guide', key: 'G', icon: 'live_tv', label: 'Guide', run: () => window.ChannelGuide.open() });
        }
        if (window.HomerHome || window.HomerPlayer) {
            out.push({
                id: 'home',
                key: 'H',
                icon: 'home',
                label: 'Home',
                run: () => {
                    if (window.HomerPlayer) window.HomerPlayer.goHome();
                    else if (window.HomerHome) window.HomerHome.goHome();
                    else location.hash = '#/home';
                }
            });
        }
        if (window.HomerQuick && window.HomerHA && window.HomerHA.isSetUp() && !window.HomerQuick.isOpen()) {
            out.push({ id: 'quick', key: 'L', icon: 'lightbulb', label: 'Quick controls', run: () => window.HomerQuick.open() });
        }
        return out;
    };

    // What the strip shows, in order: this screen's, then anywhere's, with
    // nothing named twice.
    const collect = () => {
        const top = topScreen();
        const own = top ? top.list : [];
        const seen = new Set(own.map((a) => a.id || a.label));
        const rest = [];
        for (const p of providers) {
            if (!p.global) continue;
            for (const a of listOf(p)) {
                const k = a.id || a.label;
                if (seen.has(k)) continue;
                seen.add(k);
                rest.push(Object.assign({ shared: true }, a));
            }
        }
        for (const a of builtins()) {
            const k = a.id || a.label;
            if (seen.has(k)) continue;
            seen.add(k);
            rest.push(Object.assign({ shared: true }, a));
        }
        return own.concat(rest);
    };

    // ---------- The strip ----------

    const ensureCss = () => {
        if (document.getElementById('hk-css') || !BASE) return;
        const l = document.createElement('link');
        l.id = 'hk-css';
        l.rel = 'stylesheet';
        l.href = BASE + 'actions.css' + QUERY;
        document.head.appendChild(l);
    };

    const layer = document.createElement('div');
    layer.id = 'hk-root';
    layer.hidden = true;
    layer.innerHTML = `
        <div class="hk-scrim"></div>
        <div class="hk-strip" role="dialog" aria-label="Actions">
            <div class="hk-head"><span class="material-icons" aria-hidden="true">apps</span>Actions<span class="hk-where"></span></div>
            <div class="hk-items"></div>
            <div class="hk-legend"><span><span class="hk-key">◀▶</span>Move</span><span><span class="hk-key">OK</span>Do it</span><span><span class="hk-key">ESC</span>Close</span></div>
        </div>`;
    const itemsBox = layer.querySelector('.hk-items');
    const whereEl = layer.querySelector('.hk-where');

    // drawn in 1080-tall units and scaled to the window, like the screens' stages
    const scale = () => {
        layer.style.setProperty('--hk-s', String(phone() ? 1 : window.innerHeight / 1080));
    };
    scale();

    let open = false;
    let items = [];
    let sel = 0;

    const draw = () => {
        itemsBox.innerHTML = items.map((a, i) => `
            <button type="button" class="hk-item${i === sel ? ' sel' : ''}${a.disabled ? ' off' : ''}${a.shared ? ' shared' : ''}" data-i="${i}">
                <span class="material-icons hk-icon" aria-hidden="true">${esc(a.icon || 'radio_button_unchecked')}</span>
                <span class="hk-label">${esc(a.label)}</span>
                ${a.sub ? `<span class="hk-sub">${esc(a.sub)}</span>` : ''}
                <span class="hk-key">${esc(a.key || 'OK')}</span>
            </button>`).join('');
    };
    const mark = () => {
        [...itemsBox.children].forEach((b, i) => {
            b.classList.toggle('sel', i === sel);
            if (i === sel) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    };

    // The strip wraps when a screen offers more than fits across, so ▲▼ move a
    // row at a time and ◀▶ along one (and on past its end, like a list).
    const rowsOf = () => {
        const out = [];
        [...itemsBox.children].forEach((b, i) => {
            const row = out.find((r) => Math.abs(r.top - b.offsetTop) < 4);
            if (row) row.items.push(i);
            else out.push({ top: b.offsetTop, items: [i] });
        });
        return out;
    };
    const move = (dx, dy) => {
        if (!items.length) return;
        if (dx) {
            sel = Math.max(0, Math.min(items.length - 1, sel + dx));
            mark();
            return;
        }
        const rows = rowsOf();
        const r = rows.findIndex((row) => row.items.includes(sel));
        const next = rows[r + dy];
        if (!next) return;
        const col = rows[r].items.indexOf(sel);
        sel = next.items[Math.min(col, next.items.length - 1)];
        mark();
    };

    const openStrip = () => {
        if (open) return false;
        items = collect();
        if (!items.length) return false;
        ensureCss();
        if (!layer.isConnected) document.body.appendChild(layer);
        const top = topScreen();
        whereEl.textContent = (top && top.p.title) || '';
        sel = Math.max(0, items.findIndex((a) => !a.disabled));
        open = true;
        layer.hidden = false;
        layer.classList.toggle('phone', phone());
        scale();
        draw();
        requestAnimationFrame(() => layer.classList.add('show'));
        return true;
    };

    const closeStrip = () => {
        if (!open) return false;
        open = false;
        layer.classList.remove('show');
        setTimeout(() => { if (!open) layer.hidden = true; }, 180);
        return true;
    };

    const run = (i = sel) => {
        const a = items[i];
        if (!a || a.disabled) return;
        closeStrip();
        // let the strip get out of the way before the action redraws anything
        setTimeout(() => {
            try {
                a.run();
            } catch (err) {
                console.warn('[HOMER Actions] action failed', a.id, err);
            }
        }, 0);
    };

    // ---------- The one main action (a swipe up) ----------

    const mainAction = () => {
        const top = topScreen();
        return (top && top.list.find((a) => a.main && !a.disabled)) || null;
    };
    const runMain = () => {
        const a = mainAction();
        if (a) {
            try {
                a.run();
            } catch (err) {
                console.warn('[HOMER Actions] main action failed', a.id, err);
            }
            return true;
        }
        // no main action here: the Guide, the way G does from anywhere
        if (window.ChannelGuide && !document.getElementById('cg-root') && signedIn()) {
            window.ChannelGuide.open();
            return true;
        }
        return false;
    };

    // ---------- Input ----------

    // While the strip is up it has the remote: capture, ahead of every screen.
    const onKeyCapture = (ev) => {
        if (!open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        const mine = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', ...BACK_KEYS, ...OPEN_KEYS];
        if (!mine.includes(k)) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.repeat && (k === 'Enter' || k === ' ')) return;
        if (k === 'ArrowLeft') move(-1, 0);
        else if (k === 'ArrowRight') move(1, 0);
        else if (k === 'ArrowUp') move(0, -1);
        else if (k === 'ArrowDown') move(0, 1);
        else if (k === 'Enter' || k === ' ') run();
        else closeStrip();
    };

    // M opens it: on the bubble, so a screen that wants the key first (typing in
    // a filter box) has already stopped it.
    const onKey = (ev) => {
        if (open || ev.defaultPrevented || ev.repeat) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (!OPEN_KEYS.includes(ev.key)) return;
        if (isTyping(ev.target) || isTyping(document.activeElement)) return;
        if (!signedIn()) return;
        ev.preventDefault();
        openStrip();
    };

    const onClick = (ev) => {
        const item = ev.target.closest('.hk-item');
        if (item) {
            run(Number(item.dataset.i));
            return;
        }
        if (ev.target.closest('.hk-strip')) return;
        closeStrip();
    };
    const onMove = (ev) => {
        const item = ev.target.closest('.hk-item');
        if (!item) return;
        const i = Number(item.dataset.i);
        if (i === sel) return;
        sel = i;
        mark();
    };

    // ---------- The Apple TV app's remote ----------

    const onTv = (ev) => {
        const action = ev && ev.detail && ev.detail.action;
        if (action === 'menu') {
            if (!open) openStrip();
            else closeStrip();
        } else if (action === 'swipe-up') {
            if (open) return; // the strip has the remote
            runMain();
        } else if (action === 'swipe-down') {
            if (closeStrip()) return;
            if (window.HomerQuick && window.HomerQuick.isOpen()) window.HomerQuick.close();
        }
    };

    document.addEventListener('keydown', onKeyCapture, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('homer-app', onTv);
    window.addEventListener('resize', scale);
    layer.addEventListener('click', onClick);
    layer.addEventListener('mousemove', onMove);

    window.HomerActions = {
        version: VERSION,
        provide,
        open: openStrip,
        close: closeStrip,
        toggle() { return open ? (closeStrip(), false) : openStrip(); },
        isOpen: () => open,
        main: runMain,
        // what the strip would show right now (for tests and the legend)
        list: collect,
        destroy() {
            closeStrip();
            providers.length = 0;
            document.removeEventListener('keydown', onKeyCapture, true);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('homer-app', onTv);
            window.removeEventListener('resize', scale);
            layer.remove();
            document.getElementById('hk-css')?.remove();
        }
    };
})();
