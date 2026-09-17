/*
 * HOMER Music for Jellyfin Web: your own music on the TV, on the same
 * 1080-tall stage as the other HOMER screens. HOMER's own page at #/music
 * (Home's Music item).
 *
 *   Browse     a hero for whatever the focus is on — its cover big, who it's
 *              by, and Play / Shuffle / Instant Mix — over a wall of album art
 *              in six rows of tabs: Recently Added, Artists, Albums, Songs,
 *              Playlists, Genres.
 *   Album      one album or playlist: the cover large and every track, with
 *              the one playing lit. OK on a track starts there.
 *
 * Play on… (music/playon.js) sits beside Play / Shuffle / Instant Mix: it
 * sends the album to a speaker in the house through Home Assistant instead of
 * playing it in this tab, and says on each device's row what that device can
 * actually take. It only appears when Home Assistant is connected.
 *   Artist     one artist or genre: their albums, and Play all / Shuffle /
 *              Instant Mix for the lot.
 *   Radio      a tab of its own: internet radio, which isn't in Jellyfin at
 *              all. SomaFM with its artwork, the local Dallas stations, a
 *              search across Radio Browser, and the stations starred here.
 *              A station plays in HOMER through the same player, or goes to a
 *              speaker through Music Assistant. music/radio-model.js has the
 *              data and says plainly what each source can and can't tell you.
 *   Playing    what's playing: the cover, the track, the artist and album,
 *              where you are, what's next, and the lyrics — the line you're on
 *              lit and scrolling, when the file has timings.
 *
 * Data and the player: music/music-model.js (HomerMusicModel). The player is
 * the model's, not this screen's, so leaving Music does NOT stop the music:
 * music/music-strip.js shows it in the corner of every other screen. A video
 * starting pauses the music; starting music stops HOMER's video.
 *
 * #/music?np=1 opens Now playing; #/music?album=<id> opens that album.
 *
 * A star sits on every track — on a list, on an album, in the queue and on Now
 * playing — and on an album's own header. It is Jellyfin's favourite, not
 * HOMER's, so it is the same star in every other Jellyfin client. F toggles
 * whatever the focus is on; the Favorites tab is the tracks with one.
 *
 * Remote/keyboard: arrows move, OK selects, Esc/Backspace goes back a view
 * (then back a screen), H goes Home. Space or P plays and pauses anywhere on
 * the screen, N and B (and the media keys) change track, S shuffles, R cycles
 * repeat, I starts an Instant Mix from whatever the focus is on, F stars it,
 * + and − are the volume.
 *
 * On a phone (shared/layout.js) Music draws music/music-phone.js instead.
 *
 * window.HomerMusic = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerMusic && typeof window.HomerMusic.destroy === 'function') {
        window.HomerMusic.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="music/music.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/music\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'music/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const M = () => window.HomerMusicModel;
    const RM = () => window.HomerRadioModel || null;

    // Every tab the screen can draw. Which of them it actually shows depends
    // on the address: #/music is the library (everything but Radio) and
    // #/radio is Radio on its own screen. One screen, two faces — the radio
    // model, its favourites, "Play on…" and the now-playing strip are the same
    // code either way.
    const ALL_TABS = [
        { id: 'radio', label: 'Radio', radio: true, list: () => (RM() ? RM().soma().concat(RM().local()) : []) },
        { id: 'recent', label: 'Recently Added', list: () => M().recent() },
        { id: 'artists', label: 'Artists', list: () => M().artists() },
        { id: 'albums', label: 'Albums', list: () => M().albums() },
        { id: 'songs', label: 'Songs', list: () => M().songs() },
        { id: 'favorites', label: 'Favorites', list: () => M().favorites() },
        { id: 'playlists', label: 'Playlists', list: () => M().playlists() },
        { id: 'genres', label: 'Genres', list: () => M().genres() },
    ];

    // ---------- HomerPlayer (optional) ----------

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Music]', err); return fallback; }
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
        if (docked() && typeof p.back === 'function') { p.back(); return; }
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

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };

    // ---------- Pieces both layouts draw ----------

    // A cover, or its initials when Jellyfin hasn't got one
    const artImg = (it, h, cls) => {
        const url = M().art(it, h);
        if (url) return `<img class="${cls || ''}" src="${esc(url)}" alt="" draggable="false">`;
        const name = (it && it.name) || '';
        const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
        return `<div class="${cls || ''} mu-noart" data-kind="${esc((it && it.kind) || '')}"><span>${esc(initials || '♪')}</span></div>`;
    };
    // "2026 · 12 tracks · 47 m"
    const metaOf = (it) => {
        if (!it) return [];
        const f = M().fmt;
        const bits = [];
        if (it.kind === 'album') {
            if (it.year) bits.push(String(it.year));
            if (it.tracks) bits.push(f.plural(it.tracks, 'track'));
            if (it.duration) bits.push(f.len(it.duration));
            (it.genres || []).slice(0, 2).forEach((g) => bits.push(g));
        } else if (it.kind === 'track') {
            if (it.album) bits.push(it.album);
            if (it.year) bits.push(String(it.year));
            if (it.duration) bits.push(f.clock(it.duration));
        } else if (it.kind === 'artist') {
            const n = M().albums().filter((a) => a.artist === it.name).length;
            if (n) bits.push(f.plural(n, 'album'));
        } else if (it.kind === 'playlist' || it.kind === 'genre') {
            if (it.tracks) bits.push(f.plural(it.tracks, 'track'));
            if (it.duration) bits.push(f.len(it.duration));
        } else if (it.kind === 'station') {
            if (it.sub) bits.push(it.sub);
            if (it.codec) bits.push(it.bitrate ? `${it.codec} ${it.bitrate}k` : String(it.codec).toUpperCase());
            if (it.listeners) bits.push(f.plural(it.listeners, 'listener'));
        }
        return bits;
    };
    const subOf = (it) => {
        if (!it) return '';
        if (it.kind === 'station') return it.source === 'soma' ? 'SomaFM' : it.local ? 'Local radio' : 'Radio';
        if (it.kind === 'album') return it.artist || '';
        if (it.kind === 'track') return it.artists.join(', ') || it.artist || '';
        if (it.kind === 'artist') return 'Artist';
        if (it.kind === 'playlist') return 'Playlist';
        if (it.kind === 'genre') return 'Genre';
        return '';
    };

    // ---------- The screen ----------

    const createScreen = () => {
        // Radio is the same screen at its own address: one tab, no tab row,
        // and its own name in the corner.
        const onRadio = radioRoute();
        const TABS = ALL_TABS.filter((t) => !!t.radio === onRadio);
        const root = el('div', 'homer-screen' + (onRadio ? ' mu-radio-only' : ''));
        root.id = 'mu-root';
        root.style.visibility = 'hidden'; // until music.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'mu-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="mu-wash"><div class="mu-wash-layer"></div><div class="mu-wash-layer"></div></div>
            <div class="mu-topbar">
                <div class="mu-brand homer-home" role="button" title="Home (H)"><span class="mu-brand-mark">${icon('home')}</span>HOMER<span class="mu-brand-sub">${onRadio ? 'Radio' : 'Music'}</span></div>
                <div class="mu-np-pill" role="button"></div>
                <div class="mu-clock"><div class="mu-clock-time"></div><div class="mu-clock-date"></div></div>
            </div>
            <div class="mu-preview" data-homer-preview>${icon('live_tv')}</div>
            <div class="mu-view mu-browse-view"></div>
            <div class="mu-view mu-album-view"></div>
            <div class="mu-view mu-artist-view"></div>
            <div class="mu-view mu-playing-view"></div>
            <div class="mu-state"></div>
            <div class="mu-toast"><span class="mu-toast-text"></span></div>
            <div class="mu-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

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
            $('.mu-clock-time').textContent = M().fmt.time(d);
            $('.mu-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.mu-clock')) : () => {};

        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- state -----
        let view = 'browse'; // browse | album | artist | playing
        let viewFrom = [];
        let tab = onRadio ? 'radio' : 'recent';
        let heroItem = null; // what the hero shows
        let pageItem = null; // the album/playlist/artist/genre a page is about
        let pageTracks = null; // its tracks (album, playlist)
        let pageAlbums = null; // its albums (artist, genre)
        let rightPane = 'lyrics'; // Now playing's right column: lyrics | queue
        let radioQuery = ''; // what's in the Radio tab's search box
        let radioResults = null; // what Radio Browser answered, or null for "not asked"
        let radioBusy = false;
        let radioSaid = ''; // the line under the search box
        let focused = null;
        const remembered = {};
        const player = () => M().player;

        // ----- toast -----
        let toastTimer = null;
        const toast = (text, err) => {
            const t = $('.mu-toast');
            t.querySelector('.mu-toast-text').textContent = text;
            t.classList.toggle('err', !!err);
            t.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
        };

        // ----- the room's color: the cover you're on -----
        let washFor = '';
        let washFlip = 0;
        const setWash = (it) => {
            const key = it ? it.id + '|' + M().art(it, 200) : '';
            if (key === washFor) return;
            washFor = key;
            const layers = stage.querySelectorAll('.mu-wash-layer');
            const next = layers[washFlip = 1 - washFlip];
            const prev = layers[1 - washFlip];
            const paint = (rgb) => {
                if (washFor !== key) return;
                const c = rgb ? rgb.join(',') : '47,140,255';
                const url = it ? M().art(it, 200) : '';
                next.style.setProperty('--wash', c);
                next.style.setProperty('--img', url ? `url("${url}")` : 'none');
                next.classList.add('on');
                prev.classList.remove('on');
                stage.style.setProperty('--art', c);
            };
            if (!it) { paint(null); return; }
            M().color(it).then(paint);
        };

        // ----- focus (spatial, like Home and Books) -----
        const viewEl = (v) => $(`.mu-${v}-view`);
        const focusables = () => [...viewEl(view).querySelectorAll('.mu-focusable')]
            .filter((e) => e.offsetParent !== null && !e.classList.contains('off'));
        const keyOf = (e) => (e && e.dataset.key) || '';
        const setFocus = (e, opts = {}) => {
            if (!e) return;
            if (focused && focused !== e) focused.classList.remove('focus');
            focused = e;
            e.classList.add('focus');
            remembered[view] = keyOf(e);
            reveal(e, opts.instant);
            if (typeof e._onFocus === 'function') e._onFocus();
            updateLegend();
        };
        const reveal = (e, instant) => {
            const row = e.closest('.mu-scroll-x');
            if (row) {
                const r = e.offsetLeft - row.clientWidth / 2 + e.offsetWidth / 2;
                row.scrollTo({ left: Math.max(0, r), behavior: instant ? 'auto' : 'smooth' });
            }
            const col = e.closest('.mu-scroll-y');
            if (col) {
                const k = stage.getBoundingClientRect().height / 1080 || 1;
                const top = (e.getBoundingClientRect().top - col.getBoundingClientRect().top) / k + col.scrollTop;
                const h = e.offsetHeight;
                const pad = 18;
                if (top - pad < col.scrollTop) col.scrollTo({ top: Math.max(0, top - pad), behavior: instant ? 'auto' : 'smooth' });
                else if (top + h + pad > col.scrollTop + col.clientHeight) {
                    col.scrollTo({ top: top + h + pad - col.clientHeight, behavior: instant ? 'auto' : 'smooth' });
                }
            }
        };
        // Every view is a column of its own beside a wall or a list. Up and
        // down stay in the column you're in (so ▼ from the last album doesn't
        // land on a button off to the left); ◀ and ▶ are how you cross.
        const COLUMN = '.mu-hero, .mu-pg-left, .mu-pl-main';
        const sideOf = (e) => (e.closest(COLUMN) ? 'left' : 'right');
        const move = (dir) => {
            let list = focusables();
            if (!focused || !list.includes(focused)) { setFocus(list[0]); return; }
            if (typeof focused._move === 'function' && focused._move(dir)) return;
            if (dir === 'up' || dir === 'down') {
                const side = sideOf(focused);
                list = list.filter((e) => sideOf(e) === side);
            }
            const a = focused.getBoundingClientRect();
            const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
            let best = null;
            let bestScore = Infinity;
            list.forEach((e) => {
                if (e === focused) return;
                const r = e.getBoundingClientRect();
                const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                let main;
                let cross;
                if (dir === 'left') { main = a.left - r.right; cross = Math.abs(c.y - ac.y); if (c.x >= ac.x - 2) return; }
                else if (dir === 'right') { main = r.left - a.right; cross = Math.abs(c.y - ac.y); if (c.x <= ac.x + 2) return; }
                else if (dir === 'up') { main = a.top - r.bottom; cross = Math.abs(c.x - ac.x); if (c.y >= ac.y - 2) return; }
                else { main = r.top - a.bottom; cross = Math.abs(c.x - ac.x); if (c.y <= ac.y + 2) return; }
                const overlap = (dir === 'left' || dir === 'right')
                    ? Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)
                    : Math.min(a.right, r.right) - Math.max(a.left, r.left);
                const score = Math.max(0, main) + cross * (overlap > 0 ? 0.5 : 2.5);
                if (score < bestScore) { bestScore = score; best = e; }
            });
            if (best) setFocus(best);
        };
        const ok = () => { if (focused && typeof focused._ok === 'function') focused._ok(); };
        const focusable = (e, key, okFn, label) => {
            e.classList.add('mu-focusable');
            e.dataset.key = key;
            e._ok = okFn;
            if (label) e.dataset.okLabel = label;
            return e;
        };
        const restoreFocus = (fallback) => {
            const list = focusables();
            const want = remembered[view];
            const e = (want && list.find((x) => keyOf(x) === want)) || (fallback && list.find((x) => keyOf(x) === fallback)) || list[0];
            if (e) setFocus(e, { instant: true });
            else { focused = null; updateLegend(); }
        };

        // ----- views -----
        const showView = (v, opts = {}) => {
            if (v !== view && !opts.back) viewFrom.push(view);
            view = v;
            root.dataset.view = v;
            stage.querySelectorAll('.mu-view').forEach((x) => x.classList.toggle('on', x === viewEl(v)));
            if (v === 'browse') drawBrowse();
            else if (v === 'album') drawAlbum();
            else if (v === 'artist') drawArtist();
            else drawPlaying();
            restoreFocus(opts.focus);
            syncPill();
        };
        const back = () => {
            if (view !== 'browse' || viewFrom.length) {
                const to = viewFrom.pop() || 'browse';
                showView(to === view ? 'browse' : to, { back: true });
                return;
            }
            goBack();
        };

        // ----- playing things -----
        const isCur = (t) => { const s = player().state(); return !!(t && s.track && s.track.id === t.id); };
        const startPlaying = (tracks, index, opts) => {
            if (!tracks || !tracks.length) { toast('Nothing to play', true); return; }
            player().play(tracks, index, opts);
            remembered.playing = 'play';
            showView('playing');
        };
        // Play / Shuffle / Instant Mix for anything the hero or a page is about
        const tracksOf = (it) => {
            if (!it) return Promise.resolve([]);
            if (it.kind === 'station') return RM() ? RM().tune(it).then((t) => (t ? [t] : [])) : Promise.resolve([]);
            if (it.kind === 'favorites') return Promise.resolve(M().favorites());
            if (it.kind === 'album') return M().albumTracks(it.id);
            if (it.kind === 'playlist') return M().playlistTracks(it.id);
            if (it.kind === 'artist') return M().artistAllSongs(it.id);
            if (it.kind === 'genre') return M().genreSongs(it.id);
            if (it.kind === 'track') return Promise.resolve([it]);
            return Promise.resolve([]);
        };
        const playItem = (it, shuffle) => {
            if (!it) return;
            if (it.kind === 'station') { playStation(it); return; }
            if (it.kind === 'track') {
                const from = view === 'browse' && (tab === 'songs' || tab === 'favorites') ? tab : null;
                const list = from === 'songs' ? M().songs() : from === 'favorites' ? M().favorites() : [it];
                startPlaying(list, Math.max(0, list.findIndex((t) => t.id === it.id)), {
                    shuffle: !!shuffle,
                    source: { kind: from || 'songs', name: from === 'favorites' ? 'Favorites' : 'Songs' },
                });
                return;
            }
            toast(shuffle ? `Shuffling ${it.name}` : `Playing ${it.name}`);
            tracksOf(it).then((list) => {
                if (!list.length) { toast(`${it.name} has no tracks`, true); return; }
                startPlaying(list, 0, { shuffle: !!shuffle, source: { kind: it.kind, id: it.id, name: it.name } });
            }).catch((err) => toast(err.message, true));
        };
        // ----- favorites -----
        // Two stars that look the same and are not the same thing. A Jellyfin
        // track's star is Jellyfin's, the same one in every client; a radio
        // station's is HOMER's own, per device (music/radio-model.js, in
        // localStorage homer-radio-favorites), because Jellyfin has never
        // heard of the station and answers 404 for it.
        //
        // What's in hand decides which, and this is the only place that
        // decides: a station object from the radio model (kind 'station'), the
        // live track the player made from one (live, with a stationId), or an
        // id the radio model knows, are all the radio model's. Everything else
        // is Jellyfin's, unchanged.
        const stationOf = (it) => {
            const R = RM();
            if (!it) return null;
            if (typeof it === 'string') return R ? R.station(it) : null; // radio ids only
            if (typeof it !== 'object') return null;
            if (it.kind === 'station') return it;
            if (it.live) return (R && R.station(it.stationId || it.id)) || it;
            return null;
        };
        const isFav = (it) => {
            const st = stationOf(it);
            if (st) return !!(RM() && RM().isFavorite(st));
            return M().isFavorite(it);
        };
        const setFav = (it, on) => {
            const st = stationOf(it);
            if (!st) return M().setFavorite(it, on);
            const R = RM();
            if (!R) return Promise.reject(new Error('Radio isn\u2019t loaded yet'));
            R.setFavorite(st, on);
            return Promise.resolve(!!on);
        };
        // The star itself, drawn wherever a track or a station is. Both models
        // flip it at once, so nothing here waits on a network.
        const starHtml = (it) => {
            if (!it || !it.id) return '';
            const on = isFav(it);
            return `<span class="mu-star${on ? ' on' : ''}" data-fav="${esc(it.id)}" role="button"
                aria-label="${on ? 'Remove from Favorites' : 'Add to Favorites'}">${icon(on ? 'star' : 'star_border')}</span>`;
        };
        // hand the element the item itself, so a click doesn't have to find it
        const bindStar = (host, it) => {
            const e = host && host.querySelector('.mu-star');
            if (e) e._item = it;
            return host;
        };
        // a star changing repaints the stars, not the lists: the focus stays
        // where the finger or the remote left it
        const paintStars = () => {
            stage.querySelectorAll('.mu-star').forEach((e) => {
                const on = isFav(e._item || e.dataset.fav);
                e.classList.toggle('on', on);
                e.innerHTML = icon(on ? 'star' : 'star_border');
                e.setAttribute('aria-label', on ? 'Remove from Favorites' : 'Add to Favorites');
            });
        };
        const favOf = (e) => (e && e._fav) || null;
        const toggleFav = (it) => {
            if (!it || !it.id) return;
            const want = !isFav(it);
            toast(want ? `${it.name} — a favorite` : `${it.name} — no longer a favorite`);
            setFav(it, want).catch((err) => toast(err.message, true));
            // a station's star lives outside both the lists and Jellyfin's
            // events, so repaint the ones on screen now
            if (stationOf(it)) { paintStars(); updateLegend(); }
        };

        // Play on…: the same album, but out of a speaker. The picker owns its
        // own keys while it is open (onKey below stands aside for it).
        const PO = () => window.HomerPlayOn || null;
        const canPlayOn = () => {
            const p = PO();
            if (!p) return false;
            const h = window.HomerHA;
            if (!h || !h.isSetUp || !h.isSetUp()) return false;
            try { return p.devices().length > 0; } catch { return false; }
        };
        const playOn = (it) => {
            const p = PO();
            if (!it || !p) return;
            tracksOf(it).then((list) => {
                if (!list.length) { toast(`${it.name} has no tracks`, true); return; }
                p.open(stage, {
                    tv: true,
                    item: it,
                    tracks: list,
                    toast,
                    onHere: () => playItem(it, false),
                    onNowPlaying: () => go('#/playing'),
                    onClose: () => updateLegend(),
                });
            }).catch((err) => toast(err.message, true));
        };
        const instantMix = (it) => {
            if (!it) return;
            toast(`Radio from ${it.name}…`);
            M().instantMix(it).then((list) => {
                if (!list.length) { toast('Jellyfin had no mix for that', true); return; }
                startPlaying(list, 0, { shuffle: false, source: { kind: 'mix', id: it.id, name: `${it.name} radio` } });
            }).catch((err) => toast(err.message, true));
        };
        const openItem = (it) => {
            if (!it) return;
            if (it.kind === 'station') { playStation(it); return; }
            pageItem = it;
            pageTracks = null;
            pageAlbums = null;
            if (it.kind === 'album' || it.kind === 'playlist') {
                remembered.album = null;
                showView('album');
            } else if (it.kind === 'artist' || it.kind === 'genre') {
                remembered.artist = null;
                showView('artist');
            } else if (it.kind === 'track') {
                playItem(it);
            }
        };

        // ============ Browse ============
        const drawBrowse = () => {
            const box = viewEl('browse');
            if (!box.querySelector('.mu-hero')) {
                box.innerHTML = `
                    <section class="mu-hero">
                        <div class="mu-hero-art"></div>
                        <div class="mu-hero-text">
                            <div class="mu-eyebrow"></div>
                            <h1 class="mu-title"></h1>
                            <div class="mu-hero-sub"></div>
                            <div class="mu-meta"></div>
                            <p class="mu-desc"></p>
                            <div class="mu-acts"></div>
                        </div>
                    </section>
                    <div class="mu-tabs"></div>
                    <div class="mu-content mu-scroll-y"></div>`;
                drawTabs();
            }
            drawGrid();
            drawHero();
        };
        const drawTabs = () => {
            const box = viewEl('browse').querySelector('.mu-tabs');
            box.innerHTML = '';
            TABS.forEach((t) => {
                const n = (t.list() || []).length;
                const e = el('div', `mu-tab${t.id === tab ? ' on' : ''}${t.radio ? ' mu-tab-radio' : ''}`,
                    `<span>${esc(t.label)}</span>${n ? `<b>${n}</b>` : ''}`);
                // Radio's tab is there before its stations have landed
                e.classList.toggle('off', !n && t.id !== tab && !t.radio);
                focusable(e, 'tab:' + t.id, () => {
                    if (tab === t.id) return;
                    tab = t.id;
                    remembered.browse = 'tab:' + t.id;
                    drawTabs();
                    drawGrid();
                    const first = viewEl('browse').querySelector('.mu-content .mu-focusable');
                    if (first && first._onFocus) first._onFocus();
                    drawHero();
                    const again = focusables().find((x) => keyOf(x) === 'tab:' + t.id);
                    if (again) setFocus(again, { instant: true });
                }, 'Show');
                box.appendChild(e);
            });
        };
        const drawGrid = () => {
            const box = viewEl('browse').querySelector('.mu-content');
            const t = TABS.find((x) => x.id === tab) || TABS[0];
            if (t.radio) {
                const keepTop = box.scrollTop;
                drawRadio(box);
                box.scrollTop = keepTop;
                return;
            }
            const list = t.list() || [];
            box.scrollTop = 0;
            box.innerHTML = '';
            const rows = tab === 'songs' || tab === 'favorites';
            box.className = `mu-content mu-scroll-y ${rows ? 'mu-list' : 'mu-wall'} mu-${tab}`;
            if (!list.length) {
                box.innerHTML = `<div class="mu-empty-row">${tab === 'favorites'
                    ? 'No favorites yet. Press <em>F</em> on a track, or click its star.'
                    : 'Nothing here yet.'}</div>`;
                return;
            }
            if (rows) {
                const f = M().fmt;
                list.slice(0, 500).forEach((s) => {
                    const row = el('div', 'mu-song', `
                        <div class="mu-song-art">${artImg(s, 120, 'mu-img')}</div>
                        <div class="mu-song-t">${esc(s.name)}</div>
                        <div class="mu-song-a">${esc(s.artist || '')}</div>
                        <div class="mu-song-al">${esc(s.album || '')}</div>
                        <div class="mu-song-d">${f.clock(s.duration)}</div>
                        ${starHtml(s)}`);
                    bindStar(row, s);
                    focusable(row, 'song:' + s.id, () => playItem(s), 'Play');
                    row._fav = s;
                    row._onFocus = () => { heroItem = s; drawHero(); };
                    box.appendChild(row);
                });
                return;
            }
            list.forEach((it) => {
                const card = el('div', `mu-card mu-card-${it.kind}`, `
                    <div class="mu-card-art">${artImg(it, 400, 'mu-img')}
                        ${it.kind === 'album' && isCurAlbum(it) ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : ''}</div>
                    <div class="mu-card-t">${esc(it.name)}</div>
                    <div class="mu-card-s">${esc(cardSub(it))}</div>`);
                focusable(card, 'it:' + it.id, () => openItem(it),
                    it.kind === 'artist' ? 'Artist' : it.kind === 'genre' ? 'Genre' : 'Open');
                card._onFocus = () => { heroItem = it; drawHero(); };
                box.appendChild(card);
            });
        };
        // ----- Radio -----
        // A station's picture: SomaFM draws its own, and a Radio Browser
        // station usually has nothing worth showing, so it gets a letter tile
        // in a color of its own.
        const stationTile = (st) => `<div class="mu-img mu-noart mu-st-tile" data-kind="station"
            style="--st-h:${RM() ? RM().hue(st) : 210}"><span>${esc(RM() ? RM().initials(st) : '?')}</span></div>`;
        const stationArt = (st, h) => {
            const url = RM() ? RM().art(st, h) : '';
            if (url) return `<img class="mu-img mu-st-img" src="${esc(url)}" alt="" draggable="false" loading="lazy">`;
            return stationTile(st);
        };
        // A Radio Browser favicon is as likely to 404 as not, and when it does
        // load it is often a 32px .ico blown up to fill a card. Either way the
        // letter tile is the better picture, so measure it (off to one side,
        // out of the same cache) and swap the tile back in when it's a crumb.
        const MIN_ART = 64;
        const bindStationArt = (host, st) => {
            const img = host && host.querySelector('.mu-st-img');
            if (!img) return host;
            const tile = () => { if (img.parentNode) img.outerHTML = stationTile(st); };
            img.onerror = tile;
            if (st.source === 'soma') return host; // SomaFM draws its own, properly
            const probe = new Image();
            probe.onload = () => { if (probe.naturalWidth < MIN_ART) tile(); };
            probe.onerror = tile;
            probe.src = img.src;
            return host;
        };
        const isCurStation = (st) => {
            const s = player().state();
            return !!(s.track && s.track.live && s.track.stationId === st.id);
        };
        const stationCard = (st) => {
            const playable = RM() ? RM().playable(st) : false;
            const card = el('div', `mu-card mu-card-station${playable ? '' : ' mu-st-off'}`, `
                <div class="mu-card-art">${stationArt(st, 320)}
                    ${isCurStation(st) ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : ''}
                    ${st.source === 'soma' ? '<span class="mu-st-badge">SomaFM</span>' : ''}</div>
                <div class="mu-card-t">${esc(st.name)}</div>
                <div class="mu-card-s">${esc(st.sub || '')}</div>
                ${starHtml(st)}`);
            bindStar(card, st);
            bindStationArt(card, st);
            card._fav = st;
            focusable(card, 'st:' + st.id, () => playStation(st), playable ? 'Play' : 'Where it plays');
            card._onFocus = () => { heroItem = st; drawHero(); };
            return card;
        };
        // Play a station here, through the same player the library uses.
        const playStation = (st) => {
            const R = RM();
            if (!R) return;
            if (!R.playable(st)) {
                toast(R.playUrl(st).why || 'HOMER can\u2019t play that one here', true);
                playOnStation(st);
                return;
            }
            toast(`Tuning in ${st.name}`);
            R.tune(st).then((t) => {
                if (!t) { toast(R.playUrl(st).why || 'That station didn\u2019t answer', true); return; }
                startPlaying([t], 0, { source: { kind: 'station', id: st.id, name: st.name } });
            }).catch((err) => toast(err.message, true));
        };
        // …or send it to a speaker, which goes through Music Assistant.
        const playOnStation = (st) => {
            const p = PO();
            if (!p || !st) return;
            p.open(stage, {
                tv: true,
                station: st,
                toast,
                onHere: () => playStation(st),
                onNowPlaying: () => go('#/playing'),
                onClose: () => updateLegend(),
            });
        };

        const drawRadio = (box) => {
            const R = RM();
            box.className = 'mu-content mu-scroll-y mu-radio';
            box.innerHTML = '';
            if (!R) {
                box.innerHTML = '<div class="mu-empty-row">Radio didn\u2019t load.</div>';
                return;
            }
            // the search box: OK on it starts typing, Enter searches
            const search = el('div', 'mu-radio-search', `
                ${icon('search')}
                <input class="mu-radio-input" type="search" placeholder="Search every station on Radio Browser"
                    autocomplete="off" spellcheck="false" value="${esc(radioQuery)}">
                <span class="mu-radio-said">${esc(radioSaid)}</span>`);
            const input = search.querySelector('.mu-radio-input');
            input.oninput = () => { radioQuery = input.value; };
            focusable(search, 'radio:search', () => input.focus(), 'Search');
            box.appendChild(search);

            const section = (title, note, list, key) => {
                if (!list || !list.length) return;
                const sec = el('section', 'mu-radio-sec', `
                    <div class="mu-radio-head"><h3>${esc(title)}</h3>${note ? `<span>${esc(note)}</span>` : ''}</div>
                    <div class="mu-radio-wall"></div>`);
                const wall = sec.querySelector('.mu-radio-wall');
                list.forEach((st) => wall.appendChild(stationCard(st)));
                sec.dataset.sec = key;
                box.appendChild(sec);
            };

            if (radioResults) {
                section(radioResults.length ? `Found ${M().fmt.plural(radioResults.length, 'station')}` : 'Nothing found',
                    radioResults.length ? `for “${radioQuery}”, best-voted first` : `Radio Browser has nothing for “${radioQuery}”`,
                    radioResults, 'results');
            }
            section('Favorites', 'Starred on this device — a station isn\u2019t a Jellyfin item, so these stay here',
                R.favorites(), 'fav');
            section('Local', 'Dallas–Fort Worth', R.local(), 'local');
            section('SomaFM', 'Commercial-free, listener-supported, out of San Francisco', R.soma(), 'soma');

            if (!box.querySelector('.mu-card')) {
                box.appendChild(el('div', 'mu-empty-row', R.loaded()
                    ? 'No stations. Search for one above.'
                    : 'Finding stations…'));
            }
        };
        const runRadioSearch = () => {
            const R = RM();
            const term = (radioQuery || '').trim();
            if (!R || term.length < 2) { toast('Type at least two letters', true); return; }
            radioBusy = true;
            radioSaid = 'Searching…';
            const said = viewEl('browse').querySelector('.mu-radio-said');
            if (said) said.textContent = radioSaid;
            R.search(term).then((list) => {
                radioBusy = false;
                radioResults = list;
                radioSaid = list.length ? `${list.length} for “${term}”` : `Nothing for “${term}”`;
                if (tab === 'radio' && view === 'browse') {
                    drawGrid();
                    const first = focusables().find((x) => keyOf(x).startsWith('st:'));
                    if (first) setFocus(first);
                    else restoreFocus('radio:search');
                }
            }).catch((err) => {
                radioBusy = false;
                radioSaid = '';
                toast(err.message, true);
            });
        };
        const clearRadioSearch = () => {
            radioQuery = '';
            radioResults = null;
            radioSaid = '';
            if (tab === 'radio' && view === 'browse') { drawGrid(); restoreFocus('radio:search'); }
        };

        const isCurAlbum = (a) => { const s = player().state(); return !!(s.track && s.track.albumId === a.id); };
        const cardSub = (it) => {
            if (it.kind === 'album') return it.artist || '';
            if (it.kind === 'artist') return '';
            if (it.kind === 'genre' || it.kind === 'playlist') return it.tracks ? M().fmt.plural(it.tracks, 'track') : '';
            return '';
        };

        const drawHero = () => {
            const box = viewEl('browse');
            if (!box.querySelector('.mu-hero')) return;
            const t = TABS.find((x) => x.id === tab) || TABS[0];
            const it = t.radio
                ? (heroItem && heroItem.kind === 'station' ? heroItem : (t.list() || [])[0] || null)
                : (heroItem && (t.list() || []).includes(heroItem) ? heroItem : (t.list() || [])[0]);
            heroItem = it || null;
            const q = (sel) => box.querySelector(sel);
            setWash(it);
            const artBox = q('.mu-hero-art');
            const key = it ? it.id + '|' + M().art(it, 520) : '';
            if (artBox.dataset.key !== key) {
                artBox.dataset.key = key;
                artBox.innerHTML = it ? artImg(it, 520, 'mu-img') : '';
                artBox.classList.remove('in');
                void artBox.offsetWidth;
                artBox.classList.add('in');
                artBox.classList.toggle('round', !!it && it.kind === 'artist');
            }
            q('.mu-eyebrow').innerHTML = it ? `<span class="mu-chip">${esc(subOf(it))}</span>` : '';
            q('.mu-title').textContent = it ? it.name : '';
            q('.mu-title').classList.toggle('long', !!it && it.name.length > 26);
            q('.mu-hero-sub').textContent = it && it.kind !== 'artist' && it.kind !== 'genre' && it.kind !== 'playlist'
                ? (it.kind === 'track' ? it.artists.join(', ') : it.artist || '') : '';
            q('.mu-meta').innerHTML = metaOf(it).map((x) => `<span>${esc(x)}</span>`).join('');
            q('.mu-desc').textContent = (it && it.overview) || '';
            if (it && it.kind === 'station' && RM()) {
                const p = RM().playUrl(it);
                const note = p.pending ? ''
                    : !p.url ? p.why
                        : p.proxied ? 'Plain http, so HOMER plays it through the NAS helper.'
                            : '';
                if (note) q('.mu-desc').textContent = [q('.mu-desc').textContent, note].filter(Boolean).join(' — ');
            }
            const acts = q('.mu-acts');
            const had = focused && acts.contains(focused) ? keyOf(focused) : null;
            acts.innerHTML = '';
            const btn = (key2, ic, label, fn, primary) => {
                const e = el('div', `mu-btn${primary ? ' primary' : ''}`, `${icon(ic)}<span>${esc(label)}</span>`);
                focusable(e, key2, fn);
                acts.appendChild(e);
            };
            // three, stacked: ▲▼ runs down them, ▶ crosses to the wall. Opening
            // the thing itself is what OK on its cover already does.
            if (it && it.kind === 'station') {
                const R = RM();
                const can = R ? R.playable(it) : false;
                if (can) btn('a:play', 'play_arrow', 'Play', () => playStation(it), true);
                // when it can't play here, the speaker is the main way to hear it
                btn('a:on', 'speaker', 'Play on…', () => playOnStation(it), !can);
                btn('a:fav', isFav(it) ? 'star' : 'star_border',
                    isFav(it) ? 'Starred' : 'Star it', () => { toggleFav(it); drawHero(); });
            } else if (it) {
                btn('a:play', 'play_arrow', 'Play', () => playItem(it, false), true);
                btn('a:shuffle', 'shuffle', 'Shuffle', () => playItem(it, true));
                if (canPlayOn()) btn('a:on', 'speaker', 'Play on…', () => playOn(it));
                btn('a:mix', 'radio', 'Instant Mix', () => instantMix(it));
            }
            if (had) {
                const e = [...acts.children].find((x) => keyOf(x) === had) || acts.firstChild;
                setFocus(e, { instant: true });
            }
        };

        // ============ Album / playlist ============
        const drawAlbum = () => {
            const box = viewEl('album');
            const it = pageItem;
            box.innerHTML = '';
            if (!it) return;
            setWash(it);
            box.innerHTML = `
                <div class="mu-pg-left">
                    <div class="mu-pg-art">${artImg(it, 900, 'mu-img')}</div>
                    <div class="mu-pg-acts"></div>
                </div>
                <div class="mu-pg-right">
                    <div class="mu-eyebrow"><span class="mu-chip">${esc(subOf(it))}</span>${starHtml(it)}</div>
                    <h1 class="mu-title">${esc(it.name)}</h1>
                    <div class="mu-pg-sub">${esc(it.kind === 'album' ? it.artist || '' : '')}</div>
                    <div class="mu-meta">${metaOf(it).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
                    ${it.overview ? `<p class="mu-desc">${esc(it.overview)}</p>` : ''}
                    <div class="mu-tracks-head">Tracks</div>
                    <div class="mu-tracks mu-scroll-y"></div>
                </div>`;
            box.querySelector('.mu-title').classList.toggle('long', it.name.length > 26);
            bindStar(box.querySelector('.mu-eyebrow'), it);
            const acts = box.querySelector('.mu-pg-acts');
            const btn = (key, ic, label, fn, primary) => {
                const e = el('div', `mu-btn${primary ? ' primary' : ''}`, `${icon(ic)}<span>${esc(label)}</span>`);
                focusable(e, key, fn);
                acts.appendChild(e);
            };
            btn('a:play', 'play_arrow', 'Play', () => playItem(it, false), true);
            btn('a:shuffle', 'shuffle', 'Shuffle', () => playItem(it, true));
            if (canPlayOn()) btn('a:on', 'speaker', 'Play on…', () => playOn(it));
            btn('a:mix', 'radio', 'Instant Mix', () => instantMix(it));
            drawTracks();
            if (!pageTracks) {
                tracksOf(it).then((list) => {
                    if (pageItem !== it) return;
                    pageTracks = list;
                    if (view === 'album') {
                        const k = focused ? keyOf(focused) : null;
                        drawTracks();
                        const e = k && focusables().find((x) => keyOf(x) === k);
                        setFocus(e || focusables()[0], { instant: true });
                    }
                }).catch((err) => toast(err.message, true));
            }
        };
        const drawTracks = () => {
            const box = viewEl('album').querySelector('.mu-tracks');
            if (!box) return;
            const list = pageTracks;
            box.innerHTML = '';
            if (!list) { box.innerHTML = `<div class="mu-empty-row">Getting the tracks…</div>`; return; }
            if (!list.length) { box.innerHTML = `<div class="mu-empty-row">No tracks.</div>`; return; }
            const f = M().fmt;
            const s = player().state();
            const discs = new Set(list.map((t) => t.disc || 1));
            let lastDisc = null;
            list.forEach((t, i) => {
                if (discs.size > 1 && (t.disc || 1) !== lastDisc) {
                    lastDisc = t.disc || 1;
                    box.appendChild(el('div', 'mu-disc', `Disc ${lastDisc}`));
                }
                const here = !!(s.track && s.track.id === t.id);
                const row = el('div', `mu-track${here ? ' here' : ''}`, `
                    <span class="mu-track-n">${here ? (s.playing ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : icon('pause')) : (t.no || i + 1)}</span>
                    <span class="mu-track-t">${esc(t.name)}</span>
                    <span class="mu-track-a">${esc(t.artist && t.artist !== (pageItem && pageItem.artist) ? t.artist : '')}</span>
                    <span class="mu-track-d">${f.clock(t.duration)}</span>
                    ${starHtml(t)}`);
                bindStar(row, t);
                focusable(row, 'tr:' + t.id, () => startPlaying(list, i, {
                    shuffle: false,
                    source: { kind: pageItem.kind, id: pageItem.id, name: pageItem.name },
                }), 'Play');
                row._fav = t;
                box.appendChild(row);
            });
        };

        // ============ Artist / genre ============
        const drawArtist = () => {
            const box = viewEl('artist');
            const it = pageItem;
            box.innerHTML = '';
            if (!it) return;
            setWash(it);
            box.innerHTML = `
                <div class="mu-ar-head">
                    <div class="mu-ar-art${it.kind === 'artist' ? ' round' : ''}">${artImg(it, 520, 'mu-img')}</div>
                    <div class="mu-ar-text">
                        <div class="mu-eyebrow"><span class="mu-chip">${esc(subOf(it))}</span></div>
                        <h1 class="mu-title">${esc(it.name)}</h1>
                        <div class="mu-meta"></div>
                        <div class="mu-acts"></div>
                    </div>
                </div>
                <div class="mu-ar-head2">Albums</div>
                <div class="mu-content mu-wall mu-scroll-y"></div>`;
            box.querySelector('.mu-title').classList.toggle('long', it.name.length > 26);
            const acts = box.querySelector('.mu-acts');
            const btn = (key, ic, label, fn, primary) => {
                const e = el('div', `mu-btn${primary ? ' primary' : ''}`, `${icon(ic)}<span>${esc(label)}</span>`);
                focusable(e, key, fn);
                acts.appendChild(e);
            };
            btn('a:play', 'play_arrow', 'Play all', () => playItem(it, false), true);
            btn('a:shuffle', 'shuffle', 'Shuffle', () => playItem(it, true));
            if (canPlayOn()) btn('a:on', 'speaker', 'Play on…', () => playOn(it));
            btn('a:mix', 'radio', 'Instant Mix', () => instantMix(it));
            drawArtistAlbums();
            if (!pageAlbums) {
                const job = it.kind === 'artist' ? M().artistAlbums(it.id) : M().genreAlbums(it.id);
                job.then((list) => {
                    if (pageItem !== it) return;
                    pageAlbums = list;
                    if (view === 'artist') {
                        const k = focused ? keyOf(focused) : null;
                        drawArtistAlbums();
                        const e = k && focusables().find((x) => keyOf(x) === k);
                        setFocus(e || focusables()[0], { instant: true });
                    }
                }).catch((err) => toast(err.message, true));
            }
        };
        const drawArtistAlbums = () => {
            const box = viewEl('artist').querySelector('.mu-content');
            if (!box) return;
            const list = pageAlbums;
            const meta = viewEl('artist').querySelector('.mu-meta');
            box.innerHTML = '';
            if (!list) { box.innerHTML = `<div class="mu-empty-row">Getting the albums…</div>`; return; }
            if (meta) {
                const f = M().fmt;
                const tracks = list.reduce((n, a) => n + (a.tracks || 0), 0);
                meta.innerHTML = [f.plural(list.length, 'album'), tracks ? f.plural(tracks, 'track') : '']
                    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
            }
            if (!list.length) { box.innerHTML = `<div class="mu-empty-row">No albums.</div>`; return; }
            list.forEach((a) => {
                const card = el('div', 'mu-card mu-card-album', `
                    <div class="mu-card-art">${artImg(a, 400, 'mu-img')}
                        ${isCurAlbum(a) ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : ''}</div>
                    <div class="mu-card-t">${esc(a.name)}</div>
                    <div class="mu-card-s">${esc(a.year ? String(a.year) : a.artist || '')}</div>`);
                focusable(card, 'al:' + a.id, () => openItem(a), 'Open');
                box.appendChild(card);
            });
        };

        // ============ Now playing ============
        const drawPlaying = () => {
            const box = viewEl('playing');
            const s = player().state();
            box.innerHTML = '';
            if (!s.track) {
                box.innerHTML = `<div class="mu-empty-row big">Nothing is playing. Pick something to play.</div>`;
                return;
            }
            box.innerHTML = `
                <div class="mu-pl-main">
                    <div class="mu-pl-top">
                        <div class="mu-pl-art">${artImg(s.track, 900, 'mu-img')}</div>
                        <div class="mu-pl-text">
                            <div class="mu-eyebrow"></div>
                            <h1 class="mu-title"></h1>
                            <div class="mu-pl-artist"></div>
                            <div class="mu-pl-album"></div>
                            <div class="mu-pl-from"></div>
                        </div>
                    </div>
                    <div class="mu-pl-seek" data-k="seek">
                        <div class="mu-pl-track"><b></b><span class="mu-pl-knob"></span></div>
                        <div class="mu-pl-times"><span class="mu-pl-at"></span><span class="mu-pl-left"></span></div>
                    </div>
                    <div class="mu-pl-ctl">
                        <div class="mu-round" data-k="prev">${icon('skip_previous')}</div>
                        <div class="mu-round" data-k="back">${icon('replay_10')}</div>
                        <div class="mu-round big" data-k="play">${icon('play_arrow')}</div>
                        <div class="mu-round" data-k="fwd">${icon('forward_10')}</div>
                        <div class="mu-round" data-k="next">${icon('skip_next')}</div>
                        <span class="mu-pl-gap"></span>
                        <div class="mu-round small" data-k="fav">${icon('star_border')}</div>
                        <div class="mu-round small" data-k="shuffle">${icon('shuffle')}</div>
                        <div class="mu-round small" data-k="repeat">${icon('repeat')}</div>
                        <div class="mu-vol" data-k="vol">${icon('volume_up')}<span class="mu-vol-bar"><b></b></span><span class="mu-vol-n"></span></div>
                    </div>
                    <div class="mu-pl-next"></div>
                    <div class="mu-pl-err"></div>
                </div>
                <div class="mu-pl-side">
                    <div class="mu-panes">
                        <div class="mu-pane-tab" data-k="pane:lyrics">${s.track.live ? 'On now' : 'Lyrics'}</div>
                        <div class="mu-pane-tab" data-k="pane:queue">${s.track.live ? 'Station' : 'Up next'}</div>
                    </div>
                    <div class="mu-pane-body mu-scroll-y"></div>
                </div>`;
            const P = player();
            const acts = {
                prev: [() => P.prev(), 'Previous'],
                back: [() => P.skip(-10), 'Back 10 s'],
                play: [() => P.toggle(), 'Play / pause'],
                fwd: [() => P.skip(10), 'Forward 10 s'],
                next: [() => P.next(), 'Next'],
                fav: [() => toggleFav(P.state().track), 'Favorite'],
                shuffle: [() => { P.toggleShuffle(); toast(P.state().shuffle ? 'Shuffle on' : 'Shuffle off'); }, 'Shuffle'],
                repeat: [() => { P.cycleRepeat(); const r = P.state().repeat; toast(r === 'off' ? 'Repeat off' : r === 'all' ? 'Repeat all' : 'Repeat one'); }, 'Repeat'],
                vol: [() => P.toggleMute(), 'Mute'],
                seek: [() => P.toggle(), 'Play / pause'],
                'pane:lyrics': [() => { rightPane = 'lyrics'; drawPane(); }, 'Lyrics'],
                'pane:queue': [() => { rightPane = 'queue'; drawPane(); }, 'Up next'],
            };
            box.querySelectorAll('[data-k]').forEach((e) => {
                const a = acts[e.dataset.k];
                if (a) focusable(e, e.dataset.k, a[0], a[1]);
            });
            // ◀ ▶ on the progress bar seeks; on the volume it's the volume
            const seekEl = box.querySelector('[data-k="seek"]');
            seekEl._move = (dir) => {
                if (dir === 'left') { P.skip(-10); return true; }
                if (dir === 'right') { P.skip(10); return true; }
                return false;
            };
            const volEl = box.querySelector('[data-k="vol"]');
            volEl._move = (dir) => {
                if (dir === 'left') { P.nudgeVolume(-0.05); return true; }
                if (dir === 'right') { P.nudgeVolume(0.05); return true; }
                return false;
            };
            drawPane();
            paintPlaying();
            if (s.track.live) pollLive();
            else M().lyrics(s.track.id);
        };
        // What a live station is playing right now, where it can be known at
        // all. SomaFM publishes it outright; for everyone else the NAS helper
        // reads one ICY block, which is the only way a web page gets it.
        const liveNow = {};
        let liveTimer = null;
        const liveNote = (t, np) => {
            if (!RM()) return '';
            const st = RM().station(t.stationId);
            const where = t.proxied ? 'Through the NAS helper' : 'Live';
            if (np && (np.title || np.artist)) {
                return `${where} · ${np.from === 'SomaFM' ? 'SomaFM says what\u2019s on' : 'from the stream\u2019s own metadata'}`;
            }
            if (st && st.source === 'soma') return `${where} · SomaFM`;
            return `${where} · this station sends no track information`;
        };
        const pollLive = () => {
            const s = player().state();
            const t = s.track;
            if (!t || !t.live || !RM()) return;
            const st = RM().station(t.stationId);
            if (!st) return;
            RM().nowPlaying(st).then((np) => {
                const was = liveNow[t.stationId];
                const same = (was && np && was.title === np.title && was.artist === np.artist) || (!was && !np);
                liveNow[t.stationId] = np;
                if (!same && view === 'playing') { paintPlaying(); drawPane(); }
                else if (!same) syncPill();
            });
        };
        liveTimer = setInterval(pollLive, 20000);

        let paneFor = '';
        let paneAt = -1; // the queue position the Up next pane was drawn for
        const drawPane = () => {
            const side = viewEl('playing').querySelector('.mu-pl-side');
            if (!side) return;
            side.querySelectorAll('.mu-pane-tab').forEach((e) => e.classList.toggle('on', e.dataset.k === 'pane:' + rightPane));
            const body = side.querySelector('.mu-pane-body');
            const s = player().state();
            paneFor = rightPane + '|' + (s.track ? s.track.id : '');
            paneAt = s.index;
            body.innerHTML = '';
            body.classList.toggle('lyrics', rightPane === 'lyrics');
            if (rightPane === 'queue') {
                const f = M().fmt;
                if (s.track && s.track.live) {
                    const st = RM() && RM().station(s.track.stationId);
                    body.innerHTML = `<div class="mu-empty-row">Radio has no queue — it plays until you stop it.${
                        st && st.homepage ? `<span class="mu-q-link">${esc(st.homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span>` : ''}</div>`;
                    return;
                }
                if (!s.queue.length) { body.innerHTML = `<div class="mu-empty-row">The queue is empty.</div>`; return; }
                s.queue.forEach((t, i) => {
                    const row = el('div', `mu-q${i === s.index ? ' here' : ''}${i < s.index ? ' done' : ''}`, `
                        <span class="mu-q-n">${i === s.index ? (s.playing ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : icon('pause')) : i + 1}</span>
                        <span class="mu-q-t">${esc(t.name)}<i>${esc(t.artist || '')}</i></span>
                        <span class="mu-q-d">${f.clock(t.duration)}</span>
                        ${starHtml(t)}`);
                    bindStar(row, t);
                    focusable(row, 'q:' + i, () => player().jump(i), 'Play');
                    row._fav = t;
                    body.appendChild(row);
                });
                const here = body.querySelector('.mu-q.here');
                if (here) body.scrollTop = Math.max(0, here.offsetTop - 120);
                return;
            }
            // lyrics
            if (s.track && s.track.live) {
                const st = RM() && RM().station(s.track.stationId);
                const np = liveNow[s.track.stationId];
                body.innerHTML = `<div class="mu-lyr-none">${np && (np.title || np.artist)
                    ? `<b>${esc(np.title || '')}</b>${np.artist ? `<span>${esc(np.artist)}</span>` : ''}${np.album ? `<span>${esc(np.album)}</span>` : ''}`
                    : 'No track information from this station.'}<span>${esc(st && st.source === 'soma'
                        ? 'SomaFM publishes what it\u2019s playing, and HOMER asks it every 20 seconds.'
                        : 'A browser can\u2019t read the metadata inside a stream, so HOMER asks the NAS helper for it. Talk and sports stations usually send nothing but their own name.')}</span></div>`;
                return;
            }
            body.innerHTML = `<div class="mu-lyr-none">Looking for lyrics…</div>`;
            if (!s.track) return;
            M().lyrics(s.track.id).then((ly) => {
                if (paneFor !== rightPane + '|' + s.track.id) return;
                if (!ly || !ly.lines.length) {
                    body.innerHTML = `<div class="mu-lyr-none">No lyrics for this one.<span>HOMER reads whatever Jellyfin has: an .lrc beside the file, or lyrics in its tags.</span></div>`;
                    return;
                }
                body.classList.toggle('synced', ly.synced);
                body.innerHTML = ly.lines.map((line, i) =>
                    `<div class="mu-lyr" data-i="${i}">${esc(line.text) || '&nbsp;'}</div>`).join('');
                paintLyrics(true);
            });
        };
        let lyrLine = -2;
        const paintLyrics = (force) => {
            const body = viewEl('playing').querySelector('.mu-pane-body');
            if (!body || rightPane !== 'lyrics' || !body.classList.contains('synced')) return;
            const s = player().state();
            if (!s.track) return;
            M().lyrics(s.track.id).then((l) => {
                if (!l || !l.synced) return;
                const i = M().lyricAt(l, s.position);
                if (i === lyrLine && !force) return;
                lyrLine = i;
                const lines = body.querySelectorAll('.mu-lyr');
                lines.forEach((e, k) => {
                    e.classList.toggle('on', k === i);
                    e.classList.toggle('past', k < i);
                });
                const cur = lines[i];
                if (cur) {
                    const k = stage.getBoundingClientRect().height / 1080 || 1;
                    const top = (cur.getBoundingClientRect().top - body.getBoundingClientRect().top) / k + body.scrollTop;
                    body.scrollTo({ top: Math.max(0, top - body.clientHeight * 0.38), behavior: force ? 'auto' : 'smooth' });
                }
            });
        };
        const paintPlaying = () => {
            const box = viewEl('playing');
            if (!box.querySelector('.mu-pl-main')) return;
            const s = player().state();
            const t = s.track;
            if (!t) return;
            const f = M().fmt;
            const q = (sel) => box.querySelector(sel);
            setWash(t);
            // the cover only changes when the track does, so it doesn't flash
            const artBox = q('.mu-pl-art');
            if (artBox.dataset.id !== t.id) {
                artBox.dataset.id = t.id;
                artBox.innerHTML = artImg(t, 900, 'mu-img');
                artBox.classList.remove('in');
                void artBox.offsetWidth;
                artBox.classList.add('in');
            }
            q('.mu-eyebrow').innerHTML = s.playing
                ? `<span class="mu-chip live"><span class="mu-eq"><i></i><i></i><i></i></span>${s.buffering ? 'Loading' : t.live ? 'On the air' : 'Now playing'}</span>`
                : `<span class="mu-chip amber">${icon('pause')}${t.live ? 'Stopped' : 'Paused'}</span>`;
            const title = q('.mu-title');
            title.textContent = t.name;
            title.classList.toggle('long', t.name.length > 26);
            if (t.live) {
                // the track first, the artist under it: the station's name is
                // already the title above
                const np = liveNow[t.stationId] || null;
                q('.mu-pl-artist').textContent = np && np.title ? np.title : (t.artist || '');
                q('.mu-pl-album').textContent = np ? [np.artist, np.album].filter(Boolean).join(' · ') : '';
                q('.mu-pl-from').textContent = liveNote(t, np);
            } else {
                q('.mu-pl-artist').textContent = t.artists.join(', ') || t.artist || '';
                q('.mu-pl-album').textContent = [t.album, t.year].filter(Boolean).join(' · ');
                q('.mu-pl-from').textContent = s.source ? `From ${s.source.name} · ${s.index + 1} of ${s.count}` : '';
            }
            const dur = s.duration || (t.live ? 0 : t.duration) || 0;
            const pc = dur ? Math.max(0, Math.min(1, s.position / dur)) : 0;
            box.classList.toggle('mu-pl-live', !!t.live);
            q('.mu-pl-track b').style.width = (t.live ? 100 : pc * 100).toFixed(2) + '%';
            q('.mu-pl-knob').style.left = (t.live ? 100 : pc * 100).toFixed(2) + '%';
            q('.mu-pl-at').textContent = t.live ? 'Live' : f.clock(s.position);
            q('.mu-pl-left').textContent = t.live ? f.clock(s.position) + ' in' : '−' + f.clock(Math.max(0, dur - s.position));
            const play = q('[data-k="play"]');
            play.innerHTML = icon(s.playing ? 'pause' : 'play_arrow');
            play.dataset.okLabel = s.playing ? 'Pause' : 'Play';
            const fav = q('[data-k="fav"]');
            if (fav) {
                const on = isFav(t);
                fav.innerHTML = icon(on ? 'star' : 'star_border');
                fav.classList.toggle('star-set', on);
                fav.dataset.okLabel = on ? 'Unfavorite' : 'Favorite';
            }
            q('[data-k="shuffle"]').classList.toggle('set', s.shuffle);
            const rep = q('[data-k="repeat"]');
            rep.innerHTML = icon(s.repeat === 'one' ? 'repeat_one' : 'repeat');
            rep.classList.toggle('set', s.repeat !== 'off');
            const vol = q('[data-k="vol"]');
            vol.querySelector('.mu-vol-bar b').style.width = ((s.muted ? 0 : s.volume) * 100).toFixed(0) + '%';
            vol.querySelector('.mu-vol-n').textContent = s.muted ? 'Muted' : Math.round(s.volume * 100) + '%';
            vol.querySelector('.material-icons').textContent = s.muted || !s.volume ? 'volume_off' : s.volume < 0.5 ? 'volume_down' : 'volume_up';
            q('.mu-pl-next').innerHTML = t.live
                ? `<span class="mu-pl-next-k">Station</span><span>${esc(subOf(t.live && RM() ? RM().station(t.stationId) || t : t))}${
                    t.proxied ? ' · through the NAS helper' : ''}</span>`
                : s.next
                    ? `<span class="mu-pl-next-k">Next</span><b>${esc(s.next.name)}</b><span>${esc(s.next.artist || '')}</span>`
                    : (s.repeat === 'off' ? `<span class="mu-pl-next-k">Next</span><span>End of the queue</span>` : '');
            q('.mu-pl-err').textContent = s.error || '';
            // the queue only needs redrawing when the track changes, not four
            // times a second: redrawing it would eat the focus mid-press
            if (rightPane === 'lyrics') paintLyrics(false);
            else if (paneAt !== s.index) { paneAt = s.index; drawPane(); }
            if (focused && focused.dataset.k === 'play') updateLegend();
        };

        // ----- the Now playing pill in the top bar -----
        const syncPill = () => {
            const s = player().state();
            const np = $('.mu-np-pill');
            const show = !!s.track && view !== 'playing';
            np.classList.toggle('on', show);
            if (!show) return;
            const live = s.track.live ? liveNow[s.track.stationId] : null;
            const sub = live && (live.title || live.artist)
                ? [live.artist, live.title].filter(Boolean).join(' — ')
                : (s.track.artist || '');
            np.innerHTML = `${s.playing ? '<span class="mu-eq"><i></i><i></i><i></i></span>' : icon('pause')}<span class="mu-np-t">${esc(s.track.name)}</span><span class="mu-np-a">${esc(sub)}</span>`;
        };

        // ----- model changes -----
        let lastPaint = 0;
        const onModel = (what) => {
            if (what === 'player') {
                const now = Date.now();
                if (view === 'playing') paintPlaying();
                if (now - lastPaint > 900 || !player().state().playing) {
                    lastPaint = now;
                    syncPill();
                    if (view === 'album') {
                        const k = focused ? keyOf(focused) : null;
                        drawTracks();
                        const e = k && focusables().find((x) => keyOf(x) === k);
                        if (e) setFocus(e, { instant: true });
                    }
                }
                return;
            }
            if (what === 'library') { render(); return; }
            if (what === 'favorite') {
                paintStars();
                updateLegend(); // F's own label is "Favorite" or "Unfavorite"
                // the Actions strip asks its providers when it opens, so it
                // is already right
                if (view === 'playing') paintPlaying();
                // the Favorites tab is the one list a star actually changes
                if (view === 'browse') {
                    drawTabs();
                    if (tab === 'favorites') {
                        const k = focused ? keyOf(focused) : null;
                        drawGrid();
                        const e = k && focusables().find((x) => keyOf(x) === k);
                        setFocus(e || focusables()[0], { instant: true });
                    }
                }
                return;
            }
            if (what === 'lyrics') { if (view === 'playing' && rightPane === 'lyrics') paintLyrics(true); return; }
            if (view === 'album') {
                const k = focused ? keyOf(focused) : null;
                drawTracks();
                const e = k && focusables().find((x) => keyOf(x) === k);
                if (e) setFocus(e, { instant: true });
            } else if (view === 'artist') drawArtistAlbums();
        };
        const offModel = M().onChange(onModel);
        // Radio is its own model, loaded beside the library
        const offRadio = RM() ? RM().onChange((what) => {
            // a station's star changed: the stars on screen, not the lists
            if (what === 'favorites') { paintStars(); updateLegend(); }
            if (view === 'playing') { paintPlaying(); return; }
            if (view !== 'browse') return;
            drawTabs();
            if (tab !== 'radio') return;
            const k = focused ? keyOf(focused) : null;
            drawGrid();
            const e = k && focusables().find((x) => keyOf(x) === k);
            if (e) setFocus(e, { instant: true });
            drawHero();
        }) : () => {};
        if (RM()) RM().load().catch(() => {});

        // ----- loading / empty -----
        const setState = (kind) => {
            const box = $('.mu-state');
            root.dataset.state = kind || '';
            if (!kind) { box.classList.remove('show'); box.innerHTML = ''; return; }
            box.classList.add('show');
            if (kind === 'loading') box.innerHTML = `<b>Getting your music…</b>`;
            else if (kind === 'error') box.innerHTML = `<div class="mu-state-icon">${icon('cloud_off')}</div><b>Jellyfin didn't answer</b><span>Press <em>OK</em> to try again.</span>`;
            else if (kind === 'empty') {
                box.innerHTML = `
                    <div class="mu-state-icon">${icon('library_music')}</div>
                    <b>No music yet</b>
                    <span>${M().library()
                        ? 'The Music library is empty, or Jellyfin is still scanning it. Copy your music into the Music folder on the NAS — a folder per artist, a folder per album inside it — and it shows up here as soon as Jellyfin finds it.'
                        : 'Jellyfin has no Music library. In Jellyfin\'s Dashboard → Libraries, add one with content type <em>Music</em>, pointed at the folder with your music in it.'}</span>`;
            }
            updateLegend();
        };
        const render = () => {
            if (!M().loaded()) { setState(M().error() ? 'error' : 'loading'); return; }
            const any = M().albums().length || M().songs().length || M().playlists().length
                || (RM() && (RM().soma().length || RM().local().length));
            if (!any) {
                stage.querySelectorAll('.mu-view').forEach((x) => { x.innerHTML = ''; });
                setState('empty');
                setWash(null);
                return;
            }
            setState(null);
            // a tab with nothing in it isn't worth opening on
            if (!(TABS.find((t) => t.id === tab) || {}).list().length) {
                tab = (TABS.find((t) => (t.list() || []).length) || TABS[0]).id;
            }
            // #/music?album=… / ?np=1
            if (openWith) {
                const w = openWith;
                openWith = null;
                if (w.np && player().state().track) { view = 'playing'; viewFrom = ['browse']; }
                else if (w.id) {
                    const it = M().find(w.id);
                    if (it) { pageItem = it; viewFrom = ['browse']; view = (it.kind === 'artist' || it.kind === 'genre') ? 'artist' : 'album'; }
                }
            }
            const k = focused ? keyOf(focused) : null;
            if (view === 'browse') drawBrowse();
            else if (view === 'album') drawAlbum();
            else if (view === 'artist') drawArtist();
            else drawPlaying();
            stage.querySelectorAll('.mu-view').forEach((x) => x.classList.toggle('on', x === viewEl(view)));
            root.dataset.view = view;
            const e = k && focusables().find((x) => keyOf(x) === k);
            if (e) setFocus(e, { instant: true });
            else restoreFocus(view === 'browse' ? 'tab:' + tab : null);
            syncPill();
        };
        const reload = () => {
            setState(M().loaded() && M().albums().length ? null : 'loading');
            M().load(true).catch(() => { if (!M().albums().length) setState('error'); });
        };

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            const st = root.dataset.state;
            const s = player().state();
            if (st === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (focused && focused.dataset.okLabel) items.push({ key: 'OK', label: focused.dataset.okLabel, action: 'ok' });
            else if (focused) items.push({ key: 'OK', label: 'Select', action: 'ok' });
            if (s.track) items.push({ key: 'P', label: s.playing ? 'Pause' : 'Play', action: 'toggle' });
            if (s.track && view !== 'playing') items.push({ key: '▶', label: 'Now playing', action: 'np' });
            const favIt = favOf(focused) || subject();
            if (favIt && favIt.id) {
                items.push({ key: 'F', label: isFav(favIt) ? 'Unfavorite' : 'Favorite', action: 'fav' });
            }
            const onRadio = view === 'browse' && tab === 'radio';
            if (view === 'playing' && !s.live) items.push({ key: 'S', label: 'Shuffle', action: 'shuffle' }, { key: 'R', label: 'Repeat', action: 'repeat' });
            else if (onRadio || (view === 'playing' && s.live)) {
                const st = onRadio ? heroItem : null;
                if (st && st.kind === 'station') items.push({ key: 'O', label: 'Play on…', action: 'radio-on' });
                else if (view === 'playing' && s.live && s.track) items.push({ key: 'O', label: 'Play on…', action: 'radio-on' });
            } else items.push({ key: 'I', label: 'Instant Mix', action: 'mix' });
            items.push('spacer',
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: view !== 'browse' && s.playing ? 'Back (keeps playing)' : 'Back', action: 'back' });
            $('.mu-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="mu-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        const syncDocked = () => {
            root.classList.toggle('mu-docked', docked());
            updateLegend();
        };

        // ----- idle: music playing on a TV for hours -----
        let lastInput = Date.now();
        const IDLE_MS = 120000;
        const idleTimer = setInterval(() => {
            const idle = view === 'playing' && player().state().playing && Date.now() - lastInput > IDLE_MS;
            root.classList.toggle('mu-idle', idle);
            const lv = viewEl('playing');
            if (idle) lv.style.transform = `translate(${Math.round(Math.random() * 40 - 20)}px, ${Math.round(Math.random() * 30 - 15)}px)`;
            else if (lv.style.transform) lv.style.transform = '';
        }, 60000);
        const wake = () => {
            lastInput = Date.now();
            if (root.classList.contains('mu-idle')) {
                root.classList.remove('mu-idle');
                viewEl('playing').style.transform = '';
            }
        };

        // ----- input -----
        // what the focus is "on" for I (Instant Mix) and P with nothing loaded
        // the station the focus is on, if it is on one at all
        const radioSubject = () => {
            if (view === 'browse' && tab === 'radio' && heroItem && heroItem.kind === 'station') return heroItem;
            const s = player().state();
            if (view === 'playing' && s.track && s.track.live && RM()) return RM().station(s.track.stationId);
            return null;
        };
        const subject = () => {
            if (view === 'browse') return heroItem;
            if (view === 'album' || view === 'artist') return pageItem;
            return player().state().track;
        };
        const togglePlay = () => {
            const P = player();
            if (P.state().track) P.toggle();
            else playItem(subject(), false);
        };
        const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        const onKey = (ev) => {
            wake();
            if (document.getElementById('cg-root')) return; // the guide is on top
            if (PO() && PO().isOpen()) return; // Play on… is on top, and has its own keys
            // Typing in the Radio tab's search box: the letters are the search,
            // not HOMER's shortcuts. Enter searches, Esc or ▼ gives the keys back.
            if (ev.target && ev.target.classList && ev.target.classList.contains('mu-radio-input')) {
                const key = ev.key;
                if (key === 'Enter') { eat(ev); ev.target.blur(); runRadioSearch(); return; }
                if (key === 'Escape') {
                    eat(ev);
                    ev.target.blur();
                    if (radioQuery || radioResults) clearRadioSearch();
                    return;
                }
                if (key === 'ArrowDown' || key === 'ArrowUp') {
                    eat(ev);
                    ev.target.blur();
                    move(key === 'ArrowDown' ? 'down' : 'up');
                    return;
                }
                return; // everything else is a letter
            }
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            const P = player();
            if (k === 'h' || k === 'H') { eat(ev); if (!ev.repeat) goHome(); return; }
            if (BACK_KEYS.includes(k)) { eat(ev); if (!ev.repeat) back(); return; }
            if (k === 'p' || k === 'P' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') {
                eat(ev);
                if (!ev.repeat) togglePlay();
                return;
            }
            if (k === 'n' || k === 'N' || k === 'MediaTrackNext') { eat(ev); P.next(); return; }
            if (k === 'b' || k === 'B' || k === 'MediaTrackPrevious') { eat(ev); P.prev(); return; }
            if (k === 'MediaFastForward') { eat(ev); P.skip(10); return; }
            if (k === 'MediaRewind') { eat(ev); P.skip(-10); return; }
            if (k === 'MediaStop') { eat(ev); P.pause(); return; }
            if (k === 's' || k === 'S') { eat(ev); if (!ev.repeat) { P.toggleShuffle(); toast(P.state().shuffle ? 'Shuffle on' : 'Shuffle off'); } return; }
            if (k === 'r' || k === 'R') {
                eat(ev);
                if (!ev.repeat) { P.cycleRepeat(); const r = P.state().repeat; toast(r === 'off' ? 'Repeat off' : r === 'all' ? 'Repeat all' : 'Repeat one'); }
                return;
            }
            if (k === 'o' || k === 'O') {
                eat(ev);
                if (!ev.repeat) {
                    const st = radioSubject();
                    if (st) playOnStation(st);
                    else if (canPlayOn()) playOn(subject());
                }
                return;
            }
            if (k === 'i' || k === 'I') {
                eat(ev);
                if (!ev.repeat) {
                    const st = radioSubject();
                    if (st) playOnStation(st); // a station has no mix; the speaker picker is the useful thing
                    else instantMix(subject());
                }
                return;
            }
            // F stars the track the focus is on, or — with a button focused —
            // the album, artist or playlist the page is about
            if (k === 'f' || k === 'F') { eat(ev); if (!ev.repeat) toggleFav(favOf(focused) || subject()); return; }
            if (k === '+' || k === '=') { eat(ev); P.nudgeVolume(0.05); toast(`Volume ${Math.round(P.state().volume * 100)}%`); return; }
            if (k === '-' || k === '_') { eat(ev); P.nudgeVolume(-0.05); toast(`Volume ${Math.round(P.state().volume * 100)}%`); return; }
            const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
            if (dirs[k]) { eat(ev); move(dirs[k]); return; }
            if (k === 'Enter' || k === ' ') {
                eat(ev);
                if (ev.repeat) return;
                if (root.dataset.state === 'error') { reload(); return; }
                if (k === ' ' && view !== 'playing') { togglePlay(); return; }
                ok();
                return;
            }
            if (['PageUp', 'PageDown', 'Home', 'End'].includes(k)) eat(ev);
        };
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            const col = ev.target.closest && ev.target.closest('.mu-scroll-y, .mu-scroll-x');
            if (col) col.scrollBy({ top: ev.deltaY, left: ev.deltaX || (col.classList.contains('mu-scroll-x') ? ev.deltaY : 0) });
            ev.preventDefault();
            ev.stopImmediatePropagation();
        };
        const onClick = (ev) => {
            // a star is its own target: tapping one doesn't also start the track
            const st = ev.target.closest('.mu-star');
            if (st && root.contains(st)) {
                ev.stopPropagation();
                toggleFav(st._item || M().find(st.dataset.fav));
                return;
            }
            if (ev.target.closest('.mu-brand')) { goHome(); return; }
            if (ev.target.closest('.mu-np-pill')) { showView('playing'); return; }
            if (ev.target.closest('.mu-preview')) { const p = HP(); if (p && p.fullscreen) p.fullscreen(); return; }
            const leg = ev.target.closest('.mu-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') back();
                else if (a === 'ok') { if (root.dataset.state === 'error') reload(); else ok(); }
                else if (a === 'toggle') togglePlay();
                else if (a === 'np') showView('playing');
                else if (a === 'mix') instantMix(subject());
                else if (a === 'radio-on') { const st = radioSubject(); if (st) playOnStation(st); }
                else if (a === 'fav') toggleFav(favOf(focused) || subject());
                else if (a === 'shuffle') { player().toggleShuffle(); toast(player().state().shuffle ? 'Shuffle on' : 'Shuffle off'); }
                else if (a === 'repeat') player().cycleRepeat();
                return;
            }
            // a click on the progress bar seeks to that spot
            const seek = ev.target.closest('.mu-pl-track');
            if (seek) {
                const r = seek.getBoundingClientRect();
                const s = player().state();
                const dur = s.duration || (s.track && s.track.duration) || 0;
                if (dur) player().seek(((ev.clientX - r.left) / r.width) * dur);
                return;
            }
            const f = ev.target.closest('.mu-focusable');
            if (f && root.contains(f)) {
                if (f === focused) ok();
                else { setFocus(f); ok(); }
            }
        };
        const onMouse = (ev) => {
            wake();
            const f = ev.target.closest && ev.target.closest('.mu-focusable');
            if (f && f !== focused && root.contains(f) && !window.HomerLayout?.isTouch?.()) setFocus(f);
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);
        stage.addEventListener('mouseover', onMouse);

        // #/music?np=1 / ?album=<id>
        const q0 = currentRoute();
        let openWith = /[?&]np=1/.test(q0)
            ? { np: true }
            : (/[?&](album|id|artist)=([^&]+)/.exec(q0) ? { id: (/[?&](?:album|id|artist)=([^&]+)/.exec(q0) || [])[1] } : null);

        const startView = () => {
            view = 'browse';
            viewFrom = [];
            root.dataset.view = 'browse';
            remembered.browse = 'a:play';
            render();
        };

        // ----- the Actions strip (shared/actions.js) -----
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            if (root.dataset.state === 'error') out.push({ id: 'retry', icon: 'refresh', label: 'Try again', run: () => reload() });
            const s = player().state();
            const sub = subject();
            out.push({
                id: 'play',
                key: 'P',
                icon: s.playing ? 'pause' : 'play_arrow',
                label: s.track && s.playing ? 'Pause' : 'Play',
                sub: s.track ? s.track.name : sub ? sub.name : '',
                main: true,
                run: togglePlay,
                disabled: !s.track && !sub,
            });
            if (s.track) {
                out.push({ id: 'next', icon: 'skip_next', label: 'Next track', sub: s.next ? s.next.name : '', disabled: !s.next, run: () => s.next && player().next() });
                out.push({ id: 'shuffle', key: 'S', icon: 'shuffle', label: s.shuffle ? 'Shuffle off' : 'Shuffle on', run: () => player().toggleShuffle() });
                out.push({ id: 'repeat', key: 'R', icon: s.repeat === 'one' ? 'repeat_one' : 'repeat', label: 'Repeat', sub: s.repeat, run: () => player().cycleRepeat() });
            }
            if (sub && sub.kind !== 'track' && canPlayOn()) {
                out.push({ id: 'playon', icon: 'speaker', label: 'Play on…', sub: sub.name, run: () => playOn(sub) });
            }
            const favIt = favOf(focused) || sub;
            if (favIt && favIt.id) {
                const on = isFav(favIt);
                out.push({
                    id: 'fav',
                    key: 'F',
                    icon: on ? 'star' : 'star_border',
                    label: on ? 'Unfavorite' : 'Favorite',
                    sub: favIt.name,
                    run: () => toggleFav(favIt),
                });
            }
            if (sub) out.push({ id: 'mix', key: 'I', icon: 'radio', label: 'Instant Mix', sub: sub.name, run: () => instantMix(sub) });
            if (s.track && view !== 'playing') out.push({ id: 'np', icon: 'graphic_eq', label: 'Now playing', run: () => showView('playing') });
            return out;
        }, { id: 'music', title: onRadio ? 'Radio' : 'Music' }) : () => {};

        // The top of this screen (HomerLayout.setScreenHome): the phone's top
        // bar name and the menu's own Music (or Radio) item both come back
        // here. An open picker goes first, then an album, artist or Now
        // playing; the browse wall is the top and says so, so nothing claims a
        // press that has nowhere to go.
        const atTop = () => view === 'browse' && !(PO() && PO().isOpen());
        const offScreenHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (PO() && PO().isOpen()) { PO().close(); return true; }
                if (view === 'browse') return false;
                viewFrom = [];
                showView('browse', { back: true });
                return true;
            }, { atTop })
            : () => {};

        startView();
        syncDocked();
        reload();

        return {
            phone: false,
            radio: onRadio,
            show() { root.style.visibility = ''; },
            sync: syncDocked,
            teardown() {
                if (PO()) PO().close();
                offScreenHome();
                offActions();
                // leaving Music does NOT stop the music: that's the point.
                offModel();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearInterval(idleTimer);
            clearInterval(liveTimer);
            offRadio();
                clearTimeout(toastTimer);
                wxDetach();
                root.remove();
                if (window.HomerMusicStrip) window.HomerMusicStrip.sync();
            },
        };
    };

    // ---------- Stylesheets ----------

    let cssReady = null;
    const ensureCss = () => {
        if (!document.getElementById('homer-tokens')) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE + '../shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
        if (cssReady && document.getElementById('mu-css')) return cssReady;
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
        if (!document.getElementById('homer-playon-css')) {
            const po = document.createElement('link');
            po.id = 'homer-playon-css';
            po.rel = 'stylesheet';
            po.href = BASE + 'playon.css' + QUERY;
            document.head.appendChild(po);
        }
        cssReady = Promise.all([link('mu-css', 'music.css'), link('mu-phone-css', 'music-phone.css')]);
        return cssReady;
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false;
    let destroyed = false;

    const isOurRoute = () => /^#!?\/(music|radio)(\?|$)/i.test(currentRoute());
    // #/radio: the same screen, drawn as Radio
    const radioRoute = () => /^#!?\/radio(\?|$)/i.test(currentRoute());

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const phoneLayout = () => !!(window.HomerLayout && window.HomerMusicPhone && window.HomerLayout.usePhone('music'));
    const PHONE_CTX = { goHome, goBack, go, docked, esc, icon, artImg, metaOf, subOf };
    const draw = () => (phoneLayout()
        ? window.HomerMusicPhone.create(Object.assign({ radio: radioRoute() }, PHONE_CTX))
        : createScreen());

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed || !M()) {
            closeScreen();
            return;
        }
        // #/music <-> #/radio is a different face of the same screen: redraw
        if (screen && screen.radio !== undefined && screen.radio !== radioRoute()) closeScreen();
        if (screen) { screen.sync(); return; }
        const s = draw();
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    const onLayout = () => {
        if (!screen || screen.phone === phoneLayout()) return;
        closeScreen();
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
    const onRouteChange = () => {
        lastSig = '';
        queueSync();
    };

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

    window.HomerMusic = {
        version: VERSION,
        open() {
            suppressed = false;
            if (!isOurRoute()) { go('#/music'); return; }
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
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('mu-css')?.remove();
            document.getElementById('mu-phone-css')?.remove();
            cssReady = null;
        },
    };
})();
