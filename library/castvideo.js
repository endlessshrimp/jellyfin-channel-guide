/*
 * HOMER "Play on…" for video: send a movie or episode to another screen in
 * the house, the way music/playon.js already sends an album to a speaker.
 * Shared by a movie's page and an episode's/series' page, on both TV and
 * phone (library/library.js, library/library-phone.js).
 *
 * The problem music/playon.js solved doesn't apply here (a movie is one
 * item, not eleven), but the one this module solves is harder: a movie
 * can't use the album machinery at all, because there are two genuinely
 * different ways to hand it to another screen, and they are not
 * equivalent. Every row says, honestly, which one it is:
 *
 *   jellyfin  Jellyfin's own remote control — GET /Sessions to find every
 *             OTHER live Jellyfin client (this device's own session is left
 *             off: that's the page's own Play/Resume button), then
 *             POST /Sessions/{id}/Playing?playCommand=PlayNow. Real
 *             playback: resume points, subtitles, direct play, proper
 *             scrubbing, and it reports straight back into /Sessions, so
 *             HOMER's Now Playing already understands it. Only offered to a
 *             device that is actually running a Jellyfin client right now.
 *   ha        Home Assistant's media_player.play_media, handed an opaque
 *             address minted by HOMER's NAS helper (homerfeeds, POST
 *             /video/cast) that redirects to a Jellyfin transcoding URL
 *             (HLS, forced to H.264/AAC so the fewest devices choke on it —
 *             decided up front, not adaptively). Reaches a Chromecast or an
 *             Apple TV with no Jellyfin app running, but there's no resume,
 *             no subtitle menu, and nothing reports back — Now Playing
 *             won't know about it.
 *
 * Only a short allow-list of Home Assistant platforms gets route 2 at all
 * (HA_VIDEO_OK below): media_player.play_media on samsungtv is documented
 * for launching an app by id, not fetching a media URL — the same reason
 * music/playon.js leaves samsungtv out for music — so a Samsung TV, or a
 * screen that only shows up through Music Assistant's own player wrapper,
 * is left off entirely rather than offered a button that quietly does
 * nothing. When the same physical device is reachable both ways — its Home
 * Assistant entity's name overlaps a live Jellyfin session's device name —
 * only the Jellyfin row is kept; that match is a best-effort word overlap,
 * not a real device fingerprint, so an unmatched pair can in principle show
 * up twice (see README).
 *
 * Like music/playon.js's minted M3U addresses, the address this module
 * hands Home Assistant carries no Jellyfin access token: the POST to
 * /video/cast carries the real token, the NAS helper holds it in memory
 * and hands back /video/c/<key>, a short-lived, single-item redirect. Only
 * that 302 — from the helper straight to the device doing the playing —
 * ever carries the real token, so it never lands in Home Assistant's
 * logbook, its recorder, or a debug log that repeats the service call. See
 * music/playon.js's own header for the fuller reasoning, and homerfeeds.py
 * for the helper itself.
 *
 * Both routes settle late — Home Assistant after its own connect, Jellyfin
 * sessions after a poll — so nothing here decides the button's fate once at
 * draw time. onChange(fn) fires again as each one comes in; a screen that
 * wants the button kept honest re-asks ready()/rows() when it fires (the
 * same shape as music.js's own HomerHA.onChange handler).
 *
 * window.HomerCastVideo = { ready, rows, refresh, onChange, open, close,
 *                            isOpen, destroy, version }
 */
(() => {
    const VERSION = '0.2.0';

    if (window.HomerCastVideo && typeof window.HomerCastVideo.destroy === 'function') {
        window.HomerCastVideo.destroy();
    }

    const POLL_MS = 8000; // /Sessions, while at least one screen cares
    const LAST_KEY = 'homer-castvideo-last'; // the target picked last, on this HOMER device

    const HA = () => window.HomerHA || null;
    const LM = () => window.HomerLibraryModel || null;
    const warn = (...a) => console.warn('[HOMER Cast Video]', ...a);

    // The NAS helper: through the https name's /homer-feeds, or port 8095 on
    // the LAN (the same rule music/playon.js and shared/arr.js use).
    const helper = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };
    const last = () => store.get(LAST_KEY, '') || '';
    const setLast = (key) => store.set(LAST_KEY, key || '');

    // ---------- Jellyfin: every OTHER live client (route 1) ----------

    const myDeviceId = () => {
        try {
            const ac = window.ApiClient;
            if (ac && ac.deviceId) return ac.deviceId();
        } catch { /* below */ }
        return '';
    };

    let sessions = []; // the last /Sessions answer, filtered to real candidates
    let sessionsAt = 0;
    let sessionsErr = false;

    const fetchSessions = async () => {
        const M = LM();
        if (!M) { sessions = []; return; }
        const mine = myDeviceId();
        try {
            const list = await M.api('/Sessions');
            sessionsErr = false;
            sessions = (list || []).filter((s) => s.SupportsRemoteControl
                && s.DeviceId !== mine
                && Array.isArray(s.PlayableMediaTypes) && s.PlayableMediaTypes.includes('Video'));
        } catch (err) {
            sessionsErr = true;
            warn('GET /Sessions failed', err && err.message);
        }
        sessionsAt = Date.now();
    };

    // ---------- Home Assistant: a video-capable player (route 2) ----------

    const PLAY_MEDIA = 512;
    // media_player.play_media on these actually fetches and plays whatever
    // URL it's handed. samsungtv, webostv and androidtv's play_media exist
    // to launch an app by id, not to take a media address (the same call
    // music/playon.js made for music); a Music-Assistant-wrapped entity
    // (the platform its integration reports) is built and verified for
    // audio, so a TV that only reaches Home Assistant through it is left
    // off too rather than guessed at.
    const HA_VIDEO_OK = new Set(['cast', 'apple_tv', 'dlna_dmr', 'upnp']);
    const HA_NOTE = {
        cast: 'Casts the stream directly — picture quality decided up front, no resume',
        apple_tv: 'AirPlays the stream directly — picture quality decided up front, no resume',
        dlna_dmr: 'Plays the stream directly — picture quality decided up front, no resume',
        upnp: 'Plays the stream directly — picture quality decided up front, no resume',
    };

    const haTargets = () => {
        const h = HA();
        if (!h || !h.isSetUp || !h.isSetUp()) return [];
        let house;
        try { house = h.house(); } catch (err) { warn(err); return []; }
        const out = [];
        for (const room of house.rooms || []) {
            for (const id of room.media || []) {
                if (!h.supports(id, PLAY_MEDIA)) continue;
                const platform = h.platform(id);
                if (!HA_VIDEO_OK.has(platform)) continue;
                const s = h.entity(id);
                if (!s) continue;
                // h.name() strips the room's own name off the front ("Bedroom
                // Apple TV" in Bedroom becomes "Apple TV"), which is right for
                // Rooms but leaves two same-model devices in different rooms
                // (Jason has two Apple TVs) looking identical here — so, like
                // music/playon.js's own device rows, put the room back in front.
                const short = h.name(id, room.name).trim();
                const name = short.toLowerCase() === String(room.name || '').toLowerCase()
                    ? short : [room.name, short].filter(Boolean).join(' · ');
                out.push({
                    key: 'ha:' + id,
                    route: 'ha',
                    entityId: id,
                    name,
                    room: room.name || '',
                    platform,
                    note: HA_NOTE[platform] || 'Plays the stream directly — picture quality decided up front, no resume',
                    away: s.state === 'unavailable',
                    busy: s.state === 'playing' || s.state === 'paused',
                    icon: 'cast',
                });
            }
        }
        return out;
    };

    // ---------- Merging the two lists into one honest set of rows ----------

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const wordsOf = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
    // a loose match only: HOMER has no real fingerprint tying a Home
    // Assistant entity to a Jellyfin session, just whichever words their
    // names have in common ("bedroom", "apple", "tv"...) — see the file
    // header and README for what that means when it's wrong.
    const sameDevice = (haRow, session) => {
        const a = wordsOf(haRow.room + ' ' + haRow.name);
        const b = wordsOf((session.DeviceName || '') + ' ' + (session.Client || ''));
        for (const w of a) if (b.has(w)) return true;
        return false;
    };

    const sessionRow = (s) => ({
        key: 'sess:' + s.Id,
        route: 'jellyfin',
        sessionId: s.Id,
        name: s.DeviceName || s.Client || 'Jellyfin client',
        room: '',
        note: s.NowPlayingItem
            ? `Playing “${s.NowPlayingItem.Name}” now — sending replaces it`
            : 'The Jellyfin app — resume, subtitles, its own remote',
        away: false,
        busy: !!s.NowPlayingItem,
        icon: 'live_tv',
    });

    // Every place HOMER could honestly send a movie or episode, in one list:
    // every live Jellyfin session first (route 1, the good one), then a Home
    // Assistant player that reaches video and isn't the same physical device
    // as one of those sessions already (route 2, the fallback).
    const rows = () => {
        const sessRows = sessions.map(sessionRow);
        const ha = haTargets().filter((h) => !sessions.some((s) => sameDevice(h, s)));
        const out = [...sessRows, ...ha];
        out.sort((a, b) => Number(a.away) - Number(b.away)
            || Number(a.route === 'ha') - Number(b.route === 'ha') // Jellyfin's own remote first
            || a.name.localeCompare(b.name));
        return out;
    };

    const ready = () => rows().some((r) => !r.away);

    // ---------- Change events: HA's own, and a slow poll of /Sessions ----------
    // Both routes settle after a screen has usually already drawn once (Home
    // Assistant is still connecting, or /Sessions hasn't been asked yet), so
    // a screen that wants the button kept honest subscribes here rather than
    // deciding once at draw time — the same shape as music.js's own
    // HomerHA.onChange handler.

    const listeners = new Set();
    let pollTimer = 0;
    let offHA = null;

    const emit = () => listeners.forEach((fn) => {
        try { fn(); } catch (err) { console.error('[HOMER Cast Video]', err); }
    });

    const refresh = async () => {
        await fetchSessions();
        emit();
    };

    const startPolling = () => {
        if (pollTimer) return;
        refresh();
        pollTimer = setInterval(refresh, POLL_MS);
        if (!offHA && HA() && HA().onChange) offHA = HA().onChange(emit);
    };
    const stopPolling = () => {
        clearInterval(pollTimer);
        pollTimer = 0;
        if (offHA) { offHA(); offHA = null; }
    };

    const onChange = (fn) => {
        listeners.add(fn);
        startPolling();
        return () => {
            listeners.delete(fn);
            if (!listeners.size) stopPolling();
        };
    };

    // ---------- Sending ----------

    const sendJellyfin = async (row, item, startTicks) => {
        const M = LM();
        if (!M) throw new Error('Library isn’t loaded');
        await M.request('POST', `/Sessions/${row.sessionId}/Playing?playCommand=PlayNow&itemIds=${item.Id}`
            + (startTicks > 0 ? `&startPositionTicks=${startTicks}` : ''));
    };

    // Mint this one item's opaque address. The Jellyfin token goes into this
    // POST body and stays on the NAS from here on — the helper hands back
    // /video/c/<key>, which 302s to a transcoding HLS address (forced to a
    // container and codecs almost everything plays, decided now rather than
    // negotiated per device the way Jellyfin's own player does it). Mirrors
    // music/playon.js's own mint() for an album; see the file header.
    const mintCastUrl = async (item) => {
        const M = LM();
        const server = M && M.getServer();
        if (!server) throw new Error('Not signed in to Jellyfin');
        const res = await fetch(helper() + '/video/cast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                itemId: item.Id,
                token: server.AccessToken,
                deviceId: myDeviceId() || 'homer-castvideo',
            }),
        });
        const out = await res.json().catch(() => null);
        if (!res.ok || !out || !out.url) throw new Error((out && out.error) || `The NAS helper said ${res.status}`);
        return out.url;
    };
    const sendHA = async (row, item) => {
        const h = HA();
        if (!h) throw new Error('Home Assistant isn’t connected');
        const url = await mintCastUrl(item);
        const contentType = item.Type === 'Episode' ? 'episode' : 'movie';
        await h.playMedia(row.entityId, url, contentType);
    };

    const send = async (row, item, startTicks) => {
        if (!row) throw new Error('No target');
        if (row.route === 'jellyfin') await sendJellyfin(row, item, startTicks);
        else await sendHA(row, item);
        setLast(row.key);
    };

    // ---------- The picker ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    let openPicker = null;

    // open(host, opts) — opts: { item, tv, toast, onDone, onNowPlaying, onClose }
    const open = (host, opts = {}) => {
        close();
        const item = opts.item;
        const root = el('div', `cv-root${opts.tv ? ' cv-tv' : ' cv-phone'}`);
        const label = item ? (item.Type === 'Episode'
            ? `${item.SeriesName || ''} ${item.Name || ''}`.trim() : item.Name) : '';
        root.innerHTML = `
            <div class="cv-scrim"></div>
            <div class="cv-sheet" role="dialog" aria-label="Play on">
                <div class="cv-head">
                    <div class="cv-title">Play on…</div>
                    <div class="cv-sub">${esc(label)}</div>
                </div>
                <div class="cv-list"></div>
                <div class="cv-foot"></div>
            </div>`;
        (host || document.body).appendChild(root);

        const list = root.querySelector('.cv-list');
        const foot = root.querySelector('.cv-foot');
        const rowsEls = [];
        let focused = -1;
        let busy = false;

        const say = (text, err) => {
            if (typeof opts.toast === 'function') opts.toast(text, err);
            const note = root.querySelector('.cv-said') || (() => {
                const e = el('div', 'cv-said');
                foot.parentNode.insertBefore(e, foot);
                return e;
            })();
            note.textContent = text;
            note.classList.toggle('err', !!err);
        };

        const addRow = (r) => {
            const off = r.away;
            const bits = [r.note];
            if (r.away) bits.push('not reachable');
            else if (r.busy && r.route === 'ha') bits.push('in use');
            const row = el('div', `cv-row${off ? ' off dim' : ''}`, `
                <span class="cv-ic">${icon(r.icon)}</span>
                <span class="cv-text"><b>${esc(r.name)}</b><i>${esc(bits.filter(Boolean).join(' · '))}</i></span>
                <span class="cv-chip cv-chip-${r.route}">${r.route === 'jellyfin' ? 'Jellyfin' : 'Home Assistant'}</span>
                ${last() === r.key ? '<span class="cv-chip">Last used</span>' : ''}`);
            row.dataset.key = r.key;
            row._pick = !off;
            row._run = () => {
                busy = true;
                row.classList.add('busy');
                say(`Sending ${label || 'it'} to ${r.name}…`);
                send(r, item, opts.startTicks || 0).then(() => {
                    busy = false;
                    row.classList.remove('busy');
                    say(r.route === 'jellyfin' ? `Playing on ${r.name}` : `Sent to ${r.name}`);
                    if (typeof opts.onDone === 'function') opts.onDone(r);
                    setTimeout(() => close(), 1100);
                }).catch((err) => {
                    busy = false;
                    row.classList.remove('busy');
                    say(`${r.name} refused it: ${err.message}`, true);
                });
            };
            list.appendChild(row);
            rowsEls.push(row);
        };

        const draw = () => {
            list.innerHTML = '';
            rowsEls.length = 0;
            const all = rows();
            if (!all.length) {
                const empty = el('div', 'cv-row off dim', `
                    <span class="cv-ic">${icon('cast')}</span>
                    <span class="cv-text"><b>Nothing else to send it to</b><i>${sessionsErr ? 'Jellyfin didn’t answer, and ' : ''}no Home Assistant player takes video here</i></span>`);
                list.appendChild(empty);
                return;
            }
            all.forEach(addRow);
            const want = last();
            const at = rowsEls.findIndex((r) => r.dataset.key === want && r._pick);
            setFocus(at >= 0 ? at : rowsEls.findIndex((r) => r._pick));
        };

        const setFocus = (i) => {
            if (!rowsEls.length) return;
            const n = rowsEls.length;
            let k = ((i % n) + n) % n;
            let guard = 0;
            while (!rowsEls[k]._pick && guard++ < n) k = (k + 1) % n;
            rowsEls.forEach((r, j) => r.classList.toggle('focus', j === k));
            focused = k;
            const r = rowsEls[k];
            if (r.offsetTop < list.scrollTop) list.scrollTo({ top: Math.max(0, r.offsetTop - 8), behavior: 'smooth' });
            else if (r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight) {
                list.scrollTo({ top: r.offsetTop + r.offsetHeight - list.clientHeight + 8, behavior: 'smooth' });
            }
        };
        const run = (row) => {
            if (busy || !row || !row._pick) return;
            row._run();
        };

        foot.innerHTML = '';
        if (typeof opts.onNowPlaying === 'function') {
            const np = el('div', 'cv-foot-btn', `${icon('graphic_eq')}<span>Now Playing</span>`);
            np.onclick = () => { close(); opts.onNowPlaying(); };
            foot.appendChild(np);
        }
        foot.appendChild(el('div', 'cv-hint', 'What each one can do is on its line.'));

        const offChange = onChange(draw);
        draw();

        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key;
            const eat = () => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
            if (k === 'ArrowDown') { eat(); setFocus(focused + 1); return; }
            if (k === 'ArrowUp') { eat(); setFocus(focused - 1); return; }
            if (k === 'Enter' || k === ' ') { eat(); if (!ev.repeat) run(rowsEls[focused]); return; }
            if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(k)) { eat(); if (!ev.repeat) close(); return; }
            if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) eat();
        };
        const onClick = (ev) => {
            if (ev.target.closest('.cv-scrim')) { close(); return; }
            const row = ev.target.closest('.cv-row');
            if (row && rowsEls.includes(row)) { setFocus(rowsEls.indexOf(row)); run(row); }
        };
        const onOver = (ev) => {
            const row = ev.target.closest && ev.target.closest('.cv-row');
            if (row && rowsEls.includes(row) && row._pick && !window.HomerLayout?.isTouch?.()) setFocus(rowsEls.indexOf(row));
        };
        window.addEventListener('keydown', onKey, true);
        root.addEventListener('click', onClick);
        root.addEventListener('mouseover', onOver);
        requestAnimationFrame(() => root.classList.add('in'));

        openPicker = {
            root,
            close() {
                offChange();
                window.removeEventListener('keydown', onKey, true);
                root.remove();
                openPicker = null;
                if (typeof opts.onClose === 'function') opts.onClose();
            },
        };
        return openPicker;
    };
    const close = () => { if (openPicker) openPicker.close(); };
    const isOpen = () => !!openPicker;

    window.HomerCastVideo = {
        version: VERSION,
        ready,
        rows,
        refresh,
        onChange,
        open,
        close,
        isOpen,
        destroy() {
            close();
            stopPolling();
            listeners.clear();
        },
    };
})();
