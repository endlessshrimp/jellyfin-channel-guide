/*
 * HOMER Rooms, phone layout. rooms/rooms.js draws this instead of the TV
 * screen when shared/layout.js says it's a phone; both draw from the same
 * helpers (rooms.js's PHONE_CTX) and shared/homeassistant.js.
 *
 * A row of room chips at the top (Cameras first) picks one room at a time;
 * under it the room's thermostat (− and + for the temperature, the modes
 * under it), its scenes (tap to run), its lights (tap the bulb or the row to
 * switch, drag the bar to dim) and its cameras. A tap on a camera opens
 * it full width, live when the camera streams, with ‹ › for the others and,
 * for a doorbell, the last day's rings. Nothing nests deeper than that.
 *
 * A video playing in a preview window docks at the top (HomerPlayer pins it
 * there); a tap on it goes full screen, ✕ stops it.
 *
 * window.HomerRoomsPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';
    const BIG_STILL_MS = 1000;

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    const create = (ctx, from) => {
        const { esc, icon, clamp } = ctx;
        const HA = () => window.HomerHA || null;
        const P = () => window.HomerPlayer || null;

        let rooms = [];
        let roomId = (from && from.room) || ctx.recalled() || '';
        let wantCamera = (from && from.camera) || null;
        let stills = [];
        let alive = true;

        // ---------- Page ----------
        const root = el('div', 'homer-screen ho-phone');
        root.id = 'ho-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="op-dock">
                <div class="op-video" data-homer-preview><span class="op-video-idle">Tuning…</span></div>
                <div class="op-dock-bar">
                    <span class="op-dock-what"></span>
                    <button type="button" class="op-dock-btn op-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                    <button type="button" class="op-dock-btn op-dock-stop" aria-label="Stop">${icon('close')}</button>
                </div>
            </div>
            <div class="op-main">
                <div class="op-chips"><div class="op-chips-track"></div></div>
                <div class="op-scroll">
                    <div class="op-col">
                        <div class="op-head"><div class="op-name"></div><div class="op-sub"></div></div>
                        <div class="op-rows"></div>
                    </div>
                </div>
                <div class="op-state"></div>
                <div class="op-camview">
                    <div class="op-cam-top">
                        <button type="button" class="op-cam-close" aria-label="Back">${icon('arrow_back')}</button>
                        <div class="op-cam-title"><div class="op-cam-name"></div><div class="op-cam-room"></div></div>
                    </div>
                    <div class="op-cam-pic" data-still-box>
                        <img alt="" draggable="false">
                        <video muted playsinline></video>
                        <div class="op-cam-badge"></div>
                        <button type="button" class="op-cam-step prev" aria-label="Previous camera">${icon('chevron_left')}</button>
                        <button type="button" class="op-cam-step next" aria-label="Next camera">${icon('chevron_right')}</button>
                    </div>
                    <div class="op-cam-rings"></div>
                </div>
            </div>
            <div class="op-toast" role="status" aria-live="polite"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const scroller = $('.op-scroll');

        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ---------- Toast ----------
        const toastEl = $('.op-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `${icon(kind === 'err' ? 'error_outline' : 'check_circle')}<span class="op-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'op-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'op-toast'; }, 2200);
        };
        const failed = () => toast('Home Assistant didn\'t take that', 'err');

        const room = () => rooms.find((r) => r.id === roomId) || rooms[0] || null;
        const stopStills = () => { stills.forEach((s) => s()); stills = []; };

        // ---------- Room chips ----------
        const drawChips = () => {
            $('.op-chips-track').innerHTML = rooms.map((r) => `<button type="button" class="op-chip${r === room() ? ' on' : ''}" data-id="${esc(r.id)}">${icon(ctx.roomIcon(r))}<span>${esc(r.name)}</span></button>`).join('');
            revealChip();
        };
        // the room's chip in view, with the one before it peeking
        const revealChip = () => {
            const on = $('.op-chip.on');
            if (!on) return;
            const t = $('.op-chips-track');
            if (on.offsetLeft < t.scrollLeft + 16 || on.offsetLeft + on.offsetWidth > t.scrollLeft + t.clientWidth - 16) t.scrollLeft = on.offsetLeft - 48;
        };

        // ---------- The room ----------
        const section = (title, icn) => `<div class="op-sec">${icon(icn)}${esc(title)}</div>`;
        const buildRoom = () => {
            const r = room();
            stopStills();
            const box = $('.op-rows');
            if (!r) { box.innerHTML = ''; return; }
            let html = '';
            if (r.climates.length) {
                html += section('Thermostat', 'thermostat') + r.climates.map((id) => `
                    <div class="op-therm" data-id="${esc(id)}">
                        <div class="op-therm-top">
                            <div class="op-therm-now"><div class="op-therm-now-v"></div><div class="op-therm-now-k"></div></div>
                            <div class="op-therm-name"></div>
                        </div>
                        <div class="op-therm-sets"></div>
                        <div class="op-modes"></div>
                    </div>`).join('');
            }
            if (r.scenes.length) {
                html += section('Scenes', 'palette') + `<div class="op-scenes">${r.scenes.map((id) => `<button type="button" class="op-scene" data-id="${esc(id)}">${esc(HA().name(id, r.name))}</button>`).join('')}</div>`;
            }
            if (r.lights.length) {
                html += section('Lights', 'lightbulb') + r.lights.map((id) => `
                    <div class="op-light" data-id="${esc(id)}">
                        <button type="button" class="op-bulb" aria-label="Switch">${icon(HA().glyph(id))}</button>
                        <div class="op-light-main">
                            <div class="op-light-top"><span class="op-light-name"></span><span class="op-light-val"></span></div>
                            <div class="op-bar"><i></i></div>
                        </div>
                    </div>`).join('');
            }
            if (r.cameras.length) {
                if (r.id !== ctx.CAMERAS) html += section('Cameras', 'videocam');
                html += `<div class="op-cams">${r.cameras.map((id) => {
                    const bell = ctx.doorbellFor(id);
                    return `<button type="button" class="op-camtile" data-cam="${esc(id)}" data-still-box>
                        <img alt="" draggable="false">
                        <span class="op-camtile-none">${icon('videocam_off')}</span>
                        <span class="op-camtile-label">${bell ? icon('doorbell') : ''}<span>${esc(HA().name(id, r.id === ctx.CAMERAS ? '' : r.name))}</span></span>
                        ${bell ? '<span class="op-camtile-ring"></span>' : ''}
                    </button>`;
                }).join('')}</div>`;
            }
            if (!html) html = '<div class="op-empty">Nothing in this room HOMER can control.</div>';
            box.innerHTML = html;
            box.querySelectorAll('.op-camtile').forEach((t) => stills.push(ctx.keepStill(t.querySelector('img'), t.dataset.cam)));
            scroller.scrollTop = 0;
            paint();
        };

        const paint = () => {
            const r = room();
            const h = HA();
            if (!r || !h) return;
            $('.op-name').textContent = r.name;
            $('.op-sub').textContent = [r.floor, ctx.roomSummary(r)].filter(Boolean).join(' · ');
            root.querySelectorAll('.op-light').forEach((n) => {
                if (n === dragRow) return; // a finger is on it
                const L = ctx.lightInfo(n.dataset.id, r);
                n.classList.toggle('on', L.on);
                n.classList.toggle('switch', L.pct == null);
                n.classList.toggle('off-line', L.unavailable);
                n.querySelector('.op-light-name').textContent = L.name;
                n.querySelector('.op-light-val').textContent = ctx.lightText(L);
                n.querySelector('.op-bar i').style.width = (L.pct || 0) + '%';
            });
            root.querySelectorAll('.op-therm').forEach((n) => {
                const C = ctx.climateInfo(n.dataset.id, r);
                n.querySelector('.op-therm-now-v').textContent = ctx.deg(C.current);
                n.querySelector('.op-therm-now-k').textContent = C.humidity != null ? `Inside · ${Math.round(C.humidity)}%` : 'Inside';
                n.querySelector('.op-therm-name').innerHTML = `<b>${esc(C.name)}</b><span>${esc(ctx.climateLine(C))}</span>`;
                n.dataset.action = (C.action || '').toLowerCase().replace(/\s.*/, '');
                const sets = n.querySelector('.op-therm-sets');
                const sig = C.targets.map((t) => t.which).join();
                if (sets.dataset.sig !== sig) {
                    sets.dataset.sig = sig;
                    sets.innerHTML = C.targets.map((t) => `
                        <div class="op-set" data-which="${t.which}">
                            <button type="button" class="op-step" data-step="-1" aria-label="Lower">${icon('remove')}</button>
                            <div class="op-set-mid"><div class="op-set-label"></div><div class="op-set-v"></div></div>
                            <button type="button" class="op-step" data-step="1" aria-label="Higher">${icon('add')}</button>
                        </div>`).join('');
                }
                C.targets.forEach((t) => {
                    const s = sets.querySelector(`[data-which="${t.which}"]`);
                    if (!s) return;
                    s.querySelector('.op-set-label').textContent = t.label;
                    s.querySelector('.op-set-v').textContent = ctx.deg(t.value);
                });
                const modes = n.querySelector('.op-modes');
                if (modes.dataset.sig !== C.modes.join()) {
                    modes.dataset.sig = C.modes.join();
                    modes.innerHTML = C.modes.map((m) => `<button type="button" class="op-mode" data-mode="${m}">${icon(ctx.MODE_ICONS[m] || 'thermostat')}<span>${esc(ctx.MODE_LABELS[m] || m)}</span></button>`).join('');
                }
                modes.querySelectorAll('.op-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === C.mode));
            });
            root.querySelectorAll('.op-camtile-ring').forEach((ring) => {
                ring.textContent = ctx.lastRingText(ring.closest('.op-camtile').dataset.cam);
            });
        };

        const pick = (id) => {
            if (id === roomId && room() && room().id === id) return;
            roomId = id;
            ctx.remember(id);
            drawChips();
            buildRoom();
        };

        // ---------- A camera, full width ----------
        const camView = $('.op-camview');
        let cam = null;
        let camStill = () => {};
        let live = null;
        const stopCam = () => {
            camStill();
            camStill = () => {};
            if (live) { live.stop(); live = null; }
            camView.querySelector('.op-cam-pic').classList.remove('live');
        };
        const openCamera = (id) => {
            const h = HA();
            if (!h || !id) return;
            stopCam();
            cam = id;
            camView.classList.add('show');
            root.classList.add('op-cam-open');
            const pic = camView.querySelector('.op-cam-pic');
            pic.classList.remove('has-still', 'no-still');
            const img = pic.querySelector('img');
            img.removeAttribute('src');
            $('.op-cam-name').textContent = h.name(id);
            const r = rooms.find((x) => x.id !== ctx.CAMERAS && x.cameras.includes(id));
            $('.op-cam-room').textContent = [r ? r.name : '', ctx.doorbellFor(id) ? 'Doorbell' : ''].filter(Boolean).join(' · ');
            $('.op-cam-badge').innerHTML = '<span class="op-still">Still</span>';
            const count = h.house().cameras.length;
            camView.querySelectorAll('.op-cam-step').forEach((b) => { b.style.display = count > 1 ? '' : 'none'; });
            camStill = ctx.keepStill(img, id, BIG_STILL_MS);
            drawRings(id);
            const run = h.playCamera(id, pic.querySelector('video'));
            live = run;
            run.started.then(() => {
                if (live !== run || !alive) return;
                pic.classList.add('live');
                $('.op-cam-badge').innerHTML = '<span class="op-live">Live</span>';
                camStill();
                camStill = () => {};
            }).catch(() => {});
        };
        const closeCamera = () => {
            stopCam();
            cam = null;
            camView.classList.remove('show');
            root.classList.remove('op-cam-open');
        };
        const stepCamera = (d) => {
            const list = HA().house().cameras;
            const i = list.indexOf(cam);
            if (list.length > 1) openCamera(list[(i + d + list.length) % list.length]);
        };
        const drawRings = async (id) => {
            const box = $('.op-cam-rings');
            const bell = ctx.doorbellFor(id);
            if (!bell) { box.innerHTML = ''; return; }
            box.innerHTML = `<div class="op-sec">${icon('doorbell')}Rings today</div><div class="op-rings"><span class="op-rings-none">Checking…</span></div>`;
            let list = [];
            try { list = await HA().rings(bell.id); } catch { /* shows none */ }
            if (!alive || cam !== id) return;
            const today = list.filter((d) => Date.now() - d.getTime() < 24 * 3600000).slice(0, 8);
            box.querySelector('.op-rings').innerHTML = today.length
                ? today.map((d) => `<div class="op-ring"><b>${esc(ctx.ringText(d))}</b><span>${esc(ctx.agoText(d))}</span></div>`).join('')
                : `<span class="op-rings-none">${esc(ctx.noRings(id))}</span>`;
        };

        // ---------- Taps ----------
        const onClick = (ev) => {
            const t = ev.target;
            const h = HA();
            if (t.closest('.op-retry')) {
                const msg = ctx.statusMessage();
                if (msg && msg.act === 'settings') ctx.goSettings();
                else if (h) h.reconnect();
                return;
            }
            if (t.closest('.op-cam-close')) { closeCamera(); return; }
            if (t.closest('.op-cam-step')) { stepCamera(t.closest('.op-cam-step').classList.contains('prev') ? -1 : 1); return; }
            if (!h || h.status() !== 'ready') return;
            const chip = t.closest('.op-chip');
            if (chip) { pick(chip.dataset.id); return; }
            const tile = t.closest('.op-camtile');
            if (tile) { openCamera(tile.dataset.cam); return; }
            const scene = t.closest('.op-scene');
            if (scene) {
                const id = scene.dataset.id;
                scene.classList.add('ran');
                setTimeout(() => scene.classList.remove('ran'), 700);
                h.scene(id).then(() => toast(`${h.name(id, room().name)} is on`)).catch(failed);
                return;
            }
            const mode = t.closest('.op-mode');
            if (mode) { h.setMode(mode.closest('.op-therm').dataset.id, mode.dataset.mode).catch(failed); return; }
            const step = t.closest('.op-step');
            if (step) {
                const id = step.closest('.op-therm').dataset.id;
                const which = step.closest('.op-set').dataset.which;
                const C = ctx.climateInfo(id, room());
                const tgt = C.targets.find((x) => x.which === which);
                if (tgt) h.setTemperature(id, which, Math.round((tgt.value + Number(step.dataset.step) * C.step) / C.step) * C.step);
                return;
            }
            const light = t.closest('.op-light');
            if (light && !t.closest('.op-bar') && !light.classList.contains('off-line')) h.toggle(light.dataset.id).catch(failed);
        };

        // drag a light's bar to dim it
        let dragRow = null;
        let drag = null;
        const pct = (bar, x) => {
            const b = bar.getBoundingClientRect();
            return Math.round(clamp((x - b.left) / b.width, 0, 1) * 20) * 5;
        };
        const onDown = (ev) => {
            const bar = ev.target.closest('.op-bar');
            const row = bar && bar.closest('.op-light');
            if (!row || row.classList.contains('switch') || row.classList.contains('off-line')) return;
            dragRow = row;
            drag = { bar, x0: ev.clientX, y0: ev.clientY, moved: false, p: null };
            try { bar.setPointerCapture(ev.pointerId); } catch { /* fine */ }
        };
        const onMove = (ev) => {
            if (!drag) return;
            if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 6) return;
            drag.moved = true;
            drag.p = pct(drag.bar, ev.clientX);
            drag.bar.querySelector('i').style.width = drag.p + '%';
            dragRow.querySelector('.op-light-val').textContent = drag.p ? drag.p + '%' : 'Off';
        };
        const onUp = (ev) => {
            if (!drag) return;
            const p = drag.moved ? drag.p : pct(drag.bar, ev.clientX); // a tap on the bar sets it there
            const id = dragRow.dataset.id;
            drag = null;
            dragRow = null;
            if (p != null && HA()) HA().setBrightness(id, p);
        };
        const onCancel = () => { drag = null; dragRow = null; paint(); };

        // Esc closes the camera, then goes back (a phone with a keyboard)
        const onKey = (ev) => {
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (cam) closeCamera();
            else ctx.goBack();
        };
        const onWheel = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };

        root.addEventListener('click', onClick);
        root.addEventListener('pointerdown', onDown);
        root.addEventListener('pointermove', onMove);
        root.addEventListener('pointerup', onUp);
        root.addEventListener('pointercancel', onCancel);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: true });

        // ---------- Docked video ----------
        const dockEl = $('.op-dock');
        let dockFor = '';
        const syncDock = () => {
            const hp = P();
            const on = !!(hp && hp.docked && hp.docked());
            root.classList.toggle('op-docked', on);
            if (!on) { dockFor = ''; return; }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('op-live-video', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying ? hp.nowPlaying() : null;
            const p = np && np.program;
            const item = np && np.item;
            const what = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ') : item ? item.Name || '' : '';
            if (what !== dockFor) {
                dockFor = what;
                $('.op-dock-what').innerHTML = `${p ? '<span class="op-live-badge">Live</span>' : ''}<span>${esc(what)}</span>`;
            }
        };
        dockEl.addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            if (ev.target.closest('.op-dock-stop')) { ev.stopPropagation(); hp.stop(); } else if (ev.target.closest('.op-dock-full')) { ev.stopPropagation(); hp.fullscreen(); }
        });
        const offPlayer = P() && P().onChange ? P().onChange(syncDock) : () => {};
        const dockTimer = setInterval(syncDock, 500);
        syncDock();

        // ---------- Home Assistant ----------
        const drawStatus = () => {
            const msg = ctx.statusMessage();
            root.classList.toggle('op-waiting', !!msg);
            $('.op-state').innerHTML = msg
                ? `${msg.spin ? '<div class="op-spinner"></div>' : icon('lightbulb', 'op-state-icon')}<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}${msg.ok ? `<button type="button" class="op-retry">${esc(msg.ok)}</button>` : ''}`
                : '';
        };
        const sync = () => {
            if (!alive) return;
            drawStatus();
            const next = ctx.roomList();
            const sig = (list) => list.map((r) => r.id + ':' + r.lights.length + r.scenes.length + r.climates.length + r.cameras.length).join(',');
            if (sig(next) !== sig(rooms)) {
                rooms = next;
                if (!rooms.find((r) => r.id === roomId)) roomId = (ctx.firstRoom(rooms) || {}).id || '';
                drawChips();
                buildRoom();
            } else paint();
            if (wantCamera && rooms.length) {
                const id = wantCamera;
                wantCamera = null;
                if (HA().house().cameras.includes(id)) openCamera(id);
            }
        };
        const offHA = HA() ? HA().onChange(sync) : () => {};
        sync();

        return {
            phone: true,
            show() {
                root.style.visibility = '';
                revealChip(); // measured again now the stylesheet is in
            },
            sync: syncDock,
            state: () => ({ room: room() ? room().id : null, camera: cam }),
            openCamera: (id) => { if (rooms.length) openCamera(id); else wantCamera = id; },
            teardown() {
                alive = false;
                offHA();
                stopStills();
                stopCam();
                clearTimeout(toastTimer);
                clearInterval(dockTimer);
                offPlayer();
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                root.remove();
            }
        };
    };

    window.HomerRoomsPhone = { version: VERSION, create };
    // tell the layout Rooms has a phone layout (Rooms already open on a phone
    // switches over)
    if (window.HomerLayout) window.HomerLayout.register('rooms', { phone: true });
})();
