/*
 * HOMER Cameras: the data behind the Cameras screen, with no drawing in it.
 * The TV layout (cameras/cameras.js) and the phone layout
 * (cameras/cameras-phone.js) both read from here, so switching layouts costs
 * nothing and nothing loads twice.
 *
 * What it knows:
 *
 *   wall()          the tiles, in order: the doorbell, then whichever planned
 *                   cameras actually exist yet, then anything else Home
 *                   Assistant has. PLANNED only decides where a camera lands
 *                   and in what order once it shows up (by name) — a slot
 *                   with nothing behind it draws no tile at all, so the wall
 *                   is never a row short a square.
 *   controls(id)    the camera's own buttons, found on its device: a siren, a
 *                   quick reply, an LED mode, privacy mode. Only the ones it
 *                   really has.
 *   events(id)      what the camera saw, newest first: rings and detections,
 *                   each with a time, a label, and a clip where there is one.
 *   trouble(id)     why the last events(id) found no clips of its own, in
 *                   words, or '' — a camera that's offline keeps its
 *                   recordings to itself, and the strip says so.
 *   clipUrl(ev)     a URL a <video> can load for that event's clip.
 *   stillUrl(ev)    a URL an <img> can load for the picture saved of it.
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
 * with thumbnail: null), so a tile's picture is either a still Home Assistant
 * saved (below) or, failing that, the clip's own first frame, drawn by a
 * paused <video>. A media source that does carry a thumbnail (the made-up
 * house's does) is used as-is.
 *
 * The pictures of the door
 * ------------------------
 * A Reolink keeps its clips to itself, so a ring used to leave nothing behind
 * that HOMER could show. Two automations in Home Assistant — both called
 * "Doorbell stills: …" — now take a picture the moment the bell is pressed or
 * a person is seen, and drop it in Home Assistant's own media folder:
 *   /media/doorbell/<YYYY-MM-DD>/<ring|person>-<YYYYMMDD-HHMMSS>.jpg
 * which is media-source://media_source/local/doorbell, a folder per day. The
 * file name carries what happened and when, so HOMER needs nothing else: it
 * walks the newest folders, lays each still over the event at the same moment,
 * and shows it as that event's thumbnail — a real picture of who was at the
 * door instead of a clip's first frame.
 *
 * A still with no event of its own becomes one. That isn't a corner case: the
 * ring pulse is shorter than Home Assistant's recorder reliably catches, so
 * the picture is sometimes the only record that anyone rang.
 *
 * Where a camera has no clips — it isn't a Reolink, or the recording is off —
 * the events fall back to Home Assistant's history of the ring and detection
 * sensors: the times are right, there's just nothing to play.
 *
 * The pictures Home Assistant can't hand out
 * ------------------------------------------
 * Home Assistant's snapshot proxy 500s for the garage and front yard cameras
 * (an open upstream bug, home-assistant/core#158305 — not something wrong
 * here). Rather than wait on that, the NAS itself grabs a frame straight off
 * each camera over RTSP and serves it from homerfeeds, HOMER's own helper —
 * which also means these two still work from outside the house (Home
 * Assistant is plain http; HOMER is https and can't reach it from there) and
 * while Home Assistant itself is down. nasStillUrl(id) is '' for every other
 * camera, so nothing else changes.
 *
 * window.HomerCamerasModel = { create, PLANNED, NAS_CAMS, nasStillUrl, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Where a real camera lands and what order it takes, not whether a
    // square is held for one that doesn't exist yet — no camera in Home
    // Assistant matching a slot means no tile for that slot. `match` is what
    // makes one real: any Home Assistant camera whose name or entity id
    // matches takes the slot. Adding a fifth planned camera is one line
    // here; adding a camera that matches none of them needs nothing — it
    // lands after these.
    const PLANNED = [
        // Two distinct cameras now: one actually in the garage, one looking
        // down the driveway (it used to be one camera doing both jobs, named
        // "Garage" — that one is Driveway now, and a second, real Garage
        // camera was added alongside it). Matches are kept mutually
        // exclusive on purpose so a camera named "Garage" can never land in
        // the Driveway slot or vice versa.
        { key: 'garage', name: 'Garage', match: /\bgarage\b/i },
        { key: 'driveway', name: 'Driveway', match: /drive\s*-?\s*way/i },
        { key: 'backyard', name: 'Backyard', match: /back\s*-?\s*(yard|garden)|rear\s*yard/i },
        { key: 'side_yard', name: 'Side Yard', match: /side\s*-?\s*yard|side\s*gate/i }
    ];

    // The cameras the NAS grabs stills for on its own (see the docstring
    // above) — matched the same way PLANNED is, by the camera's Home
    // Assistant name or entity id. `nas` is the short name homerfeeds knows
    // it by (GET /camera/<nas>.jpg). Same driveway/garage split as PLANNED,
    // and for the same reason — keep the two matchers mutually exclusive.
    const NAS_CAMS = [
        { nas: 'driveway', match: /drive\s*-?\s*way/i },
        { nas: 'garage', match: /\bgarage\b/i },
        { nas: 'frontyard', match: /front\s*-?\s*yard/i },
        { nas: 'backyard', match: /back\s*-?\s*(yard|garden)|rear\s*yard/i }
    ];

    const HA = () => window.HomerHA || null;

    // The Jellyfin token HOMER itself signed in with (the same place
    // shared/homeassistant.js reads it from) — homerfeeds requires one on
    // every /camera request and checks it's an administrator's.
    const jfServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const s = (creds.Servers || [])[0];
            return s && s.AccessToken ? s : null;
        } catch { return null; }
    };

    // HOMER's helper on the NAS: through the https name's /homer-feeds, or
    // straight to port 8095 on the LAN (the same rule shared/arr.js uses).
    const feedsBase = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');

    // A still pulled straight off the camera by the NAS, for a camera
    // NAS_CAMS names — '' for every other camera, so the caller falls back
    // to Home Assistant's own snapshotUrl exactly as before. Works with no
    // Home Assistant connection at all: `id` alone is enough to match.
    const nasStillUrl = (id, fresh) => {
        const h = HA();
        const nm = h ? h.name(id) : id;
        const hit = NAS_CAMS.find((c) => c.match.test(nm || '') || c.match.test(id || ''));
        if (!hit) return '';
        const srv = jfServer();
        if (!srv || !srv.AccessToken) return '';
        const q = 'api_key=' + encodeURIComponent(srv.AccessToken) + (fresh ? '&t=' + Date.now() : '');
        return `${feedsBase()}/camera/${hit.nas}.jpg?${q}`;
    };

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
            // then the planned four, each only where Home Assistant actually
            // has it — a slot nothing matches yet draws no tile
            for (const p of PLANNED) {
                const found = cams.find((id) => !used.has(id) && (p.match.test(h.name(id)) || p.match.test(id)));
                if (found) out.push(tile(found, p));
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
                still: '',
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
                            still: '',
                            source: 'history'
                        });
                    }
                    prev = x.state;
                }
            }
            return out;
        };

        // ----- the events: the stills Home Assistant saved -----

        // Home Assistant's own media folder, a folder per day, written by the
        // two "Doorbell stills" automations. Only the doorbell has one; every
        // other camera skips this entirely.
        const STILLS = 'media-source://media_source/local/doorbell';
        const STILL_DAY = /^\d{4}-\d{2}-\d{2}$/; // the automations' folder per day, and only those
        const STILL_NAME = /^(ring|person)-(\d{8})-(\d{6})\.jpe?g$/i;
        const STILL_KIND = {
            ring: { label: 'Ring', icon: 'doorbell', ring: true },
            person: { label: 'Person', icon: 'person', ring: false }
        };

        const isDoorbell = (camId) => {
            const h = HA();
            const bells = h ? (h.house().doorbells || []) : [];
            return bells.some((b) => b.camera === camId);
        };

        const stillsFor = async (camId, days = 4) => {
            const h = HA();
            if (!h || !isDoorbell(camId)) return [];
            const root = await h.browseMedia(STILLS).catch(() => null);
            // no folder at all is the ordinary case before the first ring, and
            // the whole strip still works without it
            // dated folders only: anything else someone has dropped in /media/doorbell
            // shouldn't cost one of the four days that do get walked
            const folders = ((root && root.children) || [])
                .filter((c) => c.can_expand && STILL_DAY.test(c.title || ''))
                .sort((a, b) => String(b.title).localeCompare(String(a.title))); // newest day first
            const out = [];
            for (const day of folders.slice(0, days)) {
                const node = await h.browseMedia(day.media_content_id).catch(() => null);
                for (const f of (node && node.children) || []) {
                    const m = STILL_NAME.exec(f.title || '');
                    const at = m ? fromStamp(m[2] + m[3]) : null;
                    if (at) out.push({ at, still: f.media_content_id, ...STILL_KIND[m[1].toLowerCase()] });
                }
            }
            return out.sort((a, b) => b.at - a.at);
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

        // The stills laid over the events. A still goes to the nearest event of
        // the same kind that hasn't got one yet — a clip's trigger words are in
        // `all`, so a ring still finds the ring and a person still finds the
        // person. Rings are placed first so they get first claim on a clip that
        // was both. A still that matches nothing becomes an event of its own.
        const STILL_NEAR = 90000; // the same window merge() uses
        const withStills = (list, stills) => {
            const out = list.slice();
            for (const s of [...stills.filter((x) => x.ring), ...stills.filter((x) => !x.ring)]) {
                const near = out
                    .filter((e) => !e.still && e.all.includes(s.label) && Math.abs(e.at - s.at) < STILL_NEAR)
                    .sort((a, b) => Math.abs(a.at - s.at) - Math.abs(b.at - s.at))[0];
                if (near) near.still = s.still;
                else out.push({
                    id: s.still,
                    at: s.at,
                    seconds: 0,
                    label: s.label,
                    icon: s.icon,
                    ring: s.ring,
                    all: [s.label],
                    clip: '',
                    thumb: '',
                    still: s.still,
                    source: 'still'
                });
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
            const stills = await stillsFor(camId).catch(() => []);
            const list = withStills(merge(clips, hist), stills).slice(0, want);
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

        // The same, for the picture Home Assistant saved of this event. Also
        // resolved at the last moment: a media source URL is signed and the
        // signature runs out in half a minute, so holding one is pointless.
        const stillUrl = async (ev) => {
            const h = HA();
            if (!h || !ev || !ev.still) return '';
            const r = await h.resolveMedia(ev.still).catch(() => null);
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
            stillUrl,
            // for the screens' "what can this camera do" checks
            hasClips: (camId) => (eventCache.get(camId) || { list: [] }).list.some((e) => e.clip),
            reset() { mediaTree = null; eventCache.clear(); troubles.clear(); }
        };
    };

    window.HomerCamerasModel = { version: VERSION, create, PLANNED, NAS_CAMS, nasStillUrl };
})();
