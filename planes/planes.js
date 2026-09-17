/*
 * HOMER Planes for Jellyfin Web: what is flying over the house right now, on
 * a map, at a size you can read from the sofa.
 *
 * HOMER's own page at #/planes (Home's menu, after Cameras). Jellyfin has
 * nothing at that address.
 *
 *   The map      centred on the house, with range rings at quarters of the
 *                range and every aircraft drawn as a silhouette turned to its
 *                track and coloured by altitude. OpenStreetMap underneath,
 *                through HOMER's helper on the NAS — see planes/planes-map.js
 *                for why that's how the policy wants it done.
 *   The list     beside it: every aircraft in range, nearest first, with its
 *                callsign, what it is, how high, how fast, which way, and
 *                where it's going when the feed knows.
 *
 * Remote/keyboard: arrows move between aircraft, OK pins the highlighted one
 * (its details fill out, its track draws, and the map follows it), OK again
 * lets it go. [ and ] (or - and +) change the range, R asks again, Esc steps
 * back (pinned → not pinned → the previous screen), H goes Home. The Apple
 * TV's remote reaches all of it through the Actions strip
 * (shared/actions.js).
 *
 * On a phone (shared/layout.js) it draws planes/planes-phone.js instead: the
 * map on top, the list under it.
 *
 * The data, the polling and how gently it's done: planes/planes-model.js.
 *
 * window.HomerPlanes = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerPlanes && typeof window.HomerPlanes.destroy === 'function') {
        window.HomerPlanes.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="planes.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/planes\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'planes/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990;
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const TICK_MS = 1000; // the clock and "how old is this" line

    // ---------- Jellyfin session ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };

    // ---------- HomerPlayer (optional) ----------

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Planes]', err); return fallback; }
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
        if (docked() && p && typeof p.back === 'function') { p.back(); return; }
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
    const icon = (name, cls = '') => `<span class="material-icons${cls ? ' ' + cls : ''}" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const num = (n) => (typeof n === 'number' && isFinite(n) ? n : null);

    // ---------- Saying it in words ----------

    const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const compass = (deg) => (num(deg) == null ? '' : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]);
    const altText = (p) => {
        if (p.ground) return 'On the ground';
        const a = num(p.alt);
        return a == null ? 'Height unknown' : a.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' ft';
    };
    const speedText = (p) => {
        const g = num(p.gs);
        return g == null ? '' : Math.round(g) + ' kt';
    };
    const headText = (p) => {
        const t = num(p.track);
        return t == null ? '' : `${Math.round(t)}° ${compass(t)}`;
    };
    const distText = (p) => {
        const d = num(p.dst);
        return d == null ? '' : (d < 10 ? d.toFixed(1) : String(Math.round(d))) + ' nm';
    };
    // climbing, descending, or neither — the one thing a still picture can't say
    const trend = (p) => {
        const v = num(p.vs);
        if (p.ground || v == null || Math.abs(v) < 250) return null;
        return v > 0 ? { icon: 'north_east', word: 'Climbing' } : { icon: 'south_east', word: 'Descending' };
    };
    const whatIsIt = (p) => {
        const bits = [];
        if (p.type) bits.push(p.type);
        if (p.reg) bits.push(p.reg);
        return bits.join(' · ');
    };
    const nameOf = (p) => p.flight || p.reg || (p.hex || '').toUpperCase() || 'Unknown';
    const port = (a) => (a && (a.iata || a.icao)) || '';
    const routeText = (p) => {
        const r = p.route;
        if (!r) return '';
        const from = port(r.from);
        const to = port(r.to);
        if (from && to) return `${from} → ${to}`;
        return from ? `from ${from}` : to ? `to ${to}` : '';
    };
    const routeLong = (p) => {
        const r = p.route;
        if (!r) return '';
        const a = r.from && (r.from.city || r.from.name);
        const b = r.to && (r.to.city || r.to.name);
        if (a && b) return `${a} to ${b}`;
        return a ? `from ${a}` : b ? `to ${b}` : '';
    };
    const ageText = (at) => {
        if (!at) return '';
        const s = Math.round((Date.now() - at) / 1000);
        if (s < 12) return 'just now';
        if (s < 90) return `${s}s ago`;
        return `${Math.round(s / 60)} min ago`;
    };

    // ---------- Stylesheets ----------

    let cssReady = null;
    const ensureCss = () => {
        const shared = (id, file) => {
            if (document.getElementById(id)) return;
            const l = document.createElement('link');
            l.id = id;
            l.rel = 'stylesheet';
            l.href = BASE + '../shared/' + file + QUERY;
            document.head.appendChild(l);
        };
        shared('homer-tokens', 'tokens.css');
        shared('homer-shell', 'shell.css');
        if (cssReady && document.getElementById('hv-css')) return cssReady;
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
        cssReady = Promise.all([link('hv-css', 'planes.css'), link('hv-phone-css', 'planes-phone.css')]);
        return cssReady;
    };

    // ---------- The model, shared by both layouts ----------

    const theModel = () => (window.HomerPlanesModel ? window.HomerPlanesModel.create() : null);

    // What the screen should say when there's nothing to draw, or null when
    // there is. Both layouts ask this, so they say the same things.
    const statusMessage = (M) => {
        if (!M) return { icon: 'flight', title: 'The Planes screen didn\'t load', text: 'planes/planes-model.js is missing.' };
        const s = M.state;
        if (s === 'nolocation') {
            return {
                icon: 'wrong_location',
                title: 'HOMER doesn\'t know where the house is',
                text: 'Connect Home Assistant, or set a weather location in Settings.',
                ok: 'Settings', act: 'settings'
            };
        }
        if (s === 'error') {
            return {
                icon: 'cloud_off',
                title: 'Can\'t reach the plane feed',
                text: M.problem ? `${M.problem}. HOMER asks adsb.fi and adsb.lol through the NAS helper.` : 'Trying again shortly.',
                ok: 'Try again', act: 'retry'
            };
        }
        if (s === 'loading' && !M.planes.length) return { icon: 'flight', title: 'Looking up…', spin: true };
        return null;
    };

    // ---------- The screen ----------

    const createScreen = () => {
        const M = theModel();
        const root = el('div', 'homer-screen');
        root.id = 'hv-root';
        root.style.visibility = 'hidden';
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hv-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hv-topbar">
                <div class="hv-brand homer-home" role="button" title="Home (H)"><span class="hv-brand-mark">${icon('home')}</span>HOMER<span class="hv-brand-sub">Planes</span></div>
                <div class="hv-clock"><div class="hv-clock-time"></div><div class="hv-clock-date"></div></div>
            </div>
            <div class="hv-body">
                <div class="hv-mapwrap">
                    <div class="hv-map"></div>
                    <div class="hv-quiet"><b>Nothing overhead right now</b><span></span></div>
                    <div class="hv-alt"></div>
                    <div class="hv-note"></div>
                </div>
                <div class="hv-side">
                    <div class="hv-side-head">
                        <span class="hv-side-title">Overhead</span>
                        <span class="hv-side-count"></span>
                    </div>
                    <div class="hv-pinned"></div>
                    <div class="hv-list"></div>
                </div>
            </div>
            <div class="hv-state"></div>
            <div class="hv-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        const fit = () => {
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < 1600) { s = box.width / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
            if (map) map.resize();
        };

        // ----- state -----

        let alive = true;
        let list = []; // what's drawn, nearest first
        let focusHex = '';
        let pinnedHex = '';
        let lastRows = ''; // so an unchanged list isn't rebuilt under the focus

        const map = window.HomerPlanesMap ? window.HomerPlanesMap.create($('.hv-map'), {
            onPick: (hex) => {
                if (!hex) return;
                focusHex = hex;
                pinnedHex = pinnedHex === hex ? '' : hex;
                paint();
            }
        }) : null;
        fit();

        const clockTick = () => {
            const d = new Date();
            $('.hv-clock-time').textContent = fmtTime(d);
            $('.hv-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
            paintNote();
        };
        const clockTimer = setInterval(clockTick, TICK_MS);

        const focused = () => list.find((p) => p.hex === focusHex) || null;
        const pinned = () => list.find((p) => p.hex === pinnedHex) || null;
        const indexOfFocus = () => Math.max(0, list.findIndex((p) => p.hex === focusHex));

        // ----- the map's altitude key -----

        const paintAltKey = () => {
            const bands = (window.HomerPlanesMap && window.HomerPlanesMap.ALT_BANDS) || [];
            $('.hv-alt').innerHTML = bands.map((b) => `<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join('');
        };

        // ----- the line under the map -----

        const paintNote = () => {
            if (!alive || !M) return;
            const bits = [`${M.range} nm`];
            if (M.source) bits.push(M.source);
            if (M.at) bits.push(M.stale ? `${ageText(M.at)} · feed quiet` : ageText(M.at));
            const note = $('.hv-note');
            const html = bits.map((b) => `<span>${esc(b)}</span>`).join('');
            if (note.dataset.html !== html) { note.dataset.html = html; note.innerHTML = html; }
        };

        // ----- the list -----

        const rowHtml = (p) => {
            const t = trend(p);
            const pin = p.hex === pinnedHex;
            const on = p.hex === focusHex;
            const color = window.HomerPlanesMap ? window.HomerPlanesMap.altColor(p) : '#6fd3ff';
            const route = routeText(p);
            const what = whatIsIt(p);
            return `
                <div class="hv-row${on ? ' on' : ''}${pin ? ' pinned' : ''}${p.ground ? ' ground' : ''}" data-hex="${esc(p.hex)}" role="button" style="--band:${color}">
                    <div class="hv-row-dist">
                        <b>${esc(distText(p))}</b>
                        <i>${esc(compass(p.dir))}</i>
                    </div>
                    <div class="hv-row-who">
                        <div class="hv-row-call">${esc(nameOf(p))}${pin ? icon('push_pin', 'hv-row-pin') : ''}</div>
                        <div class="hv-row-what">${what ? esc(what) : '<em>Unknown aircraft</em>'}</div>
                        ${route ? `<div class="hv-row-route">${icon('trending_flat', 'hv-row-arrow')}${esc(route)}</div>` : ''}
                    </div>
                    <div class="hv-row-nums">
                        <div class="hv-row-alt">${t ? icon(t.icon, 'hv-row-vs') : ''}${esc(altText(p))}</div>
                        <div class="hv-row-sub">${esc([speedText(p), headText(p)].filter(Boolean).join(' · '))}</div>
                    </div>
                </div>`;
        };

        // The card for the aircraft being followed: everything the feed knows
        // about it, so "OK to pin" is worth pressing rather than just a way to
        // keep it in the middle of the map.
        const paintPinned = () => {
            const box = $('.hv-pinned');
            const p = pinned();
            if (!p) {
                if (box.dataset.html) { box.dataset.html = ''; box.innerHTML = ''; }
                box.classList.remove('show');
                return;
            }
            const t = trend(p);
            const v = num(p.vs);
            const color = window.HomerPlanesMap ? window.HomerPlanesMap.altColor(p) : '#6fd3ff';
            const facts = [
                ['Altitude', altText(p)],
                ['Speed', speedText(p) || '—'],
                ['Heading', headText(p) || '—'],
                // "+1,856 ft/min", not "Climbing 1,856 ft/min": the label
                // above it already says Climb, and the long one didn't fit
                ['Climb', t && v != null ? `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()} ft/min` : p.ground ? 'Stopped' : 'Level'],
                ['From here', `${distText(p)} ${compass(p.dir)}`],
                ['Squawk', p.squawk || '—']
            ];
            const long = routeLong(p);
            const html = `
                <div class="hv-pin-head" style="--band:${color}">
                    ${icon('push_pin', 'hv-pin-icon')}
                    <span class="hv-pin-call">${esc(nameOf(p))}</span>
                    <span class="hv-pin-what">${esc(whatIsIt(p) || 'Unknown aircraft')}</span>
                </div>
                ${p.desc || p.owner ? `<div class="hv-pin-sub">${esc([p.desc, p.owner].filter(Boolean).join(' · '))}</div>` : ''}
                ${long ? `<div class="hv-pin-route">${icon('trending_flat', 'hv-row-arrow')}${esc(routeText(p))}<i>${esc(long)}</i></div>` : ''}
                <div class="hv-pin-facts">${facts.map(([k, val]) => `<span><b>${esc(val)}</b>${esc(k)}</span>`).join('')}</div>`;
            if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
            box.classList.add('show');
        };

        const paintList = () => {
            const box = $('.hv-list');
            const html = list.length
                ? list.map(rowHtml).join('')
                : `<div class="hv-none">${icon('flight_takeoff')}<b>Quiet sky</b><span>Nothing within ${esc(String(M ? M.range : ''))} nm right now.</span></div>`;
            if (html !== lastRows) {
                lastRows = html;
                box.innerHTML = html;
            }
            const now = box.querySelector('.hv-row.on');
            if (now) now.scrollIntoView({ block: 'nearest' });
            const parked = list.filter((p) => p.ground).length;
            const flying = list.length - parked;
            $('.hv-side-count').textContent = list.length
                ? `${flying} flying${parked ? ` · ${parked} on the ground` : ''} within ${M.range} nm`
                : `nothing within ${M ? M.range : ''} nm`;
        };

        // ----- the map -----

        const paintMap = () => {
            if (!map || !M || !M.place) return;
            const keep = pinned();
            map.draw({
                home: { lat: M.place.lat, lon: M.place.lon },
                look: keep ? { lat: keep.lat, lon: keep.lon } : { lat: M.place.lat, lon: M.place.lon },
                range: M.range,
                planes: list,
                focus: focusHex,
                pinned: pinnedHex,
                trail: (hex) => M.trail(hex)
            });
        };

        // ----- states -----

        const drawStatus = () => {
            const msg = statusMessage(M);
            stage.classList.toggle('hv-waiting', !!msg);
            const box = $('.hv-state');
            box.classList.toggle('show', !!msg);
            box.innerHTML = msg
                ? `${msg.spin ? '<div class="hv-spinner"></div>' : icon(msg.icon || 'flight', 'hv-state-icon')}<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}${msg.ok ? `<div class="hv-state-ok" data-ok role="button"><span class="hv-key">OK</span>${esc(msg.ok)}</div>` : ''}`
                : '';
            const quiet = $('.hv-quiet');
            const nothing = !msg && M && M.state === 'empty';
            quiet.classList.toggle('show', !!nothing);
            if (nothing) quiet.querySelector('span').textContent = `No aircraft within ${M.range} nm. Try a wider range with ] .`;
        };

        // ----- legend -----

        const updateLegend = () => {
            const items = [];
            const msg = statusMessage(M);
            if (msg && msg.ok) items.push({ key: 'OK', label: msg.ok, action: 'ok' });
            else {
                if (list.length) {
                    items.push({ key: '▲▼', label: 'Aircraft' });
                    items.push({ key: 'OK', label: pinnedHex ? 'Let go' : 'Pin', action: 'ok' });
                }
                items.push({ key: '[ ]', label: 'Range' }, { key: 'R', label: 'Refresh', action: 'refresh' });
            }
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' }, { key: 'ESC', label: pinnedHex ? 'Let go' : 'Back', action: 'back' });
            const html = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hv-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
            const leg = $('.hv-legend');
            if (leg.dataset.html !== html) { leg.dataset.html = html; leg.innerHTML = html; }
        };

        // ----- one repaint -----

        const paint = () => {
            if (!alive || !M) return;
            list = M.planes || [];
            // the focus follows the aircraft, not its place in the list: the
            // list re-sorts by distance every few seconds
            if (!list.some((p) => p.hex === focusHex)) focusHex = list.length ? list[0].hex : '';
            if (pinnedHex && !list.some((p) => p.hex === pinnedHex)) pinnedHex = ''; // it flew away
            drawStatus();
            paintPinned();
            paintList();
            paintMap();
            paintNote();
            updateLegend();
        };

        // ----- moving about -----

        const move = (step) => {
            if (!list.length) return;
            const i = indexOfFocus();
            const next = Math.max(0, Math.min(list.length - 1, i + step));
            if (next === i) return;
            focusHex = list[next].hex;
            lastRows = ''; // the highlight moved
            paint();
        };
        const pin = () => {
            const p = focused();
            if (!p) return;
            pinnedHex = pinnedHex === p.hex ? '' : p.hex;
            lastRows = '';
            paint();
        };
        const setRange = (dir) => {
            if (!M) return;
            M.stepRange(dir);
            lastRows = '';
            paint();
        };
        const retry = () => { if (M) M.refresh(); };
        const settings = () => go('#/mypreferencesmenu');
        const ok = () => {
            const msg = statusMessage(M);
            if (msg && msg.act === 'settings') { settings(); return; }
            if (msg && msg.act === 'retry') { retry(); return; }
            pin();
        };
        const back = () => {
            if (pinnedHex) { pinnedHex = ''; lastRows = ''; paint(); return; }
            goBack();
        };

        const onKey = (ev) => {
            if (!alive || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) || isTyping(document.activeElement)) return;
            if (window.HomerActions && window.HomerActions.isOpen()) return;
            if (window.HomerQuick && window.HomerQuick.isOpen && window.HomerQuick.isOpen()) return;
            const k = ev.key;
            const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
            if (k === 'ArrowDown' || k === 'ArrowRight') { stop(); move(1); }
            else if (k === 'ArrowUp' || k === 'ArrowLeft') { stop(); move(-1); }
            else if (k === 'Enter' || k === ' ') { stop(); ok(); }
            else if (k === '[' || k === '-' || k === '_') { stop(); setRange(-1); }
            else if (k === ']' || k === '+' || k === '=') { stop(); setRange(1); }
            else if (k === 'r' || k === 'R') { stop(); retry(); }
            else if (k === 'h' || k === 'H') { stop(); goHome(); }
            else if (BACK_KEYS.includes(k)) { stop(); back(); }
        };

        const onWheel = (ev) => {
            if (!alive || !stage.contains(ev.target)) return;
            if (!ev.target.closest('.hv-list')) return;
            ev.preventDefault();
            move(ev.deltaY > 0 ? 1 : -1);
        };

        const onClick = (ev) => {
            if (ev.target.closest('.homer-home')) { goHome(); return; }
            const row = ev.target.closest('.hv-row');
            if (row) {
                const hex = row.dataset.hex;
                if (focusHex !== hex) { focusHex = hex; lastRows = ''; paint(); }
                else pin();
                return;
            }
            const leg = ev.target.closest('.hv-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'ok') ok();
                else if (a === 'back') back();
                else if (a === 'home') goHome();
                else if (a === 'refresh') retry();
                return;
            }
            if (ev.target.closest('.hv-state [data-ok]')) ok();
        };

        // ----- the Actions strip (shared/actions.js) -----

        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            const msg = statusMessage(M);
            if (msg && msg.act === 'settings') out.push({ id: 'settings', icon: 'settings', label: 'Settings', main: true, run: settings });
            const p = focused();
            if (p) {
                out.push({
                    id: 'pin',
                    icon: pinnedHex === p.hex ? 'push_pin' : 'my_location',
                    label: pinnedHex === p.hex ? 'Let it go' : 'Follow it',
                    sub: `${nameOf(p)} · ${altText(p)}`,
                    main: true,
                    run: pin
                });
            }
            if (M) {
                const i = M.RANGES.indexOf(M.range);
                out.push({ id: 'wider', icon: 'zoom_out_map', label: 'Wider', sub: M.RANGES[i + 1] ? M.RANGES[i + 1] + ' nm' : '', disabled: !M.RANGES[i + 1], run: () => setRange(1) });
                out.push({ id: 'closer', icon: 'center_focus_strong', label: 'Closer in', sub: M.RANGES[i - 1] ? M.RANGES[i - 1] + ' nm' : '', disabled: !M.RANGES[i - 1], run: () => setRange(-1) });
            }
            out.push({ id: 'refresh', icon: 'refresh', label: 'Refresh', run: retry });
            return out;
        }, { id: 'planes', title: 'Planes' }) : () => {};

        // the phone top bar's ‹ : let a pinned aircraft go before it leaves
        const offHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (!pinnedHex) return false;
                pinnedHex = '';
                lastRows = '';
                paint();
                return true;
            }, { atTop: () => !pinnedHex })
            : () => {};

        // the map's tiles go through the NAS helper; if it isn't there the
        // scope still draws, so say nothing and stop asking
        if (map) {
            fetch(`${location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095'}/health`, { cache: 'no-store' })
                .then((r) => { if (!r.ok) throw new Error('no helper'); })
                .catch(() => { if (alive) map.tiles(false); });
        }

        const offModel = M ? M.watch(() => paint()) : () => {};

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);

        paintAltKey();
        clockTick();
        paint();

        return {
            phone: false,
            // the stylesheet has landed: the map has a real box at last
            show() { root.style.visibility = ''; fit(); if (map) map.resize(); },
            sync() { paint(); },
            state: () => ({ focus: focusHex, pinned: pinnedHex }),
            teardown() {
                alive = false;
                offActions();
                offHome();
                offModel();
                clearInterval(clockTimer);
                if (map) map.destroy();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false;
    let destroyed = false;

    const isOurRoute = () => /^#!?\/planes(\?|$)/i.test(currentRoute());

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const phoneLayout = () => !!(window.HomerLayout && window.HomerPlanesPhone && window.HomerLayout.usePhone('planes'));
    const PHONE_CTX = {
        model: theModel, statusMessage, altText, speedText, headText, distText, trend, compass,
        whatIsIt, nameOf, routeText, routeLong, ageText, fmtTime, esc, icon, go, goBack, goHome, BASE, QUERY
    };
    const draw = (was) => (phoneLayout() ? window.HomerPlanesPhone.create({ ...PHONE_CTX, was }) : createScreen());

    let carry = null; // what the other layout was looking at

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) { closeScreen(); return; }
        if (screen) { screen.sync(); return; }
        const s = draw(carry);
        carry = null;
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        carry = screen.state ? screen.state() : null;
        closeScreen();
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
    function onRouteChange() { lastSig = ''; queueSync(); }

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

    window.HomerPlanes = {
        version: VERSION,
        open() {
            suppressed = false;
            if (!isOurRoute()) { go('#/planes'); return; }
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
            document.getElementById('hv-css')?.remove();
            document.getElementById('hv-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
