/*
 * HOMER Books: the audiobooks' data and the audio player, shared by the TV
 * screen (books/books.js) and the phone layout (books/books-phone.js).
 *
 * Where the books come from: Jellyfin. A library of content type "Books"
 * holds the audiobooks (AudioBook items: one .m4b is one book). Jellyfin keeps
 * where you are in each one (its resume position), so HOMER, Jellyfin's own
 * apps and anything else signed in as you agree on it.
 *
 * What Jellyfin doesn't have, this fills in:
 *   - Chapters: Jellyfin's own when it has them, otherwise read straight from
 *     the file's Nero chapter list (the 'chpl' atom ffmpeg writes at the end of
 *     an .m4b), with one small Range request for the file's last 256 KB.
 *   - A description, subjects and a first-published year from Open Library
 *     (CORS open, no key) when the file's own is missing or is just
 *     "Chapter 59" (Audible rips put that in the comment tag). Cached a month.
 *   - A color for each cover (the screen's wash), read from the image.
 *
 * The player is a plain <audio> element playing Jellyfin's direct stream
 * (/Audio/{id}/stream?static=true), reporting to Jellyfin like any client
 * (Sessions/Playing, /Progress every 10 s and on every pause and seek,
 * /Stopped), so the resume position is saved as you listen. It stops any
 * video HOMER has playing when it starts, and pauses when a video starts.
 * Speed (0.8× to 2×) and a sleep timer (15/30/45/60 minutes or the end of the
 * chapter) are the player's too.
 *
 * window.HomerBooksModel = { load, books, book, nowListening, library,
 *   chapters, enrich, color, coverUrl, player, onChange, fmt, destroy, version }
 */
(() => {
    const VERSION = '0.1.1';

    if (window.HomerBooksModel && typeof window.HomerBooksModel.destroy === 'function') {
        window.HomerBooksModel.destroy();
    }

    const TICKS = 10000000; // Jellyfin's ticks per second
    const PROGRESS_MS = 10000;
    const OL_TTL = 30 * 24 * 3600 * 1000;
    const OL_KEY = 'homer-books-ol';
    const CH_KEY = 'homer-books-chapters';
    const RATE_KEY = 'homer-books-rate';
    const VOL_KEY = 'homer-books-volume';
    const RATES = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const SLEEPS = [null, 15, 30, 45, 60, 'chapter'];

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
        const headers = { Authorization: authHeader(server) };
        if (opts.body) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, {
            method: opts.method || 'GET',
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            keepalive: !!opts.keepalive,
        });
        if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} → ${res.status}`);
        const t = await res.text();
        return t ? JSON.parse(t) : null;
    };
    const post = (path, body, keepalive) => api(path, { method: 'POST', body, keepalive })
        .catch((err) => console.warn('[HOMER Books]', err.message));

    // ---------- Small helpers ----------

    const store = {
        get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
    };
    const listeners = new Set();
    const emit = (what) => listeners.forEach((fn) => {
        try { fn(what); } catch (err) { console.error('[HOMER Books]', err); }
    });

    // "12 h 53 m", "42 m", "3 m"
    const fmtLen = (sec) => {
        sec = Math.max(0, Math.round(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        if (h && m === 60) return `${h + 1} h`;
        if (h) return m ? `${h} h ${m} m` : `${h} h`;
        return `${Math.max(1, m)} m`;
    };
    // "9:12:40", "31:10", "0:04"
    const fmtClock = (sec) => {
        sec = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmt = { len: fmtLen, clock: fmtClock, time: fmtTime };

    // ---------- Titles and people ----------

    // "In the Garden of Beasts (Unabridged)" → "In the Garden of Beasts";
    // "Mr. Texas: A novel" → "Mr. Texas" + "A novel"
    const splitTitle = (name) => {
        let t = String(name || '').replace(/\s*[([](un)?abridged[)\]]\s*/ig, ' ').replace(/\s+/g, ' ').trim();
        let sub = '';
        const colon = t.indexOf(': ');
        if (colon > 2) {
            sub = t.slice(colon + 2).trim();
            t = t.slice(0, colon).trim();
        }
        return { title: t, subtitle: sub };
    };
    const junkOverview = (s) => !s || s.length < 40 || /^chapter\s*\d+$/i.test(s.trim());
    const cleanText = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // ---------- The library ----------

    let books = [];
    let library = null; // the Books view, or null when there's none
    let loaded = false;
    let loading = null;
    let lastError = null;

    const FIELDS = 'Fields=Overview,Chapters,People,Genres,Tags,MediaSources,ProductionYear,DateCreated,PrimaryImageAspectRatio,SortName,Path';

    const normalize = (it) => {
        const { title, subtitle } = splitTitle(it.Name);
        const ud = it.UserData || {};
        const people = it.People || [];
        const narrator = people.filter((p) => /narrat|reader|read by/i.test(p.Role || '') || p.Type === 'Composer')
            .map((p) => p.Name);
        const authorPeople = people.filter((p) => p.Type === 'Author' || /author|writer/i.test(p.Role || '')).map((p) => p.Name);
        const author = (it.AlbumArtists && it.AlbumArtists[0] && it.AlbumArtists[0].Name)
            || it.AlbumArtist || (it.Artists && it.Artists[0]) || authorPeople[0] || '';
        const duration = (it.RunTimeTicks || 0) / TICKS;
        const chapters = (it.Chapters || []).length > 1
            ? it.Chapters.map((c, k) => ({ name: c.Name || `Chapter ${k + 1}`, start: (c.StartPositionTicks || 0) / TICKS }))
            : null;
        const src = (it.MediaSources || [])[0] || {};
        const old = books.find((b) => b.id === it.Id);
        return {
            id: it.Id,
            title,
            subtitle,
            fullTitle: it.Name,
            author,
            narrators: [...new Set(narrator)].filter((n) => n && n !== author),
            year: it.ProductionYear || null,
            duration,
            position: (ud.PlaybackPositionTicks || 0) / TICKS,
            played: !!ud.Played,
            lastPlayed: ud.LastPlayedDate ? Date.parse(ud.LastPlayedDate) : 0,
            added: it.DateCreated ? Date.parse(it.DateCreated) : 0,
            overview: junkOverview(it.Overview) ? '' : cleanText(it.Overview),
            genres: (it.Genres || []).filter((g) => !/^audio ?books?$/i.test(g)),
            series: it.SeriesName || '',
            seriesIndex: it.IndexNumber || null,
            imageTag: (it.ImageTags && it.ImageTags.Primary) || null,
            aspect: it.PrimaryImageAspectRatio || 1,
            mediaSourceId: src.Id || it.Id,
            size: src.Size || 0,
            container: src.Container || '',
            chapters: chapters || (old && old.chapters) || null,
            // filled in later (Open Library, the file's chapters, the cover's color)
            extra: (old && old.extra) || null,
            rgb: (old && old.rgb) || null,
        };
    };

    // in progress (latest first), then not started (newest first), then finished
    const order = (a, b) => {
        const st = (x) => (x.played ? 2 : x.position > 0 ? 0 : 1);
        return st(a) - st(b)
            || (st(a) === 0 ? b.lastPlayed - a.lastPlayed : 0)
            || (st(a) === 1 ? b.added - a.added : 0)
            || a.title.localeCompare(b.title);
    };

    const load = (force) => {
        if (loading) return loading;
        if (loaded && !force) return Promise.resolve(books);
        const server = getServer();
        if (!server) return Promise.reject(new Error('Not signed in'));
        loading = (async () => {
            const uid = server.UserId;
            const views = await api(`/Users/${uid}/Views`);
            library = ((views && views.Items) || []).find((v) => v.CollectionType === 'books') || null;
            // AudioBook items anywhere (a Books library, or a mixed one)
            const res = await api(`/Users/${uid}/Items?IncludeItemTypes=AudioBook&Recursive=true&SortBy=SortName&EnableUserData=true&ImageTypeLimit=1&EnableImageTypes=Primary&${FIELDS}`);
            let list = ((res && res.Items) || []).map(normalize);
            // a book HOMER is playing knows better than the list where it is
            const cur = player.state().book;
            if (cur) list = list.map((b) => (b.id === cur.id ? Object.assign(b, { position: player.state().position }) : b));
            books = list.sort(order);
            loaded = true;
            lastError = null;
            emit('books');
            return books;
        })().catch((err) => {
            lastError = err;
            emit('error');
            throw err;
        }).finally(() => { loading = null; });
        return loading;
    };

    const book = (id) => books.find((b) => b.id === id) || null;
    // the book you're in the middle of: HOMER's playing one, or the one
    // listened to last that isn't finished
    const nowListening = () => {
        const cur = player.state().book;
        if (cur) return book(cur.id) || cur;
        return books.filter((b) => !b.played && b.position > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
    };

    const coverUrl = (b, h) => {
        if (b && b.imageTag) return `/Items/${b.id}/Images/Primary?fillHeight=${h || 600}&quality=90&tag=${encodeURIComponent(b.imageTag)}`;
        if (b && b.extra && b.extra.coverId) return `https://covers.openlibrary.org/b/id/${b.extra.coverId}-L.jpg`;
        return '';
    };
    const streamUrl = (b) => {
        const server = getServer();
        const q = new URLSearchParams({ static: 'true', MediaSourceId: b.mediaSourceId, ApiKey: server ? server.AccessToken : '' });
        return `/Audio/${b.id}/stream?${q}`;
    };

    // ---------- Chapters ----------

    // The Nero chapter list ffmpeg writes into an .m4b ('chpl', in moov/udta,
    // usually the very end of the file): version, flags, [4 bytes], count,
    // then per chapter a 64-bit start in 100 ns units (Jellyfin's ticks) and
    // a length-prefixed UTF-8 title.
    const parseChpl = (buf) => {
        const u8 = new Uint8Array(buf);
        const dv = new DataView(buf);
        for (let i = u8.length - 8; i >= 4; i--) {
            if (u8[i] !== 0x63 || u8[i + 1] !== 0x68 || u8[i + 2] !== 0x70 || u8[i + 3] !== 0x6c) continue; // 'chpl'
            const size = dv.getUint32(i - 4);
            if (size < 13 || i - 4 + size > u8.length + 8) continue;
            let p = i + 4;
            const version = u8[p]; p += 4;
            if (version) p += 4;
            const n = u8[p]; p += 1;
            const out = [];
            const dec = new TextDecoder('utf-8');
            for (let k = 0; k < n && p + 9 <= u8.length; k++) {
                const hi = dv.getUint32(p); const lo = dv.getUint32(p + 4);
                const start = (hi * 4294967296 + lo) / TICKS;
                const len = u8[p + 8];
                const name = dec.decode(u8.subarray(p + 9, p + 9 + len));
                p += 9 + len;
                out.push({ name: name || `Chapter ${k + 1}`, start });
            }
            if (out.length > 1 && out.every((c, k) => !k || c.start >= out[k - 1].start)) return out;
        }
        return null;
    };
    const readFileChapters = async (b) => {
        const server = getServer();
        if (!server || !/m4b|m4a|mp4|mov/i.test(b.container || 'm4b')) return null;
        const ctl = new AbortController();
        const res = await fetch(streamUrl(b), { headers: { Range: 'bytes=-262144' }, signal: ctl.signal });
        // a server that ignores the Range would send the whole book: don't read it
        if (res.status !== 206) { ctl.abort(); return null; }
        return parseChpl(await res.arrayBuffer());
    };
    const chapterJobs = new Map();
    const chapters = (b) => {
        if (!b) return Promise.resolve(null);
        if (b.chapters) return Promise.resolve(b.chapters);
        const cache = store.get(CH_KEY, {});
        const key = b.id + ':' + Math.round(b.duration);
        if (cache[key]) {
            b.chapters = cache[key];
            return Promise.resolve(b.chapters);
        }
        if (chapterJobs.has(b.id)) return chapterJobs.get(b.id);
        const job = readFileChapters(b).catch((err) => {
            console.warn('[HOMER Books] chapters', err.message);
            return null;
        }).then((list) => {
            chapterJobs.delete(b.id);
            if (!list) return null;
            // the last chapter ends where the book does
            b.chapters = list.filter((c) => c.start < b.duration || !b.duration);
            const c2 = store.get(CH_KEY, {});
            c2[key] = b.chapters;
            const keys = Object.keys(c2);
            if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((k) => delete c2[k]);
            store.set(CH_KEY, c2);
            emit('chapters');
            return b.chapters;
        });
        chapterJobs.set(b.id, job);
        return job;
    };
    // where you are: { index, chapter, start, end, into, left } (null without chapters)
    const chapterAt = (b, sec) => {
        const list = b && b.chapters;
        if (!list || !list.length) return null;
        let i = 0;
        while (i + 1 < list.length && list[i + 1].start <= sec + 0.25) i++;
        const start = list[i].start;
        const end = i + 1 < list.length ? list[i + 1].start : (b.duration || start);
        return { index: i, chapter: list[i], start, end, into: sec - start, left: end - sec, count: list.length };
    };

    // ---------- Open Library ----------

    const olJobs = new Map();
    const enrich = (b) => {
        if (!b) return Promise.resolve(null);
        if (b.extra) return Promise.resolve(b.extra);
        const key = (b.title + '|' + b.author).toLowerCase();
        const cache = store.get(OL_KEY, {});
        const hit = cache[key];
        if (hit && Date.now() - hit.at < OL_TTL) {
            b.extra = hit.v;
            return Promise.resolve(b.extra);
        }
        if (olJobs.has(key)) return olJobs.get(key);
        const job = (async () => {
            const q = new URLSearchParams({ title: b.title, limit: '5', fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,subject' });
            if (b.author) q.set('author', b.author.split(/[,&]/)[0].trim());
            const res = await fetch(`https://openlibrary.org/search.json?${q}`).then((r) => (r.ok ? r.json() : null));
            const docs = (res && res.docs) || [];
            const doc = docs.find((d) => d.cover_i) || docs[0];
            if (!doc) return {};
            const v = {
                work: doc.key,
                coverId: doc.cover_i || null,
                firstYear: doc.first_publish_year || null,
                pages: doc.number_of_pages_median || null,
                subjects: (doc.subject || []).filter((s) => s.length < 28 && !/bestseller|fiction, general|^fiction$|large type|accessible|protected daisy|in library|open library|audiobook/i.test(s)).slice(0, 4),
                description: '',
            };
            if (doc.key) {
                const w = await fetch(`https://openlibrary.org${doc.key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
                const d = w && w.description;
                v.description = cleanText(typeof d === 'string' ? d : (d && d.value) || '')
                    .replace(/\s*\(\[source\]\[\d+\]\)[\s\S]*$/, '') // Open Library's source footnotes
                    .replace(/\s*-{3,}[\s\S]*$/, '')
                    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1');
            }
            return v;
        })().catch((err) => {
            console.warn('[HOMER Books] Open Library', err.message);
            return null;
        }).then((v) => {
            olJobs.delete(key);
            if (!v) return null; // try again next time
            b.extra = v;
            const c2 = store.get(OL_KEY, {});
            c2[key] = { at: Date.now(), v };
            store.set(OL_KEY, c2);
            emit('extra');
            return v;
        });
        olJobs.set(key, job);
        return job;
    };
    // the description to show: the book's own, else Open Library's
    const description = (b) => (b && (b.overview || (b.extra && b.extra.description))) || '';
    const subjects = (b) => {
        if (!b) return [];
        const own = b.genres || [];
        return own.length ? own.slice(0, 3) : ((b.extra && b.extra.subjects) || []).slice(0, 3);
    };

    // ---------- Cover color ----------

    // The cover's most vivid common color, lifted to read on navy: pixels
    // bucketed by hue, weighted by saturation and brightness.
    const colorJobs = new Map();
    const color = (b) => {
        if (!b) return Promise.resolve(null);
        if (b.rgb) return Promise.resolve(b.rgb);
        const url = coverUrl(b, 120);
        if (!url) return Promise.resolve(null);
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
                    let avg = [0, 0, 0];
                    for (let i = 0; i < px.length; i += 4) {
                        const r = px[i], gg = px[i + 1], bb = px[i + 2];
                        avg[0] += r; avg[1] += gg; avg[2] += bb;
                        const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
                        const s = mx ? (mx - mn) / mx : 0;
                        const v = mx / 255;
                        if (s < 0.22 || v < 0.18) continue;
                        let h;
                        const d = mx - mn;
                        if (mx === r) h = ((gg - bb) / d) % 6;
                        else if (mx === gg) h = (bb - r) / d + 2;
                        else h = (r - gg) / d + 4;
                        h = (h * 60 + 360) % 360;
                        const k = Math.floor(h / 15);
                        const w = s * s * v;
                        const bk = buckets[k];
                        bk.w += w; bk.r += r * w; bk.g += gg * w; bk.b += bb * w;
                    }
                    const best = buckets.reduce((a, x) => (x.w > a.w ? x : a), { w: 0 });
                    const n = px.length / 4;
                    let rgb = best.w > 2 ? [best.r / best.w, best.g / best.w, best.b / best.w] : avg.map((x) => x / n);
                    // lift: at least this bright, so the wash reads on the navy ground
                    const mx = Math.max(...rgb, 1);
                    if (mx < 170) rgb = rgb.map((x) => x * (170 / mx));
                    b.rgb = rgb.map((x) => Math.round(Math.min(255, x)));
                    resolve(b.rgb);
                } catch (err) {
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
        let cur = null; // the book loaded
        let session = '';
        let started = false; // Jellyfin's been told it started
        let progressTimer = null;
        let lastReport = 0;
        let pendingSeek = null;
        let rate = +(store.get(RATE_KEY, 1)) || 1;
        let volume = Math.max(0, Math.min(1, +(store.get(VOL_KEY, 1))));
        if (!isFinite(volume)) volume = 1;
        let sleep = null; // { mode: minutes | 'chapter', until: ms, chapterEnd: sec }
        let sleepTimer = null;
        let error = null;
        let offHP = null;
        let watchdog = null; // a stream that never starts (Jellyfin can hang instead of saying no)

        const ensure = () => {
            if (audio) return audio;
            audio = document.createElement('audio');
            audio.id = 'homer-books-audio';
            audio.preload = 'auto';
            audio.style.display = 'none';
            audio.volume = volume;
            document.body.appendChild(audio);
            ['play', 'pause', 'seeked', 'ended', 'error', 'loadedmetadata', 'waiting', 'playing', 'ratechange'].forEach((ev) =>
                audio.addEventListener(ev, () => onAudio(ev)));
            audio.addEventListener('timeupdate', onTime);
            return audio;
        };

        const pos = () => (audio && cur ? (pendingSeek != null ? pendingSeek : audio.currentTime) : 0);
        const ticks = (sec) => Math.round(sec * TICKS);
        const body = (extra) => Object.assign({
            ItemId: cur.id,
            MediaSourceId: cur.mediaSourceId,
            PlaySessionId: session,
            PositionTicks: ticks(pos()),
            IsPaused: !audio || audio.paused,
            IsMuted: false,
            CanSeek: true,
            PlayMethod: 'DirectPlay',
            PlaybackRate: rate,
        }, extra || {});
        const report = (kind, keepalive) => {
            if (!cur) return;
            lastReport = Date.now();
            if (kind === 'start') { started = true; post('/Sessions/Playing', body(), keepalive); }
            else if (kind === 'stop') { if (started) post('/Sessions/Playing/Stopped', body(), keepalive); started = false; }
            else if (started) post('/Sessions/Playing/Progress', body({ EventName: kind }), keepalive);
            // the list shows where you are without asking Jellyfin again
            const b = book(cur.id);
            if (b) { b.position = pos(); b.lastPlayed = Date.now(); }
        };

        const state = () => {
            const b = cur ? (book(cur.id) || cur) : null;
            return {
                book: b,
                playing: !!(audio && cur && !audio.paused),
                buffering: !!(audio && cur && !audio.paused && audio.readyState < 3),
                position: pos(),
                duration: (audio && isFinite(audio.duration) && audio.duration) || (b && b.duration) || 0,
                rate,
                volume,
                sleep: sleep ? { mode: sleep.mode, left: sleep.mode === 'chapter' ? null : Math.max(0, sleep.until - Date.now()) } : null,
                error,
                chapter: b ? chapterAt(b, pos()) : null,
            };
        };
        const changed = () => emit('player');

        const onAudio = (ev) => {
            if (!cur) return;
            if (ev === 'loadedmetadata') {
                if (pendingSeek != null) {
                    audio.currentTime = Math.min(pendingSeek, Math.max(0, (audio.duration || pendingSeek) - 1));
                    pendingSeek = null;
                }
                audio.playbackRate = rate;
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
                const b = book(cur.id);
                report('stop');
                if (b) { b.played = true; b.position = 0; }
                stopSleep();
            } else if (ev === 'error') {
                clearTimeout(watchdog);
                error = (audio.error && audio.error.message) || 'The book didn\'t play';
                console.warn('[HOMER Books] audio', error);
            }
            changed();
        };
        const onTime = () => {
            if (!cur || !audio || audio.paused) return;
            if (Date.now() - lastReport > PROGRESS_MS) report('timeupdate');
            if (sleep && sleep.mode === 'chapter' && sleep.chapterEnd != null && audio.currentTime >= sleep.chapterEnd - 0.3) {
                audio.pause();
                stopSleep();
            }
            changed();
        };

        // a video starting (HomerPlayer) pauses the book
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

        // play a book from a position (seconds; null = where you left off)
        const play = (b, from) => {
            if (!b) return;
            ensure();
            watchVideo();
            stopVideo();
            const start = from != null ? from : (b.played ? 0 : b.position || 0);
            if (!cur || cur.id !== b.id) {
                if (cur) report('stop');
                cur = b;
                session = Math.random().toString(36).slice(2) + Date.now().toString(36);
                started = false;
                error = null;
                pendingSeek = start;
                audio.src = streamUrl(b);
                audio.load();
                clearTimeout(watchdog);
                watchdog = setTimeout(() => {
                    if (!cur || cur.id !== b.id || audio.readyState >= 2) return;
                    audio.pause();
                    error = 'Jellyfin isn\'t sending this book. Press OK to try again.';
                    audio.removeAttribute('src');
                    audio.load();
                    cur = null; // OK starts it over
                    changed();
                }, 25000);
            } else if (from != null) {
                seek(from);
            }
            if (b.played && from != null) b.played = false;
            audio.playbackRate = rate;
            audio.play().catch((err) => {
                if (err && err.name === 'AbortError') return;
                error = err && err.name === 'NotAllowedError' ? 'Press OK to play (the browser wants a key press first)' : (err && err.message) || 'The book didn\'t play';
                changed();
            });
            chapters(b);
            changed();
        };
        const pause = () => { if (audio && cur && !audio.paused) audio.pause(); };
        const resume = () => { if (cur) play(cur, null); };
        const toggle = () => { if (!cur) return; if (audio.paused) resume(); else pause(); };
        const seek = (sec) => {
            if (!audio || !cur) return;
            const d = state().duration || Infinity;
            sec = Math.max(0, Math.min(sec, d - 1));
            if (audio.readyState < 1) { pendingSeek = sec; changed(); return; }
            audio.currentTime = sec;
            changed();
        };
        const skip = (delta) => seek(pos() + delta);
        const chapterJump = (dir) => {
            if (!cur) return;
            const b = book(cur.id) || cur;
            const at = chapterAt(b, pos());
            if (!at) { skip(dir * 300); return; }
            if (dir < 0) {
                // back: to this chapter's start, or the one before if you're right at it
                const i = at.into > 4 || at.index === 0 ? at.index : at.index - 1;
                seek(b.chapters[i].start);
            } else if (at.index + 1 < b.chapters.length) {
                seek(b.chapters[at.index + 1].start);
            }
            if (sleep && sleep.mode === 'chapter') setSleep('chapter');
        };
        const setRate = (r) => {
            rate = r;
            store.set(RATE_KEY, r);
            if (audio) audio.playbackRate = r;
            changed();
        };
        const cycleRate = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length] || 1);

        // The book's own volume, independent of the system/device volume.
        // Added for HOME-104 (ambience): with a second sound layer playing
        // alongside the book, book and ambience need separate levels. Not
        // reported to Jellyfin (IsMuted/VolumeLevel aren't part of its body
        // here, unlike music-model.js, which does report them) — a minimal
        // add, not a full port of music's volume handling.
        const setVolume = (v) => {
            volume = Math.max(0, Math.min(1, v));
            store.set(VOL_KEY, volume);
            if (audio) audio.volume = volume;
            changed();
        };

        const stopSleep = () => {
            clearTimeout(sleepTimer);
            sleepTimer = null;
            sleep = null;
            changed();
        };
        const setSleep = (mode) => {
            clearTimeout(sleepTimer);
            sleep = null;
            if (!mode) { changed(); return; }
            if (mode === 'chapter') {
                const b = cur && (book(cur.id) || cur);
                const at = b && chapterAt(b, pos());
                sleep = { mode, chapterEnd: at ? at.end : null };
            } else {
                sleep = { mode, until: Date.now() + mode * 60000 };
                const tick = () => {
                    if (!sleep || sleep.mode === 'chapter') return;
                    const left = sleep.until - Date.now();
                    if (left <= 0) { pause(); stopSleep(); return; }
                    changed();
                    sleepTimer = setTimeout(tick, Math.min(left, 30000));
                };
                sleepTimer = setTimeout(tick, 1000);
            }
            changed();
        };
        const cycleSleep = () => {
            const k = SLEEPS.findIndex((s) => (sleep ? s === sleep.mode : s === null));
            setSleep(SLEEPS[(k + 1) % SLEEPS.length]);
        };

        // stop: tell Jellyfin where you got to, and let go of the file
        const stop = (keepalive) => {
            clearTimeout(watchdog);
            if (!cur) return;
            if (audio && !audio.paused) audio.pause();
            report('stop', keepalive);
            cur = null;
            stopSleep();
            if (audio) { audio.removeAttribute('src'); audio.load(); }
            changed();
        };

        const onHide = () => { if (cur && started) report(audio && !audio.paused ? 'timeupdate' : 'pause', true); };
        const onUnload = () => stop(true);
        window.addEventListener('pagehide', onUnload);
        document.addEventListener('visibilitychange', onHide);

        return {
            play, pause, resume, toggle, seek, skip, chapterJump, setRate, cycleRate, setVolume, setSleep, cycleSleep, stop, state,
            rates: RATES,
            get audio() { return ensure(); },
            destroy() {
                stop(true);
                window.removeEventListener('pagehide', onUnload);
                document.removeEventListener('visibilitychange', onHide);
                if (offHP) { try { offHP(); } catch { /* gone */ } }
                audio && audio.remove();
                audio = null;
            },
        };
    })();

    window.HomerBooksModel = {
        version: VERSION,
        load,
        books: () => books,
        book,
        nowListening,
        library: () => library,
        loaded: () => loaded,
        error: () => lastError,
        chapters,
        chapterAt,
        enrich,
        description,
        subjects,
        color,
        coverUrl,
        player,
        fmt,
        signedIn: () => !!getServer(),
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        // tests: books without a Jellyfin library (the same shape Jellyfin's
        // items normalize to); pass [] to go back
        _fixture(items) {
            books = (items || []).map((x) => Object.assign({ extra: null, rgb: null, narrators: [], genres: [], chapters: null, overview: '', aspect: 1, imageTag: null, played: false, position: 0, lastPlayed: 0, added: 0 }, x)).sort(order);
            loaded = true;
            library = library || { Id: 'fixture', Name: 'Books' };
            emit('books');
        },
        _parseChpl: parseChpl,
        destroy() {
            player.destroy();
            listeners.clear();
        },
    };
})();
