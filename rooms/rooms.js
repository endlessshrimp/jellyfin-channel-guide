/*
 * HOMER Rooms: Home Assistant's rooms on the same 1080-tall stage as the
 * other HOMER screens, with controls big enough for a remote.
 *
 * HOMER's own page at #/rooms (Home's Rooms item goes there once Home
 * Assistant is connected in Settings; Jellyfin has nothing at that address).
 * #/rooms?camera=camera.front_door opens straight onto a camera (the
 * doorbell's picture-in-picture does that). The connection, the rooms and the
 * controls are shared/homeassistant.js.
 *
 *   Rooms list   Cameras (every camera), then each room with what's on and
 *                its temperature; Home Assistant's floors order them
 *   The room     its thermostat (◀▶ sets the temperature; a row of modes
 *                under it), its scenes (◀▶ picks, OK runs), its lights (a
 *                row each: ◀▶ dims, OK switches) and its cameras (◀▶
 *                picks, OK opens): the one-row things first, so a room
 *                with a dozen lights doesn't bury them
 *   A camera     large and live, with the other cameras beside it (◀▶ or
 *                ▲▼ switches); for a doorbell, the last day's rings
 *
 * Remote/keyboard: ▲▼ move, OK/▶ opens a room, Esc/Backspace goes back a
 * step (camera → room → rooms list → the previous screen), H goes Home.
 *
 * On a phone (shared/layout.js) Rooms draws rooms/rooms-phone.js instead,
 * from the same helpers (PHONE_CTX).
 *
 * window.HomerRooms = { open, openCamera, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerRooms && typeof window.HomerRooms.destroy === 'function') {
        window.HomerRooms.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="rooms.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/rooms\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'rooms/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const STILL_MS = 3000; // camera stills, while they're on screen
    const BIG_STILL_MS = 1000; // the camera view's still, until (or instead of) live video
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const CAMERAS = '__cameras'; // the Cameras item's id
    const MEMORY_KEY = 'homer-rooms-last'; // the room you were last in, per device

    // ---------- Jellyfin session (only to know someone is signed in) ----------

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
    const HA = () => window.HomerHA || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Rooms]', err); return fallback; }
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
        if (docked() && typeof p.back === 'function') {
            p.back();
            return;
        }
        const before = location.href;
        history.back();
        setTimeout(() => {
            if (location.href === before) go('#/home');
        }, 400);
    };
    const goHome = () => {
        const p = HP();
        if (p && typeof p.goHome === 'function') p.goHome();
        else location.hash = '#/home';
    };
    const fullscreen = () => {
        const p = HP();
        if (p && typeof p.fullscreen === 'function') p.fullscreen();
    };
    const goSettings = () => go('#/mypreferencesmenu');

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const icon = (name, cls) => `<span class="material-icons${cls ? ' ' + cls : ''}" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const remember = (id) => { try { localStorage.setItem(MEMORY_KEY, id); } catch { /* this session only */ } };
    const recalled = () => { try { return localStorage.getItem(MEMORY_KEY) || ''; } catch { return ''; } };

    // ---------- What the rooms show (both layouts, and the quick panel) ----------

    // a Material icon for a room, from its name
    const ROOM_ICONS = [
        [/living|family|den|lounge|great/i, 'weekend'], [/kitchen/i, 'kitchen'], [/dining/i, 'restaurant'],
        [/bed|nursery|guest/i, 'bed'], [/bath|powder|shower/i, 'bathtub'], [/office|study|desk/i, 'computer'],
        [/garage|car/i, 'garage'], [/door|porch|entry|foyer|front/i, 'door_front'],
        [/yard|patio|garden|deck|outside|outdoor|pool|back/i, 'deck'], [/hall|stair|landing/i, 'stairs'],
        [/laundry|utility/i, 'local_laundry_service'], [/media|theat|tv|game|play/i, 'tv']
    ];
    const roomIcon = (room) => {
        if (room.id === CAMERAS) return 'videocam';
        const hit = ROOM_ICONS.find(([re]) => re.test(room.name));
        return hit ? hit[1] : 'meeting_room';
    };

    const unit = () => {
        const h = HA();
        return (h && h.house().unit) || '°F';
    };
    const deg = (v) => (v == null || v === '' || !isFinite(+v) ? '–' : `${Math.round(+v * 2) / 2 % 1 ? (+v).toFixed(1) : Math.round(+v)}°`);

    // what's on in a room, in a few words
    const roomTemp = (room) => {
        const h = HA();
        if (!h) return null;
        if (room.temperature) {
            const s = h.entity(room.temperature);
            if (s && isFinite(parseFloat(s.state))) return parseFloat(s.state);
        }
        for (const id of room.climates) {
            const s = h.entity(id);
            if (s && s.attributes.current_temperature != null) return s.attributes.current_temperature;
        }
        return null;
    };
    const roomSummary = (room) => {
        const h = HA();
        if (!h) return '';
        const parts = [];
        if (room.id === CAMERAS) {
            parts.push(`${room.cameras.length} camera${room.cameras.length === 1 ? '' : 's'}`);
        } else if (room.lights.length) {
            // bulbs, not the groups they're in (unless groups are all there is)
            const single = room.lights.filter((id) => { const s = h.entity(id); return !(s && (Array.isArray(s.attributes.entity_id) || s.attributes.is_hue_group)); });
            const list = single.length ? single : room.lights;
            const on = list.filter((id) => h.lightOn(id)).length;
            parts.push(on === 0 ? 'Lights off' : list.length === 1 ? 'Light on' : `${on} of ${list.length} on`);
        } else if (room.cameras.length) {
            parts.push(`${room.cameras.length} camera${room.cameras.length === 1 ? '' : 's'}`);
        }
        const t = roomTemp(room);
        if (t != null) parts.push(deg(t));
        return parts.join(' · ');
    };

    // a light (or light group), as a row shows it
    const lightInfo = (id, room) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        const pct = h.brightness(id);
        const group = Array.isArray(a.entity_id) || !!a.is_hue_group;
        let name = h.name(id, room && room.name);
        // a room's own group ("Office" in the Office) is its lights, all of them
        if (group && room && name.toLowerCase() === room.name.toLowerCase()) name = 'All lights';
        return {
            id,
            name,
            on: h.lightOn(id),
            pct, // 0–100, or null: it only switches
            group,
            unavailable: !s || s.state === 'unavailable'
        };
    };
    const lightText = (L) => (L.unavailable ? 'Unavailable' : !L.on ? 'Off' : L.pct == null ? 'On' : `${L.pct}%`);

    const MODE_LABELS = { off: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Heat · Cool', auto: 'Auto', dry: 'Dry', fan_only: 'Fan' };
    const MODE_ICONS = { off: 'power_settings_new', heat: 'local_fire_department', cool: 'ac_unit', heat_cool: 'thermostat', auto: 'autorenew', dry: 'water_drop', fan_only: 'air' };
    const ACTIONS = { heating: 'Heating', cooling: 'Cooling', drying: 'Drying', fan: 'Fan running', idle: 'Idle', off: 'Off', preheating: 'Preheating', defrosting: 'Defrosting' };
    const climateInfo = (id, room) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        const mode = s ? s.state : 'unavailable';
        const range = a.target_temp_low != null && a.target_temp_high != null && a.temperature == null;
        const step = a.target_temp_step || (/C/.test(unit()) ? 0.5 : 1);
        const targets = mode === 'off' || mode === 'unavailable' ? []
            : range ? [{ which: 'target_temp_low', label: 'Heat to', value: a.target_temp_low }, { which: 'target_temp_high', label: 'Cool to', value: a.target_temp_high }]
                : a.temperature != null ? [{ which: 'temperature', label: mode === 'heat' ? 'Heat to' : mode === 'cool' ? 'Cool to' : 'Set to', value: a.temperature }] : [];
        const action = a.hvac_action ? ACTIONS[a.hvac_action] || a.hvac_action : '';
        return {
            id,
            name: h.name(id, room && room.name),
            current: a.current_temperature,
            humidity: a.current_humidity,
            mode,
            modes: (a.hvac_modes || []).filter((m) => MODE_LABELS[m]),
            targets,
            step,
            min: a.min_temp,
            max: a.max_temp,
            action,
            unavailable: !s || mode === 'unavailable'
        };
    };
    // "Cooling to 72°" while it's running, "Cool to 72° · Idle" while it
    // waits, "Heat · Cool 68–75°", "Off"
    const RUNNING = ['heating', 'cooling', 'drying', 'preheating', 'defrosting'];
    const climateLine = (C) => {
        if (C.unavailable) return 'Unavailable';
        if (C.mode === 'off') return 'Off';
        const t = C.targets.map((x) => deg(x.value)).join('–');
        const running = RUNNING.includes(String(C.action).toLowerCase());
        const what = running ? C.action : MODE_LABELS[C.mode] || C.mode;
        return `${what}${t ? ' to ' + t : ''}${!running && C.action ? ' · ' + C.action : ''}`;
    };

    const doorbellFor = (camId) => {
        const h = HA();
        return h ? h.house().doorbells.find((d) => d.camera === camId) || null : null;
    };
    const agoText = (d) => {
        const min = Math.round((Date.now() - d.getTime()) / 60000);
        if (min < 1) return 'just now';
        if (min < 60) return `${min} min ago`;
        const hrs = Math.floor(min / 60);
        return hrs < 24 ? `${hrs} hr ago` : `${Math.floor(hrs / 24)} d ago`;
    };
    // when the doorbell last rang: a Date, null (not in a week), or undefined (not known yet)
    const lastRing = (camId) => {
        const h = HA();
        const bell = doorbellFor(camId);
        return bell && h ? h.lastRing(bell.id) : undefined;
    };
    const lastRingText = (camId) => {
        const last = lastRing(camId);
        return last ? `Last ring ${agoText(last)}` : '';
    };
    const noRings = (camId) => {
        const last = lastRing(camId);
        if (last === null) return 'No rings in the last week';
        return last ? `None in the last day. Last ring ${last.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtTime(last)}.` : 'No rings in the last day';
    };
    const ringText = (d) => {
        const today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        return `${sameDay ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' '}${fmtTime(d)}`;
    };

    // A camera's still in an <img>, refreshed every few seconds while it's
    // on screen. The new picture loads out of sight and swaps in, so it never
    // flashes. Returns stop().
    const keepStill = (img, id, everyMs = STILL_MS) => {
        let timer = 0;
        let stopped = false;
        let loading = false;
        const box = img.closest('[data-still-box]') || img.parentElement;
        const load = () => {
            if (stopped || loading) return;
            const h = HA();
            const url = h ? h.snapshotUrl(id, true) : '';
            if (!url) { box && box.classList.add('no-still'); return; }
            if (url.startsWith('data:')) {
                img.src = url;
                box && box.classList.add('has-still');
                return;
            }
            loading = true;
            const next = new Image();
            next.onload = () => {
                loading = false;
                if (stopped) return;
                img.src = next.src;
                box && box.classList.add('has-still');
                box && box.classList.remove('no-still');
            };
            next.onerror = () => {
                loading = false;
                if (!stopped && box && !box.classList.contains('has-still')) box.classList.add('no-still');
            };
            next.src = url;
        };
        load();
        timer = setInterval(() => {
            if (!document.hidden && img.isConnected) load();
        }, everyMs);
        return () => { stopped = true; clearInterval(timer); };
    };

    // Where Rooms opens when you haven't been in one yet: the living room
    // (or the family room, the den), else the first room
    const firstRoom = (list) => (list.find((r) => r.id !== CAMERAS && /living|family|den|lounge/i.test(r.name))
        || list.find((r) => r.id !== CAMERAS) || list[0] || null);

    // The Cameras item, then the rooms (with Other last)
    const roomList = () => {
        const h = HA();
        if (!h || h.status() !== 'ready') return [];
        const house = h.house();
        const list = house.rooms.slice();
        if (house.cameras.length) {
            list.unshift({ id: CAMERAS, name: 'Cameras', floor: '', temperature: null, lights: [], climates: [], scenes: [], cameras: house.cameras.slice() });
        }
        return list;
    };

    // What the screen says while there's nothing to show: { title, text, ok }
    const statusMessage = () => {
        const h = HA();
        const s = h ? h.status() : 'off';
        if (!h || s === 'off' || !h.isSetUp()) return { title: 'Home Assistant isn\'t connected', text: 'Connect it in Settings → Home Assistant.', ok: 'Settings', act: 'settings' };
        if (s === 'connecting') return { title: 'Connecting to Home Assistant…', text: '', spin: true };
        if (s === 'offline') return { title: 'Can\'t reach Home Assistant', text: h.problem() || 'Trying again…', ok: 'Try again', act: 'retry' };
        if (s === 'signin') return { title: 'Sign in to Home Assistant again', text: h.problem(), ok: 'Settings', act: 'settings' };
        if (s === 'blocked') return { title: 'Home Assistant can\'t be reached from here', text: h.problem(), ok: 'Settings', act: 'settings' };
        return null;
    };

    // Stylesheets load on first open. tokens.css normally comes from homer.js;
    // load it here too when this script is used on its own.
    let cssReady = null;
    const ensureCss = () => {
        if (!document.getElementById('homer-tokens')) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE + '../shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
        if (!document.getElementById('homer-shell')) {
            const s = document.createElement('link');
            s.id = 'homer-shell';
            s.rel = 'stylesheet';
            s.href = BASE + '../shared/shell.css' + QUERY;
            document.head.appendChild(s);
        }
        if (cssReady && document.getElementById('ho-css')) return cssReady;
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
        cssReady = Promise.all([link('ho-css', 'rooms.css'), link('ho-phone-css', 'rooms-phone.css')]);
        return cssReady;
    };

    // ---------- The screen (TV) ----------

    const createScreen = (from) => {
        const root = el('div', 'homer-screen');
        root.id = 'ho-root';
        root.style.visibility = 'hidden'; // until rooms.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'ho-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="ho-topbar">
                <div class="ho-brand homer-home" role="button" title="Home (H)"><span class="ho-brand-mark">${icon('home')}</span>HOMER<span class="ho-brand-sub">Rooms</span></div>
                <div class="ho-clock"><div class="ho-clock-time"></div><div class="ho-clock-date"></div></div>
            </div>
            <div class="ho-toast" role="status" aria-live="polite"></div>
            <div class="ho-body">
                <div class="ho-side">
                    <div class="ho-list"><div class="ho-items"></div></div>
                    <div class="ho-preview" data-homer-preview>${icon('live_tv')}</div>
                </div>
                <div class="ho-room">
                    <div class="ho-room-head">
                        <div class="ho-room-name"></div>
                        <div class="ho-room-sub"></div>
                    </div>
                    <div class="ho-room-body"><div class="ho-rows"></div></div>
                </div>
                <div class="ho-state"></div>
            </div>
            <div class="ho-cam">
                <div class="ho-cam-main" data-still-box>
                    <img class="ho-cam-img" alt="" draggable="false">
                    <video class="ho-cam-video" muted playsinline></video>
                    <div class="ho-cam-badge"></div>
                    <div class="ho-cam-none">${icon('videocam_off')}<span>No picture from this camera</span></div>
                </div>
                <div class="ho-cam-side">
                    <div class="ho-cam-name"></div>
                    <div class="ho-cam-room"></div>
                    <div class="ho-cam-rings"></div>
                    <div class="ho-cam-list"></div>
                </div>
            </div>
            <div class="ho-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), like every
        // HOMER screen, so it fills the window instead of letterboxing
        const fit = () => {
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < 1600) { s = box.width / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        const tick = () => {
            const d = new Date();
            $('.ho-clock-time').textContent = fmtTime(d);
            $('.ho-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.ho-clock')) : () => {};

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        const toastEl = $('.ho-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `${icon(kind === 'err' ? 'error_outline' : 'check_circle')}<span class="ho-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'ho-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'ho-toast'; }, 2200);
        };
        const failed = () => toast('Home Assistant didn\'t take that. Try again.', 'err');

        // ----- state -----
        let rooms = [];
        let sel = 0; // the room
        let zone = 'list'; // list | room | camera
        let rows = []; // the room's rows: { kind, id?, ids?, which? }
        let ri = 0; // the row
        let ci = {}; // row index -> the chip/camera picked in it
        let builtFor = ''; // the room the rows were built for
        let cam = null; // the camera view's camera
        let camFrom = 'list'; // where Esc goes from the camera view
        let stills = []; // stop() for each still being refreshed
        let bigStill = () => {};
        let live = null; // { stop } for the camera view's video
        let alive = true;

        const room = () => rooms[sel] || null;

        // ----- the rooms list -----
        const itemsBox = $('.ho-items');
        const drawList = () => {
            itemsBox.innerHTML = rooms.map((r, i) => `
                <div class="ho-item${i === sel ? ' sel' : ''}${r.id === CAMERAS ? ' cams' : ''}" role="button" data-i="${i}">
                    ${icon(roomIcon(r), 'ho-item-icon')}
                    <div class="ho-item-text"><div class="ho-item-label">${esc(r.name)}</div><div class="ho-item-value">${esc(roomSummary(r)) || '&nbsp;'}</div></div>
                    ${icon('chevron_right', 'ho-item-go')}
                </div>`).join('');
            revealItem();
        };
        const paintList = () => {
            itemsBox.querySelectorAll('.ho-item').forEach((n, i) => {
                n.classList.toggle('sel', i === sel);
                const v = n.querySelector('.ho-item-value');
                const t = roomSummary(rooms[i]) || ' ';
                if (v.textContent !== t) v.textContent = t;
            });
        };
        const revealItem = () => {
            const view = $('.ho-list');
            const n = itemsBox.children[sel];
            if (!n) return;
            const pad = 60;
            if (n.offsetTop - pad < view.scrollTop) view.scrollTop = n.offsetTop - pad;
            else if (n.offsetTop + n.offsetHeight + pad > view.scrollTop + view.clientHeight) {
                view.scrollTop = n.offsetTop + n.offsetHeight + pad - view.clientHeight;
            }
        };

        // ----- the room -----
        const rowsBox = $('.ho-rows');
        const stopStills = () => { stills.forEach((s) => s()); stills = []; };

        const rowsFor = (r) => {
            const out = [];
            if (r.id === CAMERAS) {
                for (let i = 0; i < r.cameras.length; i += 2) out.push({ kind: 'cameras', ids: r.cameras.slice(i, i + 2), grid: true });
                return out;
            }
            r.climates.forEach((id) => {
                const C = climateInfo(id, r);
                (C.targets.length ? C.targets : [{ which: null }]).forEach((t) => out.push({ kind: 'setpoint', id, which: t.which }));
                if (C.modes.length) out.push({ kind: 'modes', id, ids: C.modes });
            });
            if (r.scenes.length) out.push({ kind: 'scenes', ids: r.scenes });
            r.lights.forEach((id) => out.push({ kind: 'light', id }));
            if (r.cameras.length) out.push({ kind: 'cameras', ids: r.cameras });
            return out;
        };

        const section = (title, icn) => `<div class="ho-sec">${icon(icn)}${esc(title)}</div>`;
        const lightHtml = (row, i) => `
            <div class="ho-row ho-light" data-r="${i}" role="button">
                <span class="ho-bulb">${icon('lightbulb')}</span>
                <div class="ho-light-text"><div class="ho-light-name"></div><div class="ho-light-sub"></div></div>
                <div class="ho-bar"><i></i></div>
                <div class="ho-light-val"></div>
                <div class="ho-pill"></div>
            </div>`;
        const chipsHtml = (row, i, r) => `
            <div class="ho-row ho-chips" data-r="${i}">
                <div class="ho-chips-track">${row.ids.map((id, k) => `<div class="ho-chip" data-k="${k}" role="button"><span>${esc(HA().name(id, r.name))}</span></div>`).join('')}</div>
            </div>`;
        const setpointHtml = (row, i) => `
            <div class="ho-row ho-set" data-r="${i}">
                <div class="ho-set-now"><div class="ho-set-now-v"></div><div class="ho-set-now-k">Inside</div></div>
                <div class="ho-set-ctl">
                    <span class="ho-step" data-step="-1" role="button">${icon('remove')}</span>
                    <div class="ho-set-target"><div class="ho-set-label"></div><div class="ho-set-v"></div></div>
                    <span class="ho-step" data-step="1" role="button">${icon('add')}</span>
                </div>
                <div class="ho-set-info"><div class="ho-set-name"></div><div class="ho-set-line"></div></div>
            </div>`;
        const modesHtml = (row, i) => `
            <div class="ho-row ho-chips ho-modes" data-r="${i}">
                <div class="ho-chips-track">${row.ids.map((m, k) => `<div class="ho-chip" data-k="${k}" data-mode="${m}" role="button">${icon(MODE_ICONS[m] || 'thermostat')}<span>${esc(MODE_LABELS[m] || m)}</span></div>`).join('')}</div>
            </div>`;
        const camsHtml = (row, i, r) => `
            <div class="ho-row ho-cams${row.grid ? ' grid' : ''}" data-r="${i}">
                ${row.ids.map((id, k) => {
                    const bell = doorbellFor(id);
                    return `<div class="ho-camtile" data-k="${k}" data-cam="${esc(id)}" data-still-box role="button">
                        <img alt="" draggable="false">
                        <div class="ho-camtile-none">${icon('videocam_off')}</div>
                        <div class="ho-camtile-label">${bell ? icon('doorbell') : ''}<span>${esc(HA().name(id, r.id === CAMERAS ? '' : r.name))}</span></div>
                        ${bell ? '<div class="ho-camtile-ring"></div>' : ''}
                    </div>`;
                }).join('')}
            </div>`;

        const buildRoom = () => {
            const r = room();
            stopStills();
            if (!r) { rowsBox.innerHTML = ''; builtFor = ''; return; }
            rows = rowsFor(r);
            builtFor = r.id + '|' + rows.map((x) => x.kind + (x.which || '') + (x.ids ? x.ids.length : '')).join(',');
            let html = '';
            let lastKind = '';
            rows.forEach((row, i) => {
                const kind = row.kind === 'modes' || row.kind === 'setpoint' ? 'climate' : row.kind;
                if (kind !== lastKind && r.id !== CAMERAS) {
                    html += kind === 'light' ? section('Lights', 'lightbulb')
                        : kind === 'scenes' ? section('Scenes', 'palette')
                            : kind === 'climate' ? (lastKind === 'climate' ? '' : section('Thermostat', 'thermostat'))
                                : section('Cameras', 'videocam');
                }
                lastKind = kind;
                html += row.kind === 'light' ? lightHtml(row, i)
                    : row.kind === 'scenes' ? chipsHtml(row, i, r)
                        : row.kind === 'setpoint' ? setpointHtml(row, i)
                            : row.kind === 'modes' ? modesHtml(row, i)
                                : camsHtml(row, i, r);
            });
            if (!rows.length) html = '<div class="ho-empty">Nothing in this room HOMER can control.</div>';
            rowsBox.innerHTML = html;
            rowsBox.querySelectorAll('.ho-camtile').forEach((t) => stills.push(keepStill(t.querySelector('img'), t.dataset.cam)));
            ri = clamp(ri, 0, Math.max(0, rows.length - 1));
            $('.ho-room-body').scrollTop = 0;
            paintRoom();
        };

        // the room's values, in place (states change all the time)
        const paintRoom = () => {
            const r = room();
            if (!r) return;
            $('.ho-room-name').textContent = r.name;
            $('.ho-room-sub').textContent = [r.floor, roomSummary(r)].filter(Boolean).join(' · ');
            rows.forEach((row, i) => {
                const n = rowsBox.querySelector(`[data-r="${i}"]`);
                if (!n) return;
                n.classList.toggle('sel', zone === 'room' && i === ri);
                if (row.kind === 'light') {
                    const L = lightInfo(row.id, r);
                    n.classList.toggle('on', L.on);
                    n.classList.toggle('switch', L.pct == null);
                    n.classList.toggle('off-line', L.unavailable);
                    n.querySelector('.ho-light-name').textContent = L.name;
                    n.querySelector('.ho-light-sub').textContent = '';
                    n.querySelector('.ho-bar i').style.width = (L.pct || 0) + '%';
                    n.querySelector('.ho-light-val').textContent = L.unavailable ? '' : lightText(L);
                    n.querySelector('.ho-pill').textContent = L.unavailable ? 'Offline' : L.on ? 'On' : 'Off';
                } else if (row.kind === 'setpoint') {
                    const C = climateInfo(row.id, r);
                    const t = C.targets.find((x) => x.which === row.which);
                    n.querySelector('.ho-set-now-v').textContent = deg(C.current);
                    n.querySelector('.ho-set-now-k').textContent = C.humidity != null ? `Inside · ${Math.round(C.humidity)}% humidity` : 'Inside';
                    n.querySelector('.ho-set-label').textContent = t ? t.label : 'Set to';
                    n.querySelector('.ho-set-v').textContent = t ? deg(t.value) : '–';
                    n.querySelector('.ho-set-name').textContent = C.name;
                    n.querySelector('.ho-set-line').textContent = climateLine(C);
                    n.classList.toggle('idle', !t);
                    n.dataset.action = (C.action || '').toLowerCase().replace(/\s.*/, '');
                } else if (row.kind === 'modes') {
                    const C = climateInfo(row.id, r);
                    n.querySelectorAll('.ho-chip').forEach((c) => c.classList.toggle('cur', c.dataset.mode === C.mode));
                } else if (row.kind === 'cameras') {
                    n.querySelectorAll('.ho-camtile-ring').forEach((ring) => {
                        ring.textContent = lastRingText(ring.closest('.ho-camtile').dataset.cam);
                    });
                }
                if (row.ids) {
                    const k = clamp(ci[i] || 0, 0, row.ids.length - 1);
                    n.querySelectorAll('[data-k]').forEach((c) => c.classList.toggle('sel', zone === 'room' && i === ri && +c.dataset.k === k));
                }
            });
        };

        const revealRow = () => {
            const body = $('.ho-room-body');
            const n = rowsBox.querySelector(`[data-r="${ri}"]`);
            if (!n) return;
            // the section title above a first row stays in view with it
            const prev = n.previousElementSibling;
            const top = (prev && prev.classList.contains('ho-sec') ? prev.offsetTop : n.offsetTop) - 16;
            const bottom = n.offsetTop + n.offsetHeight + 40;
            if (top < body.scrollTop) body.scrollTop = top;
            else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight;
            // and a chip or camera in its track
            const row = rows[ri];
            if (row && row.ids) {
                const track = n.querySelector('.ho-chips-track');
                const c = n.querySelector(`[data-k="${ci[ri] || 0}"]`);
                if (track && c) {
                    if (c.offsetLeft - 40 < track.scrollLeft) track.scrollLeft = c.offsetLeft - 40;
                    else if (c.offsetLeft + c.offsetWidth + 40 > track.scrollLeft + track.clientWidth) {
                        track.scrollLeft = c.offsetLeft + c.offsetWidth + 40 - track.clientWidth;
                    }
                }
            }
        };

        // ----- the camera view -----
        const camEl = $('.ho-cam');
        const video = $('.ho-cam-video');
        const camList = () => {
            const h = HA();
            return h ? h.house().cameras : [];
        };
        const stopLive = () => {
            if (live) { live.stop(); live = null; }
            camEl.classList.remove('live');
            bigStill();
            bigStill = () => {};
        };
        let ringsFor = '';
        const drawRings = async (id) => {
            const box = $('.ho-cam-rings');
            const bell = doorbellFor(id);
            ringsFor = id;
            if (!bell) { box.innerHTML = ''; return; }
            box.innerHTML = `<div class="ho-rings-head">${icon('doorbell')}Rings today</div><div class="ho-rings-list"><span class="ho-rings-none">Checking…</span></div>`;
            let list = [];
            try { list = await HA().rings(bell.id); } catch { /* shows none */ }
            if (!alive || ringsFor !== id || cam !== id) return;
            const today = list.filter((d) => Date.now() - d.getTime() < 24 * 3600000).slice(0, 6);
            box.querySelector('.ho-rings-list').innerHTML = today.length
                ? today.map((d) => `<div class="ho-ring"><b>${esc(ringText(d))}</b><span>${esc(agoText(d))}</span></div>`).join('')
                : `<span class="ho-rings-none">${esc(noRings(id))}</span>`;
        };
        const drawCamList = () => {
            const list = camList();
            $('.ho-cam-list').innerHTML = list.length > 1
                ? `<div class="ho-rings-head">${icon('videocam')}Cameras</div>` + list.map((id) => `<div class="ho-cam-pick${id === cam ? ' cur' : ''}" data-cam="${esc(id)}" role="button">${icon(doorbellFor(id) ? 'doorbell' : 'videocam')}<span>${esc(HA().name(id))}</span></div>`).join('')
                : '';
        };
        // the picture as big as it goes at the camera's own shape (a doorbell
        // is often 4:3), with its panel beside it
        let camAr = 16 / 9;
        const fitCam = (ar) => {
            if (ar > 0.2 && ar < 5) camAr = ar;
            const main = $('.ho-cam-main');
            const w = Math.min(camEl.clientWidth - 380 - 28, camEl.clientHeight * camAr);
            main.style.width = Math.round(w) + 'px';
            main.style.height = Math.round(w / camAr) + 'px';
        };
        $('.ho-cam-img').addEventListener('load', (ev) => fitCam(ev.target.naturalWidth / ev.target.naturalHeight));
        video.addEventListener('loadedmetadata', () => fitCam(video.videoWidth / video.videoHeight));

        const openCamera = (id, fromZone) => {
            const h = HA();
            if (!h || !id) return;
            stopLive();
            cam = id;
            camFrom = fromZone || (zone === 'camera' ? camFrom : zone);
            setZone('camera');
            fitCam(camAr);
            const main = $('.ho-cam-main');
            main.classList.remove('has-still', 'no-still');
            const img = $('.ho-cam-img');
            img.removeAttribute('src');
            $('.ho-cam-name').textContent = h.name(id);
            const r = rooms.find((x) => x.id !== CAMERAS && x.cameras.includes(id));
            $('.ho-cam-room').textContent = [r ? r.name : '', doorbellFor(id) ? 'Doorbell' : ''].filter(Boolean).join(' · ');
            $('.ho-cam-badge').innerHTML = '<span class="ho-still-badge">Still</span>';
            bigStill = keepStill(img, id, BIG_STILL_MS);
            drawCamList();
            drawRings(id);
            // then live video, if the camera streams
            const run = h.playCamera(id, video);
            live = run;
            run.started.then(() => {
                if (live !== run || !alive) return;
                camEl.classList.add('live');
                $('.ho-cam-badge').innerHTML = '<span class="ho-live-badge">Live</span>';
                bigStill();
                bigStill = () => {};
            }).catch((err) => {
                if (live !== run) return;
                console.info('[HOMER Rooms] no live video; stills instead:', err.message);
            });
        };
        const closeCamera = () => {
            stopLive();
            cam = null;
            ringsFor = '';
            setZone(camFrom === 'room' && rows.length ? 'room' : 'list');
        };
        const stepCamera = (d) => {
            const list = camList();
            const i = list.indexOf(cam);
            if (list.length < 2) return;
            openCamera(list[(i + d + list.length) % list.length], camFrom);
        };

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            const msg = statusMessage();
            if (msg && msg.ok) items.push({ key: 'OK', label: msg.ok, action: 'ok' });
            else if (!msg && zone === 'list') items.push({ key: '▲▼', label: 'Rooms' }, { key: 'OK', label: 'Open', action: 'ok' });
            else if (!msg && zone === 'room') {
                const row = rows[ri];
                items.push({ key: '▲▼', label: 'Move' });
                if (row && row.kind === 'light') {
                    const L = lightInfo(row.id, room());
                    if (L.pct != null) items.push({ key: '◀▶', label: 'Brightness' });
                    items.push({ key: 'OK', label: L.on ? 'Turn off' : 'Turn on', action: 'ok' });
                } else if (row && row.kind === 'setpoint') items.push({ key: '◀▶', label: 'Temperature' });
                else if (row && row.kind === 'scenes') items.push({ key: '◀▶', label: 'Scenes' }, { key: 'OK', label: 'Turn on scene', action: 'ok' });
                else if (row && row.kind === 'modes') items.push({ key: '◀▶', label: 'Modes' }, { key: 'OK', label: 'Set mode', action: 'ok' });
                else if (row && row.kind === 'cameras') items.push({ key: '◀▶', label: 'Cameras' }, { key: 'OK', label: 'View', action: 'ok' });
                items.push({ key: 'ESC', label: 'Rooms', action: 'back' });
            } else if (!msg && zone === 'camera') {
                if (camList().length > 1) items.push({ key: '◀▶', label: 'Next camera' });
                items.push({ key: 'ESC', label: 'Back', action: 'back' });
            }
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' });
            if (zone === 'list' || msg) items.push({ key: 'ESC', label: 'Back', action: 'back' });
            $('.ho-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="ho-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        const setZone = (z) => {
            zone = z;
            stage.classList.toggle('ho-zone-list', z === 'list');
            stage.classList.toggle('ho-zone-room', z === 'room');
            stage.classList.toggle('ho-zone-camera', z === 'camera');
            paintRoom();
            updateLegend();
            if (z === 'room') revealRow();
        };

        const selectRoom = (i) => {
            i = clamp(i, 0, rooms.length - 1);
            if (i === sel && builtFor.startsWith((room() || {}).id + '|')) return;
            sel = i;
            ri = 0;
            ci = {};
            if (room()) remember(room().id);
            paintList();
            revealItem();
            buildRoom();
            updateLegend();
        };

        // ----- controls -----
        const act = (row, k) => {
            const h = HA();
            const r = room();
            if (!row || !h) return;
            if (row.kind === 'light') {
                h.toggle(row.id).catch(failed);
            } else if (row.kind === 'scenes') {
                const id = row.ids[k];
                h.scene(id).then(() => toast(`${h.name(id, r.name)} is on`)).catch(failed);
            } else if (row.kind === 'modes') {
                h.setMode(row.id, row.ids[k]).catch(failed);
            } else if (row.kind === 'cameras') {
                openCamera(row.ids[k], 'room');
            }
        };
        const adjust = (row, d) => {
            const h = HA();
            if (!row || !h) return false;
            if (row.kind === 'light') {
                const L = lightInfo(row.id, room());
                if (L.pct == null || L.unavailable) return true;
                // 10% steps from 0; off → 10%
                const next = clamp((Math.round((L.pct || 0) / 10) + d) * 10, 0, 100);
                h.setBrightness(row.id, next);
                return true;
            }
            if (row.kind === 'setpoint') {
                const C = climateInfo(row.id, room());
                const t = C.targets.find((x) => x.which === row.which);
                if (!t) return true;
                h.setTemperature(row.id, row.which, Math.round((t.value + d * C.step) / C.step) * C.step);
                return true;
            }
            if (row.ids) {
                const k = clamp((ci[ri] || 0) + d, 0, row.ids.length - 1);
                const moved = k !== (ci[ri] || 0);
                ci[ri] = k;
                paintRoom();
                revealRow();
                return moved;
            }
            return false;
        };
        const moveRow = (d) => {
            const n = clamp(ri + d, 0, rows.length - 1);
            if (n === ri) return;
            // between two camera rows of the grid, keep the column
            if (rows[ri].ids && rows[n].ids && rows[n].kind === rows[ri].kind) ci[n] = clamp(ci[ri] || 0, 0, rows[n].ids.length - 1);
            ri = n;
            paintRoom();
            revealRow();
            updateLegend();
        };

        // ----- input -----
        const eat = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        };
        const statusOk = () => {
            const msg = statusMessage();
            if (!msg) return false;
            if (msg.act === 'settings') goSettings();
            else if (msg.act === 'retry' && HA()) HA().reconnect();
            return true;
        };
        const onKey = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (document.querySelector('.hq-panel.show')) return; // the quick panel has them
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') {
                eat(ev);
                if (!ev.repeat) goHome();
                return;
            }
            if (BACK_KEYS.includes(k)) {
                eat(ev);
                if (ev.repeat) return;
                if (zone === 'camera') closeCamera();
                else if (zone === 'room') setZone('list');
                else goBack();
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', ' '];
            if (!handled.includes(k)) return; // F (full screen), G (the guide) and the rest pass through
            eat(ev);
            const enter = k === 'Enter' || k === ' ';
            if (statusMessage()) { if (enter && !ev.repeat) statusOk(); return; }
            if (zone === 'list') {
                if (k === 'ArrowUp') selectRoom(sel - 1);
                else if (k === 'ArrowDown') selectRoom(sel + 1);
                else if ((k === 'ArrowRight' || enter) && rows.length && !ev.repeat) setZone('room');
            } else if (zone === 'room') {
                const row = rows[ri];
                if (k === 'ArrowUp') moveRow(-1);
                else if (k === 'ArrowDown') moveRow(1);
                else if (k === 'PageUp') moveRow(-5);
                else if (k === 'PageDown') moveRow(5);
                else if (k === 'ArrowLeft' || k === 'ArrowRight') {
                    const d = k === 'ArrowLeft' ? -1 : 1;
                    // ◀ from the first chip or camera (or a row that doesn't
                    // adjust) goes back to the rooms
                    if (!adjust(row, d) && d < 0) setZone('list');
                } else if (enter && !ev.repeat) act(row, ci[ri] || 0);
            } else if (zone === 'camera') {
                if (k === 'ArrowLeft' || k === 'ArrowUp') stepCamera(-1);
                else if (k === 'ArrowRight' || k === 'ArrowDown') stepCamera(1);
            }
        };

        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            if (document.querySelector('.hq-panel.show')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const box = ev.target.closest && (ev.target.closest('.ho-list') || ev.target.closest('.ho-room-body'));
            if (box) box.scrollTop += ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaY;
            const track = ev.target.closest && ev.target.closest('.ho-chips-track');
            if (track && ev.deltaX) track.scrollLeft += ev.deltaX;
        };

        const onClick = (ev) => {
            const t = ev.target;
            if (t.closest('.ho-brand')) { goHome(); return; }
            const leg = t.closest('.ho-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'fullscreen') fullscreen();
                else if (a === 'back') onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {}, target: document.body });
                else if (a === 'ok') onKey({ key: 'Enter', preventDefault() {}, stopPropagation() {}, target: document.body });
                return;
            }
            if (t.closest('.ho-state [data-ok]')) { statusOk(); return; }
            const pick = t.closest('.ho-cam-pick');
            if (pick) { openCamera(pick.dataset.cam, camFrom); return; }
            if (zone === 'camera' && t.closest('.ho-cam-main')) { closeCamera(); return; }
            const item = t.closest('.ho-item');
            if (item) { selectRoom(Number(item.dataset.i)); setZone('list'); return; }
            const n = t.closest('.ho-row');
            if (!n) return;
            ri = Number(n.dataset.r);
            const row = rows[ri];
            setZone('room');
            const step = t.closest('.ho-step');
            if (step) { adjust(row, Number(step.dataset.step)); return; }
            const c = t.closest('[data-k]');
            if (c) { ci[ri] = Number(c.dataset.k); paintRoom(); act(row, ci[ri]); return; }
            if (row.kind === 'light') {
                // a click on the bar sets the brightness there; anywhere else switches
                const bar = t.closest('.ho-bar');
                const L = lightInfo(row.id, room());
                if (bar && L.pct != null) {
                    const b = bar.getBoundingClientRect();
                    HA().setBrightness(row.id, Math.round(clamp((ev.clientX - b.left) / b.width, 0, 1) * 10) * 10);
                } else act(row, 0);
            }
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);

        // ----- Home Assistant -----
        const stateEl = $('.ho-state');
        const drawStatus = () => {
            const msg = statusMessage();
            stage.classList.toggle('ho-waiting', !!msg);
            stateEl.classList.toggle('show', !!msg);
            stateEl.innerHTML = msg
                ? `${msg.spin ? '<div class="ho-spinner"></div>' : icon('lightbulb', 'ho-state-icon')}<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}${msg.ok ? `<div class="ho-state-ok" data-ok role="button"><span class="ho-key">OK</span>${esc(msg.ok)}</div>` : ''}`
                : '';
        };
        let wanted = from || null; // a room or camera to open once the house is in
        const sync = () => {
            if (!alive) return;
            drawStatus();
            const next = roomList();
            const sig = next.map((r) => r.id + ':' + r.lights.length + r.scenes.length + r.climates.length + r.cameras.length).join(',');
            const was = rooms.map((r) => r.id + ':' + r.lights.length + r.scenes.length + r.climates.length + r.cameras.length).join(',');
            if (sig !== was) {
                const keep = room() ? room().id : (wanted && wanted.room) || recalled();
                rooms = next;
                sel = rooms.findIndex((r) => r.id === keep);
                if (sel < 0) sel = Math.max(0, rooms.indexOf(firstRoom(rooms)));
                drawList();
                buildRoom();
            } else {
                paintList();
                const r = room();
                // a thermostat switched to a mode with other set points: its rows change
                if (r && rowsFor(r).map((x) => x.kind + (x.which || '')).join() !== rows.map((x) => x.kind + (x.which || '')).join()) buildRoom();
                else paintRoom();
            }
            if (wanted && rooms.length) {
                const w = wanted;
                wanted = null;
                if (w.camera && camList().includes(w.camera)) openCamera(w.camera, 'list');
            }
            if (!rooms.length && zone !== 'list') setZone('list');
            updateLegend();
        };
        const offHA = HA() ? HA().onChange(sync) : () => {};

        // ----- docked video -----
        const syncDocked = () => {
            root.classList.toggle('ho-docked', docked());
            updateLegend();
        };

        setZone('list');
        syncDocked();
        sync();

        return {
            phone: false,
            show() {
                root.style.visibility = '';
                // measured again now the stylesheet is in
                revealItem();
                if (zone === 'room') revealRow();
            },
            sync: syncDocked,
            // where Rooms is, for the phone layout
            state: () => ({ room: room() ? room().id : null, camera: cam }),
            // #/rooms?camera=… while Rooms is already up
            openCamera: (id) => { if (rooms.length) openCamera(id, zone === 'camera' ? camFrom : zone); else wanted = { camera: id }; },
            teardown() {
                alive = false;
                offHA();
                stopStills();
                stopLive();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearTimeout(toastTimer);
                wxDetach();
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false; // closed via close(); stay out of the way until the route changes
    let destroyed = false;

    const isOurRoute = () => /^#!?\/rooms(\?|$)/i.test(currentRoute());
    // #/rooms?camera=camera.front_door
    const routeCamera = () => {
        const h = currentRoute();
        const q = h.indexOf('?');
        return q < 0 ? null : new URLSearchParams(h.slice(q + 1)).get('camera');
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    let shownCamera = null;
    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute() && !/homer-ha=signin/.test(currentRoute());
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) {
            closeScreen();
            return;
        }
        const camId = routeCamera();
        if (screen) {
            screen.sync();
            if (camId && camId !== shownCamera) { shownCamera = camId; screen.openCamera(camId); }
            return;
        }
        shownCamera = camId;
        const s = draw(camId ? { camera: camId } : null);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    // The phone layout: shared/layout.js says when; rooms/rooms-phone.js
    // draws it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerRoomsPhone && window.HomerLayout.usePhone('rooms'));
    const PHONE_CTX = {
        CAMERAS, roomList, firstRoom, roomIcon, roomSummary, lightInfo, lightText, climateInfo, climateLine, deg, MODE_LABELS, MODE_ICONS,
        doorbellFor, agoText, ringText, noRings, lastRingText, keepStill, statusMessage, esc, icon, clamp, remember, recalled,
        goHome, goBack, goSettings, docked,
    };
    const draw = (from) => (phoneLayout() ? window.HomerRoomsPhone.create(PHONE_CTX, from) : createScreen(from));

    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        const from = screen.state();
        closeScreen();
        if (destroyed || !getServer()) return;
        const s = draw(from);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(onLayout) : () => {};

    // HomerPlayer may load after this script; subscribe once it's there.
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
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
        setTimeout(() => {
            syncQueued = false;
            subscribe();
            const sig = currentRoute() + '|' + location.href;
            if (sig === lastSig && (screen || !isOurRoute())) return;
            lastSig = sig;
            sync();
        }, 50);
    };
    const onRouteChange = () => {
        lastSig = '';
        queueSync();
    };

    let observer = null;
    const start = () => {
        // Jellyfin's router uses pushState, which fires no event; watch the DOM
        // (it re-renders on every navigation) and check the address.
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerRooms = {
        version: VERSION,
        // open(): the Rooms screen (going to #/rooms if needed)
        open() {
            suppressed = false;
            if (!isOurRoute()) {
                go('#/rooms');
                return;
            }
            lastSig = '';
            sync();
        },
        // openCamera(id): Rooms, on that camera (the doorbell's picture-in-picture)
        openCamera(id) {
            suppressed = false;
            go('#/rooms?camera=' + encodeURIComponent(id));
        },
        // close(): reveal what's underneath until the route changes
        close() {
            if (!screen) return;
            suppressed = true;
            closeScreen();
        },
        // the helpers the quick panel shares
        _ctx: PHONE_CTX,
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
            document.getElementById('ho-css')?.remove();
            document.getElementById('ho-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
