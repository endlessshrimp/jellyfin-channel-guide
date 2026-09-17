/*
 * HOMER "Play on…": send an album to a speaker in the house instead of playing
 * it in this browser tab. Shared by the Music screen (music/music.js), its
 * phone layout (music/music-phone.js) and anything else that lists an album.
 *
 * The problem this solves: Home Assistant's media_player.play_media takes ONE
 * item, and an album is eleven. Every family of player answers that
 * differently, so HOMER asks each one the way it actually works — and says on
 * its row what it will really do, rather than quietly playing one song.
 *
 * What HOMER hands over (`via`):
 *
 *   playlist  One address with the whole album behind it. HOMER's NAS helper
 *             (homerfeeds, /music/playlist) mints a short-lived M3U of the
 *             album's Jellyfin streams.
 *   enqueue   The first track, then the rest added behind it — for an
 *             integration that advertises MEDIA_ENQUEUE and that HOMER hasn't
 *             met before.
 *   track     One track's address.
 *
 * …and what the player then does with it (`plays`), which is the part the row
 * has to be honest about. Sent the same M3U, a WiiM plays all eleven tracks
 * and a Chromecast plays the first one and stops, so both take `via:
 * 'playlist'` and only one of them says "the whole album".
 *
 * The Jellyfin token never leaves the NAS: the helper holds it and hands back
 * opaque addresses (/music/p/<key>.m3u, /music/t/<key>/<n>.mp3, a 302 to
 * Jellyfin). A token in media_content_id would land in Home Assistant's
 * logbook, its recorder and every debug log that repeats a service call.
 *
 * A speaker playing a URL mostly reports the URL as its title, so HOMER
 * remembers what it sent where (sent()); Now Playing uses that to name the
 * album and draw its cover.
 *
 * The picker itself is one list: "This screen" first, then every Home
 * Assistant player that can take music, the rooms of a grouped set folded into
 * one row. Arrows and OK, mouse, or a thumb. The device last used is
 * remembered per HOMER device and starts focused.
 *
 * Radio uses the same picker in a second mode (`opts.station`). A station is
 * not an album and needs none of the M3U machinery: Music Assistant takes a
 * stream address as a station and fetches it itself, so the list there is
 * Music Assistant's own players (music/radio-model.js speakers()) and the row
 * says which room is already playing something.
 *
 * window.HomerPlayOn = { ready, devices, last, setLast, send, sent, forget,
 *                        open, close, isOpen, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerPlayOn && typeof window.HomerPlayOn.destroy === 'function') {
        window.HomerPlayOn.destroy();
    }

    const LAST_KEY = 'homer-playon-last'; // the device picked last, on this HOMER device
    const SENT_KEY = 'homer-playon-sent'; // entity id -> what HOMER put there
    const SENT_TTL = 12 * 3600 * 1000; // as long as the helper keeps a playlist
    const MAX_TRACKS = 500;
    const HERE = '__here__'; // "This screen": HOMER's own player

    const HA = () => window.HomerHA || null;
    const warn = (...a) => console.warn('[HOMER Play on]', ...a);

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };

    // ---------- Jellyfin, and HOMER's helper on the NAS ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };
    const deviceId = () => {
        try {
            const ac = window.ApiClient;
            if (ac && ac.deviceId) return ac.deviceId();
        } catch { /* below */ }
        return 'homer-playon';
    };
    // the helper: through the https name's /homer-feeds, or port 8095 on the
    // LAN (the same rule shared/arr.js and the news hub use)
    const helper = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');

    // Mint one album's worth of addresses. `profile` is 'speaker' (hand the
    // file over as it is) or 'mp3' (make Jellyfin transcode), because Sonos and
    // an Apple TV are fussier than a WiiM.
    const mint = async (item, tracks, profile) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in to Jellyfin');
        const body = {
            name: [item && item.artist, item && item.name].filter(Boolean).join(' — '),
            profile: profile || 'speaker',
            userId: server.UserId,
            token: server.AccessToken,
            deviceId: deviceId(),
            tracks: tracks.slice(0, MAX_TRACKS).map((t) => ({
                id: t.id, name: t.name, artist: t.artist || t.albumArtist || '', duration: Math.round(t.duration || 0),
            })),
        };
        const res = await fetch(helper() + '/music/playlist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const out = await res.json().catch(() => null);
        if (!res.ok || !out || !out.url) throw new Error((out && out.error) || `The NAS helper said ${res.status}`);
        return out;
    };

    // ---------- Who can take music, and how ----------

    const ENQUEUE = 2097152; // MediaPlayerEntityFeature.MEDIA_ENQUEUE
    const PLAY_MEDIA = 512;

    // What each integration actually did when HOMER sent it an album:
    //
    //   linkplay  a WiiM plays a whole M3U, and direct-plays the files. It
    //             treats the lot as one long stream and reports the address as
    //             its title, which is why sent() exists.
    //   sonos     refuses a plain M3U (UPnP error 800), and its MEDIA_ENQUEUE
    //             is a lie for a plain URL: eleven "add" calls left a queue of
    //             one. Prefixed x-rincon-mp3radio:// it goes to Sonos's radio
    //             player, which DOES read an M3U — queue_size 11. It wants MP3:
    //             handed FLAC it skipped through the album in seconds.
    //   cast      Home Assistant reads the M3U itself and casts the first entry
    //             (with its #EXTINF name, so the metadata is good). One track.
    //   apple_tv  no MEDIA_ENQUEUE, and AirPlay takes one URL. One track.
    //   samsungtv play_media is for launching apps, not for music.
    const FAMILY = {
        linkplay: { via: 'playlist', plays: 'all', profile: 'speaker' },
        sonos: { via: 'playlist', plays: 'all', profile: 'mp3', prefix: 'x-rincon-mp3radio://' },
        dlna_dmr: { via: 'playlist', plays: 'all', profile: 'mp3' },
        upnp: { via: 'playlist', plays: 'all', profile: 'mp3' },
        cast: { via: 'playlist', plays: 'one', profile: 'mp3' },
        apple_tv: { via: 'track', plays: 'one', profile: 'mp3' },
        samsungtv: { via: 'none' },
        webostv: { via: 'none' },
        androidtv: { via: 'none' },
    };
    const planFor = (id) => {
        const h = HA();
        const known = FAMILY[h.platform(id)];
        if (known) return known;
        // an integration HOMER hasn't met: believe what it advertises, and
        // fall back to one track if it turns out not to mean it
        if (h.supports(id, ENQUEUE)) return { via: 'enqueue', plays: 'all', profile: 'mp3' };
        return { via: 'playlist', plays: 'all', profile: 'mp3' };
    };
    const noteFor = (how) => (how.via === 'none' ? "Won't take music"
        : how.plays !== 'all' ? 'The first track only'
            : how.via === 'enqueue' ? 'The whole album, queued'
                : 'The whole album');

    const isTv = (id, name) => {
        const a = (HA().entity(id) || { attributes: {} }).attributes;
        return a.device_class === 'tv' || /\btv\b/i.test(name || '');
    };

    // Everything HOMER could send an album to, in room order, a grouped set of
    // speakers folded into the one row that leads it.
    const devices = () => {
        const h = HA();
        if (!h || !h.isSetUp || !h.isSetUp()) return [];
        let house;
        try { house = h.house(); } catch (err) { warn(err); return []; }
        const roomOf = new Map();
        for (const room of house.rooms || []) for (const id of room.media || []) roomOf.set(id, room.name);
        const out = [];
        for (const [id, room] of roomOf) {
            const s = h.entity(id);
            if (!s) continue;
            const a = s.attributes || {};
            if (!h.supports(id, PLAY_MEDIA)) continue; // it can't take media at all
            const members = (Array.isArray(a.group_members) ? a.group_members : []).filter((m) => h.entity(m));
            if (members.length > 1 && members[0] !== id) continue; // the leader's row has it
            let name = h.name(id, room).trim();
            if (name.toLowerCase() === String(room || '').toLowerCase()) {
                const d = h.device(id);
                const maker = d && d.maker ? d.maker.replace(/\s+(inc|corp|corporation|electronics|ltd)\.?$/i, '').trim() : '';
                if (d && (maker || d.model)) name = maker && maker.length <= 12 ? maker : d.model;
            }
            const rooms = members.length > 1
                ? members.map((m) => roomOf.get(m) || h.name(m, '')).filter((x, i, l) => x && l.indexOf(x) === i)
                : [room].filter(Boolean);
            const how = planFor(id);
            const note = noteFor(how);
            const tv = isTv(id, name);
            out.push({
                id,
                name,
                room: room || '',
                rooms,
                label: rooms.length > 1 ? rooms.join(' + ') : [room, name].filter(Boolean).join(' · '),
                members: members.length > 1 ? members : [],
                via: how.via,
                plays: how.plays || 'one',
                prefix: how.prefix || '',
                profile: how.profile || 'mp3',
                note,
                platform: h.platform(id) || '',
                state: s.state,
                away: s.state === 'unavailable',
                // in use, so sending would cut across whoever is listening —
                // a paused Apple TV is still somebody's album
                busy: s.state === 'playing' || s.state === 'paused',
                tv,
                icon: rooms.length > 1 ? 'speaker_group' : tv ? 'tv' : 'speaker',
            });
        }
        out.sort((a, b) => Number(a.away) - Number(b.away)
            || Number(a.via === 'none') - Number(b.via === 'none')
            || a.label.localeCompare(b.label));
        return out;
    };
    const ready = () => devices().some((d) => d.via !== 'none' && !d.away);

    // ---------- What HOMER put where ----------
    //
    // A speaker handed a URL usually reports the URL as its title, so the only
    // place that knows this is "Common Sense by John Prine" is HOMER.

    const readSent = () => {
        const all = store.get(SENT_KEY, {}) || {};
        const now = Date.now();
        let changed = false;
        for (const k of Object.keys(all)) {
            if (!all[k] || now - (all[k].at || 0) > SENT_TTL) { delete all[k]; changed = true; }
        }
        if (changed) store.set(SENT_KEY, all);
        return all;
    };
    const sent = (entityId) => {
        const all = readSent();
        return entityId ? all[entityId] || null : all;
    };
    const remember = (entityId, item, count, how) => {
        const all = readSent();
        all[entityId] = {
            at: Date.now(),
            id: item && item.id,
            kind: (item && item.kind) || 'album',
            name: (item && item.name) || '',
            artist: (item && (item.artist || item.albumArtist)) || '',
            art: (window.HomerMusicModel && item) ? window.HomerMusicModel.art(item, 480) : '',
            count,
            how,
        };
        store.set(SENT_KEY, all);
    };
    const forget = (entityId) => {
        const all = readSent();
        if (!all[entityId]) return;
        delete all[entityId];
        store.set(SENT_KEY, all);
    };

    // ---------- Sending ----------

    const last = () => store.get(LAST_KEY, '') || '';
    const setLast = (id) => store.set(LAST_KEY, id || '');

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // send(device, item, tracks) -> { how: 'album' | 'queued' | 'one', count, partial }
    // `how` is what actually happened, not what was hoped for: a player that
    // refuses a playlist gets the first track instead, and says so.
    const send = async (device, item, tracks) => {
        const h = HA();
        if (!h) throw new Error('Home Assistant is not connected');
        if (!device || !device.id) throw new Error('No player');
        if (!tracks || !tracks.length) throw new Error('Nothing to play');
        const list = tracks.slice(0, MAX_TRACKS);
        const minted = await mint(item, list, device.profile);
        const one = async () => {
            await h.playMedia(device.id, minted.track, 'music');
            return { how: 'one', count: 1, partial: list.length > 1 };
        };
        const playlist = async () => {
            // Sonos only reads an M3U through its radio player, which is what
            // the x-rincon-mp3radio:// prefix asks for.
            await h.playMedia(device.id, (device.prefix || '') + minted.url, 'music');
            return device.plays === 'all'
                ? { how: 'album', count: minted.count, partial: false }
                // a Chromecast reads the playlist and takes the first entry
                : { how: 'one', count: 1, partial: list.length > 1 };
        };
        const enqueue = async () => {
            await h.playMedia(device.id, minted.tracks[0], 'music', { enqueue: 'replace' });
            let queued = 1;
            for (let i = 1; i < minted.tracks.length; i++) {
                try {
                    await h.playMedia(device.id, minted.tracks[i], 'music', { enqueue: 'add' });
                    queued += 1;
                } catch (err) {
                    warn('enqueue stopped at', i, err && err.message);
                    break;
                }
                await sleep(120); // a queue this fast makes Sonos drop items
            }
            return { how: queued > 1 ? 'queued' : 'one', count: queued, partial: queued < list.length };
        };

        const order = device.via === 'playlist' ? [playlist, one]
            : device.via === 'enqueue' ? [enqueue, one]
                : [one];
        let lastErr = null;
        for (const attempt of order) {
            try {
                const out = await attempt();
                remember(device.id, item, out.count, out.how);
                setLast(device.id);
                return out;
            } catch (err) {
                lastErr = err;
                warn(device.id, err && err.message);
            }
        }
        throw lastErr || new Error('The player refused it');
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

    const RADIO = () => window.HomerRadioModel || null;

    // open(host, opts) — opts: { item, tracks, tv, onHere, onPick, onNowPlaying,
    //                            onDone, onClose, toast }
    //                    or, for a radio station: { station, tv, onHere, … }
    const open = (host, opts = {}) => {
        close();
        const station = opts.station || null;
        const root = el('div', `po-root${opts.tv ? ' po-tv' : ' po-phone'}${station ? ' po-radio' : ''}`);
        root.innerHTML = `
            <div class="po-scrim"></div>
            <div class="po-sheet" role="dialog" aria-label="Play on">
                <div class="po-head">
                    <div class="po-title">Play on…</div>
                    <div class="po-sub">${esc(station ? station.name : opts.item ? opts.item.name : '')}</div>
                </div>
                <div class="po-list"></div>
                <div class="po-foot"></div>
            </div>`;
        (host || document.body).appendChild(root);

        const list = root.querySelector('.po-list');
        const foot = root.querySelector('.po-foot');
        const rows = [];
        let focused = -1;
        let busy = false;

        const addRow = (key, glyph, title, note, run, opts2 = {}) => {
            const row = el('div', `po-row${opts2.dim ? ' dim' : ''}${opts2.off ? ' off' : ''}`, `
                <span class="po-ic">${icon(glyph)}</span>
                <span class="po-text"><b>${esc(title)}</b><i>${esc(note)}</i></span>
                ${opts2.chip ? `<span class="po-chip">${esc(opts2.chip)}</span>` : ''}`);
            row.dataset.key = key;
            row._run = run;
            row._pick = !opts2.off;
            list.appendChild(row);
            rows.push(row);
            return row;
        };

        const setFocus = (i) => {
            if (!rows.length) return;
            const n = rows.length;
            let k = ((i % n) + n) % n;
            let guard = 0;
            while (!rows[k]._pick && guard++ < n) k = (k + 1) % n;
            rows.forEach((r, j) => r.classList.toggle('focus', j === k));
            focused = k;
            const r = rows[k];
            if (r.offsetTop < list.scrollTop) list.scrollTo({ top: Math.max(0, r.offsetTop - 8), behavior: 'smooth' });
            else if (r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight) {
                list.scrollTo({ top: r.offsetTop + r.offsetHeight - list.clientHeight + 8, behavior: 'smooth' });
            }
        };
        const say = (text, err) => {
            if (typeof opts.toast === 'function') opts.toast(text, err);
            const note = root.querySelector('.po-said') || (() => {
                const e = el('div', 'po-said');
                foot.parentNode.insertBefore(e, foot);
                return e;
            })();
            note.textContent = text;
            note.classList.toggle('err', !!err);
        };
        const run = (row) => {
            if (busy || !row || !row._pick || typeof row._run !== 'function') return;
            row._run(row);
        };

        // "This screen" first: the thing the button was next to.
        addRow(HERE, 'cast_connected', 'This screen', 'HOMER, in this browser', () => {
            close();
            if (typeof opts.onHere === 'function') opts.onHere();
        }, { chip: last() === HERE ? 'Last used' : '' });

        if (station) {
            const R = RADIO();
            const here = R ? R.playUrl(station) : { url: '' };
            const hereRow = rows[0];
            if (!here.url && !here.pending) {
                hereRow._pick = false;
                hereRow.classList.add('off', 'dim');
                hereRow.querySelector('.po-text i').textContent = 'This browser can\u2019t play it \u2014 a speaker still can';
            } else if (here.proxied) {
                hereRow.querySelector('.po-text i').textContent = 'HOMER, relayed through the NAS helper';
            }
            const spk = R ? R.speakers() : [];
            if (!HA() || !HA().isSetUp || !HA().isSetUp()) {
                addRow('none', 'home', 'No speakers yet', 'Connect Home Assistant in Settings', null, { off: true, dim: true });
            } else if (!spk.length) {
                addRow('none', 'speaker', 'No Music Assistant players',
                    'Radio goes out through Music Assistant, and it has none here', null, { off: true, dim: true });
            }
            spk.forEach((d) => {
                const bits = [];
                if (d.group) bits.push(d.members.length ? `a group of ${d.members.length + 1}` : 'a group');
                else if (d.withNames && d.withNames.length) bits.push(`with ${d.withNames.join(' and ')}`);
                if (d.away) bits.push('not reachable');
                else if (d.busy) bits.push(d.playing ? `playing ${d.playing}` : d.state === 'playing' ? 'playing now' : 'paused mid-something');
                else bits.push('ready');
                addRow(d.id, d.icon, d.name, bits.join(' · '), (row) => {
                    busy = true;
                    row.classList.add('busy');
                    say(`Tuning ${d.name} to ${station.name}…`);
                    RADIO().sendTo(d, station)
                        .then(() => {
                            busy = false;
                            row.classList.remove('busy');
                            setLast(d.id);
                            say(`${station.name} on ${d.name}`);
                            if (typeof opts.onDone === 'function') opts.onDone(d, { how: 'radio' });
                            setTimeout(() => close(), 1100);
                        })
                        .catch((err) => {
                            busy = false;
                            row.classList.remove('busy');
                            say(`${d.name} refused it: ${err.message}`, true);
                        });
                }, { off: d.away, dim: d.away, chip: last() === d.id ? 'Last used' : '' });
            });
        }
        const all = station ? [] : devices();
        if (station) { /* handled above */ }
        else if (!HA() || !HA().isSetUp || !HA().isSetUp()) {
            addRow('none', 'home', 'No speakers yet', 'Connect Home Assistant in Settings', null, { off: true, dim: true });
        } else if (!all.length) {
            addRow('none', 'speaker', 'No speakers', 'Nothing here takes music', null, { off: true, dim: true });
        }
        all.forEach((d) => {
            const bits = [d.note];
            if (d.away) bits.push('not reachable');
            else if (d.busy) bits.push(d.state === 'playing' ? 'playing now' : 'paused mid-something');
            if (d.members.length > 1) bits.push(`${d.members.length} speakers`);
            addRow(d.id, d.icon, d.label, bits.join(' · '), (row) => {
                busy = true;
                row.classList.add('busy');
                say(`Sending to ${d.label}…`);
                send(d, opts.item, opts.tracks || [])
                    .then((out) => {
                        busy = false;
                        row.classList.remove('busy');
                        const what = out.how === 'album' ? `Playing ${opts.item ? opts.item.name : 'the album'} on ${d.label}`
                            : out.how === 'queued' ? `${out.count} tracks queued on ${d.label}`
                                : `First track only on ${d.label}`;
                        say(what, out.how === 'one' && out.partial);
                        if (typeof opts.onDone === 'function') opts.onDone(d, out);
                        setTimeout(() => close(), out.how === 'one' && out.partial ? 2200 : 1100);
                    })
                    .catch((err) => {
                        busy = false;
                        row.classList.remove('busy');
                        say(`${d.label} refused it: ${err.message}`, true);
                    });
            }, { off: d.via === 'none' || d.away, dim: d.via === 'none' || d.away, chip: last() === d.id ? 'Last used' : '' });
        });

        foot.innerHTML = '';
        const np = el('div', 'po-foot-btn', `${icon('graphic_eq')}<span>Now Playing</span>`);
        np.onclick = () => { close(); if (typeof opts.onNowPlaying === 'function') opts.onNowPlaying(); };
        foot.appendChild(np);
        const hint = el('div', 'po-hint', station
            ? 'Music Assistant fetches the station itself, so http and https both work out there.'
            : 'What each one can do is on its line.');
        foot.appendChild(hint);

        // start on the one used last, or the first that can be picked
        const want = last();
        const at = rows.findIndex((r) => r.dataset.key === want && r._pick);
        setFocus(at >= 0 ? at : 0);

        const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const k = ev.key;
            const eat = () => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
            if (k === 'ArrowDown') { eat(); setFocus(focused + 1); return; }
            if (k === 'ArrowUp') { eat(); setFocus(focused - 1); return; }
            if (k === 'Enter' || k === ' ') { eat(); if (!ev.repeat) run(rows[focused]); return; }
            if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(k)) { eat(); if (!ev.repeat) close(); return; }
            if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) eat();
        };
        const onClick = (ev) => {
            if (ev.target.closest('.po-scrim')) { close(); return; }
            const row = ev.target.closest('.po-row');
            if (row && rows.includes(row)) {
                setFocus(rows.indexOf(row));
                run(row);
            }
        };
        const onOver = (ev) => {
            const row = ev.target.closest && ev.target.closest('.po-row');
            if (row && rows.includes(row) && row._pick && !window.HomerLayout?.isTouch?.()) setFocus(rows.indexOf(row));
        };
        window.addEventListener('keydown', onKey, true);
        root.addEventListener('click', onClick);
        root.addEventListener('mouseover', onOver);
        requestAnimationFrame(() => root.classList.add('in'));

        openPicker = {
            root,
            close() {
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

    window.HomerPlayOn = {
        version: VERSION,
        HERE,
        ready,
        devices,
        last,
        setLast,
        send,
        sent,
        forget,
        open,
        close,
        isOpen,
        destroy() { close(); },
    };
})();
