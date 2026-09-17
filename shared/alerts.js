/*
 * HOMER alerts: one strip, over whatever is on screen.
 *
 * Two things can put a message on it, and they share the strip so that only
 * ever one of them is up at a time:
 *
 *   The weather   the National Weather Service's active alerts for wherever
 *                 the house is (api.weather.gov, free and no key). Home
 *                 Assistant's own config says where that is; HOMER's weather
 *                 location answers when Home Assistant isn't connected.
 *   The house     Home Assistant: a door or window left open a while, the
 *                 garage left open, a leak or smoke detector tripping, the
 *                 doorbell ringing.
 *
 * How loud it is depends on what it is. A tornado warning is not a frost
 * advisory, so there are three levels, and the NWS's own severity and urgency
 * fields decide which (not the event's name, which changes):
 *
 *   extreme   severity Extreme, happening now or expected — a tornado
 *             warning, a hurricane warning. Red, it pulses, and it stays up
 *             until it's dismissed or the alert clears.
 *   warning   severity Severe, happening now or expected — a flash flood
 *             warning, a severe thunderstorm warning. Red, and it stays up.
 *   notice    everything else: watches (Severe but urgency Future), advisories,
 *             statements. Quiet, and it takes itself down after a few seconds
 *             — sooner over full-screen video, which an advisory has no
 *             business sitting on.
 *
 * Behaviour: newest first within a level, loudest level first; one strip, and
 * one message on it; Esc or the ✕ dismisses the one showing, and HOMER
 * remembers that until the alert itself clears, so it doesn't come back every
 * time you change screens. It never takes focus, never moves the screen
 * underneath (it's fixed, over everything), and over full-screen video it's a
 * lower third, not a dialog.
 *
 * Testing it, with a real alert and no fake ones shipped: see _fetch below.
 *
 * window.HomerAlerts = { list, current, dismiss, refresh, onChange,
 *                        destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerAlerts && typeof window.HomerAlerts.destroy === 'function') {
        window.HomerAlerts.destroy();
    }

    // ---------- What counts, and for how long ----------

    const POLL_MS = 5 * 60 * 1000; // the NWS asks for a few minutes between calls
    const POLL_HOT_MS = 60 * 1000; // …and faster while a warning is up
    const RETRY_MS = 60 * 1000; // after a failed call
    const OPEN_MS = 10 * 60 * 1000; // a door or window open this long is worth saying
    const GARAGE_MS = 5 * 60 * 1000; // the garage, sooner: it's the one people forget
    const RING_MS = 3 * 60 * 1000; // how long a doorbell ring stays on the strip
    const NOTICE_MS = 24 * 1000; // a notice takes itself down after this
    const NOTICE_VIDEO_MS = 10 * 1000; // …and sooner over full-screen video
    const SEEN_KEY = 'homer-alerts-seen'; // { id: when it was dismissed }
    const SEEN_MS = 12 * 60 * 60 * 1000; // a dismissal is forgotten after this, at the latest
    const HOUSE_MS = 15 * 1000; // how often the house's own conditions are re-read

    // The NWS asks every caller to identify itself. Browsers can send this one
    // on a cross-origin call only because api.weather.gov names it in its
    // Access-Control-Allow-Headers (API-Key, User-Agent); it is otherwise the
    // browser's own.
    const UA = 'HOMER for Jellyfin (https://github.com/endlessshrimp/jellyfin-channel-guide)';
    const NWS = 'https://api.weather.gov/alerts/active';

    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const HA = () => window.HomerHA || null;
    const HP = () => window.HomerPlayer || null;
    const log = (...a) => console.info('[HOMER alerts]', ...a);
    const warn = (...a) => console.warn('[HOMER alerts]', ...a);

    const RANK = { extreme: 3, warning: 2, notice: 1 };

    // ---------- What HOMER remembers you've dismissed ----------

    const readSeen = () => {
        try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
    };
    const writeSeen = (v) => {
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* private mode: this session only */ }
    };
    let seen = readSeen();
    // a dismissal only lasts as long as the alert it was for: anything no
    // longer in the list is forgotten, so the same door opening tomorrow says so
    const pruneSeen = (live) => {
        const ids = new Set(live.map((a) => a.id));
        const now = Date.now();
        let changed = false;
        for (const [id, at] of Object.entries(seen)) {
            if (!ids.has(id) || now - at > SEEN_MS) { delete seen[id]; changed = true; }
        }
        if (changed) writeSeen(seen);
    };

    // ---------- Where the house is ----------

    // Home Assistant knows where the house is, and it's the house HOMER is in;
    // HOMER's own weather location (Settings, a ZIP or the device) answers when
    // Home Assistant isn't connected.
    const coords = () => {
        const h = HA();
        if (h && typeof h.location === 'function') {
            const loc = h.location();
            if (loc && isFinite(loc.lat) && isFinite(loc.lon)) return { lat: loc.lat, lon: loc.lon, from: 'home assistant' };
        }
        const w = window.HomerWeather;
        const p = w && typeof w.place === 'function' ? w.place() : null;
        if (p && isFinite(p.lat) && isFinite(p.lon)) return { lat: p.lat, lon: p.lon, from: 'homer weather' };
        return null;
    };

    // ---------- The weather ----------

    // Which of HOMER's three levels an NWS alert is, from the fields the NWS
    // fills in for every one of them rather than from the event's name.
    //   severity  Extreme | Severe | Moderate | Minor | Unknown
    //   urgency   Immediate | Expected | Future | Past | Unknown
    // A watch is Severe but Future ("be ready"); a warning is Severe and
    // Immediate or Expected ("it's happening"). That one pair of fields is
    // the whole difference between the two, and it's why the crawl can tell a
    // flood watch from a flash flood warning without knowing either name.
    // Jason's rule (2026-09-17): the crawl is for weather worth reacting to —
    // severe watches and warnings. An air quality alert or a heat advisory is
    // not worth a strip across the screen, so those are dropped, not quieted.
    const WEATHER_WATCH = /\b(watch|warning|emergency)\b/i;
    const levelOf = (p) => {
        if (p.status && p.status !== 'Actual') return null; // Test, Exercise, Draft, System
        if (p.messageType === 'Cancel') return null;
        const soon = p.urgency === 'Immediate' || p.urgency === 'Expected';
        if (p.severity === 'Extreme' && soon) return 'extreme';
        if ((p.severity === 'Extreme' || p.severity === 'Severe') && soon) return 'warning';
        // Everything else only shows if it is a severe-or-worse watch: the
        // "get ready" half of the pair. Advisories and statements never show.
        const bad = p.severity === 'Extreme' || p.severity === 'Severe';
        if (bad && WEATHER_WATCH.test(p.event || '')) return 'notice';
        return null;
    };

    const timeText = (iso) => {
        const t = Date.parse(iso || '');
        if (!isFinite(t)) return '';
        const d = new Date(t);
        const day = d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' ';
        return day + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    // "Kaufman, TX; Henderson, TX" is more than a strip can hold: the first
    // two places, and a count for the rest
    const areaText = (s) => {
        const parts = String(s || '').split(';').map((x) => x.trim()).filter(Boolean);
        if (parts.length <= 2) return parts.join(', ');
        return `${parts[0]}, ${parts[1]} +${parts.length - 2} more`;
    };
    // The NWS's own text, in one line and short enough to read before it comes
    // round again: its paragraph breaks closed up, the product code some
    // offices put on the front ("AQAFWD") dropped, and a cap on the length —
    // a crawl that takes two minutes to get back to the beginning is a crawl
    // nobody finishes.
    const CRAWL_MAX = 560;
    const oneLine = (s) => {
        // the code goes only when it's on a line of its own, before the lines
        // are closed up: "TAKE COVER NOW!" starts an instruction, not a product
        let t = String(s || '').replace(/^[A-Z0-9]{4,12}[ \t]*\r?\n/, '');
        t = t.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (t.length > CRAWL_MAX) t = t.slice(0, t.lastIndexOf(' ', CRAWL_MAX)) + '\u2026';
        return t;
    };

    const fromNws = (f) => {
        const p = (f && f.properties) || {};
        const level = levelOf(p);
        if (!level) return null;
        const ends = Date.parse(p.ends || p.expires || '');
        const at = Date.parse(p.effective || p.onset || p.sent || '') || Date.now();
        const where = areaText(p.areaDesc);
        const until = isFinite(ends) ? `until ${timeText(p.ends || p.expires)}` : '';
        return {
            id: 'nws:' + (p.id || f.id),
            kind: 'weather',
            level,
            title: p.event || 'Weather alert',
            // the strip's second line: where and how long, then what the NWS
            // says to do, then what it says is happening
            detail: [where, until].filter(Boolean).join(' · '),
            crawl: oneLine(p.instruction || p.description || p.headline),
            at,
            ends: isFinite(ends) ? ends : 0,
            icon: 'warning',
            source: p.senderName || 'National Weather Service'
        };
    };

    let weather = []; // the NWS alerts as HOMER's own
    let weatherAt = 0;
    let fed = false; // a payload handed in for testing: stop polling over it
    let inFlight = null;

    const readFeed = (json) => {
        const feats = (json && json.features) || [];
        const out = feats.map(fromNws).filter(Boolean);
        // the NWS sends replacements as new alerts that reference the old
        // ones; drop anything a newer alert says it replaces
        const replaced = new Set();
        for (const f of feats) {
            for (const r of ((f.properties && f.properties.references) || [])) {
                if (r && r.identifier) replaced.add('nws:' + r.identifier);
            }
        }
        return out.filter((a) => !replaced.has(a.id));
    };

    const fetchWeather = async () => {
        if (fed) return;
        const c = coords();
        if (!c) return; // neither Home Assistant nor HOMER's weather knows yet
        const url = `${NWS}?point=${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;
        const res = await fetch(url, {
            cache: 'no-store',
            headers: { Accept: 'application/geo+json', 'User-Agent': UA }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        weather = readFeed(json);
        weatherAt = Date.now();
        if (weather.length) log(weather.length, 'NWS alert(s) for', c.lat.toFixed(3) + ',' + c.lon.toFixed(3), `(${c.from})`);
    };

    let pollTimer = 0;
    const hot = () => weather.some((a) => a.level !== 'notice');
    const poll = () => {
        clearTimeout(pollTimer);
        if (fed) return;
        inFlight = fetchWeather().then(
            () => { pollTimer = setTimeout(poll, hot() ? POLL_HOT_MS : POLL_MS); render(); },
            (err) => { warn('weather alerts:', err.message || err); pollTimer = setTimeout(poll, RETRY_MS); }
        );
    };

    // ---------- The house ----------
    //
    // Only what shared/homeassistant.js already sorts into a room's "at a
    // glance" buckets, so there is one list of which sensors matter and one
    // set of device classes, not two. glance.alerts is smoke, carbon
    // monoxide, gas and moisture; glance.doors is doors, windows, openings
    // and garage doors. Nothing else on the strip: motion and occupancy stay
    // in Rooms, where they belong, because a crawl that says somebody walked
    // through the hall is a crawl nobody reads.
    const ALERT_WORD = { smoke: 'Smoke', carbon_monoxide: 'Carbon monoxide', gas: 'Gas', moisture: 'Water' };
    const ALERT_SAY = {
        smoke: 'Smoke detected',
        carbon_monoxide: 'Carbon monoxide detected',
        gas: 'Gas detected',
        moisture: 'Water detected'
    };
    const ALERT_ICON = { smoke: 'local_fire_department', carbon_monoxide: 'warning', gas: 'warning', moisture: 'water_damage' };
    const DOOR_WORD = { window: 'Window', garage_door: 'Garage door', opening: 'Opening' };
    const DOOR_ICON = { window: 'window', garage_door: 'garage', opening: 'meeting_room' };
    const agoText = (ms) => {
        const min = Math.round(ms / 60000);
        if (min < 60) return `${min} minutes`;
        const hrs = Math.round(min / 60);
        return hrs === 1 ? 'an hour' : `${hrs} hours`;
    };
    // "Front Door Door" -> "Front Door"; Home Assistant names a lot of them that way
    const tidy = (name) => String(name || '').replace(/\b(\w+)\s+\1\b\s*$/i, '$1').trim();

    let rings = []; // [{ id, name, at }] the doorbell, for RING_MS

    const houseAlerts = () => {
        const h = HA();
        if (!h || typeof h.house !== 'function' || h.status() !== 'ready') return [];
        let rooms;
        try { rooms = h.house().rooms || []; } catch { return []; }
        const now = Date.now();
        const out = [];
        for (const room of rooms) {
            const g = room.glance;
            if (!g) continue;
            const on = (id) => { const s = h.entity(id); return !!s && s.state === 'on'; };
            const since = (id) => { const s = h.entity(id); const t = s ? Date.parse(s.last_changed) : NaN; return isFinite(t) ? t : now; };
            // A leak, smoke, carbon monoxide or gas: the loudest HOMER has, at
            // once. There is no waiting period that makes sense for these.
            for (const id of g.alerts) {
                if (!on(id)) continue;
                const dc = (h.entity(id).attributes || {}).device_class;
                out.push({
                    id: 'house:' + id,
                    kind: 'house',
                    level: dc === 'moisture' ? 'warning' : 'extreme',
                    title: (ALERT_WORD[dc] || 'Alarm') + ' · ' + room.name,
                    detail: ALERT_SAY[dc] || tidy(h.name(id)),
                    crawl: `${ALERT_SAY[dc] || 'Sensor tripped'} in the ${room.name} — ${tidy(h.name(id))} since ${new Date(since(id)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
                    at: since(id),
                    ends: 0,
                    icon: ALERT_ICON[dc] || 'warning',
                    source: room.name
                });
            }
            // A door, a window or the garage left open. Open is normal; open
            // for a while is the thing worth saying, so it waits — the garage
            // less long, because that's the one that gets left up all evening.
            for (const id of g.doors) {
                if (!on(id)) continue;
                const dc = (h.entity(id).attributes || {}).device_class;
                // Home Assistant's garage_door class where the integration
                // sets one; plenty of openers just report 'door', so the name
                // settles it for those
                const garage = dc === 'garage_door' || /\bgarage\b/i.test(h.name(id, room.name) + ' ' + room.name);
                const wait = garage ? GARAGE_MS : OPEN_MS;
                const open = now - since(id);
                if (open < wait) continue;
                const what = tidy(h.name(id));
                out.push({
                    id: 'house:' + id,
                    kind: 'house',
                    level: 'notice',
                    title: (garage ? 'Garage door' : DOOR_WORD[dc] || 'Door') + ' open',
                    detail: `${what} · ${agoText(open)}`,
                    crawl: `${what} has been open ${agoText(open)}.`,
                    at: since(id),
                    ends: 0,
                    icon: garage ? 'garage' : DOOR_ICON[dc] || 'meeting_room',
                    source: room.name
                });
            }
        }
        // The doorbell. shared/homeassistant.js already says when one rings
        // (onRing), whatever the camera calls the entity.
        rings = rings.filter((r) => now - r.at < RING_MS);
        for (const r of rings) {
            out.push({
                id: 'ring:' + r.id + ':' + Math.round(r.at / 1000),
                kind: 'house',
                level: 'notice',
                title: 'Doorbell',
                detail: `${r.name} · ${timeText(new Date(r.at).toISOString())}`,
                crawl: `Somebody rang the ${r.name}.`,
                at: r.at,
                ends: r.at + RING_MS,
                icon: 'doorbell',
                source: r.name
            });
        }
        return out;
    };

    // ---------- The list ----------

    // Loudest first, then newest within a level: a tornado warning does not
    // wait behind a doorbell ring that happened to arrive after it.
    const list = () => {
        const now = Date.now();
        const all = [...weather, ...houseAlerts()].filter((a) => !a.ends || a.ends > now);
        all.sort((a, b) => RANK[b.level] - RANK[a.level] || b.at - a.at);
        return all;
    };
    const current = () => {
        const all = list();
        pruneSeen(all);
        return all.find((a) => !seen[a.id]) || null;
    };

    const listeners = new Set();
    const emit = () => listeners.forEach((fn) => { try { fn(); } catch (err) { console.error('[HOMER alerts]', err); } });

    const dismiss = (id) => {
        const a = id ? list().find((x) => x.id === id) : current();
        if (!a) return false;
        seen[a.id] = Date.now();
        writeSeen(seen);
        render();
        emit();
        return true;
    };

    // ---------- The strip ----------

    const root = document.createElement('div');
    root.id = 'al-strip';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
        <i class="al-edge" aria-hidden="true"></i>
        <span class="al-icon" aria-hidden="true"></span>
        <div class="al-text">
            <div class="al-head"><b class="al-title"></b><span class="al-detail"></span></div>
            <div class="al-crawl"><div class="al-crawl-run"><span class="al-crawl-a"></span><span class="al-crawl-b" aria-hidden="true"></span></div></div>
        </div>
        <button type="button" class="al-x" tabindex="-1" aria-label="Dismiss this alert">${icon('close')}</button>`;

    let mounted = false;
    const mount = () => {
        if (mounted || !document.body) return;
        document.body.appendChild(root);
        mounted = true;
    };

    const fullscreenVideo = () => {
        const p = HP();
        try { return !!(p && p.nowPlaying && p.nowPlaying() && p.docked && !p.docked()); } catch { return false; }
    };
    // out of the way of anything that is itself asking for an answer: the
    // Actions strip, the quick controls panel, a HOMER sheet
    const blocked = () => {
        const shut = (obj) => { try { return !!(obj && obj.isOpen && obj.isOpen()); } catch { return false; } };
        if (shut(window.HomerActions) || shut(window.HomerQuick)) return true;
        try {
            const m = window.HomerMenu;
            if (m && typeof m.isSheetOpen === 'function' && m.isSheetOpen()) return true;
        } catch { /* not loaded */ }
        return false;
    };

    let showingId = '';
    let noticeTimer = 0;

    const paint = (a) => {
        const q = (s) => root.querySelector(s);
        root.dataset.level = a.level;
        root.dataset.kind = a.kind;
        q('.al-icon').innerHTML = icon(a.icon);
        q('.al-title').textContent = a.title;
        q('.al-detail').textContent = a.detail || '';
        const words = a.crawl || '';
        q('.al-crawl-a').textContent = words;
        q('.al-crawl-b').textContent = words;
        root.classList.toggle('al-has-crawl', !!words);
        // a crawl only crawls when it doesn't fit; when it does, it just sits
        // there, which is easier to read and what most of them will do
        requestAnimationFrame(() => {
            const box = q('.al-crawl');
            const run = q('.al-crawl-run');
            const one = q('.al-crawl-a');
            if (!box || !run || !one) return;
            const over = one.scrollWidth > box.clientWidth + 4;
            root.classList.toggle('al-crawling', over);
            if (over) {
                const gap = 80;
                run.style.setProperty('--al-run', (one.scrollWidth + gap) + 'px');
                run.style.setProperty('--al-secs', Math.max(12, Math.round((one.scrollWidth + gap) / 110)) + 's'); // about 110px a second
            } else {
                run.style.removeProperty('--al-run');
                run.style.removeProperty('--al-secs');
            }
        });
    };

    const hide = () => {
        clearTimeout(noticeTimer);
        showingId = '';
        root.classList.remove('on');
    };

    const render = () => {
        mount();
        const a = current();
        if (!a || blocked()) { hide(); return; }
        root.classList.toggle('al-video', fullscreenVideo());
        root.classList.toggle('al-phone', !!(window.HomerLayout && window.HomerLayout.isPhone()));
        if (a.id !== showingId) {
            showingId = a.id;
            paint(a);
            root.classList.add('on');
            clearTimeout(noticeTimer);
            // A notice takes itself down. An advisory is not worth sitting on
            // a picture, and a doorbell ring is over the moment you've read it.
            if (a.level === 'notice') {
                const wait = fullscreenVideo() ? NOTICE_VIDEO_MS : NOTICE_MS;
                noticeTimer = setTimeout(() => { seen[a.id] = Date.now(); writeSeen(seen); render(); emit(); }, wait);
            }
        }
    };

    root.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.target.closest('.al-x')) { dismiss(); return; }
        // a weather alert opens the Weather screen, which has the forecast
        const a = current();
        if (a && a.kind === 'weather') {
            if (window.HomerForecast && typeof window.HomerForecast.open === 'function') window.HomerForecast.open();
            else if (HP() && typeof HP().go === 'function') HP().go('#/weather');
            else location.hash = '#/weather';
        }
    });
    // the strip is a message, not a control surface: a press on it must never
    // land on whatever is under it, and must never pull focus off the screen
    root.addEventListener('mousedown', (ev) => ev.preventDefault());

    // ---------- Keys ----------

    const BACK_KEYS = ['Escape', 'GoBack', 'BrowserBack'];
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    // Esc dismisses the alert that's showing, and only then: the next Esc is
    // the screen's own Back, as it always was. Nothing else on the strip takes
    // a key, so the remote and the keyboard reach the screen underneath.
    const onKey = (ev) => {
        if (!root.classList.contains('on')) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isTyping(ev.target)) return;
        if (!BACK_KEYS.includes(ev.key)) return;
        ev.preventDefault();
        ev.stopPropagation();
        dismiss();
    };
    window.addEventListener('keydown', onKey, true);

    // ---------- The Actions strip (shared/actions.js) ----------
    // The Siri Remote has no Esc, so the alert's dismiss is an action too.

    const offActions = window.HomerActions ? window.HomerActions.provide(() => {
        const a = current();
        if (!a || !root.classList.contains('on')) return [];
        const out = [{
            id: 'alert-dismiss',
            key: 'Esc',
            icon: 'close',
            label: 'Dismiss alert',
            sub: a.title,
            run: () => dismiss(a.id)
        }];
        if (a.kind === 'weather') {
            out.push({
                id: 'alert-weather',
                icon: 'cloud',
                label: 'Weather',
                sub: a.title,
                run: () => {
                    if (window.HomerForecast && typeof window.HomerForecast.open === 'function') window.HomerForecast.open();
                    else if (HP() && typeof HP().go === 'function') HP().go('#/weather');
                    else location.hash = '#/weather';
                }
            });
        }
        return out;
    }, { global: true, id: 'alerts', title: 'Alert' }) : () => {};

    // ---------- Keeping up ----------

    let offHa = null;
    let offRing = null;
    let haRef = null; // shared/homeassistant.js replaces itself on a reload: re-subscribe to the new one
    const attachHa = () => {
        const h = HA();
        if (!h || h === haRef) return;
        if (offHa) { try { offHa(); } catch { /* the old one is gone */ } }
        if (offRing) { try { offRing(); } catch { /* the old one is gone */ } }
        haRef = h;
        offHa = h.onChange(() => render());
        offRing = h.onRing((bell) => {
            rings.unshift({ id: bell.id, name: bell.name || 'doorbell', at: Date.now() });
            rings = rings.slice(0, 5);
            render();
            emit();
        });
    };
    attachHa();

    // the house is re-read on a timer as well as on change, because "open for
    // ten minutes" becomes true with nothing happening in Home Assistant
    const houseTimer = setInterval(() => { attachHa(); render(); }, HOUSE_MS);
    const offPlayer = HP() && HP().onChange ? HP().onChange(() => render()) : null;
    window.addEventListener('hashchange', render);
    // a tab that has been in the background may have missed a whole storm
    const onVisible = () => { if (!document.hidden) { poll(); render(); } };
    document.addEventListener('visibilitychange', onVisible);

    const start = () => {
        mount();
        attachHa();
        poll();
        render();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    // The location can arrive late: Home Assistant is still connecting, or
    // HOMER's weather is still resolving a ZIP. Until one turns up there is
    // nothing to ask the NWS for, and poll() has already gone to sleep for
    // five minutes, so watch for it and then stop — a call that keeps failing
    // is poll()'s own business, on its own slower retry.
    const waitLoc = setInterval(() => {
        if (fed || weatherAt) { clearInterval(waitLoc); return; } // already asking
        if (coords()) { clearInterval(waitLoc); poll(); }
    }, 5000);

    window.HomerAlerts = {
        version: VERSION,
        list,
        current,
        dismiss,
        refresh: () => { poll(); render(); },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        el: root,
        coords,

        // ----- Testing, with a real alert -----
        //
        // There is often no active alert anywhere near the house, and HOMER
        // ships no made-up one. So feed it a real one the NWS has issued.
        // api.weather.gov keeps the recent ones and answers a browser
        // directly, so this is the whole of it, from the console:
        //
        //   HomerAlerts._fetch('https://api.weather.gov/alerts?event=Tornado Warning&limit=1')
        //   HomerAlerts._fetch('https://api.weather.gov/alerts?event=Flood Watch&limit=1')
        //   HomerAlerts._live()   // back to the house's own alerts
        //
        // The payload is the NWS's own, word for word. Its times are in the
        // past, so _feed re-dates it to now (otherwise it reads as expired and
        // never shows) — that, and nothing else, is changed.
        _feed(json, { shift = true } = {}) {
            const now = Date.now();
            const j = JSON.parse(JSON.stringify(json));
            if (shift) {
                for (const f of (j.features || [])) {
                    const p = f.properties || {};
                    const span = Math.max(30 * 60000, (Date.parse(p.ends || p.expires || '') || 0) - (Date.parse(p.effective || p.sent || '') || 0));
                    p.effective = p.onset = p.sent = new Date(now - 60000).toISOString();
                    p.ends = p.expires = new Date(now + span).toISOString();
                }
            }
            clearTimeout(pollTimer);
            fed = true;
            weather = readFeed(j);
            weatherAt = now;
            log('fed', weather.length, 'alert(s) for testing:', weather.map((a) => `${a.level} ${a.title}`).join(', '));
            render();
            emit();
            return weather.slice();
        },
        async _fetch(url) {
            const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/geo+json', 'User-Agent': UA } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return this._feed(await res.json());
        },
        _live() {
            fed = false;
            weather = [];
            seen = {};
            writeSeen(seen);
            poll();
            render();
        },
        _inFlight: () => inFlight,

        destroy() {
            clearTimeout(pollTimer);
            clearTimeout(noticeTimer);
            clearInterval(houseTimer);
            clearInterval(waitLoc);
            offActions();
            if (offHa) offHa();
            if (offRing) offRing();
            if (typeof offPlayer === 'function') offPlayer();
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('hashchange', render);
            document.removeEventListener('visibilitychange', onVisible);
            document.removeEventListener('DOMContentLoaded', start);
            listeners.clear();
            root.remove();
        }
    };
})();
