/*
 * HOMER player: keeps a playing video going while you browse HOMER.
 *
 * Jellyfin Web stops a video the moment you leave its player page (#/video).
 * So while you browse, the address stays on #/video and HOMER's screens (Home,
 * Movies, TV Shows, show and movie pages) draw on top of it, with Jellyfin's
 * real video element pinned over whichever preview window the current screen
 * has. That's "docked". Moving between HOMER screens while docked doesn't
 * touch the address; this module keeps that screen stack instead, and the
 * screens ask route() for where they are rather than reading location.hash.
 *
 * Back (the player's ← button, Esc, Backspace) from full screen docks the
 * video into the screen you came from. Full screen (F, a click on the preview,
 * or the Full screen button) hands it back to Jellyfin's player. H, the HOMER
 * logo and the player's Home button go Home, taking the video along. The
 * browser's own Back goes back a screen while docked (see "The browser's
 * Back"). On a phone or tablet, live TV stops after the page has been hidden
 * for a few minutes.
 *
 * A screen that opens on top of another rather than being one (the TV guide)
 * starts a video with setBackAction(fn): Back from full screen docks the video
 * into the screen underneath and then runs fn, which puts that screen back up.
 *
 * window.HomerPlayer = { route, docked, nowPlaying, onChange, go, leave, back,
 *                        goHome, watch, fullscreen, stop, setBackAction,
 *                        isHomerHash, isHomeHash, destroy, version }
 */
(() => {
    const VERSION = '0.3.0';

    if (window.HomerPlayer && typeof window.HomerPlayer.destroy === 'function') {
        window.HomerPlayer.destroy();
    }

    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;
    const HOME = '#/home';

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
    const api = async (path) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, { headers: { Authorization: authHeader(server) } });
        if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    };
    const message = (msg) => {
        const ac = window.ApiClient;
        if (ac && typeof ac.handleMessageReceived === 'function') ac.handleMessageReceived(msg);
    };
    const playNow = (id, startTicks) => {
        const Data = { PlayCommand: 'PlayNow', ItemIds: [id] };
        if (startTicks != null) Data.StartPositionTicks = startTicks;
        message({ MessageType: 'Play', Data });
    };
    const stopPlayback = () => message({ MessageType: 'Playstate', Data: { Command: 'Stop' } });

    // ---------- Routes ----------

    const isVideoRoute = () => /^#\/video/.test(location.hash);
    const isHomeHash = (h) => /^#\/(home(\.html)?)?(\?.*)?$/.test(h) || h === '' || h === '#/';
    // the pages HOMER draws itself
    // Search, Recordings and Settings count once their screen has loaded
    const screenFor = (h) => (/^#\/search(\.html)?(\?|$)/.test(h) ? 'HomerSearch'
        : /^#\/livetv(\.html)?\?(.*&)?tab=3(&|$)/.test(h) ? 'HomerRecordings'
        : /^#\/mypreferencesmenu(\.html)?(\?|$)/.test(h) ? 'HomerSettings' : null);
    // #/weather and #/rooms are HOMER's own pages (Jellyfin has neither), so
    // they always count
    const isWeatherHash = (h) => /^#\/(weather|rooms)(\?|$)/.test(h);
    const isGuideHash = (h) => /^#\/livetv(\.html)?\?(.*&)?tab=1(&|$)/.test(h);
    // On a phone the guide is a screen like the others (with a preview window a
    // video can dock in); on a TV it opens on top of whatever's there.
    const phoneGuide = () => !!(window.HomerLayout && window.HomerLayout.usePhone('guide'));
    const isHomerHash = (h) => isHomeHash(h)
        || /^#\/(movies|tv|details)(\.html)?\?/.test(h)
        || isWeatherHash(h)
        || (isGuideHash(h) && phoneGuide())
        || (!!screenFor(h) && !!window[screenFor(h)]);
    // Jellyfin pages HOMER leaves alone: the admin dashboard, sign-in and setup,
    // and the player itself
    const isStockOk = (h) => /^#\/(dashboard|configurationpage|metadata|edititemmetadata|login|selectserver|addserver|forgotpassword|startup|wizard|quickconnect|video)/i.test(h);
    const playerBox = () => document.querySelector('.videoPlayerContainer');
    const overlayOpen = () => !!document.querySelector('#hm-root, #hl-root, #cg-root, .homer-screen');

    // ---------- State ----------

    let docked = false;
    let stack = []; // HOMER screens while docked; the last one is on screen
    let lastStack = null; // where Back from full screen returns to
    let landing = null; // after the video ends: the screen to put the address on
    let landingSince = 0;
    let nowPlaying = null; // { program } for live TV, { item } for anything else
    let sawPlayer = false; // Jellyfin's player page has opened for this video
    let dockedSince = 0;
    let pendingFullscreen = false; // Full screen pressed while still tuning
    let playItemId = null; // what watch() asked Jellyfin to play
    let tuneHref = ''; // the address when watch() started tuning
    let backAction = null; // { fn, at, seen }: what Back from full screen reopens (the TV guide)

    const listeners = new Set();
    const emit = () => listeners.forEach((fn) => {
        try { fn(); } catch (err) { console.error('[HOMER Player]', err); }
    });

    // The page HOMER screens should show: the docked screen, the screen being
    // landed on after a video ends, or the real address.
    const route = () => (docked ? stack[stack.length - 1] : landing) || location.hash || HOME;

    // ---------- Trail: the HOMER pages you went through, for Back ----------

    let trail = [];
    const recordTrail = (h) => {
        if (isVideoRoute() || docked) return;
        if (trail.length > 1 && trail[trail.length - 2] === h) trail.pop();
        else if (trail[trail.length - 1] !== h) trail.push(h);
        if (trail.length > 30) trail = trail.slice(-30);
    };
    const backStack = () => {
        if (lastStack && lastStack.length) return lastStack.slice();
        const s = trail.filter(isHomerHash).slice(-12);
        if (!s.length || !isHomeHash(s[0])) s.unshift(HOME);
        return s;
    };
    // Back from full screen: into the screen it came from, and a guide it was
    // tuned from back up on top of that screen
    const dockBack = () => {
        const then = backAction && backAction.fn;
        backAction = null;
        if (!dock(backStack())) return false;
        if (then) {
            try { then(); } catch (err) { console.error('[HOMER Player]', err); }
        }
        return true;
    };
    const setBackAction = (fn) => {
        backAction = typeof fn === 'function' ? { fn, at: Date.now(), seen: isVideoRoute() } : null;
    };

    // ---------- Pinning the real video over a preview window ----------

    const PINNED = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'z-index',
        'border-radius', 'overflow', 'pointer-events', 'transition'];
    const EASE = 'left 300ms cubic-bezier(.2,.8,.2,1), top 300ms cubic-bezier(.2,.8,.2,1), width 300ms cubic-bezier(.2,.8,.2,1), height 300ms cubic-bezier(.2,.8,.2,1), border-radius 300ms ease';
    let lastRect = '';

    const dockTarget = () => {
        for (const sel of ['#hm-root .hm-preview', '#hl-root .hl-preview', '.homer-screen [data-homer-preview]', '#cg-root [data-homer-preview]']) {
            const t = document.querySelector(sel);
            if (!t) continue;
            const root = t.closest('#hm-root, #hl-root, .homer-screen, #cg-root');
            if (root && getComputedStyle(root).visibility === 'hidden') continue;
            const r = t.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return t;
        }
        return null;
    };
    const setBox = (box, r, radius, animate) => {
        const set = (k, v) => box.style.setProperty(k, v, 'important');
        set('transition', animate ? EASE : 'none');
        set('left', r.left + 'px');
        set('top', r.top + 'px');
        set('width', r.width + 'px');
        set('height', r.height + 'px');
        set('border-radius', radius + 'px');
    };
    const pinStatic = (box) => {
        const set = (k, v) => box.style.setProperty(k, v, 'important');
        box.classList.add('homer-pinned');
        set('position', 'fixed');
        set('right', 'auto');
        set('bottom', 'auto');
        set('z-index', '99995'); // above HOMER screens (99990), below the guide (99999)
        set('overflow', 'hidden');
        set('pointer-events', 'none'); // clicks land on the preview window underneath
    };
    const fullRect = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    // pin at full size right away, so Back can shrink it from there
    const pinFull = () => {
        const box = playerBox();
        if (!box) return;
        pinStatic(box);
        setBox(box, fullRect(), 0, false);
        lastRect = 'full';
    };
    const pin = () => {
        const box = playerBox();
        const target = dockTarget();
        if (!box || !target) return;
        // iPhones play inline only when the video says so (Jellyfin's does;
        // this is in case that ever changes)
        const v = box.querySelector('video');
        if (v && !v.playsInline) {
            v.playsInline = true;
            v.setAttribute('webkit-playsinline', '');
        }
        const r = target.getBoundingClientRect();
        const scale = target.offsetHeight ? r.height / target.offsetHeight : 1;
        const radius = (parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0) * scale;
        const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
        if (!box.classList.contains('homer-pinned')) {
            pinStatic(box);
            setBox(box, r, radius, false);
        } else if (key !== lastRect) {
            if (lastRect === 'full') void box.offsetWidth; // start the shrink from full size
            setBox(box, r, radius, true); // glide between screens (and shrink from full screen)
        }
        lastRect = key;
    };
    const clearPin = (box) => {
        if (!box) return;
        box.classList.remove('homer-pinned');
        PINNED.forEach((k) => box.style.removeProperty(k));
        lastRect = '';
    };
    const unpin = (animate) => {
        const box = playerBox();
        if (!box || !box.classList.contains('homer-pinned')) return;
        if (!animate) { clearPin(box); return; }
        setBox(box, fullRect(), 0, true);
        setTimeout(() => { if (!docked) clearPin(box); }, 320);
    };

    // ---------- Now playing ----------

    let resolving = false;
    let lastResolve = 0;
    const resolveNowPlaying = async () => {
        const server = getServer();
        const ac = window.ApiClient;
        const deviceId = ac && ac.deviceId && ac.deviceId();
        if (!server || !deviceId || resolving) return;
        resolving = true;
        lastResolve = Date.now();
        try {
            const sessions = await api(`/Sessions?DeviceId=${encodeURIComponent(deviceId)}`);
            const s = (sessions || []).find((x) => x.DeviceId === deviceId && x.NowPlayingItem);
            const it = s && s.NowPlayingItem;
            if (!it || !docked) return;
            if (it.Type === 'TvChannel') {
                const r = await api(`/LiveTv/Programs?UserId=${server.UserId}&ChannelIds=${it.Id}&IsAiring=true&Limit=1&EnableImages=true&ImageTypeLimit=1&Fields=ChannelInfo,Overview`).catch(() => null);
                const p = r && r.Items && r.Items.find((x) => !PLACEHOLDER.test(x.Name || ''));
                nowPlaying = { program: p || { Name: it.Name, ChannelId: it.Id, ChannelName: it.Name, ChannelNumber: it.Number || it.ChannelNumber || '' } };
            } else {
                const full = await api(`/Users/${server.UserId}/Items/${it.Id}`).catch(() => null);
                nowPlaying = { item: full || it };
            }
            if (docked) emit();
        } catch (err) {
            console.warn('[HOMER Player]', err);
        } finally {
            resolving = false;
        }
    };

    // ---------- Cancelling a channel that's still tuning ----------
    // Jellyfin ignores Stop until playback has started, so a channel you left
    // before it started is hidden and muted when it arrives, checked against
    // this browser's session (so nothing else you start gets caught), and stopped.

    let cancelId = null;
    let cancelUntil = 0;
    let confirmed = false;
    let checking = false;
    let lastCheck = 0;
    let stopSentAt = 0;
    let backedOut = false;
    const sessionNowPlayingId = async () => {
        const ac = window.ApiClient;
        const deviceId = ac && ac.deviceId && ac.deviceId();
        if (!deviceId) return null;
        const sessions = await api(`/Sessions?DeviceId=${encodeURIComponent(deviceId)}`);
        const sess = (sessions || []).find((x) => x.DeviceId === deviceId && x.NowPlayingItem);
        return sess ? sess.NowPlayingItem.Id : null;
    };
    const finishCancel = () => {
        cancelUntil = 0;
        const v = document.querySelector('.videoPlayerContainer video');
        if (v && !confirmed) v.muted = false; // it was something else; hand it back
        setTimeout(() => document.documentElement.classList.remove('homer-cancelling'), 300);
    };
    const cancelTuning = (itemId) => {
        if (!itemId) return;
        cancelId = itemId;
        cancelUntil = Date.now() + 60000;
        confirmed = false;
        stopSentAt = 0;
        backedOut = false;
        document.documentElement.classList.add('homer-cancelling');
    };
    const checkCancel = () => {
        if (!cancelUntil) return;
        const now = Date.now();
        const box = playerBox();
        const v = box && box.querySelector('video');
        if (now > cancelUntil || (confirmed && stopSentAt && !box && !isVideoRoute())) { finishCancel(); return; }
        if (v) v.muted = true;
        const started = isVideoRoute() || (v && !v.paused && v.currentTime > 0);
        if (!started) return;
        if (!confirmed) {
            if (checking || now - lastCheck < 1000) return;
            checking = true;
            lastCheck = now;
            sessionNowPlayingId()
                .then((id) => {
                    if (!cancelUntil || !id) return;
                    if (id === cancelId) confirmed = true;
                    else finishCancel();
                })
                .catch(() => {})
                .finally(() => { checking = false; });
            return;
        }
        // keep asking until Jellyfin has actually taken the player down
        if (now - stopSentAt > 1000) { stopSentAt = now; stopPlayback(); }
        if (isVideoRoute() && !backedOut && now - stopSentAt > 800) { backedOut = true; history.back(); }
    };

    // ---------- Docking ----------

    const closeGuide = () => {
        if (document.getElementById('cg-root') && window.ChannelGuide && window.ChannelGuide.close) {
            window.ChannelGuide.close({ returnToLiveTv: false });
        }
    };

    // from Jellyfin's full-screen player into a HOMER screen, video in its preview
    const dock = (screens) => {
        if (!getServer() || !playerBox() || !isVideoRoute()) return false;
        stack = screens.length ? screens : [HOME];
        if (!isGuideHash(stack[stack.length - 1])) closeGuide(); // (the phone guide is a screen)
        docked = true;
        landing = null;
        sawPlayer = true;
        pendingFullscreen = false;
        dockedSince = Date.now();
        nowPlaying = null;
        pinFull();
        emit();
        resolveNowPlaying();
        return true;
    };

    // the video ended or was stopped somewhere we didn't ask: stay on the screen
    // you're looking at, for real this time
    const endDock = () => {
        backAction = null;
        if (!docked) return;
        const top = stack[stack.length - 1];
        docked = false;
        stack = [];
        lastStack = null;
        pendingFullscreen = false;
        nowPlaying = null;
        unpin(false);
        land(top);
        emit();
    };
    const land = (hash) => {
        if (!hash || location.hash === hash) { landing = null; return; }
        landing = hash;
        landingSince = Date.now();
        if (!isVideoRoute()) location.hash = hash;
    };

    // Home's Watch: play in the preview window of the screen you're on
    const watch = (itemId, info) => {
        if (!getServer()) return;
        backAction = null;
        if (!docked) {
            stack = [isHomerHash(location.hash) ? location.hash : HOME];
            docked = true;
            sawPlayer = isVideoRoute();
            tuneHref = location.href;
        }
        landing = null;
        nowPlaying = info || null;
        playItemId = itemId;
        pendingFullscreen = false;
        dockedSince = Date.now();
        playNow(itemId);
        emit();
        if (!nowPlaying) resolveNowPlaying();
    };

    const fullscreen = () => {
        if (!docked) return;
        if (!isVideoRoute()) { pendingFullscreen = true; return; } // still tuning
        backAction = null; // Back returns to the screen it was docked in
        lastStack = stack.slice();
        docked = false;
        stack = [];
        pendingFullscreen = false;
        unpin(true);
        emit();
    };

    const stop = () => {
        const top = route();
        const wasDocked = docked;
        backAction = null;
        docked = false;
        stack = [];
        lastStack = null;
        nowPlaying = null;
        pendingFullscreen = false;
        unpin(false);
        if (wasDocked && !sawPlayer) cancelTuning(playItemId);
        else dropMark(stopPlayback); // Jellyfin then leaves its player page by itself
        if (isHomerHash(top)) land(top);
        emit();
    };

    // Go to a Jellyfin page while docked: leaving the player stops the video
    // (Jellyfin does that itself; a channel that's still tuning needs cancelling)
    const leave = (hash) => {
        backAction = null;
        if (!docked) { location.hash = hash; return; }
        if (!sawPlayer) cancelTuning(playItemId);
        docked = false;
        stack = [];
        lastStack = null;
        nowPlaying = null;
        unpin(false);
        landing = null;
        dropMark(() => { location.hash = hash; });
        emit();
    };

    // Move to a HOMER screen: virtually while docked, for real otherwise (and
    // from the full-screen player, into that screen with the video docked)
    const go = (hash) => {
        if (!docked && isVideoRoute() && playerBox() && isHomerHash(hash) && !isHomeHash(hash)) {
            dock([HOME, hash]);
            return;
        }
        if (!docked) { location.hash = hash; return; }
        if (!isHomerHash(hash)) { leave(hash); return; }
        if (stack[stack.length - 1] === hash) return;
        stack.push(hash);
        emit();
    };
    // Back while docked: the previous HOMER screen (Home is the bottom)
    const back = () => {
        if (!docked) { history.back(); return; }
        if (stack.length > 1) stack.pop();
        else if (!isHomeHash(stack[0])) stack = [HOME];
        else return;
        emit();
    };
    const goHome = () => {
        if (!getServer()) return;
        if (docked) {
            closeGuide();
            if (stack.length === 1 && isHomeHash(stack[0])) return;
            stack = [HOME];
            emit();
            return;
        }
        if (isVideoRoute() && playerBox()) { backAction = null; dock([HOME]); return; }
        closeGuide();
        if (isHomeHash(location.hash)) {
            if (window.HomerHome && window.HomerHome.open) window.HomerHome.open();
        } else location.hash = HOME;
    };

    // ---------- The browser's Back while docked ----------
    // While a video is docked the address stays on Jellyfin's player page, so
    // the browser's own Back (a phone's back button or swipe, Cmd+[) would leave
    // that page and stop the video. So HOMER keeps one history entry of its own
    // on top of the player page, at the same address. Back takes it away, and
    // HOMER goes back a screen instead (from Home, where there's nowhere to go
    // back to, it stops the video), then puts its entry back. Jellyfin's router
    // sees the address it already had and does nothing. From full screen, Back
    // docks the video into the screen it came from, like Esc.
    //
    // Jellyfin leaving the player page by itself (when a video ends) goes back
    // through HOMER's entry first; with nothing playing any more, HOMER passes
    // that Back on. HOMER's own Stop and leave() take the entry away first.

    const MARK = 'homerDock';
    let marked = false; // HOMER's entry is the current one
    let dropping = null; // taking the entry away ourselves: what to do then
    let dropTimer = 0;
    const isMark = (st) => !!(st && st[MARK]);
    const pushMark = () => {
        if (marked || dropping || !isVideoRoute()) return;
        try {
            history.pushState(Object.assign({}, history.state, { [MARK]: true }), '', location.href);
            marked = true;
        } catch { /* no history API here: Back just stops the video, as before */ }
    };
    const dropMark = (then) => {
        if (!marked || !isMark(history.state)) {
            marked = false;
            then();
            return;
        }
        dropping = then;
        history.back();
        // in case the popstate never comes
        clearTimeout(dropTimer);
        dropTimer = setTimeout(() => {
            if (dropping !== then) return;
            dropping = null;
            then();
        }, 800);
    };
    const playing = () => {
        const v = document.querySelector('.videoPlayerContainer video');
        return !!(v && (v.currentSrc || v.getAttribute('src')) && !v.ended);
    };
    const canGoBack = () => stack.length > 1 || !isHomeHash(stack[0]);
    const onPopState = () => {
        const was = marked;
        marked = isMark(history.state);
        if (dropping) {
            const then = dropping;
            dropping = null;
            clearTimeout(dropTimer);
            then();
            return;
        }
        if (!was || marked || !isVideoRoute()) return; // not our entry
        if (!playing()) {
            history.back(); // Jellyfin's own way out of the player page: pass it on
            return;
        }
        if (docked) {
            if (canGoBack()) back();
            else stop();
        } else if (playerBox() && !overlayOpen()) {
            dockBack();
        }
    };

    // ---------- A pocketed phone lets go of the tuner ----------
    // The provider allows two streams at a time, so on a phone or tablet live
    // TV stops once the page has been hidden (switched away from, or the phone
    // locked) for a few minutes. A recording or a library video just stays
    // paused. A phone that slept through the timer is checked when it wakes.

    const LIVE_IDLE_MS = 3 * 60000;
    let hiddenAt = 0;
    let idleTimer = 0;
    const touchDevice = () => !!(window.HomerLayout && (window.HomerLayout.isPhone() || window.HomerLayout.isTouch()));
    const watchingLive = async () => {
        if (nowPlaying && nowPlaying.program) return true;
        if (nowPlaying && nowPlaying.item) return false;
        const server = getServer();
        const ac = window.ApiClient;
        const deviceId = ac && ac.deviceId && ac.deviceId();
        if (!server || !deviceId) return false;
        const sessions = await api(`/Sessions?DeviceId=${encodeURIComponent(deviceId)}`);
        const s = (sessions || []).find((x) => x.DeviceId === deviceId && x.NowPlayingItem);
        return !!(s && s.NowPlayingItem.Type === 'TvChannel');
    };
    const stopIdleLive = async () => {
        if (!hiddenAt || Date.now() - hiddenAt < LIVE_IDLE_MS) return;
        if (!playerBox() || !(docked || isVideoRoute())) return;
        if (!(await watchingLive().catch(() => false))) return;
        console.info('[HOMER Player] Live TV stopped: hidden for', Math.round((Date.now() - hiddenAt) / 60000), 'min');
        if (docked) stop();
        else stopPlayback();
    };
    const onVisibility = () => {
        clearTimeout(idleTimer);
        if (document.hidden) {
            if (!touchDevice()) return;
            hiddenAt = Date.now();
            idleTimer = setTimeout(stopIdleLive, LIVE_IDLE_MS + 1000);
        } else if (hiddenAt) {
            stopIdleLive().finally(() => { hiddenAt = 0; });
        }
    };

    // ---------- Watching the address and the player ----------

    let lastHref = location.href;
    let wasVideo = isVideoRoute();
    // ---------- No stock Jellyfin pages ----------
    // Any page HOMER doesn't draw (and isn't the dashboard, sign-in or the player)
    // goes to Home, and Jellyfin's own pages stay hidden underneath HOMER, so a
    // stock page never flashes up.
    const guard = () => {
        const h = location.hash || HOME;
        const ok = !getServer() || isStockOk(h) || (!!screenFor(h) && !window[screenFor(h)]); // not built yet: Jellyfin's
        document.documentElement.classList.toggle('homer-stock-ok', ok);
        if (ok || docked || landing) return;
        if (isHomerHash(h) || isGuideHash(h)) return;
        location.replace('#/home');
    };

    const tick = () => {
        checkCancel();
        const href = location.href;
        const video = isVideoRoute();
        if (backAction) {
            if (video) backAction.seen = true;
            else if (backAction.seen || Date.now() - backAction.at > 60000) backAction = null; // over, or never started
        }
        if (href !== lastHref) {
            lastHref = href;
            recordTrail(location.hash || HOME);
            guard();
            if (landing && !video) {
                if (location.hash === landing) landing = null;
                else location.hash = landing;
                emit();
            }
        }
        if (landing && Date.now() - landingSince > 5000) {
            // the player page never left by itself
            if (video) location.hash = landing;
            else landing = null;
            landingSince = Date.now();
        }
        if (docked) {
            if (video) sawPlayer = true;
            if (pendingFullscreen && video) fullscreen();
            else if (sawPlayer && !video) endDock(); // ended, or Jellyfin left its player
            else if (!sawPlayer && href !== tuneHref && !video) { cancelTuning(playItemId); endDock(); } // left while tuning
            else if (!sawPlayer && Date.now() - dockedSince > 45000) { cancelTuning(playItemId); endDock(); } // never started
            else {
                if (playerBox()) pin();
                if (sawPlayer && video) pushMark(); // Back goes back a screen, not out of the player
                const p = nowPlaying && nowPlaying.program;
                if (p && p.EndDate && Date.parse(p.EndDate) < Date.now() && Date.now() - lastResolve > 20000) resolveNowPlaying();
            }
        } else if (wasVideo && !video && lastStack) {
            // a full-screen video ended: back to the screen it was docked on
            const top = lastStack[lastStack.length - 1];
            lastStack = null;
            land(top);
        }
        wasVideo = video;
    };
    const timer = setInterval(tick, 100);

    // ---------- Input ----------

    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const dialogOpen = () => !!document.querySelector('.dialogContainer .dialog, .actionSheet');
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

    // capture phase, registered before any screen's: H, F, and Back from full screen
    const onKeyCapture = (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey || !getServer()) return;
        const typing = isTyping(ev.target) || isTyping(document.activeElement);
        const k = ev.key;
        if ((k === 'h' || k === 'H') && !typing && !ev.repeat) {
            const home = document.getElementById('hm-root');
            if (home && !document.getElementById('cg-root') && isHomeHash(route())) return; // already Home
            ev.preventDefault();
            ev.stopImmediatePropagation();
            goHome();
            return;
        }
        if ((k === 'f' || k === 'F') && docked && !typing && !ev.repeat && !document.getElementById('cg-root')) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            fullscreen();
            return;
        }
        // Back from Jellyfin's full-screen player: shrink into the screen you came from
        if (BACK_KEYS.includes(k) && !docked && isVideoRoute() && !overlayOpen() && !typing && !dialogOpen() && playerBox()) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            dockBack();
        }
    };
    // bubble phase, registered before Jellyfin's player page adds its own: while
    // HOMER is on top of the player, the player's shortcuts (space pauses, arrows
    // seek, scroll changes the volume, Esc leaves and stops) stay out of it
    const overPlayer = () => isVideoRoute() && overlayOpen();
    const onKeyBubble = (ev) => {
        if (!overPlayer()) return;
        ev.stopImmediatePropagation();
        if ((ev.key === ' ' || BACK_KEYS.includes(ev.key)) && !isTyping(ev.target)) ev.preventDefault();
    };
    const onKeyUpBubble = (ev) => {
        if (!overPlayer() || isTyping(ev.target)) return;
        ev.stopImmediatePropagation();
        if (ev.key === ' ' || ev.key === 'Enter') ev.preventDefault();
    };
    // The trackpad never changes the volume: Jellyfin's player page turns every
    // scroll into volumeUp/volumeDown. Its document listener is added on each
    // viewshow, after this one, so stopping here keeps it from ever running.
    // (HOMER screens' own wheel handlers sit on their roots or the window.)
    const onWheelBubble = (ev) => {
        if (isVideoRoute()) ev.stopImmediatePropagation();
    };
    // the player's ← button, and a click on the docked video
    const onClickCapture = (ev) => {
        if (!getServer()) return;
        if (!docked && isVideoRoute() && !overlayOpen() && ev.target.closest && ev.target.closest('.headerBackButton') && playerBox()) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            dockBack();
            return;
        }
        if (docked && !document.getElementById('cg-root')) {
            const t = dockTarget();
            if (t && t.contains(ev.target)) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                fullscreen();
            }
        }
    };
    // a pointerdown on the ← button would also reach Jellyfin's page handler
    const onPointerCapture = (ev) => {
        if (!docked && isVideoRoute() && ev.target.closest && ev.target.closest('.headerBackButton')) ev.stopImmediatePropagation();
    };

    document.addEventListener('keydown', onKeyCapture, true);
    document.addEventListener('keydown', onKeyBubble, false);
    document.addEventListener('keyup', onKeyUpBubble, false);
    document.addEventListener('wheel', onWheelBubble, { passive: true });
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('pointerdown', onPointerCapture, true);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('visibilitychange', onVisibility);

    // ---------- A Home button in the player's control bar ----------

    const OSD_BTN_CLASS = 'hmOsdHomeButton';
    const syncOsdButton = () => {
        const bar = document.querySelector('.videoOsdBottom .buttons');
        if (!bar || bar.querySelector('.' + OSD_BTN_CLASS) || !getServer()) return;
        let btn;
        try {
            btn = document.createElement('button', { is: 'paper-icon-button-light' });
        } catch {
            btn = document.createElement('button');
        }
        btn.type = 'button';
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.className = `autoSize paper-icon-button-light ${OSD_BTN_CLASS}`;
        btn.title = 'Home (H)';
        btn.setAttribute('aria-label', 'Home');
        btn.innerHTML = '<span class="xlargePaperIconButton material-icons home" aria-hidden="true"></span>';
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            goHome();
        });
        const before = bar.querySelector('.cgOsdGuideButton, .btnPip, .btnVideoOsdSettings, .btnFullscreen');
        bar.insertBefore(btn, before || null);
    };
    const osdTimer = setInterval(syncOsdButton, 500);

    // ---------- Styles ----------

    const style = document.createElement('style');
    style.id = 'homer-player-css';
    style.textContent = `
        .videoPlayerContainer.homer-pinned {
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(160, 200, 255, 0.22);
        }
        .videoPlayerContainer.homer-pinned .htmlvideoplayer { object-fit: cover !important; }
        .videoPlayerContainer.homer-pinned .videoSubtitles { display: none !important; }
        .homer-cancelling .videoPlayerContainer,
        .homer-cancelling #videoOsdPage { visibility: hidden !important; }
        html:not(.homer-stock-ok) .mainAnimatedPages,
        html:not(.homer-stock-ok) .skinHeader,
        html:not(.homer-stock-ok) .mainDrawer,
        html:not(.homer-stock-ok) .mainDrawerHandle { visibility: hidden !important; }
    `;
    document.head.appendChild(style);

    recordTrail(location.hash || HOME);
    guard();

    window.HomerPlayer = {
        version: VERSION,
        route,
        docked: () => docked,
        nowPlaying: () => nowPlaying,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        go,
        leave,
        back,
        goHome,
        watch,
        fullscreen,
        stop,
        setBackAction,
        isHomerHash,
        isStockOk,
        isHomeHash,
        destroy() {
            clearInterval(timer);
            clearInterval(osdTimer);
            document.removeEventListener('keydown', onKeyCapture, true);
            document.removeEventListener('keydown', onKeyBubble, false);
            document.removeEventListener('keyup', onKeyUpBubble, false);
            document.removeEventListener('wheel', onWheelBubble, { passive: true });
            document.removeEventListener('click', onClickCapture, true);
            document.removeEventListener('pointerdown', onPointerCapture, true);
            window.removeEventListener('popstate', onPopState);
            document.removeEventListener('visibilitychange', onVisibility);
            clearTimeout(idleTimer);
            clearTimeout(dropTimer);
            backAction = null;
            document.querySelectorAll('.' + OSD_BTN_CLASS).forEach((b) => b.remove());
            clearPin(playerBox());
            style.remove();
            listeners.clear();
        }
    };
})();
