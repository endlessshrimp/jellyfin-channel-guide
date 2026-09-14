/*
 * HOMER Recordings: the data both layouts draw from. recordings/recordings.js
 * draws the TV screen and recordings/recordings-phone.js the phone one; both
 * load the DVR through here, get the same shape for a recording, a timer and a
 * series timer, and delete, cancel and play the same way.
 *
 * Nothing here keeps state: each layout holds the lists it loaded.
 *
 * window.HomerRecordingsModel = { load, groupRecordings, remove, play, util,
 *                                 TABS, version }
 */
(() => {
    const VERSION = '0.1.0';

    const TICKS_PER_MIN = 600000000;
    const TABS = [
        { id: 'recorded', label: 'Recorded' },
        { id: 'scheduled', label: 'Scheduled' },
        { id: 'series', label: 'Series' }
    ];

    // ---------- Jellyfin session (same as the library screens) ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };

    // Identify as Jellyfin Web itself, so API use doesn't rename this browser in
    // the dashboard or split it into a second session.
    const authHeader = (server) => {
        const ac = window.ApiClient;
        const parts = [];
        try {
            if (ac && ac.appName && ac.deviceId) {
                parts.push(`Client="${ac.appName()}"`, `Device="${ac.deviceName()}"`,
                    `DeviceId="${ac.deviceId()}"`, `Version="${ac.appVersion()}"`);
            }
        } catch { /* token only; the server fills in the rest */ }
        parts.push(`Token="${server.AccessToken}"`);
        return 'MediaBrowser ' + parts.join(', ');
    };

    const request = async (method, path, body) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const headers = { Authorization: authHeader(server) };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };
    const api = (path) => request('GET', path);

    // ---------- HomerPlayer (optional) ----------

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Recordings]', err); return fallback; }
    };
    const docked = () => {
        const p = HP();
        return !!(p && typeof p.docked === 'function' && safe(() => p.docked(), false));
    };

    // ---------- Small helpers ----------

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const lc = (x) => String(x ?? '').toLowerCase();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const toDate = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        return isNaN(d) ? null : d;
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dayStart = (d) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    };
    const dayDiff = (d) => Math.round((dayStart(d) - dayStart(new Date())) / 86400000);
    // Today / Tomorrow / Saturday / Sat, Sep 12
    const fmtDay = (d) => {
        if (!d) return '';
        const n = dayDiff(d);
        if (n === 0) return 'Today';
        if (n === -1) return 'Yesterday';
        if (n === 1) return 'Tomorrow';
        if (n > 1 && n < 7) return d.toLocaleDateString([], { weekday: 'long' });
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString([], opts);
    };
    const fmtRange = (a, b) => (a ? (b ? `${fmtTime(a)} – ${fmtTime(b)}` : fmtTime(a)) : '');
    const fmtMins = (mins) => {
        mins = Math.max(1, Math.round(mins));
        const h = Math.floor(mins / 60);
        return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
    };
    const fmtIn = (d) => {
        const mins = Math.round((d - Date.now()) / 60000);
        if (mins <= 0) return 'Starting now';
        if (mins < 60) return `Starts in ${mins}m`;
        if (mins < 24 * 60) return `Starts in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
        return `Starts ${fmtDay(d)}`;
    };
    const epCode = (it) => {
        if (it.IndexNumber == null) return '';
        return it.ParentIndexNumber != null ? `S${it.ParentIndexNumber} E${it.IndexNumber}` : `E${it.IndexNumber}`;
    };

    const img = (id, type, tag, q) => `/Items/${id}/Images/${type}?${q}${tag ? '&tag=' + encodeURIComponent(tag) : ''}`;
    const logoUrl = (chId, tag) => img(chId, 'Primary', tag, 'maxHeight=120');

    // ---------- Playback ----------

    // Hand Jellyfin Web's own remote-control handler a Play message, exactly as
    // if the server had told this client to play it (the guide and library do the
    // same). A recording always plays full screen: a docked preview video goes
    // full screen first.
    const play = async (id, startTicks) => {
        if (docked()) {
            const p = HP();
            if (typeof p.fullscreen === 'function') await Promise.resolve(safe(() => p.fullscreen()));
        }
        const ac = window.ApiClient;
        const server = getServer();
        // always explicit: 0 means "from the beginning" (Restart), never "wherever it was"
        const data = { PlayCommand: 'PlayNow', ItemIds: [id], StartPositionTicks: startTicks > 0 ? startTicks : 0 };
        if (ac && typeof ac.handleMessageReceived === 'function' && (!ac.serverId || ac.serverId() === server.Id)) {
            ac.handleMessageReceived({ MessageType: 'Play', Data: data });
            return;
        }
        // Fallback: remote-control this browser's own session through the server.
        const deviceId = (ac && ac.deviceId && ac.deviceId()) || localStorage.getItem('_deviceId2');
        const sessions = await api(`/Sessions?deviceId=${encodeURIComponent(deviceId)}`);
        const mine = (sessions || []).find((s) => s.DeviceId === deviceId && s.SupportsRemoteControl);
        if (!mine) throw new Error('Could not find this browser\'s Jellyfin session');
        await request('POST', `/Sessions/${mine.Id}/Playing?playCommand=PlayNow&itemIds=${id}&startPositionTicks=${startTicks > 0 ? startTicks : 0}`);
    };

    // ---------- Data: one shape for recordings, timers and series timers ----------

    // A recording's show and episode. Jellyfin names a series recording either
    // after the show (with EpisodeTitle) or after the episode (with SeriesName).
    const showTitle = (it) => it.SeriesName || it.Name || 'Recording';
    const episodeTitle = (it) => {
        if (it.EpisodeTitle) return it.EpisodeTitle;
        if (it.SeriesName && it.Name && it.Name !== it.SeriesName) return it.Name;
        return '';
    };
    const recArt = (it, w) => {
        const q = `maxWidth=${w}&quality=85`;
        const tags = it.ImageTags || {};
        if (tags.Thumb) return img(it.Id, 'Thumb', tags.Thumb, q);
        if (it.BackdropImageTags && it.BackdropImageTags.length) return img(it.Id, 'Backdrop/0', it.BackdropImageTags[0], q);
        if (tags.Primary && !(it.PrimaryImageAspectRatio && it.PrimaryImageAspectRatio < 1.2)) return img(it.Id, 'Primary', tags.Primary, q);
        if (it.ParentThumbItemId && it.ParentThumbImageTag) return img(it.ParentThumbItemId, 'Thumb', it.ParentThumbImageTag, q);
        if (it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length) {
            return img(it.ParentBackdropItemId, 'Backdrop/0', it.ParentBackdropImageTags[0], q);
        }
        return null;
    };
    const recPoster = (it) => (it.ImageTags && it.ImageTags.Primary && it.PrimaryImageAspectRatio && it.PrimaryImageAspectRatio < 1.2
        ? img(it.Id, 'Primary', it.ImageTags.Primary, 'fillHeight=420&quality=90') : null);

    // When it aired. Jellyfin 10.11 hands finished recordings back as plain
    // library items (Type Movie/Episode, no StartDate, no ChannelId), but the DVR
    // names each file after the airing's start, in the server's local time:
    // "…/SEC Storied/SEC Storied 2026_09_12_22_00_00.ts". DateCreated (when the
    // library picked the file up) is the last resort.
    const airedAt = (it) => {
        const d = toDate(it.StartDate);
        if (d) return d;
        const m = String(it.Path || '').match(/(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)(?: - \d+)?\.\w+$/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        return toDate(it.DateCreated);
    };

    const fromRecording = (it) => {
        const start = airedAt(it);
        const end = toDate(it.EndDate);
        const ticks = it.RunTimeTicks > 0 ? it.RunTimeTicks : (start && end ? (end - start) * 10000 : 0);
        const pos = (it.UserData && it.UserData.PlaybackPositionTicks) || 0;
        const now = Date.now();
        return {
            kind: 'rec',
            key: 'r:' + it.Id,
            id: it.Id,
            raw: it,
            title: showTitle(it),
            episode: episodeTitle(it),
            code: epCode(it),
            group: lc(showTitle(it)), // same show (or same title), same folder
            chId: it.ChannelId || null,
            chName: it.ChannelName || '',
            chTag: it.ChannelPrimaryImageTag || null,
            start,
            end,
            ticks,
            mins: ticks / TICKS_PER_MIN,
            pos,
            pct: pos && ticks ? clamp((pos / ticks) * 100, 1, 100) : 0,
            played: !!(it.UserData && it.UserData.Played),
            recording: it.Status === 'InProgress' || !!(start && end && start <= now && end > now),
            canDelete: it.CanDelete !== false,
            rating: it.OfficialRating || '',
            overview: it.Overview || '',
            thumb: recArt(it, 320),
            art: recArt(it, 1280),
            poster: recPoster(it)
        };
    };

    // xTeVe fills channels that have no listings with blocks like
    // "FOX 7 (KTBC) Austin (Su. 06:00 - 12:00)", whose only "art" is the logo
    // (same test as Home)
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;
    const isPortrait = (p) => !!(p && p.PrimaryImageAspectRatio && p.PrimaryImageAspectRatio < 1.3);

    // Timers (and series timers) carry their program's art in one of several places.
    const timerArt = (t, w) => {
        const q = `maxWidth=${w}&quality=85`;
        const p = t.ProgramInfo;
        if (PLACEHOLDER.test(t.Name || '')) return null; // the channel's logo chip does it better
        if (p && p.ImageTags && p.ImageTags.Thumb) return img(p.Id, 'Thumb', p.ImageTags.Thumb, q);
        if (p && p.ImageTags && p.ImageTags.Primary && !isPortrait(p)) return img(p.Id, 'Primary', p.ImageTags.Primary, q);
        if (t.ParentThumbItemId && t.ParentThumbImageTag) return img(t.ParentThumbItemId, 'Thumb', t.ParentThumbImageTag, q);
        if (t.ParentBackdropItemId && t.ParentBackdropImageTags && t.ParentBackdropImageTags.length) {
            return img(t.ParentBackdropItemId, 'Backdrop/0', t.ParentBackdropImageTags[0], q);
        }
        if (t.ParentPrimaryImageItemId && t.ParentPrimaryImageTag) return img(t.ParentPrimaryImageItemId, 'Primary', t.ParentPrimaryImageTag, q);
        if (t.ImageTags && t.ImageTags.Primary) return img(t.Id, 'Primary', t.ImageTags.Primary, q);
        return null;
    };

    const timerPoster = (t) => {
        const p = t.ProgramInfo;
        if (PLACEHOLDER.test(t.Name || '') || !p || !p.ImageTags || !p.ImageTags.Primary || !isPortrait(p)) return null;
        return img(p.Id, 'Primary', p.ImageTags.Primary, 'fillHeight=420&quality=90');
    };

    const fromTimer = (t) => {
        const p = t.ProgramInfo || {};
        const placeholder = PLACEHOLDER.test(t.Name || '');
        const start = toDate(t.StartDate);
        const end = toDate(t.EndDate);
        const ticks = t.RunTimeTicks > 0 ? t.RunTimeTicks : (start && end ? (end - start) * 10000 : 0);
        return {
            kind: 'timer',
            key: 't:' + t.Id,
            id: t.Id,
            raw: t,
            title: t.Name || p.Name || 'Recording',
            episode: placeholder ? 'No listings for this channel' : p.EpisodeTitle || '',
            code: epCode(p),
            chId: t.ChannelId || null,
            chName: t.ChannelName || p.ChannelName || '',
            chTag: t.ChannelPrimaryImageTag || null,
            start,
            end,
            ticks,
            mins: ticks / TICKS_PER_MIN,
            recording: t.Status === 'InProgress',
            conflict: t.Status === 'ConflictedNotOk',
            fromSeries: !!t.SeriesTimerId,
            rating: p.OfficialRating || '',
            overview: placeholder ? '' : t.Overview || p.Overview || '', // "xTeVe: (360 Minutes) …" says nothing
            thumb: timerArt(t, 320),
            art: timerArt(t, 1280),
            poster: timerPoster(t)
        };
    };

    const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysText = (st) => {
        const days = (st.Days || []).slice().sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
        if (!days.length || days.length === 7 || st.DayPattern === 'Daily') return 'Every day';
        if (st.DayPattern === 'Weekdays') return 'Weekdays';
        if (st.DayPattern === 'Weekends') return 'Weekends';
        return days.map((d) => d.slice(0, 3)).join(' ');
    };

    const fromSeriesTimer = (st, timers) => {
        const upcoming = timers.filter((t) => t.raw.SeriesTimerId === st.Id).sort((a, b) => (a.start || 0) - (b.start || 0));
        const start = toDate(st.StartDate);
        return {
            kind: 'series',
            key: 's:' + st.Id,
            id: st.Id,
            raw: st,
            title: st.Name || 'Series recording',
            chId: st.RecordAnyChannel ? null : st.ChannelId || null,
            chName: st.RecordAnyChannel ? 'Any channel' : st.ChannelName || '',
            chTag: st.RecordAnyChannel ? null : st.ChannelPrimaryImageTag || null,
            anyChannel: !!st.RecordAnyChannel,
            which: st.RecordNewOnly ? 'New episodes only' : 'All episodes',
            when: st.RecordAnyTime || !start ? 'Any time' : `Around ${fmtTime(start)}`,
            days: daysText(st),
            keep: st.KeepUpTo > 0 ? `Keep ${st.KeepUpTo}` : '',
            upcoming,
            overview: st.Overview || '',
            thumb: timerArt(st, 320),
            art: timerArt(st, 1280),
            poster: null
        };
    };

    // A show with more than one recording becomes a folder, like a DVR's My Shows.
    const groupRecordings = (recs) => {
        const byShow = new Map();
        for (const r of recs) {
            if (!r.group) continue;
            if (!byShow.has(r.group)) byShow.set(r.group, []);
            byShow.get(r.group).push(r);
        }
        const out = [];
        const done = new Set();
        for (const r of recs) { // recs are newest first, so folders sit where their newest recording would
            const kids = r.group ? byShow.get(r.group) : null;
            if (!kids || kids.length < 2) {
                out.push(r);
                continue;
            }
            if (done.has(r.group)) continue;
            done.add(r.group);
            const newest = kids[0];
            const chans = new Set(kids.map((k) => k.chName).filter(Boolean));
            out.push({
                kind: 'group',
                key: 'g:' + r.group,
                title: newest.title,
                children: kids,
                newest,
                unwatched: kids.filter((k) => !k.played).length,
                chId: newest.chId,
                chName: chans.size > 1 ? plural(chans.size, 'channel') : newest.chName,
                chTag: newest.chTag,
                recording: kids.some((k) => k.recording),
                thumb: kids.map((k) => k.thumb).find(Boolean) || null,
                art: kids.map((k) => k.art).find(Boolean) || null,
                poster: kids.map((k) => k.poster).find(Boolean) || null
            });
        }
        return out;
    };

    // ---------- Loading ----------

    // Everything at once: recordings, timers and series timers. A tab that
    // didn't load is { status: 'error' }; the others are { status: 'ready',
    // items }, newest recording first, soonest timer first, series by name.
    // sig is what the server said, so a refresh that changed nothing can be
    // told apart (and redraw nothing).
    const fetchAll = (server) => {
        const uid = server.UserId;
        return Promise.allSettled([
            api(`/LiveTv/Recordings?UserId=${uid}&Fields=Overview,Path,CanDelete,ChannelInfo,PrimaryImageAspectRatio,DateCreated&EnableImageTypes=Primary,Thumb,Backdrop&ImageTypeLimit=1&EnableUserData=true&EnableTotalRecordCount=false`),
            api('/LiveTv/Timers'),
            api('/LiveTv/SeriesTimers?SortBy=SortName&SortOrder=Ascending')
        ]);
    };
    const parse = ([rec, tim, ser]) => {
        const data = {};
        if (rec.status === 'fulfilled') {
            const items = ((rec.value && rec.value.Items) || []).map(fromRecording);
            items.sort((a, b) => (b.start || 0) - (a.start || 0));
            data.recorded = { status: 'ready', items };
        } else data.recorded = { status: 'error', items: [] };
        let timers = [];
        if (tim.status === 'fulfilled') {
            const now = Date.now();
            timers = ((tim.value && tim.value.Items) || [])
                .filter((t) => !['Cancelled', 'Completed', 'Error'].includes(t.Status))
                .map(fromTimer)
                .filter((t) => t.recording || !t.end || t.end > now);
            timers.sort((a, b) => (a.start || 0) - (b.start || 0));
            data.scheduled = { status: 'ready', items: timers };
        } else data.scheduled = { status: 'error', items: [] };
        if (ser.status === 'fulfilled') {
            const items = ((ser.value && ser.value.Items) || []).map((st) => fromSeriesTimer(st, timers));
            items.sort((a, b) => lc(a.title).localeCompare(lc(b.title)));
            data.series = { status: 'ready', items };
        } else data.series = { status: 'error', items: [] };
        for (const r of [rec, tim, ser]) if (r.status === 'rejected') console.error('[HOMER Recordings]', r.reason);
        return data;
    };
    const sigOf = (res) => JSON.stringify(res.map((r) => (r.status === 'fulfilled' ? r.value : 'error')));
    const load = async (server) => {
        const res = await fetchAll(server);
        return { sig: sigOf(res), data: parse(res) };
    };

    // ---------- Deleting and cancelling ----------

    // 'delete' a recording, 'cancel' a timer (one that's recording stops),
    // 'cancelSeries' a series timer. Throws with the status in the message
    // ("… → 403") when Jellyfin says no.
    const remove = (action, id) => {
        if (action === 'delete') return request('DELETE', `/Items/${id}`);
        if (action === 'cancel') return request('DELETE', `/LiveTv/Timers/${id}`);
        if (action === 'cancelSeries') return request('DELETE', `/LiveTv/SeriesTimers/${id}`);
        return Promise.reject(new Error('Unknown action: ' + action));
    };

    window.HomerRecordingsModel = {
        version: VERSION,
        TABS,
        load,
        groupRecordings,
        remove,
        play,
        util: { esc, lc, clamp, plural, toDate, fmtTime, fmtDay, fmtRange, fmtMins, fmtIn, logoUrl, TICKS_PER_MIN }
    };
})();
