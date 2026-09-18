/*
 * HOMER Rooms: Home Assistant's rooms on the same 1080-tall stage as the
 * other HOMER screens, with controls big enough for a remote.
 *
 * HOMER's own page at #/rooms (Home's Rooms item goes there once Home
 * Assistant is connected in Settings; Jellyfin has nothing at that address).
 * #/rooms?camera=camera.front_door opens straight onto a camera (the
 * doorbell's picture-in-picture does that), #/rooms?remote=media_player.x
 * onto a player's remote (the quick panel's Remote). The connection, the rooms and the
 * controls are shared/homeassistant.js.
 *
 *   Who's home   a band across the top: everyone Home Assistant knows, their
 *                picture, whether they're in, where they are and since when
 *   Rooms list   Cameras (every camera), then each room with what's on and
 *                its temperature; Home Assistant's floors order them
 *   The room     its thermostat (◀▶ sets the temperature; a row of modes
 *                under it), its scenes (◀▶ picks, OK runs), its lights (a
 *                row each: ◀▶ dims, OK switches) and its cameras (◀▶
 *                picks, OK opens): the one-row things first, so a room
 *                with a dozen lights doesn't bury them
 *   A camera     large and live, with the other cameras beside it (◀▶ or
 *                ▲▼ switches); for a doorbell, the last day's rings
 *   A remote     an Apple TV's or a Samsung TV's (Remote on its card):
 *                HOMER's keys go to the device (arrows, OK, Back, Space,
 *                + and −) and light up the on-screen remote; H, or Back
 *                held down, comes out of it
 *
 * Remote/keyboard: ▲▼ move, OK/▶ opens a room, Esc/Backspace goes back a
 * step (camera → room → rooms list → the previous screen), H goes Home. ▲
 * from the first room goes up to who's home and ▼ comes back down; nothing on
 * that band is a control, so OK does nothing there.
 *
 * On a phone (shared/layout.js) Rooms draws rooms/rooms-phone.js instead,
 * from the same helpers (PHONE_CTX).
 *
 * window.HomerRooms = { open, openCamera, openRemote, openPeople, close,
 *                       destroy, version }
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
    // House is one menu item over two screens: the rooms here and the camera
    // wall at #/cameras (cameras/cameras.js). Both draw this strip, so the
    // doorbell is a tab away and the old address still works.
    const HOUSE_TABS = [
        { id: 'rooms', label: 'Rooms', icon: 'lightbulb', hash: '#/rooms' },
        { id: 'cameras', label: 'Cameras', icon: 'videocam', hash: '#/cameras' }
    ];
    const CLIMATE = '__climate'; // the Climate item's id (the house's thermostats)
    const MEMORY_KEY = 'homer-rooms-last'; // the room you were last in, per device
    const HOLD_BACK_MS = 600; // Back held this long comes out of the remote
    const REPEAT_MS = 170; // a held arrow or volume key: at most ~6 presses a second

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
        if (room.id === CLIMATE) return 'thermostat';
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
        for (const id of [...room.climates, ...(room.climateTemp || [])]) {
            const s = h.entity(id);
            if (s && s.attributes.current_temperature != null) return s.attributes.current_temperature;
        }
        // else the room's first temperature sensor
        for (const id of (room.glance && room.glance.temps) || []) {
            const s = h.entity(id);
            if (s && isFinite(parseFloat(s.state))) return parseFloat(s.state);
        }
        return null;
    };
    const roomSummary = (room) => {
        const h = HA();
        if (!h) return '';
        const parts = [];
        if (room.id === CAMERAS) {
            parts.push(`${room.cameras.length} camera${room.cameras.length === 1 ? '' : 's'}`);
        } else if (room.id === CLIMATE) {
            parts.push(room.climates.length === 1 ? climateLine(climateInfo(room.climates[0], room)) : `${room.climates.length} thermostats`);
        } else if (room.lights.length) {
            // bulbs, not the groups they're in (unless groups are all there is)
            const single = room.lights.filter((id) => { const s = h.entity(id); return !(s && (Array.isArray(s.attributes.entity_id) || s.attributes.is_hue_group)); });
            const list = single.length ? single : room.lights;
            const on = list.filter((id) => h.lightOn(id)).length;
            parts.push(on === 0 ? 'Lights off' : list.length === 1 ? 'Light on' : `${on} of ${list.length} on`);
        } else if (room.cameras.length) {
            parts.push(`${room.cameras.length} camera${room.cameras.length === 1 ? '' : 's'}`);
        } else if ((room.switches || []).length) {
            const on = room.switches.filter((id) => { const s = h.entity(id); return s && s.state === 'on'; }).length;
            parts.push(on ? `${on} of ${room.switches.length} on` : 'All off');
        } else if ((room.media || []).length && !(room.media || []).some((id) => mediaInfo(id, room).playing)) {
            parts.push(`${room.media.length} player${room.media.length === 1 ? '' : 's'}`);
        }
        // a player playing, by name
        const playing = (room.media || []).map((id) => mediaInfo(id, room)).find((M) => M.playing && M.target === M.id);
        if (playing) parts.push(`${playing.name} playing`);
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
        let name = h.name(id, room && room.name).trim();
        // a room's own group ("Office" in the Office) is its lights, all of them
        if (group && room && name.toLowerCase() === room.name.toLowerCase()) name = 'All lights';
        // a wall switch named just for its room ("Dining Room Light") reads
        // as what it is next to the bulbs
        if (/^switch\./.test(id) && /^lights?$/i.test(name.trim())) name = 'Wall switch';
        const color = h.color(id);
        return {
            id,
            name,
            on: h.lightOn(id),
            pct, // 0–100, or null: it only switches
            group,
            color, // what it can do with color (null: it only dims)
            dot: color && color.rgb ? rgbCss(color.rgb) : '', // its color now, while it's on
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

    // ---------- The rest of a room: bulbs' colors, outlets, players, fans,
    // automations, and what's worth a glance ----------

    const domainOf = (id) => id.split('.')[0];
    const pretty = (s) => { const t = String(s ?? '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
    const rgbCss = (rgb) => (rgb ? `rgb(${rgb.map((v) => Math.round(v)).join(',')})` : '');
    const agoShort = (iso) => {
        const t = Date.parse(iso || '');
        return isFinite(t) && t > 0 && t < Date.now() + 60000 ? agoText(new Date(t)) : '';
    };

    // A room's lights in two parts: its wall switches, then the bulbs (the
    // room's light group, "All lights", first). Both lists are in house order.
    const lightParts = (room) => {
        const h = HA();
        const switches = room.lights.filter((id) => h.isWallSwitch(id));
        return { switches, bulbs: room.lights.filter((id) => !h.isWallSwitch(id)) };
    };
    const bulbsLabel = (ids) => (ids.length && ids.every((id) => HA().platform(id) === 'hue') ? 'Hue bulbs' : 'Bulbs');

    // Color presets: three whites (for a bulb with white) and eight colors
    // (for a color bulb)
    const SWATCHES = [
        { name: 'Warm white', kelvin: 2200 }, { name: 'Soft white', kelvin: 2700 }, { name: 'Daylight', kelvin: 5000 },
        { name: 'Red', hs: [0, 100] }, { name: 'Orange', hs: [26, 100] }, { name: 'Yellow', hs: [48, 100] },
        { name: 'Green', hs: [120, 100] }, { name: 'Teal', hs: [174, 100] }, { name: 'Blue', hs: [226, 100] },
        { name: 'Purple', hs: [275, 90] }, { name: 'Pink', hs: [322, 70] }
    ];
    const swatchesFor = (c) => (c ? SWATCHES.filter((s) => (s.kelvin ? c.white : c.color)) : []);
    // whites drawn a little lighter than the math says, so Warm white doesn't
    // read as orange next to Orange
    const whiteRgb = (k) => HA().kelvinToRgb(k).map((v) => Math.round(v + (255 - v) * 0.35));
    const swatchRgb = (s) => (s.kelvin ? whiteRgb(s.kelvin) : HA().hsToRgb(s.hs));
    // the preset a bulb is showing now (-1 for none)
    const swatchNow = (c, list) => list.findIndex((s) => (s.kelvin
        ? c.kelvin != null && Math.abs(c.kelvin - Math.max(c.min, Math.min(c.max, s.kelvin))) < 150
        : c.hs && Math.abs(((c.hs[0] - s.hs[0] + 540) % 360) - 180) < 8 && Math.abs(c.hs[1] - s.hs[1]) < 15));
    // the white strip's gradient, warm to cool, and the color strip's
    const whiteGradient = (c) => {
        const stops = [];
        for (let i = 0; i <= 6; i++) stops.push(rgbCss(whiteRgb(c.min + ((c.max - c.min) * i) / 6)));
        return `linear-gradient(90deg, ${stops.join(', ')})`;
    };
    const hueGradient = () => `linear-gradient(90deg, ${[0, 45, 90, 135, 180, 225, 270, 315, 360].map((hue) => rgbCss(HA().hsToRgb([hue, 100]))).join(', ')})`;

    // A switch, outlet, automation, helper, script or button, as a row shows
    // it: { id, name, sub, on, runs, unavailable, icon, onText, offText }.
    // A power strip's own switch is its "All outlets".
    const sameDevice = (a, b) => { const h = HA(); return !!h.device(a) && h.device(a) === h.device(b); };
    // a power strip's own switch: its device has outlets too
    const isStrip = (id, room) => HA().isMain(id) && !!room && (room.switches || []).some((x) => x !== id && sameDevice(x, id));
    const ENT_ICONS = { switch: 'power', automation: 'autorenew', input_boolean: 'toggle_on', script: 'play_circle', button: 'touch_app' };
    const entIcon = (id) => (/\block/i.test(HA().shortName(id, '')) ? 'lock' : ENT_ICONS[domainOf(id)] || 'toggle_on');
    const entInfo = (id, room, extra) => {
        const h = HA();
        const s = h.entity(id);
        const d = domainOf(id);
        const runs = d === 'script' || d === 'button';
        let name;
        if (extra) name = h.shortName(id, '');
        else if (d === 'switch' && isStrip(id, room)) {
            const strips = room.switches.filter((x) => isStrip(x, room));
            name = strips.length > 1 ? `${h.name(id, room.name)} · all outlets` : 'All outlets';
        } else if (d === 'switch') name = h.shortName(id, room && room.name);
        else name = h.name(id, room && room.name);
        let sub = '';
        if (s && d === 'automation') sub = s.attributes.last_triggered ? `Last ran ${agoShort(s.attributes.last_triggered)}` : 'Automation';
        else if (s && d === 'script') sub = s.attributes.last_triggered ? `Last ran ${agoShort(s.attributes.last_triggered)}` : 'Script';
        else if (s && d === 'button') sub = agoShort(s.state) ? `Last pressed ${agoShort(s.state)}` : '';
        else if (d === 'input_boolean') sub = 'Helper';
        return {
            id,
            name,
            sub,
            runs,
            on: !runs && !!s && s.state === 'on',
            unavailable: !s || s.state === 'unavailable',
            icon: entIcon(id),
            onText: d === 'automation' ? 'Enabled' : 'On',
            offText: d === 'automation' ? 'Disabled' : 'Off'
        };
    };
    const entVerb = (E) => (E.runs ? (domainOf(E.id) === 'button' ? 'Press' : 'Run') : domainOf(E.id) === 'automation' ? (E.on ? 'Disable' : 'Enable') : E.on ? 'Turn off' : 'Turn on');

    // A player, as its card shows it. A player in a group (Sonos, WiiM
    // multiroom) that follows another shows the group's music and sends play,
    // pause and skip to the one leading it (target); its volume stays its own.
    const MEDIA_STATES = { playing: 'Playing', paused: 'Paused', idle: 'Idle', on: 'On', off: 'Off', standby: 'Standby', buffering: 'Loading', unavailable: 'Unavailable' };
    const mediaInfo = (id, room) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        const state = s ? s.state : 'unavailable';
        const unavailable = !s || state === 'unavailable';
        const off = state === 'off' || state === 'standby';
        const active = !unavailable && !off;
        let name = h.name(id, room && room.id !== '_other' ? room.name : '').trim();
        // "Living Room" in the Living Room is its maker's ("Sonos")
        if (room && name.toLowerCase() === room.name.toLowerCase()) {
            const d = h.device(id);
            if (d && (d.maker || d.model)) name = d.maker && d.maker.length <= 12 ? d.maker.replace(/\s+(inc|corp|corporation|electronics|ltd)\.?$/i, '') : d.model;
        }
        const members = (Array.isArray(a.group_members) ? a.group_members : []).filter((m) => h.entity(m));
        const lead = members.length > 1 ? members[0] : null;
        const target = lead && lead !== id && h.entity(lead) ? lead : id;
        const t = h.entity(target);
        const ta = (t && t.attributes) || {};
        const tState = t ? t.state : state;
        const title = active ? ta.media_title || '' : '';
        const artist = active ? ta.media_artist || ta.media_album_artist || ta.media_series_title || ta.app_name || '' : '';
        const can = (w) => h.supports(id, w);
        const canT = (w) => h.supports(target, w);
        const others = members.filter((m) => m !== id).map((m) => h.name(m, ''));
        return {
            id,
            target,
            name,
            icon: a.device_class === 'tv' || /\btv\b/i.test(name) ? 'tv' : 'speaker',
            state: target !== id && active ? tState : state,
            stateText: MEDIA_STATES[target !== id && active ? tState : state] || pretty(state),
            unavailable,
            off,
            active,
            playing: active && tState === 'playing',
            title,
            artist,
            art: active && (title || ta.entity_picture) ? h.pictureUrl(target) : '',
            artId: target, // whose picture that is: the leader's, in a group
            source: active ? a.source || '' : '',
            sources: active && can('source') && Array.isArray(a.source_list) ? a.source_list : [],
            volume: a.volume_level != null ? Math.round(a.volume_level * 100) : null,
            muted: !!a.is_volume_muted,
            canVolume: active && can('volumeSet') && a.volume_level != null,
            canStep: active && can('volumeStep'),
            canMute: active && can('mute'),
            canPlay: active && (canT('play') || canT('pause')),
            canPrev: active && canT('previous'),
            canNext: active && canT('next'),
            canOn: off && can('turnOn'),
            canOff: active && can('turnOff'),
            group: others.length ? `With ${others.join(', ')}` : '',
            // an Apple TV's or a Samsung TV's remote: { id, platform } or null
            remote: !unavailable && h.remoteFor ? h.remoteFor(id) : null
        };
    };
    // the players a room shows as cards: a group once, under the player
    // leading it (a follower in another room still gets its own card there)
    const mediaCards = (room) => room.media.filter((id) => {
        const M = mediaInfo(id, room);
        return !(M.target !== id && room.media.includes(M.target));
    });
    // a card's buttons, from what the player can do
    const MEDIA_BUTTONS = {
        remote: { icon: 'settings_remote', label: 'Remote' },
        prev: { icon: 'skip_previous', label: 'Previous' },
        play: { icon: 'play_arrow', label: 'Play' },
        next: { icon: 'skip_next', label: 'Next' },
        mute: { icon: 'volume_off', label: 'Mute' },
        power: { icon: 'power_settings_new', label: 'Turn off' }
    };
    // (Remote first: it's the one an Apple TV is for)
    const mediaButtons = (M) => {
        if (M.unavailable) return [];
        const remote = M.remote ? ['remote'] : [];
        if (M.off) return remote.concat(M.canOn ? ['power'] : []);
        return remote.concat([M.canPrev && 'prev', M.canPlay && 'play', M.canNext && 'next', M.canMute && 'mute', M.canOff && 'power'].filter(Boolean));
    };
    const mediaButtonLabel = (M, key) => (key === 'play' ? (M.playing ? 'Pause' : 'Play') : key === 'mute' ? (M.muted ? 'Unmute' : 'Mute') : key === 'power' ? (M.off ? 'Turn on' : 'Turn off') : MEDIA_BUTTONS[key].label);
    const mediaButtonIcon = (M, key) => (key === 'play' ? (M.playing ? 'pause' : 'play_arrow') : key === 'mute' ? (M.muted ? 'volume_off' : 'volume_up') : MEDIA_BUTTONS[key].icon);
    const mediaLine = (M) => [M.stateText, M.source && !M.title ? M.source : '', M.group].filter(Boolean).join(' · ');
    // The cover, once it has really loaded. Home Assistant's picture for a
    // player is a proxy address that can answer with something the browser
    // can't draw (an Apple TV's covers come back as HEIC), so ask
    // shared/homeassistant.js for the first one that works and only then put
    // it in — otherwise the row keeps its icon instead of a blank square.
    const setArt = (box, M) => {
        const img = box.querySelector('img');
        if (img.dataset.src === M.art) return;
        img.dataset.src = M.art;
        box.classList.remove('has-art');
        img.removeAttribute('src');
        if (!M.art) return;
        const want = M.art;
        const draw = (url) => {
            if (!url || img.dataset.src !== want) return;
            img.onload = () => box.classList.add('has-art');
            img.src = url;
        };
        const h = HA();
        if (h && h.loadPicture) h.loadPicture(M.artId || M.id).then(draw, () => {});
        else draw(want);
    };

    const mediaTitle = (M) => [M.title, M.artist].filter(Boolean).join(' — ');
    // the remote's volume step: 5%
    const stepMedia = (M, d) => {
        const h = HA();
        if (M.canVolume) h.setVolume(M.id, (M.volume + d * 5) / 100);
        else if (M.canStep) h.stepVolume(M.id, d).catch(() => {});
    };
    const mediaButton = (M, key) => {
        const h = HA();
        if (key === 'remote') return Promise.resolve(); // each layout opens its own remote
        if (key === 'prev') return h.mediaCommand(M.target, 'media_previous_track');
        if (key === 'next') return h.mediaCommand(M.target, 'media_next_track');
        if (key === 'play') return h.playPause(M.target);
        if (key === 'mute') return h.mute(M.id);
        return h.power(M.id);
    };

    // ---------- A player's remote (both layouts) ----------
    // The remote's keys, as HomerHA.sendRemote names them: what each is
    // called on screen and its icon. An Apple TV's Home is its TV button.
    const REMOTE_KEYS = {
        up: { label: 'Up', icon: 'keyboard_arrow_up' },
        down: { label: 'Down', icon: 'keyboard_arrow_down' },
        left: { label: 'Left', icon: 'keyboard_arrow_left' },
        right: { label: 'Right', icon: 'keyboard_arrow_right' },
        select: { label: 'OK', icon: '' },
        menu: { label: 'Back', icon: 'arrow_back' },
        home: { label: 'Home', icon: 'home' },
        play_pause: { label: 'Play / Pause', icon: 'play_arrow' },
        volume_down: { label: 'Volume down', icon: 'volume_down' },
        volume_up: { label: 'Volume up', icon: 'volume_up' }
    };
    const remoteKeyLabel = (M, key) => (key === 'home' && M.remote && M.remote.platform === 'apple_tv' ? 'TV / Home' : REMOTE_KEYS[key].label);
    const remoteKeyIcon = (M, key) => (key === 'home' && M.remote && M.remote.platform === 'apple_tv' ? 'tv' : key === 'play_pause' ? (M.playing ? 'pause' : 'play_arrow') : REMOTE_KEYS[key].icon);
    // what the remote is controlling, for "Your remote is controlling the
    // Apple TV": the player's name when it says what it is ("Apple TV",
    // "Bedroom TV"), else what it is (an Apple TV named "Bedroom")
    const REMOTE_KIND = { apple_tv: 'Apple TV', samsungtv: 'Samsung TV' };
    const remoteName = (M) => {
        const kind = (M.remote && REMOTE_KIND[M.remote.platform]) || 'TV';
        return /\btv\b|apple/i.test(M.name) ? M.name : kind;
    };
    // what's on it: the title, and the show or the app
    const remoteNowLine = (M) => [M.title, M.artist].filter(Boolean).join(' · ');

    // A fan (the purifier): { id, name, on, pct (null: no speeds), step,
    // presets, preset, unavailable }
    const fanInfo = (id, room) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        const on = !!s && s.state === 'on';
        const speeds = h.supports(id, 1);
        return {
            id,
            name: h.shortName(id, room && room.name),
            on,
            pct: speeds ? (on ? a.percentage || 0 : 0) : null,
            step: a.percentage_step || 10,
            presets: h.supports(id, 8) && Array.isArray(a.preset_modes) ? a.preset_modes : [],
            preset: a.preset_mode || '',
            unavailable: !s || s.state === 'unavailable'
        };
    };
    const fanText = (F) => (F.unavailable ? 'Unavailable' : !F.on ? 'Off' : [F.preset, F.pct ? F.pct + '%' : ''].filter(Boolean).join(' · ') || 'On');

    // A device's own setting: a choice (select) or a number
    const optionInfo = (id) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        return { id, name: h.shortName(id, ''), options: Array.isArray(a.options) ? a.options : [], value: s ? s.state : '', unavailable: !s || s.state === 'unavailable' };
    };
    const numberInfo = (id) => {
        const h = HA();
        const s = h.entity(id);
        const a = (s && s.attributes) || {};
        const v = s ? parseFloat(s.state) : NaN;
        const min = a.min != null ? a.min : 0;
        const max = a.max != null ? a.max : 100;
        return {
            id, name: h.shortName(id, ''), value: isFinite(v) ? v : null, min, max, step: a.step || 1, unit: a.unit_of_measurement || '',
            pct: isFinite(v) && max > min ? Math.round(((v - min) / (max - min)) * 100) : 0,
            unavailable: !s || s.state === 'unavailable' || !isFinite(v)
        };
    };
    const numberText = (N) => (N.unavailable ? 'Unavailable' : `${Math.round(N.value * 100) / 100}${N.unit && N.unit !== '%' ? ' ' + N.unit : N.unit}`);

    // At a glance: who Home Assistant puts in the room, its temperature and
    // humidity, a door or window left open, motion now, the air, a leak or
    // smoke. Read only; nothing else of Home Assistant's hundreds of sensors.
    // (shared/alerts.js reads the same buckets for the alert crawl, so there
    // is one list of what matters, not two.)
    const DOOR_ICONS = { window: 'window', garage_door: 'garage' };
    const ALERT_TEXT = { smoke: 'Smoke', carbon_monoxide: 'Carbon monoxide', gas: 'Gas', moisture: 'Leak' };
    const glance = (room) => {
        const h = HA();
        const g = room.glance;
        if (!h || !g) return [];
        const out = [];
        const num = (id) => { const s = h.entity(id); const v = s ? parseFloat(s.state) : NaN; return isFinite(v) ? v : null; };
        const on = (id) => { const s = h.entity(id); return !!s && s.state === 'on'; };
        // a second reading is labeled: "SmartSensor Temperature" is
        // "SmartSensor", and the thermostat's own is "Thermostat"
        const thermostat = (id) => !!h.device(id) && h.house().climates.some((c) => h.device(c) === h.device(id));
        const label = (id, words) => (thermostat(id) ? 'Thermostat' : h.name(id, room.name).replace(words, '').replace(/\s+/g, ' ').trim());
        // Who's in this room, where Home Assistant knows: a person entity is
        // placed by the tracker that decided for them (person.source), and
        // most houses have put none of those in an area, so most rooms show
        // nothing here. Cheap either way \u2014 it's the same people() the rest
        // of HOMER reads.
        const here = typeof h.peopleIn === 'function' ? h.peopleIn(room.id) : [];
        here.forEach((p) => out.push({ icon: 'person', text: p.name, kind: 'live' }));
        const temps = g.temps.filter((id) => num(id) != null);
        temps.forEach((id) => out.push({ icon: 'thermostat', text: temps.length > 1 ? `${label(id, /\b(current\s+)?temperature\b/i)} ${deg(num(id))}` : deg(num(id)) }));
        const hums = g.hums.filter((id) => num(id) != null);
        hums.forEach((id) => out.push({ icon: 'water_drop', text: `${hums.length > 1 ? label(id, /\b(current\s+)?humidity\b/i) + ' ' : ''}${Math.round(num(id))}%` }));
        g.air.filter((id) => num(id) != null).forEach((id) => {
            const dc = h.entity(id).attributes.device_class;
            const v = Math.round(num(id));
            // the EPA's bands: PM2.5 good to 9 µg/m³, fair to 35; AQI good to 50, fair to 100
            const q = dc === 'pm25' ? (v <= 9 ? 'good' : v <= 35 ? 'fair' : 'poor') : dc === 'aqi' ? (v <= 50 ? 'good' : v <= 100 ? 'fair' : 'poor') : '';
            out.push({
                icon: 'air',
                text: dc === 'pm25' ? `Air ${q} · ${v} µg/m³` : dc === 'aqi' ? `Air ${q} · AQI ${v}` : `CO₂ ${v} ppm`,
                kind: q === 'poor' ? 'warn' : ''
            });
        });
        g.doors.filter(on).forEach((id) => {
            let n = h.name(id, room.name).replace(/\b(\w+)\s+\1$/i, '$1').trim(); // "Front Door Door"
            n = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
            out.push({ icon: DOOR_ICONS[h.entity(id).attributes.device_class] || 'meeting_room', text: `${n} open`, kind: 'warn' });
        });
        if (g.motion.some(on)) out.push({ icon: 'directions_walk', text: 'Motion now', kind: 'live' });
        g.alerts.filter(on).forEach((id) => out.push({ icon: 'warning', text: ALERT_TEXT[h.entity(id).attributes.device_class] || h.name(id, room.name), kind: 'alert' }));
        return out;
    };
    const glanceHtml = (list) => list.map((c) => `<span class="homer-glance${c.kind ? ' ' + c.kind : ''}">${icon(c.icon)}<span>${esc(c.text)}</span></span>`).join('');

    // ---------- Who's home ----------
    //
    // HOMER drew this in Home's top bar until v0.4.18, beside the clock, where
    // a remote could never reach it. It lives here instead: the first band of
    // Rooms, above the rooms themselves and big enough to read from the couch.
    //
    // shared/homeassistant.js's people() is the list — the person entities
    // Home Assistant keeps (its own deduplicated view of somebody across their
    // phones), or its device trackers in a house that never set people up —
    // with their picture where Home Assistant has one and their initials where
    // it doesn't. Read only: HOMER asks where people are and changes nothing.
    //
    // The per-room presence chips are a different thing and stay where they
    // are: glance() lists whoever Home Assistant places in *that* room, which
    // needs their tracker put in an area. This band needs nothing of the sort,
    // so it says something in every house.
    const peopleList = () => {
        const h = HA();
        if (!h || typeof h.people !== 'function' || !h.isSetUp()) return [];
        return safe(() => h.people(), []) || [];
    };
    const areaName = (id) => {
        const h = HA();
        if (!h || !id) return '';
        const r = (safe(() => h.house().rooms, []) || []).find((x) => x.id === id);
        return r ? r.name : '';
    };
    // "Home", or the zone Home Assistant has them in ("Work", "School"), and
    // the room too where it knows one — which most houses never set, so most
    // of the time this is one word.
    const whereText = (p) => {
        const room = p.home ? areaName(p.area) : '';
        return [p.where, room].filter(Boolean).join(' · ');
    };
    // how long they've been there: minutes while it's fresh, the clock time
    // for the rest of today, then a round number of hours or days
    const sinceText = (t) => {
        if (!t) return '';
        const mins = Math.round((Date.now() - t) / 60000);
        if (mins < 0) return '';
        if (mins < 2) return 'just now';
        if (mins < 60) return `${mins} min`;
        const d = new Date(t);
        if (mins < 12 * 60 && d.toDateString() === new Date().toDateString()) return `since ${fmtTime(d)}`;
        const hrs = Math.round(mins / 60);
        return hrs < 48 ? `${hrs} h` : `${Math.round(hrs / 24)} d`;
    };
    const personHtml = (p) => `
        <div class="ho-person${p.home ? ' in' : ''}" data-id="${esc(p.id)}">
            <span class="ho-person-face" data-person="${esc(p.id)}">${esc(p.initials)}</span>
            <span class="ho-person-text">
                <span class="ho-person-name">${esc(p.name)}</span>
                <span class="ho-person-where">${esc(whereText(p))}<i class="ho-person-since">${esc(sinceText(p.since))}</i></span>
            </span>
        </div>`;
    const peopleHtml = (list) => list.map(personHtml).join('');
    // who is where, so a repaint only happens when that changes (the "since"
    // text is kept up to date in place, off the clock's tick)
    const peopleSig = (list) => list.map((p) => `${p.id}:${p.state}:${p.since}:${p.area || ''}`).join('|');
    // Home Assistant's picture for a person needs its address and a token, and
    // isn't always there; loadPicture is the one that checks it actually
    // draws, so the initials stay put until a real picture turns up.
    const paintFaces = (box) => {
        const h = HA();
        if (!h || typeof h.loadPicture !== 'function') return;
        box.querySelectorAll('.ho-person-face[data-person]').forEach((face) => {
            const id = face.dataset.person;
            if (face.dataset.tried === id) return;
            face.dataset.tried = id;
            h.loadPicture(id).then((url) => {
                if (!url || face.dataset.tried !== id) return;
                face.style.backgroundImage = `url("${url}")`;
                face.classList.add('ho-has-pic');
            }, () => { /* no picture: the initials stay */ });
        });
    };
    // for the Actions strip, in a few words
    const peopleSummary = (list) => {
        const home = list.filter((p) => p.home).map((p) => p.name.split(' ')[0]);
        if (!home.length) return 'Nobody home';
        if (home.length === list.length) return home.length > 2 ? 'Everyone home' : home.join(' and ') + ' home';
        return home.join(', ') + ' home';
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
    // on screen. The fetch itself (including the NAS fallback for the two
    // cameras Home Assistant can't snapshot — cameras/cameras-model.js's
    // docstring) lives in shared/homeassistant.js now, shared with the
    // Cameras screen, so there's exactly one place that decides how a
    // camera's still is fetched — this used to be its own copy, missing that
    // fallback, which is why these two cameras showed nothing here even
    // though #/cameras had them working. Returns stop().
    const keepStill = (img, id, everyMs = STILL_MS) => {
        const h = HA();
        return h ? h.keepStill(img, id, everyMs) : () => {};
    };

    // Where Rooms opens when you haven't been in one yet: the living room
    // (or the family room, the den), else the first room
    const special = (r) => r.id === CAMERAS || r.id === CLIMATE;
    const firstRoom = (list) => (list.find((r) => !special(r) && /living|family|den|lounge/i.test(r.name))
        || list.find((r) => !special(r)) || list[0] || null);

    const specialRoom = () => ({ floor: '', temperature: null, lights: [], climates: [], scenes: [], cameras: [], switches: [], media: [], fans: [], auto: [], glance: null });
    // what makes a room's rows (a room is redrawn when it changes)
    const roomSig = (r) => r.id + ':' + [r.lights, r.scenes, r.climates, r.cameras, r.switches, r.media, r.fans, r.auto].map((x) => (x || []).length).join('.');

    // The Cameras and Climate items, then the rooms (with Other last)
    const roomList = () => {
        const h = HA();
        if (!h || h.status() !== 'ready') return [];
        const house = h.house();
        const list = house.rooms.slice();
        const top = [];
        if (house.cameras.length) {
            top.push(Object.assign(specialRoom(), { id: CAMERAS, name: 'Cameras', cameras: house.cameras.slice() }));
        }
        if ((house.climates || []).length) {
            top.push(Object.assign(specialRoom(), { id: CLIMATE, name: 'Climate', climates: house.climates.slice() }));
        }
        return top.concat(list);
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
                <div class="ho-brand homer-home" role="button" title="Home (H)"><span class="ho-brand-mark">${icon('home')}</span>HOMER<span class="ho-brand-sub">House</span></div>
                <div class="homer-screen-tabs" role="tablist" aria-label="House">${HOUSE_TABS.map((t) => `
                    <button type="button" class="homer-screen-tab${t.id === 'rooms' ? ' on' : ''}" role="tab"
                        aria-selected="${t.id === 'rooms'}" data-house="${t.id}">${icon(t.icon)}${t.label}</button>`).join('')}</div>
                <div class="ho-clock"><div class="ho-clock-time"></div><div class="ho-clock-date"></div></div>
            </div>
            <div class="ho-toast" role="status" aria-live="polite"></div>
            <div class="ho-people" role="group" aria-label="Who's home">
                <div class="ho-people-head">${icon('people')}Who's home</div>
                <div class="ho-people-track"></div>
            </div>
            <div class="ho-body">
                <div class="ho-side">
                    <div class="ho-list"><div class="ho-items"></div></div>
                    <div class="ho-preview" data-homer-preview>${icon('live_tv')}</div>
                </div>
                <div class="ho-room">
                    <div class="ho-room-head">
                        <div class="ho-room-name"></div>
                        <div class="ho-room-sub"></div>
                        <div class="ho-glance"></div>
                    </div>
                    <div class="ho-room-body"><div class="ho-rows"></div></div>
                    <div class="ho-picker"></div>
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
            <div class="ho-rm">
                <div class="ho-rm-info">
                    <div class="ho-rm-art"><img alt="" draggable="false">${icon('tv', 'ho-rm-art-icon')}</div>
                    <div class="ho-rm-kind"></div>
                    <div class="ho-rm-name"></div>
                    <div class="ho-rm-state"></div>
                    <div class="ho-rm-title"></div>
                    <div class="ho-rm-vol">${icon('volume_up', 'ho-rm-vol-icon')}<div class="ho-bar"><i></i></div><span class="ho-rm-vol-v"></span></div>
                    <div class="ho-rm-preview">${icon('live_tv')}</div>
                </div>
                <div class="ho-rm-pad">
                    <div class="ho-rm-ring">
                        ${['up', 'right', 'down', 'left'].map((k) => `<div class="ho-rm-dir ${k}" data-rk="${k}" role="button" aria-label="${k}">${icon(REMOTE_KEYS[k].icon)}</div>`).join('')}
                        <div class="ho-rm-ok" data-rk="select" role="button">OK</div>
                    </div>
                </div>
                <div class="ho-rm-keys">
                    ${[['menu', 'ESC'], ['home', 'T'], ['play_pause', 'SPACE'], ['volume_up', '+'], ['volume_down', '−']].map(([k, cap]) => `
                        <div class="ho-rm-key" data-rk="${k}" role="button">${icon(REMOTE_KEYS[k].icon, 'ho-rm-key-icon')}<span class="ho-rm-key-label"></span><span class="ho-key">${cap}</span></div>`).join('')}
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
        let zone = 'list'; // tabs | people | list | room | camera | remote
        let ti = 0; // which House tab the remote is on, while zone is 'tabs'
        let rows = []; // the room's rows: { kind, id?, ids?, which? }
        let ri = 0; // the row
        let ci = {}; // row index -> the chip/camera picked in it
        let builtFor = ''; // the room the rows were built for
        let cam = null; // the camera view's camera
        let camFrom = 'list'; // where Esc goes from the camera view
        let stills = []; // stop() for each still being refreshed
        let bigStill = () => {};
        let live = null; // { stop } for the camera view's video
        let remoteId = null; // the remote view's player
        let remoteFrom = 'room'; // where H goes from the remote view
        let alive = true;

        const room = () => rooms[sel] || null;

        // ----- who's home -----
        // The band across the top, above the rooms: one card a person, their
        // picture or their initials, where they are and how long they've been
        // there. It's a focus zone of its own — ▼ goes down to the rooms, ▲
        // from the first room comes back up — but nothing on it is a control,
        // so OK does nothing here and the legend doesn't offer one. There is
        // no per-person cursor for the same reason: everything a person has to
        // say is already on their card.
        const peopleEl = $('.ho-people');
        const peopleTrack = $('.ho-people-track');
        let folks = [];
        let folksSig = null; // no list drawn yet
        const drawPeople = () => {
            // nothing while the screen is explaining itself (not connected,
            // offline, signing in): the band would sit over the message
            folks = statusMessage() ? [] : peopleList();
            const sig = peopleSig(folks);
            if (sig !== folksSig) {
                folksSig = sig;
                peopleTrack.innerHTML = peopleHtml(folks);
                paintFaces(peopleTrack);
            }
            // no Home Assistant, or a house with nobody to show: no band, and
            // no gap where it would have been
            stage.classList.toggle('ho-has-people', folks.length > 0);
            if (!folks.length && zone === 'people') setZone('list');
            paintPeople();
        };
        const paintPeople = () => {
            peopleEl.classList.toggle('sel', zone === 'people');
            peopleTrack.querySelectorAll('.ho-person').forEach((n, i) => {
                const p = folks[i];
                if (!p) return;
                const s = n.querySelector('.ho-person-since');
                const t = sinceText(p.since);
                if (s.textContent !== t) s.textContent = t;
            });
        };
        const focusPeople = () => {
            drawPeople();
            if (folks.length) setZone('people');
        };
        const peopleTimer = setInterval(paintPeople, 30000);

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
                for (let i = 0; i < r.cameras.length; i += 2) out.push({ kind: 'cameras', sec: 'cameras', ids: r.cameras.slice(i, i + 2), grid: true });
                return out;
            }
            // a device's own settings, under it (a thermostat's mode select, a
            // purifier's child lock and favorite level, a player's output)
            const extraRows = (owner, sec, card) => HA().extras(owner).forEach((id) => {
                const d = domainOf(id);
                if (d === 'select') {
                    const O = optionInfo(id);
                    if (O.options.length) out.push({ kind: 'xselect', sec, id, ids: O.options, extra: true, card });
                } else if (d === 'number') out.push({ kind: 'xnumber', sec, id, extra: true, card });
                else out.push({ kind: 'ent', sec, id, extra: true, card });
            });
            r.climates.forEach((id) => {
                const C = climateInfo(id, r);
                (C.targets.length ? C.targets : [{ which: null }]).forEach((t) => out.push({ kind: 'setpoint', sec: 'climate', id, which: t.which }));
                if (C.modes.length) out.push({ kind: 'modes', sec: 'climate', id, ids: C.modes });
                extraRows(id, 'climate');
            });
            if (r.scenes.length) out.push({ kind: 'scenes', sec: 'scenes', ids: r.scenes });
            const parts = lightParts(r);
            parts.switches.forEach((id) => out.push({ kind: 'light', sec: 'lights', part: 'switches', id }));
            parts.bulbs.forEach((id) => out.push({ kind: 'light', sec: 'lights', part: 'bulbs', id }));
            if (r.cameras.length) out.push({ kind: 'cameras', sec: 'cameras', ids: r.cameras });
            (r.switches || []).forEach((id) => out.push({ kind: 'ent', sec: 'switches', id }));
            mediaCards(r).forEach((id) => {
                const M = mediaInfo(id, r);
                out.push({ kind: 'media', sec: 'media', id, card: id });
                const buttons = mediaButtons(M);
                if (buttons.length) out.push({ kind: 'mbtns', sec: 'media', id, ids: buttons, card: id });
                if (M.sources.length) out.push({ kind: 'sources', sec: 'media', id, ids: M.sources, card: id });
                if (!M.unavailable) extraRows(id, 'media', id);
            });
            (r.fans || []).forEach((id) => {
                const F = fanInfo(id, r);
                out.push({ kind: 'fan', sec: 'fans', id, card: id });
                if (F.presets.length && !F.unavailable) out.push({ kind: 'presets', sec: 'fans', id, ids: F.presets, card: id });
                if (!F.unavailable) extraRows(id, 'fans', id);
            });
            (r.auto || []).forEach((id) => out.push({ kind: 'ent', sec: 'auto', id }));
            return out;
        };
        const rowKey = (x) => x.kind + (x.which || '') + (x.id || '') + (x.ids ? '[' + x.ids.join('|') + ']' : '');

        const SECTIONS = {
            climate: ['Thermostat', 'thermostat'], scenes: ['Scenes', 'palette'], lights: ['Lights', 'lightbulb'],
            cameras: ['Cameras', 'videocam'], switches: ['Switches & outlets', 'power'], media: ['Media', 'speaker'],
            fans: ['Fans', 'air'], auto: ['Automations & helpers', 'autorenew']
        };
        const section = (title, icn) => `<div class="ho-sec">${icon(icn)}${esc(title)}</div>`;
        const subSection = (title) => `<div class="ho-subsec">${esc(title)}</div>`;
        // a light, and every row shaped like one: an outlet, an automation, a
        // fan, a device's number. The dot is a bulb's color.
        const lightHtml = (row, i) => `
            <div class="ho-row ho-light${row.kind !== 'light' ? ' acc' : ''}${row.extra ? ' extra' : ''}" data-r="${i}" role="button">
                <span class="ho-bulb">${icon(row.kind === 'light' ? HA().glyph(row.id) : row.kind === 'fan' ? 'air' : row.kind === 'xnumber' ? 'tune' : entIcon(row.id))}<i class="ho-dot" data-dot role="button"></i></span>
                <div class="ho-light-text"><div class="ho-light-name"></div><div class="ho-light-sub"></div></div>
                <div class="ho-bar"><i></i></div>
                <div class="ho-light-val"></div>
                <div class="ho-pill"></div>
            </div>`;
        const chipsHtml = (row, i, r) => `
            <div class="ho-row ho-chips" data-r="${i}">
                <div class="ho-chips-track">${row.ids.map((id, k) => `<div class="ho-chip" data-k="${k}" role="button"><span>${esc(HA().name(id, r.name))}</span></div>`).join('')}</div>
            </div>`;
        // a row of choices with a label: a player's inputs, a fan's modes, a
        // device's select
        const choicesHtml = (row, i, label) => `
            <div class="ho-row ho-chips ho-choices${row.extra ? ' extra' : ''}" data-r="${i}">
                <div class="ho-choices-label">${esc(label)}</div>
                <div class="ho-chips-track">${row.ids.map((o, k) => `<div class="ho-chip" data-k="${k}" data-v="${esc(o)}" role="button"><span>${esc(pretty(o))}</span></div>`).join('')}</div>
            </div>`;
        const mediaHtml = (row, i) => `
            <div class="ho-row ho-media" data-r="${i}" role="button">
                <div class="ho-art" data-still-box><img alt="" draggable="false">${icon('speaker', 'ho-art-icon')}</div>
                <div class="ho-media-text">
                    <div class="ho-media-name"></div>
                    <div class="ho-media-line"></div>
                    <div class="ho-media-title"></div>
                </div>
                <div class="ho-vol">${icon('volume_up', 'ho-vol-icon')}<div class="ho-bar"><i></i></div><span class="ho-vol-v"></span></div>
            </div>`;
        const mbtnsHtml = (row, i) => `
            <div class="ho-row ho-chips ho-mbtns" data-r="${i}">
                <div class="ho-chips-track">${row.ids.map((b, k) => `<div class="ho-chip ho-mbtn" data-k="${k}" data-b="${b}" role="button">${icon(MEDIA_BUTTONS[b].icon)}<span></span></div>`).join('')}</div>
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
        const rowHtml = (row, i, r) => {
            if (row.kind === 'scenes') return chipsHtml(row, i, r);
            if (row.kind === 'setpoint') return setpointHtml(row, i);
            if (row.kind === 'modes') return modesHtml(row, i);
            if (row.kind === 'cameras') return camsHtml(row, i, r);
            if (row.kind === 'media') return mediaHtml(row, i);
            if (row.kind === 'mbtns') return mbtnsHtml(row, i);
            if (row.kind === 'sources') return choicesHtml(row, i, 'Input');
            if (row.kind === 'presets') return choicesHtml(row, i, 'Mode');
            if (row.kind === 'xselect') return choicesHtml(row, i, optionInfo(row.id).name);
            return lightHtml(row, i);
        };

        // keep: the same room again (a player turned on, a thermostat changed
        // mode): stay on the same row, where the list was
        const buildRoom = (keep) => {
            const r = room();
            stopStills();
            if (!r) { rowsBox.innerHTML = ''; builtFor = ''; return; }
            const was = keep && rows[ri] ? rowKey(rows[ri]) : '';
            const scroll = $('.ho-room-body').scrollTop;
            rows = rowsFor(r);
            builtFor = r.id + '|' + rows.map(rowKey).join(',');
            const parts = lightParts(r);
            const split = parts.switches.length && parts.bulbs.length;
            let html = '';
            let lastSec = '';
            let lastPart = '';
            let card = null;
            rows.forEach((row, i) => {
                // a player's or a fan's rows sit together on one card
                if (card && row.card !== card) { html += '</div>'; card = null; }
                if (row.sec !== lastSec && r.id !== CAMERAS) {
                    const [title, icn] = SECTIONS[row.sec];
                    html += section(title, icn);
                    lastPart = '';
                }
                lastSec = row.sec;
                // the lights: the wall switches, then the bulbs
                if (row.kind === 'light' && split && row.part !== lastPart) {
                    html += subSection(row.part === 'switches' ? 'Wall switches' : bulbsLabel(parts.bulbs));
                    lastPart = row.part;
                }
                if (row.card && row.card !== card) { html += '<div class="ho-card">'; card = row.card; }
                html += rowHtml(row, i, r);
            });
            if (card) html += '</div>';
            if (!rows.length) html = '<div class="ho-empty">Nothing in this room HOMER can control.</div>';
            rowsBox.innerHTML = html;
            rowsBox.querySelectorAll('.ho-camtile').forEach((t) => stills.push(keepStill(t.querySelector('img'), t.dataset.cam)));
            if (was) {
                const n = rows.findIndex((x) => rowKey(x) === was);
                if (n >= 0) ri = n;
            }
            ri = clamp(ri, 0, Math.max(0, rows.length - 1));
            $('.ho-room-body').scrollTop = keep ? scroll : 0;
            paintRoom();
        };

        // the chip a row starts on: the one in use (a player's input, a fan's
        // mode, a device's choice), else the first
        const startChip = (row) => {
            if (!row || !row.ids) return 0;
            const h = HA();
            const s = row.id && h.entity(row.id);
            const now = !s ? '' : row.kind === 'sources' ? s.attributes.source : row.kind === 'presets' ? s.attributes.preset_mode : row.kind === 'modes' || row.kind === 'xselect' ? s.state : '';
            return Math.max(0, row.ids.indexOf(now));
        };
        const ciOf = (i) => (ci[i] != null ? ci[i] : startChip(rows[i]));

        // the room's values, in place (states change all the time)
        const paintRoom = () => {
            const r = room();
            if (!r) return;
            $('.ho-room-name').textContent = r.name;
            $('.ho-room-sub').textContent = [r.floor, roomSummary(r)].filter(Boolean).join(' · ');
            const g = $('.ho-glance');
            const gh = glanceHtml(glance(r));
            if (g.dataset.html !== gh) { g.dataset.html = gh; g.innerHTML = gh; }
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
                    const dot = n.querySelector('.ho-dot');
                    dot.classList.toggle('show', !!L.color && !L.unavailable);
                    dot.classList.toggle('lit', !!L.dot);
                    dot.style.background = L.dot;
                } else if (row.kind === 'ent') {
                    const E = entInfo(row.id, r, row.extra);
                    n.classList.toggle('on', E.on);
                    n.classList.add('switch');
                    n.classList.toggle('run', E.runs);
                    n.classList.toggle('off-line', E.unavailable);
                    n.querySelector('.ho-light-name').textContent = E.name;
                    n.querySelector('.ho-light-sub').textContent = E.sub;
                    n.querySelector('.ho-light-val').textContent = '';
                    n.querySelector('.ho-pill').textContent = E.unavailable ? 'Offline' : E.runs ? entVerb(E) : E.on ? 'On' : 'Off';
                } else if (row.kind === 'fan') {
                    const F = fanInfo(row.id, r);
                    n.classList.toggle('on', F.on);
                    n.classList.toggle('switch', F.pct == null);
                    n.classList.toggle('off-line', F.unavailable);
                    n.querySelector('.ho-light-name').textContent = F.name;
                    n.querySelector('.ho-light-sub').textContent = '';
                    n.querySelector('.ho-bar i').style.width = (F.pct || 0) + '%';
                    n.querySelector('.ho-light-val').textContent = F.unavailable ? '' : fanText(F);
                    n.querySelector('.ho-pill').textContent = F.unavailable ? 'Offline' : F.on ? 'On' : 'Off';
                } else if (row.kind === 'xnumber') {
                    const N = numberInfo(row.id);
                    n.classList.add('on', 'nopill');
                    n.classList.toggle('off-line', N.unavailable);
                    n.querySelector('.ho-light-name').textContent = N.name;
                    n.querySelector('.ho-bar i').style.width = N.pct + '%';
                    n.querySelector('.ho-light-val').textContent = numberText(N);
                } else if (row.kind === 'media') {
                    const M = mediaInfo(row.id, r);
                    n.classList.toggle('on', M.active);
                    n.classList.toggle('playing', M.playing);
                    n.classList.toggle('off-line', M.unavailable);
                    n.classList.toggle('no-vol', !M.canVolume);
                    n.querySelector('.ho-art-icon').textContent = M.icon;
                    n.querySelector('.ho-media-name').textContent = M.name;
                    n.querySelector('.ho-media-line').textContent = mediaLine(M);
                    n.querySelector('.ho-media-title').textContent = mediaTitle(M);
                    n.querySelector('.ho-vol .ho-bar i').style.width = (M.canVolume ? M.volume : 0) + '%';
                    n.querySelector('.ho-vol-v').textContent = M.canVolume ? (M.muted ? 'Muted' : M.volume + '%') : '';
                    n.querySelector('.ho-vol-icon').textContent = M.muted ? 'volume_off' : 'volume_up';
                    setArt(n.querySelector('.ho-art'), M);
                } else if (row.kind === 'mbtns') {
                    const M = mediaInfo(row.id, r);
                    n.querySelectorAll('.ho-mbtn').forEach((c) => {
                        c.querySelector('.material-icons').textContent = mediaButtonIcon(M, c.dataset.b);
                        c.querySelector('span:last-child').textContent = mediaButtonLabel(M, c.dataset.b);
                        c.classList.toggle('cur', (c.dataset.b === 'mute' && M.muted) || (c.dataset.b === 'play' && M.playing));
                    });
                } else if (row.kind === 'sources' || row.kind === 'presets' || row.kind === 'xselect') {
                    const s = HA().entity(row.id);
                    const now = !s ? '' : row.kind === 'sources' ? s.attributes.source : row.kind === 'presets' ? s.attributes.preset_mode : s.state;
                    n.classList.toggle('off-line', !s || s.state === 'unavailable');
                    n.querySelectorAll('.ho-chip').forEach((c) => c.classList.toggle('cur', c.dataset.v === now));
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
                    const k = clamp(ciOf(i), 0, row.ids.length - 1);
                    n.querySelectorAll('[data-k]').forEach((c) => c.classList.toggle('sel', zone === 'room' && i === ri && +c.dataset.k === k));
                }
            });
            if (picker) paintPicker();
            if (zone === 'remote') paintRemote();
        };

        const revealRow = () => {
            const body = $('.ho-room-body');
            const n = rowsBox.querySelector(`[data-r="${ri}"]`);
            if (!n) return;
            // the section title above a first row stays in view with it (and a
            // card's head with the card's other rows)
            const cardEl = n.parentElement && n.parentElement.classList.contains('ho-card') ? n.parentElement : null;
            const lead = cardEl && cardEl.firstElementChild !== n ? cardEl.firstElementChild : n;
            let prev = (cardEl || n).previousElementSibling;
            let top = lead.offsetTop;
            while (prev && (prev.classList.contains('ho-sec') || prev.classList.contains('ho-subsec'))) { top = prev.offsetTop; prev = prev.previousElementSibling; }
            top -= 16;
            const bottom = n.offsetTop + n.offsetHeight + 40;
            if (bottom - top > body.clientHeight) top = n.offsetTop - 16; // a tall card: the row itself wins
            if (top < body.scrollTop) body.scrollTop = top;
            else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = Math.max(bottom - body.clientHeight, 0);
            // and a chip or camera in its track
            const row = rows[ri];
            if (row && row.ids) {
                const track = n.querySelector('.ho-chips-track');
                const c = n.querySelector(`[data-k="${ciOf(ri)}"]`);
                if (track && c) {
                    if (c.offsetLeft - 40 < track.scrollLeft) track.scrollLeft = c.offsetLeft - 40;
                    else if (c.offsetLeft + c.offsetWidth + 40 > track.scrollLeft + track.clientWidth) {
                        track.scrollLeft = c.offsetLeft + c.offsetWidth + 40 - track.clientWidth;
                    }
                }
            }
        };

        // ----- a bulb's color -----
        // A small panel over the room: the presets (◀▶ picks, OK sets), then
        // a white strip (warm to cool) and a color strip that change the bulb
        // as you move along them. ▲▼ between them, Esc (or C) closes.
        const pickerEl = $('.ho-picker');
        let picker = null; // { id, p (the row), k (the preset), kelvin, hue }
        const pickerRows = () => {
            const c = picker && HA().color(picker.id);
            if (!c) return [];
            return ['swatches', c.white && 'white', c.color && 'hue'].filter(Boolean);
        };
        const openPicker = (id) => {
            const c = HA().color(id);
            if (!c) return;
            const list = swatchesFor(c);
            const now = swatchNow(c, list);
            picker = { id, p: 0, k: Math.max(0, now), kelvin: c.kelvin || 2700, hue: c.hs ? c.hs[0] : 30 };
            pickerEl.innerHTML = `
                <div class="ho-picker-card" role="dialog" aria-label="Color">
                    <div class="ho-picker-head"><span class="ho-picker-dot"></span><div class="ho-picker-title"><div class="ho-picker-name"></div><div class="ho-picker-sub">Color</div></div></div>
                    <div class="ho-pk-row ho-pk-sw" data-p="swatches"><div class="ho-pk-track">${list.map((s, k) => `<div class="ho-sw" data-k="${k}" role="button"><span class="ho-sw-dot" style="background:${rgbCss(swatchRgb(s))}"></span><span>${esc(s.name)}</span></div>`).join('')}</div></div>
                    ${c.white ? `<div class="ho-pk-row ho-pk-strip" data-p="white"><div class="ho-pk-label">White</div><div class="ho-pk-grad" style="background:${whiteGradient(c)}"><i></i></div><div class="ho-pk-val"></div></div>` : ''}
                    ${c.color ? `<div class="ho-pk-row ho-pk-strip" data-p="hue"><div class="ho-pk-label">Color</div><div class="ho-pk-grad" style="background:${hueGradient()}"><i></i></div><div class="ho-pk-val"></div></div>` : ''}
                </div>`;
            pickerEl.classList.add('show');
            paintPicker();
            updateLegend();
        };
        const closePicker = () => {
            picker = null;
            pickerEl.classList.remove('show');
            pickerEl.innerHTML = '';
            updateLegend();
        };
        const paintPicker = () => {
            if (!picker) return;
            const h = HA();
            const c = h.color(picker.id);
            if (!c) { closePicker(); return; }
            const list = swatchesFor(c);
            const L = lightInfo(picker.id, room());
            pickerEl.querySelector('.ho-picker-name').textContent = L.name;
            pickerEl.querySelector('.ho-picker-sub').textContent = !L.on ? 'Off · a color turns it on' : c.kelvin ? `White · ${c.kelvin} K` : 'Color';
            const dot = pickerEl.querySelector('.ho-picker-dot');
            dot.style.background = L.dot || '';
            dot.classList.toggle('lit', !!L.dot);
            const rowName = pickerRows()[picker.p];
            pickerEl.querySelectorAll('.ho-pk-row').forEach((n) => n.classList.toggle('sel', n.dataset.p === rowName));
            const now = swatchNow(c, list);
            pickerEl.querySelectorAll('.ho-sw').forEach((n) => {
                n.classList.toggle('sel', rowName === 'swatches' && +n.dataset.k === picker.k);
                n.classList.toggle('cur', +n.dataset.k === now);
            });
            const white = pickerEl.querySelector('[data-p="white"]');
            if (white) {
                white.querySelector('.ho-pk-grad i').style.left = ((picker.kelvin - c.min) / (c.max - c.min)) * 100 + '%';
                white.querySelector('.ho-pk-val').textContent = `${Math.round(picker.kelvin / 50) * 50} K`;
            }
            const hue = pickerEl.querySelector('[data-p="hue"]');
            if (hue) {
                hue.querySelector('.ho-pk-grad i').style.left = (picker.hue / 360) * 100 + '%';
                hue.querySelector('.ho-pk-val').innerHTML = `<span class="ho-sw-dot" style="background:${rgbCss(h.hsToRgb([picker.hue, 100]))}"></span>`;
            }
            // the preset in view
            const track = pickerEl.querySelector('.ho-pk-track');
            const sw = pickerEl.querySelector(`.ho-sw[data-k="${picker.k}"]`);
            if (track && sw) {
                if (sw.offsetLeft - 30 < track.scrollLeft) track.scrollLeft = sw.offsetLeft - 30;
                else if (sw.offsetLeft + sw.offsetWidth + 30 > track.scrollLeft + track.clientWidth) track.scrollLeft = sw.offsetLeft + sw.offsetWidth + 30 - track.clientWidth;
            }
        };
        const applySwatch = (k) => {
            const c = HA().color(picker.id);
            const s = swatchesFor(c)[k];
            if (!s) return;
            if (s.kelvin) picker.kelvin = Math.max(c.min, Math.min(c.max, s.kelvin));
            else picker.hue = s.hs[0];
            HA().setColor(picker.id, s.kelvin ? { kelvin: s.kelvin } : { hs: s.hs });
            paintPicker();
        };
        const pickerKey = (k, ev) => {
            const rowsP = pickerRows();
            const rowName = rowsP[picker.p];
            const c = HA().color(picker.id);
            if (k === 'ArrowUp') picker.p = Math.max(0, picker.p - 1);
            else if (k === 'ArrowDown') picker.p = Math.min(rowsP.length - 1, picker.p + 1);
            else if (k === 'ArrowLeft' || k === 'ArrowRight') {
                const d = k === 'ArrowLeft' ? -1 : 1;
                if (rowName === 'swatches') picker.k = clamp(picker.k + d, 0, swatchesFor(c).length - 1);
                else if (rowName === 'white') {
                    picker.kelvin = clamp(Math.round((picker.kelvin + d * 250) / 50) * 50, c.min, c.max);
                    HA().setColor(picker.id, { kelvin: picker.kelvin });
                } else if (rowName === 'hue') {
                    picker.hue = (Math.round(picker.hue / 15) * 15 + d * 15 + 360) % 360;
                    HA().setColor(picker.id, { hs: [picker.hue, 100] });
                }
            } else if ((k === 'Enter' || k === ' ') && !ev.repeat) {
                if (rowName === 'swatches') applySwatch(picker.k);
                else closePicker();
                return;
            }
            paintPicker();
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

        // ----- a player's remote -----
        // The player's picture and what's on at the left, the remote itself
        // (a ring of arrows around OK) and its keys at the right. HOMER's
        // keys go to the device, each lighting its part of the remote. H, or
        // Back held down, comes out.
        const rmEl = $('.ho-rm');
        const remoteInfo = () => (remoteId ? mediaInfo(remoteId, room()) : null);
        const paintRemote = () => {
            const M = remoteInfo();
            if (!M) return;
            if (!M.remote) { closeRemote(); return; }
            const h = HA();
            const d = h.device(M.id);
            const r = room();
            $('.ho-rm-kind').textContent = [d && d.model, r && r.id !== '_other' ? r.name : ''].filter(Boolean).join(' · ');
            $('.ho-rm-name').textContent = M.name;
            $('.ho-rm-state').textContent = [M.stateText, M.source && !M.title ? M.source : ''].filter(Boolean).join(' · ');
            $('.ho-rm-title').textContent = remoteNowLine(M);
            rmEl.classList.toggle('playing', M.playing);
            rmEl.classList.toggle('has-vol', M.canVolume);
            $('.ho-rm-vol .ho-bar i').style.width = (M.canVolume ? M.volume : 0) + '%';
            $('.ho-rm-vol-v').textContent = M.canVolume ? (M.muted ? 'Muted' : M.volume + '%') : '';
            $('.ho-rm-art-icon').textContent = M.icon === 'tv' || M.remote ? 'tv' : 'speaker';
            const art = $('.ho-rm-art');
            const img = art.querySelector('img');
            if (img.dataset.src !== M.art) {
                img.dataset.src = M.art;
                art.classList.remove('has-art');
                if (M.art) { img.onload = () => art.classList.add('has-art'); img.src = M.art; } else img.removeAttribute('src');
            }
            rmEl.querySelectorAll('.ho-rm-key').forEach((n) => {
                n.querySelector('.ho-rm-key-icon').textContent = remoteKeyIcon(M, n.dataset.rk);
                n.querySelector('.ho-rm-key-label').textContent = remoteKeyLabel(M, n.dataset.rk);
            });
        };
        const openRemote = (id, fromZone) => {
            const h = HA();
            if (!h || !h.remoteFor(id)) return;
            if (picker) closePicker();
            remoteId = id;
            remoteFrom = fromZone || (zone === 'remote' ? remoteFrom : zone);
            setZone('remote');
            paintRemote();
        };
        let backHeld = null; // { timer }: Back is down; let go soon and it's the device's Back
        const cancelBack = () => {
            if (!backHeld) return;
            clearTimeout(backHeld.timer);
            backHeld = null;
            rmEl.querySelectorAll('.holding').forEach((n) => n.classList.remove('holding'));
        };
        const closeRemote = () => {
            cancelBack();
            if (!remoteId) return;
            remoteId = null;
            setZone(remoteFrom === 'room' && rows.length ? 'room' : 'list');
        };
        // a press lights its part of the remote; a held key keeps it lit
        const lit = new Map(); // key -> timer
        const flash = (key) => {
            const parts = rmEl.querySelectorAll(`[data-rk="${key}"]`);
            parts.forEach((n) => { n.classList.remove('hit'); void n.offsetWidth; n.classList.add('hit'); });
            clearTimeout(lit.get(key));
            lit.set(key, setTimeout(() => parts.forEach((n) => n.classList.remove('hit')), 220));
        };
        let failedAt = 0;
        const remoteFailed = () => {
            if (Date.now() - failedAt < 3000) return;
            failedAt = Date.now();
            const M = remoteInfo();
            toast(`The ${M ? remoteName(M) : 'TV'} didn't answer. Try again.`, 'err');
        };
        const sentAt = {}; // key -> when it was last sent
        const press = (key, repeat) => {
            if (!remoteId) return;
            flash(key);
            sentAt[key] = Date.now();
            HA().sendRemote(remoteId, key, { repeat: !!repeat }).catch(remoteFailed);
        };
        // HOMER's keys → the remote's
        const REMOTE_BY_KEY = {
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select',
            ' ': 'play_pause', MediaPlayPause: 'play_pause', MediaPlay: 'play_pause', MediaPause: 'play_pause',
            '+': 'volume_up', '=': 'volume_up', PageUp: 'volume_up', AudioVolumeUp: 'volume_up',
            '-': 'volume_down', '_': 'volume_down', '−': 'volume_down', PageDown: 'volume_down', AudioVolumeDown: 'volume_down',
            t: 'home', T: 'home', Home: 'home',
            MediaTrackNext: 'skip_forward', MediaFastForward: 'skip_forward', MediaTrackPrevious: 'skip_backward', MediaRewind: 'skip_backward'
        };
        const REPEATS = ['up', 'down', 'left', 'right', 'volume_up', 'volume_down'];
        const remoteKeyDown = (ev) => {
            const k = ev.key;
            if (k === 'h' || k === 'H') { eat(ev); if (!ev.repeat) closeRemote(); return; }
            if (BACK_KEYS.includes(k)) {
                // a tap is the device's Back (sent when it's let go); held, it
                // comes out of the remote
                eat(ev);
                if (ev.repeat || backHeld) return;
                const back = rmEl.querySelector('[data-rk="menu"]');
                back.classList.add('holding');
                backHeld = { key: k, timer: setTimeout(() => { backHeld = null; back.classList.remove('holding'); closeRemote(); }, HOLD_BACK_MS) };
                return;
            }
            const key = REMOTE_BY_KEY[k];
            if (!key) return; // F (full screen), G (the guide), L (the quick panel) and the rest pass through
            eat(ev);
            if (ev.repeat) {
                if (!REPEATS.includes(key)) return;
                if (Date.now() - (sentAt[key] || 0) < REPEAT_MS) return;
            }
            press(key, ev.repeat);
        };
        const remoteKeyUp = (ev) => {
            if (backHeld && BACK_KEYS.includes(ev.key)) {
                cancelBack();
                press('menu');
            }
        };
        // keyups too (Jellyfin's player acts on some), and Back let go
        const onKeyUp = (ev) => {
            if (zone !== 'remote') return;
            if (document.getElementById('cg-root') || document.querySelector('.hq-panel.show')) return;
            if (!BACK_KEYS.includes(ev.key) && !REMOTE_BY_KEY[ev.key] && ev.key !== 'h' && ev.key !== 'H') return;
            eat(ev);
            remoteKeyUp(ev);
        };
        const onBlur = () => cancelBack(); // Back held while the window lost focus: nothing

        // ----- legend -----
        // what the focused row does: ◀▶ adjusts or picks, OK switches or runs
        const rowLegend = (row, items) => {
            const r = room();
            if (!row) return;
            if (row.kind === 'light') {
                const L = lightInfo(row.id, r);
                if (L.pct != null) items.push({ key: '◀▶', label: 'Brightness' });
                items.push({ key: 'OK', label: L.on ? 'Turn off' : 'Turn on', action: 'ok' });
                if (L.color && !L.unavailable) items.push({ key: 'C', label: 'Color', action: 'color' });
            } else if (row.kind === 'ent') {
                const E = entInfo(row.id, r, row.extra);
                if (!E.unavailable) items.push({ key: 'OK', label: entVerb(E), action: 'ok' });
            } else if (row.kind === 'fan') {
                const F = fanInfo(row.id, r);
                if (F.pct != null && !F.unavailable) items.push({ key: '◀▶', label: 'Speed' });
                if (!F.unavailable) items.push({ key: 'OK', label: F.on ? 'Turn off' : 'Turn on', action: 'ok' });
            } else if (row.kind === 'media') {
                const M = mediaInfo(row.id, r);
                if (M.canVolume || M.canStep) items.push({ key: '◀▶', label: 'Volume' });
                if (M.off && M.canOn) items.push({ key: 'OK', label: 'Turn on', action: 'ok' });
                else if (M.canPlay) items.push({ key: 'OK', label: M.playing ? 'Pause' : 'Play', action: 'ok' });
            } else if (row.kind === 'mbtns') {
                const M = mediaInfo(row.id, r);
                items.push({ key: '◀▶', label: 'Buttons' }, { key: 'OK', label: mediaButtonLabel(M, row.ids[clamp(ciOf(ri), 0, row.ids.length - 1)]), action: 'ok' });
            } else if (row.kind === 'sources') items.push({ key: '◀▶', label: 'Inputs' }, { key: 'OK', label: 'Switch input', action: 'ok' });
            else if (row.kind === 'presets') items.push({ key: '◀▶', label: 'Modes' }, { key: 'OK', label: 'Set mode', action: 'ok' });
            else if (row.kind === 'xselect') items.push({ key: '◀▶', label: 'Choices' }, { key: 'OK', label: 'Choose', action: 'ok' });
            else if (row.kind === 'xnumber') items.push({ key: '◀▶', label: 'Adjust' });
            else if (row.kind === 'setpoint') items.push({ key: '◀▶', label: 'Temperature' });
            else if (row.kind === 'scenes') items.push({ key: '◀▶', label: 'Scenes' }, { key: 'OK', label: 'Turn on scene', action: 'ok' });
            else if (row.kind === 'modes') items.push({ key: '◀▶', label: 'Modes' }, { key: 'OK', label: 'Set mode', action: 'ok' });
            else if (row.kind === 'cameras') items.push({ key: '◀▶', label: 'Cameras' }, { key: 'OK', label: 'View', action: 'ok' });
        };
        const updateLegend = () => {
            const items = [];
            const msg = statusMessage();
            if (msg && msg.ok) items.push({ key: 'OK', label: msg.ok, action: 'ok' });
            else if (!msg && picker) {
                const rowName = pickerRows()[picker.p];
                items.push({ key: '▲▼', label: 'Presets · White · Color' });
                if (rowName === 'swatches') items.push({ key: '◀▶', label: 'Presets' }, { key: 'OK', label: 'Set color', action: 'ok' });
                else items.push({ key: '◀▶', label: rowName === 'white' ? 'Warmer · cooler' : 'Color' }, { key: 'OK', label: 'Done', action: 'ok' });
                items.push({ key: 'ESC', label: 'Close', action: 'back' });
            } else if (!msg && zone === 'tabs') {
                items.push({ key: '◀▶', label: 'Rooms · Cameras' }, { key: 'OK', label: 'Open', action: 'ok' },
                    { key: '▼', label: 'Back down' });
            } else if (!msg && zone === 'people') {
                // nothing on this band is a control, so no OK here on purpose
                items.push({ key: '▼', label: 'Rooms' });
            } else if (!msg && zone === 'list') items.push({ key: '▲▼', label: 'Rooms' }, { key: 'OK', label: 'Open', action: 'ok' });
            else if (!msg && zone === 'room') {
                items.push({ key: '▲▼', label: 'Move' });
                rowLegend(rows[ri], items);
                items.push({ key: 'ESC', label: 'Rooms', action: 'back' });
            } else if (!msg && zone === 'camera') {
                if (camList().length > 1) items.push({ key: '◀▶', label: 'Next camera' });
                items.push({ key: 'ESC', label: 'Back', action: 'back' });
            } else if (!msg && zone === 'remote' && remoteInfo()) {
                // the one thing to know: where the keys go, and the way out
                const html = `<span class="ho-rm-legend">${icon('settings_remote')}<span>Your remote is controlling the ${esc(remoteName(remoteInfo()))} · Hold <span class="ho-key">Back</span>or press <span class="ho-key" data-action="exit">H</span>to exit</span></span>`;
                const leg = $('.ho-legend');
                if (leg.dataset.html !== html) { leg.dataset.html = html; leg.innerHTML = html; }
                return;
            }
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' });
            if (zone === 'list' || zone === 'people' || zone === 'tabs' || msg) items.push({ key: 'ESC', label: 'Back', action: 'back' });
            const html = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="ho-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
            const leg = $('.ho-legend');
            if (leg.dataset.html !== html) { leg.dataset.html = html; leg.innerHTML = html; }
        };

        // ----- the House tabs (Rooms · Cameras) -----
        // Cameras is a screen of its own at #/cameras; from here it's the tab
        // next door, so the doorbell is two presses from the rooms instead of
        // a trip through the menu.
        const tabEls = () => [...stage.querySelectorAll('.homer-screen-tab')];
        const paintTabs = () => tabEls().forEach((b, i) => b.classList.toggle('foc', zone === 'tabs' && i === ti));
        const runTab = (id) => {
            const t = HOUSE_TABS.find((x) => x.id === id);
            if (!t || t.id === 'rooms') return; // already here
            go(t.hash);
        };

        const setZone = (z) => {
            zone = z;
            stage.classList.toggle('ho-zone-tabs', z === 'tabs');
            stage.classList.toggle('ho-zone-people', z === 'people');
            stage.classList.toggle('ho-zone-list', z === 'list');
            stage.classList.toggle('ho-zone-room', z === 'room');
            stage.classList.toggle('ho-zone-camera', z === 'camera');
            stage.classList.toggle('ho-zone-remote', z === 'remote');
            // a docked video moves into the remote view (HomerPlayer pins it
            // over whichever window has the attribute)
            $('.ho-preview').toggleAttribute('data-homer-preview', z !== 'remote');
            $('.ho-rm-preview').toggleAttribute('data-homer-preview', z === 'remote');
            paintRoom();
            paintPeople();
            paintTabs();
            updateLegend();
            if (z === 'room') revealRow();
        };

        const selectRoom = (i) => {
            i = clamp(i, 0, rooms.length - 1);
            if (i === sel && builtFor.startsWith((room() || {}).id + '|')) return;
            if (picker) closePicker();
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
            } else if (row.kind === 'ent') {
                const E = entInfo(row.id, r, row.extra);
                if (E.unavailable) return;
                if (E.runs) h.run(row.id).then(() => toast(`${E.name}: done`)).catch(failed);
                else h.toggle(row.id).catch(failed);
            } else if (row.kind === 'fan') {
                if (!fanInfo(row.id, r).unavailable) h.toggle(row.id).catch(failed);
            } else if (row.kind === 'media') {
                const M = mediaInfo(row.id, r);
                if (M.off && M.canOn) h.power(row.id).catch(failed);
                else if (M.canPlay) h.playPause(M.target).catch(failed);
            } else if (row.kind === 'mbtns') {
                if (row.ids[k] === 'remote') openRemote(row.id, 'room');
                else mediaButton(mediaInfo(row.id, r), row.ids[k]).catch(failed);
            } else if (row.kind === 'sources') {
                h.setSource(row.id, row.ids[k]).catch(failed);
            } else if (row.kind === 'presets') {
                h.setPreset(row.id, row.ids[k]).catch(failed);
            } else if (row.kind === 'xselect') {
                if (!optionInfo(row.id).unavailable) h.setOption(row.id, row.ids[k]).catch(failed);
            } else if (row.kind === 'scenes') {
                const id = row.ids[k];
                h.scene(id).then(() => toast(`${h.name(id, r.name)} is on`)).catch(failed);
            } else if (row.kind === 'modes') {
                h.setMode(row.id, row.ids[k]).catch(failed);
            } else if (row.kind === 'cameras') {
                openCamera(row.ids[k], 'room');
            }
        };
        // ◀▶ on a row; false when it had nothing to change (◀ then goes back
        // to the rooms)
        const adjust = (row, d) => {
            const h = HA();
            if (!row || !h) return false;
            if (row.kind === 'light') {
                const L = lightInfo(row.id, room());
                if (L.pct == null || L.unavailable) return false;
                // 10% steps from 0; off → 10%
                const next = clamp((Math.round((L.pct || 0) / 10) + d) * 10, 0, 100);
                h.setBrightness(row.id, next);
                return true;
            }
            if (row.kind === 'fan') {
                const F = fanInfo(row.id, room());
                if (F.pct == null || F.unavailable) return false;
                h.setFanSpeed(row.id, clamp((Math.round(F.pct / F.step) + d) * F.step, 0, 100));
                return true;
            }
            if (row.kind === 'media') {
                const M = mediaInfo(row.id, room());
                if (!M.canVolume && !M.canStep) return false;
                stepMedia(M, d);
                return true;
            }
            if (row.kind === 'xnumber') {
                const N = numberInfo(row.id);
                if (N.unavailable) return false;
                h.setNumber(row.id, clamp(N.value + d * N.step, N.min, N.max));
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
                const was = clamp(ciOf(ri), 0, row.ids.length - 1);
                const k = clamp(was + d, 0, row.ids.length - 1);
                ci[ri] = k;
                paintRoom();
                revealRow();
                updateLegend();
                return k !== was;
            }
            return false;
        };
        const moveRow = (d) => {
            const n = clamp(ri + d, 0, rows.length - 1);
            if (n === ri) return;
            // between two camera rows of the grid, keep the column
            if (rows[ri].ids && rows[n].ids && rows[n].kind === rows[ri].kind && rows[n].kind === 'cameras') ci[n] = clamp(ciOf(ri), 0, rows[n].ids.length - 1);
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
            if (zone === 'remote' && !statusMessage()) { remoteKeyDown(ev); return; }
            const k = ev.key;
            if (k === 'h' || k === 'H') {
                eat(ev);
                if (!ev.repeat) goHome();
                return;
            }
            const colorKey = k === 'c' || k === 'C' || k === 'ContextMenu';
            // the color panel takes the keys while it's up
            if (picker) {
                if (BACK_KEYS.includes(k) || colorKey) { eat(ev); if (!ev.repeat) closePicker(); return; }
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k)) { eat(ev); pickerKey(k, ev); updateLegend(); }
                return;
            }
            if (BACK_KEYS.includes(k)) {
                eat(ev);
                if (ev.repeat) return;
                if (zone === 'camera') closeCamera();
                else if (zone === 'remote') closeRemote();
                else if (zone === 'room') setZone('list');
                else if (zone === 'tabs') setZone(folks.length ? 'people' : 'list');
                else goBack();
                return;
            }
            // C on a bulb that does color: its color panel
            if (colorKey && zone === 'room' && !statusMessage()) {
                const row = rows[ri];
                const L = row && row.kind === 'light' ? lightInfo(row.id, room()) : null;
                if (L && L.color && !L.unavailable) { eat(ev); if (!ev.repeat) openPicker(row.id); }
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', ' '];
            if (!handled.includes(k)) return; // F (full screen), G (the guide) and the rest pass through
            eat(ev);
            const enter = k === 'Enter' || k === ' ';
            if (statusMessage()) { if (enter && !ev.repeat) statusOk(); return; }
            if (zone === 'tabs') {
                if (k === 'ArrowLeft' && ti > 0) { ti -= 1; paintTabs(); }
                else if (k === 'ArrowRight' && ti < HOUSE_TABS.length - 1) { ti += 1; paintTabs(); }
                else if (k === 'ArrowDown') setZone(folks.length ? 'people' : 'list');
                else if (enter && !ev.repeat) runTab(HOUSE_TABS[ti].id);
            } else if (zone === 'people') {
                // ▼ (or ▶) drops into the rooms; ▲ goes up to the House tabs
                if (k === 'ArrowDown' || k === 'ArrowRight') setZone('list');
                else if (k === 'ArrowUp') setZone('tabs');
            } else if (zone === 'list') {
                // ▲ from the first room goes up to who's home, where there is
                // one, and to the House tabs above that
                const up = k === 'ArrowUp';
                if (up && sel === 0 && !folks.length) setZone('tabs');
                else if (up && sel === 0 && folks.length) setZone('people');
                else if (up) selectRoom(sel - 1);
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
                } else if (enter && !ev.repeat) act(row, clamp(ciOf(ri), 0, row.ids ? row.ids.length - 1 : 0));
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
            // the mark and HOMER wordmark go Home; House (the screen's own
            // name) is the desktop's screen-home button — out of a room, a
            // camera or the remote, back to the rooms list
            if (t.closest('.ho-brand-sub')) {
                const l = window.HomerLayout;
                if (l && typeof l.canScreenHome === 'function' && l.canScreenHome()) l.screenHome();
                return;
            }
            if (t.closest('.ho-brand')) { goHome(); return; }
            const leg = t.closest('.ho-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'exit') closeRemote();
                else if (a === 'fullscreen') fullscreen();
                else if (a === 'back') onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {}, target: document.body });
                else if (a === 'ok') onKey({ key: 'Enter', preventDefault() {}, stopPropagation() {}, target: document.body });
                else if (a === 'color') onKey({ key: 'c', preventDefault() {}, stopPropagation() {}, target: document.body });
                return;
            }
            if (t.closest('.ho-state [data-ok]')) { statusOk(); return; }
            // the color panel: a preset sets it, a strip sets it where it's
            // clicked, a click beside the card closes it
            if (picker) {
                if (!t.closest('.ho-picker-card')) { closePicker(); return; }
                const sw = t.closest('.ho-sw');
                const strip = t.closest('.ho-pk-strip');
                const rowsP = pickerRows();
                if (sw) { picker.p = 0; picker.k = Number(sw.dataset.k); applySwatch(picker.k); } else if (strip) {
                    const g = strip.querySelector('.ho-pk-grad').getBoundingClientRect();
                    const x = clamp((ev.clientX - g.left) / g.width, 0, 1);
                    const c = HA().color(picker.id);
                    picker.p = rowsP.indexOf(strip.dataset.p);
                    if (strip.dataset.p === 'white') { picker.kelvin = Math.round((c.min + x * (c.max - c.min)) / 50) * 50; HA().setColor(picker.id, { kelvin: picker.kelvin }); } else { picker.hue = Math.round(x * 360) % 360; HA().setColor(picker.id, { hs: [picker.hue, 100] }); }
                    paintPicker();
                }
                updateLegend();
                return;
            }
            // the remote view: a click is that key
            if (zone === 'remote') {
                const rk = t.closest('[data-rk]');
                if (rk) press(rk.dataset.rk);
                return;
            }
            const tabEl = t.closest('.homer-screen-tab');
            if (tabEl) {
                ti = Math.max(0, tabEls().indexOf(tabEl));
                setZone('tabs');
                runTab(tabEl.dataset.house);
                return;
            }
            // who's home: a click puts the focus on the band, nothing more
            if (t.closest('.ho-people')) { if (folks.length) setZone('people'); return; }
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
            if (c) { ci[ri] = Number(c.dataset.k); paintRoom(); updateLegend(); act(row, ci[ri]); return; }
            // a bulb's color dot opens its color panel
            if (row.kind === 'light' && t.closest('.ho-dot.show')) { openPicker(row.id); return; }
            // a click on a bar sets it there (brightness, speed, volume, a
            // number); anywhere else switches, or plays
            const bar = t.closest('.ho-bar');
            const at = bar ? clamp((ev.clientX - bar.getBoundingClientRect().left) / bar.getBoundingClientRect().width, 0, 1) : null;
            if (row.kind === 'light') {
                const L = lightInfo(row.id, room());
                if (bar && L.pct != null) HA().setBrightness(row.id, Math.round(at * 10) * 10);
                else act(row, 0);
            } else if (row.kind === 'fan') {
                const F = fanInfo(row.id, room());
                if (bar && F.pct != null) HA().setFanSpeed(row.id, Math.max(F.step, Math.round((at * 100) / F.step) * F.step));
                else act(row, 0);
            } else if (row.kind === 'media') {
                const M = mediaInfo(row.id, room());
                if (bar && M.canVolume) HA().setVolume(row.id, Math.round(at * 20) / 20);
                else act(row, 0);
            } else if (row.kind === 'xnumber') {
                const N = numberInfo(row.id);
                if (bar && !N.unavailable) HA().setNumber(row.id, Math.round((N.min + at * (N.max - N.min)) / N.step) * N.step);
            } else if (row.kind === 'ent') act(row, 0);
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);
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
            drawPeople();
            const next = roomList();
            const sig = next.map(roomSig).join(',');
            const was = rooms.map(roomSig).join(',');
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
                // a thermostat switched to a mode with other set points, a TV
                // turned on (its buttons and inputs): the rows change
                if (r && rowsFor(r).map(rowKey).join() !== rows.map(rowKey).join()) buildRoom(true);
                else paintRoom();
            }
            if (wanted && rooms.length) {
                const w = wanted;
                wanted = null;
                if (w.camera && camList().includes(w.camera)) openCamera(w.camera, 'list');
                else if (w.remote) remoteFromRoute(w.remote);
                else if (w.people) focusPeople();
            }
            if (!rooms.length && zone !== 'list' && zone !== 'people') setZone('list');
            updateLegend();
        };
        // #/rooms?remote=… (the quick panel's Remote): the player's room, on
        // its Remote button, and its remote
        const remoteFromRoute = (id) => {
            const i = rooms.findIndex((r) => !special(r) && r.media.includes(id));
            if (i < 0 || !HA().remoteFor(id)) return;
            selectRoom(i);
            const n = rows.findIndex((x) => x.kind === 'mbtns' && x.id === id && x.ids.includes('remote'));
            if (n >= 0) { ri = n; ci[n] = rows[n].ids.indexOf('remote'); }
            openRemote(id, 'room');
        };
        const offHA = HA() ? HA().onChange(sync) : () => {};

        // ----- docked video -----
        const syncDocked = () => {
            root.classList.toggle('ho-docked', docked());
            updateLegend();
        };

        // ----- the Actions strip (shared/actions.js) -----
        // C (a bulb's colors) is the only letter Rooms binds of its own, and F
        // only means anything while a video is docked here; the strip is asked
        // fresh each time, so `sub` can name the light the focus is on.
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            const row = zone === 'room' ? rows[ri] : null;
            const L = row && row.kind === 'light' ? lightInfo(row.id, room()) : null;
            const colorable = !!(L && L.color && !L.unavailable);
            if (L) {
                out.push({
                    id: 'color', key: 'C', icon: 'palette', label: 'Color',
                    sub: L.name, run: () => openPicker(L.id), disabled: !colorable || !!picker
                });
            }
            if (docked()) out.push({ id: 'fullscreen', key: 'F', icon: 'fullscreen', label: 'Full screen', run: fullscreen });
            return out;
        }, { id: 'rooms', title: 'House' }) : () => {};

        // The top of this screen: the phone top bar's name and the menu's own
        // House item come back here — out of a camera, a remote or a room, to
        // the rooms list. On the list itself there's nowhere above, and
        // atTop says so, so the press does nothing rather than going Home.
        const offScreenHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (picker) { closePicker(); return true; }
                if (zone === 'camera') { closeCamera(); return true; }
                if (zone === 'remote') { closeRemote(); return true; }
                if (zone === 'room' || zone === 'people' || zone === 'tabs') { setZone('list'); return true; }
                return false;
            }, { atTop: () => zone === 'list' && !picker })
            : () => {};

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
            state: () => ({ room: room() ? room().id : null, camera: cam, remote: remoteId }),
            // #/rooms?camera=… while Rooms is already up
            openCamera: (id) => { if (rooms.length) openCamera(id, zone === 'camera' ? camFrom : zone); else wanted = { camera: id }; },
            // #/rooms?remote=…
            openRemote: (id) => { if (rooms.length) remoteFromRoute(id); else wanted = { remote: id }; },
            // the Actions strip's Who's home, with Rooms already up
            focusPeople: () => { if (rooms.length) focusPeople(); else wanted = { people: true }; },
            teardown() {
                alive = false;
                offHA();
                offScreenHome();
                offActions();
                stopStills();
                stopLive();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('keyup', onKeyUp, true);
                window.removeEventListener('blur', onBlur);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                cancelBack();
                lit.forEach((t) => clearTimeout(t));
                clearInterval(peopleTimer);
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
    const routeParam = (name) => {
        const h = currentRoute();
        const q = h.indexOf('?');
        return q < 0 ? null : new URLSearchParams(h.slice(q + 1)).get(name);
    };
    const routeCamera = () => routeParam('camera');
    // #/rooms?remote=media_player.apple_tv
    const routeRemote = () => routeParam('remote');

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    let shownCamera = null;
    let shownRemote = null;
    let wantPeople = false; // Who's home, asked for from another screen
    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute() && !/homer-ha=signin/.test(currentRoute());
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) {
            closeScreen();
            return;
        }
        const camId = routeCamera();
        const remote = routeRemote();
        if (screen) {
            screen.sync();
            if (camId && camId !== shownCamera) { shownCamera = camId; screen.openCamera(camId); }
            if (remote && remote !== shownRemote) { shownRemote = remote; screen.openRemote(remote); }
            if (!remote) shownRemote = null;
            if (wantPeople) { wantPeople = false; if (screen.focusPeople) screen.focusPeople(); }
            return;
        }
        shownCamera = camId;
        shownRemote = remote;
        const people = wantPeople;
        wantPeople = false;
        const s = draw(camId ? { camera: camId } : remote ? { remote } : people ? { people: true } : null);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    // The phone layout: shared/layout.js says when; rooms/rooms-phone.js
    // draws it (and registers it with the layout once it has loaded).
    const phoneLayout = () => !!(window.HomerLayout && window.HomerRoomsPhone && window.HomerLayout.usePhone('rooms'));
    const PHONE_CTX = {
        CAMERAS, CLIMATE, roomList, firstRoom, roomIcon, roomSummary, roomSig, lightInfo, lightText, climateInfo, climateLine, deg, MODE_LABELS, MODE_ICONS,
        doorbellFor, agoText, ringText, noRings, lastRingText, keepStill, statusMessage, esc, icon, clamp, remember, recalled,
        goHome, goBack, goSettings, docked,
        // v0.3.19: bulbs' colors, outlets, players, fans, automations, at a glance
        domainOf, pretty, rgbCss, lightParts, bulbsLabel, SWATCHES, swatchesFor, swatchRgb, swatchNow, whiteGradient, hueGradient,
        ENT_ICONS, entIcon, entInfo, entVerb, mediaInfo, mediaCards, setArt, mediaButtons, mediaButtonLabel, mediaButtonIcon, MEDIA_BUTTONS, mediaLine, mediaTitle,
        stepMedia, mediaButton, fanInfo, fanText, optionInfo, numberInfo, numberText, glance, glanceHtml,
        // the remote (Apple TV, Samsung TV)
        REMOTE_KEYS, remoteKeyLabel, remoteKeyIcon, remoteName, remoteNowLine,
        // v0.4.19: who's home, the band at the top of both layouts
        peopleList, peopleHtml, peopleSig, paintFaces, sinceText,
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

    // ---------- Who's home, from anywhere (shared/actions.js) ----------
    //
    // The band lives on Rooms, which is a couple of moves away from wherever
    // you are; holding OK on the Apple TV's remote reaches it in one, from any
    // screen. It's a global action for that reason — the only thing it does is
    // open Rooms with the band focused.
    const openPeople = () => {
        suppressed = false;
        if (screen && typeof screen.focusPeople === 'function' && isOurRoute()) { screen.focusPeople(); return; }
        wantPeople = true;
        if (isOurRoute()) { lastSig = ''; sync(); } else go('#/rooms');
    };
    const offPeopleAction = window.HomerActions ? window.HomerActions.provide(() => {
        const list = peopleList();
        if (!list.length) return [];
        return [{
            id: 'people',
            icon: 'people',
            label: 'Who\'s home',
            sub: peopleSummary(list),
            run: openPeople
        }];
    }, { global: true, id: 'people', title: 'Who\'s home' }) : () => {};

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
        // openRemote(id): Rooms, on that player's remote (the quick panel's Remote)
        openRemote(id) {
            suppressed = false;
            if (isOurRoute() && screen && routeRemote() === id) { screen.openRemote(id); return; }
            go('#/rooms?remote=' + encodeURIComponent(id));
        },
        // openPeople(): Rooms, with who's home focused (the Actions strip)
        openPeople,
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
            offPeopleAction();
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
