/*
 * HOMER Now Playing: everything playing anywhere in the house, on one screen,
 * with the controls for it.
 *
 * HOMER's own page at #/playing (the menu's Now Playing item goes there;
 * Jellyfin has nothing at that address). playing/playing-model.js gathers the
 * three places something can be playing — Jellyfin's sessions, Home
 * Assistant's players, and HOMER's own music in this tab — and this draws
 * them.
 *
 * No video: artwork only. A card is the cover, what's on (the show and the
 * episode, the film, the track), where it's playing and for whom, a progress
 * bar that keeps moving between samples, and the controls that player
 * actually takes: ⏮ ⏯ ⏹ ⏭, mute and volume. Speakers playing together show
 * as one card naming the rooms. An Apple TV or a Samsung TV also offers
 * Remote, which opens the remote Rooms already draws (#/rooms?remote=…).
 *
 * Active things are big, one card each, most recently started first. Players
 * that are on but idle collapse into a quiet line at the bottom ("Ready:
 * Kitchen, Office…") instead of competing with them.
 *
 * The main menu (shared/menu.js) runs down the left, so this screen is also
 * the way into every other one.
 *
 * Remote/keyboard: ▲▼◀▶ move, OK runs the button, ◀▶ on a volume pill sets
 * the volume, Esc/Backspace goes back, H goes Home.
 *
 * On a phone (shared/layout.js) this draws playing/playing-phone.js instead:
 * the same cards in one column.
 *
 * window.HomerPlaying = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerPlaying && typeof window.HomerPlaying.destroy === 'function') {
        window.HomerPlaying.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="playing.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/playing\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'playing/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const TICK_MS = 250; // the progress bars, between samples
    const VOL_STEP = 5;

    // ---------- Jellyfin session (only to know someone is signed in) ----------

    const getServer = () => {
        try {
            const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            const server = (creds.Servers || [])[0];
            return server && server.AccessToken && server.UserId ? server : null;
        } catch {
            return null;
        }
    };

    // ---------- HomerPlayer (optional) ----------

    const HP = () => window.HomerPlayer || null;
    const Model = () => window.HomerPlayingModel || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Playing]', err); return fallback; }
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

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    // 3:07, or 1:02:14
    const clock = (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = s % 60;
        return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
    };
    // where a card is now: the last reading, carried forward while it plays
    const positionNow = (c) => (c.state === 'playing' ? (c.position || 0) + (Date.now() - c.at) / 1000 : c.position || 0);
    const rooms = (c) => (c.rooms && c.rooms.length ? c.rooms.join(' + ') : '');

    const STATE_TEXT = { playing: 'Playing', paused: 'Paused', buffering: 'Loading', on: 'On' };
    const SOURCE_TEXT = { jellyfin: 'Jellyfin', ha: 'Home Assistant', homer: 'HOMER', ambience: 'HOMER' };

    // the buttons a card offers, in the order a remote walks them
    const BUTTONS = [
        { k: 'prev', can: 'canPrev', icon: 'skip_previous', label: 'Previous' },
        { k: 'play', can: 'canPlay', icon: 'play_arrow', label: 'Play' },
        { k: 'stop', can: 'canStop', icon: 'stop', label: 'Stop' },
        { k: 'next', can: 'canNext', icon: 'skip_next', label: 'Next' },
        { k: 'mute', can: 'canMute', icon: 'volume_up', label: 'Mute' }
    ];
    const btnIcon = (c, k) => (k === 'play' ? (c.state === 'playing' ? 'pause' : 'play_arrow') : k === 'mute' ? (c.muted ? 'volume_off' : 'volume_up') : BUTTONS.find((b) => b.k === k).icon);
    const btnLabel = (c, k) => (k === 'play' ? (c.state === 'playing' ? 'Pause' : 'Play') : k === 'mute' ? (c.muted ? 'Unmute' : 'Mute') : BUTTONS.find((b) => b.k === k).label);

    // ---------- The stylesheet ----------

    let cssReady = null;
    const ensureCss = () => {
        if (cssReady && document.getElementById('hn-css')) return cssReady;
        const link = (id, file, base) => {
            document.getElementById(id)?.remove();
            const css = document.createElement('link');
            css.id = id;
            css.rel = 'stylesheet';
            css.href = (base || BASE) + file + QUERY;
            document.head.appendChild(css);
            return new Promise((resolve) => {
                css.onload = css.onerror = resolve;
                setTimeout(resolve, 2000);
            });
        };
        cssReady = Promise.all([link('hn-css', 'playing.css'), link('hn-phone-css', 'playing-phone.css')]);
        return cssReady;
    };

    // ---------- The screen ----------

    const createScreen = () => {
        const root = el('div', 'homer-screen');
        root.id = 'hn-root';
        root.style.visibility = 'hidden'; // until playing.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hn-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hn-topbar">
                <div class="hn-brand homer-home" role="button" title="Home (H)"><span class="hn-brand-mark">${icon('home')}</span>HOMER<span class="hn-brand-sub">Now Playing</span></div>
                <div class="hn-clock"><div class="hn-clock-time"></div><div class="hn-clock-date"></div></div>
            </div>
            <div class="hn-menu-col"></div>
            <div class="hn-body">
                <div class="hn-head">
                    <h1 class="hn-h1">Playing in the house</h1>
                    <div class="hn-count"></div>
                </div>
                <div class="hn-cards"><div class="hn-cards-inner"></div></div>
                <div class="hn-empty" hidden>
                    <span class="material-icons" aria-hidden="true">graphic_eq</span>
                    <b>Nothing is playing</b>
                    <span>Start something on a TV, a speaker or in HOMER and it shows up here.</span>
                </div>
            </div>
            <div class="hn-idle" hidden></div>
            <div class="hn-legend"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);
        const cardsBox = $('.hn-cards');
        const inner = $('.hn-cards-inner');

        // always 1080 tall and as wide as the window allows (min 1600), like
        // every HOMER screen
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
            $('.hn-clock-time').textContent = fmtTime(d);
            $('.hn-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? window.HomerWeather.attach($('.hn-clock')) : () => {};

        // ---------- The menu down the left (shared/menu.js) ----------

        let menu = null;
        const buildMenu = () => {
            if (!window.HomerMenu) return;
            if (menu) menu.destroy();
            menu = window.HomerMenu.build($('.hn-menu-col'), {
                go,
                current: 'playing',
                onRedraw: (node) => setFocus(node || firstFocusable())
            });
            stage.classList.toggle('hn-rail', menu.style === 'rail');
            stage.classList.toggle('hn-rows', menu.style !== 'rail');
        };
        buildMenu();
        const offMenuStyle = window.HomerMenu ? window.HomerMenu.onChange(() => { buildMenu(); paint(true); }) : () => {};

        // ---------- Focus (spatial, like a remote) ----------

        let focused = null;
        const focusables = () => [...stage.querySelectorAll('.hn-focusable, .hm-menu-item')].filter((n) => n.offsetParent !== null);
        const firstFocusable = () => {
            const cardBtn = stage.querySelector('.hn-btn');
            return cardBtn || (menu && menu.first()) || focusables()[0] || null;
        };
        const inMenu = (n) => !!(n && n.classList.contains('hm-menu-item'));
        const setFocus = (node) => {
            if (!node || node === focused) return;
            if (focused) focused.classList.remove('hm-focus', 'hn-focus');
            focused = node;
            node.classList.add(inMenu(node) ? 'hm-focus' : 'hn-focus');
            if (inMenu(node)) { if (menu) menu.reveal(node); }
            else revealCard(node);
        };
        const rect = (n) => n.getBoundingClientRect();
        const move = (dir) => {
            const all = focusables();
            if (!focused || !all.includes(focused)) { setFocus(firstFocusable()); return; }
            // the menu is a column: ▲▼ walk it, and only leave it sideways
            if (inMenu(focused) && (dir === 'up' || dir === 'down')) {
                const next = menu && menu.move(dir, focused);
                if (next) setFocus(next);
                return;
            }
            const a = rect(focused);
            const ax = a.left + a.width / 2;
            const ay = a.top + a.height / 2;
            let best = null;
            let bestScore = Infinity;
            for (const n of all) {
                if (n === focused) continue;
                // ▲▼ from a card never drops into the middle of the menu
                if ((dir === 'up' || dir === 'down') && inMenu(n) && !inMenu(focused)) continue;
                const b = rect(n);
                const bx = b.left + b.width / 2;
                const by = b.top + b.height / 2;
                const dx = bx - ax;
                const dy = by - ay;
                const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
                if (!ok) continue;
                const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
                const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
                if (primary < 2) continue;
                const score = primary + cross * 2.5;
                if (score < bestScore) { bestScore = score; best = n; }
            }
            if (best) setFocus(best);
        };

        // ---------- The cards ----------

        let scrollY = 0;
        const setScrollY = (y, animate) => {
            const max = Math.max(0, inner.scrollHeight - cardsBox.clientHeight);
            scrollY = Math.max(0, Math.min(max, y));
            inner.style.transition = animate ? 'transform 180ms ease' : 'none';
            inner.style.transform = `translateY(${-scrollY}px)`;
            cardsBox.classList.toggle('hn-more', scrollY < max - 1);
        };
        const revealCard = (node) => {
            const card = node && node.closest ? node.closest('.hn-card') : null;
            if (!card) return;
            const top = card.offsetTop;
            const bottom = top + card.offsetHeight;
            if (top - 8 < scrollY) setScrollY(top - 8, true);
            else if (bottom + 8 > scrollY + cardsBox.clientHeight) setScrollY(bottom + 8 - cardsBox.clientHeight, true);
        };

        const cardNodes = new Map(); // key -> element
        let list = []; // the cards, as the model last gave them
        let byKey = new Map();

        const cardHtml = (c) => `
            <div class="hn-art hn-art-${esc(c.shape || 'poster')}">
                <div class="hn-art-img"></div>
                <div class="hn-art-none">${icon(c.icon || 'movie')}</div>
            </div>
            <div class="hn-text">
                <div class="hn-tags"></div>
                <div class="hn-title"></div>
                <div class="hn-sub"></div>
                <div class="hn-where"></div>
                <div class="hn-bar"><b></b><span class="hn-bar-live">LIVE</span></div>
                <div class="hn-times"><span class="hn-at"></span><span class="hn-of"></span></div>
                <div class="hn-ctl"></div>
            </div>`;

        const makeCard = (c) => {
            const node = el('div', 'hn-card', cardHtml(c));
            node.dataset.key = c.key;
            return node;
        };

        // a card's buttons: the ones that player takes, then its volume, then
        // Remote for an Apple TV or a Samsung TV
        const paintControls = (node, c) => {
            const box = node.querySelector('.hn-ctl');
            // Remote first (it's the one an Apple TV is for, as in Rooms), then
            // the transport, then the volume pill last, where ▶ can run off it
            const want = (c.remote ? ['remote'] : [])
                .concat(BUTTONS.filter((b) => c[b.can]).map((b) => b.k), c.canVolume || c.canStep ? ['volume'] : []);
            const sig = want.join(',');
            if (box.dataset.sig !== sig) {
                box.dataset.sig = sig;
                box.innerHTML = want.map((k) => {
                    if (k === 'volume') {
                        return `<div class="hn-btn hn-vol hn-focusable" data-k="volume" role="slider" tabindex="-1" title="Volume (◀ ▶)">`
                            + `${icon('volume_up')}<span class="hn-vol-bar"><b></b></span><span class="hn-vol-n"></span></div>`;
                    }
                    if (k === 'remote') {
                        return `<div class="hn-btn hn-wide hn-focusable" data-k="remote" role="button" title="Remote">${icon('settings_remote')}<span>Remote</span></div>`;
                    }
                    return `<div class="hn-btn hn-focusable" data-k="${k}" role="button">${icon(btnIcon(c, k))}<span class="hn-btn-t"></span></div>`;
                }).join('');
            }
            box.querySelectorAll('.hn-btn').forEach((b) => {
                const k = b.dataset.k;
                if (k === 'volume') {
                    const v = c.volume == null ? 0 : c.volume;
                    // a player that only steps up and down has no level to draw
                    b.classList.toggle('hn-vol-step', c.volume == null);
                    b.querySelector('.material-icons').textContent = c.muted ? 'volume_off' : v === 0 && c.volume != null ? 'volume_mute' : 'volume_up';
                    b.querySelector('.hn-vol-bar b').style.width = Math.max(0, Math.min(100, v)) + '%';
                    b.querySelector('.hn-vol-n').textContent = c.volume == null ? '' : v + '%';
                    b.title = c.volume == null ? 'Volume up and down (◀ ▶)' : 'Volume (◀ ▶)';
                    b.setAttribute('aria-valuenow', String(v));
                    b.classList.toggle('hn-off', !!c.muted);
                } else if (k !== 'remote') {
                    b.querySelector('.material-icons').textContent = btnIcon(c, k);
                    b.querySelector('.hn-btn-t').textContent = btnLabel(c, k);
                    b.title = btnLabel(c, k);
                    b.classList.toggle('hn-on', k === 'play' && c.state === 'playing');
                    b.classList.toggle('hn-off', k === 'mute' && c.muted);
                }
            });
        };

        // A picture is only put in the card once it has actually loaded: a
        // player's artwork is fetched from its own integration and often
        // isn't there (an expired proxy token, a speaker that reports a
        // picture it can't serve, an Apple TV whose covers come back as HEIC),
        // and a background image gives no error, so the card would be a blank
        // rectangle. The model works through what it can try — Home
        // Assistant's proxy, the artwork's own address, then Jellyfin's copy
        // of the same album — and answers with whichever drew. Until then,
        // and if none of them do, the icon.
        const artFor = new Map(); // key -> the picture the card was last given
        const setArt = (node, c) => {
            const box = node.querySelector('.hn-art');
            const img = node.querySelector('.hn-art-img');
            box.className = `hn-art hn-art-${c.shape || 'poster'} hn-art-empty`;
            img.style.backgroundImage = '';
            if (!c.art) return;
            const want = c.art;
            const draw = (url) => {
                if (!url || artFor.get(c.key) !== want || !node.isConnected) return; // moved on
                img.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
                box.classList.remove('hn-art-empty');
            };
            const mod = Model();
            if (mod && mod.artFor) mod.artFor(c).then(draw, () => {});
            else {
                const probe = new Image();
                probe.onload = () => draw(want);
                probe.src = want;
            }
        };
        const paintCard = (node, c) => {
            node.classList.toggle('hn-paused', c.state === 'paused');
            node.classList.toggle('hn-grouped', !!c.grouped);
            if (artFor.get(c.key) !== c.art) {
                artFor.set(c.key, c.art);
                setArt(node, c);
            }
            const tags = [
                `<span class="hn-tag hn-tag-${c.state}">${icon(c.state === 'playing' ? 'play_arrow' : c.state === 'paused' ? 'pause' : 'radio_button_checked')}${esc(STATE_TEXT[c.state] || c.state)}</span>`,
                c.badge ? `<span class="hn-tag hn-tag-kind">${esc(c.badge)}</span>` : '',
                c.grouped ? `<span class="hn-tag hn-tag-group">${icon('speaker_group')}${esc(rooms(c))}</span>` : ''
            ].filter(Boolean).join('');
            const tagBox = node.querySelector('.hn-tags');
            if (tagBox.dataset.sig !== tags) { tagBox.dataset.sig = tags; tagBox.innerHTML = tags; }
            node.querySelector('.hn-title').textContent = c.title || c.where;
            node.querySelector('.hn-sub').textContent = c.sub || '';
            node.querySelector('.hn-sub').hidden = !c.sub;
            const where = [c.grouped ? rooms(c) : c.where, c.room, c.who].filter(Boolean);
            node.querySelector('.hn-where').innerHTML = `${icon(c.kind === 'ha' ? 'home' : c.kind === 'ambience' ? 'cloud' : c.kind === 'homer' ? 'graphic_eq' : 'cast')}`
                + where.map((w, i) => `<span${i ? ' class="hn-dim"' : ''}>${esc(w)}</span>`).join('<i>·</i>')
                + `<span class="hn-src">${esc(SOURCE_TEXT[c.kind] || '')}</span>`;
            paintControls(node, c);
            paintProgress(node, c);
        };

        // the bar and the times: redrawn on their own, between samples
        const paintProgress = (node, c) => {
            const bar = node.querySelector('.hn-bar');
            const at = positionNow(c);
            if (c.live || !c.duration) {
                bar.classList.add('hn-bar-none');
                bar.querySelector('b').style.width = '0%';
                node.querySelector('.hn-at').textContent = c.live ? '' : at > 1 ? clock(at) : '';
                node.querySelector('.hn-of').textContent = c.live ? 'Live' : '';
            } else {
                bar.classList.remove('hn-bar-none');
                bar.querySelector('b').style.width = Math.max(0, Math.min(100, (at / c.duration) * 100)) + '%';
                node.querySelector('.hn-at').textContent = clock(at);
                node.querySelector('.hn-of').textContent = '−' + clock(Math.max(0, c.duration - at));
            }
            bar.classList.toggle('hn-bar-is-live', !!c.live);
        };

        const tickProgress = () => {
            for (const c of list) {
                const node = cardNodes.get(c.key);
                if (node && c.state === 'playing') paintProgress(node, c);
            }
        };
        const progressTimer = setInterval(tickProgress, TICK_MS);

        // ---------- Painting the screen ----------

        const paint = (force) => {
            const m = Model();
            list = m ? m.cards() : [];
            byKey = new Map(list.map((c) => [c.key, c]));
            const sig = list.map((c) => c.key).join('|');
            if (force || inner.dataset.sig !== sig) {
                inner.dataset.sig = sig;
                const focusKey = focused && !inMenu(focused) && focused.closest('.hn-card') ? focused.closest('.hn-card').dataset.key : '';
                const focusBtn = focused && focused.dataset ? focused.dataset.k : '';
                inner.innerHTML = '';
                cardNodes.clear();
                for (const c of list) {
                    const node = makeCard(c);
                    cardNodes.set(c.key, node);
                    inner.appendChild(node);
                }
                // keep the focus where it was, if that card is still there
                if (focused && !inMenu(focused)) {
                    const back = focusKey && cardNodes.get(focusKey);
                    const btn = back && (back.querySelector(`.hn-btn[data-k="${focusBtn}"]`) || back.querySelector('.hn-btn'));
                    focused = null;
                    setFocus(btn || firstFocusable());
                }
            }
            for (const c of list) {
                const node = cardNodes.get(c.key);
                if (node) paintCard(node, c);
            }
            $('.hn-empty').hidden = list.length > 0;
            cardsBox.hidden = list.length === 0;
            const n = list.length;
            $('.hn-count').textContent = n ? `${n} ${n === 1 ? 'thing' : 'things'} playing` : '';
            paintIdle();
            paintLegend();
            setScrollY(scrollY, false);
            if (!focused || !focusables().includes(focused)) setFocus(firstFocusable());
        };

        // the quiet strip: what's there and ready, but not playing
        const paintIdle = () => {
            const m = Model();
            const rest = m ? m.idle() : [];
            const box = $('.hn-idle');
            box.hidden = !rest.length;
            if (!rest.length) return;
            const ready = rest.filter((r) => !r.away);
            const away = rest.length - ready.length;
            box.hidden = !ready.length && !away;
            if (box.hidden) return;
            box.innerHTML = `${icon('power_settings_new')}<b>Ready</b>`
                + `<span>${ready.map((r) => esc(r.label)).join(' · ') || 'Nothing else is switched on'}</span>`
                + (away ? `<i>${away} not responding</i>` : '');
        };

        const paintLegend = () => {
            const items = [{ key: '▲▼◀▶', label: 'Move' }, { key: 'OK', label: 'Do it' }];
            if (focused && focused.dataset && focused.dataset.k === 'volume') items.push({ key: '◀ ▶', label: 'Volume' });
            items.push('spacer', { key: 'H', label: 'Home', action: 'home' }, { key: 'ESC', label: 'Back', action: 'back' });
            $('.hn-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hn-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        // ---------- Doing things ----------

        const cardOf = (node) => {
            const card = node && node.closest ? node.closest('.hn-card') : null;
            return card ? byKey.get(card.dataset.key) : null;
        };
        const flash = (node) => {
            if (!node) return;
            node.classList.add('hn-hit');
            setTimeout(() => node.classList.remove('hn-hit'), 220);
        };
        const run = (node) => {
            if (!node) return;
            if (inMenu(node)) { if (typeof node._act === 'function') node._act(); return; }
            const c = cardOf(node);
            const k = node.dataset.k;
            if (!c || !k) return;
            if (k === 'remote') { go(`#/rooms?remote=${encodeURIComponent(c.remote)}`); return; }
            if (k === 'volume') { doAct(c, 'mute', null, node); return; } // OK on the volume mutes
            doAct(c, k, null, node);
        };
        const doAct = (c, what, arg, node) => {
            const m = Model();
            if (!m) return;
            flash(node);
            m.act(c, what, arg).then(paint).catch(() => paint());
        };
        // ◀▶ on a volume pill: 5% a press, shown at once
        const nudge = (dir) => {
            if (!focused || !focused.dataset || focused.dataset.k !== 'volume') return false;
            const c = cardOf(focused);
            if (!c || (!c.canVolume && !c.canStep)) return false;
            const now = c.volume == null ? 50 : c.volume;
            // at either end the press moves the focus on instead, so a slider
            // is never a place you can't arrow out of
            if (c.volume != null && ((dir < 0 && now === 0) || (dir > 0 && now === 100))) return false;
            const next = Math.max(0, Math.min(100, now + dir * VOL_STEP));
            c.volume = next; // show it now; the source catches up
            paintControls(focused.closest('.hn-card'), c);
            Model().act(c, 'volume', next).catch(() => {});
            return true;
        };

        // ---------- Input ----------

        const onKey = (ev) => {
            if (!root.isConnected || ev.defaultPrevented) return;
            if (window.HomerActions && window.HomerActions.isOpen()) return;
            if (window.HomerQuick && window.HomerQuick.isOpen && window.HomerQuick.isOpen()) return;
            if (document.getElementById('cg-root')) return; // the guide is on top
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) || isTyping(document.activeElement)) return;
            const k = ev.key;
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                const dir = k === 'ArrowRight' ? 1 : -1;
                ev.preventDefault();
                if (nudge(dir)) return;
                move(dir > 0 ? 'right' : 'left');
                paintLegend();
                return;
            }
            if (k === 'ArrowUp' || k === 'ArrowDown') {
                ev.preventDefault();
                move(k === 'ArrowUp' ? 'up' : 'down');
                paintLegend();
                return;
            }
            if (k === 'Enter' || k === ' ') { ev.preventDefault(); run(focused); return; }
            if (BACK_KEYS.includes(k)) { ev.preventDefault(); goBack(); return; }
            if (k === 'h' || k === 'H') { ev.preventDefault(); goHome(); return; }
            if (k === 'r' || k === 'R') { ev.preventDefault(); Model() && Model().refresh(); }
        };

        const onClick = (ev) => {
            if (ev.target.closest('.hn-brand')) { goHome(); return; }
            const leg = ev.target.closest('.hn-legend [data-action]');
            if (leg) {
                if (leg.dataset.action === 'home') goHome();
                else goBack();
                return;
            }
            const item = ev.target.closest('.hm-menu-item');
            if (item) { setFocus(item); run(item); return; }
            const vol = ev.target.closest('.hn-vol');
            if (vol) {
                // a tap sets the volume where it was tapped
                setFocus(vol);
                const c = cardOf(vol);
                const bar = vol.querySelector('.hn-vol-bar');
                const b = bar.getBoundingClientRect();
                if (c && b.width > 0) {
                    const pct = Math.round(Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * 100);
                    c.volume = pct;
                    paintControls(vol.closest('.hn-card'), c);
                    Model().act(c, 'volume', pct).catch(() => {});
                }
                paintLegend();
                return;
            }
            const btn = ev.target.closest('.hn-btn');
            if (btn) { setFocus(btn); run(btn); paintLegend(); }
        };
        const onMove = (ev) => {
            const n = ev.target.closest('.hn-btn, .hm-menu-item');
            if (n && n !== focused) { setFocus(n); paintLegend(); }
        };
        const onWheel = (ev) => {
            if (ev.target.closest('.hn-menu-col')) return; // the menu scrolls itself
            ev.preventDefault();
            setScrollY(scrollY + ev.deltaY, false);
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);
        stage.addEventListener('mousemove', onMove);
        cardsBox.addEventListener('wheel', onWheel, { passive: false });

        // ----- the model -----
        const m = Model();
        if (m) m.start();
        const offModel = m ? m.onChange(() => paint()) : () => {};
        paint(true);

        // ----- the Actions strip (shared/actions.js) -----
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const c = cardOf(focused);
            const out = [];
            if (c) {
                out.push({ id: 'play', icon: c.state === 'playing' ? 'pause' : 'play_arrow', label: c.state === 'playing' ? 'Pause' : 'Play', sub: c.title, main: true, run: () => doAct(c, 'play') });
                if (c.canStop) out.push({ id: 'stop', icon: 'stop', label: 'Stop', sub: c.where, run: () => doAct(c, 'stop') });
                if (c.canMute) out.push({ id: 'mute', icon: c.muted ? 'volume_off' : 'volume_up', label: c.muted ? 'Unmute' : 'Mute', sub: c.where, run: () => doAct(c, 'mute') });
                if (c.remote) out.push({ id: 'remote', icon: 'settings_remote', label: 'Remote', sub: c.where, run: () => go(`#/rooms?remote=${encodeURIComponent(c.remote)}`) });
            }
            out.push({ id: 'refresh', key: 'R', icon: 'refresh', label: 'Check again', run: () => Model() && Model().refresh() });
            return out;
        }, { id: 'playing', title: 'Now Playing' }) : () => {};

        return {
            phone: false,
            show() { root.style.visibility = ''; },
            sync() { paint(); },
            teardown() {
                offActions();
                offModel();
                offMenuStyle();
                if (menu) menu.destroy();
                if (Model()) Model().stop();
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('resize', fit);
                cardsBox.removeEventListener('wheel', onWheel);
                clearInterval(clockTimer);
                clearInterval(progressTimer);
                wxDetach();
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false;
    let destroyed = false;

    const isOurRoute = () => /^#!?\/playing(\?|$)/i.test(currentRoute());

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const phoneLayout = () => !!(window.HomerLayout && window.HomerPlayingPhone && window.HomerLayout.usePhone('playing'));
    const PHONE_CTX = { go, goBack, goHome, esc, icon, clock, positionNow, rooms, STATE_TEXT, SOURCE_TEXT, btnIcon, btnLabel, BUTTONS, ensureCss };
    const draw = () => (phoneLayout() ? window.HomerPlayingPhone.create(PHONE_CTX) : createScreen());

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) { closeScreen(); return; }
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
        observer = new MutationObserver(queueSync);
        observer.observe(document.body, { childList: true, subtree: true });
        queueSync();
    };

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    window.HomerPlaying = {
        version: VERSION,
        open() {
            suppressed = false;
            if (!isOurRoute()) { go('#/playing'); return; }
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
            document.getElementById('hn-css')?.remove();
            document.getElementById('hn-phone-css')?.remove();
            cssReady = null;
        }
    };
})();
