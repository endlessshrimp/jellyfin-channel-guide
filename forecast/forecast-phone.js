/*
 * HOMER Weather, phone layout. forecast/forecast.js draws this instead of the
 * TV board when shared/layout.js says it's a phone; both get their forecast,
 * sentences, skies and radar from forecast.js (ctx), so they always agree.
 *
 * One column that scrolls (two across in landscape):
 *
 *   Title band    the place, and what's coming in a sentence
 *   Now           temperature and conditions; feels like, humidity, wind, and
 *                 the next sunrise or sunset; then the next 14 hours two at a
 *                 time, swiped sideways
 *   Radar         the last hour of the National Weather Service's radar on a
 *                 HOMER map sized for the panel, with the time of each picture
 *   Next 3 days   a panel a day
 *
 * Now and each day sit on the same illustrated skies as on TV, under a
 * heavier scrim (the text covers more of a narrow panel). A video playing in a
 * preview window docks at the top; a tap on it goes full screen, ✕ stops it.
 *
 * window.HomerForecastPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';
    const NAME_SCALE = 0.8; // the radar's town names, against the TV's

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

    const create = (ctx) => {
        const { esc, deg } = ctx;
        const P = () => window.HomerPlayer || null;

        const root = el('div', 'homer-screen hf-phone');
        root.id = 'hf-root';
        root.style.visibility = 'hidden'; // until the stylesheet is in
        root.innerHTML = `
            <div class="fp-dock">
                <div class="fp-video" data-homer-preview><span class="fp-video-idle">Tuning…</span></div>
                <div class="fp-dock-bar">
                    <span class="fp-dock-what"></span>
                    <button type="button" class="fp-dock-btn fp-dock-full" aria-label="Full screen">${icon('fullscreen')}</button>
                    <button type="button" class="fp-dock-btn fp-dock-stop" aria-label="Stop">${icon('close')}</button>
                </div>
            </div>
            <div class="fp-scroll">
                <div class="fp-body">
                    <div class="fp-title">
                        <div class="fp-place">${icon('place')}<span></span></div>
                        <div class="fp-line"></div>
                    </div>
                    <section class="fp-panel fp-now">
                        <div class="fp-sky"></div>
                        <h2 class="fp-head">Now</h2>
                        <div class="fp-now-main">
                            <img class="fp-now-icon" alt="" draggable="false">
                            <div class="fp-now-temp"></div>
                        </div>
                        <div class="fp-now-cond"></div>
                        <div class="fp-now-stats"></div>
                        <div class="fp-strip">
                            <div class="fp-strip-head"><span class="fp-strip-range"></span><span class="fp-key-rain"><i></i>Chance of rain</span></div>
                            <div class="fp-slots"></div>
                        </div>
                    </section>
                    <section class="fp-panel fp-radar">
                        <div class="fp-radar-map"></div>
                        <h2 class="fp-head">Radar<span class="fp-radar-name">Past hour</span></h2>
                        <div class="fp-radar-time"><span class="fp-radar-clock"></span><span class="fp-radar-ticks"></span></div>
                        <div class="fp-radar-off"><b></b><span></span></div>
                    </section>
                    <div class="fp-days">
                        ${'<section class="fp-panel fp-day"><div class="fp-sky"></div><div class="fp-day-body"></div></section>'.repeat(3)}
                    </div>
                </div>
                <div class="fp-state"></div>
            </div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);

        // don't leave a Jellyfin control underneath focused
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        let fmt = null; // the place's formatters
        let shown = false; // the stylesheet is in, so the panels have their sizes

        // ----- title band -----
        const drawTitle = (fc) => {
            $('.fp-place span:last-child').textContent = (fc.place && fc.place.name) || '';
            $('.fp-line').textContent = ctx.summary(fc, fmt);
        };

        // ----- Now -----
        const stat = (k, v) => (v ? `<div class="fp-stat"><span class="fp-stat-k">${esc(k)}</span><span class="fp-stat-v">${esc(v)}</span></div>` : '');
        const drawNowSky = (fc) => ctx.setSky($('.fp-now .fp-sky'), ...ctx.nowSky(fc));
        const drawNow = (fc) => {
            const cur = fc.current;
            const { label, icon: art } = ctx.describe(cur.code, cur.isDay);
            $('.fp-now-temp').textContent = deg(cur.temp);
            const img = $('.fp-now-icon');
            const src = ctx.iconUrl(art); // Now's icon moves; the rest are stills
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            img.alt = label;
            $('.fp-now-cond').textContent = label;
            drawNowSky(fc);
            $('.fp-now-stats').innerHTML = ctx.nowFacts(fc, fmt).map(([k, v]) => stat(k, v)).join('');
        };

        // ----- the next 14 hours, swiped sideways -----
        const slotsBox = $('.fp-slots');
        const edges = () => {
            const max = slotsBox.scrollWidth - slotsBox.clientWidth;
            slotsBox.classList.toggle('more-left', slotsBox.scrollLeft > 2);
            slotsBox.classList.toggle('more-right', slotsBox.scrollLeft < max - 2);
        };
        slotsBox.addEventListener('scroll', edges, { passive: true });
        const drawStrip = (fc) => {
            const slots = ctx.stripSlots(fc, fmt);
            slotsBox.innerHTML = slots.map((sl) => `
                <div class="fp-slot${sl.now ? ' now' : ''}${sl.newDay ? ' new-day' : ''}" title="${esc(sl.label)}">
                    <div class="fp-slot-time">${esc(sl.time)}</div>
                    ${ctx.stillImg(sl.icon, 'fp-slot-icon')}
                    <div class="fp-slot-temp">${sl.temp}</div>
                    <div class="fp-slot-pop${sl.pop >= 10 ? '' : ' dry'}"><i></i>${sl.pop == null ? '–' : sl.pop + '%'}</div>
                </div>`).join('');
            ctx.fillStills(slotsBox);
            $('.fp-strip-range').textContent = ctx.stripRange(slots);
            edges();
        };

        // ----- the next three days -----
        const drawDays = (fc) => {
            root.querySelectorAll('.fp-day').forEach((pane, k) => {
                const d = ctx.dayInfo(fc, fmt, k + 1);
                const body = pane.querySelector('.fp-day-body');
                pane.hidden = !d;
                if (!d) return;
                ctx.setSky(pane.querySelector('.fp-sky'), d.code, 'day');
                body.innerHTML = `
                    <div class="fp-day-main">
                        <div class="fp-day-top"><span class="fp-day-name">${esc(d.name)}</span><span class="fp-day-date">${esc(d.date)}</span></div>
                        <div class="fp-day-mid">
                            ${ctx.stillImg(d.icon, 'fp-day-icon')}
                            <div class="fp-day-temps"><span class="fp-day-hi">${d.hi}</span><span class="fp-day-lo">${d.lo}</span></div>
                        </div>
                        <div class="fp-day-cond">${esc(d.label)}</div>
                    </div>
                    <div class="fp-day-facts">${d.facts.map(([k, v]) => stat(k, v)).join('')}</div>`;
                ctx.fillStills(body);
            });
        };

        // ----- radar -----
        // The map is drawn for the panel's own size (in CSS pixels), so the
        // lines and names are as sharp and as big as they should be; turning
        // the phone makes a new one.
        const radarBox = $('.fp-radar');
        let radar = null;
        let radarSize = '';
        const buildRadar = () => {
            const w = Math.round(radarBox.clientWidth);
            const h = Math.round(radarBox.clientHeight);
            if (w < 80 || h < 80) return false;
            if (radar) radar.teardown();
            radarSize = w + 'x' + h;
            const map = $('.fp-radar-map');
            map.innerHTML = `
                <svg class="fp-radar-land" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
                <div class="fp-radar-frames"></div>
                <img class="fp-radar-roads" alt="" draggable="false">
                <svg class="fp-radar-lines" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>`;
            const t = NAME_SCALE;
            radar = ctx.createRadar({
                els: {
                    box: radarBox, land: $('.fp-radar-land'), frames: $('.fp-radar-frames'), roads: $('.fp-radar-roads'),
                    lines: $('.fp-radar-lines'), clock: $('.fp-radar-clock'), ticks: $('.fp-radar-ticks'),
                    offTitle: $('.fp-radar-off b'), offText: $('.fp-radar-off span'),
                },
                w,
                h,
                // about 300 km across: far enough to see weather coming
                km: Math.round(Math.max(280, Math.min(420, w * 0.9))),
                t,
                // names clear of the edges, the title and the time
                safe: [8, w - 8, 44, h - 44],
                maxTowns: 6,
                // pictures at twice the panel's size on a sharp screen
                scale: () => ((window.devicePixelRatio || 1) >= 1.5 ? 2 : 1),
                fmt: () => fmt,
            });
            return true;
        };
        const drawRadar = (fc) => {
            if (!shown || !fc) return;
            if (!radar && !buildRadar()) return;
            radar.draw(fc.place);
        };
        // a new size (the phone turned): a new map, if it's really different
        // (a small change just crops the one there is)
        let resizeTimer = 0;
        const onResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                edges();
                const fc = feed.fc();
                if (!radar || !fc) return;
                const w = Math.round(radarBox.clientWidth);
                const h = Math.round(radarBox.clientHeight);
                const [ow, oh] = radarSize.split('x').map(Number);
                if (Math.abs(w - ow) < 24 && Math.abs(h - oh) < 24) return;
                if (buildRadar()) radar.draw(fc.place);
            }, 300);
        };
        window.addEventListener('resize', onResize);
        // (and the panel itself: in landscape it's as tall as Now beside it)
        const sizeWatch = window.ResizeObserver ? new ResizeObserver(onResize) : null;
        if (sizeWatch) sizeWatch.observe(radarBox);

        // ----- the forecast: loading, then drawn -----
        const setStatus = (s) => {
            root.classList.toggle('fp-ready', s === 'ready');
            const box = $('.fp-state');
            if (s === 'loading') box.innerHTML = '<b>Checking the forecast…</b>';
            else if (s === 'error') box.innerHTML = `<b>The forecast didn't load</b><span>Open-Meteo didn't answer.</span><button type="button" class="fp-retry">${icon('refresh')}Try again</button>`;
            else box.innerHTML = '';
            box.classList.toggle('show', s !== 'ready');
        };
        const drawAll = (fc) => {
            fmt = ctx.makeFormatters(fc.timeZone);
            drawTitle(fc);
            drawNow(fc);
            drawStrip(fc);
            drawDays(fc);
            drawRadar(fc);
        };
        const feed = ctx.createFeed({
            data: drawAll,
            status: setStatus,
            tick: () => drawNowSky(feed.fc()),
        });
        // a fresh radar loop every 5 minutes while the screen is up
        const radarTimer = setInterval(() => {
            const fc = feed.fc();
            if (fc && radar) radar.refresh(fc.place);
            else drawRadar(fc);
        }, ctx.RADAR_MS);

        // ----- input -----
        root.addEventListener('click', (ev) => {
            if (ev.target.closest('.fp-retry')) feed.retry();
        });
        // Esc goes back (a phone with a keyboard)
        const onKey = (ev) => {
            if (document.getElementById('cg-root')) return; // the guide is up
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(ev.key)) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) ctx.goBack();
        };
        // scrolling here is Weather's alone (Jellyfin's player page turns it into volume)
        const onWheel = (ev) => {
            if (root.contains(ev.target)) ev.stopPropagation();
        };
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: true });

        // ----- docked video -----
        let dockFor = null;
        const syncDock = () => {
            const hp = P();
            const on = ctx.docked();
            root.classList.toggle('fp-docked', on);
            if (!on) { dockFor = null; return; }
            const v = document.querySelector('.videoPlayerContainer.homer-pinned video');
            root.classList.toggle('fp-live', !!(v && v.readyState >= 2 && v.videoWidth > 0));
            const np = hp && hp.nowPlaying ? hp.nowPlaying() : null;
            const p = np && np.program;
            const item = np && np.item;
            const what = p ? [p.ChannelNumber ? `CH ${p.ChannelNumber}` : '', p.Name].filter(Boolean).join(' · ') : item ? item.Name || '' : '';
            if (what !== dockFor) {
                dockFor = what;
                $('.fp-dock-what').innerHTML = `${p ? '<span class="fp-live-badge">Live</span>' : ''}<span>${esc(what)}</span>`;
            }
        };
        $('.fp-dock').addEventListener('click', (ev) => {
            const hp = P();
            if (!hp) return;
            if (ev.target.closest('.fp-dock-stop')) { ev.stopPropagation(); hp.stop(); } else if (ev.target.closest('.fp-dock-full')) { ev.stopPropagation(); hp.fullscreen(); }
            // a tap on the video itself: HomerPlayer takes it to full screen
        });
        const dockTimer = setInterval(syncDock, 500); // the video coming in, what's playing

        syncDock();
        feed.start();

        return {
            phone: true,
            show() {
                root.style.visibility = '';
                shown = true;
                drawRadar(feed.fc());
                edges();
            },
            sync: syncDock,
            teardown() {
                feed.stop();
                if (radar) radar.teardown();
                clearInterval(radarTimer);
                clearInterval(dockTimer);
                clearTimeout(resizeTimer);
                window.removeEventListener('resize', onResize);
                if (sizeWatch) sizeWatch.disconnect();
                window.removeEventListener('wheel', onWheel, { capture: true });
                document.removeEventListener('keydown', onKey, true);
                root.remove();
            },
        };
    };

    window.HomerForecastPhone = { version: VERSION, create };
    // tell the layout Weather has a phone layout (Weather already open on a
    // phone switches over)
    if (window.HomerLayout) window.HomerLayout.register('weather', { phone: true });
})();
