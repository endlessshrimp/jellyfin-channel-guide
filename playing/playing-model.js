/*
 * HOMER Now Playing, the model: everything playing anywhere in the house, from
 * the three places it can be playing, as one list of cards.
 *
 *   Jellyfin   GET /Sessions every few seconds while the screen is open: every
 *              client signed in to the server, what it's playing, where it is
 *              and whether it's paused. Controlled with
 *              POST /Sessions/{id}/Playing/{Pause|Unpause|Stop|NextTrack|
 *              PreviousTrack} and POST /Sessions/{id}/Command (SetVolume,
 *              ToggleMute) — the volume commands only when the client says it
 *              takes them (SupportedCommands).
 *   The house  every media_player Home Assistant has that isn't idle, through
 *              shared/homeassistant.js (which already models artwork, volume,
 *              grouping and transport). Home Assistant pushes its state, so
 *              those cards need no polling. Speakers playing together (Sonos,
 *              WiiM multiroom) fold into one card naming the rooms.
 *              A speaker that HOMER sent an album to (music/playon.js) reports
 *              the address it was given as its title; the card uses what HOMER
 *              remembers sending instead, with the album's own cover.
 *   HOMER      the music playing in this browser tab (music/music-model.js).
 *              It's controlled directly, not through Jellyfin — and the
 *              Jellyfin session it reports is dropped, so it isn't on screen
 *              twice.
 *
 * Positions are sampled, not streamed. A card carries { position, at }: where
 * it was and when that was read, so a progress bar can run smoothly on its own
 * between samples instead of the screen asking the server every frame.
 *
 * window.HomerPlayingModel = { start, stop, cards, idle, onChange, act,
 *                              artFor, refresh, status, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerPlayingModel && typeof window.HomerPlayingModel.destroy === 'function') {
        window.HomerPlayingModel.destroy();
    }

    const TICKS = 10000000; // Jellyfin's ticks per second
    const POLL_MS = 4000; // /Sessions while the screen is open
    const SLOW_POLL_MS = 15000; // …and when the tab is in the background
    const MOCK_KEY = 'homer-ha-mock'; // DEV ONLY: the made-up house, and made-up sessions with it

    const warn = (...a) => console.warn('[HOMER Playing]', ...a);
    const mocking = () => {
        try { return localStorage.getItem(MOCK_KEY) === '1'; } catch { return false; }
    };

    // ---------- Jellyfin ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* token only */ }
        parts.push(`Token="${server.AccessToken}"`);
        return 'MediaBrowser ' + parts.join(', ');
    };
    const api = async (path, opts = {}) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, Object.assign({}, opts, {
            headers: Object.assign({ Authorization: authHeader(server) }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers)
        }));
        if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };
    const post = (path, body) => api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    const myDeviceId = () => {
        try { return window.ApiClient && window.ApiClient.deviceId ? window.ApiClient.deviceId() : ''; } catch { return ''; }
    };

    const img = (id, type, tag, h) => (id && tag ? `/Items/${id}/Images/${type}?fillHeight=${h}&fillWidth=${h}&quality=90&tag=${encodeURIComponent(tag)}` : '');
    const wide = (id, type, tag, w) => (id && tag ? `/Items/${id}/Images/${type}?maxWidth=${w}&quality=88&tag=${encodeURIComponent(tag)}` : '');

    // the best artwork for what a session is playing, and its shape
    const sessionArt = (it) => {
        const tags = it.ImageTags || {};
        if (it.Type === 'Audio') {
            const a = img(it.AlbumId, 'Primary', it.AlbumPrimaryImageTag, 520) || img(it.Id, 'Primary', tags.Primary, 520);
            if (a) return { url: a, shape: 'square' };
        }
        if (it.Type === 'Episode') {
            const s = img(it.SeriesId, 'Primary', it.SeriesPrimaryImageTag, 520);
            if (s) return { url: s, shape: 'poster' };
            const t = wide(it.ParentThumbItemId, 'Thumb', it.ParentThumbImageTag, 640);
            if (t) return { url: t, shape: 'wide' };
        }
        if (tags.Primary) return { url: img(it.Id, 'Primary', tags.Primary, 520), shape: it.Type === 'TvChannel' ? 'wide' : 'poster' };
        if (tags.Thumb) return { url: wide(it.Id, 'Thumb', tags.Thumb, 640), shape: 'wide' };
        if (it.BackdropImageTags && it.BackdropImageTags.length) {
            return { url: `/Items/${it.Id}/Images/Backdrop?maxWidth=640&quality=88&tag=${encodeURIComponent(it.BackdropImageTags[0])}`, shape: 'wide' };
        }
        return { url: '', shape: 'poster' };
    };

    // what a session is playing, in a title and a line under it
    const sessionText = (it) => {
        if (!it) return { title: '', sub: '', badge: '' };
        if (it.Type === 'Episode') {
            const num = [it.ParentIndexNumber != null ? 'S' + it.ParentIndexNumber : '', it.IndexNumber != null ? 'E' + it.IndexNumber : ''].filter(Boolean).join(' ');
            return { title: it.SeriesName || it.Name || '', sub: [num, it.Name].filter(Boolean).join(' · '), badge: 'TV' };
        }
        if (it.Type === 'Audio') {
            const artist = (it.Artists && it.Artists.join(', ')) || it.AlbumArtist || '';
            return { title: it.Name || '', sub: [artist, it.Album].filter(Boolean).join(' — '), badge: 'Music' };
        }
        if (it.Type === 'TvChannel') {
            const p = it.CurrentProgram;
            return { title: (p && p.Name) || it.Name || '', sub: p ? it.Name || '' : '', badge: 'Live TV' };
        }
        if (it.Type === 'Movie') return { title: it.Name || '', sub: it.ProductionYear ? String(it.ProductionYear) : '', badge: 'Film' };
        if (it.Type === 'AudioBook' || it.Type === 'Book') return { title: it.Name || '', sub: (it.Artists && it.Artists.join(', ')) || '', badge: 'Book' };
        return { title: it.Name || '', sub: it.SeriesName || '', badge: it.Type || '' };
    };

    // A Jellyfin session, as a card. Volume and mute only where the client
    // says it takes them; Stop, Pause/Unpause and the track skips are
    // playstate commands every client answers.
    const sessionCard = (s) => {
        const it = s.NowPlayingItem;
        const ps = s.PlayState || {};
        const cmds = s.SupportedCommands || [];
        const t = sessionText(it);
        const art = sessionArt(it);
        const live = it.Type === 'TvChannel';
        const queue = (s.NowPlayingQueue || []).length;
        const position = (ps.PositionTicks || 0) / TICKS;
        const duration = (it.RunTimeTicks || 0) / TICKS;
        return {
            key: 'jf:' + s.Id,
            kind: 'jellyfin',
            title: t.title,
            sub: t.sub,
            badge: t.badge,
            art: art.url,
            shape: art.shape,
            where: s.DeviceName || s.Client || 'A Jellyfin client',
            who: s.UserName || '',
            via: s.Client || '',
            room: '',
            icon: live ? 'live_tv' : it.Type === 'Audio' ? 'music_note' : 'movie',
            state: ps.IsPaused ? 'paused' : 'playing',
            live,
            position,
            duration: live ? 0 : duration,
            at: Date.now(),
            volume: ps.VolumeLevel != null ? ps.VolumeLevel : null,
            muted: !!ps.IsMuted,
            canPlay: true,
            canStop: true,
            canPrev: queue > 1 || it.Type === 'Audio',
            canNext: queue > 1 || it.Type === 'Audio',
            canVolume: cmds.includes('SetVolume') && ps.VolumeLevel != null,
            canMute: cmds.includes('ToggleMute') || cmds.includes('Mute'),
            remote: '',
            // most recently started first: where it is now, counted back
            started: Date.now() - position * 1000,
            _id: s.Id,
            _paused: !!ps.IsPaused
        };
    };

    const doSession = (card, what, arg) => {
        const id = card._id;
        if (what === 'play') return post(`/Sessions/${id}/Playing/${card._paused ? 'Unpause' : 'Pause'}`);
        if (what === 'stop') return post(`/Sessions/${id}/Playing/Stop`);
        if (what === 'next') return post(`/Sessions/${id}/Playing/NextTrack`);
        if (what === 'prev') return post(`/Sessions/${id}/Playing/PreviousTrack`);
        if (what === 'mute') return post(`/Sessions/${id}/Command`, { Name: 'ToggleMute' });
        if (what === 'volume') return post(`/Sessions/${id}/Command`, { Name: 'SetVolume', Arguments: { Volume: String(Math.round(arg)) } });
        return Promise.resolve();
    };

    // ---------- The house (shared/homeassistant.js) ----------

    const HA = () => window.HomerHA || null;
    const HA_STATES = { playing: 'Playing', paused: 'Paused', buffering: 'Loading', on: 'On', idle: 'Idle', off: 'Off', standby: 'Standby', unavailable: 'Unavailable' };

    // every player HOMER shows, with the room it's in
    const housePlayers = () => {
        const h = HA();
        if (!h || !h.isSetUp()) return [];
        let house;
        try { house = h.house(); } catch (err) { warn(err); return []; }
        const out = [];
        for (const room of house.rooms || []) {
            for (const id of room.media || []) out.push({ id, room: room.name });
        }
        return out;
    };

    // A player, as its card shows it. A speaker following another in a group
    // (Sonos, WiiM multiroom) doesn't get its own card: the leader's card
    // names every room in the group, and play/pause and the skips go to the
    // leader. Volume still belongs to each speaker, so the card's volume is
    // the leader's.
    const houseCard = (entry, byId) => {
        const h = HA();
        const s = h.entity(entry.id);
        const a = (s && s.attributes) || {};
        const state = s ? s.state : 'unavailable';
        const members = (Array.isArray(a.group_members) ? a.group_members : []).filter((m) => h.entity(m));
        const lead = members.length > 1 ? members[0] : null;
        if (lead && lead !== entry.id) return null; // the leader's card has it
        const can = (w) => h.supports(entry.id, w);
        const playing = state === 'playing';
        const active = state === 'playing' || state === 'paused' || state === 'buffering' || state === 'on';
        let name = h.name(entry.id, entry.room).trim();
        if (name.toLowerCase() === (entry.room || '').toLowerCase()) {
            const d = h.device(entry.id);
            if (d && (d.maker || d.model)) name = d.maker && d.maker.length <= 12 ? d.maker.replace(/\s+(inc|corp|corporation|electronics|ltd)\.?$/i, '') : d.model;
        }
        const rooms = members.length > 1
            ? members.map((m) => (byId.get(m) || {}).room || h.name(m, '')).filter((x, i, l) => x && l.indexOf(x) === i)
            : [entry.room].filter(Boolean);
        const isTv = a.device_class === 'tv' || /\btv\b/i.test(name);
        const album = a.media_album_name || '';
        const ep = a.media_season != null && a.media_episode != null ? `S${a.media_season} E${a.media_episode}` : '';
        // a show goes in the title, with the episode under it, the way the
        // Jellyfin sessions read; music keeps the track on top
        const series = a.media_series_title || '';
        let track = a.media_title || '';
        // A speaker handed one address plays it happily and then reports the
        // address as its title ("http://…/music/p/xTd3.m3u"), with no artist
        // and no cover. HOMER is the only thing that knows that address is
        // Common Sense by John Prine, so it says so: music/playon.js keeps what
        // it sent where, for as long as the NAS keeps the playlist.
        const po = window.HomerPlayOn;
        const mine = active && po && !series ? po.sent(entry.id) : null;
        const urlish = /^https?:\/\//i.test(track) || !track;
        const owned = mine && urlish ? mine : null;
        if (owned) track = owned.name || track;
        const title = series || track || (a.source && !a.app_name ? a.source : '') || a.app_name || '';
        const artist = series ? [ep, track].filter(Boolean).join(' · ')
            : owned ? owned.artist : (a.media_artist || a.media_album_artist || '');
        // where it is: Home Assistant gives the position and when it was read
        const updated = a.media_position_updated_at ? Date.parse(a.media_position_updated_at) : 0;
        const pos = a.media_position != null ? a.media_position : null;
        // most recently started first, the same way the sessions are counted back
        const changed = s && s.last_changed ? Date.parse(s.last_changed) : 0;
        const started = pos != null && updated ? updated - pos * 1000 : changed || 0;
        return {
            key: 'ha:' + entry.id,
            kind: 'ha',
            title: title || name,
            sub: (series ? artist : [artist || album].filter(Boolean).join(' · ')) || (title ? '' : HA_STATES[state] || state),
            badge: owned ? 'Music' : a.app_name || (a.media_content_type === 'music' ? 'Music' : isTv ? 'TV' : ''),
            art: (owned && owned.art) || (a.entity_picture ? h.pictureUrl(entry.id) : ''),
            shape: owned || a.media_content_type === 'music' ? 'square'
                : /tvshow|movie|episode|video/.test(a.media_content_type || '') ? 'poster' : 'wide',
            where: name,
            who: '',
            via: '',
            room: members.length > 1 ? '' : entry.room || '',
            // with no artwork the card falls back to this, so it says what
            // kind of thing is playing rather than what the box is
            icon: owned || a.media_content_type === 'music' ? 'music_note'
                : /tvshow|episode/.test(a.media_content_type || '') ? 'live_tv'
                : /movie/.test(a.media_content_type || '') ? 'movie'
                : isTv ? 'tv' : 'speaker',
            rooms,
            grouped: members.length > 1,
            state: playing ? 'playing' : state === 'paused' ? 'paused' : state === 'buffering' ? 'buffering' : 'on',
            live: false,
            position: pos != null ? (playing && updated ? pos + (Date.now() - updated) / 1000 : pos) : 0,
            duration: a.media_duration || 0,
            at: Date.now(),
            volume: a.volume_level != null ? Math.round(a.volume_level * 100) : null,
            muted: !!a.is_volume_muted,
            canPlay: active && (can('play') || can('pause')),
            canStop: active && can('stop'),
            canPrev: active && can('previous'),
            canNext: active && can('next'),
            canVolume: can('volumeSet') && a.volume_level != null,
            canStep: can('volumeStep'),
            canMute: can('mute'),
            // an Apple TV's or a Samsung TV's remote, the one Rooms already draws
            remote: h.remoteFor && h.remoteFor(entry.id) ? entry.id : '',
            started: started || Date.now(),
            _id: entry.id,
            // what's playing, for finding the same thing in Jellyfin's own
            // library when Home Assistant can't hand over a picture
            _track: track,
            _artist: a.media_artist || a.media_album_artist || '',
            _album: (owned && owned.name) || album,
            // what HOMER sent here, when it did: the Now Playing screen can
            // say "11 tracks" rather than nothing
            _sent: owned || null,
            _active: active
        };
    };

    // ---------- Artwork, once it has actually loaded ----------
    //
    // A card's `art` is the picture it would like; this is the one it gets.
    // Home Assistant's own proxy comes first (shared/homeassistant.js already
    // knows to fall back to the artwork's own address when the proxy answers
    // with something the browser can't draw — an Apple TV's covers come back
    // as HEIC, which only Safari reads). Where that leaves nothing at all and
    // the track can be named, Jellyfin's own library is asked for the same
    // album: the house is playing it, so the server usually has it. Failing
    // both, '' — and the card keeps its icon, with the track still on it.

    const jfArt = new Map(); // "artist|album|track" -> Promise<url>
    const CLEAN = (x) => String(x || '')
        .replace(/\s*[([][^)\]]*(remaster|remastered|deluxe|expanded|edition|version|mono|stereo|mix|bonus)[^)\]]*[)\]]/gi, '')
        .replace(/\s+/g, ' ').trim();
    const looselySame = (a, b) => {
        const x = CLEAN(a).toLowerCase();
        const y = CLEAN(b).toLowerCase();
        return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
    };
    const jellyfinArt = (track, artist, album) => {
        const key = [artist, album, track].join('|');
        if (!key.replace(/\|/g, '')) return Promise.resolve('');
        const had = jfArt.get(key);
        if (had) return had;
        const find = async () => {
            const server = getServer();
            if (!server) return '';
            const look = async (term, types, wantAlbum) => {
                if (!term) return '';
                const q = new URLSearchParams({
                    searchTerm: term,
                    IncludeItemTypes: types,
                    Recursive: 'true',
                    Limit: '8',
                    ImageTypeLimit: '1',
                    EnableImageTypes: 'Primary',
                    Fields: 'AlbumArtist'
                });
                const res = await api(`/Users/${server.UserId}/Items?${q}`).catch(() => null);
                const items = (res && res.Items) || [];
                // the artist has to agree where the player named one, so a
                // track called "Alone" doesn't pick up someone else's cover
                const hit = items.find((it) => {
                    const tags = it.ImageTags || {};
                    if (!tags.Primary && !it.AlbumPrimaryImageTag) return false;
                    if (artist && !(looselySame(it.AlbumArtist, artist) || (it.Artists || []).some((x) => looselySame(x, artist)))) return false;
                    if (wantAlbum && album && !looselySame(it.Name, album)) return false;
                    return true;
                });
                if (!hit) return '';
                const tags = hit.ImageTags || {};
                if (tags.Primary) return img(hit.Id, 'Primary', tags.Primary, 520);
                return img(hit.AlbumId, 'Primary', hit.AlbumPrimaryImageTag, 520);
            };
            return (await look(CLEAN(album), 'MusicAlbum', true)) || (await look(CLEAN(track), 'Audio', false));
        };
        const p = find().catch(() => '');
        jfArt.set(key, p);
        if (jfArt.size > 60) jfArt.delete(jfArt.keys().next().value);
        return p;
    };

    // artFor(card) -> Promise<url>: the picture to draw, '' for none.
    const artFor = (card) => {
        if (!card) return Promise.resolve('');
        if (card.kind !== 'ha' || card._mock) return Promise.resolve(card.art || '');
        const h = HA();
        if (!h || !h.loadPicture) return Promise.resolve(card.art || '');
        return h.loadPicture(card._id).then((url) => url || jellyfinArt(card._track, card._artist, card._album));
    };

    const doHouse = (card, what, arg) => {
        const h = HA();
        if (!h) return Promise.resolve();
        if (what === 'play') return h.playPause(card._id);
        if (what === 'stop') return h.mediaCommand(card._id, 'media_stop');
        if (what === 'next') return h.mediaCommand(card._id, 'media_next_track');
        if (what === 'prev') return h.mediaCommand(card._id, 'media_previous_track');
        if (what === 'mute') return h.mute(card._id);
        if (what === 'volume') {
            if (card.canVolume) return Promise.resolve(h.setVolume(card._id, arg / 100));
            if (card.canStep) return h.stepVolume(card._id, arg > (card.volume || 0) ? 1 : -1);
        }
        return Promise.resolve();
    };

    // ---------- HOMER's own music (music/music-model.js) ----------

    const MM = () => window.HomerMusicModel || null;

    const musicCard = () => {
        const m = MM();
        if (!m || !m.player) return null;
        let st;
        try { st = m.player.state(); } catch { return null; }
        if (!st || !st.track) return null;
        const t = st.track;
        return {
            key: 'homer:music',
            kind: 'homer',
            title: t.name || '',
            sub: [t.artist, t.album].filter(Boolean).join(' — '),
            badge: 'Music',
            art: m.art ? m.art(t, 520) : '',
            shape: 'square',
            where: 'HOMER',
            who: '',
            via: 'this browser',
            room: '',
            icon: 'music_note',
            state: st.buffering ? 'buffering' : st.playing ? 'playing' : 'paused',
            live: false,
            position: st.position || 0,
            duration: st.duration || 0,
            at: Date.now(),
            volume: Math.round((st.volume != null ? st.volume : 1) * 100),
            muted: !!st.muted,
            canPlay: true,
            canStop: true,
            canPrev: st.count > 1,
            canNext: st.count > 1,
            canVolume: true,
            canMute: true,
            remote: '',
            started: Date.now() - (st.position || 0) * 1000,
            _id: t.id
        };
    };

    const doMusic = (card, what, arg) => {
        const p = MM() && MM().player;
        if (!p) return Promise.resolve();
        if (what === 'play') p.toggle();
        else if (what === 'stop') p.stop();
        else if (what === 'next') p.next();
        else if (what === 'prev') p.prev();
        else if (what === 'mute') p.toggleMute();
        else if (what === 'volume') p.setVolume(arg / 100);
        return Promise.resolve();
    };

    // ---------- HOME-104: ambience (ambient/ambient-model.js) ----------
    //
    // Jason's report: he stopped a book and wandered through several screens
    // to Now Playing, which said nothing was playing — while ambience kept
    // going, invisible. It has no position/duration of its own (a preset
    // loops indefinitely) and nothing to skip, so its card is minimal: what
    // it is, its own volume, and Stop.

    const AM = () => window.HomerAmbientModel || null;

    let ambientSince = 0; // when the current run started, for sort order
    let ambientWasActive = false;

    const ambientCard = () => {
        const a = AM();
        if (!a) return null;
        let cur;
        try { cur = a.current(); } catch { return null; }
        if (!cur || !cur.active) { ambientWasActive = false; return null; }
        if (!ambientWasActive) { ambientWasActive = true; ambientSince = Date.now(); }
        return {
            key: 'homer:ambience',
            kind: 'ambience',
            title: 'Ambience',
            sub: cur.sourceLabel || '',
            badge: 'Ambience',
            art: '',
            shape: 'square',
            where: 'HOMER',
            who: '',
            via: 'this browser',
            room: '',
            icon: cur.sourceKind === 'radio' ? 'radio' : 'cloud',
            state: 'playing',
            live: false,
            position: 0,
            duration: 0,
            at: Date.now(),
            volume: Math.round((cur.ambientVolume != null ? cur.ambientVolume : 1) * 100),
            muted: false,
            canPlay: false,
            canStop: true,
            canPrev: false,
            canNext: false,
            canVolume: true,
            canMute: false,
            remote: '',
            started: ambientSince,
            _id: 'ambience',
        };
    };

    const doAmbient = (card, what, arg) => {
        const a = AM();
        if (!a) return Promise.resolve();
        if (what === 'stop') a.stop();
        else if (what === 'volume') a.setAmbientVolume(arg / 100);
        return Promise.resolve();
    };

    // ---------- Made-up sessions, for screenshots ----------
    // DEV ONLY, with the made-up house (localStorage['homer-ha-mock'] = '1'):
    // Jellyfin's real sessions are whatever the family is watching, which is
    // no good in a screenshot. These stand in for them.

    const MOCK_ART = (a, b, text) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
            <rect width="400" height="400" fill="url(#g)"/>
            <text x="200" y="215" font-family="Barlow, sans-serif" font-size="34" font-weight="800" fill="rgba(255,255,255,.92)" text-anchor="middle" letter-spacing="3">${text}</text>
        </svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/\s+/g, ' '));
    };
    const mockStart = Date.now();
    const mockSessions = () => {
        const on = (mins) => mockStart - mins * 60000;
        return [
            {
                key: 'jf:mock-den', kind: 'jellyfin', title: 'Andor', sub: 'S2 E4 · Ever Been to Ghorman?',
                badge: 'TV', art: MOCK_ART('#2b4a6f', '#0d1a2c', 'ANDOR'), shape: 'poster',
                where: 'Den Shield', who: 'Jason', via: 'Jellyfin Android TV',
                state: 'playing', live: false, position: 18 * 60 + 12, duration: 47 * 60, at: Date.now(),
                volume: 62, muted: false, canPlay: true, canStop: true, canPrev: false, canNext: false,
                canVolume: true, canMute: true, remote: '', started: on(18), _id: 'mock-den', _paused: false, _mock: true
            },
            {
                key: 'jf:mock-ipad', kind: 'jellyfin', title: 'The Thin Man', sub: '1934',
                badge: 'Film', art: MOCK_ART('#6b4a2b', '#20140c', 'THE THIN MAN'), shape: 'poster',
                where: 'iPad', who: 'Guest', via: 'Jellyfin iOS',
                state: 'paused', live: false, position: 52 * 60 + 40, duration: 91 * 60, at: Date.now(),
                volume: 40, muted: false, canPlay: true, canStop: true, canPrev: false, canNext: false,
                canVolume: true, canMute: true, remote: '', started: on(64), _id: 'mock-ipad', _paused: true, _mock: true
            },
            {
                key: 'jf:mock-office', kind: 'jellyfin', title: 'Monday Night Football', sub: 'ESPN HD',
                badge: 'Live TV', art: MOCK_ART('#1f5c3a', '#07160f', 'ESPN HD'), shape: 'wide',
                where: 'Office Mac', who: 'Jason', via: 'Jellyfin Web',
                state: 'playing', live: true, position: 41 * 60, duration: 0, at: Date.now(),
                volume: 25, muted: true, canPlay: true, canStop: true, canPrev: false, canNext: false,
                canVolume: true, canMute: true, remote: '', started: on(41), _id: 'mock-office', _paused: false, _mock: true
            }
        ];
    };

    // ---------- Putting them together ----------

    let sessions = []; // the last /Sessions answer, as cards
    let error = '';
    let running = false;
    let timer = null;
    let offHA = () => {};
    let offMusic = () => {};
    let offAmbient = () => {};
    let inFlight = false;

    const emitters = new Set();
    const emit = () => emitters.forEach((fn) => {
        try { fn(); } catch (err) { warn(err); }
    });
    const onChange = (fn) => {
        emitters.add(fn);
        return () => emitters.delete(fn);
    };

    const poll = async () => {
        if (inFlight || !running) return;
        if (mocking()) { sessions = mockSessions(); error = ''; emit(); return; }
        inFlight = true;
        try {
            const list = await api('/Sessions');
            const mine = myDeviceId();
            const musicOn = !!musicCard();
            sessions = (Array.isArray(list) ? list : [])
                .filter((s) => s && s.NowPlayingItem)
                // HOMER's own music reports to Jellyfin from this very tab; it
                // has its own card, so don't show it twice
                .filter((s) => !(musicOn && s.DeviceId === mine && s.NowPlayingItem.Type === 'Audio'))
                .map(sessionCard);
            error = '';
        } catch (err) {
            error = err && err.message ? err.message : 'Jellyfin didn\'t answer';
            warn(err);
        } finally {
            inFlight = false;
            emit();
        }
    };

    const schedule = () => {
        clearTimeout(timer);
        if (!running) return;
        timer = setTimeout(() => {
            poll().finally(schedule);
        }, document.hidden ? SLOW_POLL_MS : POLL_MS);
    };

    // cards(): what's playing, most recently started first
    const cards = () => {
        const byId = new Map(housePlayers().map((p) => [p.id, p]));
        const house = [];
        for (const entry of byId.values()) {
            const c = houseCard(entry, byId);
            if (c && c._active) house.push(c);
        }
        const music = musicCard();
        const ambient = ambientCard();
        const all = sessions.concat(house, music ? [music] : [], ambient ? [ambient] : []);
        all.sort((a, b) => (b.started || 0) - (a.started || 0));
        return all;
    };

    // What to call a player in the strip: its room and its name, without
    // saying the room twice. "Bedroom" in the Master Bedroom is the Master
    // Bedroom; "Wiim" in the Living Room is the Living Room Wiim.
    const placeName = (room, name) => {
        const r = String(room || '').toLowerCase();
        const n = String(name || '').toLowerCase();
        if (!r) return name;
        if (r === n || r.endsWith(' ' + n)) return room;
        if (n.includes(r)) return name;
        return room + ' ' + name;
    };

    // idle(): the players that are there but not playing anything — a quiet
    // strip at the bottom rather than a card each. A player its integration
    // can't reach isn't ready, so it's counted, not named.
    const idle = () => {
        const byId = new Map(housePlayers().map((p) => [p.id, p]));
        const out = [];
        for (const entry of byId.values()) {
            const c = houseCard(entry, byId);
            if (!c || c._active) continue;
            // the raw state, not the card's: a card calls everything that
            // isn't playing or paused "on"
            const raw = HA().entity(entry.id);
            const st = raw ? raw.state : 'unavailable';
            out.push({
                id: entry.id, name: c.where, room: entry.room,
                label: placeName(entry.room, c.where),
                state: st, away: st === 'unavailable', text: HA_STATES[st] || st
            });
        }
        out.sort((a, b) => Number(a.away) - Number(b.away) || a.label.localeCompare(b.label));
        return out;
    };

    // act(card, what[, arg]): 'play' | 'stop' | 'next' | 'prev' | 'mute' |
    // 'volume' (0–100). Answers when the command has gone; the card's own
    // source says when the state catches up.
    const act = (card, what, arg) => {
        if (!card) return Promise.resolve();
        if (card._mock) return Promise.resolve(); // the made-up house: nothing to send
        const run = card.kind === 'jellyfin' ? doSession : card.kind === 'ha' ? doHouse : card.kind === 'ambience' ? doAmbient : doMusic;
        let p;
        try { p = run(card, what, arg); } catch (err) { p = Promise.reject(err); }
        return Promise.resolve(p).then(() => {
            // Jellyfin has no push: ask again straight away so the card catches up
            if (card.kind === 'jellyfin' && running) setTimeout(poll, 400);
            emit();
        }).catch((err) => {
            warn('control failed', card.key, what, err && err.message);
            emit();
            throw err;
        });
    };

    const onVisible = () => { if (running) { schedule(); if (!document.hidden) poll(); } };

    const start = () => {
        if (running) return;
        running = true;
        const h = HA();
        // Home Assistant pushes; the music tells us when it changes
        offHA = h && h.onChange ? h.onChange(emit) : () => {};
        offMusic = MM() && MM().onChange ? MM().onChange(emit) : () => {};
        offAmbient = AM() && AM().onChange ? AM().onChange(emit) : () => {};
        document.addEventListener('visibilitychange', onVisible);
        poll();
        schedule();
    };
    const stop = () => {
        if (!running) return;
        running = false;
        clearTimeout(timer);
        timer = null;
        offHA();
        offMusic();
        offAmbient();
        offHA = offMusic = offAmbient = () => {};
        document.removeEventListener('visibilitychange', onVisible);
    };

    window.HomerPlayingModel = {
        version: VERSION,
        start,
        stop,
        cards,
        idle,
        act,
        artFor,
        onChange,
        refresh: poll,
        status: () => ({ running, error, sessions: sessions.length, mock: mocking() }),
        destroy() {
            stop();
            emitters.clear();
            sessions = [];
        }
    };
})();
