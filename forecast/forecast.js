/*
 * HOMER Weather for Jellyfin Web: the forecast as a full-screen board on the
 * same 1080-tall stage as the other HOMER screens, laid out like a TV weather
 * segment: a title band, then one thing per panel.
 *
 * HOMER's own page at #/weather (Home's Weather item goes there; Jellyfin has
 * nothing at that address). The place is the one the clock's weather uses
 * (shared/weather.js, set per device in Settings → Weather location), and the
 * reading is shared with it, so the clock and this screen always agree.
 *
 *   Title band    the place, and what's coming in a sentence
 *   Now           temperature and conditions; feels like, humidity, wind, and
 *                 the next sunrise or sunset
 *   Next 3 days   conditions, high and low, chance of rain and how much
 *   Hour by hour  twelve hours: conditions, temperature, chance of rain
 *
 * Only the Now icon moves; the rest are stills of the same icons.
 *
 * Remote/keyboard: ◀▶ earlier/later hours (twelve at a time), OK back to now,
 * Esc/Backspace goes back, H goes Home.
 *
 * window.HomerForecast = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    // Loading twice (hot reload, or the loader plus a manual copy) replaces the
    // previous instance.
    if (window.HomerForecast && typeof window.HomerForecast.destroy === 'function') {
        window.HomerForecast.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="forecast.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    const BASE = scriptSrc
        ? scriptSrc.replace(/forecast\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/') + 'forecast/';
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990; // just under the guide, so the guide can open on top
    const REFRESH_MS = 10 * 60 * 1000; // same as the clock's weather
    const PAGE = 12; // hours in the Hour by hour panel
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

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
    // While a video plays docked in a preview window, HOMER screens sit on top of
    // Jellyfin's #/video page and navigate virtually; HomerPlayer knows the real
    // route. Without it, the address bar is the route.

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Weather]', err); return fallback; }
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
    const fullscreen = () => {
        const p = HP();
        if (p && typeof p.fullscreen === 'function') p.fullscreen();
    };

    // ---------- Small helpers ----------

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isTyping = (t) => {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable) return true;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        if (t.tagName !== 'INPUT') return false;
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((t.type || '').toLowerCase());
    };
    const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);
    const inches = (v) => (v >= 0.005 ? `${v < 0.1 ? v.toFixed(2) : v.toFixed(1)} in` : '');
    const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const compass = (from) => (from == null ? '' : COMPASS[Math.round(from / 45) % 8]);
    const wet = (code) => code >= 51;
    const wetWord = (code) => {
        if (code >= 95) return 'Storms';
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
        if (code >= 51 && code <= 57) return 'Drizzle';
        return 'Rain';
    };

    // weather.js knows the codes and icons; these fall back if it isn't loaded
    const WX = () => window.HomerWeather || null;
    const describe = (code, isDay) => {
        const w = WX();
        const fn = w && (w.describe || w._describe);
        return fn ? fn(code, isDay) : { label: '', icon: isDay ? 'clear-day' : 'clear-night' };
    };
    const iconUrl = (name) => {
        const w = WX();
        const fn = w && (w.iconUrl || w._iconUrl);
        return fn ? fn(name) : BASE + '../shared/wx/' + name + '.svg' + QUERY;
    };

    // A still of an icon: the same art with its animation taken out (and the
    // raindrops and snowflakes that only fade in while animating left showing).
    // Falls back to the moving icon if the art can't be fetched.
    const stills = new Map(); // icon name -> Promise<url>
    const stillUrl = (name) => {
        if (!stills.has(name)) {
            stills.set(name, fetch(iconUrl(name))
                .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
                .then((svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg
                    .replace(/<animate(Transform)?\b[^>]*\/>/g, '')
                    .replace(/ opacity="0"/g, '')))
                .catch(() => iconUrl(name)));
        }
        return stills.get(name);
    };
    const stillImg = (name, cls) => `<img class="${cls}" data-still="${esc(name)}" alt="" draggable="false">`;
    const fillStills = (box) => {
        box.querySelectorAll('img[data-still]').forEach((img) => {
            stillUrl(img.dataset.still).then((u) => { if (img.isConnected) img.src = u; });
        });
    };

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
        if (cssReady && document.getElementById('hf-css')) return cssReady;
        const css = document.createElement('link');
        css.id = 'hf-css';
        css.rel = 'stylesheet';
        css.href = BASE + 'forecast.css' + QUERY;
        cssReady = new Promise((resolve) => {
            css.onload = css.onerror = resolve;
            setTimeout(resolve, 2000);
        });
        document.head.appendChild(css);
        return cssReady;
    };

    // ---------- The screen ----------

    const createScreen = () => {
        const root = el('div', 'homer-screen');
        root.id = 'hf-root';
        root.style.visibility = 'hidden'; // until forecast.css has loaded
        root.style.zIndex = Z;
        const stage = el('div');
        stage.id = 'hf-stage';
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hf-topbar">
                <div class="hf-brand homer-home" role="button" title="Home (H)"><span class="hf-brand-mark"><span class="material-icons" aria-hidden="true">home</span></span>HOMER<span class="hf-brand-sub">Weather</span></div>
                <div class="hf-clock"><div class="hf-clock-time"></div><div class="hf-clock-date"></div></div>
            </div>
            <div class="hf-body">
                <div class="hf-title">
                    <div class="hf-title-place"><span class="material-icons" aria-hidden="true">place</span><span></span></div>
                    <div class="hf-title-line"></div>
                </div>
                <section class="hf-panel hf-now">
                    <h2 class="hf-head">Now</h2>
                    <div class="hf-now-main">
                        <img class="hf-now-icon" alt="" draggable="false">
                        <div class="hf-preview" data-homer-preview><span class="material-icons" aria-hidden="true">live_tv</span></div>
                        <div class="hf-now-temp"></div>
                    </div>
                    <div class="hf-now-cond"></div>
                    <div class="hf-now-stats"></div>
                </section>
                <section class="hf-panel hf-days">
                    <h2 class="hf-head">Next 3 days</h2>
                    <div class="hf-days-cols"></div>
                </section>
                <section class="hf-panel hf-hours">
                    <h2 class="hf-head">Hour by hour<span class="hf-hours-range"></span><span class="hf-key-rain"><i></i>Chance of rain</span></h2>
                    <div class="hf-hours-cols"></div>
                </section>
            </div>
            <div class="hf-state"></div>
            <div class="hf-legend"></div>`;
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
            $('.hf-clock-time').textContent = fmtTime(d);
            $('.hf-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tick();
        const clockTimer = setInterval(tick, 1000);
        const wxDetach = window.HomerWeather ? HomerWeather.attach($('.hf-clock')) : () => {};

        // don't leave a Jellyfin control underneath focused (Space/Enter would hit it)
        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- state -----
        let alive = true;
        let status = 'loading'; // loading | ready | error
        let fc = null; // HomerWeather.forecast()'s result
        let page = 0; // which twelve hours: 0 starts at the current hour
        let fmt = null; // formatters in the place's own time zone

        const hourNow = () => clamp(Math.floor((Date.now() - fc.hours[0].at) / 3600000), 0, fc.hours.length - 1);
        const lastPage = () => Math.max(0, Math.ceil((fc.hours.length - hourNow()) / PAGE) - 1);
        // the first hour on a page; the last page ends with the forecast's last hour
        const pageStart = (p) => Math.max(0, Math.min(hourNow() + p * PAGE, fc.hours.length - PAGE));
        // the index of the hour that starts day d
        const dayStart = (d) => {
            const at = fc.days[d] && fc.days[d].at;
            const i = fc.hours.findIndex((h) => h.at >= at);
            return i < 0 ? fc.hours.length : i;
        };
        const dayOf = (i) => {
            const at = fc.hours[i].at;
            let d = 0;
            for (let k = 1; k < fc.days.length; k++) if (at >= fc.days[k].at) d = k;
            return d;
        };

        const makeFormatters = (tz) => {
            const f = (opts) => {
                try { return new Intl.DateTimeFormat([], { ...opts, timeZone: tz }); } catch { return new Intl.DateTimeFormat([], opts); }
            };
            const hour = f({ hour: 'numeric' });
            const time = f({ hour: 'numeric', minute: '2-digit' });
            const weekday = f({ weekday: 'long' });
            const wdShort = f({ weekday: 'short' });
            const date = f({ month: 'short', day: 'numeric' });
            return {
                hour: (at) => hour.format(at),
                time: (at) => time.format(at),
                weekday: (at) => weekday.format(at),
                wdShort: (at) => wdShort.format(at),
                date: (at) => date.format(at),
            };
        };

        // ----- title band: the place, and what's coming -----
        const summary = () => {
            const i0 = hourNow();
            const ahead = fc.hours.slice(i0, i0 + 25);
            const cur = fc.current;
            const parts = [];
            if (wet(cur.code)) {
                const dry = ahead.findIndex((h, k) => k > 0 && !wet(h.code) && (h.pop == null || h.pop < 30));
                parts.push(dry > 0 ? `${wetWord(cur.code)} until about ${fmt.hour(ahead[dry].at)}` : `${wetWord(cur.code)} through the next day`);
            } else {
                const likely = ahead.findIndex((h, k) => k > 0 && h.pop >= 50);
                const maybe = ahead.findIndex((h, k) => k > 0 && h.pop >= 20);
                if (likely > 0) parts.push(`${wetWord(wet(ahead[likely].code) ? ahead[likely].code : 61)} likely around ${fmt.hour(ahead[likely].at)}`);
                else if (maybe > 0) parts.push(`A chance of ${wetWord(wet(ahead[maybe].code) ? ahead[maybe].code : 61).toLowerCase()} around ${fmt.hour(ahead[maybe].at)}`);
                else parts.push('Dry for the next 24 hours');
            }
            // the next turn of the temperature: today's high if it's still coming, else the overnight low
            const next12 = ahead.slice(0, 13);
            const temps = next12.map((h) => h.temp);
            const peak = temps.indexOf(Math.max(...temps));
            const dip = temps.indexOf(Math.min(...temps));
            const now = cur.temp;
            if (peak > 0 && Math.round(temps[peak]) > now) parts.push(`Up to ${deg(temps[peak])} by ${fmt.hour(next12[peak].at)}`);
            else if (dip > 0 && Math.round(temps[dip]) < now) parts.push(`Down to ${deg(temps[dip])} by ${fmt.hour(next12[dip].at)}`);
            return parts.join('. ') + '.';
        };
        const drawTitle = () => {
            $('.hf-title-place span:last-child').textContent = (fc.place && fc.place.name) || '';
            $('.hf-title-line').textContent = summary();
        };

        // ----- Now -----
        const drawNow = () => {
            const cur = fc.current;
            const { label, icon } = describe(cur.code, cur.isDay);
            $('.hf-now-temp').textContent = deg(cur.temp);
            const img = $('.hf-now-icon');
            const src = iconUrl(icon);
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            img.alt = label;
            $('.hf-now-cond').textContent = label;

            const now = Date.now();
            const today = fc.days[0] || {};
            const tomorrow = fc.days[1] || {};
            const sun = now < today.sunrise ? ['Sunrise', today.sunrise]
                : now < today.sunset ? ['Sunset', today.sunset]
                    : ['Sunrise', tomorrow.sunrise];
            const stat = (k, v) => (v ? `<div class="hf-stat"><span class="hf-stat-k">${esc(k)}</span><span class="hf-stat-v">${esc(v)}</span></div>` : '');
            $('.hf-now-stats').innerHTML = [
                stat('Feels like', cur.feels == null ? '' : deg(cur.feels)),
                stat('Humidity', cur.humidity == null ? '' : `${cur.humidity}%`),
                stat('Wind', cur.wind == null ? '' : cur.wind < 1 ? 'Calm' : `${compass(cur.windFrom)} ${cur.wind} mph`),
                stat(sun[0], isFinite(sun[1]) ? fmt.time(sun[1]) : '')
            ].join('');
        };

        // ----- the next three days -----
        // Open-Meteo's daily code is the worst hour of the day, so one stray
        // hour of drizzle at 3 AM makes a sunny day "Heavy drizzle". A day
        // shows what its daytime hours mostly are, or the wettest of them when
        // rain is likely.
        const dayCode = (d) => {
            const a = dayStart(d);
            const hrs = fc.hours.slice(a + 9, Math.min(a + 19, dayStart(d + 1)));
            if (!hrs.length) return fc.days[d].code;
            const likely = hrs.filter((h) => wet(h.code) && h.pop >= 30);
            if (likely.length) return Math.max(...likely.map((h) => h.code));
            const count = {};
            hrs.forEach((h) => { count[h.code] = (count[h.code] || 0) + 1; });
            return Number(Object.keys(count).sort((x, y) => count[y] - count[x] || y - x)[0]);
        };
        const drawDays = () => {
            const box = $('.hf-days-cols');
            box.innerHTML = fc.days.slice(1, 4).map((d, k) => {
                const { label, icon } = describe(dayCode(k + 1), true);
                const noon = d.at + 12 * 3600000;
                const rain = d.pop == null ? ''
                    : d.pop < 10 ? 'No rain'
                        : `<b>${Math.round(d.pop)}%</b> chance${inches(d.precip) ? ` · ${inches(d.precip)}` : ''}`;
                return `
                    <div class="hf-day">
                        <div class="hf-day-name">${esc(fmt.weekday(noon))}</div>
                        <div class="hf-day-date">${esc(fmt.date(noon))}</div>
                        ${stillImg(icon, 'hf-day-icon')}
                        <div class="hf-day-temps"><span class="hf-day-hi">${deg(d.hi)}</span><span class="hf-day-lo">${deg(d.lo)}</span></div>
                        <div class="hf-day-cond">${esc(label)}</div>
                        <div class="hf-day-rain">${rain}</div>
                    </div>`;
            }).join('');
            fillStills(box);
        };

        // ----- hour by hour -----
        const drawHours = () => {
            page = clamp(page, 0, lastPage());
            const i0 = hourNow();
            const a = pageStart(page);
            const hrs = fc.hours.slice(a, a + PAGE);
            const box = $('.hf-hours-cols');
            box.innerHTML = hrs.map((h, k) => {
                const i = a + k;
                const isNow = i === i0;
                // the Now column shows the current reading, same as the Now panel
                const code = isNow ? fc.current.code : h.code;
                const isDay = isNow ? fc.current.isDay : h.isDay;
                const temp = isNow ? fc.current.temp : h.temp;
                const { label, icon } = describe(code, isDay);
                const newDay = k > 0 && dayOf(i) !== dayOf(i - 1);
                const time = isNow ? 'Now' : newDay ? `${fmt.wdShort(h.at)} ${fmt.hour(h.at)}` : fmt.hour(h.at);
                const pop = h.pop == null ? null : Math.round(h.pop);
                return `
                    <div class="hf-hour${isNow ? ' now' : ''}${newDay ? ' new-day' : ''}" title="${esc(label)}">
                        <div class="hf-hour-time">${esc(time)}</div>
                        ${stillImg(icon, 'hf-hour-icon')}
                        <div class="hf-hour-temp">${deg(temp)}</div>
                        <div class="hf-hour-rain">
                            <div class="hf-bar-slot"><i style="height:${pop ? Math.max(4, pop) : 0}%"></i></div>
                            <div class="hf-hour-pop${pop ? '' : ' zero'}">${pop == null ? '–' : pop + '%'}</div>
                        </div>
                    </div>`;
            }).join('');
            fillStills(box);
            // which hours these are
            const first = hrs[0];
            const last = hrs[hrs.length - 1];
            const dayName = (i) => (dayOf(i) === 0 ? 'Today' : dayOf(i) === 1 ? 'Tomorrow' : fmt.weekday(fc.hours[i].at));
            const range = !first ? ''
                : dayOf(a) === dayOf(a + hrs.length - 1)
                    ? `${dayName(a)} · ${fmt.hour(first.at)} – ${fmt.hour(last.at)}`
                    : `${dayName(a)} ${fmt.hour(first.at)} – ${dayName(a + hrs.length - 1)} ${fmt.hour(last.at)}`;
            $('.hf-hours-range').textContent = range;
            updateLegend();
        };

        const setPage = (p) => {
            if (!fc) return;
            const next = clamp(p, 0, lastPage());
            if (next === page) return;
            page = next;
            drawHours();
        };

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            else if (status === 'ready') {
                items.push({ key: '◀', label: 'Earlier', action: 'earlier', off: page === 0 });
                items.push({ key: '▶', label: 'Later', action: 'later', off: page >= lastPage() });
                if (page > 0) items.push({ key: 'OK', label: 'Back to now', action: 'ok' });
            }
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            items.push('spacer',
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: 'Back', action: 'back' });
            $('.hf-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}${i.off ? ' class="off"' : ''}><span class="hf-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
        };

        // ----- status -----
        const setStatus = (s) => {
            status = s;
            root.classList.toggle('hf-ready', s === 'ready');
            const box = $('.hf-state');
            if (s === 'loading') box.innerHTML = '<b>Checking the forecast…</b>';
            else if (s === 'error') box.innerHTML = '<b>The forecast didn\'t load</b><span>Open-Meteo didn\'t answer. Press <em>OK</em> to try again.</span>';
            else box.innerHTML = '';
            box.classList.toggle('show', s !== 'ready');
            updateLegend();
        };

        const drawAll = () => {
            fmt = makeFormatters(fc.timeZone);
            drawTitle();
            drawNow();
            drawDays();
            drawHours();
        };

        let loadToken = 0;
        const load = async (force = false) => {
            const w = WX();
            if (!w || typeof w.forecast !== 'function') { setStatus('error'); return; }
            const token = ++loadToken;
            if (!fc) setStatus('loading');
            try {
                const next = await w.forecast({ force });
                if (!alive || token !== loadToken) return;
                if (next !== fc) {
                    fc = next;
                    drawAll();
                }
                setStatus('ready');
            } catch (err) {
                if (!alive || token !== loadToken) return;
                console.warn('[HOMER Weather]', err);
                // keep showing the last good forecast for up to an hour
                if (!fc || Date.now() - fc.fetchedAt > 60 * 60 * 1000) { fc = null; setStatus('error'); }
            }
        };
        // a fresh reading every 10 minutes while the screen is up (forced: the
        // shared one could be a few seconds short of stale and skip a round)
        const refreshTimer = setInterval(() => load(true), REFRESH_MS);
        // a new hour moves the Now column along (and the sentence and sun time with it)
        let lastHour = -1;
        const hourTimer = setInterval(() => {
            if (!fc || status !== 'ready') return;
            const h = hourNow();
            if (h === lastHour) return;
            if (lastHour >= 0) drawAll();
            lastHour = h;
        }, 15000);

        // ----- docked video -----
        const syncDocked = () => {
            root.classList.toggle('hf-docked', docked());
            updateLegend();
        };

        // ----- input -----
        const eat = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        };
        const ok = () => {
            if (status === 'error') load(true);
            else if (status === 'ready') setPage(0);
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
                if (!ev.repeat) goBack();
                return;
            }
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return; // F (full screen), G (the guide) and the rest pass through
            eat(ev);
            if (k === 'Enter' || k === ' ') { if (!ev.repeat) ok(); return; }
            if (status !== 'ready') return;
            if (k === 'ArrowRight' || k === 'PageDown') setPage(page + 1);
            else if (k === 'ArrowLeft' || k === 'PageUp') setPage(page - 1);
            else if (k === 'Home') setPage(0);
            else if (k === 'End') setPage(lastPage());
        };

        // Jellyfin's player turns the wheel into volume, and the page underneath
        // would scroll: every wheel event is ours while this screen is up. A
        // good swipe over the hours pages them.
        let wheelAcc = 0;
        let wheelAt = 0;
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (status !== 'ready' || !$('.hf-hours').contains(ev.target)) return;
            const now = Date.now();
            if (now - wheelAt < 500) return; // one page per swipe
            const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
            wheelAcc += ev.deltaMode === 1 ? d * 40 : d;
            if (Math.abs(wheelAcc) < 80) return;
            setPage(page + (wheelAcc > 0 ? 1 : -1));
            wheelAcc = 0;
            wheelAt = now;
        };

        const onClick = (ev) => {
            if (ev.target.closest('.hf-brand')) { goHome(); return; }
            const leg = ev.target.closest('.hf-legend [data-action]');
            if (!leg) return;
            const a = leg.dataset.action;
            if (a === 'home') goHome();
            else if (a === 'back') goBack();
            else if (a === 'fullscreen') fullscreen();
            else if (a === 'ok') ok();
            else if (a === 'earlier') setPage(page - 1);
            else if (a === 'later') setPage(page + 1);
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);

        syncDocked();
        setStatus('loading');
        load();

        return {
            show() { root.style.visibility = ''; },
            sync: syncDocked,
            teardown() {
                alive = false;
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                clearInterval(clockTimer);
                clearInterval(refreshTimer);
                clearInterval(hourTimer);
                wxDetach();
                root.remove();
            }
        };
    };

    // ---------- Route takeover ----------

    let screen = null;
    let suppressed = false; // closed via close(); stay out of the way until the route changes
    let destroyed = false;

    const isOurRoute = () => /^#!?\/weather(\?|$)/i.test(currentRoute());

    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };

    const sync = () => {
        if (destroyed) return;
        const ours = isOurRoute();
        if (!ours) suppressed = false;
        if (!ours || !getServer() || suppressed) {
            closeScreen();
            return;
        }
        if (screen) {
            screen.sync();
            return;
        }
        const s = createScreen();
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

    window.HomerForecast = {
        version: VERSION,
        // open(): the Weather screen (going to #/weather if needed)
        open() {
            suppressed = false;
            if (!isOurRoute()) {
                go('#/weather');
                return;
            }
            lastSig = '';
            sync();
        },
        // close(): reveal what's underneath until the route changes
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
            document.getElementById('hf-css')?.remove();
            cssReady = null;
        }
    };
})();
