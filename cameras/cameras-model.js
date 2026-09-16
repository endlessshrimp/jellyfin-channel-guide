/*
 * HOMER Cameras: the data behind the Cameras screen, with no drawing in it.
 * The TV layout (cameras/cameras.js) and the phone layout
 * (cameras/cameras-phone.js) both read from here, so switching layouts costs
 * nothing and nothing loads twice.
 *
 * What it knows:
 *
 *   wall()          the tiles, in order: the doorbell, then the four planned
 *                   cameras, then anything else Home Assistant has. A planned
 *                   camera that isn't in Home Assistant yet is a placeholder
 *                   ({ planned: true }); the moment a camera with that name
 *                   turns up it takes the same square, with no code change.
 *   controls(id)    the camera's own buttons, found on its device: a siren, a
 *                   quick reply, an LED mode, privacy mode. Only the ones it
 *                   really has.
 *   events(id)      what the camera saw, newest first: rings and detections,
 *                   each with a time, a label, and a clip where there is one.
 *   trouble(id)     why the last events(id) found no clips of its own, in
 *                   words, or '' — a camera that's offline keeps its
 *                   recordings to itself, and the strip says so.
 *   clipUrl(ev)     a URL a <video> can load for that event's clip.
 *
 * Where the events come from
 * --------------------------
 * A Reolink camera keeps its own recordings, and the Reolink integration
 * publishes them at media-source://reolink as
 *   reolink → camera → Low/High resolution → day → clip
 * with one clip per event and a title the integration writes itself:
 *   "19:00:39 0:02:32 Motion Vehicle Person Doorbell"
 * — the time of day, how long it runs, and everything the camera triggered
 * on. "Doorbell" in that list is a ring. HOMER walks the newest days
 * backwards, takes the clips, and reads the exact start and end out of the
 * media id (…|20260915190039|20260915190311).
 *
 * Home Assistant hands out no thumbnail for these clips (every one comes back
 * with thumbnail: null) and keeps no stills of its own, so a tile's picture is
 * the clip's own first frame, drawn by a paused <video>. A media source that
 * does carry a thumbnail (the made-up house's does) is used as-is.
 *
 * Where a camera has no clips — it isn't a Reolink, or the recording is off —
 * the events fall back to Home Assistant's history of the ring and detection
 * sensors: the times are right, there's just nothing to play.
 *
 * window.HomerCamerasModel = { create, PLANNED, version }
 */
(() => {
    const VERSION = '0.1.0';

    // The cameras Jason is putting up (ONVIF bulb cameras), so the wall is the
    // right shape before they arrive. `match` is what makes one real: any
    // Home Assistant camera whose name or entity id matches takes the slot.
    // Adding a fifth planned camera is one line here; adding a camera that
    // matches none of them needs nothing — it lands after these.
    const PLANNED = [
        { key: 'driveway', name: 'Driveway', match: /drive\s*-?\s*way/i },
        { key: 'backyard', name: 'Backyard', match: /back\s*-?\s*(yard|garden)|rear\s*yard/i },
        { key: 'garage', name: 'Garage', match: /garage/i },
        { key: 'side_yard', name: 'Side Yard', match: /side\s*-?\s*yard|side\s*gate/i }
    ];

    const HA = () => window.HomerHA || null;

    // ---------- Clip titles ----------

    // "19:00:39 0:02:32 Motion Vehicle Person Doorbell" -> the trigger words
    const TITLE = /^\s*(\d{1,2}:\d{2}:\d{2})\s+(\d{1,2}:\d{2}:\d{2})\s*(.*)$/;
    // …|20260915190039|20260915190311
    const STAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

    const fromStamp = (s) => {
        const m = STAMP.exec(String(s || ''));
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        return isFinite(d.getTime()) ? d : null;
    };
    const seconds = (hms) => {
        const p = String(hms || '').split(':').map(Number);
        return p.length === 3 && p.every(isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
    };

    // What a clip's trigger words mean, most worth saying first. A ring is a
    // ring whatever else the camera saw at the same moment.
    const KINDS = [
        { word: /doorbell|visitor/i, label: 'Ring', icon: 'doorbell', rank: 0 },
        { word: /person/i, label: 'Person', icon: 'person', rank: 1 },
        { word: /package/i, label: 'Package', icon: 'inventory_2', rank: 2 },
        { word: /animal|pet/i, label: 'Animal', icon: 'pets', rank: 3 },
        { word: /vehicle|car/i, label: 'Vehicle', icon: 'directions_car', rank: 4 },
        { word: /motion/i, label: 'Motion', icon: 'directions_walk', rank: 5 }
    ];
    const readKinds = (words) => {
        const hits = KINDS.filter((k) => k.word.test(words || ''));
        const best = hits[0] || { label: 'Recorded', icon: 'videocam', rank: 9 };
        return { label: best.label, icon: best.icon, ring: best.rank === 0, all: hits.map((k) => k.label) };
    };

    // ---------- The made-up house and the real one both answer these ----------

    const nameOf = (id) => {
        const h = HA();
        return h ? h.name(id) : id;
    };

    const create = () => {
        let mediaTree = null; // the Reolink browse, cached per camera
        const eventCache = new Map(); // camera id -> { at, list }
        const troubles = new Map(); // camera id -> why there are no clips, in words
        const EVENTS_MS = 60000; // a minute; a ring pushes a refresh anyway

        // ----- the wall -----

        const roomOf = (house, camId) => {
            const r = (house.rooms || []).find((x) => (x.cameras || []).includes(camId));
            return r ? r.name : '';
        };

        const wall = () => {
            const h = HA();
            if (!h) return [];
            const house = h.house();
            const cams = (house.cameras || []).slice();
            const bells = house.doorbells || [];
            const used = new Set();
            const tile = (id, planned) => {
                used.add(id);
                const bell = bells.find((b) => b.camera === id) || null;
                const s = h.entity(id);
                const state = s ? s.state : 'unavailable';
                // Home Assistant says "unavailable" for a camera its
                // integration can't reach — a Reolink that dropped off Wi-Fi,
                // a battery that ran out. There's no picture, no stream and
                // no live listing of its recordings until it's back.
                const down = !s || state === 'unavailable' || state === 'unknown';
                const since = down && s && s.last_changed ? new Date(s.last_changed) : null;
                return {
                    id,
                    key: planned ? planned.key : id,
                    name: h.name(id),
                    room: roomOf(house, id),
                    doorbell: !!bell,
                    bellId: bell ? bell.id : '',
                    planned: false,
                    state,
                    available: !down,
                    // when it was last heard from, where Home Assistant knows
                    since: since && isFinite(since.getTime()) ? since : null
                };
            };
            const out = [];
            // the doorbell first: it's the one that rings
            for (const b of bells) {
                if (b.camera && cams.includes(b.camera) && !used.has(b.camera)) out.push(tile(b.camera));
            }
            // then the planned four, real where Home Assistant has them
            for (const p of PLANNED) {
                const found = cams.find((id) => !used.has(id) && (p.match.test(h.name(id)) || p.match.test(id)));
                if (found) out.push(tile(found, p));
                else out.push({ id: '', key: p.key, name: p.name, room: '', doorbell: false, bellId: '', planned: true, state: 'planned', available: false, since: null });
            }
            // then anything else that's already there
            for (const id of cams) if (!used.has(id)) out.push(tile(id));
            return out;
        };

        // ----- a camera's own controls -----

        // Reolink's entities are named for what they do; HOMER only offers the
        // four that make sense over a live view, and only when the camera has
        // them. Anything risky (a restart button, a firmware update) is left
        // alone on purpose.
        const CONTROLS = [
            { kind: 'siren', icon: 'campaign', label: 'Siren', is: (id) => /^siren\./.test(id) },
            { kind: 'reply', icon: 'record_voice_over', label: 'Quick reply', is: (id) => /^select\..*play_quick_reply/i.test(id) },
            { kind: 'led', icon: 'lightbulb', label: 'LED', is: (id) => /^select\..*(doorbell_led|status_led)/i.test(id) },
            { kind: 'privacy', icon: 'visibility_off', label: 'Privacy mode', is: (id) => /^switch\..*privacy/i.test(id) }
        ];
        const LED_WORDS = { stayoff: 'Off', auto: 'Auto', alwaysonatnight: 'At night', alwayson: 'Always on' };

        const controls = (camId) => {
            const h = HA();
            if (!h || !camId) return [];
            const near = h.siblings(camId);
            const out = [];
            for (const c of CONTROLS) {
                const id = near.find(c.is);
                if (!id) continue;
                const s = h.entity(id);
                if (!s) continue;
                const options = s.attributes.options || [];
                out.push({
                    kind: c.kind,
                    id,
                    icon: c.icon,
                    label: c.label,
                    state: s.state,
                    on: s.state === 'on',
                    // an entity of a device that's offline takes no commands
                    available: s.state !== 'unavailable' && s.state !== 'unknown',
                    options,
                    // the LED's words are Reolink's ("alwaysonatnight"); say them plainly
                    words: c.kind === 'led' ? options.map((o) => LED_WORDS[o] || o) : options
                });
            }
            return out;
        };

        // the battery, where the camera runs on one
        const battery = (camId) => {
            const h = HA();
            if (!h || !camId) return null;
            const id = h.siblings(camId).find((x) => /^sensor\..*battery/i.test(x));
            const s = id ? h.entity(id) : null;
            const pct = s ? Number(s.state) : NaN;
            return isFinite(pct) ? Math.round(pct) : null;
        };

        // ----- the events: the camera's own clips -----

        // Find this camera's branch of media-source://reolink. The integration
        // hangs each camera's entity on the node's thumbnail
        // (/api/camera_proxy/camera.front_door_fluent), which is the only
        // certain way to tell two cameras apart; the name is the fallback.
        const findBranch = async (camId) => {
            const h = HA();
            if (!h) return null;
            if (!mediaTree) mediaTree = await h.browseMedia('media-source://reolink').catch(() => null);
            const kids = (mediaTree && mediaTree.children) || [];
            const want = String(camId).split('.')[1] || '';
            return kids.find((k) => String(k.thumbnail || '').includes(camId))
                || kids.find((k) => String(k.thumbnail || '').includes(want))
                || kids.find((k) => k.title && k.title.toLowerCase() === nameOf(camId).toLowerCase())
                || null;
        };

        // The low-resolution stream: same events, a quarter of the bytes, and
        // it's the one that comes off a battery camera without waking it for
        // long. Falls back to whatever the camera offers.
        const pickRes = (node) => {
            const kids = (node && node.children) || [];
            return kids.find((k) => /\|sub$/.test(k.media_content_id || '') || /low/i.test(k.title || ''))
                || kids[0] || null;
        };

        const clipsFrom = (dayNode) => ((dayNode && dayNode.children) || []).map((c) => {
            const parts = String(c.media_content_id || '').split('|');
            const at = fromStamp(parts[5]);
            const m = TITLE.exec(c.title || '');
            const kinds = readKinds(m ? m[3] : c.title);
            if (!at) return null;
            return {
                id: c.media_content_id,
                at,
                seconds: m ? seconds(m[2]) : 0,
                label: kinds.label,
                icon: kinds.icon,
                ring: kinds.ring,
                all: kinds.all,
                clip: c.can_play !== false ? c.media_content_id : '',
                thumb: c.thumbnail || '',
                source: 'camera'
            };
        }).filter(Boolean);

        // Is this camera's entity reachable right now?
        const isDown = (camId) => {
            const h = HA();
            const s = h ? h.entity(camId) : null;
            return !s || s.state === 'unavailable' || s.state === 'unknown';
        };

        // Walk the camera's days newest first until there are enough events.
        //
        // media-source://reolink can be browsed with the camera offline, but
        // only down to a point: the integration answers with the camera and
        // its two resolutions from what it already knows, and then has to ask
        // the camera itself which days it has recordings for — which fails
        // while the camera is away. Whatever comes back before that point is
        // kept, and `troubles` remembers why the rest didn't, so the strip can
        // say so instead of looking empty.
        const fromCamera = async (camId, want) => {
            const h = HA();
            const stuck = (why) => { troubles.set(camId, why); return []; };
            const branch = await findBranch(camId).catch(() => null);
            // no Reolink branch at all is the ordinary case for every other
            // make of camera: the times from history are the whole story, and
            // the strip's own note already says so
            if (!branch) {
                return stuck(isDown(camId)
                    ? 'This camera is offline, and Home Assistant keeps no recordings of its own.'
                    : '');
            }
            const cam = await h.browseMedia(branch.media_content_id).catch(() => null);
            const res = pickRes(cam);
            if (!res) return stuck('Home Assistant couldn\'t list this camera\'s recordings.');
            const days = await h.browseMedia(res.media_content_id).catch(() => null);
            const list = ((days && days.children) || []).slice().reverse(); // newest day first
            if (!list.length) {
                return stuck(isDown(camId)
                    ? 'Its clips are on the camera, and the camera is offline — they\'ll be back with it.'
                    : 'This camera has no recordings saved.');
            }
            const out = [];
            for (const day of list.slice(0, 4)) {
                const node = await h.browseMedia(day.media_content_id).catch(() => null);
                out.push(...clipsFrom(node));
                if (out.length >= want) break;
            }
            troubles.set(camId, out.length ? '' : 'No clips in the last few days.');
            return out;
        };

        // ----- the events: Home Assistant's history, for what has no clip -----

        const SENSORS = [
            { re: /visitor|doorbell/i, label: 'Ring', icon: 'doorbell', ring: true },
            { re: /person/i, label: 'Person', icon: 'person' },
            { re: /package/i, label: 'Package', icon: 'inventory_2' },
            { re: /pet|animal/i, label: 'Animal', icon: 'pets' },
            { re: /vehicle/i, label: 'Vehicle', icon: 'directions_car' },
            { re: /motion/i, label: 'Motion', icon: 'directions_walk' }
        ];
        const fromHistory = async (camId, hours) => {
            const h = HA();
            if (!h || !camId) return [];
            const near = h.siblings(camId).filter((x) => /^(binary_sensor|event)\./.test(x));
            const picked = [];
            for (const s of SENSORS) {
                const id = near.find((x) => s.re.test(x));
                if (id) picked.push({ id, ...s });
            }
            if (!picked.length) return [];
            const hist = await h.history(picked.map((p) => p.id), hours).catch(() => ({}));
            const out = [];
            for (const p of picked) {
                const list = hist[p.id] || [];
                const isEvent = /^event\./.test(p.id);
                let prev = null;
                for (const x of list) {
                    const fired = isEvent
                        ? prev !== null && x.state !== prev && x.state !== 'unavailable'
                        : x.state === 'on' && prev !== 'on';
                    if (fired) {
                        out.push({
                            id: p.id + '@' + x.at,
                            at: new Date(x.at),
                            seconds: 0,
                            label: p.label,
                            icon: p.icon,
                            ring: !!p.ring,
                            all: [p.label],
                            clip: '',
                            thumb: '',
                            source: 'history'
                        });
                    }
                    prev = x.state;
                }
            }
            return out;
        };

        // ----- the two, merged -----

        // Two records of the same moment (a clip and the sensor that fired it)
        // are one event: the clip wins, because it has something to play.
        const merge = (clips, hist) => {
            const out = clips.slice();
            for (const e of hist) {
                const near = out.find((c) => Math.abs(c.at - e.at) < 90000
                    && (c.ring === e.ring || c.all.includes(e.label)));
                if (!near) out.push(e);
                else if (e.ring && !near.ring) { near.ring = true; near.label = 'Ring'; near.icon = 'doorbell'; }
            }
            return out.sort((a, b) => b.at - a.at);
        };

        const events = async (camId, { hours = 48, want = 24, fresh = false } = {}) => {
            if (!camId) return [];
            const had = eventCache.get(camId);
            if (!fresh && had && Date.now() - had.at < EVENTS_MS) return had.list;
            troubles.set(camId, '');
            const clips = await fromCamera(camId, want).catch(() => {
                troubles.set(camId, 'Home Assistant couldn\'t list this camera\'s recordings.');
                return [];
            });
            const hist = await fromHistory(camId, hours).catch(() => []);
            const list = merge(clips, hist).slice(0, want);
            eventCache.set(camId, { at: Date.now(), list });
            return list;
        };
        const forget = (camId) => {
            if (camId) { eventCache.delete(camId); troubles.delete(camId); mediaTree = null; } else { eventCache.clear(); troubles.clear(); mediaTree = null; }
        };

        // Why this camera's own clips aren't in the strip, in words, or '' when
        // they are. The times from Home Assistant's history stand either way.
        const trouble = (camId) => troubles.get(camId) || '';

        // A clip's URL, resolved when it's wanted (the signature in it is
        // short-lived, so there's no point holding one).
        const clipUrl = async (ev) => {
            const h = HA();
            if (!h || !ev || !ev.clip) return '';
            const r = await h.resolveMedia(ev.clip);
            return (r && r.url) || '';
        };

        return {
            wall,
            controls,
            battery,
            events,
            trouble,
            forget,
            clipUrl,
            // for the screens' "what can this camera do" checks
            hasClips: (camId) => (eventCache.get(camId) || { list: [] }).list.some((e) => e.clip),
            reset() { mediaTree = null; eventCache.clear(); troubles.clear(); }
        };
    };

    window.HomerCamerasModel = { version: VERSION, create, PLANNED };
})();
