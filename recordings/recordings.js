/*
 * HOMER Recordings for Jellyfin Web: the Live TV DVR as a "My Shows" screen on
 * the same 1080-tall HOMER stage as the library screens.
 *
 * Takes over Jellyfin's Live TV → Recordings tab (#/livetv?tab=3) while it's
 * showing; Jellyfin's page stays underneath, untouched. The other Live TV tabs
 * stay Jellyfin's (tab=1, the Guide, is already the HOMER guide).
 *
 * Three tabs:
 *   Recorded   what's been recorded, a show with several recordings as a folder
 *   Scheduled  upcoming recordings (every timer, one-time or from a series)
 *   Series     series recordings
 *
 * OK plays (Resume / Restart when partly watched). Delete, Cancel recording and
 * Cancel series ask for a second OK on the same button before they do anything.
 *
 * Remote/keyboard: arrows move, OK/Enter acts, [ ] or ◀▶ on the tab row switch
 * tabs, Esc/Backspace goes back, H goes Home, G opens the guide.
 *
 * window.HomerRecordings = { open(tab), close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerRecordings && typeof window.HomerRecordings.destroy === 'function') {
        window.HomerRecordings.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="recordings.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/recordings\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'recordings/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const TICKS_PER_MIN = 600000000;
    const Z = 99990; // just under the guide, so the guide can open on top
    const CONFIRM_MS = 4000; // an armed Delete/Cancel button gives up after this
    const CONFIRM_MIN_MS = 400; // …and ignores a second press sooner than this (double clicks)
    const REFRESH_MS = 60000;
    const TABS = [
        { id: 'recorded', label: 'Recorded' },
        { id: 'scheduled', label: 'Scheduled' },
        { id: 'series', label: 'Series' }
    ];
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

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
    // While a video plays docked in a preview window, HOMER screens sit on top of
    // Jellyfin's #/video page and navigate virtually; HomerPlayer knows the real
    // route. Without it, the address bar is the route.

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Recordings]', err); return fallback; }
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
    // Back, like a remote: the previous page, or Home when this was the first
    // page in the tab.
    const goBack = () => {
        const p = HP();
        if (docked() && typeof p.back === 'function') {
            p.back();
            return;
        }
        const before = location.href;
        history.back();
        setTimeout(() => {
            if (location.href === before) go('#/home');
        }, 400);
    };
    const goHome = () => {
        const p = HP();
        if (p && typeof p.goHome === 'function') p.goHome();
        else if (window.HomerHome && window.HomerHome.goHome) window.HomerHome.goHome();
        else location.hash = '#/home';
    };
    const openGuide = () => {
        if (window.ChannelGuide && typeof window.ChannelGuide.open === 'function') window.ChannelGuide.open();
        else go('#/livetv?tab=1');
    };

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
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
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };

    const img = (id, type, tag, q) => `/Items/${id}/Images/${type}?${q}${tag ? '&tag=' + encodeURIComponent(tag) : ''}`;
    const logoUrl = (chId, tag) => img(chId, 'Primary', tag, 'maxHeight=120');

    // Stylesheets load on first open. tokens.css normally comes from homer.js;
    // load it here too when this script is used on its own.
    let cssReady = null;
    const ensureCss = () => {
        if (!document.getElementById('homer-tokens')) {
            const t = document.createElement('link');
            t.id = 'homer-tokens';
            t.rel = 'stylesheet';
            t.href = BASE + '../shared/tokens.css' + QUERY;
            document.head.appendChild(t);
        }
        if (cssReady && document.getElementById('hr-css')) return cssReady;
        const css = document.createElement('link');
        css.id = 'hr-css';
        css.rel = 'stylesheet';
        css.href = BASE + 'recordings.css' + QUERY;
        cssReady = new Promise((resolve) => {
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
        });
        document.head.appendChild(css);
        return cssReady;
    };

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

    // ---------- Pixel scrolling ----------
    // The trackpad moves the list freely; keyboard selection nudges it just enough
    // to keep the highlight in view. Wheel never moves the selection.
    const makeScroller = (viewport, inner, onMove = null) => {
        let pos = 0;
        const set = (p, animate) => {
            pos = clamp(p, 0, Math.max(0, inner.offsetHeight - viewport.clientHeight));
            inner.style.transition = animate ? 'transform 160ms ease' : 'none';
            inner.style.transform = `translateY(${-pos}px)`;
            if (onMove) onMove(pos, viewport.clientHeight);
        };
        return {
            set,
            get pos() { return pos; },
            reset() { set(0, false); },
            refresh() { set(pos, false); },
            reveal(start, size, animate = true) {
                if (start < pos) set(start, animate);
                else if (start + size > pos + viewport.clientHeight) set(start + size - viewport.clientHeight, animate);
            },
            wheel(ev) {
                const d = ev.deltaY;
                const px = ev.deltaMode === 1 ? d * 40 : ev.deltaMode === 2 ? d * viewport.clientHeight : d;
                set(pos + px, false);
            }
        };
    };

    // Row art loads for what's on screen plus a screen either side. (Native lazy
    // loading can't see these rows: they move by transform inside a clipped box.)
    const loadNear = (inner) => (pos, size) => {
        for (const im of inner.querySelectorAll('img[data-src]')) {
            const row = im.closest('.hr-row');
            if (!row) continue;
            const top = row.offsetTop;
            if (top + row.offsetHeight >= pos - size && top <= pos + size * 2) {
                im.src = im.dataset.src;
                im.removeAttribute('data-src');
            }
        }
    };

    // Hover highlights, but only when the pointer really moved: a list sliding
    // under a resting pointer (trackpad scrolling) must not drag the highlight.
    const hoverTracker = () => {
        let x = -1;
        let y = -1;
        return (ev) => {
            if (ev.clientX === x && ev.clientY === y) return false;
            x = ev.clientX;
            y = ev.clientY;
            return true;
        };
    };

    // Channel logo on a light chip, in the logo's own colors; the channel's name
    // when there's no logo.
    const logoHtml = (chId, chName, chTag, lazy) => {
        if (chId) return `<div class="hr-logo" data-name="${esc(chName)}"><img ${lazy ? 'data-src' : 'src'}="${esc(logoUrl(chId, chTag))}" alt=""></div>`;
        if (chName) return `<div class="hr-logo text"><span>${esc(chName)}</span></div>`;
        return '<span class="material-icons hr-noart" aria-hidden="true">live_tv</span>'; // no channel known
    };
    const wireLogos = (root) => {
        for (const im of root.querySelectorAll('.hr-logo img')) {
            im.onerror = () => {
                const chip = im.parentNode;
                chip.classList.add('text');
                chip.innerHTML = `<span>${esc(chip.dataset.name || 'TV')}</span>`;
            };
        }
    };

    // ---------- The screen ----------

    const memory = { tab: 'recorded', sel: {}, folder: null };

    const createScreen = (server, startTab) => {
        const root = el('div', 'homer-screen');
        root.id = 'hr-root';
        root.style.visibility = 'hidden'; // until recordings.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hr-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hr-topbar">
                <div class="hr-brand homer-home" role="button" title="Home (H)"><span class="hr-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hr-brand-sub">RECORDINGS</span></div>
                <div class="hr-clock"><div class="hr-clock-time"></div><div class="hr-clock-date"></div></div>
            </div>
            <div class="hr-toast" role="status" aria-live="polite"></div>
            <div class="hr-list">
                <div class="hr-list-head">
                    <div class="hr-tabs">${TABS.map((t) => `<div class="hr-tab" data-tab="${t.id}" role="tab">${t.label}<span class="hr-tab-n"></span></div>`).join('')}</div>
                    <div class="hr-count"></div>
                </div>
                <div class="hr-rows"><div class="hr-rows-inner"></div><div class="hr-state"></div></div>
            </div>
            <div class="hr-detail">
                <div class="hr-preview" data-homer-preview>
                    <div class="hr-preview-art"></div>
                    <div class="hr-preview-poster"></div>
                    <div class="hr-preview-logo"></div>
                    <div class="hr-preview-badge"></div>
                    <div class="hr-preview-bar"><span class="hr-preview-left"></span><span class="hr-preview-right"></span></div>
                    <div class="hr-progress"><i></i></div>
                </div>
                <div class="hr-text">
                    <div class="hr-kicker"></div>
                    <div class="hr-title"></div>
                    <div class="hr-episode"></div>
                    <div class="hr-meta"></div>
                    <div class="hr-desc"></div>
                    <div class="hr-actions"></div>
                </div>
            </div>
            <div class="hr-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        // always 1080 tall and as wide as the window allows (min 1600), like every
        // HOMER screen, so it fills the window instead of letterboxing
        const fit = () => {
            let s = window.innerHeight / 1080;
            let w = window.innerWidth / s;
            if (w < 1600) { s = window.innerWidth / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        const tick = () => {
            const d = new Date();
            $('.hr-clock-time').textContent = fmtTime(d);
            $('.hr-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);

        const toastEl = $('.hr-toast');
        let toastTimer = 0;
        const toast = (msg, kind = '') => {
            toastEl.innerHTML = `<span class="hr-toast-text">${esc(msg)}</span>`;
            toastEl.className = 'hr-toast show' + (kind ? ' ' + kind : '');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toastEl.className = 'hr-toast'; }, 3200);
        };

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- state -----
        let alive = true;
        let tab = TABS.some((t) => t.id === startTab) ? startTab : memory.tab;
        let folder = null; // group key while inside a show's folder (Recorded)
        let zone = 'list'; // tabs | list | actions
        let act = 0;
        let actions = [];
        let rows = []; // { e, el }
        let sel = -1;
        let armed = null; // { key, at } while a Delete/Cancel waits for its second OK
        let armTimer = 0;
        let busy = false;
        const data = {
            recorded: { status: 'loading', items: [] },
            scheduled: { status: 'loading', items: [] },
            series: { status: 'loading', items: [] }
        };

        const rowsView = $('.hr-rows');
        const inner = $('.hr-rows-inner');
        const scroller = makeScroller(rowsView, inner, loadNear(inner));
        const moved = hoverTracker();
        const stateEl = $('.hr-state');
        const setState = (html) => {
            stateEl.innerHTML = html || '';
            stateEl.classList.toggle('show', !!html);
        };
        const current = () => (rows[sel] ? rows[sel].e : null);

        // ----- preview window -----
        let artUrl = null;
        let artLogo = null;
        const showLogo = (on) => {
            const box = $('.hr-preview-logo');
            box.innerHTML = on && artLogo ? logoHtml(artLogo && artLogo.chId, artLogo && artLogo.chName, artLogo && artLogo.chTag, false) : '';
            wireLogos(box);
        };
        // Art fades in once it has loaded, instead of the window sitting blank (or
        // showing the previous title) while it downloads. No art, or art that won't
        // load: the channel's logo.
        const setArt = (url, poster, logo) => {
            artLogo = logo;
            const key = `${url}|${poster}|${logo && logo.chId}|${logo && logo.chName}`;
            if (key === artUrl) return;
            artUrl = key;
            const art = $('.hr-preview-art');
            art.classList.remove('in');
            art.style.backgroundImage = 'none';
            $('.hr-preview-poster').innerHTML = '';
            showLogo(false);
            if (!url) {
                if (poster) $('.hr-preview-poster').innerHTML = `<img src="${esc(poster)}" alt="">`;
                else showLogo(true);
                return;
            }
            const im = new Image();
            im.onload = () => {
                if (artUrl !== key) return;
                art.style.backgroundImage = `url("${url}")`;
                art.classList.add('in');
            };
            im.onerror = () => {
                if (artUrl === key) showLogo(true);
            };
            im.src = url;
        };

        const renderInfo = (info) => {
            const kicker = $('.hr-kicker');
            kicker.innerHTML = info.chName || info.chId
                ? `${logoHtml(info.chId, info.chName, info.chTag, false)}<span class="hr-kicker-text">${esc(info.chName || '')}${info.when ? `<i>${esc(info.when)}</i>` : ''}</span>`
                : '';
            wireLogos(kicker);
            kicker.style.display = kicker.innerHTML ? '' : 'none';
            const title = $('.hr-title');
            title.textContent = info.title || '';
            title.classList.toggle('long', (info.title || '').length > 30);
            const ep = $('.hr-episode');
            ep.innerHTML = info.episode || '';
            ep.style.display = info.episode ? '' : 'none';
            $('.hr-meta').innerHTML = (info.chips || []).filter((c) => c && c.text)
                .map((c) => `<span class="hr-chip${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>`).join('');
            $('.hr-desc').textContent = info.desc || '';
            $('.hr-desc').classList.toggle('empty', !info.desc);
            setArt(info.art || null, info.poster || null, info.title || info.chId ? { chId: info.chId, chName: info.chName, chTag: info.chTag } : null);
            $('.hr-preview-badge').innerHTML = info.badge || '';
            $('.hr-preview-left').textContent = info.barLeft || '';
            $('.hr-preview-right').textContent = info.barRight || '';
            $('.hr-progress').style.display = info.progress ? '' : 'none';
            $('.hr-progress > i').style.width = (info.progress || 0) + '%';
        };

        // ----- actions -----
        const actionsFor = (e) => {
            if (!e) return [];
            if (e.kind === 'group') return [{ id: 'open', icon: 'folder_open', label: `Open · ${e.children.length}` }];
            if (e.kind === 'rec') {
                const list = e.pos > 0
                    ? [{ id: 'resume', icon: 'play_arrow', label: 'Resume' }, { id: 'restart', icon: 'replay', label: 'Restart' }]
                    : [{ id: 'play', icon: 'play_arrow', label: 'Play' }];
                if (e.canDelete) list.push({ id: 'delete', icon: 'delete', label: 'Delete', confirm: 'Delete? OK to confirm', busy: 'Deleting…', danger: true });
                return list;
            }
            if (e.kind === 'timer') return [{ id: 'cancel', icon: 'event_busy', label: 'Cancel recording', confirm: 'Cancel? OK to confirm', busy: 'Cancelling…', danger: true }];
            if (e.kind === 'series') return [{ id: 'cancelSeries', icon: 'event_busy', label: 'Cancel series', confirm: 'Cancel series? OK to confirm', busy: 'Cancelling…', danger: true }];
            return [];
        };
        const armKey = (a) => (current() ? current().key + '|' + a.id : '');
        const isArmed = (a) => !!(armed && a && armed.key === armKey(a));

        const drawActions = () => {
            act = clamp(act, 0, Math.max(0, actions.length - 1));
            $('.hr-actions').innerHTML = actions.map((a, i) => {
                const on = isArmed(a);
                const label = on ? (busy ? a.busy : a.confirm) : a.label;
                const cls = ['hr-btn', i === act ? 'cur' : '', i === act && zone === 'actions' ? 'focus' : '', a.danger ? 'danger' : '', on ? 'armed' : '', on && busy ? 'busy' : ''].filter(Boolean).join(' ');
                return `<div class="${cls}" role="button" data-i="${i}"><span class="material-icons" aria-hidden="true">${on && !busy ? 'warning' : a.icon}</span><span>${esc(label)}</span></div>`;
            }).join('');
        };

        const disarm = () => {
            clearTimeout(armTimer);
            if (!armed) return;
            armed = null;
            if (alive) {
                drawActions();
                updateLegend();
            }
        };
        const arm = (a) => {
            clearTimeout(armTimer);
            armed = { key: armKey(a), at: Date.now() };
            armTimer = setTimeout(disarm, CONFIRM_MS);
            drawActions();
            updateLegend();
        };

        // ----- legend -----
        const updateLegend = () => {
            const st = data[tab].status;
            const items = [];
            if (st === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (zone === 'tabs') {
                items.push({ key: '◀▶', label: 'Switch', action: 'next-tab' });
                if (rows.length) items.push({ key: '▼', label: 'List' });
            } else if (st === 'ready' && rows.length) {
                const e = current();
                const primary = zone === 'actions' ? actions[act] : (e && (e.kind === 'rec' || e.kind === 'group') ? actions[0] : null);
                items.push({ key: '▲▼', label: 'Browse' });
                if (zone === 'list') items.push({ key: '▶', label: 'Options' });
                else items.push({ key: '◀▶', label: 'Options' });
                if (primary) {
                    const armedNow = isArmed(primary);
                    items.push({ key: 'OK', label: armedNow ? 'Confirm' : primary.label.replace(/ · \d+$/, ''), action: 'ok', danger: armedNow });
                } else if (zone === 'list' && actions.length) items.push({ key: 'OK', label: 'Options', action: 'ok' });
            }
            items.push({ key: '[ ]', label: 'Tabs', action: 'next-tab' });
            if (folder) items.push({ key: '◀', label: 'All recordings', action: 'up' });
            items.push('spacer',
                { key: 'G', label: 'Guide', action: 'guide' },
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: armed ? 'Never mind' : 'Back', action: 'back' });
            $('.hr-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}${i.danger ? ' class="danger"' : ''}><span class="hr-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        // ----- tabs -----
        const markTabs = () => {
            root.querySelectorAll('.hr-tab').forEach((t) => {
                const on = t.dataset.tab === tab;
                t.classList.toggle('on', on);
                t.classList.toggle('focus', on && zone === 'tabs');
                const d = data[t.dataset.tab];
                t.querySelector('.hr-tab-n').textContent = d.status === 'ready' && d.items.length ? d.items.length : '';
            });
        };

        const setZone = (z) => {
            if (z !== zone) disarm();
            zone = z;
            root.classList.remove('hr-zone-tabs', 'hr-zone-list', 'hr-zone-actions');
            root.classList.add('hr-zone-' + z);
            markTabs();
            drawActions();
            updateLegend();
        };

        const setTab = (id) => {
            if (id === tab && !folder) return;
            disarm();
            tab = id;
            memory.tab = id;
            folder = null;
            memory.folder = null;
            render({ keepScroll: false });
            // a new tab never opens with a Cancel button already under the remote
            if (rows.length) setZone(zone === 'tabs' ? 'tabs' : 'list');
        };
        const switchTab = (d) => {
            const i = TABS.findIndex((t) => t.id === tab);
            setTab(TABS[(i + d + TABS.length) % TABS.length].id);
        };

        // ----- rows -----
        const flagFor = (e) => {
            if (e.recording) return '<span class="hr-rec-pill">REC</span>';
            if (e.kind === 'group') {
                return `${e.unwatched ? `<span class="hr-count-dot">${e.unwatched}</span>` : '<span class="material-icons hr-check">check</span>'}<span class="material-icons hr-chev">chevron_right</span>`;
            }
            if (e.kind === 'rec') {
                if (e.pos > 0 && e.ticks) return `<span class="hr-left">${fmtMins((e.ticks - e.pos) / TICKS_PER_MIN)} left</span>`;
                if (e.played) return '<span class="material-icons hr-check">check</span>';
                return '<span class="hr-dot" title="Not watched yet"></span>';
            }
            if (e.kind === 'timer') {
                if (e.conflict) return '<span class="hr-warn">CONFLICT</span>';
                return `${e.fromSeries ? '<span class="material-icons hr-series-ic" title="From a series recording">repeat</span>' : ''}<span class="hr-rec-dot" title="Set to record"></span>`;
            }
            if (e.kind === 'series') return e.upcoming.length ? `<span class="hr-upcoming">${e.upcoming.length} upcoming</span>` : '';
            return '';
        };

        const thumbHtml = (e) => (e.thumb
            ? `<div class="hr-thumb"><img data-src="${esc(e.thumb)}" alt="">${e.chId || e.chName ? `<div class="hr-thumb-logo">${logoHtml(e.chId, e.chName, e.chTag, true)}</div>` : ''}</div>`
            : `<div class="hr-thumb bare">${logoHtml(e.chId, e.chName, e.chTag, true)}</div>`);

        const airTime = (e) => (e.start ? `${fmtDay(e.start)} ${fmtTime(e.start)}` : '');
        const subFor = (e) => {
            if (e.kind === 'rec') {
                const dur = e.mins ? fmtMins(e.mins) : '';
                if (folder) return [e.code, e.episode ? airTime(e) : '', dur].filter(Boolean).join(' · ');
                return [[e.code, e.episode].filter(Boolean).join(' · '), fmtDay(e.start), dur].filter(Boolean).join(' · ');
            }
            if (e.kind === 'group') return [plural(e.children.length, 'recording'), e.newest.start ? `Latest ${fmtDay(e.newest.start)}` : ''].filter(Boolean).join(' · ');
            if (e.kind === 'timer') return [e.episode, e.chName, e.mins ? fmtMins(e.mins) : ''].filter(Boolean).join(' · ');
            if (e.kind === 'series') return [e.chName, e.which, e.when].filter(Boolean).join(' · ');
            return '';
        };

        const makeRow = (e) => {
            const r = el('div', 'hr-row hr-row-' + e.kind);
            let lead = '';
            if (e.kind === 'timer') {
                const [t, ampm] = e.start ? (() => {
                    const s = fmtTime(e.start);
                    const m = s.match(/^(.*?)\s*([AP]\.?M\.?)$/i);
                    return m ? [m[1], m[2]] : [s, ''];
                })() : ['–', ''];
                const day = e.start ? fmtDay(e.start).replace(/,.*$/, '') : '';
                lead = `<div class="hr-when"><small>${esc(day)}</small><b>${esc(t)}<em>${esc(ampm)}</em></b></div>`;
                lead += `<div class="hr-thumb bare">${logoHtml(e.chId, e.chName, e.chTag, true)}</div>`;
            } else lead = thumbHtml(e);
            // in a folder the show's name is the folder; each row is its episode
            const title = e.kind === 'rec' && folder ? (e.episode || airTime(e) || e.title) : e.title;
            r.innerHTML = `
                ${lead}
                <div class="hr-row-text"><div class="hr-row-title">${esc(title)}</div><div class="hr-row-sub">${esc(subFor(e))}</div></div>
                <div class="hr-row-flag">${flagFor(e)}</div>
                ${e.pct ? `<div class="hr-row-progress"><i style="width:${e.pct}%"></i></div>` : ''}`;
            if (e.kind === 'group') r.classList.add('folder');
            if (e.played) r.classList.add('played');
            for (const im of r.querySelectorAll('.hr-thumb > img')) {
                im.onload = () => im.classList.add('in');
                im.onerror = () => {
                    const box = im.parentNode;
                    im.remove();
                    box.classList.add('bare');
                    const lg = box.querySelector('.hr-thumb-logo');
                    if (lg) lg.classList.add('big');
                };
            }
            wireLogos(r);
            return r;
        };

        const entries = () => {
            const d = data[tab];
            if (tab !== 'recorded') return d.items;
            const top = groupRecordings(d.items);
            if (!folder) return top;
            const g = top.find((x) => x.key === folder);
            return g ? g.children : null;
        };

        const EMPTY = {
            recorded: '<b>Nothing recorded yet</b><span>Press <em>R</em> on a show in the guide to record it. Press <em>G</em> for the guide.</span>',
            scheduled: '<b>Nothing scheduled to record</b><span>Press <em>R</em> on a program in the guide to record it. Press <em>G</em> for the guide.</span>',
            series: '<b>No series recordings</b><span>A series recording records every new episode of a show. Set one up from a show in Jellyfin and it shows up here.</span>'
        };
        const NOUNS = { recorded: 'recordings', scheduled: 'scheduled recordings', series: 'series recordings' };

        const showInfo = (e) => {
            actions = actionsFor(e);
            if (!e) {
                renderInfo({});
                if (data[tab].status === 'ready') { // an empty tab: the DVR's glyph, not a blank window
                    $('.hr-preview-logo').innerHTML = '<span class="material-icons hr-preview-empty" aria-hidden="true">fiber_smart_record</span>';
                    artUrl = null;
                }
                drawActions();
                updateLegend();
                return;
            }
            if (e.kind === 'rec') {
                let badge = '';
                if (e.recording) badge = '<span class="hr-chip hr-chip-rec">Recording now</span>';
                else if (e.pos > 0) badge = '<span class="hr-chip hr-chip-resume">In progress</span>';
                else if (e.played) badge = '<span class="hr-chip">Watched</span>';
                renderInfo({
                    chId: e.chId,
                    chName: e.chName,
                    chTag: e.chTag,
                    title: e.title,
                    episode: e.code || e.episode ? `${e.code ? `<b>${esc(e.code)}</b>` : ''}${esc(e.episode)}` : '',
                    chips: [{ text: fmtDay(e.start) }, { text: fmtRange(e.start, e.end) }, { text: e.mins ? fmtMins(e.mins) : '' }, { text: e.rating }],
                    desc: e.overview,
                    art: e.art,
                    poster: e.poster,
                    badge,
                    barLeft: e.start ? `Recorded ${fmtDay(e.start)}` : '',
                    barRight: e.pos > 0 && e.ticks ? `${fmtMins((e.ticks - e.pos) / TICKS_PER_MIN)} left` : (e.mins ? fmtMins(e.mins) : ''),
                    progress: e.pct
                });
            } else if (e.kind === 'group') {
                const n = e.newest;
                renderInfo({
                    chId: e.chId,
                    chName: e.chName,
                    chTag: e.chTag,
                    title: e.title,
                    episode: `<b>${plural(e.children.length, 'recording')}</b>${n.episode ? esc('Latest: ' + n.episode) : ''}`,
                    chips: [{ text: n.start ? `Latest ${fmtDay(n.start)}` : '' }, { text: e.unwatched ? `${e.unwatched} not watched` : 'All watched', cls: e.unwatched ? 'hr-chip-new' : '' }],
                    desc: n.overview,
                    art: e.art,
                    poster: e.poster,
                    badge: e.recording ? '<span class="hr-chip hr-chip-rec">Recording now</span>' : '',
                    barLeft: 'Show folder',
                    barRight: plural(e.children.length, 'recording')
                });
            } else if (e.kind === 'timer') {
                const chips = [{ text: fmtDay(e.start) }, { text: fmtRange(e.start, e.end) }, { text: e.mins ? fmtMins(e.mins) : '' }];
                if (e.fromSeries) chips.push({ text: 'Series', cls: 'genre' });
                if (e.conflict) chips.push({ text: 'Tuner conflict', cls: 'hr-chip-warn' });
                chips.push({ text: e.rating });
                renderInfo({
                    chId: e.chId,
                    chName: e.chName,
                    chTag: e.chTag,
                    title: e.title,
                    episode: e.code || e.episode ? `${e.code ? `<b>${esc(e.code)}</b>` : ''}${esc(e.episode)}` : '',
                    chips,
                    desc: e.overview,
                    art: e.art,
                    poster: e.poster,
                    badge: e.recording ? '<span class="hr-chip hr-chip-rec">Recording now</span>' : '<span class="hr-chip hr-chip-sched">Will record</span>',
                    barLeft: e.recording ? 'Recording now' : (e.start ? fmtIn(e.start) : ''),
                    barRight: e.mins ? fmtMins(e.mins) : ''
                });
            } else if (e.kind === 'series') {
                const next = e.upcoming.find((t) => t.start && t.start > Date.now()) || e.upcoming[0];
                renderInfo({
                    chId: e.chId,
                    chName: e.chName,
                    chTag: e.chTag,
                    title: e.title,
                    episode: e.upcoming.length
                        ? `<b>${plural(e.upcoming.length, 'upcoming recording')}</b>${next && next.start ? esc(`Next: ${fmtDay(next.start)} ${fmtTime(next.start)}`) : ''}`
                        : '<b>Nothing coming up in the guide yet</b>',
                    chips: [{ text: e.which, cls: 'genre' }, { text: e.when }, { text: e.days }, { text: e.anyChannel ? 'Any channel' : '' }, { text: e.keep }],
                    desc: e.overview,
                    art: e.art,
                    badge: '<span class="hr-chip hr-chip-sched">Series recording</span>',
                    barLeft: e.which,
                    barRight: e.upcoming.length ? `${e.upcoming.length} upcoming` : ''
                });
            }
            drawActions();
            updateLegend();
        };

        const updateCount = () => {
            const count = $('.hr-count');
            const d = data[tab];
            if (folder) {
                const g = groupRecordings(d.items).find((x) => x.key === folder);
                count.innerHTML = g ? `<span class="hr-crumb" data-action="up"><span class="material-icons">chevron_left</span>${esc(g.title)}</span>` : '';
                return;
            }
            count.textContent = d.status === 'ready' && d.items.length ? plural(d.items.length, NOUNS[tab].replace(/s$/, '')) : '';
        };

        // Draw the current tab (or folder). keepScroll: a quiet refresh keeps the
        // list where it was and the highlight on the same recording.
        const render = ({ keepScroll = false, keepKey = null } = {}) => {
            const d = data[tab];
            const oldPos = scroller.pos;
            const oldSel = sel;
            inner.innerHTML = '';
            rows = [];
            sel = -1;
            markTabs();
            let list = entries();
            if (folder && !list) { // the folder emptied out (or is down to one recording)
                keepKey = folder;
                folder = null;
                memory.folder = null;
                list = entries();
            }
            root.classList.toggle('hr-in-folder', !!folder);
            updateCount();
            if (d.status === 'loading') {
                setState('<div class="hr-spinner"></div><b>Loading…</b>');
                showInfo(null);
                return;
            }
            if (d.status === 'error') {
                setState(`<b>Couldn't load ${NOUNS[tab]}</b><span>Jellyfin didn't answer. Press OK to try again.</span>`);
                renderInfo({ title: `Couldn't load ${NOUNS[tab]}`, desc: 'Check that the Jellyfin server is reachable, then press OK to try again.' });
                actions = [];
                drawActions();
                updateLegend();
                return;
            }
            if (!list.length) {
                setState(EMPTY[tab]);
                showInfo(null);
                if (zone !== 'tabs') setZone('tabs');
                return;
            }
            setState('');
            rows = list.map((e) => {
                const r = makeRow(e);
                inner.appendChild(r);
                return { e, el: r };
            });
            const want = keepKey || memory.sel[folder || tab];
            let i = want ? rows.findIndex((r) => r.e.key === want) : -1;
            if (i < 0 && keepScroll) i = clamp(oldSel, 0, rows.length - 1); // it went away: its neighbor
            if (i < 0) i = 0;
            if (keepScroll) scroller.set(oldPos, false);
            else scroller.reset();
            select(i, { scroll: true, animate: false });
            scroller.refresh(); // load the art for the rows now on screen
        };

        const select = (i, { scroll = true, animate = true } = {}) => {
            if (!rows[i]) return;
            if (rows[sel]) rows[sel].el.classList.remove('sel');
            if (sel !== i) {
                act = 0;
                disarm();
            }
            sel = i;
            rows[i].el.classList.add('sel');
            if (scroll) scroller.reveal(rows[i].el.offsetTop - 8, rows[i].el.offsetHeight + 16, animate);
            memory.sel[folder || tab] = rows[i].e.key;
            showInfo(rows[i].e);
        };
        const step = (d) => {
            if (!rows.length) return;
            select(clamp(sel + d, 0, rows.length - 1));
        };

        const openFolder = (g) => {
            disarm();
            folder = g.key;
            memory.folder = g.key;
            render();
            setZone('list');
        };
        const closeFolder = () => {
            if (!folder) return;
            const key = folder;
            folder = null;
            memory.folder = null;
            render({ keepKey: key });
            setZone('list');
        };

        // ----- doing things -----
        const perform = async (e, a) => {
            busy = true;
            drawActions();
            updateLegend();
            const label = e.kind === 'rec' ? [e.title, e.episode].filter(Boolean).join(': ') : e.title;
            try {
                if (a.id === 'delete') await request('DELETE', `/Items/${e.id}`);
                else if (a.id === 'cancel') await request('DELETE', `/LiveTv/Timers/${e.id}`);
                else if (a.id === 'cancelSeries') await request('DELETE', `/LiveTv/SeriesTimers/${e.id}`);
                if (!alive) return;
                toast(a.id === 'delete' ? `Deleted ${label}` : a.id === 'cancel' ? `Won't record ${label}` : `Cancelled the series recording of ${label}`);
                // drop it now; the refresh below brings the rest up to date
                const tabId = a.id === 'delete' ? 'recorded' : a.id === 'cancel' ? 'scheduled' : 'series';
                data[tabId].items = data[tabId].items.filter((x) => x.id !== e.id);
                busy = false;
                armed = null;
                render({ keepScroll: true });
                setZone(rows.length ? 'list' : 'tabs'); // back to the list, on the neighbor
                refresh();
            } catch (err) {
                console.error('[HOMER Recordings]', err);
                if (!alive) return;
                const what = a.id === 'delete' ? 'delete this recording' : a.id === 'cancel' ? 'cancel this recording' : 'cancel this series';
                toast(/→ 403/.test(err.message) ? `You don't have permission to ${what}` : `Couldn't ${what}`, 'err');
                busy = false;
                disarm();
                drawActions();
            }
        };

        const run = (a) => {
            const e = current();
            if (!a || !e || busy) return;
            if (a.confirm) {
                if (!isArmed(a)) {
                    arm(a);
                    return;
                }
                if (Date.now() - armed.at < CONFIRM_MIN_MS) return; // a double click isn't a decision
                clearTimeout(armTimer);
                perform(e, a);
                return;
            }
            disarm();
            if (a.id === 'open') {
                openFolder(e);
                return;
            }
            const start = a.id === 'resume' ? e.pos : 0;
            const name = [e.title, e.episode].filter(Boolean).join(': ');
            toast(`${a.id === 'resume' ? 'Resuming' : a.id === 'restart' ? 'Restarting' : 'Playing'} ${name}`);
            play(e.id, start).catch((err) => {
                console.error('[HOMER Recordings] Playback failed:', err);
                if (alive) toast('Couldn\'t start playback', 'err');
            });
        };

        // OK in the list: play a recording, open a folder; for timers and series
        // (whose only action is a cancel) go to the button instead of pressing it.
        const okInList = () => {
            const e = current();
            if (!e || !actions.length) return;
            if (e.kind === 'rec' || e.kind === 'group') run(actions[0]);
            else {
                act = 0;
                setZone('actions');
            }
        };

        // ----- input -----
        const eat = (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        };
        const back = () => {
            if (armed) disarm();
            else if (folder) closeFolder();
            else goBack();
        };
        const retry = () => {
            if (data[tab].status === 'error') load();
        };

        const onKey = (ev) => {
            // the guide opens on top of us; it gets the keys while it's up
            if (document.getElementById('cg-root')) return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') {
                eat(ev);
                if (!ev.repeat) goHome();
                return;
            }
            if (BACK_KEYS.includes(k)) {
                eat(ev);
                if (!ev.repeat) back();
                return;
            }
            if (k === '[' || k === ']') {
                eat(ev);
                switchTab(k === ']' ? 1 : -1);
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return; // G (the guide) and the rest pass through
            eat(ev);
            if (k === 'Enter' && ev.repeat) return; // holding OK must never confirm a delete
            if (data[tab].status === 'error' && k === 'Enter') return retry();
            if (zone === 'tabs') {
                if (k === 'ArrowLeft') switchTab(-1);
                else if (k === 'ArrowRight') switchTab(1);
                else if ((k === 'ArrowDown' || k === 'Enter') && rows.length) setZone('list');
                return;
            }
            if (!rows.length) {
                if (k === 'ArrowUp') setZone('tabs');
                return;
            }
            if (zone === 'list') {
                if (k === 'ArrowDown') step(1);
                else if (k === 'ArrowUp') {
                    if (sel <= 0) setZone('tabs');
                    else step(-1);
                } else if (k === 'PageDown') step(6);
                else if (k === 'PageUp') step(-6);
                else if (k === 'Home') select(0);
                else if (k === 'End') select(rows.length - 1);
                else if (k === 'ArrowRight' && actions.length) {
                    act = 0;
                    setZone('actions');
                } else if (k === 'ArrowLeft' && folder) closeFolder();
                else if (k === 'Enter') okInList();
            } else if (zone === 'actions') {
                if (k === 'ArrowRight') {
                    if (act < actions.length - 1) { act += 1; disarm(); drawActions(); updateLegend(); }
                } else if (k === 'ArrowLeft') {
                    if (act === 0) setZone('list');
                    else { act -= 1; disarm(); drawActions(); updateLegend(); }
                } else if (k === 'ArrowUp' || k === 'ArrowDown') {
                    setZone('list');
                    step(k === 'ArrowDown' ? 1 : -1);
                } else if (k === 'Enter') run(actions[act]);
            }
        };

        // Jellyfin's player turns the wheel into volume, and the page underneath
        // would scroll: every wheel event is ours while this screen is up.
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (rowsView.contains(ev.target) && rows.length) scroller.wheel(ev);
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);

        $('.hr-brand').addEventListener('click', goHome);
        root.querySelectorAll('.hr-tab').forEach((t) => t.addEventListener('click', () => {
            setTab(t.dataset.tab);
            setZone(rows.length ? 'list' : 'tabs');
        }));
        $('.hr-count').addEventListener('click', (ev) => {
            if (ev.target.closest('[data-action="up"]')) closeFolder();
        });
        rowsView.addEventListener('mousemove', (ev) => {
            if (!moved(ev)) return;
            const r = ev.target.closest('.hr-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) return;
            if (zone !== 'list') setZone('list');
            if (i !== sel) select(i, { scroll: false });
        });
        rowsView.addEventListener('click', (ev) => {
            const r = ev.target.closest('.hr-row');
            const i = rows.findIndex((x) => x.el === r);
            if (i < 0) return;
            if (zone !== 'list') setZone('list');
            select(i, { scroll: false });
            const e = rows[i].e;
            if (e.kind === 'rec' || e.kind === 'group') run(actions[0]); // a click never deletes or cancels
        });
        const actionsBox = $('.hr-actions');
        actionsBox.addEventListener('mousemove', (ev) => {
            const b = ev.target.closest('.hr-btn');
            if (!b) return;
            const i = Number(b.dataset.i);
            if (zone === 'actions' && i === act) return;
            if (i !== act) disarm();
            act = i;
            setZone('actions');
        });
        actionsBox.addEventListener('click', (ev) => {
            const b = ev.target.closest('.hr-btn');
            if (!b) return;
            act = Number(b.dataset.i);
            if (zone !== 'actions') setZone('actions');
            run(actions[act]);
        });
        $('.hr-legend').addEventListener('click', (ev) => {
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const a = item.dataset.action;
            if (a === 'ok') {
                if (data[tab].status === 'error') retry();
                else if (zone === 'actions') run(actions[act]);
                else okInList();
            } else if (a === 'next-tab') switchTab(1);
            else if (a === 'up') closeFolder();
            else if (a === 'guide') openGuide();
            else if (a === 'home') goHome();
            else if (a === 'back') back();
        });

        // ----- data -----
        const fetchAll = () => {
            const uid = server.UserId;
            return Promise.allSettled([
                api(`/LiveTv/Recordings?UserId=${uid}&Fields=Overview,Path,CanDelete,ChannelInfo,PrimaryImageAspectRatio,DateCreated&EnableImageTypes=Primary,Thumb,Backdrop&ImageTypeLimit=1&EnableUserData=true&EnableTotalRecordCount=false`),
                api('/LiveTv/Timers'),
                api('/LiveTv/SeriesTimers?SortBy=SortName&SortOrder=Ascending')
            ]);
        };
        const apply = ([rec, tim, ser]) => {
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
        };

        let loadToken = 0;
        let lastSig = ''; // what the server said last time, so an unchanged refresh redraws nothing
        const sigOf = (res) => JSON.stringify(res.map((r) => (r.status === 'fulfilled' ? r.value : 'error')));
        const load = async () => {
            const token = ++loadToken;
            for (const t of TABS) data[t.id] = { status: 'loading', items: [] };
            render();
            const res = await fetchAll();
            if (!alive || token !== loadToken) return;
            lastSig = sigOf(res);
            apply(res);
            if (memory.folder && tab === 'recorded') folder = memory.folder;
            render();
            if (rows.length && zone === 'tabs') setZone('list');
            else if (!rows.length) setZone('tabs');
            else setZone(zone);
        };
        // quiet refresh: after a delete/cancel, and every minute (recordings finish,
        // scheduled ones start); never while a confirm is waiting
        const refresh = async () => {
            if (busy || armed) return;
            const token = ++loadToken;
            const res = await fetchAll();
            if (!alive || token !== loadToken || busy || armed) return;
            const sig = sigOf(res);
            if (sig === lastSig) return;
            lastSig = sig;
            apply(res);
            const key = current() && current().key;
            render({ keepScroll: true, keepKey: key });
            setZone(rows.length ? zone : 'tabs');
        };
        const refreshTimer = setInterval(refresh, REFRESH_MS);

        setZone('list');
        load();

        return {
            show() { root.style.visibility = ''; },
            setTab(id) { if (TABS.some((t) => t.id === id)) setTab(id); },
            teardown() {
                alive = false;
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearInterval(refreshTimer);
                clearTimeout(toastTimer);
                clearTimeout(armTimer);
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false; // closed via close(); stay out of the way until the route changes
    let destroyed = false;
    let pendingTab = null;

    // Jellyfin's Live TV → Recordings tab: #/livetv?tab=3 (also #!/livetv.html?…)
    const isOurRoute = () => {
        const m = currentRoute().match(/^#!?\/livetv(?:\.html)?\?(.*)$/i);
        return !!(m && new URLSearchParams(m[1]).get('tab') === '3');
    };

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        const server = getServer();
        if (!ours) suppressed = false;
        if (!ours || !server || suppressed) {
            closeScreen();
            return;
        }
        if (screen) {
            if (pendingTab) screen.setTab(pendingTab);
            pendingTab = null;
            return;
        }
        const s = createScreen(server, pendingTab);
        pendingTab = null;
        screen = s;
        ensureCss().then(() => { if (screen === s) s.show(); });
    };

    // HomerPlayer may load after this script; subscribe once it's there.
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
        // setTimeout, not requestAnimationFrame: rAF never fires in a background tab
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
        // Jellyfin's router uses pushState, which fires no event; watch the DOM
        // (it re-renders on every navigation) and check the address.
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerRecordings = {
        version: VERSION,
        // open(): the Recordings screen (going to #/livetv?tab=3 if needed);
        // open('scheduled' | 'series' | 'recorded'): on that tab
        open(tab) {
            suppressed = false;
            if (typeof tab === 'string' && TABS.some((t) => t.id === tab)) pendingTab = tab;
            if (!isOurRoute()) {
                go('#/livetv?tab=3');
                return;
            }
            lastSig = '';
            sync();
        },
        // close(): reveal Jellyfin's own page until the route changes
        close() {
            if (!screen) return;
            suppressed = true;
            closeScreen();
        },
        destroy() {
            destroyed = true;
            closeScreen();
            observer && observer.disconnect();
            if (unsubscribe) safe(unsubscribe);
            unsubscribe = null;
            document.removeEventListener('DOMContentLoaded', start);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.getElementById('hr-css')?.remove();
            cssReady = null;
        }
    };
})();
