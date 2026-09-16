/*
 * HOMER Home, phone layout. home/home.js draws this instead of the TV stage
 * when shared/layout.js says Home is on a phone; both draw from the same data
 * (home.js's loadData).
 *
 * On Now on top: the program's picture (or its channel's logo), the channel,
 * the title, its time and how long is left, and Watch and Guide. Under it the
 * rows TV Home has (Continue watching, Up next, On now, Recently added), each
 * a strip of cards you scroll sideways. A tap on a card opens its page; a tap
 * on a live card watches it, as on TV. There's no menu: the tab bar has the
 * screens and the top bar the weather and Search, so Settings (the one left
 * over) is a button at the top of Home, beside the date, with Rooms before it
 * once Home Assistant is connected on this device. Sports and News (the hubs)
 * are a row of buttons under them.
 *
 * Watch plays the channel in a strip under the top bar (HomerPlayer docks the
 * real video there, in the same place as the guide's), and the rows keep
 * scrolling under it. A tap on the strip goes full screen, ✕ stops it.
 *
 * window.HomerHomePhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const MIN_MS = 60000;
    const TICK_MS = 30000; // time left, progress bars, and On Now moving on

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;
    const leftText = (end) => {
        const mins = Math.max(0, Math.round((end - Date.now()) / MIN_MS));
        return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
    };
    const progress = (s, e) => (e > s ? Math.max(0, Math.min(100, ((Date.now() - s) / (e - s)) * 100)) : 0);
    // a picture that loads when it's nearly on screen, and can't be dragged or long-pressed
    const pic = (url) => (url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" draggable="false">` : '');

    const create = (ctx) => {
        const { logoChip, cardArt, img, fmtTime } = ctx;
        const P = () => window.HomerPlayer || null;
        const docked = () => !!(P() && P().docked());

        // ---------- Page ----------
        // Keeps TV Home's id (the player, the phone chrome and H look for it);
        // homer-screen is how the player finds the strip to dock into.
        const root = el('div', 'hm-phone homer-screen');
        root.id = 'hm-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="hmp-main">
                <div class="hmp-dock">
                    <div class="hmp-dock-video" data-homer-preview>
                        <div class="hmp-dock-idle"><div class="hmp-dock-logo"></div><div class="hmp-dock-tuning">Tuning…</div></div>
                    </div>
                    <span class="hmp-badge">Live</span>
                    <div class="hmp-dock-ctl">
                        <button type="button" class="hmp-dock-btn hmp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                        <button type="button" class="hmp-dock-btn hmp-dock-stop" aria-label="Stop">${icon('close')}</button>
                    </div>
                    <div class="hmp-dock-cap"><span class="hmp-dock-what"></span><span class="hmp-dock-left"></span></div>
                    <div class="hmp-dock-bar"><b></b></div>
                </div>
                <div class="hmp-body">
                    <div class="hmp-scroll">
                        <div class="hmp-head">
                            <span class="hmp-date"></span>
                            <button type="button" class="hmp-settings hmp-rooms"${window.HomerHA && window.HomerHA.isSetUp() ? '' : ' hidden'}><span class="hmp-settings-pill">${icon('lightbulb')}Rooms</span></button>
                            <button type="button" class="hmp-settings"><span class="hmp-settings-pill">${icon('settings')}Settings</span></button>
                        </div>
                        <div class="hmp-hubs">
                            <button type="button" class="hmp-settings hmp-hub" data-go="#/sports"><span class="hmp-settings-pill">${icon('sports_football')}Sports</span></button>
                            <button type="button" class="hmp-settings hmp-hub" data-go="#/news"><span class="hmp-settings-pill">${icon('newspaper')}News</span></button>
                            <button type="button" class="hmp-settings hmp-hub" data-go="#/books"><span class="hmp-settings-pill">${icon('auto_stories')}Books</span></button>
                            <button type="button" class="hmp-settings hmp-hub" data-go="#/cameras"${window.HomerHA && window.HomerHA.isSetUp() ? '' : ' hidden'}><span class="hmp-settings-pill">${icon('videocam')}Cameras</span></button>
                        </div>
                        <section class="hmp-hero loading" aria-label="On now">
                            <div class="hmp-art"><div class="hmp-art-logo"></div><span class="hmp-badge">Live</span></div>
                            <div class="hmp-hero-text">
                                <div class="hmp-eyebrow">On now</div>
                                <div class="hmp-hero-ch"></div>
                                <h1 class="hmp-hero-title">Loading…</h1>
                                <div class="hmp-hero-meta"></div>
                                <div class="hmp-bar"><b></b></div>
                                <p class="hmp-hero-desc"></p>
                                <div class="hmp-acts"></div>
                            </div>
                        </section>
                        <div class="hmp-rows"></div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);
        const rowsEl = $('.hmp-rows');
        const alive = () => ctx.isOpen(self);

        // ---------- The date, and Settings ----------
        const paintDate = () => {
            // shorter beside two buttons (Rooms and Settings)
            const two = !$('.hmp-rooms').hidden;
            $('.hmp-date').textContent = new Date().toLocaleDateString([], two ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' });
        };
        $('.hmp-settings:not(.hmp-rooms)')._act = () => ctx.go('#/mypreferencesmenu');
        $('.hmp-rooms')._act = () => ctx.go('#/rooms');
        // the hubs (Sports, News): a row of their own under the date
        root.querySelectorAll('.hmp-hub').forEach((b) => { b._act = () => ctx.go(b.dataset.go); });

        // ---------- Watching ----------
        const watch = (p) => {
            ctx.watch(p);
            syncDock();
        };

        // ---------- On Now (Now watching while the strip plays) ----------
        let live = []; // what's on now; the first one that hasn't ended is On Now
        let loaded = false;
        const onNow = () => live.find((p) => Date.parse(p.EndDate) > Date.now()) || null;
        const heroEl = $('.hmp-hero');
        let artFor = null; // what the picture is of
        const paintArt = (p) => {
            const key = p ? p.Id : '';
            if (key === artFor) return;
            artFor = key;
            const art = $('.hmp-art');
            art.querySelector('img')?.remove();
            const logo = $('.hmp-art-logo');
            logo.innerHTML = '';
            const url = p && p.ImageTags && p.ImageTags.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 900) : null;
            if (url) art.insertAdjacentHTML('afterbegin', pic(url).replace(' loading="lazy"', ''));
            else if (p) logo.appendChild(logoChip(p, true));
            art.classList.toggle('noart', !url);
        };
        // its time, time left and progress bar (the tick moves them on)
        const paintTimes = (p) => {
            const meta = $('.hmp-hero-meta');
            const bar = $('.hmp-bar');
            const s = p && Date.parse(p.StartDate);
            const e = p && Date.parse(p.EndDate);
            bar.style.display = s && e ? '' : 'none';
            if (!s || !e) return;
            meta.textContent = `${fmtTime(new Date(s))} – ${fmtTime(new Date(e))}${e > Date.now() ? ' · ' + leftText(e) : ''}`;
            bar.firstChild.style.width = progress(s, e) + '%';
        };
        let heroKey = null; // what the card is showing; only the times change while it's the same
        const paintHero = () => {
            const watching = docked();
            const np = watching && P().nowPlaying();
            const p = watching ? np && np.program : onNow();
            const item = watching && np && np.item;
            const key = [watching, loaded, p ? p.Id || p.ChannelId : item ? item.Id : ''].join('|');
            if (key === heroKey) {
                paintTimes(p);
                return;
            }
            heroKey = key;
            heroEl.classList.toggle('loading', !loaded && !watching);
            heroEl.classList.toggle('empty', loaded && !p && !item && !watching);
            $('.hmp-eyebrow').textContent = watching ? 'Now watching' : p ? 'On now' : 'Live TV';

            const ch = $('.hmp-hero-ch');
            ch.innerHTML = '';
            const title = $('.hmp-hero-title');
            const meta = $('.hmp-hero-meta');
            const desc = $('.hmp-hero-desc');
            const acts = $('.hmp-acts');
            acts.innerHTML = '';
            meta.textContent = '';
            if (p) {
                ch.appendChild(logoChip(p));
                ch.appendChild(el('span', 'hmp-hero-chname', `${p.ChannelNumber ? `<b>${esc(p.ChannelNumber)}</b>` : ''}${esc(p.ChannelName || '')}`));
                title.textContent = p.Name || '';
                desc.textContent = [p.EpisodeTitle, p.Overview].filter(Boolean).join(' — ');
            } else if (item) {
                const isEp = item.Type === 'Episode';
                ch.appendChild(el('span', 'hmp-hero-chname', esc(isEp
                    ? [item.SeriesName, item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} E${item.IndexNumber}` : ''].filter(Boolean).join(' · ')
                    : item.Type === 'Movie' ? 'Movie' : '')));
                title.textContent = item.Name || '';
                meta.textContent = [item.ProductionYear, item.OfficialRating, item.RunTimeTicks ? `${Math.round(item.RunTimeTicks / 6e8)} min` : ''].filter(Boolean).join(' · ');
                desc.textContent = item.Overview || '';
            } else {
                title.textContent = watching ? 'Tuning…' : loaded ? 'Nothing listed right now' : 'Loading…';
                desc.textContent = loaded && !watching ? 'Open the guide to browse every channel.' : '';
            }
            paintTimes(p);
            if (!watching) paintArt(p);
            // Watch and Guide (the strip has its own full screen and stop)
            const btn = (cls, iconName, label, act) => {
                const b = el('button', 'hmp-act ' + cls, `${icon(iconName)}<span>${esc(label)}</span>`);
                b.type = 'button';
                b._act = act;
                acts.appendChild(b);
            };
            if (!watching && p) btn('hmp-act-watch', 'play_arrow', `Watch ${(p.ChannelName || '').replace(/\s*\(.*$/, '')}`.trim(), () => watch(p));
            if (!watching && (p || loaded)) btn('hmp-act-guide', 'grid_view', 'Guide', ctx.openGuide);
        };

        // ---------- Rows: strips of cards you scroll sideways ----------
        const mediaCard = (it) => {
            const isEp = it.Type === 'Episode';
            const title = isEp ? it.SeriesName : it.Name;
            const sub = isEp
                ? [it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber} E${it.IndexNumber}` : '', it.Name].filter(Boolean).join(' · ')
                : [it.ProductionYear, it.OfficialRating].filter(Boolean).join(' · ');
            const art = cardArt(it);
            const pct = it.UserData && it.UserData.PlayedPercentage;
            const card = el('button', 'hmp-card' + (art ? '' : ' noart'),
                `<span class="hmp-card-art">${art ? pic(art) : icon(isEp || it.Type === 'Series' ? 'tv' : 'movie')}`
                + (pct ? `<span class="hmp-card-bar"><b style="width:${Math.round(pct)}%"></b></span>` : '') + '</span>'
                + `<span class="hmp-card-title">${esc(title)}</span><span class="hmp-card-sub">${esc(sub)}</span>`);
            card.type = 'button';
            card._act = () => ctx.go(`#/details?id=${it.Id}&serverId=${ctx.server.Id}`);
            return card;
        };
        const liveCard = (p) => {
            const art = p.ImageTags && p.ImageTags.Primary ? img(p.Id, 'Primary', p.ImageTags.Primary, 600) : null;
            const s = Date.parse(p.StartDate);
            const e = Date.parse(p.EndDate);
            const card = el('button', 'hmp-card hmp-card-live' + (art ? '' : ' noart'),
                `<span class="hmp-card-art">${pic(art)}<span class="hmp-card-logo"></span><span class="hmp-badge">Live</span>`
                + `<span class="hmp-card-bar"><b style="width:${progress(s, e)}%"></b></span></span>`
                + `<span class="hmp-card-title">${esc(p.Name)}</span>`
                + `<span class="hmp-card-sub">${esc((p.ChannelName || '').replace(/\s*\(.*$/, ''))} · until ${esc(fmtTime(new Date(e)))}</span>`);
            card.type = 'button';
            card.querySelector('.hmp-card-logo').appendChild(logoChip(p));
            card.setAttribute('aria-label', `Watch ${p.Name} on ${p.ChannelName || 'live TV'}`);
            card._span = [s, e];
            card._act = () => watch(p);
            return card;
        };
        const buildRows = (rows) => {
            rowsEl.innerHTML = '';
            rows.forEach((row) => {
                const sec = el('section', 'hmp-row');
                sec.appendChild(el('h2', 'hmp-row-title', esc(row.title)));
                const strip = el('div', 'hmp-strip');
                row.items.forEach((it) => strip.appendChild(row.live ? liveCard(it) : mediaCard(it)));
                sec.appendChild(strip);
                rowsEl.appendChild(sec);
            });
            if (!rows.length) rowsEl.appendChild(el('div', 'hmp-empty', 'Nothing to show yet.'));
        };
        // grey cards while it loads
        rowsEl.innerHTML = [0, 1].map(() => '<section class="hmp-row hmp-skel"><h2 class="hmp-row-title"></h2><div class="hmp-strip">'
            + '<span class="hmp-card"><span class="hmp-card-art"></span></span>'.repeat(3) + '</div></section>').join('');

        // ---------- The strip a docked video plays in ----------
        // HomerPlayer pins the real video over [data-homer-preview] and opens it
        // full screen when that's tapped; this draws what's around it. (The
        // buttons sit beside it, not in it, so they don't count as a tap on it.)
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = docked();
            const was = root.classList.contains('hmp-docked');
            root.classList.toggle('hmp-docked', on);
            if (on !== was) paintHero();
            if (!on) {
                root.classList.remove('hmp-dock-live');
                dockFor = null;
                return;
            }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('hmp-dock-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp.nowPlaying();
            const p = np && np.program;
            const item = np && np.item;
            const now = Date.now();
            const s = p && Date.parse(p.StartDate);
            const e = p && Date.parse(p.EndDate);
            $('.hmp-dock-what').textContent = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ')
                : item ? item.Name || '' : '';
            $('.hmp-dock-left').textContent = p && e > now ? leftText(e) : '';
            $('.hmp-dock-bar b').style.width = p && s && e > s ? progress(s, e) + '%' : '0';
            $('.hmp-dock .hmp-badge').style.display = p ? '' : 'none';
            const key = p ? p.ChannelId : item ? item.Id : '';
            if (key !== dockFor) {
                dockFor = key;
                const logo = $('.hmp-dock-logo');
                logo.innerHTML = '';
                if (p) logo.appendChild(logoChip(p, true));
            }
        };

        // ---------- Input ----------
        // Every button here carries what it does; the strip's own two are named.
        const onClick = (ev) => {
            const b = ev.target.closest('button');
            if (!b || !root.contains(b)) return;
            const hp = P();
            if (b.classList.contains('hmp-dock-full')) { if (hp) hp.fullscreen(); return; }
            if (b.classList.contains('hmp-dock-stop')) { if (hp) hp.stop(); return; }
            if (b._act) b._act();
        };
        root.addEventListener('click', onClick);
        // Scrolling here is Home's alone: Jellyfin's player page turns scroll
        // gestures into volume changes. (The rows still scroll.)
        const onWheelCapture = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        window.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });

        // Now moves on: time left, progress bars, and On Now when it ends.
        const tick = () => {
            paintDate();
            paintHero();
            rowsEl.querySelectorAll('.hmp-card-live').forEach((c) => {
                c.querySelector('.hmp-card-bar b').style.width = progress(c._span[0], c._span[1]) + '%';
            });
        };
        const tickTimer = setInterval(tick, TICK_MS);
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing

        const self = {
            phone: true,
            show() { root.style.visibility = ''; },
            // what's playing changed (home.js hears it from the player)
            refresh() {
                syncDock();
                paintHero();
            },
            teardown() {
                clearInterval(tickTimer);
                clearInterval(dockTimer);
                window.removeEventListener('wheel', onWheelCapture, { capture: true });
                root.remove();
            }
        };

        paintDate();
        syncDock();
        paintHero();

        // ---------- Data ----------
        (async () => {
            const d = await ctx.data;
            if (!alive()) return;
            live = d.live;
            loaded = true;
            paintHero();
            buildRows(d.rows);
        })().catch((err) => {
            console.error('[HOMER Home]', err);
            if (!alive()) return;
            loaded = true;
            paintHero();
            $('.hmp-hero-title').textContent = 'Couldn\'t load home';
            rowsEl.innerHTML = '';
        });

        return self;
    };

    window.HomerHomePhone = { version: VERSION, create };
    // tell the layout Home has a phone layout (a Home already open on a phone
    // switches over)
    if (window.HomerLayout) window.HomerLayout.register('home', { phone: true });
})();
