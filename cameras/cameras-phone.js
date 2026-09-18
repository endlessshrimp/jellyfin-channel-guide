/*
 * HOMER Cameras, phone layout. cameras/cameras.js draws this instead of the
 * TV wall when shared/layout.js says it's a phone; both read the same model
 * (cameras/cameras-model.js) through ctx, so nothing loads twice.
 *
 * One column that scrolls:
 *
 *   Doorbell      first and full width, its picture live-ish (a still that
 *                 refreshes), its name and when it last rang
 *   Recent        right under it: the doorbell's rings and detections, newest
 *                 first, swiped sideways. A tap plays that clip.
 *   The rest      one camera a row after that, placeholders included, so the
 *                 column is the right shape before the four bulb cameras go up
 *
 * A tap on any camera opens it: the live view at the top, its controls under
 * it, then its own Recent strip — one level deep, with ‹ Cameras to come
 * back. A video playing in a preview window docks above everything; a tap on
 * it goes full screen, ✕ stops it.
 *
 * window.HomerCamerasPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    const create = (ctx) => {
        const { esc, whenText, agoText, runLength, keepStill, tileStillMs, statusMessage, roomTag } = ctx;
        const P = () => window.HomerPlayer || null;
        const HA = () => window.HomerHA || null;
        const M = ctx.model();

        const root = el('div', 'homer-screen cp-phone');
        root.id = 'hc-root';
        root.style.visibility = 'hidden';
        root.innerHTML = `
            <div class="cp-dock">
                <div class="cp-video" data-homer-preview><span class="cp-video-idle">Tuning…</span></div>
                <div class="cp-dock-bar">
                    <span class="cp-dock-what"></span>
                    <button type="button" class="cp-dock-btn cp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                    <button type="button" class="cp-dock-btn cp-dock-stop" aria-label="Stop">${icon('close')}</button>
                </div>
            </div>
            <div class="cp-scroll">
                <div class="cp-wall"></div>
                <div class="cp-one">
                    <button type="button" class="cp-back">${icon('chevron_left')}<span>Cameras</span></button>
                    <div class="cp-one-shot" data-still-box>
                        <img alt="" draggable="false">
                        <video class="cp-one-live" muted playsinline></video>
                        <video class="cp-one-clip" playsinline controls></video>
                        <div class="cp-one-none">${icon('videocam_off')}<span class="cp-one-none-say"></span><span class="cp-one-none-seen"></span></div>
                        <div class="cp-one-badge"></div>
                    </div>
                    <div class="cp-one-name"></div>
                    <div class="cp-one-room"></div>
                    <div class="cp-controls"></div>
                    <div class="cp-one-events"></div>
                </div>
            </div>
            <div class="cp-state"></div>
            <div class="cp-toast" role="status" aria-live="polite"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const $$ = (s) => [...root.querySelectorAll(s)];

        let alive = true;
        let tiles = [];
        let cam = ''; // the camera that's open, '' for the wall
        let evs = [];
        let evsFor = '';
        let stills = [];
        let stopOne = null;
        let live = null;
        let lastSig = '';
        let thumbQueue = [];
        let thumbBusy = 0;

        const toastEl = $('.cp-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.textContent = msg;
            toastEl.className = 'cp-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'cp-toast'; }, 2400);
        };
        const failed = () => toast('Home Assistant didn\'t take that.', 'err');

        // ----- the events strip, drawn the same on the wall and on a camera -----

        // best picture first: the still Home Assistant saved of the moment,
        // else the clip's own first frame (see cameras.js)
        const evHtml = (e, k) => `
            <div class="cp-ev${e.ring ? ' ring' : ''}${e.clip ? '' : ' noclip'}${e.still ? ' pic' : ''}" data-e="${k}" role="button">
                <div class="cp-ev-shot">
                    ${e.thumb ? `<img src="${esc(e.thumb)}" alt="" draggable="false">`
                        : e.still ? '<img class="still" alt="" draggable="false">'
                        : '<video muted playsinline preload="metadata"></video>'}
                    <div class="cp-ev-icon">${icon(e.icon)}</div>
                    ${e.seconds ? `<span class="cp-ev-len">${esc(runLength(e.seconds))}</span>` : ''}
                </div>
                <div class="cp-ev-line"><b>${esc(e.label)}</b> · ${esc(whenText(e.at))}</div>
                ${e.clip ? '' : '<div class="cp-ev-sub">No clip</div>'}
            </div>`;

        const stripHtml = (list, head, why) => `
            <div class="cp-strip-head">${icon('history')}<span>${esc(head)}</span>${why && list.length ? `<i>${esc(why)}</i>` : ''}</div>
            <div class="cp-strip">${list.length ? list.map(evHtml).join('') : `<div class="cp-strip-none">${esc(why || 'Nothing recorded yet.')}</div>`}</div>`;

        const pumpThumbs = () => {
            while (thumbBusy < 2 && thumbQueue.length) {
                const n = thumbQueue.shift();
                const box = n.closest('.cp-ev');
                const e = evs[Number(box && box.dataset.e)];
                const isStill = n.tagName === 'IMG';
                if (!e || (isStill ? !e.still : !e.clip)) { n.dataset.done = '1'; continue; }
                n.dataset.done = '1';
                thumbBusy++;
                const done = () => { thumbBusy--; pumpThumbs(); };
                (isStill ? M.stillUrl(e) : M.clipUrl(e)).then((url) => {
                    if (!alive || !url || !n.isConnected) { done(); return; }
                    n.addEventListener(isStill ? 'load' : 'loadeddata', () => { n.classList.add('on'); done(); }, { once: true });
                    n.addEventListener('error', done, { once: true });
                    setTimeout(done, 12000);
                    n.src = isStill ? url : url + '#t=0.8';
                }).catch(done);
            }
        };
        // stills before clips: they come off the Pi's disk, not the camera
        const loadThumbs = () => {
            thumbQueue = [...$$('.cp-ev img.still'), ...$$('.cp-ev video')].filter((n) => !n.dataset.done);
            pumpThumbs();
        };

        const loadEvents = (id, into, head, fresh = false) => {
            if (!M || !id) return;
            evsFor = id;
            into.innerHTML = stripHtml([], head).replace('Nothing recorded yet.', 'Looking for recordings…');
            M.events(id, { fresh }).then((list) => {
                if (!alive || evsFor !== id || !into.isConnected) return;
                evs = list;
                // a camera that's away keeps its clips; the times from Home
                // Assistant's history still stand, and the head says which
                const why = M.trouble(id) || (list.length && !list.some((e) => e.clip) ? 'times only' : '');
                into.innerHTML = stripHtml(list, head, why);
                loadThumbs();
            }).catch(() => {
                if (!alive || !into.isConnected) return;
                into.innerHTML = stripHtml([], head, 'Couldn\'t read this camera\'s recordings.');
            });
        };

        // ----- the wall -----

        const tileHtml = (t, i) => {
            if (t.planned) {
                return `<div class="cp-row planned" data-i="${i}">
                    <div class="cp-row-soon">${icon('videocam_off')}<b>${esc(t.name)}</b><span>Not set up yet</span></div>
                </div>`;
            }
            return `<div class="cp-row" data-i="${i}" data-cam="${esc(t.id)}" data-still-box role="button">
                <img alt="" draggable="false">
                <div class="cp-row-none">${icon('videocam_off')}</div>
                <div class="cp-row-down">${icon('videocam_off')}<b>Camera unavailable</b><span class="cp-row-seen"></span></div>
                <div class="cp-row-label">${t.doorbell ? icon('doorbell') : ''}<span>${esc(t.name)}</span>${roomTag(t) ? `<i>${esc(roomTag(t))}</i>` : ''}</div>
                <div class="cp-row-note"></div>
            </div>`;
        };

        const drawWall = () => {
            stills.forEach((fn) => fn());
            stills = [];
            const wall = $('.cp-wall');
            const bell = tiles.find((t) => t.doorbell && !t.planned);
            wall.innerHTML = tiles.map(tileHtml).join('')
                + '<div class="cp-wall-events"></div>';
            // the doorbell's own events go right under it
            const strip = wall.querySelector('.cp-wall-events');
            if (bell) {
                const first = wall.querySelector(`.cp-row[data-cam="${CSS.escape(bell.id)}"]`);
                if (first && first.nextSibling) wall.insertBefore(strip, first.nextSibling);
                loadEvents(bell.id, strip, 'Recent at ' + bell.name);
            } else strip.remove();
            $$('.cp-row[data-cam]').forEach((r) => stills.push(keepStill(r.querySelector('img'), r.dataset.cam, tileStillMs(r.dataset.cam, 5000))));
            paintWall();
        };

        const seenText = (t) => (t && t.since ? `Last seen ${whenText(t.since)}` : 'Home Assistant can\'t reach it');

        const paintWall = () => {
            const h = HA();
            $$('.cp-row').forEach((r, i) => {
                const note = r.querySelector('.cp-row-note');
                const t = tiles[i];
                if (!note || !t) return;
                const down = !t.planned && !t.available;
                r.classList.toggle('down', down);
                const seen = r.querySelector('.cp-row-seen');
                if (seen) seen.textContent = down ? seenText(t) : '';
                if (t.bellId && h && !down) {
                    const last = h.lastRing(t.bellId);
                    note.textContent = last ? `Last ring ${agoText(last)}` : last === null ? 'No rings in a week' : '';
                } else note.textContent = '';
            });
        };

        // ----- one camera -----

        const controlsHtml = () => {
            const list = M.controls(cam);
            const bat = M.battery(cam);
            const bits = list.map((c, k) => {
                let value = '';
                let on = false;
                if (c.kind === 'siren') value = 'Sound it';
                else if (c.kind === 'privacy') { value = c.on ? 'On' : 'Off'; on = c.on; }
                else if (c.kind === 'led') value = c.words[c.options.indexOf(c.state)] || c.state;
                else if (c.kind === 'reply') value = c.options.length ? 'Play a message' : 'None set';
                if (!c.available) { value = 'Unavailable'; on = false; }
                return `<button type="button" class="cp-ctl${on ? ' on' : ''}${c.available ? '' : ' off-line'}" data-c="${k}">${icon(c.icon)}<b>${esc(c.label)}</b><span>${esc(value)}</span></button>`;
            });
            if (bat != null) bits.push(`<div class="cp-bat">${icon(bat > 60 ? 'battery_full' : bat > 25 ? 'battery_5_bar' : 'battery_alert')}<b>Battery</b><span>${bat}%</span></div>`);
            return bits.join('');
        };

        const stopLive = () => {
            if (live) { try { live.stop(); } catch { /* gone */ } live = null; }
            $('.cp-one-shot').classList.remove('live');
            $('.cp-one-live').classList.remove('on');
        };
        const stopClip = () => {
            const c = $('.cp-one-clip');
            try { c.pause(); c.removeAttribute('src'); c.load(); } catch { /* gone */ }
            c.classList.remove('on');
            $('.cp-one-shot').classList.remove('clip');
        };

        // The open camera's picture, when Home Assistant can't reach it: what's
        // wrong and when it was last heard from, in place of a black rectangle.
        // Called again whenever Home Assistant pushes, so it clears itself the
        // moment the camera comes back.
        let openDown = null; // what the open camera was last drawn as
        const paintOpen = () => {
            const t = tiles.find((x) => x.id === cam);
            if (!cam || !t) return;
            const down = !t.available;
            const shot = $('.cp-one-shot');
            shot.classList.toggle('cp-down', down);
            if (down) shot.classList.add('no-still');
            $('.cp-one-none-say').textContent = down ? 'Camera unavailable' : '';
            $('.cp-one-none-seen').textContent = down ? seenText(t) : '';
            const badge = $('.cp-one-badge');
            if (down) badge.innerHTML = '<span class="cp-off-badge">Offline</span>';
            if (openDown === down) return;
            const was = openDown;
            openDown = down;
            // it came back while the camera was open: pick the picture up again
            if (was === true && !down) {
                shot.classList.remove('no-still');
                badge.innerHTML = '<span class="cp-still-badge">Still</span>';
                M.forget(cam);
                loadEvents(cam, $('.cp-one-events'), 'Recent', true);
            }
        };

        const openCamera = (id) => {
            const t = tiles.find((x) => x.id === id);
            if (!id || !t) return;
            cam = id;
            root.classList.add('cp-open');
            $('.cp-one-name').textContent = t.name;
            $('.cp-one-room').textContent = [roomTag(t), t.doorbell ? 'Doorbell' : ''].filter(Boolean).join(' · ');
            const down = !t.available;
            const shot = $('.cp-one-shot');
            shot.classList.remove('has-still', 'no-still');
            $('.cp-one-badge').innerHTML = '<span class="cp-still-badge">Still</span>';
            openDown = null;
            paintOpen();
            if (stopOne) stopOne();
            stopOne = keepStill(shot.querySelector('img'), id, 2000);
            $('.cp-controls').innerHTML = controlsHtml();
            loadEvents(id, $('.cp-one-events'), 'Recent');
            $('.cp-scroll').scrollTop = 0;
            stopLive();
            const h = HA();
            if (h && !down) {
                const run = h.playCamera(id, $('.cp-one-live'));
                live = run;
                run.started.then(() => {
                    if (!alive || cam !== id) return;
                    $('.cp-one-live').classList.add('on');
                    shot.classList.add('live');
                    if (!shot.classList.contains('clip')) $('.cp-one-badge').innerHTML = '<span class="cp-live-badge">Live</span>';
                }).catch(() => { if (cam === id) live = null; });
            }
        };

        const closeCamera = () => {
            stopLive();
            stopClip();
            if (stopOne) { stopOne(); stopOne = null; }
            cam = '';
            evs = [];
            openDown = null;
            root.classList.remove('cp-open');
            lastSig = '';
            sync();
        };

        const playClip = (e) => {
            if (!e) return;
            if (!e.clip) { toast('There\'s no clip for that one — only the time.'); return; }
            if (!cam) { openCamera(evsFor); }
            stopLive();
            const shot = $('.cp-one-shot');
            shot.classList.add('clip');
            $('.cp-one-badge').innerHTML = '<span class="cp-still-badge">Clip</span>';
            M.clipUrl(e).then((url) => {
                if (!alive || !url) { toast('Home Assistant couldn\'t hand over that clip.', 'err'); return; }
                const c = $('.cp-one-clip');
                c.src = url;
                c.classList.add('on');
                c.muted = false;
                c.play().catch(() => { c.muted = true; return c.play().catch(() => {}); });
            }).catch(() => toast('Home Assistant couldn\'t hand over that clip.', 'err'));
        };

        const runControl = (c) => {
            const h = HA();
            if (!h || !c) return;
            if (!c.available) { toast(`${c.label} is unavailable while the camera is offline.`, 'err'); return; }
            if (c.kind === 'siren') h.toggle(c.id).then(() => toast(c.on ? 'Siren off' : 'Siren on')).catch(failed);
            else if (c.kind === 'privacy') h.toggle(c.id).then(() => toast(c.on ? 'Privacy mode off' : 'Privacy mode on')).catch(failed);
            else if (c.kind === 'led') {
                const next = c.options[(c.options.indexOf(c.state) + 1) % Math.max(1, c.options.length)];
                if (next) h.setOption(c.id, next).then(() => toast('LED: ' + (c.words[c.options.indexOf(next)] || next))).catch(failed);
            } else if (c.kind === 'reply') {
                const msg = c.options[0];
                if (!msg) { toast('No quick replies are set on this camera.'); return; }
                h.setOption(c.id, msg).then(() => toast('Played: ' + msg)).catch(failed);
            }
            setTimeout(() => { if (alive && cam) $('.cp-controls').innerHTML = controlsHtml(); }, 400);
        };

        // ----- taps -----

        root.addEventListener('click', (ev) => {
            const hp = P();
            if (ev.target.closest('.cp-dock-stop')) { ev.stopPropagation(); hp && hp.stop(); return; }
            if (ev.target.closest('.cp-dock-full')) { ev.stopPropagation(); hp && hp.fullscreen(); return; }
            if (ev.target.closest('.cp-back')) { closeCamera(); return; }
            const ctl = ev.target.closest('.cp-ctl');
            if (ctl) { runControl(M.controls(cam)[Number(ctl.dataset.c)]); return; }
            const e = ev.target.closest('.cp-ev');
            if (e) { playClip(evs[Number(e.dataset.e)]); return; }
            const row = ev.target.closest('.cp-row');
            if (row) {
                const t = tiles[Number(row.dataset.i)];
                if (!t) return;
                if (t.planned) toast(`${t.name} isn't in Home Assistant yet.`);
                else openCamera(t.id);
            }
        });

        // Back on the phone: out of a camera first, then off the screen
        const onKey = (ev) => {
            if (ev.key !== 'Escape' && ev.key !== 'Backspace') return;
            if (!cam) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            closeCamera();
        };
        document.addEventListener('keydown', onKey, true);
        const onWheel = (ev) => { if (root.contains(ev.target)) ev.stopPropagation(); };
        window.addEventListener('wheel', onWheel, { capture: true, passive: true });

        // ----- Home Assistant -----

        const drawStatus = () => {
            const msg = statusMessage();
            root.classList.toggle('cp-waiting', !!msg);
            const box = $('.cp-state');
            box.classList.toggle('show', !!msg);
            box.innerHTML = msg ? `<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}` : '';
        };

        const sync = () => {
            if (!alive) return;
            drawStatus();
            const next = M ? M.wall() : [];
            const sig = next.map((t) => t.key + ':' + t.id).join(',');
            tiles = next;
            if (sig !== lastSig) {
                lastSig = sig;
                if (!cam) drawWall();
            } else paintWall();
            if (cam) { $('.cp-controls').innerHTML = controlsHtml(); paintOpen(); }
        };

        const offHA = HA() ? HA().onChange(sync) : () => {};
        const offRing = HA() && HA().onRing ? HA().onRing((d) => {
            if (!alive) return;
            toast(`${d.name}: someone's at the door`);
            if (M) M.forget(d.camera);
            const into = cam === d.camera ? $('.cp-one-events') : $('.cp-wall-events');
            if (into) loadEvents(d.camera, into, cam ? 'Recent' : 'Recent at ' + d.name, true);
            paintWall();
        }) : () => {};

        // ----- docked video -----
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = ctx.docked();
            root.classList.toggle('cp-docked', on);
            if (!on) { dockFor = null; return; }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('cp-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp && hp.nowPlaying ? hp.nowPlaying() : null;
            const p = np && np.program;
            const item = np && np.item;
            const what = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ') : item ? item.Name || '' : '';
            if (what !== dockFor) {
                dockFor = what;
                $('.cp-dock-what').innerHTML = `${p ? '<span class="cp-live-badge">Live</span>' : ''}<span>${esc(what)}</span>`;
            }
        };
        const dockTimer = setInterval(syncDock, 500);

        sync();
        syncDock();
        if (ctx.openAt) openCamera(ctx.openAt);

        // the top bar's name (CAMERAS) comes back to the wall from one camera
        // (shared/layout.js)
        const offHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (!cam) return false;
                closeCamera();
                return true;
            }, { atTop: () => !cam })
            : () => {};

        return {
            phone: true,
            show() { root.style.visibility = ''; },
            sync: syncDock,
            state: () => ({ cam, sel: Math.max(0, tiles.findIndex((t) => t.id === cam)) }),
            teardown() {
                alive = false;
                offHome();
                offHA();
                offRing();
                stopLive();
                stopClip();
                if (stopOne) stopOne();
                stills.forEach((fn) => fn());
                clearInterval(dockTimer);
                clearTimeout(toastTimer);
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                root.remove();
            }
        };
    };

    window.HomerCamerasPhone = { version: VERSION, create };
    if (window.HomerLayout) window.HomerLayout.register('cameras', { phone: true });
})();
