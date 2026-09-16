/*
 * HOMER Cameras for Jellyfin Web: every camera in the house on one wall, and
 * the doorbell's rings and detections where you can actually see them.
 *
 * HOMER's own page at #/cameras (Home's menu, after Rooms). Jellyfin has
 * nothing at that address.
 *
 *   The wall     one tile per camera, the doorbell first and biggest. Each
 *                tile shows its name, its room and a picture that refreshes
 *                every few seconds; the tile with focus upgrades to the live
 *                stream after a moment, so only one stream ever runs.
 *                Cameras that aren't up yet (cameras/cameras-model.js
 *                PLANNED) hold their square, marked "Not set up yet".
 *   A camera     OK on a tile: the live view large, the camera's own controls
 *                under it (a doorbell's siren, quick reply, LED and privacy
 *                mode, where it has them), and a strip of what it saw —
 *                rings and detections, newest first, each with a thumbnail
 *                and a time. OK on one plays that clip in the big view.
 *
 * Remote/keyboard: arrows move, OK opens (a camera, a clip), Esc/Backspace
 * steps back (clip → camera → wall → the previous screen), H goes Home. The
 * Apple TV's remote reaches the same things through the Actions strip
 * (shared/actions.js).
 *
 * On a phone (shared/layout.js) it draws cameras/cameras-phone.js instead:
 * the wall as one column with the doorbell first and its events under it.
 *
 * window.HomerCameras = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerCameras && typeof window.HomerCameras.destroy === 'function') {
        window.HomerCameras.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="cameras.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/cameras\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'cameras/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990;
    const STILL_MS = 4000; // a tile's picture
    const BIG_STILL_MS = 1000; // the full-screen still, until the stream is up
    const LIVE_DELAY_MS = 700; // how long a tile has to keep focus before it streams
    const EVENTS_MS = 90000; // a quiet refresh of the events strip
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

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
    const HA = () => window.HomerHA || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Cameras]', err); return fallback; }
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
    const fullscreen = () => {
        const p = HP();
        if (p && typeof p.fullscreen === 'function') p.fullscreen();
    };

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const icon = (name, cls = '') => `<span class="material-icons${cls ? ' ' + cls : ''}" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // "4:12 PM" today, "Mon 4:12 PM" this week, "Sep 3, 4:12 PM" before that
    const whenText = (d) => {
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return fmtTime(d);
        const days = Math.round((now - d) / 86400000);
        if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${fmtTime(d)}`;
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtTime(d)}`;
    };
    const agoText = (d) => {
        const min = Math.round((Date.now() - d.getTime()) / 60000);
        if (min < 1) return 'just now';
        if (min < 60) return `${min} min ago`;
        const hrs = Math.floor(min / 60);
        return hrs < 24 ? `${hrs} hr ago` : `${Math.floor(hrs / 24)} d ago`;
    };
    // the room, only when the camera's name doesn't already say it
    // ("Front Door" in Front Door needs saying once, not twice)
    const roomTag = (t) => {
        const room = (t && t.room) || '';
        const name = (t && t.name) || '';
        return room && !name.toLowerCase().includes(room.toLowerCase()) ? room : '';
    };
    const runLength = (secs) => {
        if (!secs) return '';
        const m = Math.floor(secs / 60);
        return m ? `${m}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
    };

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

    // A camera's still in an <img>, refreshed while it's on screen; the new
    // picture loads out of sight and swaps in, so it never flashes.
    const keepStill = (img, id, everyMs = STILL_MS) => {
        let timer = 0;
        let stopped = false;
        let loading = false;
        const box = img.closest('[data-still-box]') || img.parentElement;
        const load = () => {
            if (stopped || loading) return;
            const h = HA();
            // a camera Home Assistant can't reach has no still to ask for, and
            // the one on screen is however old the outage is: clear it, say
            // there's no picture, and stop asking until it's back
            const ent = h && h.entity ? h.entity(id) : null;
            if (ent && (ent.state === 'unavailable' || ent.state === 'unknown')) {
                if (box) { box.classList.remove('has-still'); box.classList.add('no-still'); }
                img.removeAttribute('src');
                return;
            }
            const url = h ? h.snapshotUrl(id, true) : '';
            if (!url) { box && box.classList.add('no-still'); return; }
            if (url.startsWith('data:')) {
                img.src = url;
                box && box.classList.add('has-still');
                box && box.classList.remove('no-still');
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
        timer = setInterval(() => { if (!document.hidden && img.isConnected) load(); }, everyMs);
        return () => { stopped = true; clearInterval(timer); };
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
        if (cssReady && document.getElementById('hc-css')) return cssReady;
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
        cssReady = Promise.all([link('hc-css', 'cameras.css'), link('hc-phone-css', 'cameras-phone.css')]);
        return cssReady;
    };

    // ---------- The screen ----------

    const model = () => (window.HomerCamerasModel ? window.HomerCamerasModel.create() : null);
    let shared = null; // one model for both layouts
    const theModel = () => {
        if (!shared) shared = model();
        return shared;
    };

    const createScreen = (openAt) => {
        const M = theModel();
        const root = el('div', 'homer-screen');
        root.id = 'hc-root';
        root.style.visibility = 'hidden';
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hc-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hc-topbar">
                <div class="hc-brand homer-home" role="button" title="Home (H)"><span class="hc-brand-mark">${icon('home')}</span>HOMER<span class="hc-brand-sub">Cameras</span></div>
                <div class="hc-clock"><div class="hc-clock-time"></div><div class="hc-clock-date"></div></div>
            </div>
            <div class="hc-body">
                <div class="hc-wall"></div>
            </div>
            <div class="hc-view">
                <div class="hc-view-main" data-still-box role="button">
                    <img class="hc-view-img" alt="" draggable="false">
                    <video class="hc-view-live" muted playsinline></video>
                    <video class="hc-view-clip" playsinline controls></video>
                    <div class="hc-view-badge"></div>
                    <div class="hc-view-none">${icon('videocam_off')}<span class="hc-view-none-say">No picture from this camera</span><span class="hc-view-none-seen"></span></div>
                    <div class="hc-view-clipinfo"></div>
                </div>
                <div class="hc-view-side">
                    <div class="hc-view-name"></div>
                    <div class="hc-view-room"></div>
                    <div class="hc-controls"></div>
                </div>
                <div class="hc-events">
                    <div class="hc-events-head">${icon('history')}<span>Recent</span><span class="hc-events-note"></span></div>
                    <div class="hc-events-track"></div>
                </div>
            </div>
            <div class="hc-state"></div>
            <div class="hc-toast" role="status" aria-live="polite"></div>
            <div class="hc-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);
        const $$ = (s) => [...stage.querySelectorAll(s)];

        const fit = () => {
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < 1600) { s = box.width / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        const clockTick = () => {
            const d = new Date();
            $('.hc-clock-time').textContent = fmtTime(d);
            $('.hc-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        clockTick();
        const clockTimer = setInterval(clockTick, 10000);

        const toastEl = $('.hc-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `${icon(kind === 'err' ? 'error_outline' : 'check_circle')}<span class="hc-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hc-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hc-toast'; }, 2400);
        };
        const failed = () => toast('Home Assistant didn\'t take that. Try again.', 'err');

        // ----- state -----

        let alive = true;
        let tiles = []; // from the model
        let zone = 'wall'; // wall | view | clip
        let sel = 0; // the tile on the wall
        let cam = ''; // the camera on the view
        let part = 'live'; // in the view: live | controls | events
        let ci = 0; // which control
        let ei = 0; // which event
        let evs = []; // the events showing
        let evLoad = 0; // a token, so a slow load can't paint over a new camera
        let live = null; // { stop } for whichever video is streaming
        let liveFor = ''; // the camera it's trying to stream
        let liveOn = ''; // the camera whose picture is actually moving
        let liveTimer = 0;
        let stopStills = []; // the wall's still refreshers
        let stopBig = null;
        let eventsTimer = 0;

        // ----- the wall -----

        const tileHtml = (t, i) => {
            if (t.planned) {
                return `<div class="hc-tile planned${i === 0 ? ' first' : ''}" data-i="${i}" role="button">
                    <div class="hc-tile-soon">${icon('videocam_off')}<b>${esc(t.name)}</b><span>Not set up yet</span></div>
                </div>`;
            }
            return `<div class="hc-tile${i === 0 ? ' first' : ''}" data-i="${i}" data-cam="${esc(t.id)}" data-still-box role="button">
                <img alt="" draggable="false">
                <video class="hc-tile-live" muted playsinline></video>
                <div class="hc-tile-none">${icon('videocam_off')}</div>
                <div class="hc-tile-down">${icon('videocam_off')}<b>Camera unavailable</b><span class="hc-tile-seen"></span></div>
                <div class="hc-tile-badge"></div>
                <div class="hc-tile-label">${t.doorbell ? icon('doorbell') : ''}<span>${esc(t.name)}</span>${roomTag(t) ? `<i>${esc(roomTag(t))}</i>` : ''}</div>
                <div class="hc-tile-note"></div>
            </div>`;
        };

        const drawWall = () => {
            stopStills.forEach((fn) => fn());
            stopStills = [];
            const wall = $('.hc-wall');
            wall.innerHTML = tiles.map(tileHtml).join('');
            wall.classList.toggle('hc-wall-wide', tiles.length > 5);
            $$('.hc-tile[data-cam]').forEach((t) => stopStills.push(keepStill(t.querySelector('img'), t.dataset.cam)));
            paintWall();
        };

        // "Last seen 7:13 AM" — when Home Assistant last had anything from a
        // camera that's gone quiet.
        const seenText = (t) => (t && t.since ? `Last seen ${whenText(t.since)}` : 'Home Assistant can\'t reach it');

        const paintWall = () => {
            const h = HA();
            $$('.hc-tile').forEach((t, i) => {
                t.classList.toggle('sel', i === sel && zone === 'wall');
                const note = t.querySelector('.hc-tile-note');
                if (!note) return;
                const id = t.dataset.cam;
                const info = tiles[i];
                const down = !!info && !info.planned && !info.available;
                t.classList.toggle('down', down);
                const seen = t.querySelector('.hc-tile-seen');
                if (seen) seen.textContent = down ? seenText(info) : '';
                const bell = info && info.bellId;
                if (bell && h && !down) {
                    const last = h.lastRing(bell);
                    note.textContent = last ? `Last ring ${agoText(last)}` : last === null ? 'No rings in a week' : '';
                } else note.textContent = '';
                t.classList.toggle('streaming', liveOn === id);
            });
        };

        // ----- live video, one at a time -----

        const stopLive = () => {
            clearTimeout(liveTimer);
            if (live) { safe(() => live.stop()); live = null; }
            $$('.hc-tile-live, .hc-view-live').forEach((v) => v.classList.remove('on'));
            $('.hc-view').classList.remove('live');
            liveFor = '';
            liveOn = '';
            paintWall();
        };

        // Start the stream into `video` for camera `id`. Nothing happens for a
        // camera that can't stream — the still keeps refreshing instead.
        const startLive = (id, video, after = 0) => {
            if (!id || liveFor === id) return;
            const t = tileOf(id);
            if (t && !t.available) { stopLive(); return; } // nothing to stream from
            stopLive();
            clearTimeout(liveTimer);
            liveTimer = setTimeout(() => {
                const h = HA();
                if (!alive || !h || !video.isConnected) return;
                liveFor = id;
                paintWall();
                const run = h.playCamera(id, video);
                live = run;
                run.started.then(() => {
                    if (!alive || liveFor !== id) return;
                    liveOn = id;
                    video.classList.add('on');
                    if (video.closest('.hc-view')) {
                        $('.hc-view').classList.add('live');
                        if (zone !== 'clip') $('.hc-view-badge').innerHTML = '<span class="hc-live-badge">Live</span>';
                    }
                    paintWall();
                }).catch(() => {
                    if (liveFor !== id) return;
                    liveFor = '';
                    live = null;
                    paintWall();
                    // it can't stream: the refreshing still is the picture
                    if (video.closest('.hc-view') && zone !== 'clip') $('.hc-view-badge').innerHTML = '<span class="hc-still-badge">Still</span>';
                });
            }, after);
        };

        // the focused tile goes live once it has held focus a moment
        const wallLive = () => {
            if (zone !== 'wall') return;
            const t = $$('.hc-tile')[sel];
            const id = t && t.dataset.cam;
            if (!id) { stopLive(); return; }
            if (liveFor === id) return;
            startLive(id, t.querySelector('.hc-tile-live'), LIVE_DELAY_MS);
        };

        // ----- the camera view -----

        const tileOf = (id) => tiles.find((t) => t.id === id) || null;

        const controlsHtml = () => {
            const list = M ? M.controls(cam) : [];
            const bat = M ? M.battery(cam) : null;
            const bits = list.map((c, k) => {
                let value = '';
                let on = false;
                if (c.kind === 'siren') { value = 'Sound it'; }
                else if (c.kind === 'privacy') { value = c.on ? 'On' : 'Off'; on = c.on; }
                else if (c.kind === 'led') { value = c.words[c.options.indexOf(c.state)] || c.state; }
                else if (c.kind === 'reply') { value = c.options.length ? 'Play a message' : 'None set'; }
                if (!c.available) { value = 'Unavailable'; on = false; }
                return `<div class="hc-ctl${on ? ' on' : ''}${c.available ? '' : ' off-line'}" data-c="${k}" role="button">${icon(c.icon)}<b>${esc(c.label)}</b><span>${esc(value)}</span></div>`;
            });
            if (bat != null) bits.push(`<div class="hc-bat">${icon(bat > 60 ? 'battery_full' : bat > 25 ? 'battery_5_bar' : 'battery_alert')}<b>Battery</b><span>${bat}%</span></div>`);
            if (!list.length && bat == null) bits.push('<div class="hc-ctl-none">This camera has no controls in Home Assistant.</div>');
            return bits.join('');
        };
        const controlList = () => (M ? M.controls(cam) : []);

        // The camera view, when Home Assistant can't reach the camera: the
        // picture is replaced by what's wrong and when it was last heard from,
        // and the badge stops claiming a still it hasn't got.
        let viewDown = null; // what the open camera was last drawn as
        const paintDown = () => {
            const t = tileOf(cam);
            const down = !!cam && !!t && !t.available;
            const main = $('.hc-view-main');
            main.classList.toggle('hc-down', down);
            if (down) main.classList.add('no-still');
            $('.hc-view-none-say').textContent = down ? 'Camera unavailable' : 'No picture from this camera';
            $('.hc-view-none-seen').textContent = down ? seenText(t) : '';
            if (down && zone !== 'clip') $('.hc-view-badge').innerHTML = '<span class="hc-off-badge">Offline</span>';
            if (viewDown === down) return;
            const was = viewDown;
            viewDown = down;
            // it came back while the view was open: pick the picture up again
            // rather than leaving the camera sitting there marked offline
            if (was === true && !down && cam && zone !== 'clip') {
                main.classList.remove('no-still');
                $('.hc-view-badge').innerHTML = '<span class="hc-still-badge">Still</span>';
                startLive(cam, $('.hc-view-live'), 0);
                if (M) { M.forget(cam); loadEvents(true); }
            }
        };

        const paintControls = () => {
            $('.hc-controls').innerHTML = controlsHtml();
            $$('.hc-ctl').forEach((c, k) => c.classList.toggle('sel', zone === 'view' && part === 'controls' && k === ci));
        };

        // An event's picture. Home Assistant hands out no thumbnail for a
        // Reolink clip, so the clip is its own thumbnail: a muted <video>
        // holding its first frame. Only the strip's own events load one, and
        // a clip that never loads leaves the tile's icon showing.
        const eventHtml = (e, k) => `
            <div class="hc-ev${e.ring ? ' ring' : ''}${e.clip ? '' : ' noclip'}" data-e="${k}" role="button">
                <div class="hc-ev-shot">
                    ${e.thumb ? `<img src="${esc(e.thumb)}" alt="" draggable="false">` : '<video muted playsinline preload="metadata"></video>'}
                    <div class="hc-ev-icon">${icon(e.icon)}</div>
                    ${e.seconds ? `<span class="hc-ev-len">${esc(runLength(e.seconds))}</span>` : ''}
                </div>
                <div class="hc-ev-line"><b>${esc(e.label)}</b> · ${esc(whenText(e.at))}</div>
                ${e.clip ? '' : '<div class="hc-ev-sub">No clip</div>'}
            </div>`;

        const paintEvents = () => {
            const track = $('.hc-events-track');
            const note = $('.hc-events-note');
            const why = M ? M.trouble(cam) : '';
            if (!evs.length) {
                track.innerHTML = `<div class="hc-events-none">${esc(why || 'Nothing recorded yet.')}</div>`;
                note.textContent = '';
                return;
            }
            track.innerHTML = evs.map(eventHtml).join('');
            // times from Home Assistant's history still stand when the camera
            // itself is away, so say which of the two this strip is showing
            note.textContent = evs.some((e) => e.clip) ? '' : (why || 'times only — this camera keeps no clips');
            $$('.hc-ev').forEach((n, k) => n.classList.toggle('sel', zone === 'view' && part === 'events' && k === ei));
            loadThumbs();
            revealEvent();
        };

        // the clip's own first frame, a few at a time so a battery camera
        // isn't asked for twelve files at once
        let thumbQueue = [];
        let thumbBusy = 0;
        const loadThumbs = () => {
            thumbQueue = $$('.hc-ev video').filter((v) => !v.dataset.done);
            pumpThumbs();
        };
        const pumpThumbs = () => {
            while (thumbBusy < 2 && thumbQueue.length) {
                const v = thumbQueue.shift();
                const k = Number(v.closest('.hc-ev').dataset.e);
                const e = evs[k];
                if (!e || !e.clip) { v.dataset.done = '1'; continue; }
                v.dataset.done = '1';
                thumbBusy++;
                const done = () => { thumbBusy--; pumpThumbs(); };
                M.clipUrl(e).then((url) => {
                    if (!alive || !url || !v.isConnected) { done(); return; }
                    v.addEventListener('loadeddata', () => { v.classList.add('on'); done(); }, { once: true });
                    v.addEventListener('error', done, { once: true });
                    setTimeout(done, 12000); // a slow camera doesn't hold up the rest
                    v.src = url + '#t=0.8';
                }).catch(done);
            }
        };

        const revealEvent = () => {
            const n = $$('.hc-ev')[ei];
            if (!n) return;
            const track = $('.hc-events-track');
            const x = n.offsetLeft - track.clientWidth / 2 + n.offsetWidth / 2;
            track.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
        };

        const loadEvents = (fresh = false) => {
            if (!M || !cam) return;
            const token = ++evLoad;
            $('.hc-events').classList.add('loading');
            M.events(cam, { fresh }).then((list) => {
                if (!alive || token !== evLoad) return;
                evs = list;
                ei = clamp(ei, 0, Math.max(0, evs.length - 1));
                $('.hc-events').classList.remove('loading');
                paintEvents();
                updateLegend();
            }).catch(() => {
                if (!alive || token !== evLoad) return;
                evs = [];
                $('.hc-events').classList.remove('loading');
                $('.hc-events-track').innerHTML = '<div class="hc-events-none">Couldn\'t read this camera\'s recordings.</div>';
            });
        };

        const openCamera = (id) => {
            if (!id) return;
            stopLive();
            cam = id;
            zone = 'view';
            part = 'live';
            ci = 0;
            ei = 0;
            evs = [];
            const t = tileOf(id);
            $('.hc-view-name').textContent = t ? t.name : (HA() ? HA().name(id) : id);
            $('.hc-view-room').textContent = [roomTag(t), t && t.doorbell ? 'Doorbell' : ''].filter(Boolean).join(' · ');
            $('.hc-view-badge').innerHTML = '<span class="hc-still-badge">Still</span>';
            const main = $('.hc-view-main');
            main.classList.remove('has-still', 'no-still');
            viewDown = null;
            paintDown();
            if (stopBig) stopBig();
            stopBig = keepStill($('.hc-view-img'), id, BIG_STILL_MS);
            paintControls();
            $('.hc-events-track').innerHTML = '<div class="hc-events-none">Looking for recordings…</div>';
            setZone('view');
            startLive(id, $('.hc-view-live'), 0);
            loadEvents();
            clearInterval(eventsTimer);
            eventsTimer = setInterval(() => { if (!document.hidden && zone !== 'wall') loadEvents(true); }, EVENTS_MS);
        };

        const closeCamera = () => {
            viewDown = null;
            stopLive();
            if (stopBig) { stopBig(); stopBig = null; }
            clearInterval(eventsTimer);
            stopClip();
            cam = '';
            evs = [];
            setZone('wall');
            wallLive();
        };

        // ----- playing a clip -----

        const clipEl = $('.hc-view-clip');
        const stopClip = () => {
            try { clipEl.pause(); clipEl.removeAttribute('src'); clipEl.load(); } catch { /* gone */ }
            clipEl.classList.remove('on');
            $('.hc-view').classList.remove('clip');
            $('.hc-view-clipinfo').textContent = '';
        };
        const playClip = (e) => {
            if (!e) return;
            if (!e.clip) { toast('There\'s no clip for that one — only the time.', 'err'); return; }
            stopLive();
            zone = 'clip';
            $('.hc-view').classList.add('clip');
            $('.hc-view-badge').innerHTML = '<span class="hc-still-badge">Clip</span>';
            $('.hc-view-clipinfo').textContent = `${e.label} · ${whenText(e.at)}`;
            updateLegend();
            M.clipUrl(e).then((url) => {
                if (!alive || zone !== 'clip') return;
                if (!url) { toast('Home Assistant couldn\'t hand over that clip.', 'err'); backOne(); return; }
                clipEl.src = url;
                clipEl.classList.add('on');
                clipEl.muted = false;
                // a browser that won't start sound on its own still shows the
                // clip: play it silently rather than leave a frozen frame
                clipEl.play().catch(() => {
                    clipEl.muted = true;
                    return clipEl.play().catch(() => {});
                });
            }).catch(() => {
                if (alive && zone === 'clip') { toast('Home Assistant couldn\'t hand over that clip.', 'err'); backOne(); }
            });
        };

        // ----- zones -----

        const setZone = (z) => {
            zone = z;
            stage.classList.toggle('hc-zone-wall', z === 'wall');
            stage.classList.toggle('hc-zone-view', z !== 'wall');
            paintWall();
            paintControls();
            $$('.hc-ev').forEach((n, k) => n.classList.toggle('sel', zone === 'view' && part === 'events' && k === ei));
            $('.hc-view').classList.toggle('on-live', part === 'live');
            $('.hc-view').classList.toggle('on-controls', part === 'controls');
            $('.hc-view').classList.toggle('on-events', part === 'events');
            updateLegend();
        };
        const paintParts = () => {
            $('.hc-view').classList.toggle('on-live', part === 'live');
            $('.hc-view').classList.toggle('on-controls', part === 'controls');
            $('.hc-view').classList.toggle('on-events', part === 'events');
            paintControls();
            $$('.hc-ev').forEach((n, k) => n.classList.toggle('sel', zone === 'view' && part === 'events' && k === ei));
            if (part === 'events') revealEvent();
            updateLegend();
        };

        // ----- controls -----

        const runControl = (c) => {
            const h = HA();
            if (!h || !c) return;
            if (!c.available) { toast(`${c.label} is unavailable while the camera is offline.`, 'err'); return; }
            if (c.kind === 'siren') {
                h.toggle(c.id).then(() => toast(c.on ? 'Siren off' : 'Siren on')).catch(failed);
            } else if (c.kind === 'privacy') {
                h.toggle(c.id).then(() => toast(c.on ? 'Privacy mode off' : 'Privacy mode on — the camera stops looking')).catch(failed);
            } else if (c.kind === 'led') {
                const next = c.options[(c.options.indexOf(c.state) + 1) % Math.max(1, c.options.length)];
                if (next) h.setOption(c.id, next).then(() => toast('LED: ' + (c.words[c.options.indexOf(next)] || next))).catch(failed);
            } else if (c.kind === 'reply') {
                const msg = c.options[0];
                if (!msg) { toast('No quick replies are set on this camera.', 'err'); return; }
                h.setOption(c.id, msg).then(() => toast('Played: ' + msg)).catch(failed);
            }
            setTimeout(paintControls, 400);
        };

        // ----- keys -----

        const ok = () => {
            const msg = statusMessage();
            if (msg) {
                if (msg.act === 'settings') go('#/mypreferencesmenu');
                else if (msg.act === 'retry' && HA()) safe(() => HA().reconnect());
                return;
            }
            if (zone === 'wall') {
                const t = tiles[sel];
                if (!t) return;
                if (t.planned) { toast(`${t.name} isn't in Home Assistant yet.`); return; }
                openCamera(t.id);
            } else if (zone === 'clip') {
                if (clipEl.paused) clipEl.play().catch(() => {});
                else clipEl.pause();
            } else if (part === 'controls') runControl(controlList()[ci]);
            else if (part === 'events') playClip(evs[ei]);
            else if (part === 'live') toast('Already live.');
        };

        const backOne = () => {
            if (zone === 'clip') {
                stopClip();
                zone = 'view';
                part = 'events';
                $('.hc-view-badge').innerHTML = '<span class="hc-still-badge">Still</span>';
                startLive(cam, $('.hc-view-live'), 0);
                paintParts();
                return;
            }
            if (zone === 'view') { closeCamera(); return; }
            goBack();
        };

        const move = (dx, dy) => {
            if (zone === 'clip') {
                if (dx) clipEl.currentTime = clamp(clipEl.currentTime + dx * 5, 0, clipEl.duration || 0);
                return;
            }
            if (zone === 'wall') {
                const n = tiles.length;
                if (!n) return;
                if (dy) {
                    // the wall is a grid: down/up move about a row at a time
                    const cols = Math.max(1, Math.round(Math.sqrt(n)));
                    sel = clamp(sel + dy * cols, 0, n - 1);
                } else sel = clamp(sel + dx, 0, n - 1);
                paintWall();
                updateLegend();
                stopLive();
                wallLive();
                return;
            }
            // in the view: up/down between live, controls and events
            if (dy) {
                const order = ['live', 'controls', 'events'];
                const at = order.indexOf(part);
                part = order[clamp(at + dy, 0, order.length - 1)];
                paintParts();
                return;
            }
            if (part === 'controls') {
                const n = controlList().length;
                if (n) ci = clamp(ci + dx, 0, n - 1);
                paintControls();
            } else if (part === 'events') {
                if (evs.length) ei = clamp(ei + dx, 0, evs.length - 1);
                paintParts();
            }
        };

        const eat = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
        const onKey = (ev) => {
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') { eat(ev); if (!ev.repeat) goHome(); return; }
            if (BACK_KEYS.includes(k)) { eat(ev); if (!ev.repeat) backOne(); return; }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown'];
            if (!handled.includes(k)) return;
            eat(ev);
            if (k === 'ArrowUp') move(0, -1);
            else if (k === 'ArrowDown') move(0, 1);
            else if (k === 'ArrowLeft') move(-1, 0);
            else if (k === 'ArrowRight') move(1, 0);
            else if ((k === 'Enter' || k === ' ') && !ev.repeat) ok();
        };
        // The wheel doesn't scroll the page — every screen is a fixed stage —
        // but the Recent strip is wider than the window (two dozen events, eight
        // of them in view), and the remote's ◀▶ were the only way to reach the
        // rest. With a mouse, the wheel over the strip scrolls it, either axis,
        // so every event can be clicked.
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const track = ev.target.closest && ev.target.closest('.hc-events-track');
            if (!track || track.scrollWidth <= track.clientWidth) return;
            const by = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
            if (!by) return;
            track.scrollLeft += by * (ev.deltaMode === 1 ? 30 : 1); // a line, or pixels
            // keep the highlight on something that's actually in view, so OK
            // on the remote picks up where the mouse left off
            const near = $$('.hc-ev').reduce((best, n, k) => {
                const d = Math.abs(n.offsetLeft + n.offsetWidth / 2 - track.scrollLeft - track.clientWidth / 2);
                return best && best.d <= d ? best : { d, k };
            }, null);
            if (near && near.k !== ei) {
                ei = near.k;
                part = 'events';
                $$('.hc-ev').forEach((n, k) => n.classList.toggle('sel', zone === 'view' && k === ei));
                updateLegend();
            }
        };
        const onClick = (ev) => {
            if (ev.target.closest('.hc-brand')) { goHome(); return; }
            const leg = ev.target.closest('.hc-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') backOne();
                else if (a === 'fullscreen') fullscreen();
                else if (a === 'ok') ok();
                return;
            }
            const tile = ev.target.closest('.hc-tile');
            if (tile && zone === 'wall') { sel = Number(tile.dataset.i); paintWall(); ok(); return; }
            const ctl = ev.target.closest('.hc-ctl');
            if (ctl) { part = 'controls'; ci = Number(ctl.dataset.c); paintParts(); runControl(controlList()[ci]); return; }
            const evn = ev.target.closest('.hc-ev');
            if (evn) { part = 'events'; ei = Number(evn.dataset.e); paintParts(); playClip(evs[ei]); return; }
            // the picture itself: it looks like a button, so it acts like one —
            // a clip plays and pauses, the live view is just picked out
            const main = ev.target.closest('.hc-view-main');
            if (main && zone !== 'wall') {
                if (zone === 'clip') {
                    // same as OK on the remote, including the browser that
                    // won't start sound on its own: play it silently instead
                    if (clipEl.paused) clipEl.play().catch(() => { clipEl.muted = true; return clipEl.play().catch(() => {}); });
                    else clipEl.pause();
                    setTimeout(updateLegend, 120);
                }
                else { part = 'live'; paintParts(); }
                return;
            }
            if (ev.target.closest('.hc-state [data-ok]')) ok();
        };

        // ----- legend -----

        const updateLegend = () => {
            const items = [];
            const msg = statusMessage();
            if (msg && msg.ok) items.push({ key: 'OK', label: msg.ok, action: 'ok' });
            else if (zone === 'wall') {
                items.push({ key: '◀▶▲▼', label: 'Cameras' });
                const t = tiles[sel];
                if (t && !t.planned) items.push({ key: 'OK', label: 'Full screen', action: 'ok' });
            } else if (zone === 'clip') {
                items.push({ key: '◀▶', label: '5 sec' }, { key: 'OK', label: clipEl.paused ? 'Play' : 'Pause', action: 'ok' }, { key: 'ESC', label: 'Live', action: 'back' });
            } else {
                items.push({ key: '▲▼', label: 'Live · Controls · Recent' });
                if (part === 'controls' && controlList().length) items.push({ key: '◀▶', label: 'Controls' }, { key: 'OK', label: controlList()[ci] ? controlList()[ci].label : 'Use', action: 'ok' });
                else if (part === 'events' && evs.length) items.push({ key: '◀▶', label: 'Recent' }, { key: 'OK', label: 'Play clip', action: 'ok' });
                items.push({ key: 'ESC', label: 'Cameras', action: 'back' });
            }
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' });
            if (zone === 'wall' || msg) items.push({ key: 'ESC', label: 'Back', action: 'back' });
            const html = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hc-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
            const leg = $('.hc-legend');
            if (leg.dataset.html !== html) { leg.dataset.html = html; leg.innerHTML = html; }
        };

        // ----- Home Assistant -----

        const stateEl = $('.hc-state');
        const drawStatus = () => {
            const msg = statusMessage();
            stage.classList.toggle('hc-waiting', !!msg);
            stateEl.classList.toggle('show', !!msg);
            stateEl.innerHTML = msg
                ? `${msg.spin ? '<div class="hc-spinner"></div>' : icon('videocam', 'hc-state-icon')}<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}${msg.ok ? `<div class="hc-state-ok" data-ok role="button"><span class="hc-key">OK</span>${esc(msg.ok)}</div>` : ''}`
                : '';
        };

        let lastSig = '';
        const sync = () => {
            if (!alive) return;
            drawStatus();
            const next = M ? M.wall() : [];
            const sig = next.map((t) => t.key + ':' + t.id).join(',');
            if (sig !== lastSig) {
                lastSig = sig;
                const keep = tiles[sel] ? tiles[sel].key : '';
                tiles = next;
                const at = tiles.findIndex((t) => t.key === keep);
                sel = at >= 0 ? at : 0;
                drawWall();
                if (zone === 'wall') wallLive();
            } else {
                tiles = next;
                paintWall();
            }
            if (zone !== 'wall' && cam) { paintControls(); paintDown(); }
            updateLegend();
        };

        const offHA = HA() ? HA().onChange(sync) : () => {};
        const offRing = HA() && HA().onRing ? HA().onRing((d) => {
            if (!alive) return;
            toast(`${d.name}: someone's at the door`);
            if (M) M.forget(d.camera);
            if (cam && cam === d.camera) loadEvents(true);
            paintWall();
        }) : () => {};

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);

        // ----- the Actions strip (shared/actions.js) -----
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            if (zone === 'wall') {
                const t = tiles[sel];
                if (t && !t.planned) out.push({ id: 'open', icon: 'fullscreen', label: 'Full screen', sub: t.name, main: true, run: () => ok() });
            } else {
                if (cam) out.push({ id: 'live', icon: 'videocam', label: 'Live view', main: true, run: () => { if (zone === 'clip') backOne(); part = 'live'; paintParts(); } });
                const e = evs[ei];
                if (zone === 'view' && e) out.push({ id: 'clip', icon: 'play_arrow', label: 'Play clip', sub: `${e.label} · ${whenText(e.at)}`, disabled: !e.clip, run: () => playClip(e) });
                for (const c of controlList()) {
                    out.push({
                        id: 'ctl-' + c.kind,
                        icon: c.icon,
                        label: c.label,
                        sub: c.kind === 'privacy' ? (c.on ? 'On' : 'Off') : c.kind === 'led' ? (c.words[c.options.indexOf(c.state)] || c.state) : '',
                        run: () => runControl(c)
                    });
                }
                out.push({ id: 'wall', icon: 'grid_view', label: 'All cameras', run: () => closeCamera() });
            }
            out.push({ id: 'refresh', icon: 'refresh', label: 'Refresh', run: () => { if (M) M.reset(); lastSig = ''; sync(); if (cam) loadEvents(true); } });
            return out;
        }, { id: 'cameras', title: 'Cameras' }) : () => {};

        sync();
        setZone('wall');
        if (openAt) {
            const t = tiles.find((x) => x.id === openAt);
            if (t) { sel = tiles.indexOf(t); openCamera(t.id); }
        }

        return {
            phone: false,
            show() { root.style.visibility = ''; },
            sync() { drawStatus(); updateLegend(); },
            state: () => ({ cam, sel }),
            teardown() {
                alive = false;
                offActions();
                offHA();
                offRing();
                stopLive();
                stopClip();
                if (stopBig) stopBig();
                stopStills.forEach((fn) => fn());
                clearInterval(clockTimer);
                clearInterval(eventsTimer);
                clearTimeout(toastTimer);
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
    let wanted = null; // a camera to open once the house is in

    const isOurRoute = () => /^#!?\/cameras(\?|$)/i.test(currentRoute());
    const askedCamera = () => {
        const h = currentRoute();
        const q = h.indexOf('?');
        if (q < 0) return '';
        return new URLSearchParams(h.slice(q + 1)).get('camera') || '';
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const phoneLayout = () => !!(window.HomerLayout && window.HomerCamerasPhone && window.HomerLayout.usePhone('cameras'));
    const PHONE_CTX = {
        model: theModel, keepStill, statusMessage, whenText, agoText, runLength, fmtTime, roomTag,
        esc, icon, clamp, go, goBack, goHome, docked, fullscreen, BASE, QUERY
    };
    const draw = (openAt) => (phoneLayout() ? window.HomerCamerasPhone.create({ ...PHONE_CTX, openAt }) : createScreen(openAt));

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) { closeScreen(); return; }
        if (screen) { screen.sync(); return; }
        const openAt = wanted || askedCamera();
        wanted = null;
        const s = draw(openAt);
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        const was = screen.state ? screen.state() : null;
        closeScreen();
        wanted = was && was.cam ? was.cam : null;
        lastSig = '';
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
    const onRouteChange = () => { lastSig = ''; queueSync(); };

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

    window.HomerCameras = {
        version: VERSION,
        // open(): the Cameras screen, on a camera if one is named
        open(camera) {
            suppressed = false;
            wanted = camera || null;
            if (!isOurRoute()) { go('#/cameras' + (camera ? '?camera=' + encodeURIComponent(camera) : '')); return; }
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
            shared = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('hc-css')?.remove();
            document.getElementById('hc-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
