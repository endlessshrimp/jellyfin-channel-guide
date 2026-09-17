/*
 * HOMER Rooms, phone layout. rooms/rooms.js draws this instead of the TV
 * screen when shared/layout.js says it's a phone; both draw from the same
 * helpers (rooms.js's PHONE_CTX) and shared/homeassistant.js.
 *
 * A row of room chips at the top (Cameras first) picks one room at a time;
 * under it what's worth a glance (the temperature, a door left open), then
 * the room's thermostat (− and + for the temperature, the modes under it),
 * its scenes (tap to run), its lights (wall switches, then the bulbs: tap
 * the bulb or the row to switch, drag the bar to dim, tap a bulb's color dot
 * for its colors), its cameras, its outlets, its players (play, skip, a
 * volume bar, the inputs), its fans and its automations. A tap on a camera
 * opens it full width, live when the camera streams, with ‹ › for the others
 * and, for a doorbell, the last day's rings. An Apple TV or a Samsung TV has
 * a Remote button: a round pad (the arrows around OK) and Back, Home,
 * Play/Pause and the volume under it, a light buzz on each press. Nothing
 * nests deeper than that.
 *
 * A video playing in a preview window docks at the top (HomerPlayer pins it
 * there); a tap on it goes full screen, ✕ stops it.
 *
 * window.HomerRoomsPhone = { create, version }
 */
(() => {
    const VERSION = '0.2.0';
    const BIG_STILL_MS = 1000;
    const REPEAT_WAIT_MS = 450; // a finger held on an arrow or the volume: repeats after this,
    const REPEAT_MS = 170; // then about 6 presses a second

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
        let wantRemote = (from && from.remote) || null;
        let stills = [];
        let alive = true;
        let builtSig = '';

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
                        <div class="op-head"><div class="op-name"></div><div class="op-sub"></div><div class="op-glance"></div></div>
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
                <div class="op-picker"><div class="op-picker-sheet" role="dialog" aria-label="Color"></div></div>
                <div class="op-rmview">
                    <div class="op-cam-top">
                        <button type="button" class="op-cam-close op-rm-close" aria-label="Back">${icon('arrow_back')}</button>
                        <div class="op-art op-rm-art">${icon('tv', 'op-art-icon')}<img alt="" draggable="false"></div>
                        <div class="op-cam-title"><div class="op-cam-name op-rm-name"></div><div class="op-rm-line"></div></div>
                    </div>
                    <div class="op-rm-body">
                        <div class="op-rm-pad">
                            ${['up', 'right', 'down', 'left'].map((k) => `<button type="button" class="op-rm-dir ${k}" data-rk="${k}" aria-label="${ctx.REMOTE_KEYS[k].label}">${icon(ctx.REMOTE_KEYS[k].icon)}</button>`).join('')}
                            <button type="button" class="op-rm-ok" data-rk="select">OK</button>
                        </div>
                        <div class="op-rm-keys">
                            ${['menu', 'home', 'play_pause', 'volume_down', 'volume_up'].map((k) => `<button type="button" class="op-rm-key" data-rk="${k}"><span class="op-rm-key-btn">${icon(ctx.REMOTE_KEYS[k].icon)}</span><span class="op-rm-key-label"></span></button>`).join('')}
                        </div>
                    </div>
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
        const subSection = (title) => `<div class="op-subsec">${esc(title)}</div>`;
        const lightRow = (id) => `
            <div class="op-light" data-id="${esc(id)}">
                <button type="button" class="op-bulb" aria-label="Switch">${icon(HA().glyph(id))}</button>
                <div class="op-light-main">
                    <div class="op-light-top"><span class="op-light-name"></span><span class="op-light-val"></span></div>
                    <div class="op-bar"><i></i></div>
                </div>
                <button type="button" class="op-dot" aria-label="Color"><i></i></button>
            </div>`;
        // an outlet, automation, helper, script or button: tap to switch (or run)
        const entRow = (id, extra) => `
            <div class="op-light op-ent switch${extra ? ' extra' : ''}" data-ent="${esc(id)}"${extra ? ' data-extra="1"' : ''}>
                <button type="button" class="op-bulb" aria-label="Switch">${icon(ctx.entIcon(id))}</button>
                <div class="op-light-main">
                    <div class="op-light-top"><span class="op-light-name"></span><span class="op-light-val"></span></div>
                    <div class="op-ent-sub"></div>
                </div>
            </div>`;
        // a device's own settings (a select's choices, a number's − and +)
        const extrasHtml = (owner) => HA().extras(owner).map((id) => {
            const d = ctx.domainOf(id);
            if (d === 'select') {
                const O = ctx.optionInfo(id);
                if (!O.options.length) return '';
                return `<div class="op-choice" data-sel="${esc(id)}"><div class="op-choice-label">${esc(O.name)}</div><div class="op-choice-chips">${O.options.map((o) => `<button type="button" class="op-mode op-opt" data-v="${esc(o)}"><span>${esc(ctx.pretty(o))}</span></button>`).join('')}</div></div>`;
            }
            if (d === 'number') {
                return `<div class="op-num" data-num="${esc(id)}"><span class="op-num-name"></span><button type="button" class="op-step" data-d="-1" aria-label="Lower">${icon('remove')}</button><span class="op-num-v"></span><button type="button" class="op-step" data-d="1" aria-label="Higher">${icon('add')}</button></div>`;
            }
            return entRow(id, true);
        }).join('');
        const mediaCard = (id, r) => {
            const M = ctx.mediaInfo(id, r);
            const buttons = ctx.mediaButtons(M).filter((b) => b !== 'power' && b !== 'remote');
            const power = M.canOn || M.canOff;
            return `
                <div class="op-media" data-media="${esc(id)}">
                    <div class="op-media-top">
                        <div class="op-art">${icon(M.icon, 'op-art-icon')}<img alt="" draggable="false"></div>
                        <div class="op-media-text"><div class="op-media-name"></div><div class="op-media-line"></div><div class="op-media-title"></div></div>
                        ${power ? `<button type="button" class="op-mb op-mpower" data-b="power" aria-label="Power">${icon('power_settings_new')}</button>` : ''}
                    </div>
                    ${buttons.length || M.canVolume ? `<div class="op-mctl">
                        ${buttons.map((b) => `<button type="button" class="op-mb" data-b="${b}" aria-label="${esc(ctx.MEDIA_BUTTONS[b].label)}">${icon(ctx.MEDIA_BUTTONS[b].icon)}</button>`).join('')}
                        ${M.canVolume ? '<div class="op-bar op-vol"><i></i></div><span class="op-vol-v"></span>' : ''}
                    </div>` : ''}
                    ${M.remote ? `<button type="button" class="op-remote-btn" data-remote="${esc(id)}">${icon('settings_remote')}<span>Remote</span></button>` : ''}
                    ${M.sources.length ? `<div class="op-choice"><div class="op-choice-label">Input</div><div class="op-choice-chips op-sources">${M.sources.map((s) => `<button type="button" class="op-mode op-src" data-v="${esc(s)}"><span>${esc(s)}</span></button>`).join('')}</div></div>` : ''}
                    ${M.unavailable ? '' : extrasHtml(id)}
                </div>`;
        };
        const fanCard = (id, r) => {
            const F = ctx.fanInfo(id, r);
            return `
                <div class="op-fan" data-fan="${esc(id)}">
                    <div class="op-light op-ent acc${F.pct == null ? ' switch' : ''}" data-fanrow="${esc(id)}">
                        <button type="button" class="op-bulb" aria-label="Switch">${icon('air')}</button>
                        <div class="op-light-main">
                            <div class="op-light-top"><span class="op-light-name"></span><span class="op-light-val"></span></div>
                            <div class="op-bar"><i></i></div>
                        </div>
                    </div>
                    ${F.presets.length && !F.unavailable ? `<div class="op-choice"><div class="op-choice-label">Mode</div><div class="op-choice-chips">${F.presets.map((p) => `<button type="button" class="op-mode op-preset" data-v="${esc(p)}"><span>${esc(p)}</span></button>`).join('')}</div></div>` : ''}
                    ${F.unavailable ? '' : extrasHtml(id)}
                </div>`;
        };
        // what the room's rows are built from (they're built again when it changes)
        const roomSig = (r) => {
            if (!r) return '';
            const h = HA();
            const media = ctx.mediaCards(r).map((id) => { const M = ctx.mediaInfo(id, r); return id + ctx.mediaButtons(M).join('') + M.sources.join('') + (M.canVolume ? 'v' : ''); });
            const fans = (r.fans || []).map((id) => { const F = ctx.fanInfo(id, r); return id + F.presets.join('') + (F.pct == null ? '' : 's') + (F.unavailable ? 'u' : ''); });
            const climate = r.climates.map((id) => id + h.extras(id).join(''));
            return [ctx.roomSig(r), media.join(), fans.join(), climate.join()].join('|');
        };

        const buildRoom = (keep) => {
            const r = room();
            stopStills();
            closePicker();
            const box = $('.op-rows');
            builtSig = roomSig(r);
            if (!r) { box.innerHTML = ''; return; }
            const scroll = scroller.scrollTop;
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
                        <div class="op-therm-extras">${extrasHtml(id)}</div>
                    </div>`).join('');
            }
            if (r.scenes.length) {
                html += section('Scenes', 'palette') + `<div class="op-scenes">${r.scenes.map((id) => `<button type="button" class="op-scene" data-id="${esc(id)}">${esc(HA().name(id, r.name))}</button>`).join('')}</div>`;
            }
            if (r.lights.length) {
                // the wall switches, then the bulbs
                const parts = ctx.lightParts(r);
                const split = parts.switches.length && parts.bulbs.length;
                html += section('Lights', 'lightbulb');
                if (split) html += subSection('Wall switches');
                html += parts.switches.map(lightRow).join('');
                if (split) html += subSection(ctx.bulbsLabel(parts.bulbs));
                html += parts.bulbs.map(lightRow).join('');
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
            if ((r.switches || []).length) html += section('Switches & outlets', 'power') + r.switches.map((id) => entRow(id)).join('');
            const cards = ctx.mediaCards(r);
            if (cards.length) html += section('Media', 'speaker') + cards.map((id) => mediaCard(id, r)).join('');
            if ((r.fans || []).length) html += section('Fans', 'air') + r.fans.map((id) => fanCard(id, r)).join('');
            if ((r.auto || []).length) html += section('Automations & helpers', 'autorenew') + r.auto.map((id) => entRow(id)).join('');
            if (!html) html = '<div class="op-empty">Nothing in this room HOMER can control.</div>';
            box.innerHTML = html;
            box.querySelectorAll('.op-camtile').forEach((t) => stills.push(ctx.keepStill(t.querySelector('img'), t.dataset.cam)));
            scroller.scrollTop = keep ? scroll : 0;
            paint();
        };

        const paint = () => {
            const r = room();
            const h = HA();
            if (!r || !h) return;
            $('.op-name').textContent = r.name;
            $('.op-sub').textContent = [r.floor, ctx.roomSummary(r)].filter(Boolean).join(' · ');
            const g = $('.op-glance');
            const gh = ctx.glanceHtml(ctx.glance(r));
            if (g.dataset.html !== gh) { g.dataset.html = gh; g.innerHTML = gh; }
            root.querySelectorAll('.op-light[data-id]').forEach((n) => {
                if (n === dragRow) return; // a finger is on it
                const L = ctx.lightInfo(n.dataset.id, r);
                n.classList.toggle('on', L.on);
                n.classList.toggle('switch', L.pct == null);
                n.classList.toggle('off-line', L.unavailable);
                n.classList.toggle('has-color', !!L.color && !L.unavailable);
                n.querySelector('.op-light-name').textContent = L.name;
                n.querySelector('.op-light-val').textContent = ctx.lightText(L);
                n.querySelector('.op-bar i').style.width = (L.pct || 0) + '%';
                const dot = n.querySelector('.op-dot i');
                dot.style.background = L.dot;
                dot.classList.toggle('lit', !!L.dot);
            });
            root.querySelectorAll('.op-light[data-ent]').forEach((n) => {
                const E = ctx.entInfo(n.dataset.ent, r, !!n.dataset.extra);
                n.classList.toggle('on', E.on);
                n.classList.toggle('run', E.runs);
                n.classList.toggle('off-line', E.unavailable);
                n.querySelector('.op-light-name').textContent = E.name;
                n.querySelector('.op-light-val').textContent = E.unavailable ? 'Unavailable' : E.runs ? ctx.entVerb(E) : E.on ? E.onText : E.offText;
                n.querySelector('.op-ent-sub').textContent = E.sub;
            });
            root.querySelectorAll('.op-fan').forEach((card) => {
                const F = ctx.fanInfo(card.dataset.fan, r);
                const n = card.querySelector('[data-fanrow]');
                if (n !== dragRow) {
                    n.classList.toggle('on', F.on);
                    n.classList.toggle('off-line', F.unavailable);
                    n.querySelector('.op-light-name').textContent = F.name;
                    n.querySelector('.op-light-val').textContent = ctx.fanText(F);
                    n.querySelector('.op-bar i').style.width = (F.pct || 0) + '%';
                }
                card.querySelectorAll('.op-preset').forEach((b) => b.classList.toggle('on', F.on && b.dataset.v === F.preset));
            });
            root.querySelectorAll('.op-media').forEach((card) => {
                const M = ctx.mediaInfo(card.dataset.media, r);
                card.classList.toggle('on', M.active);
                card.classList.toggle('playing', M.playing);
                card.classList.toggle('off-line', M.unavailable);
                card.querySelector('.op-media-name').textContent = M.name;
                card.querySelector('.op-media-line').textContent = ctx.mediaLine(M);
                card.querySelector('.op-media-title').textContent = ctx.mediaTitle(M);
                ctx.setArt(card.querySelector('.op-art'), M);
                card.querySelectorAll('.op-mb').forEach((b) => {
                    b.querySelector('.material-icons').textContent = b.dataset.b === 'power' ? 'power_settings_new' : ctx.mediaButtonIcon(M, b.dataset.b);
                    b.setAttribute('aria-label', ctx.mediaButtonLabel(M, b.dataset.b));
                    b.classList.toggle('on', (b.dataset.b === 'mute' && M.muted) || (b.dataset.b === 'power' && M.active));
                });
                const vol = card.querySelector('.op-vol');
                if (vol && vol !== dragBar) {
                    vol.querySelector('i').style.width = (M.volume || 0) + '%';
                    card.querySelector('.op-vol-v').textContent = M.muted ? 'Muted' : (M.volume || 0) + '%';
                }
                card.querySelectorAll('.op-src').forEach((b) => b.classList.toggle('on', b.dataset.v === M.source));
            });
            root.querySelectorAll('.op-choice[data-sel]').forEach((n) => {
                const O = ctx.optionInfo(n.dataset.sel);
                n.classList.toggle('off-line', O.unavailable);
                n.querySelectorAll('.op-opt').forEach((b) => b.classList.toggle('on', b.dataset.v === O.value));
            });
            root.querySelectorAll('.op-num').forEach((n) => {
                const N = ctx.numberInfo(n.dataset.num);
                n.classList.toggle('off-line', N.unavailable);
                n.querySelector('.op-num-name').textContent = N.name;
                n.querySelector('.op-num-v').textContent = ctx.numberText(N);
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
            if (pick) paintPicker();
            if (rmId) paintRemote();
        };

        const choose = (id) => {
            if (id === roomId && room() && room().id === id) return;
            roomId = id;
            ctx.remember(id);
            drawChips();
            buildRoom();
        };

        // ---------- A bulb's colors: a sheet from the bottom ----------
        // The presets (tap to set), then a white strip (warm to cool) and a
        // color strip: drag along one, and the bulb follows when the finger
        // lifts or rests.
        const pickerEl = $('.op-picker');
        let pick = null; // { id, kelvin, hue }
        const openPicker = (id) => {
            const c = HA().color(id);
            if (!c) return;
            pick = { id, kelvin: c.kelvin || 2700, hue: c.hs ? c.hs[0] : 30 };
            const list = ctx.swatchesFor(c);
            pickerEl.querySelector('.op-picker-sheet').innerHTML = `
                <div class="op-pk-grab"></div>
                <div class="op-pk-head">
                    <span class="op-pk-dot"></span>
                    <div class="op-pk-title"><b class="op-pk-name"></b><span class="op-pk-sub"></span></div>
                    <button type="button" class="op-pk-close" aria-label="Close">${icon('close')}</button>
                </div>
                <div class="op-pk-sws">${list.map((s, k) => `<button type="button" class="op-sw" data-k="${k}"><span class="op-sw-dot" style="background:${ctx.rgbCss(ctx.swatchRgb(s))}"></span><span>${esc(s.name)}</span></button>`).join('')}</div>
                ${c.white ? `<div class="op-pk-strip" data-p="white"><span class="op-pk-label">White</span><div class="op-pk-grad" style="background:${ctx.whiteGradient(c)}"><i></i></div></div>` : ''}
                ${c.color ? `<div class="op-pk-strip" data-p="hue"><span class="op-pk-label">Color</span><div class="op-pk-grad" style="background:${ctx.hueGradient()}"><i></i></div></div>` : ''}`;
            pickerEl.classList.add('show');
            paintPicker();
        };
        const closePicker = () => {
            if (!pick) return;
            pick = null;
            pickerEl.classList.remove('show');
        };
        const paintPicker = () => {
            if (!pick) return;
            const h = HA();
            const c = h.color(pick.id);
            if (!c) { closePicker(); return; }
            const L = ctx.lightInfo(pick.id, room());
            pickerEl.querySelector('.op-pk-name').textContent = L.name;
            pickerEl.querySelector('.op-pk-sub').textContent = !L.on ? 'Off · a color turns it on' : c.kelvin ? `White · ${c.kelvin} K` : 'Color';
            const dot = pickerEl.querySelector('.op-pk-dot');
            dot.style.background = L.dot;
            dot.classList.toggle('lit', !!L.dot);
            const now = ctx.swatchNow(c, ctx.swatchesFor(c));
            pickerEl.querySelectorAll('.op-sw').forEach((b) => b.classList.toggle('on', +b.dataset.k === now));
            const white = pickerEl.querySelector('[data-p="white"] i');
            if (white && !(drag && drag.strip)) white.style.left = ((pick.kelvin - c.min) / (c.max - c.min)) * 100 + '%';
            const hue = pickerEl.querySelector('[data-p="hue"] i');
            if (hue && !(drag && drag.strip)) hue.style.left = (pick.hue / 360) * 100 + '%';
        };
        const stripAt = (strip, x) => {
            const c = HA().color(pick.id);
            const b = strip.querySelector('.op-pk-grad').getBoundingClientRect();
            const f = clamp((x - b.left) / b.width, 0, 1);
            strip.querySelector('i').style.left = f * 100 + '%';
            if (strip.dataset.p === 'white') {
                pick.kelvin = Math.round((c.min + f * (c.max - c.min)) / 50) * 50;
                HA().setColor(pick.id, { kelvin: pick.kelvin });
            } else {
                pick.hue = Math.round(f * 360) % 360;
                HA().setColor(pick.id, { hs: [pick.hue, 100] });
            }
        };

        // ---------- A player's remote ----------
        // A round pad (the arrows around OK), and a row of Back, Home,
        // Play/Pause, Vol− and Vol+. A press goes at once (on the finger
        // down, not the lift), lights its button and buzzes lightly; a finger
        // held on an arrow or the volume repeats.
        const rmView = $('.op-rmview');
        let rmId = null;
        const rmInfo = () => (rmId ? ctx.mediaInfo(rmId, room()) : null);
        const paintRemote = () => {
            const M = rmInfo();
            if (!M) return;
            if (!M.remote) { closeRemote(); return; }
            $('.op-rm-name').textContent = M.name;
            $('.op-rm-line').textContent = [M.stateText, ctx.remoteNowLine(M)].filter(Boolean).join(' · ');
            rmView.classList.toggle('playing', M.playing);
            ctx.setArt($('.op-rm-art'), M);
            rmView.querySelectorAll('.op-rm-key').forEach((b) => {
                b.querySelector('.material-icons').textContent = ctx.remoteKeyIcon(M, b.dataset.rk);
                b.querySelector('.op-rm-key-label').textContent = { volume_down: 'Vol −', volume_up: 'Vol +', play_pause: M.playing ? 'Pause' : 'Play' }[b.dataset.rk] || ctx.remoteKeyLabel(M, b.dataset.rk);
                b.setAttribute('aria-label', ctx.remoteKeyLabel(M, b.dataset.rk));
            });
        };
        const openRemote = (id) => {
            if (!HA() || !HA().remoteFor(id)) return;
            closePicker();
            rmId = id;
            rmView.classList.add('show');
            root.classList.add('op-cam-open');
            paintRemote();
        };
        const closeRemote = () => {
            stopRepeat();
            rmId = null;
            rmView.classList.remove('show');
            if (!cam) root.classList.remove('op-cam-open');
        };
        const lit = new Map();
        const flash = (key) => {
            const n = rmView.querySelector(`[data-rk="${key}"]`);
            if (!n) return;
            n.classList.add('hit');
            clearTimeout(lit.get(key));
            lit.set(key, setTimeout(() => n.classList.remove('hit'), 200));
        };
        let failedAt = 0;
        const press = (key, repeat) => {
            if (!rmId) return;
            flash(key);
            try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* no buzz here */ }
            HA().sendRemote(rmId, key, { repeat: !!repeat }).catch(() => {
                if (Date.now() - failedAt < 3000) return;
                failedAt = Date.now();
                const M = rmInfo();
                toast(`The ${M ? ctx.remoteName(M) : 'TV'} didn't answer`, 'err');
            });
        };
        const REPEATS = ['up', 'down', 'left', 'right', 'volume_up', 'volume_down'];
        let held = null; // { wait, every }
        const stopRepeat = () => {
            if (!held) return;
            clearTimeout(held.wait);
            clearInterval(held.every);
            held = null;
        };
        const onRemoteDown = (ev) => {
            const b = ev.target.closest('[data-rk]');
            if (!b || !rmView.contains(b)) return;
            ev.preventDefault(); // no text selection, no double-tap zoom
            stopRepeat();
            const key = b.dataset.rk;
            press(key);
            if (REPEATS.includes(key)) {
                held = { wait: setTimeout(() => { held.every = setInterval(() => press(key, true), REPEAT_MS); }, REPEAT_WAIT_MS) };
            }
        };
        rmView.addEventListener('pointerdown', onRemoteDown);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => rmView.addEventListener(t, stopRepeat));

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
            if (t.closest('.op-rm-close')) { closeRemote(); return; }
            if (rmView.contains(t)) return; // the remote's keys go on the finger down (onRemoteDown)
            if (t.closest('.op-cam-close')) { closeCamera(); return; }
            if (t.closest('.op-cam-step')) { stepCamera(t.closest('.op-cam-step').classList.contains('prev') ? -1 : 1); return; }
            if (!h || h.status() !== 'ready') return;
            // the color sheet: a preset sets it; a tap beside the sheet closes it
            if (pick) {
                if (t.closest('.op-pk-close') || !t.closest('.op-picker-sheet')) { closePicker(); return; }
                const sw = t.closest('.op-sw');
                if (sw) {
                    const c = h.color(pick.id);
                    const s = ctx.swatchesFor(c)[Number(sw.dataset.k)];
                    if (s.kelvin) pick.kelvin = clamp(s.kelvin, c.min, c.max);
                    else pick.hue = s.hs[0];
                    h.setColor(pick.id, s.kelvin ? { kelvin: s.kelvin } : { hs: s.hs });
                    paintPicker();
                }
                return;
            }
            const chip = t.closest('.op-chip');
            if (chip) { choose(chip.dataset.id); return; }
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
            const r = room();
            // a player's buttons, inputs and settings
            const rb = t.closest('.op-remote-btn');
            if (rb) { openRemote(rb.dataset.remote); return; }
            const card = t.closest('.op-media');
            if (card) {
                const M = ctx.mediaInfo(card.dataset.media, r);
                const b = t.closest('.op-mb');
                if (b) { ctx.mediaButton(M, b.dataset.b).catch(failed); return; }
                const src = t.closest('.op-src');
                if (src) { h.setSource(M.id, src.dataset.v).catch(failed); return; }
            }
            const preset = t.closest('.op-preset');
            if (preset) { h.setPreset(preset.closest('.op-fan').dataset.fan, preset.dataset.v).catch(failed); return; }
            const opt = t.closest('.op-opt');
            if (opt) {
                const id = opt.closest('.op-choice').dataset.sel;
                if (!ctx.optionInfo(id).unavailable) h.setOption(id, opt.dataset.v).catch(failed);
                return;
            }
            const numStep = t.closest('.op-num .op-step');
            if (numStep) {
                const N = ctx.numberInfo(numStep.closest('.op-num').dataset.num);
                if (!N.unavailable) h.setNumber(N.id, clamp(N.value + Number(numStep.dataset.d) * N.step, N.min, N.max));
                return;
            }
            const mode = t.closest('.op-mode[data-mode]');
            if (mode) { h.setMode(mode.closest('.op-therm').dataset.id, mode.dataset.mode).catch(failed); return; }
            const step = t.closest('.op-step[data-step]');
            if (step) {
                const id = step.closest('.op-therm').dataset.id;
                const which = step.closest('.op-set').dataset.which;
                const C = ctx.climateInfo(id, r);
                const tgt = C.targets.find((x) => x.which === which);
                if (tgt) h.setTemperature(id, which, Math.round((tgt.value + Number(step.dataset.step) * C.step) / C.step) * C.step);
                return;
            }
            const fanRow = t.closest('[data-fanrow]');
            if (fanRow) {
                if (!t.closest('.op-bar') && !fanRow.classList.contains('off-line')) h.toggle(fanRow.dataset.fanrow).catch(failed);
                return;
            }
            const ent = t.closest('.op-light[data-ent]');
            if (ent) {
                const E = ctx.entInfo(ent.dataset.ent, r, !!ent.dataset.extra);
                if (E.unavailable) return;
                if (E.runs) {
                    ent.classList.add('ran');
                    setTimeout(() => ent.classList.remove('ran'), 700);
                    h.run(E.id).then(() => toast(`${E.name}: done`)).catch(failed);
                } else h.toggle(E.id).catch(failed);
                return;
            }
            const light = t.closest('.op-light[data-id]');
            if (!light) return;
            if (t.closest('.op-dot')) { if (light.classList.contains('has-color')) openPicker(light.dataset.id); return; }
            if (!t.closest('.op-bar') && !light.classList.contains('off-line')) h.toggle(light.dataset.id).catch(failed);
        };

        // drag a bar: a light's brightness, a fan's speed, a player's volume,
        // a color strip. The new value is sent when the finger lifts.
        let dragRow = null;
        let dragBar = null;
        let drag = null;
        const pct = (bar, x, steps = 20) => {
            const b = bar.getBoundingClientRect();
            return Math.round(clamp((x - b.left) / b.width, 0, 1) * steps) * (100 / steps);
        };
        const onDown = (ev) => {
            const strip = ev.target.closest('.op-pk-strip');
            if (strip && pick) {
                drag = { strip };
                try { strip.setPointerCapture(ev.pointerId); } catch { /* fine */ }
                stripAt(strip, ev.clientX);
                return;
            }
            const bar = ev.target.closest('.op-bar');
            const row = bar && bar.closest('.op-light, .op-media');
            if (!row || row.classList.contains('switch') || row.classList.contains('off-line')) return;
            dragRow = row.classList.contains('op-light') ? row : null;
            dragBar = bar;
            drag = { bar, row, x0: ev.clientX, moved: false, p: null };
            try { bar.setPointerCapture(ev.pointerId); } catch { /* fine */ }
        };
        const onMove = (ev) => {
            if (!drag) return;
            if (drag.strip) { stripAt(drag.strip, ev.clientX); return; }
            if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 6) return;
            drag.moved = true;
            drag.p = pct(drag.bar, ev.clientX);
            drag.bar.querySelector('i').style.width = drag.p + '%';
            const val = drag.row.querySelector('.op-light-val, .op-vol-v');
            if (val) val.textContent = drag.p ? drag.p + '%' : 'Off';
        };
        const onUp = (ev) => {
            if (!drag) return;
            if (drag.strip) { drag = null; return; }
            const p = drag.moved ? drag.p : pct(drag.bar, ev.clientX); // a tap on the bar sets it there
            const row = drag.row;
            drag = null;
            dragRow = null;
            dragBar = null;
            const h = HA();
            if (p == null || !h) return;
            if (row.dataset.id) h.setBrightness(row.dataset.id, p);
            else if (row.dataset.fanrow) {
                const F = ctx.fanInfo(row.dataset.fanrow, room());
                h.setFanSpeed(F.id, Math.round(p / F.step) * F.step);
            } else if (row.dataset.media) h.setVolume(row.dataset.media, p / 100);
        };
        const onCancel = () => { drag = null; dragRow = null; dragBar = null; paint(); };

        // Esc closes the color sheet or the camera, then goes back (a phone
        // with a keyboard)
        const onKey = (ev) => {
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (pick) closePicker();
            else if (rmId) closeRemote();
            else if (cam) closeCamera();
            else ctx.goBack();
        };
        const onWheel = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };

        // the top bar's name (ROOMS) backs out of the color picker, a remote or
        // a camera, to the rooms themselves (shared/layout.js)
        const atTop = () => !pick && !rmId && !cam;
        const offHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (pick) closePicker();
                else if (rmId) closeRemote();
                else if (cam) closeCamera();
                else return false;
                return true;
            }, { atTop })
            : () => {};

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
            const sig = (list) => list.map(ctx.roomSig).join(',');
            if (sig(next) !== sig(rooms)) {
                rooms = next;
                if (!rooms.find((r) => r.id === roomId)) roomId = (ctx.firstRoom(rooms) || {}).id || '';
                drawChips();
                buildRoom();
            } else if (!drag && roomSig(room()) !== builtSig) {
                // a player turned on (its buttons and inputs), a fan went offline
                const keepPick = pick && pick.id;
                buildRoom(true);
                if (keepPick) openPicker(keepPick);
            } else paint();
            if (wantCamera && rooms.length) {
                const id = wantCamera;
                wantCamera = null;
                if (HA().house().cameras.includes(id)) openCamera(id);
            }
            if (wantRemote && rooms.length) {
                const id = wantRemote;
                wantRemote = null;
                remoteFromRoute(id);
            }
        };
        // #/rooms?remote=… (the quick panel's Remote): its room, and its remote
        function remoteFromRoute(id) {
            const r = rooms.find((x) => x.id !== ctx.CAMERAS && x.id !== ctx.CLIMATE && x.media.includes(id));
            if (!r) return;
            choose(r.id);
            openRemote(id);
        }
        const offHA = HA() ? HA().onChange(sync) : () => {};
        sync();

        return {
            phone: true,
            show() {
                root.style.visibility = '';
                revealChip(); // measured again now the stylesheet is in
            },
            sync: syncDock,
            state: () => ({ room: room() ? room().id : null, camera: cam, remote: rmId }),
            openCamera: (id) => { if (rooms.length) openCamera(id); else wantCamera = id; },
            openRemote: (id) => { if (rooms.length) remoteFromRoute(id); else wantRemote = id; },
            teardown() {
                alive = false;
                offHome();
                offHA();
                stopStills();
                stopCam();
                stopRepeat();
                lit.forEach((t) => clearTimeout(t));
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
