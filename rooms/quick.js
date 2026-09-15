/*
 * HOMER quick controls: Home Assistant's lights, scenes and thermostat over
 * whatever's playing, and the doorbell's picture-in-picture.
 *
 * Quick panel. L (or the lightbulb in Jellyfin's player controls) opens a
 * small panel at the right of the screen, over a full-screen video, a docked
 * one, or any HOMER screen; the video keeps playing under it. One room at a
 * time (◀▶ on its name switches rooms; it remembers the last one): its scenes
 * (◀▶ picks, OK runs) and its lights (◀▶ dims, OK switches), and pinned at
 * the bottom, whatever room you're in, the house's thermostat (◀▶ sets the
 * temperature; its modes under it). L or Esc closes
 * it, and it closes by itself after 20 seconds without a key. On a phone it's
 * a sheet from the bottom: tap to switch, drag a bar to dim.
 *
 * Doorbell. When Home Assistant says the doorbell rang (a Reolink visitor
 * sensor, or a doorbell event entity), a picture-in-picture of the doorbell's
 * camera comes up at the top right over whatever's on screen, live when the
 * camera streams. OK (or a tap) opens the camera in Rooms, with the video
 * docked in Rooms' preview; Esc (or ✕) puts it away; it goes by itself after
 * 30 seconds. Nothing else is taken from the remote while it's up.
 *
 * window.HomerQuick = { open, close, toggle, ring, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerQuick && typeof window.HomerQuick.destroy === 'function') {
        window.HomerQuick.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="quick.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const BASE = scriptSrc.replace(/quick\.js(\?.*)?$/, '');
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const IDLE_MS = 20000; // the panel closes itself
    const PIP_MS = 30000; // the doorbell's picture goes away
    const ROOM_KEY = 'homer-quick-room';
    const BACK_KEYS = ['Escape', 'GoBack', 'BrowserBack'];
    const OSD_BTN_CLASS = 'hqOsdButton';

    const HA = () => window.HomerHA || null;
    const HP = () => window.HomerPlayer || null;
    const C = () => (window.HomerRooms && window.HomerRooms._ctx) || null;
    const phone = () => !!(window.HomerLayout && window.HomerLayout.isPhone());
    const touch = () => !!(window.HomerLayout && window.HomerLayout.isTouch());
    const signedIn = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const s = (creds.Servers || [])[0];
            return !!(s && s.AccessToken && s.UserId);
        } catch {
            return false;
        }
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name, cls) => `<span class="material-icons${cls ? ' ' + cls : ''}" aria-hidden="true">${name}</span>`;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const ready = () => !!(HA() && HA().isSetUp() && C() && signedIn());

    // ---------- Stylesheet ----------

    const ensureCss = () => {
        if (document.getElementById('hq-css') || !BASE) return;
        const l = document.createElement('link');
        l.id = 'hq-css';
        l.rel = 'stylesheet';
        l.href = BASE + 'quick.css' + QUERY;
        document.head.appendChild(l);
    };

    // Both drawn in 1080-tall units and scaled to the window, like the
    // screens' stages (a phone draws them at its own size)
    const layer = document.createElement('div');
    layer.id = 'hq-root';
    const scale = () => {
        const s = phone() ? 1 : window.innerHeight / 1080;
        layer.style.setProperty('--hq-s', String(s));
    };

    // ---------- The quick panel ----------

    const panel = document.createElement('div');
    panel.className = 'hq-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Quick controls');
    panel.innerHTML = `
        <div class="hq-grab"></div>
        <div class="hq-head">
            <div class="hq-eyebrow">${icon('lightbulb')}Quick controls</div>
            <div class="hq-room hq-row" data-r="room" role="button">
                <span class="hq-arrow" data-d="-1" role="button">${icon('chevron_left')}</span>
                <div class="hq-room-text"><div class="hq-room-name"></div><div class="hq-room-sub"></div></div>
                <span class="hq-arrow" data-d="1" role="button">${icon('chevron_right')}</span>
            </div>
        </div>
        <div class="hq-body"><div class="hq-rows"></div></div>
        <div class="hq-foot"></div>
        <div class="hq-state"></div>
        <div class="hq-legend"></div>
        <button type="button" class="hq-close" aria-label="Close">${icon('close')}</button>`;
    const $ = (s) => panel.querySelector(s);

    let open = false;
    let rooms = [];
    let roomId = '';
    let rows = []; // [{ kind, id, which?, ids? }]
    let ri = -1; // -1: the room's name
    let ci = {};
    let idleTimer = 0;
    let builtSig = '';

    const recallRoom = () => { try { return localStorage.getItem(ROOM_KEY) || ''; } catch { return ''; } };
    const keepRoom = (id) => { try { localStorage.setItem(ROOM_KEY, id); } catch { /* this session only */ } };

    // the rooms worth a quick panel: ones with lights or scenes
    const quickRooms = () => {
        const c = C();
        return c ? c.roomList().filter((r) => r.id !== c.CAMERAS && (r.lights.length || r.scenes.length)) : [];
    };
    const room = () => rooms.find((r) => r.id === roomId) || rooms[0] || null;
    const thermostats = () => {
        const h = HA();
        if (!h || h.status() !== 'ready') return [];
        return (h.house().climates || []).map((id) => ({ id, room: null })).slice(0, 2);
    };

    const rowsFor = (r) => {
        const c = C();
        const out = [];
        if (r) {
            if (r.scenes.length) out.push({ kind: 'scenes', ids: r.scenes });
            r.lights.forEach((id) => out.push({ kind: 'light', id }));
        }
        thermostats().forEach(({ id, room: tr }) => {
            const T = c.climateInfo(id, tr);
            (T.targets.length ? T.targets : [{ which: null }]).forEach((t) => out.push({ kind: 'setpoint', id, which: t.which, room: tr }));
            if (T.modes.length) out.push({ kind: 'modes', id, ids: T.modes, room: tr });
        });
        return out;
    };

    const build = () => {
        const c = C();
        const r = room();
        rows = rowsFor(r);
        builtSig = (r ? r.id : '') + '|' + rows.map((x) => x.kind + (x.which || '')).join(',');
        // the room's rows scroll; the thermostat's stay put at the bottom
        const html = { body: '', foot: '' };
        let last = '';
        rows.forEach((row, i) => {
            const sec = row.kind === 'setpoint' || row.kind === 'modes' ? 'Thermostat' : row.kind === 'scenes' ? 'Scenes' : 'Lights';
            const to = sec === 'Thermostat' ? 'foot' : 'body';
            if (sec !== last && to === 'body') html.body += `<div class="hq-sec">${esc(sec)}</div>`;
            last = sec;
            if (row.kind === 'light') {
                html[to] += `<div class="hq-row hq-light" data-r="${i}" role="button">
                        <span class="hq-bulb">${icon('lightbulb')}</span>
                        <div class="hq-light-main"><div class="hq-light-top"><span class="hq-name"></span><span class="hq-val"></span></div><div class="hq-bar"><i></i></div></div>
                    </div>`;
            } else if (row.kind === 'scenes' || row.kind === 'modes') {
                const chips = row.kind === 'scenes'
                    ? row.ids.map((id, k) => `<span class="hq-chip" data-k="${k}" role="button">${esc(HA().name(id, r && r.name))}</span>`)
                    : row.ids.map((m, k) => `<span class="hq-chip" data-k="${k}" data-mode="${m}" role="button">${icon(c.MODE_ICONS[m] || 'thermostat')}${esc(c.MODE_LABELS[m] || m)}</span>`);
                html[to] += `<div class="hq-row hq-chips" data-r="${i}"><div class="hq-track">${chips.join('')}</div></div>`;
            } else {
                html[to] += `<div class="hq-row hq-set" data-r="${i}">
                        <div class="hq-set-text"><div class="hq-name"></div><div class="hq-set-line"></div></div>
                        <span class="hq-step" data-step="-1" role="button">${icon('remove')}</span>
                        <div class="hq-set-v"></div>
                        <span class="hq-step" data-step="1" role="button">${icon('add')}</span>
                    </div>`;
            }
        });
        $('.hq-rows').innerHTML = html.body;
        $('.hq-foot').innerHTML = html.foot;
        ri = clamp(ri, -1, rows.length - 1);
        paint();
    };

    const paint = () => {
        const c = C();
        const h = HA();
        if (!c || !h) return;
        const msg = h.status() === 'ready' ? (rooms.length ? null : { title: 'No lights in Home Assistant\'s rooms' }) : c.statusMessage();
        panel.classList.toggle('waiting', !!msg);
        $('.hq-state').innerHTML = msg ? `<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}` : '';
        const r = room();
        $('.hq-room-name').textContent = r ? r.name : 'Rooms';
        $('.hq-room-sub').textContent = r ? c.roomSummary(r) : '';
        $('.hq-room').classList.toggle('sel', ri === -1 && !touch());
        $('.hq-room').classList.toggle('one', rooms.length < 2);
        rows.forEach((row, i) => {
            const n = panel.querySelector(`.hq-rows [data-r="${i}"], .hq-foot [data-r="${i}"]`);
            if (!n) return;
            n.classList.toggle('sel', i === ri && !touch());
            if (row.kind === 'light') {
                const L = c.lightInfo(row.id, r);
                n.classList.toggle('on', L.on);
                n.classList.toggle('off-line', L.unavailable);
                n.classList.toggle('switch', L.pct == null);
                n.querySelector('.hq-name').textContent = L.name;
                n.querySelector('.hq-val').textContent = c.lightText(L);
                n.querySelector('.hq-bar i').style.width = (L.pct || 0) + '%';
            } else if (row.kind === 'setpoint') {
                const T = c.climateInfo(row.id, row.room);
                const t = T.targets.find((x) => x.which === row.which);
                n.querySelector('.hq-name').textContent = `${T.name} · ${c.deg(T.current)} inside`;
                n.querySelector('.hq-set-line').textContent = t && T.targets.length > 1 ? t.label : c.climateLine(T);
                n.querySelector('.hq-set-v').textContent = t ? c.deg(t.value) : '–';
                n.classList.toggle('idle', !t);
            } else if (row.kind === 'modes') {
                const T = c.climateInfo(row.id, row.room);
                n.querySelectorAll('.hq-chip').forEach((x) => x.classList.toggle('cur', x.dataset.mode === T.mode));
            }
            if (row.ids) {
                const k = clamp(ci[i] || 0, 0, row.ids.length - 1);
                n.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('sel', i === ri && !touch() && +x.dataset.k === k));
            }
        });
        legend();
    };

    const legend = () => {
        if (touch()) { $('.hq-legend').innerHTML = ''; return; }
        const row = rows[ri];
        const items = [];
        if (ri === -1 && rooms.length > 1) items.push(['◀▶', 'Rooms']);
        else if (row && row.kind === 'light') items.push(['◀▶', 'Dim'], ['OK', 'On/off']);
        else if (row && row.kind === 'setpoint') items.push(['◀▶', 'Temperature']);
        else if (row && row.ids) items.push(['◀▶', 'Pick'], ['OK', row.kind === 'scenes' ? 'Turn on' : 'Set']);
        items.push(['L', 'Close']);
        $('.hq-legend').innerHTML = items.map(([k, l]) => `<span><span class="hq-key">${esc(k)}</span>${esc(l)}</span>`).join('');
    };

    const reveal = () => {
        const body = $('.hq-body');
        const n = panel.querySelector(`.hq-rows [data-r="${ri}"], .hq-foot [data-r="${ri}"]`);
        if (!n) { body.scrollTop = 0; return; }
        // (the thermostat at the bottom doesn't scroll)
        if (body.contains(n)) {
            const prev = n.previousElementSibling;
            const top = (prev && prev.classList.contains('hq-sec') ? prev.offsetTop : n.offsetTop) - 8;
            if (top < body.scrollTop) body.scrollTop = top;
            else if (n.offsetTop + n.offsetHeight + 16 > body.scrollTop + body.clientHeight) body.scrollTop = n.offsetTop + n.offsetHeight + 16 - body.clientHeight;
        }
        const row = rows[ri];
        if (row && row.ids) {
            const track = n.querySelector('.hq-track');
            const c = n.querySelector(`[data-k="${ci[ri] || 0}"]`);
            if (track && c) {
                if (c.offsetLeft - 24 < track.scrollLeft) track.scrollLeft = c.offsetLeft - 24;
                else if (c.offsetLeft + c.offsetWidth + 24 > track.scrollLeft + track.clientWidth) track.scrollLeft = c.offsetLeft + c.offsetWidth + 24 - track.clientWidth;
            }
        }
    };

    const toast = (msg) => {
        $('.hq-room-sub').textContent = msg;
        setTimeout(paint, 1800);
    };
    const failed = () => toast('Home Assistant didn\'t take that');

    const switchRoom = (d) => {
        if (rooms.length < 2) return;
        const i = Math.max(0, rooms.findIndex((r) => r.id === roomId));
        roomId = rooms[(i + d + rooms.length) % rooms.length].id;
        keepRoom(roomId);
        ci = {};
        build();
    };
    const act = (row, k) => {
        const h = HA();
        if (!row || !h) return;
        if (row.kind === 'light') h.toggle(row.id).catch(failed);
        else if (row.kind === 'scenes') {
            const id = row.ids[k];
            h.scene(id).then(() => toast(`${h.name(id, room() && room().name)} is on`)).catch(failed);
        } else if (row.kind === 'modes') h.setMode(row.id, row.ids[k]).catch(failed);
    };
    const adjust = (row, d) => {
        const c = C();
        const h = HA();
        if (!row) return;
        if (row.kind === 'light') {
            const L = c.lightInfo(row.id, room());
            if (L.pct != null && !L.unavailable) h.setBrightness(row.id, clamp((Math.round((L.pct || 0) / 10) + d) * 10, 0, 100));
        } else if (row.kind === 'setpoint') {
            const T = c.climateInfo(row.id, row.room);
            const t = T.targets.find((x) => x.which === row.which);
            if (t) h.setTemperature(row.id, row.which, Math.round((t.value + d * T.step) / T.step) * T.step);
        } else if (row.ids) {
            ci[ri] = clamp((ci[ri] || 0) + d, 0, row.ids.length - 1);
            paint();
            reveal();
        }
    };

    const poke = () => {
        clearTimeout(idleTimer);
        // a finger on the sheet keeps it (touch has no idle close)
        if (!touch()) idleTimer = setTimeout(closePanel, IDLE_MS);
    };

    const sync = () => {
        if (!open) return;
        const next = quickRooms();
        const sig = next.map((r) => r.id).join();
        if (sig !== rooms.map((r) => r.id).join()) {
            rooms = next;
            if (!rooms.find((r) => r.id === roomId)) roomId = (rooms.find((r) => r.id === recallRoom()) || rooms.find((r) => r.id === (C() && C().recalled())) || C().firstRoom(rooms) || {}).id || '';
        }
        const r = room();
        if (rowsFor(r).map((x) => x.kind + (x.which || '')).join(',') !== builtSig.split('|')[1] || (r ? r.id : '') !== builtSig.split('|')[0]) build();
        else paint();
    };

    const openPanel = () => {
        if (!ready()) return false;
        ensureCss();
        attach();
        scale();
        open = true;
        rooms = [];
        roomId = recallRoom();
        ri = -1;
        ci = {};
        builtSig = '';
        panel.classList.toggle('phone', phone());
        sync();
        // next frame, so it slides in
        setTimeout(() => panel.classList.add('show'), 20);
        const ae = document.activeElement;
        if (ae && ae !== document.body && !panel.contains(ae) && typeof ae.blur === 'function') ae.blur();
        poke();
        return true;
    };
    const closePanel = () => {
        if (!open) return;
        open = false;
        clearTimeout(idleTimer);
        panel.classList.remove('show');
    };

    // ---------- The doorbell's picture-in-picture ----------

    const pip = document.createElement('div');
    pip.className = 'hq-pip';
    pip.innerHTML = `
        <div class="hq-pip-pic" data-still-box>
            <img alt="" draggable="false">
            <video muted playsinline></video>
            <div class="hq-pip-badge"></div>
        </div>
        <div class="hq-pip-bar">
            ${icon('doorbell', 'hq-pip-icon')}
            <div class="hq-pip-text"><div class="hq-pip-name"></div><div class="hq-pip-when"></div></div>
            <div class="hq-pip-keys"><span><span class="hq-key">OK</span>View</span><span><span class="hq-key">ESC</span>Dismiss</span></div>
        </div>
        <button type="button" class="hq-pip-close" aria-label="Dismiss">${icon('close')}</button>`;
    // the picture at the camera's own shape
    const pipShape = (w, h) => { if (w > 0 && h > 0) pip.querySelector('.hq-pip-pic').style.setProperty('--ar', String(w / h)); };
    pip.querySelector('img').addEventListener('load', (ev) => pipShape(ev.target.naturalWidth, ev.target.naturalHeight));
    pip.querySelector('video').addEventListener('loadedmetadata', (ev) => pipShape(ev.target.videoWidth, ev.target.videoHeight));
    let pipUp = null; // the doorbell showing
    let pipTimer = 0;
    let pipStill = () => {};
    let pipLive = null;
    let pipAt = 0;
    let pipTick = 0;

    const pipWhen = () => {
        const s = Math.round((Date.now() - pipAt) / 1000);
        pip.querySelector('.hq-pip-when').textContent = s < 5 ? 'Doorbell · just now' : `Doorbell · ${s < 60 ? s + ' s' : Math.round(s / 60) + ' min'} ago`;
    };
    const showPip = (bell) => {
        const c = C();
        const h = HA();
        if (!c || !h || !bell || !bell.camera || !signedIn()) return;
        // already looking at that camera in Rooms
        if (/^#\/rooms\?(.*&)?camera=/.test((HP() && HP().route()) || location.hash) && document.querySelector('.ho-zone-camera, .hop-camview.show')) return;
        ensureCss();
        attach();
        scale();
        pipAt = Date.now();
        clearTimeout(pipTimer);
        pipTimer = setTimeout(hidePip, PIP_MS);
        pip.classList.toggle('phone', phone());
        if (pipUp && pipUp.camera === bell.camera) { pipWhen(); return; } // rang again: the timer starts over
        stopPip();
        pipUp = bell;
        pip.querySelector('.hq-pip-name').textContent = h.name(bell.camera);
        pip.querySelector('.hq-pip-keys').style.display = touch() ? 'none' : '';
        const box = pip.querySelector('.hq-pip-pic');
        box.classList.remove('has-still', 'no-still', 'live');
        pip.querySelector('.hq-pip-badge').innerHTML = '';
        pipStill = c.keepStill(pip.querySelector('img'), bell.camera, 1000);
        box.style.removeProperty('--ar');
        const run = h.playCamera(bell.camera, pip.querySelector('video'));
        pipLive = run;
        run.started.then(() => {
            if (pipLive !== run) return;
            box.classList.add('live');
            pip.querySelector('.hq-pip-badge').innerHTML = '<span class="hq-live">Live</span>';
            pipStill();
            pipStill = () => {};
        }).catch(() => {});
        pipWhen();
        clearInterval(pipTick);
        pipTick = setInterval(pipWhen, 5000);
        setTimeout(() => pip.classList.add('show'), 20);
    };
    const stopPip = () => {
        pipStill();
        pipStill = () => {};
        if (pipLive) { pipLive.stop(); pipLive = null; }
        clearInterval(pipTick);
    };
    const hidePip = () => {
        clearTimeout(pipTimer);
        if (!pipUp) return;
        pipUp = null;
        pip.classList.remove('show');
        stopPip();
    };
    const viewPip = () => {
        const bell = pipUp;
        hidePip();
        closePanel();
        if (bell && window.HomerRooms) window.HomerRooms.openCamera(bell.camera);
    };

    // ---------- Putting them on the page ----------

    const attach = () => {
        if (!layer.isConnected && document.body) {
            layer.appendChild(pip);
            layer.appendChild(panel);
            document.body.appendChild(layer);
        }
    };

    // ---------- Input ----------

    const eat = (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
    };
    const onKey = (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const typing = isTyping(ev.target) || isTyping(document.activeElement);
        const k = ev.key;
        if (open) {
            if (typing) return;
            poke();
            if (k === 'l' || k === 'L' || BACK_KEYS.includes(k) || k === 'Backspace') { eat(ev); if (!ev.repeat) closePanel(); return; }
            if (k === 'h' || k === 'H') { closePanel(); return; } // and Home, as usual
            const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k);
            if (!nav) return;
            eat(ev);
            const row = rows[ri];
            if (k === 'ArrowUp') { ri = Math.max(-1, ri - 1); paint(); reveal(); } else if (k === 'ArrowDown') { ri = Math.min(rows.length - 1, ri + 1); paint(); reveal(); } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
                const d = k === 'ArrowLeft' ? -1 : 1;
                if (ri === -1) switchRoom(d);
                else adjust(row, d);
            } else if (!ev.repeat) {
                if (ri === -1) switchRoom(1);
                else act(row, ci[ri] || 0);
            }
            return;
        }
        if (pipUp && !typing) {
            if (k === 'Enter' && !ev.repeat) { eat(ev); viewPip(); return; }
            if (BACK_KEYS.includes(k)) { eat(ev); hidePip(); return; }
        }
        if ((k === 'l' || k === 'L') && !typing && !ev.repeat && ready()) {
            eat(ev);
            openPanel();
        }
    };
    // Jellyfin's player page acts on keyup too (space, Enter)
    const onKeyUp = (ev) => {
        if (!open || isTyping(ev.target)) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(ev.key)) ev.stopImmediatePropagation();
    };

    // taps and clicks on the panel and the picture
    let dragging = null;
    const barPct = (bar, x) => {
        const b = bar.getBoundingClientRect();
        return Math.round(clamp((x - b.left) / b.width, 0, 1) * 20) * 5;
    };
    panel.addEventListener('click', (ev) => {
        const t = ev.target;
        poke();
        if (t.closest('.hq-close')) { closePanel(); return; }
        const arrow = t.closest('.hq-arrow');
        if (arrow) { switchRoom(Number(arrow.dataset.d)); return; }
        const n = t.closest('.hq-rows .hq-row, .hq-foot .hq-row');
        if (!n) return;
        ri = Number(n.dataset.r);
        const row = rows[ri];
        const step = t.closest('.hq-step');
        if (step) { adjust(row, Number(step.dataset.step)); return; }
        const chip = t.closest('[data-k]');
        if (chip) { ci[ri] = Number(chip.dataset.k); paint(); act(row, ci[ri]); return; }
        if (row.kind === 'light' && !t.closest('.hq-bar')) act(row, 0);
        else paint();
    });
    // drag a light's bar to dim it (a finger, or a mouse)
    panel.addEventListener('pointerdown', (ev) => {
        const bar = ev.target.closest('.hq-bar');
        const n = bar && bar.closest('.hq-light');
        if (!n) return;
        const row = rows[Number(n.dataset.r)];
        const L = C().lightInfo(row.id, room());
        if (L.pct == null) return;
        dragging = { bar, id: row.id, fill: bar.querySelector('i') };
        try { bar.setPointerCapture(ev.pointerId); } catch { /* fine */ }
        const p = barPct(bar, ev.clientX);
        dragging.fill.style.width = p + '%';
        dragging.pct = p;
        ev.preventDefault();
    });
    panel.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const p = barPct(dragging.bar, ev.clientX);
        dragging.fill.style.width = p + '%';
        dragging.pct = p;
        poke();
    });
    const endDrag = () => {
        if (!dragging) return;
        HA().setBrightness(dragging.id, dragging.pct);
        dragging = null;
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', () => { dragging = null; paint(); });
    // the trackpad scrolls the panel, not the player's volume
    panel.addEventListener('wheel', (ev) => {
        ev.stopPropagation();
        poke();
    }, { passive: true });

    pip.addEventListener('click', (ev) => {
        if (ev.target.closest('.hq-pip-close')) hidePip();
        else viewPip();
    });

    // a tap outside the sheet closes it (phones); clicks on the video pass through
    const onDocDown = (ev) => {
        if (open && touch() && !panel.contains(ev.target) && !(ev.target.closest && ev.target.closest('.' + OSD_BTN_CLASS))) closePanel();
    };

    // ---------- The lightbulb in Jellyfin's player controls ----------

    const syncOsdButton = () => {
        const bar = document.querySelector('.videoOsdBottom .buttons');
        if (!bar || bar.querySelector('.' + OSD_BTN_CLASS) || !ready()) return;
        let btn;
        try {
            btn = document.createElement('button', { is: 'paper-icon-button-light' });
        } catch {
            btn = document.createElement('button');
        }
        btn.type = 'button';
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.className = `autoSize paper-icon-button-light ${OSD_BTN_CLASS}`;
        btn.title = 'Quick controls (L)';
        btn.setAttribute('aria-label', 'Quick controls');
        btn.innerHTML = '<span class="xlargePaperIconButton material-icons lightbulb" aria-hidden="true"></span>';
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (open) closePanel();
            else openPanel();
        });
        const before = bar.querySelector('.hmOsdHomeButton, .cgOsdGuideButton, .btnPip, .btnVideoOsdSettings, .btnFullscreen');
        bar.insertBefore(btn, before || null);
    };
    const osdTimer = setInterval(syncOsdButton, 500);

    // ---------- Start ----------

    // shared/homeassistant.js loads first; hook on as soon as it's there
    let offHA = () => {};
    let offRing = () => {};
    let hooked = false;
    const hook = () => {
        const h = HA();
        if (!h || hooked) return;
        hooked = true;
        offHA = h.onChange(sync);
        offRing = h.onRing(showPip);
    };
    const hookTimer = setInterval(() => { hook(); if (hooked) clearInterval(hookTimer); }, 500);
    hook();

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', scale);
    document.addEventListener('pointerdown', onDocDown, true);

    window.HomerQuick = {
        version: VERSION,
        open: openPanel,
        close: closePanel,
        toggle() { return open ? (closePanel(), false) : openPanel(); },
        isOpen: () => open,
        // for testing: show the doorbell's picture as if it rang
        ring() {
            const h = HA();
            const bell = h && h.house().doorbells[0];
            if (bell) showPip(bell);
        },
        destroy() {
            closePanel();
            hidePip();
            clearInterval(osdTimer);
            clearInterval(hookTimer);
            offHA();
            offRing();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('resize', scale);
            document.removeEventListener('pointerdown', onDocDown, true);
            document.querySelectorAll('.' + OSD_BTN_CLASS).forEach((b) => b.remove());
            layer.remove();
        }
    };
})();
