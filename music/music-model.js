/*
 * HOMER Music: the library's data and the audio player, shared by the TV
 * screen (music/music.js), the phone layout (music/music-phone.js) and the
 * now-playing strip that follows you around HOMER (music/music-strip.js).
 *
 * Where the music comes from: Jellyfin, and only Jellyfin. A library of
 * content type "music" holds it. Everything here is one of Jellyfin's own
 * endpoints:
 *
 *   /Users/{uid}/Views                      the Music library
 *   /Users/{uid}/Items?IncludeItemTypes=MusicAlbum|Audio|Playlist
 *   /Artists/AlbumArtists                   the artists
 *   /MusicGenres                            the genres
 *   /Playlists/{id}/Items                   a playlist's tracks
 *   /Items/{id}/InstantMix                  "radio from this"
 *   /Audio/{id}/universal                   the stream
 *   /Audio/{id}/Lyrics                      synced (or plain) lyrics
 *   /UserItems/{id}/UserData                a favourite, set and cleared
 *   /Sessions/Playing[/Progress|/Stopped]   what's playing, told to the server
 *
 * The player is one <audio> element on document.body, owned by this file and
 * not by any screen, so music keeps playing while you move around HOMER. It
 * holds a queue (a shuffle order beside it, so turning shuffle off puts the
 * album back in order), repeat off/all/one, volume, and reports to Jellyfin
 * like any other client. Starting music stops HOMER's video; starting a video
 * pauses the music.
 *
 * Gapless: not really. The next track is preloaded in a second <audio> while
 * the current one finishes, which makes the join short, but the two aren't
 * stitched sample-accurate the way a gapless player would.
 *
 * Favourites are Jellyfin's own, not HOMER's: a star here is a star in every
 * other Jellyfin client, and every item HOMER already fetches carries its
 * UserData.IsFavorite, so nothing is asked twice.
 *
 * window.HomerMusicModel = { load, library, albums, artists, songs, playlists,
 *   genres, recent, favorites, albumTracks, artistAlbums, artistSongs,
 *   genreAlbums, playlistTracks, instantMix, lyrics, art, player, fmt,
 *   isFavorite, setFavorite, toggleFavorite, onChange, destroy }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerMusicModel && typeof window.HomerMusicModel.destroy === 'function') {
        window.HomerMusicModel.destroy();
    }

    const TICKS = 10000000; // Jellyfin's ticks per second
    const PROGRESS_MS = 10000;
    const VOL_KEY = 'homer-music-volume';
    const REPEAT_KEY = 'homer-music-repeat';
    const SHUFFLE_KEY = 'homer-music-shuffle';
    const REPEATS = ['off', 'all', 'one'];

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
    const deviceId = () => {
        try {
            const ac = window.ApiClient;
            if (ac && ac.deviceId) return ac.deviceId();
        } catch { /* below */ }
        return 'homer-music';
    };
    const api = async (path, opts = {}) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const headers = { Authorization: authHeader(server) };
        if (opts.body) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, {
            method: opts.method || 'GET',
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            keepalive: !!opts.keepalive,
        });
        if (res.status === 404 && opts.soft) return null;
        if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} → ${res.status}`);
        const t = await res.text();
        return t ? JSON.parse(t) : null;
    };
    const post = (path, body, keepalive) => api(path, { method: 'POST', body, keepalive })
        .catch((err) => console.warn('[HOMER Music]', err.message));

    // ---------- Small helpers ----------

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };
    const listeners = new Set();
    const emit = (what) => listeners.forEach((fn) => {
        try { fn(what); } catch (err) { console.error('[HOMER Music]', err); }
    });

    // "4:07", "1:02:30"
    const fmtClock = (sec) => {
        sec = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };
    // "1 h 12 m", "47 m", "3 m"
    const fmtLen = (sec) => {
        sec = Math.max(0, Math.round(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        if (h && m === 60) return `${h + 1} h`;
        if (h) return m ? `${h} h ${m} m` : `${h} h`;
        return `${Math.max(1, m)} m`;
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
    const fmt = { clock: fmtClock, len: fmtLen, time: fmtTime, plural };

    // ---------- Normalizing Jellyfin's items ----------

    const artists = (it) => {
        const list = (it.ArtistItems && it.ArtistItems.length ? it.ArtistItems.map((a) => a.Name) : null)
            || it.Artists
            || (it.AlbumArtist ? [it.AlbumArtist] : []);
        return [...new Set((list || []).filter(Boolean))];
    };
    const albumArtist = (it) => (it.AlbumArtists && it.AlbumArtists[0] && it.AlbumArtists[0].Name)
        || it.AlbumArtist || artists(it)[0] || '';

    // a track
    const track = (it) => ({
        kind: 'track',
        id: it.Id,
        name: it.Name || '',
        artists: artists(it),
        artist: artists(it)[0] || it.AlbumArtist || '',
        albumArtist: albumArtist(it),
        artistIds: (it.ArtistItems || []).map((a) => a.Id),
        album: it.Album || '',
        albumId: it.AlbumId || '',
        albumTag: it.AlbumPrimaryImageTag || '',
        imageTag: (it.ImageTags && it.ImageTags.Primary) || '',
        no: it.IndexNumber || null,
        disc: it.ParentIndexNumber || null,
        duration: (it.RunTimeTicks || 0) / TICKS,
        year: it.ProductionYear || null,
        genres: it.Genres || [],
        plays: (it.UserData && it.UserData.PlayCount) || 0,
        favorite: !!(it.UserData && it.UserData.IsFavorite),
        mediaSourceId: ((it.MediaSources || [])[0] || {}).Id || it.Id,
        container: ((it.MediaSources || [])[0] || {}).Container || '',
        bitrate: ((it.MediaSources || [])[0] || {}).Bitrate || 0,
        hasLyrics: it.HasLyrics === true || !!(it.MediaStreams || []).some((s) => s.Type === 'Lyric'),
    });
    // an album
    const album = (it) => ({
        kind: 'album',
        id: it.Id,
        name: it.Name || '',
        artist: albumArtist(it),
        artists: artists(it),
        artistIds: (it.AlbumArtists || it.ArtistItems || []).map((a) => a.Id),
        year: it.ProductionYear || (it.PremiereDate ? new Date(it.PremiereDate).getFullYear() : null),
        imageTag: (it.ImageTags && it.ImageTags.Primary) || '',
        genres: it.Genres || [],
        tracks: it.ChildCount || 0,
        duration: (it.RunTimeTicks || 0) / TICKS,
        added: it.DateCreated ? Date.parse(it.DateCreated) : 0,
        favorite: !!(it.UserData && it.UserData.IsFavorite),
        overview: (it.Overview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    // an artist, a genre, a playlist: the same shape, drawn the same way
    const named = (kind) => (it) => ({
        kind,
        id: it.Id,
        name: it.Name || '',
        imageTag: (it.ImageTags && it.ImageTags.Primary) || '',
        tracks: it.ChildCount || 0,
        duration: (it.RunTimeTicks || 0) / TICKS,
        added: it.DateCreated ? Date.parse(it.DateCreated) : 0,
        overview: (it.Overview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });

    const TRACK_FIELDS = 'Fields=MediaSources,Genres,ProductionYear,DateCreated,ParentIndexNumber';
    const ALBUM_FIELDS = 'Fields=Genres,ProductionYear,PremiereDate,DateCreated,ChildCount,Overview,AlbumArtists';
    const IMAGES = 'EnableImageTypes=Primary&ImageTypeLimit=1&EnableUserData=true';

    // ---------- The library ----------

    let library = null; // the Music view, or null when there's none
    let loaded = false;
    let loading = null;
    let lastError = null;
    let counts = { albums: 0, songs: 0, artists: 0 };

    const lists = { albums: [], artists: [], songs: [], playlists: [], genres: [], recent: [], favorites: [] };
    const jobs = new Map(); // one request per key at a time
    const once = (key, fn) => {
        if (jobs.has(key)) return jobs.get(key);
        const job = fn().finally(() => jobs.delete(key));
        jobs.set(key, job);
        return job;
    };

    const uid = () => { const s = getServer(); return s ? s.UserId : ''; };
    const parent = () => (library ? `&ParentId=${library.Id}` : '');

    const items = async (query) => {
        const res = await api(`/Users/${uid()}/Items?${query}`);
        return (res && res.Items) || [];
    };

    // Everything the browse screen shows, in one go. Big libraries get a cap
    // per list: the screen is a wall of album art, not a spreadsheet.
    const LIMIT = { albums: 600, songs: 1500, artists: 600 };
    const load = (force) => {
        if (loading) return loading;
        if (loaded && !force) return Promise.resolve(lists);
        if (!getServer()) return Promise.reject(new Error('Not signed in'));
        loading = (async () => {
            const views = await api(`/Users/${uid()}/Views`);
            library = ((views && views.Items) || []).find((v) => v.CollectionType === 'music') || null;
            const [al, ar, so, pl, ge, fav] = await Promise.all([
                items(`IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=AlbumArtist,SortName&Limit=${LIMIT.albums}&${IMAGES}&${ALBUM_FIELDS}${parent()}`),
                api(`/Artists/AlbumArtists?userId=${uid()}&Recursive=true&SortBy=SortName&Limit=${LIMIT.artists}&${IMAGES}${parent()}`)
                    .then((r) => (r && r.Items) || []).catch(() => []),
                items(`IncludeItemTypes=Audio&Recursive=true&SortBy=SortName&Limit=${LIMIT.songs}&${IMAGES}&${TRACK_FIELDS}${parent()}`),
                items(`IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&${IMAGES}&Fields=ChildCount,DateCreated`)
                    .then((r) => r.filter((p) => !p.MediaType || p.MediaType === 'Audio')).catch(() => []),
                api(`/MusicGenres?userId=${uid()}&Recursive=true&SortBy=SortName&${IMAGES}${parent()}`)
                    .then((r) => (r && r.Items) || []).catch(() => []),
                items(`IncludeItemTypes=Audio&Recursive=true&Filters=IsFavorite&SortBy=AlbumArtist,Album,ParentIndexNumber,IndexNumber&Limit=${LIMIT.songs}&${IMAGES}&${TRACK_FIELDS}${parent()}`)
                    .catch(() => []),
            ]);
            lists.albums = al.map(album);
            lists.artists = ar.map(named('artist'));
            lists.songs = so.map(track);
            lists.playlists = pl.map(named('playlist'));
            lists.genres = ge.map(named('genre'));
            lists.recent = lists.albums.slice().sort((a, b) => b.added - a.added).slice(0, 60);
            lists.favorites = fav.map(track);
            favs.clear();
            lists.favorites.forEach((t) => favs.set(t.id, true));
            // everything else HOMER fetched says so too, so a star is right
            // the moment a list is drawn rather than after a round trip
            [...lists.songs, ...lists.albums, ...lists.artists].forEach((x) => {
                if (x.favorite) favs.set(x.id, true);
            });
            counts = { albums: lists.albums.length, songs: lists.songs.length, artists: lists.artists.length };
            loaded = true;
            lastError = null;
            emit('library');
            return lists;
        })().catch((err) => {
            lastError = err;
            emit('error');
            throw err;
        }).finally(() => { loading = null; });
        return loading;
    };

    const albumById = (id) => lists.albums.find((a) => a.id === id) || null;
    const trackById = (id) => lists.songs.find((t) => t.id === id) || null;
    const find = (id) => albumById(id) || trackById(id)
        || lists.artists.find((a) => a.id === id)
        || lists.playlists.find((a) => a.id === id)
        || lists.genres.find((a) => a.id === id)
        || null;

    // ---------- The pages: an album's tracks, an artist's albums ----------

    const cache = new Map(); // key -> array
    const cached = (key, fn) => {
        if (cache.has(key)) return Promise.resolve(cache.get(key));
        return once(key, async () => {
            const v = await fn();
            cache.set(key, v);
            emit('page');
            return v;
        });
    };
    const albumTracks = (id) => cached('album:' + id, () => items(
        `ParentId=${id}&IncludeItemTypes=Audio&SortBy=ParentIndexNumber,IndexNumber,SortName&${IMAGES}&${TRACK_FIELDS}`
    ).then((r) => r.map(track)));
    const artistAlbums = (id) => cached('artist-albums:' + id, () => items(
        `AlbumArtistIds=${id}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=PremiereDate,ProductionYear,SortName&SortOrder=Descending&${IMAGES}&${ALBUM_FIELDS}`
    ).then((r) => r.map(album)));
    const artistSongs = (id) => cached('artist-songs:' + id, () => items(
        `ArtistIds=${id}&IncludeItemTypes=Audio&Recursive=true&SortBy=PlayCount,SortName&SortOrder=Descending&Limit=12&${IMAGES}&${TRACK_FIELDS}`
    ).then((r) => r.map(track)));
    const genreAlbums = (id) => cached('genre:' + id, () => items(
        `GenreIds=${id}&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=AlbumArtist,SortName&${IMAGES}&${ALBUM_FIELDS}${parent()}`
    ).then((r) => r.map(album)));
    const playlistTracks = (id) => cached('playlist:' + id, () => api(
        `/Playlists/${id}/Items?userId=${uid()}&${IMAGES}&${TRACK_FIELDS}`
    ).then((r) => ((r && r.Items) || []).map(track)));
    // every track by an artist, in album order: what Play on an artist plays
    const artistAllSongs = (id) => cached('artist-all:' + id, () => items(
        `ArtistIds=${id}&IncludeItemTypes=Audio&Recursive=true&SortBy=Album,ParentIndexNumber,IndexNumber&${IMAGES}&${TRACK_FIELDS}`
    ).then((r) => r.map(track)));
    const genreSongs = (id) => cached('genre-songs:' + id, () => items(
        `GenreIds=${id}&IncludeItemTypes=Audio&Recursive=true&SortBy=Album,ParentIndexNumber,IndexNumber&Limit=500&${IMAGES}&${TRACK_FIELDS}${parent()}`
    ).then((r) => r.map(track)));

    // "radio from this": Jellyfin builds a mix around an album, artist, genre
    // or track. It wants the item's own id, whatever kind it is.
    const instantMix = (item) => api(
        `/Items/${item.id}/InstantMix?userId=${uid()}&Limit=150&${IMAGES}&${TRACK_FIELDS}`
    ).then((r) => ((r && r.Items) || []).map(track));

    // ---------- Favourites ----------
    //
    // Jellyfin's own, so a star set here is set in Jellyfin Web, Swiftfin and
    // anywhere else, and a star set there is already on the items HOMER
    // fetches (UserData.IsFavorite, which the lists ask for with
    // EnableUserData=true). `favs` is the one truth while this page is open:
    // a tap writes to it first so the star flips under the finger, and the
    // server's own answer is written back over it.
    //
    // 10.11 moved the call to POST /UserItems/{id}/UserData with the whole
    // UserData in the body. The older POST/DELETE /Users/{uid}/FavoriteItems/
    // {id} still answers, and is the fallback, so an older server keeps
    // working.
    const favs = new Map(); // item id -> true | false

    const isFavorite = (it) => {
        const id = typeof it === 'string' ? it : (it && it.id);
        if (!id) return false;
        if (favs.has(id)) return favs.get(id);
        return !!(it && it.favorite);
    };

    // keep the copies in every list honest, so a redraw from any of them agrees
    const markFavorite = (id, on) => {
        favs.set(id, on);
        const touch = (x) => { if (x && x.id === id) x.favorite = on; };
        Object.values(lists).forEach((l) => l.forEach(touch));
        cache.forEach((l) => Array.isArray(l) && l.forEach(touch));
        player.state().queue.forEach(touch);
    };
    // the Favourites list follows the stars without re-asking the server
    const restackFavorites = (item, on) => {
        if (!item || item.kind !== 'track') return;
        const at = lists.favorites.findIndex((t) => t.id === item.id);
        if (on && at < 0) lists.favorites = lists.favorites.concat([Object.assign({}, item, { favorite: true })]);
        else if (!on && at >= 0) lists.favorites = lists.favorites.filter((t) => t.id !== item.id);
    };

    // setFavorite(item, on) — the star moves at once; the promise says whether
    // Jellyfin agreed, and puts it back if it didn't.
    const setFavorite = (item, on) => {
        const id = typeof item === 'string' ? item : (item && item.id);
        if (!id) return Promise.reject(new Error('No item'));
        const was = isFavorite(item);
        const want = on == null ? !was : !!on;
        if (want === was) return Promise.resolve(want);
        markFavorite(id, want);
        restackFavorites(typeof item === 'string' ? trackById(id) : item, want);
        emit('favorite');
        // no `soft` here: a 404 has to throw, so the older call gets its turn
        const modern = () => api(`/UserItems/${id}/UserData?userId=${uid()}`, {
            method: 'POST', body: { IsFavorite: want },
        });
        const classic = () => api(`/Users/${uid()}/FavoriteItems/${id}`, { method: want ? 'POST' : 'DELETE' });
        return modern()
            .catch(() => classic())
            .then((res) => {
                // Jellyfin answers with the item's UserData: believe that, not us
                const said = res && typeof res.IsFavorite === 'boolean' ? res.IsFavorite : want;
                if (said !== want) {
                    markFavorite(id, said);
                    restackFavorites(typeof item === 'string' ? trackById(id) : item, said);
                }
                emit('favorite');
                return said;
            })
            .catch((err) => {
                markFavorite(id, was); // Jellyfin said no: put the star back
                restackFavorites(typeof item === 'string' ? trackById(id) : item, was);
                emit('favorite');
                throw err;
            });
    };
    const toggleFavorite = (item) => setFavorite(item, !isFavorite(item));

    // ---------- Lyrics ----------

    // Jellyfin returns { Lyrics: [{ Start: ticks, Text }] }. With no Start, the
    // file was plain text and there's nothing to sync to.
    const lyricCache = new Map();
    const lyrics = (id) => {
        if (lyricCache.has(id)) return Promise.resolve(lyricCache.get(id));
        return once('lyrics:' + id, async () => {
            let out = null;
            try {
                const r = await api(`/Audio/${id}/Lyrics`, { soft: true });
                const lines = (r && r.Lyrics) || [];
                if (lines.length) {
                    const synced = lines.some((l) => l.Start != null);
                    out = {
                        synced,
                        lines: lines.map((l) => ({
                            at: l.Start != null ? l.Start / TICKS : null,
                            text: String(l.Text || '').trim(),
                        })),
                    };
                }
            } catch (err) {
                console.warn('[HOMER Music] lyrics', err.message);
            }
            lyricCache.set(id, out);
            emit('lyrics');
            return out;
        });
    };
    // which line is lit at this second (-1 before the first one)
    const lyricAt = (l, sec) => {
        if (!l || !l.synced) return -1;
        let i = -1;
        for (let k = 0; k < l.lines.length; k++) {
            if (l.lines[k].at != null && l.lines[k].at <= sec + 0.15) i = k; else break;
        }
        return i;
    };

    // ---------- Art ----------

    // An album cover, wherever it lives: the item's own image, its album's, or
    // (for a track with neither) nothing.
    const art = (it, h) => {
        if (!it) return '';
        const size = `fillHeight=${h || 480}&fillWidth=${h || 480}&quality=90`;
        if (it.imageTag) return `/Items/${it.id}/Images/Primary?${size}&tag=${encodeURIComponent(it.imageTag)}`;
        if (it.albumId && it.albumTag) return `/Items/${it.albumId}/Images/Primary?${size}&tag=${encodeURIComponent(it.albumTag)}`;
        if (it.albumId) {
            const a = albumById(it.albumId);
            if (a && a.imageTag) return `/Items/${a.id}/Images/Primary?${size}&tag=${encodeURIComponent(a.imageTag)}`;
        }
        return '';
    };

    // The cover's most vivid color, lifted so it reads on navy. Same idea as
    // Books': pixels bucketed by hue, weighted by saturation and brightness.
    const colorJobs = new Map();
    const colors = new Map(); // url -> [r,g,b]
    const color = (it) => {
        const url = art(it, 120);
        if (!url) return Promise.resolve(null);
        if (colors.has(url)) return Promise.resolve(colors.get(url));
        if (colorJobs.has(url)) return colorJobs.get(url);
        const job = new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = c.height = 32;
                    const g = c.getContext('2d', { willReadFrequently: true });
                    g.drawImage(img, 0, 0, 32, 32);
                    const px = g.getImageData(0, 0, 32, 32).data;
                    const buckets = new Array(24).fill(null).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
                    const avg = [0, 0, 0];
                    for (let i = 0; i < px.length; i += 4) {
                        const r = px[i]; const gg = px[i + 1]; const bb = px[i + 2];
                        avg[0] += r; avg[1] += gg; avg[2] += bb;
                        const mx = Math.max(r, gg, bb); const mn = Math.min(r, gg, bb);
                        const s = mx ? (mx - mn) / mx : 0;
                        const v = mx / 255;
                        if (s < 0.22 || v < 0.18) continue;
                        const d = mx - mn;
                        let h;
                        if (mx === r) h = ((gg - bb) / d) % 6;
                        else if (mx === gg) h = (bb - r) / d + 2;
                        else h = (r - gg) / d + 4;
                        h = (h * 60 + 360) % 360;
                        const w = s * s * v;
                        const bk = buckets[Math.floor(h / 15)];
                        bk.w += w; bk.r += r * w; bk.g += gg * w; bk.b += bb * w;
                    }
                    const best = buckets.reduce((a, x) => (x.w > a.w ? x : a), { w: 0 });
                    const n = px.length / 4;
                    let rgb = best.w > 2 ? [best.r / best.w, best.g / best.w, best.b / best.w] : avg.map((x) => x / n);
                    const mx = Math.max(...rgb, 1);
                    if (mx < 170) rgb = rgb.map((x) => x * (170 / mx));
                    rgb = rgb.map((x) => Math.round(Math.min(255, x)));
                    colors.set(url, rgb);
                    resolve(rgb);
                } catch {
                    resolve(null); // a cover that isn't CORS-clean: no wash
                }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        }).finally(() => colorJobs.delete(url));
        colorJobs.set(url, job);
        return job;
    };

    // ---------- The player ----------

    const player = (() => {
        let audio = null;
        let pre = null; // the next track, loading while this one finishes
        let queue = [];
        let order = []; // indexes into queue: the order it plays in
        let pos = -1; // where in order
        let source = null; // { kind, id, name } — what the queue came from
        let session = '';
        let started = false;
        let lastReport = 0;
        let pendingSeek = null;
        let error = null;
        let offHP = null;
        let watchdog = null;
        let shuffle = !!store.get(SHUFFLE_KEY, false);
        let repeat = REPEATS.includes(store.get(REPEAT_KEY, 'off')) ? store.get(REPEAT_KEY, 'off') : 'off';
        let volume = Math.max(0, Math.min(1, +store.get(VOL_KEY, 1)));
        let muted = false;

        const cur = () => (pos >= 0 && pos < order.length ? queue[order[pos]] : null);
        const nextTrack = () => {
            if (!queue.length) return null;
            if (repeat === 'one') return cur();
            if (pos + 1 < order.length) return queue[order[pos + 1]];
            return repeat === 'all' ? queue[order[0]] : null;
        };

        const streamUrl = (t) => {
            const server = getServer();
            const q = new URLSearchParams({
                UserId: server ? server.UserId : '',
                DeviceId: deviceId(),
                MaxStreamingBitrate: '320000000',
                Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
                TranscodingContainer: 'ts',
                TranscodingProtocol: 'hls',
                AudioCodec: 'aac',
                api_key: server ? server.AccessToken : '',
                PlaySessionId: session || 'homer',
                StartTimeTicks: '0',
                EnableRedirection: 'true',
                EnableRemoteMedia: 'false',
            });
            return `/Audio/${t.id}/universal?${q}`;
        };

        const ensure = () => {
            if (audio) return audio;
            audio = document.createElement('audio');
            audio.id = 'homer-music-audio';
            audio.preload = 'auto';
            audio.style.display = 'none';
            audio.volume = volume;
            document.body.appendChild(audio);
            ['play', 'pause', 'seeked', 'ended', 'error', 'loadedmetadata', 'waiting', 'playing', 'volumechange']
                .forEach((ev) => audio.addEventListener(ev, () => onAudio(ev)));
            audio.addEventListener('timeupdate', onTime);
            pre = document.createElement('audio');
            pre.id = 'homer-music-preload';
            pre.preload = 'auto';
            pre.muted = true;
            pre.style.display = 'none';
            document.body.appendChild(pre);
            return audio;
        };

        const at = () => (audio && cur() ? (pendingSeek != null ? pendingSeek : audio.currentTime) : 0);
        const ticks = (sec) => Math.round(sec * TICKS);
        const body = (extra) => {
            const t = cur();
            return Object.assign({
                ItemId: t.id,
                MediaSourceId: t.mediaSourceId,
                PlaySessionId: session,
                PositionTicks: ticks(at()),
                IsPaused: !audio || audio.paused,
                IsMuted: muted,
                VolumeLevel: Math.round(volume * 100),
                CanSeek: true,
                PlayMethod: 'DirectPlay',
                RepeatMode: repeat === 'one' ? 'RepeatOne' : repeat === 'all' ? 'RepeatAll' : 'RepeatNone',
                ShuffleMode: shuffle ? 'Shuffle' : 'Sorted',
                NowPlayingQueue: order.map((i, k) => ({ Id: queue[i].id, PlaylistItemId: 'homer' + k })),
            }, extra || {});
        };
        const report = (kind, keepalive) => {
            if (!cur()) return;
            lastReport = Date.now();
            if (kind === 'start') { started = true; post('/Sessions/Playing', body(), keepalive); }
            else if (kind === 'stop') { if (started) post('/Sessions/Playing/Stopped', body(), keepalive); started = false; }
            else if (started) post('/Sessions/Playing/Progress', body({ EventName: kind }), keepalive);
        };

        const state = () => ({
            track: cur(),
            next: nextTrack(),
            queue: order.map((i) => queue[i]),
            index: pos,
            count: order.length,
            source,
            playing: !!(audio && cur() && !audio.paused),
            buffering: !!(audio && cur() && !audio.paused && audio.readyState < 3),
            position: at(),
            duration: (audio && isFinite(audio.duration) && audio.duration) || (cur() && cur().duration) || 0,
            volume,
            muted,
            shuffle,
            repeat,
            error,
        });
        const changed = () => emit('player');

        // preload the next track once this one is nearly over, so the join is short
        let preloadedId = '';
        const preload = () => {
            const n = nextTrack();
            if (!pre || !n || n === cur() || preloadedId === n.id) return;
            preloadedId = n.id;
            pre.src = streamUrl(n);
            try { pre.load(); } catch { /* the browser will get it on play */ }
        };

        const onAudio = (ev) => {
            if (!cur()) return;
            if (ev === 'loadedmetadata') {
                if (pendingSeek != null) {
                    audio.currentTime = Math.min(pendingSeek, Math.max(0, (audio.duration || pendingSeek) - 0.5));
                    pendingSeek = null;
                }
            } else if (ev === 'playing') {
                error = null;
                clearTimeout(watchdog);
                if (!started) report('start');
            } else if (ev === 'pause') {
                if (!audio.ended) report('pause');
            } else if (ev === 'play') {
                if (started) report('unpause');
            } else if (ev === 'seeked') {
                report('timeupdate');
            } else if (ev === 'ended') {
                advance(1, true);
                return;
            } else if (ev === 'error') {
                clearTimeout(watchdog);
                error = (audio.error && audio.error.message) || 'That track didn\'t play';
                console.warn('[HOMER Music] audio', error);
            } else if (ev === 'volumechange') {
                if (audio.volume !== volume) { volume = audio.volume; store.set(VOL_KEY, volume); }
            }
            changed();
        };
        const onTime = () => {
            if (!cur() || !audio || audio.paused) return;
            if (Date.now() - lastReport > PROGRESS_MS) report('timeupdate');
            const d = audio.duration;
            if (isFinite(d) && d - audio.currentTime < 20) preload();
            changed();
        };

        // a video starting (HomerPlayer) pauses the music
        const watchVideo = () => {
            const HP = window.HomerPlayer;
            if (offHP || !HP || typeof HP.onChange !== 'function') return;
            offHP = HP.onChange(() => {
                const np = HP.nowPlaying && HP.nowPlaying();
                if (np && audio && !audio.paused) audio.pause();
            }) || null;
        };
        const stopVideo = () => {
            const HP = window.HomerPlayer;
            try {
                if (HP && (HP.docked() || HP.nowPlaying())) HP.stop();
            } catch { /* nothing playing */ }
        };

        // ----- the queue -----

        const shuffled = (n, first) => {
            const a = [];
            for (let i = 0; i < n; i++) if (i !== first) a.push(i);
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return first == null ? a : [first].concat(a);
        };
        const buildOrder = (start) => {
            order = shuffle ? shuffled(queue.length, start) : queue.map((_, i) => i);
            pos = shuffle ? 0 : Math.max(0, start || 0);
        };

        const loadTrack = (t, autoplay) => {
            ensure();
            session = Math.random().toString(36).slice(2) + Date.now().toString(36);
            started = false;
            error = null;
            pendingSeek = null;
            preloadedId = '';
            const url = streamUrl(t);
            // the preloader already has it: hand the buffer over
            audio.src = url;
            audio.load();
            audio.volume = muted ? 0 : volume;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                if (cur() !== t || audio.readyState >= 2) return;
                audio.pause();
                error = 'Jellyfin isn\'t sending this track.';
                changed();
            }, 25000);
            if (autoplay !== false) {
                audio.play().catch((err) => {
                    if (err && err.name === 'AbortError') return;
                    error = err && err.name === 'NotAllowedError'
                        ? 'Press OK to play (the browser wants a key press first)'
                        : (err && err.message) || 'That track didn\'t play';
                    changed();
                });
            }
            lyrics(t.id);
            changed();
        };

        // play a list from one of its tracks
        const play = (tracks, index, opts = {}) => {
            const list = (tracks || []).filter(Boolean);
            if (!list.length) return;
            ensure();
            watchVideo();
            stopVideo();
            if (cur()) report('stop');
            queue = list;
            source = opts.source || null;
            if (opts.shuffle != null && opts.shuffle !== shuffle) {
                shuffle = !!opts.shuffle;
                store.set(SHUFFLE_KEY, shuffle);
            }
            buildOrder(Math.max(0, Math.min(list.length - 1, index || 0)));
            loadTrack(cur());
        };
        // add to what's playing (or start it, when nothing is)
        const queueNext = (tracks) => {
            const list = (tracks || []).filter(Boolean);
            if (!list.length) return;
            if (!queue.length) { play(list, 0); return; }
            const before = queue.length;
            queue = queue.concat(list);
            const add = list.map((_, i) => before + i);
            order = order.slice(0, pos + 1).concat(add, order.slice(pos + 1));
            changed();
        };

        const advance = (dir, auto) => {
            if (!queue.length) return;
            if (auto && repeat === 'one') { seek(0); audio.play().catch(() => {}); return; }
            report('stop');
            const last = pos;
            if (dir > 0) {
                if (pos + 1 < order.length) pos += 1;
                else if (repeat === 'all') pos = 0;
                else {
                    // the end of the queue: stop, but keep it so the strip still shows it
                    if (audio && !audio.paused) audio.pause();
                    if (auto) { pos = last; seek(0); }
                    changed();
                    return;
                }
            } else if (pos > 0) pos -= 1;
            else if (repeat === 'all') pos = order.length - 1;
            else { seek(0); return; }
            loadTrack(cur());
        };

        const pause = () => { if (audio && cur() && !audio.paused) audio.pause(); };
        const resume = () => {
            if (!cur()) return;
            ensure();
            watchVideo();
            stopVideo();
            audio.play().catch((err) => {
                error = err && err.name === 'NotAllowedError'
                    ? 'Press OK to play (the browser wants a key press first)'
                    : (err && err.message) || 'That track didn\'t play';
                changed();
            });
        };
        const toggle = () => { if (!cur()) return; if (audio.paused) resume(); else pause(); };
        const seek = (sec) => {
            if (!audio || !cur()) return;
            const d = state().duration || Infinity;
            sec = Math.max(0, Math.min(sec, d - 0.5));
            if (audio.readyState < 1) { pendingSeek = sec; changed(); return; }
            audio.currentTime = sec;
            changed();
        };
        const skip = (delta) => seek(at() + delta);
        // Previous: back to the start of this track, or the one before if
        // you're barely into it (what every music player does)
        const prev = () => { if (at() > 4) seek(0); else advance(-1); };
        const next = () => advance(1);
        const jump = (i) => {
            if (i < 0 || i >= order.length) return;
            report('stop');
            pos = i;
            loadTrack(cur());
        };

        const setVolume = (v) => {
            volume = Math.max(0, Math.min(1, v));
            muted = false;
            store.set(VOL_KEY, volume);
            if (audio) audio.volume = volume;
            changed();
        };
        const nudgeVolume = (d) => setVolume(volume + d);
        const toggleMute = () => {
            muted = !muted;
            if (audio) audio.volume = muted ? 0 : volume;
            changed();
        };
        const toggleShuffle = () => {
            const t = cur();
            shuffle = !shuffle;
            store.set(SHUFFLE_KEY, shuffle);
            if (queue.length) {
                const i = t ? queue.indexOf(t) : 0;
                if (shuffle) { order = shuffled(queue.length, i); pos = 0; }
                else { order = queue.map((_, k) => k); pos = Math.max(0, i); }
            }
            preloadedId = '';
            changed();
        };
        const cycleRepeat = () => {
            repeat = REPEATS[(REPEATS.indexOf(repeat) + 1) % REPEATS.length];
            store.set(REPEAT_KEY, repeat);
            changed();
        };

        const stop = (keepalive) => {
            clearTimeout(watchdog);
            if (!cur()) return;
            if (audio && !audio.paused) audio.pause();
            report('stop', keepalive);
            queue = [];
            order = [];
            pos = -1;
            source = null;
            if (audio) { audio.removeAttribute('src'); audio.load(); }
            if (pre) { pre.removeAttribute('src'); preloadedId = ''; }
            changed();
        };

        // Jellyfin Web fires `pagehide` on its own in-app navigations (moving
        // between HOMER screens sets it off), so pagehide is NOT proof the page
        // is going away and must never stop the music — that was the whole
        // point of keeping the player out of the screens. Only a real unload
        // (beforeunload) tells Jellyfin we've stopped.
        const onHide = () => { if (cur() && started) report(audio && !audio.paused ? 'timeupdate' : 'pause', true); };
        const onUnload = () => stop(true);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onUnload);
        document.addEventListener('visibilitychange', onHide);

        return {
            play, queueNext, pause, resume, toggle, seek, skip, next, prev, jump,
            setVolume, nudgeVolume, toggleMute, toggleShuffle, cycleRepeat, stop, state,
            repeats: REPEATS,
            get audio() { return ensure(); },
            destroy() {
                stop(true);
                window.removeEventListener('pagehide', onHide);
                window.removeEventListener('beforeunload', onUnload);
                document.removeEventListener('visibilitychange', onHide);
                if (offHP) { try { offHP(); } catch { /* gone */ } }
                if (audio) audio.remove();
                if (pre) pre.remove();
                audio = null;
                pre = null;
            },
        };
    })();

    window.HomerMusicModel = {
        version: VERSION,
        load,
        loaded: () => loaded,
        error: () => lastError,
        library: () => library,
        signedIn: () => !!getServer(),
        counts: () => counts,
        albums: () => lists.albums,
        artists: () => lists.artists,
        songs: () => lists.songs,
        playlists: () => lists.playlists,
        genres: () => lists.genres,
        recent: () => lists.recent,
        favorites: () => lists.favorites,
        isFavorite,
        setFavorite,
        toggleFavorite,
        find,
        albumById,
        trackById,
        albumTracks,
        artistAlbums,
        artistSongs,
        artistAllSongs,
        genreAlbums,
        genreSongs,
        playlistTracks,
        instantMix,
        lyrics,
        lyricAt,
        art,
        color,
        player,
        fmt,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        // tests: a library without Jellyfin (the shape its items normalize to)
        _fixture(data) {
            Object.keys(lists).forEach((k) => { lists[k] = (data && data[k]) || []; });
            if (!lists.recent.length) lists.recent = lists.albums.slice();
            counts = { albums: lists.albums.length, songs: lists.songs.length, artists: lists.artists.length };
            loaded = true;
            library = library || { Id: 'fixture', Name: 'Music' };
            emit('library');
        },
        _normalize: { track, album },
        destroy() {
            player.destroy();
            listeners.clear();
            cache.clear();
            lyricCache.clear();
            favs.clear();
        },
    };
})();
