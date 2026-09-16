/*
 * HOMER hubs: the screen that Sports (#/sports) and News (#/news) are both
 * made from, so a hub is configuration plus content.
 *
 *   ┌ HOMER | Sports ─────────────────────────────── weather  clock ┐
 *   │ ┌ TV window ──────┐  ┌ tabs: My Teams  MLB  NFL  …          ┐ │
 *   │ │ (the video docks │  │                                      │ │
 *   │ │  here)           │  │  the tab's content (cards, tables),  │ │
 *   │ └──────────────────┘  │  scrolling with the focus            │ │
 *   │  now watching          │                                      │ │
 *   │ ┌ channel guide ───┐  │                                      │ │
 *   │ │ now / next rows  │  │                                      │ │
 *   │ └──────────────────┘  └──────────────────────────────────────┘ │
 *   │  legend                                                        │
 *   └ ticker ───────────────────────────────────────────────────────┘
 *
 * - The TV window is a [data-homer-preview]: HomerPlayer pins the playing
 *   video over it. On open the hub tunes its default channel (by number,
 *   looked up at runtime), unless something is already playing or docked, or
 *   HomerHub.autoplay is false (tests), or it's a phone.
 * - The guide lists the hub's channels (a filter on the lineup), in groups,
 *   with what's on now (and its progress) and next. OK tunes one into the TV
 *   window; F goes full screen. Its rows follow Settings → Guide size
 *   (Standard or Large, the guide's own setting): Large draws about 40%
 *   bigger, so fewer channels fit on screen.
 * - Tabs switch the content area; each tab's render(ctx) fills it. ▲ from the
 *   top of the content goes up into the tab row, ◀▶ run along it without
 *   switching anything, OK opens a tab and ▼ comes back to where it left.
 * - The ticker (shared/ticker.js) runs along the bottom.
 * - On a phone (for a hub with phone: true): a column between HOMER's bars (the video strip on top while
 *   something plays, with ✕; the tabs, with Channels last for the guide; the
 *   content, scrolled by finger; a slimmer ticker). No default channel.
 * - Keys: arrows move (spatially, like Home), OK selects, [ ] / Page Up/Down
 *   switch tabs (1–9 too), F full screen, Esc/Backspace back, H Home. The
 *   ticker pauses while it has the focus (◀▶ step through it).
 *
 * A hub:
 *   HomerHub.define({
 *     id: 'sports', route: 'sports', title: 'Sports',
 *     css: 'sports/sports.css',              // relative to HOMER's base
 *     tv: { channel: '1300' },               // default channel number
 *     guide: { title, include(ch, info), groups: [{ key, label, test(ch, info), order? }] },
 *     tabs: [{ key, label, render(ctx) }],   // render may return a teardown fn
 *     ticker: { source(), refreshMs, mode, priorityLabel, stepLabel, okLabel },
 *     phone: true,                           // draw the phone layout on a phone
 *     onOpen(hub), onClose(hub), onBack(hub) -> true when it handled Back
 *   });
 *
 * window.HomerHub = { define, undefine, open, current, data, ui, fmt,
 *                     channels, autoplay, base, destroy, version }
 */
(() => {
    const VERSION = '0.1.0';

    if (window.HomerHub && typeof window.HomerHub.destroy === 'function') {
        window.HomerHub.destroy();
    }

    const scriptEl = document.currentScript
        || [...document.querySelectorAll('script[src*="shared/hub.js"]')].pop();
    const scriptSrc = (scriptEl && scriptEl.src) || '';
    const homerBase = typeof window.__homerLoaded === 'string' ? window.__homerLoaded.replace(/\?.*$/, '') : '';
    // HOMER's base (the folder homer.js is in)
    const BASE = scriptSrc
        ? scriptSrc.replace(/shared\/hub\.js(\?.*)?$/, '')
        : (homerBase || 'https://cdn.jsdelivr.net/gh/endlessshrimp/jellyfin-channel-guide@main/');
    const QUERY = (scriptSrc.match(/\?.*$/) || [''])[0];

    const Z = 99990;
    const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];
    const MIN = 60000;
    const PLACEHOLDER = /\(\w+\. \d\d:\d\d - \d\d:\d\d\)$/;

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
    const api = async (path) => {
        const server = getServer();
        if (!server) throw new Error('Not signed in');
        const res = await fetch(path, { headers: { Authorization: authHeader(server) } });
        if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
        const t = await res.text();
        return t ? JSON.parse(t) : null;
    };

    // ---------- HomerPlayer ----------

    const HP = () => window.HomerPlayer || null;
    const safe = (fn, fallback) => {
        try { return fn(); } catch (err) { console.warn('[HOMER Hub]', err); return fallback; }
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
    const nowPlaying = () => {
        const p = HP();
        return (p && typeof p.nowPlaying === 'function' && safe(() => p.nowPlaying(), null)) || null;
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
        else location.hash = '#/home';
    };
    const fullscreen = () => {
        const p = HP();
        if (p && typeof p.fullscreen === 'function') p.fullscreen();
    };
    const isVideoRoute = () => /^#\/video/.test(location.hash);
    const isPhone = () => !!(window.HomerLayout && window.HomerLayout.isPhone());

    // ---------- Size: the guide's Standard / Large, shared ----------
    // The channel list under the TV window follows Settings → Guide size, so a
    // hub read from the couch has the same big rows the guide does. The guide
    // owns the setting (ChannelGuide.size/setSize, localStorage per device);
    // this only reads it, and falls back to the same default if the guide
    // hasn't loaded.
    const SIZE_KEY = 'homer-guide-size';
    const sizeNow = () => {
        const cg = window.ChannelGuide;
        if (cg && typeof cg.size === 'function') {
            const v = safe(() => cg.size(), '');
            if (v === 'large' || v === 'standard') return v;
        }
        try {
            const v = localStorage.getItem(SIZE_KEY);
            if (v === 'large' || v === 'standard') return v;
        } catch { /* storage blocked: the default */ }
        return window.HOMER_TVAPP ? 'large' : 'standard';
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

    // ---------- Formatting ----------

    const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const fmt = {
        time: (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        // "Today", "Tomorrow", "Yesterday", "Wed", or "Sat, Sep 19" (a weekday within a week either way, else the date)
        day(d) {
            const days = Math.round((startOfDay(d) - startOfDay(Date.now())) / 86400000);
            if (days === 0) return 'Today';
            if (days === 1) return 'Tomorrow';
            if (days === -1) return 'Yesterday';
            if (Math.abs(days) > 1 && Math.abs(days) < 7) return new Date(d).toLocaleDateString([], { weekday: 'short' });
            return new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        },
        // "7:05 PM" today, "Tonight 7:05 PM" after 5, "Wed 7:05 PM", "Sat, Sep 19 · 2:30 PM"
        when(d, { tonight = true } = {}) {
            const t = new Date(d);
            const day = fmt.day(t);
            if (day === 'Today') return tonight && t.getHours() >= 17 ? `Tonight ${fmt.time(t)}` : fmt.time(t);
            return `${day}${day.includes(',') ? ' ·' : ''} ${fmt.time(t)}`;
        },
        // "5m ago", "3h ago", "Yesterday", "Sep 12"
        ago(d) {
            const ms = Date.now() - new Date(d).getTime();
            if (!(ms >= 0)) return '';
            if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m ago`;
            if (ms < 24 * 60 * MIN) return `${Math.round(ms / (60 * MIN))}h ago`;
            const day = fmt.day(d);
            return day === 'Yesterday' ? day : new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
        },
        left(end) {
            const mins = Math.max(0, Math.round((new Date(end) - Date.now()) / MIN));
            return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
        },
        ordinal(n) {
            const s = ['th', 'st', 'nd', 'rd'];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        }
    };

    // ---------- Data: fetch with a timeout, a cache per URL, polling with backoff ----------

    const cache = new Map(); // url -> { at, data, p }
    const fetchJSON = (url, { ttl = 60000, timeout = 12000, force = false, headers } = {}) => {
        const hit = cache.get(url);
        const now = Date.now();
        if (hit && hit.p) return hit.p; // one request at a time per URL
        if (hit && hit.data !== undefined && !force && now - hit.at < ttl) return Promise.resolve(hit.data);
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = setTimeout(() => ctl && ctl.abort(), timeout);
        const p = fetch(url, { signal: ctl ? ctl.signal : undefined, headers })
            .then((r) => {
                if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
                return r.json();
            })
            .then((data) => {
                cache.set(url, { at: Date.now(), data, p: null });
                return data;
            })
            .catch((err) => {
                const h = cache.get(url);
                if (h) h.p = null;
                throw err;
            })
            .finally(() => clearTimeout(t));
        cache.set(url, Object.assign(hit || { at: 0, data: undefined }, { p }));
        return p;
    };
    // the cached copy (any age), or undefined
    const peek = (url) => { const h = cache.get(url); return h ? h.data : undefined; };
    // fetchJSON, but an error hands back the last good copy when there is one
    const fetchSoft = (url, opts) => fetchJSON(url, opts).catch((err) => {
        const d = peek(url);
        if (d !== undefined) return d;
        throw err;
    });

    // Run fn now and then every `every` ms (a number, or a function asked each
    // time, so a hub can poll faster while games are live). An error doubles
    // the wait, up to maxBackoff; a success goes back to `every`.
    const poll = (fn, { every = 60000, maxBackoff = 10 * MIN, immediate = true } = {}) => {
        let timer = 0;
        let stopped = false;
        let fails = 0;
        const interval = () => (typeof every === 'function' ? every() : every);
        const run = async () => {
            clearTimeout(timer);
            if (stopped) return;
            try {
                await fn();
                fails = 0;
            } catch (err) {
                fails++;
                console.warn('[HOMER Hub] refresh failed:', err && err.message ? err.message : err);
            }
            if (stopped) return;
            const wait = fails ? Math.min(maxBackoff, interval() * Math.pow(2, fails)) : interval();
            timer = setTimeout(run, wait);
        };
        if (immediate) run();
        else timer = setTimeout(run, interval());
        return {
            stop() { stopped = true; clearTimeout(timer); },
            now() { return run(); }
        };
    };

    // HOMER's feed helper on the NAS: any allow-listed RSS/Atom feed as JSON
    // ({ title, link, items: [{ title, link, published, summary, image, source }] })
    const feedBase = () => (location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095');
    const feedUrl = (url) => `${feedBase()}/feed?url=${encodeURIComponent(url)}`;
    const feed = (url, opts = {}) => fetchJSON(feedUrl(url), Object.assign({ ttl: 5 * MIN, timeout: 20000 }, opts));

    const data = { fetchJSON, fetchSoft, peek, poll, feedUrl, feed, api };

    // ---------- Channels: the lineup, by number and by network name ----------

    let lineupP = null;
    let lineupAt = 0;
    const lineup = () => {
        if (!lineupP || Date.now() - lineupAt > 30 * MIN) {
            const server = getServer();
            if (!server) return Promise.resolve([]);
            lineupAt = Date.now();
            lineupP = api(`/LiveTv/Channels?userId=${server.UserId}&limit=2000&EnableImages=true&ImageTypeLimit=1&EnableUserData=false&AddCurrentProgram=false`)
                .then((r) => ((r && r.Items) || []).sort((a, b) => (parseFloat(a.Number) || 0) - (parseFloat(b.Number) || 0)));
            lineupP.catch(() => { lineupP = null; });
        }
        return lineupP;
    };
    const num = (ch) => parseFloat(ch && (ch.Number || ch.ChannelNumber)) || 0;
    const countryOf = (ch) => {
        const M = window.HomerGuideModel;
        if (M && M.countryOf) return M.countryOf(ch);
        const n = String(ch.Name || '');
        return /\((UK|IE)\)/i.test(n) ? 'uk' : /\(FR\)/i.test(n) ? 'fr' : 'us';
    };
    const infoOf = (ch) => {
        const M = window.HomerGuideModel;
        const cats = M && M.categorize ? M.categorize(ch) : new Set();
        // block: the lineup's plan by number ('news', 'sports', …; guide-model's blockOf)
        const block = M && M.blockOf ? M.blockOf(ch) : null;
        return { number: num(ch), country: countryOf(ch), cats, block, name: String(ch.Name || '') };
    };
    const logoUrl = (ch, h = 96) => (ch && ch.ImageTags && ch.ImageTags.Primary
        ? `/Items/${ch.Id}/Images/Primary?maxHeight=${h}&tag=${ch.ImageTags.Primary}&quality=90`
        : ch && ch.Id ? `/Items/${ch.Id}/Images/Primary?maxHeight=${h}` : '');

    // A TV network's name as the listings/ESPN write it -> a channel in the
    // lineup. Hubs can add their own (alias()). Local networks prefer the
    // Dallas–Fort Worth stations.
    const ALIASES = [
        [/^ESPN$/i, /^ESPN$/i],
        [/^ESPN ?2$/i, /^ESPN2$/i],
        [/^ESPNU$/i, /^ESPNU$/i],
        [/^ESPNEWS$/i, /^ESPNews$/i],
        [/^(SECN|SEC ?Network)$/i, /^SEC Network$/i],
        [/^(ACCN|ACC ?Network)$/i, /^ACC Network$/i],
        [/^(BTN|Big ?Ten( Network)?)$/i, /^Big Ten Network$/i],
        [/^(FS1|FOX Sports 1)$/i, /^FOX Sports 1$/i],
        [/^(FS2|FOX Sports 2)$/i, /^FOX Sports 2$/i],
        [/^(CBSSN|CBS Sports( Network)?)$/i, /^CBS Sports Network$/i],
        [/^(Golazo|CBS Sports Golazo)/i, /Golazo/i],
        [/^(NFL ?NET(work)?|NFLN)$/i, /^NFL Network$/i],
        [/^(RedZone|NFL RedZone)$/i, /RedZone/i],
        [/^(MLB ?N(et(work)?)?|MLBN)$/i, /^MLB Network$/i],
        [/^NBA ?TV$/i, /^NBA TV$/i],
        [/^(NHL ?N(et(work)?)?)$/i, /^NHL Network$/i],
        [/^Golf/i, /^Golf/i],
        [/^Tennis/i, /^Tennis/i],
        [/^(beIN|beIN Sports)$/i, /^beIN Sports( 1)?$/i],
        [/^GOL ?TV$/i, /^GOL TV$/i],
        [/^(ESPN Deportes|ESPND)$/i, /^ESPN Deportes$/i],
        [/^FOX Deportes$/i, /^FOX Deportes$/i],
        [/^TUDN$/i, /TUDN/i],
        [/^(USA|USA Net(work)?)$/i, /^USA Network$/i],
        [/^TNT$/i, /^TNT$/i],
        [/^TBS$/i, /^TBS$/i],
        [/^truTV$/i, /^truTV$/i],
        [/^FOX$/i, /\(KDFW\)|^FOX 4\b/i],
        [/^NBC$/i, /\(KXAS\)|^NBC 5\b/i],
        [/^ABC$/i, /\(WFAA\)|^ABC 8\b/i],
        [/^CBS$/i, /\(KTVT\)|^CBS 11\b/i],
        [/^(CW ?33|CW|The CW)$/i, /\(KDAF\)|^CW 33\b/i],
        [/^(TXA ?21)$/i, /\(KTXA\)|^TXA 21\b/i],
        [/^(Telemundo|Tele)$/i, /^Telemundo/i],
        [/^(Univision|UNIV)$/i, /^Univision/i],
        [/^(UniMás|Unimas)$/i, /^UniM[aá]s/i],
        [/^Sky Sports Premier League/i, /^Sky Sports Premier League/i],
        [/^TNT Sports/i, /^TNT Sports 1 \(UK\)/i]
    ];
    const alias = (namePattern, channelPattern) => ALIASES.unshift([namePattern, channelPattern]);
    // the first of names (e.g. ['ESPN', 'ABC']) that's in the lineup -> { ch, name }
    const forNetwork = async (names) => {
        const chans = await lineup().catch(() => []);
        for (const raw of [].concat(names || [])) {
            const name = String(raw || '').trim();
            if (!name) continue;
            for (const [np, cp] of ALIASES) {
                if (!np.test(name)) continue;
                const ch = chans.find((c) => cp.test(String(c.Name || '')));
                if (ch) return { ch, name };
            }
            const exact = chans.find((c) => String(c.Name || '').toLowerCase() === name.toLowerCase());
            if (exact) return { ch: exact, name };
        }
        return null;
    };
    // the same, synchronously, once the lineup has loaded (null before)
    let lineupCache = null;
    const forNetworkNow = (names) => {
        if (!lineupCache) return null;
        for (const raw of [].concat(names || [])) {
            const name = String(raw || '').trim();
            if (!name) continue;
            for (const [np, cp] of ALIASES) {
                if (!np.test(name)) continue;
                const ch = lineupCache.find((c) => cp.test(String(c.Name || '')));
                if (ch) return { ch, name };
            }
        }
        return null;
    };
    const byNumber = async (n) => {
        const chans = await lineup();
        return chans.find((c) => String(c.Number) === String(n)) || null;
    };
    const channels = {
        lineup: () => lineup().then((l) => { lineupCache = l; return l; }),
        byNumber,
        forNetwork,
        forNetworkNow,
        alias,
        logoUrl,
        infoOf,
        number: num
    };

    // Play a channel (a lineup item) in the current screen's preview window
    const tune = (ch, program) => {
        if (!ch) return;
        const p = HP();
        const prog = Object.assign({ Name: ch.Name, ChannelId: ch.Id }, program || {}, {
            ChannelId: ch.Id, ChannelName: ch.Name, ChannelNumber: ch.Number
        });
        if (p && typeof p.watch === 'function') p.watch(ch.Id, { program: prog });
        else if (window.HomerGuideModel) window.HomerGuideModel.playChannel(ch).catch((err) => console.error('[HOMER Hub] Playback failed:', err));
    };

    // ---------- UI pieces (TV-sized) ----------

    // an <img>; fb is a second address to try if the first one fails
    const IMG_ERR = "if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.classList.add('hb-broken')}";
    const img = (url, cls, alt = '', fb = '') => (url || fb ? `<img class="${cls}" src="${esc(url || fb)}"${fb && url ? ` data-fb="${esc(fb)}"` : ''} alt="${esc(alt)}" draggable="false" decoding="async" onerror="${IMG_ERR}">` : '');
    const ui = {
        el,
        esc,
        icon,
        img,
        // a section: a heading (and a note at its right) over a body
        section(title, { note = '', cls = '', badge = '' } = {}) {
            const s = el('section', 'hb-sec' + (cls ? ' ' + cls : ''));
            s.innerHTML = `<header class="hb-sec-head"><h2>${esc(title)}${badge ? `<span class="hb-sec-badge">${esc(badge)}</span>` : ''}</h2>${note ? `<span class="hb-sec-note">${esc(note)}</span>` : ''}</header><div class="hb-sec-body"></div>`;
            s.body = s.querySelector('.hb-sec-body');
            return s;
        },
        empty(text, sub = '') {
            return el('div', 'hb-empty', `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
        },
        // A game, normalized:
        //   { id, league, state: 'pre'|'in'|'post', status ('Final', 'Top 7th', '7:05 PM'),
        //     start (Date), network, channel ({ number, name, ch }), note, priority,
        //     homeFirst (soccer: the home side on top), short (a shorter status),
        //     away / home: { abbr, name, short, logo, logoFb, score, rank, record, winner, color } }
        scoreCard(g, { ok, big = false, league = '' } = {}) {
            const card = el('div', 'hb-score hb-focusable' + (big ? ' big' : '') + (g.state === 'in' ? ' live' : '') + (g.priority ? ' fav' : ''));
            const pre = g.state === 'pre';
            const row = (t, other) => {
                const lose = g.state === 'post' && other.winner && !t.winner;
                return `<div class="hb-score-team${lose ? ' lose' : ''}${t.winner ? ' win' : ''}" style="--team:${t.color ? '#' + String(t.color).replace('#', '') : 'transparent'}">
                    <span class="hb-score-logo">${img(t.logo, '', t.abbr, t.logoFb)}</span>
                    ${t.rank && t.rank <= 25 ? `<span class="hb-score-rank">${t.rank}</span>` : ''}
                    <span class="hb-score-name">${esc(t.short || t.name || t.abbr || '')}</span>
                    ${t.record ? `<span class="hb-score-rec">${esc(t.record)}</span>` : ''}
                    <span class="hb-score-pts">${pre ? '' : esc(t.score ?? '')}</span>
                </div>`;
            };
            const a = g.away || {};
            const h = g.home || {};
            const net = g.channel
                ? `<span class="hb-score-ch" title="Channel ${esc(g.channel.number)}">${icon('live_tv')}<b>${esc(g.channel.number)}</b><span>${esc(g.network || g.channel.name)}</span></span>`
                : g.network ? `<span class="hb-score-net">${esc(g.network)}</span>` : '';
            card.innerHTML = `
                <div class="hb-score-top">
                    <span class="hb-score-status ${esc(g.state || '')}">${g.state === 'in' ? '<i></i>' : ''}${esc(g.status || '')}</span>
                    ${league ? `<span class="hb-score-league">${esc(league)}</span>` : ''}
                    ${net}
                </div>
                ${g.homeFirst ? row(h, a) + row(a, h) : row(a, h) + row(h, a)}
                ${g.note ? `<div class="hb-score-note">${esc(g.note)}</div>` : ''}`;
            if (g.channel) card.dataset.okLabel = `Watch ${g.channel.name || ''}`.trim();
            if (ok) card._hbOk = ok;
            return card;
        },
        // an article: a picture over its headline, where it's from and when
        imageCard(a, { ok, wide = false } = {}) {
            const card = el('div', 'hb-story hb-focusable' + (wide ? ' wide' : '') + (a.image ? '' : ' noimg'));
            card.innerHTML = `
                <div class="hb-story-pic">${img(a.image, '')}${a.tag ? `<span class="hb-story-tag">${esc(a.tag)}</span>` : ''}</div>
                <div class="hb-story-text">
                    <div class="hb-story-title">${esc(a.title || '')}</div>
                    ${a.summary && wide ? `<div class="hb-story-sum">${esc(a.summary)}</div>` : ''}
                    <div class="hb-story-meta">${esc([a.source, a.published ? fmt.ago(a.published) : ''].filter(Boolean).join(' · '))}</div>
                </div>`;
            if (ok) card._hbOk = ok;
            return card;
        },
        // A table: columns [{ key, label, align ('l'|'r'|'c'), width, fmt(row) }],
        // rows [{ … }], highlight(row) -> true for the rows to pick out. A
        // column with logo: true draws row.logo before the value.
        table({ columns, rows, highlight, title = '', note = '', focusable = true, ok, dense = false }) {
            const t = el('div', 'hb-table' + (dense ? ' dense' : '') + (focusable ? ' hb-focusable' : ''));
            const cols = columns.map((c) => c.width || (c.logo ? 'minmax(0,1fr)' : 'auto')).join(' ');
            const cell = (c, r) => {
                const v = c.fmt ? c.fmt(r) : r[c.key];
                const inner = c.logo ? `<span class="hb-td-logo">${img(r.logo, '', '', r.logoFb)}</span><span class="hb-td-text">${esc(v ?? '')}</span>` : esc(v ?? '');
                return `<div class="hb-td ${c.align || 'l'}${c.logo ? ' team' : ''}${c.strong ? ' strong' : ''}">${inner}</div>`;
            };
            t.innerHTML = `
                ${title ? `<div class="hb-table-title"><span>${esc(title)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>` : ''}
                <div class="hb-table-grid" style="grid-template-columns:${cols}">
                    ${columns.map((c) => `<div class="hb-th ${c.align || 'l'}">${esc(c.label || '')}</div>`).join('')}
                    ${rows.map((r) => {
                        const hi = highlight && highlight(r);
                        return `<div class="hb-tr${hi ? ' hi' : ''}${r.cut ? ' cut' : ''}" style="${r.color ? `--row:${esc(r.color)}` : ''}">${columns.map((c) => cell(c, r)).join('')}</div>`;
                    }).join('')}
                </div>`;
            if (ok) t._hbOk = ok;
            return t;
        },
        // a row of cards that scrolls sideways with the focus
        rail(cls = '') {
            const r = el('div', 'hb-rail' + (cls ? ' ' + cls : ''));
            r.dataset.hbScrollX = '';
            return r;
        }
    };

    // ---------- Stylesheets ----------

    let cssReady = null;
    const link = (id, href) => {
        const had = document.getElementById(id);
        if (had && had.getAttribute('href') === href) return Promise.resolve();
        had?.remove();
        const l = document.createElement('link');
        l.id = id;
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
        return new Promise((resolve) => {
            l.onload = l.onerror = resolve;
            setTimeout(resolve, 2000);
        });
    };
    const ensureCss = (def) => {
        if (!document.getElementById('homer-tokens')) link('homer-tokens', BASE + 'shared/tokens.css' + QUERY);
        if (!document.getElementById('homer-shell')) link('homer-shell', BASE + 'shared/shell.css' + QUERY);
        if (!cssReady || !document.getElementById('hb-css')) cssReady = link('hb-css', BASE + 'shared/hub.css' + QUERY);
        const own = [].concat(def.css || []).map((file, k) => link(`hb-css-${def.id}-${k}`, BASE + file + QUERY));
        return Promise.all([cssReady, ...own]);
    };

    // ---------- A hub's screen ----------

    const createScreen = (def) => {
        // On a phone (shared/layout.js) the same screen is a column between
        // HOMER's bars: the video strip on top while something plays, the tabs
        // (plus Channels, the guide), the tab's content scrolling, the ticker.
        // (a hub opts in with phone: true; without it a phone gets the TV
        // layout, shrunk between the bars)
        const phone = isPhone() && !!def.phone;
        const root = el('div', `homer-screen hb-root hb-${def.id}${phone ? ' hb-phone' : ''}`);
        root.id = `hb-${def.id}-root`;
        root.style.visibility = 'hidden'; // until the stylesheets are in
        root.style.zIndex = Z;
        const stage = el('div', 'hb-stage');
        root.appendChild(stage);
        stage.innerHTML = `
            <div class="hb-topbar">
                <div class="hb-brand homer-home" role="button" title="Home (H)"><span class="hb-brand-mark">${icon('home')}</span>HOMER<span class="hb-brand-sub">${esc(def.title || def.id)}</span></div>
                <div class="hb-top-mid"></div>
                <div class="hb-clock"><div class="hb-clock-time"></div><div class="hb-clock-date"></div></div>
            </div>
            <div class="hb-left">
                <div class="hb-tv hb-focusable" data-homer-preview data-ok-label="Full screen">
                    <div class="hb-tv-idle"><div class="hb-tv-logo"></div><div class="hb-tv-msg"></div></div>
                </div>
                <div class="hb-now"></div>
                <div class="hb-guide">
                    <div class="hb-guide-head"><span>${esc((def.guide && def.guide.title) || 'Channels')}</span><small></small></div>
                    <div class="hb-guide-list" data-hb-scroll data-hb-memory></div>
                </div>
            </div>
            <div class="hb-main">
                <div class="hb-tabs" data-hb-memory data-hb-scroll-x></div>
                <div class="hb-panel" data-hb-scroll><div class="hb-panel-in"></div></div>
            </div>
            <div class="hb-legend"></div>
            <div class="hb-ticker hb-focusable"></div>`;
        document.body.appendChild(root);
        const $ = (s) => stage.querySelector(s);

        // Standard or Large channel rows (Settings → Guide size). Checked
        // again when Settings changes it and on the screen's own tick, so an
        // open hub follows along like the guide does.
        let sizeIs = '';
        const applySize = () => {
            const want = sizeNow();
            if (want === sizeIs) return;
            sizeIs = want;
            root.classList.toggle('hb-large', want === 'large');
            if (focused) reveal(focused);
        };

        let alive = true;
        const cleanups = [];
        const hubPolls = [];

        // ----- fit: 1080 tall, as wide as the window allows (min 1600) -----
        const fit = () => {
            if (phone) { stage.style.width = ''; stage.style.transform = ''; return; }
            const box = window.HomerLayout ? window.HomerLayout.stageBox() : { width: window.innerWidth, height: window.innerHeight };
            let s = box.height / 1080;
            let w = box.width / s;
            if (w < 1600) { s = box.width / 1600; w = 1600; }
            stage.style.width = w + 'px';
            stage.style.transform = `translate(-50%, -50%) scale(${s})`;
        };
        fit();

        // ----- clock and weather -----
        const tickClock = () => {
            const d = new Date();
            $('.hb-clock-time').textContent = fmt.time(d);
            $('.hb-clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        };
        tickClock();
        const clockTimer = setInterval(tickClock, 1000);
        const wxDetach = window.HomerWeather ? safe(() => window.HomerWeather.attach($('.hb-clock')), () => {}) : () => {};

        const ae = document.activeElement;
        if (ae && ae !== document.body && !root.contains(ae) && typeof ae.blur === 'function') ae.blur();

        // ----- focus (spatial, like Home) -----
        let focused = null;
        let tabReturn = null; // where the focus was before it went up into the tabs
        const memory = new Map(); // a [data-hb-memory] container -> its last focused item
        const scroller = (n) => n && n.parentElement && n.parentElement.closest('[data-hb-scroll]');
        const scrollerX = (n) => n && n.parentElement && n.parentElement.closest('[data-hb-scroll-x]');
        const memoryBox = (n) => n && n.closest('[data-hb-memory]');
        const visibleIn = (n, box) => {
            if (!box) return true;
            const a = n.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            return a.bottom > b.top + 4 && a.top < b.bottom - 4 && a.right > b.left + 4 && a.left < b.right - 4;
        };
        // bring the focused item into view in its scrolling box(es)
        const reveal = (n) => {
            const box = scroller(n);
            if (box) {
                const a = n.getBoundingClientRect();
                const b = box.getBoundingClientRect();
                const k = box.offsetHeight ? b.height / box.offsetHeight : 1; // the stage's scale
                const pad = 24 * k;
                if (a.top < b.top + pad) box.scrollTop -= (b.top + pad - a.top) / k;
                else if (a.bottom > b.bottom - pad) box.scrollTop += Math.min(a.top - b.top - pad, a.bottom - b.bottom + pad) / k;
                // at the top of the panel, show its first heading too
                if (box.scrollTop < 90 && n.getBoundingClientRect().top - b.top < 200 * k) box.scrollTop = 0;
            }
            const row = scrollerX(n);
            if (row) {
                const a = n.getBoundingClientRect();
                const b = row.getBoundingClientRect();
                const k = row.offsetWidth ? b.width / row.offsetWidth : 1;
                if (a.left < b.left) row.scrollLeft -= (b.left - a.left) / k + 8;
                else if (a.right > b.right) row.scrollLeft += (a.right - b.right) / k + 8;
            }
        };
        // hover: the mouse put it there, so nothing acts on it (a click does)
        const setFocus = (n, { scroll = true, hover = false } = {}) => {
            if (!n || !stage.contains(n)) return;
            if (focused === n) return;
            const was = focused;
            if (was) {
                was.classList.remove('hb-focus');
                if (was._hbBlur) was._hbBlur();
            }
            focused = n;
            n.classList.add('hb-focus');
            // the tab row is a zone of its own: coming up into it remembers
            // where from, so ▼ goes back to the very thing it left
            if (n.closest('.hb-tabs')) { if (was && !was.closest('.hb-tabs')) tabReturn = was; }
            else tabReturn = null;
            if (panel.contains(n)) lastKey = n.dataset.key || null;
            const mb = memoryBox(n);
            if (mb) memory.set(mb, n);
            if (scroll) reveal(n);
            if (n._hbFocus && !hover) n._hbFocus();
            updateLegend();
        };
        const candidates = () => [...stage.querySelectorAll('.hb-focusable')].filter((n) => {
            if (n.offsetParent === null || n.closest('[hidden]')) return false;
            if (n === focused) return true;
            const box = scroller(n);
            const row = scrollerX(n);
            // in another scrolling box: only what's showing in it
            if (box && box !== scroller(focused) && !visibleIn(n, box)) return false;
            if (row && row !== scrollerX(focused) && !visibleIn(n, row)) return false;
            return true;
        });
        const move = (dir) => {
            const all = candidates();
            if (!focused || !all.includes(focused)) { setFocus(all.find((n) => n.closest('.hb-tabs')) || all[0]); return; }
            // the item's own keys first (the ticker's ◀▶)
            if (focused._hbKey && focused._hbKey(dir)) return;
            const a = focused.getBoundingClientRect();
            const ax = a.left + a.width / 2;
            const ay = a.top + a.height / 2;
            let best = null;
            let bestScore = Infinity;
            for (const n of all) {
                if (n === focused) continue;
                const b = n.getBoundingClientRect();
                const horiz = dir === 'left' || dir === 'right';
                // edges, not centers, for the main direction (wide items next to narrow ones)
                const gap = dir === 'left' ? a.left - b.right : dir === 'right' ? b.left - a.right : dir === 'up' ? a.top - b.bottom : b.top - a.bottom;
                if (gap < -Math.min(a[horiz ? 'width' : 'height'], b[horiz ? 'width' : 'height']) * 0.5) continue;
                const bx = b.left + b.width / 2;
                const by = b.top + b.height / 2;
                const center = horiz ? by - ay : bx - ax;
                // how much they overlap across the direction of travel
                const overlap = horiz ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const cross = overlap > 0 ? 0 : Math.abs(center);
                const score = Math.max(0, gap) + cross * 2.5 + (overlap > 0 ? 0 : 40);
                if (score < bestScore) { bestScore = score; best = n; }
            }
            if (!best) return;
            // entering a box that remembers (the guide, the tabs): where you were in it
            const mb = memoryBox(best);
            if (mb && mb !== memoryBox(focused)) {
                const m = memory.get(mb);
                if (m && stage.contains(m) && all.includes(m)) best = m;
            }
            setFocus(best);
        };
        const ok = () => {
            if (!focused) return;
            if (focused._hbOk) focused._hbOk(focused);
        };

        // ----- the TV window -----
        let tuning = null; // { ch, at }
        const tvEl = $('.hb-tv');
        const nowEl = $('.hb-now');
        const playingChannelId = () => {
            const np = nowPlaying();
            if (np && np.program) return np.program.ChannelId || null;
            return null;
        };
        const paintTv = () => {
            const d = docked();
            root.classList.toggle('hb-docked', d);
            const np = nowPlaying();
            const idleLogo = $('.hb-tv-logo');
            const msg = $('.hb-tv-msg');
            const ch = tuning && tuning.ch;
            // Under the video (it's pinned over this once it starts): what's
            // coming while it tunes, or what OK would watch.
            const playing = d && np && np.program && np.program.ChannelId ? { Id: np.program.ChannelId, Name: np.program.ChannelName || '' } : null;
            const show = playing || ch || (d ? null : defaultCh);
            const url = show ? logoUrl(show, 160) : '';
            if (idleLogo.dataset.src !== url) {
                idleLogo.dataset.src = url;
                idleLogo.innerHTML = url ? `<img src="${esc(url)}" alt="" draggable="false">` : '';
                const i = idleLogo.querySelector('img');
                if (i && window.HomerLogos) window.HomerLogos.watch(i, idleLogo);
            }
            msg.textContent = d ? (show ? `Tuning ${show.Name}…` : 'Loading…') : ch ? `Tuning ${ch.Name}…` : show ? `OK to watch ${show.Name}` : '';
            // under it: what's on
            let html = '';
            if (np && np.program && d) {
                const p = np.program;
                const s = Date.parse(p.StartDate);
                const e = Date.parse(p.EndDate);
                const pct = e > s ? Math.max(0, Math.min(100, ((Date.now() - s) / (e - s)) * 100)) : 0;
                html = `<span class="hb-now-live">Live</span><b>${esc(p.ChannelNumber || '')}</b><span class="hb-now-ch">${esc(p.ChannelName || '')}</span><span class="hb-now-title">${esc(p.Name || '')}</span>${e ? `<span class="hb-now-left">${esc(fmt.left(e))}</span><span class="hb-now-bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}`;
            } else if (np && np.item && d) {
                const it = np.item;
                html = `<span class="hb-now-live vod">Playing</span><span class="hb-now-title">${esc(it.SeriesName ? `${it.SeriesName} · ${it.Name}` : it.Name || '')}</span>`;
            } else if (ch) {
                html = `<span class="hb-now-live dim">Tuning</span><b>${esc(ch.Number)}</b><span class="hb-now-ch">${esc(ch.Name)}</span>`;
            } else {
                html = '<span class="hb-now-hint">Pick a channel below and press OK to watch it here</span>';
            }
            if (phone && d) html += `<button type="button" class="hb-now-stop" aria-label="Stop">${icon('close')}</button>`;
            if (nowEl.innerHTML !== html) nowEl.innerHTML = html;
            tvEl.dataset.okLabel = d ? 'Full screen' : ch ? 'Full screen' : defaultCh ? `Watch ${defaultCh.Name}` : 'Watch';
        };
        tvEl._hbOk = () => {
            if (docked()) fullscreen();
            else if (tuning) fullscreen(); // goes full screen once it has tuned
            else if (defaultCh) watch(defaultCh);
        };

        const watch = (ch, program) => {
            if (!ch) return;
            tuning = { ch, at: Date.now() };
            tune(ch, program || guide.nowFor(ch.Id));
            paintTv();
            guide.paintWatching();
        };

        // ----- the channel guide -----
        let defaultCh = null;
        const guide = (() => {
            const list = $('.hb-guide-list');
            let rows = []; // [{ ch, info, group, el }]
            const progs = new Map(); // channel id -> sorted programs
            let loadedAt = 0;
            const g = def.guide || {};
            const groupOf = (ch, info) => {
                for (const gr of g.groups || []) {
                    if (safe(() => gr.test(ch, info), false)) return gr;
                }
                return { key: 'other', label: 'More' };
            };
            const nowFor = (id) => {
                const t = Date.now();
                return (progs.get(id) || []).find((p) => p._s <= t && p._e > t) || null;
            };
            const nextFor = (id) => {
                const t = Date.now();
                return (progs.get(id) || []).find((p) => p._s > t) || null;
            };
            const rowHtml = (r) => {
                const now = nowFor(r.ch.Id);
                const next = nextFor(r.ch.Id);
                const pct = now ? Math.max(0, Math.min(100, ((Date.now() - now._s) / (now._e - now._s)) * 100)) : 0;
                const title = now ? now.Name : loadedAt ? 'No listing' : '';
                const live = now && (now.IsLive || /\blive\b/i.test(now.EpisodeTitle || ''));
                return `
                    <span class="hb-row-num">${esc(r.ch.Number)}</span>
                    <span class="hb-row-text">
                        <span class="hb-row-title">${live ? '<span class="hb-row-live">LIVE</span>' : ''}${esc(title)}</span>
                        <span class="hb-row-next">${next ? `<b>${esc(fmt.time(next._s))}</b> ${esc(next.Name)}` : esc(r.ch.Name)}</span>
                    </span>
                    <span class="hb-row-bar"><i style="width:${pct.toFixed(1)}%"></i></span>`;
            };
            const paintRow = (r) => {
                const body = r.el.querySelector('.hb-row-body');
                const html = rowHtml(r);
                if (body.innerHTML !== html) body.innerHTML = html;
            };
            const paintWatching = () => {
                const id = (docked() && playingChannelId()) || (tuning && tuning.ch.Id);
                rows.forEach((r) => r.el.classList.toggle('watching', r.ch.Id === id));
            };
            const build = () => {
                list.innerHTML = '';
                let last = null;
                for (const r of rows) {
                    if (r.group.key !== last) {
                        last = r.group.key;
                        list.appendChild(el('div', 'hb-guide-group', esc(r.group.label)));
                    }
                    const row = el('div', 'hb-row hb-focusable', `
                        <span class="hb-row-logo"></span>
                        <span class="hb-row-body"></span>
                        <span class="hb-row-eye">${icon('volume_up')}</span>`);
                    row.dataset.okLabel = `Watch ${r.ch.Name}`;
                    const chip = row.querySelector('.hb-row-logo');
                    const i = new Image();
                    i.alt = '';
                    i.draggable = false;
                    i.loading = 'lazy';
                    i.src = logoUrl(r.ch, 80);
                    i.onerror = () => { chip.innerHTML = `<span class="hb-logo-fallback">${esc(r.ch.Name)}</span>`; };
                    chip.appendChild(i);
                    if (window.HomerLogos) window.HomerLogos.watch(i, chip);
                    row._hbOk = () => watch(r.ch);
                    row._hbF = () => { watch(r.ch); fullscreen(); };
                    r.el = row;
                    paintRow(r);
                    list.appendChild(row);
                }
                $('.hb-guide-head small').textContent = rows.length ? `${rows.length} channels` : '';
                paintWatching();
            };
            const loadPrograms = async () => {
                const server = getServer();
                if (!server || !rows.length) return;
                const now = Date.now();
                const ids = rows.map((r) => r.ch.Id);
                const out = new Map();
                // in batches, so the address stays a sensible length
                for (let k = 0; k < ids.length; k += 60) {
                    const batch = ids.slice(k, k + 60).join(',');
                    const res = await api(`/LiveTv/Programs?UserId=${server.UserId}&ChannelIds=${batch}&MinEndDate=${new Date(now).toISOString()}&MaxStartDate=${new Date(now + 5 * 60 * MIN).toISOString()}&SortBy=StartDate&EnableImages=false&EnableUserData=false&Fields=ChannelInfo&limit=3000`);
                    for (const p of (res && res.Items) || []) {
                        if (PLACEHOLDER.test(p.Name || '')) continue;
                        p._s = Date.parse(p.StartDate);
                        p._e = Date.parse(p.EndDate);
                        if (!out.has(p.ChannelId)) out.set(p.ChannelId, []);
                        out.get(p.ChannelId).push(p);
                    }
                }
                for (const l of out.values()) l.sort((a, b) => a._s - b._s);
                progs.clear();
                out.forEach((v, k) => progs.set(k, v));
                loadedAt = Date.now();
                rows.forEach(paintRow);
            };
            const load = async () => {
                const chans = await channels.lineup();
                const inc = g.include || (() => true);
                const picked = [];
                for (const ch of chans) {
                    const info = infoOf(ch);
                    if (!safe(() => inc(ch, info), false)) continue;
                    picked.push({ ch, info, group: groupOf(ch, info) });
                }
                // shown in the groups' order (or their own `order`, when the
                // tests have to run in a different one)
                const gs = g.groups || [];
                const rank = (r) => {
                    const k = gs.findIndex((x) => x.key === r.group.key);
                    return k < 0 ? 999 : gs[k].order != null ? gs[k].order : k;
                };
                picked.sort((a, b) => rank(a) - rank(b) || a.info.number - b.info.number);
                rows = picked;
                if (def.tv && def.tv.channel) defaultCh = chans.find((c) => String(c.Number) === String(def.tv.channel)) || null;
                build();
                paintTv();
                await loadPrograms();
            };
            // progress bars every 30s; programs again when one ends (or every 10 min)
            const tick = () => {
                const t = Date.now();
                // a channel whose listings have run out from under it (its first
                // program is over and nothing's on): time for fresh ones
                const ended = [...progs.values()].some((l) => l.length && l[0]._e < t && !l.some((p) => p._s <= t && p._e > t));
                if (loadedAt && (t - loadedAt > 10 * MIN || ended) && t - loadedAt > MIN) loadPrograms().catch(() => {});
                else rows.forEach(paintRow);
                paintWatching();
            };
            return { load, tick, nowFor, paintWatching, rows: () => rows, loadPrograms };
        })();

        // ----- tabs -----
        const tabsEl = $('.hb-tabs');
        const panel = $('.hb-panel');
        const panelIn = $('.hb-panel-in');
        const guideBox = $('.hb-guide');
        // on a phone the guide is a tab of its own, at the end
        const tabs = (def.tabs || []).concat(phone && def.guide !== false ? [{
            key: '__channels',
            label: 'Channels',
            render(ctx) {
                ctx.panel.appendChild(guideBox);
                return () => $('.hb-left').appendChild(guideBox);
            }
        }] : []);
        let tabIndex = -1;
        let tabCleanup = [];
        // the tab row remembers the tab you're on, so coming back up into it
        // lands there and not on whichever tab the focus wandered past
        const rememberTab = () => { if (tabEls[tabIndex]) memory.set(tabsEl, tabEls[tabIndex]); };
        const tabEls = tabs.map((t, k) => {
            const b = el('div', 'hb-tab hb-focusable', `${t.icon ? icon(t.icon) : ''}<span>${esc(t.label)}</span>`);
            b.dataset.okLabel = 'Open';
            b._hbOk = () => {
                showTab(k);
                // OK on a tab: into its content
                const first = candidates().find((n) => panel.contains(n));
                if (first) setFocus(first);
            };
            // Moving along the row doesn't switch anything — OK does — so ▼
            // can drop back out to the row and column the focus came up from.
            // (Without that, a remote could only look at the tabs by changing
            // them, and there'd be nothing to come back to.)
            b._hbKey = (dir) => {
                if (dir !== 'down') return false;
                if (!tabReturn || !stage.contains(tabReturn) || tabReturn.closest('.hb-tabs')) return false;
                rememberTab();
                setFocus(tabReturn);
                return true;
            };
            tabsEl.appendChild(b);
            return b;
        });
        const makeCtx = (k) => {
            const own = [];
            tabCleanup = own;
            const ctx = {
                hub: api_,
                tab: tabs[k],
                panel: panelIn,
                ui,
                fmt,
                data,
                channels,
                alive: () => alive && tabIndex === k,
                // a poll that stops when the tab goes
                poll(fn, opts) { const p = poll(fn, opts); own.push(() => p.stop()); return p; },
                onCleanup(fn) { own.push(fn); },
                focusable(n, okFn, label) {
                    n.classList.add('hb-focusable');
                    if (okFn) n._hbOk = okFn;
                    if (label) n.dataset.okLabel = label;
                    return n;
                },
                watch,
                tune: (numberOrCh) => (typeof numberOrCh === 'object' ? Promise.resolve(numberOrCh) : byNumber(numberOrCh)).then((ch) => ch && watch(ch)),
                focus: (n) => setFocus(n),
                // after redrawing: keep the focus (by data-key) or put it back on the tab
                refocus() {
                    if (focused && stage.contains(focused)) return;
                    const key = lastKey;
                    const same = key && panelIn.querySelector(`[data-key="${CSS.escape(key)}"]`);
                    if (same) setFocus(same, { scroll: false });
                    else setFocus(tabEls[tabIndex], { scroll: false });
                },
                toast
            };
            return ctx;
        };
        let lastKey = null;
        const showTab = (k, { force = false } = {}) => {
            if (k === tabIndex && !force) return;
            tabCleanup.forEach((fn) => safe(fn));
            tabCleanup = [];
            tabIndex = k;
            tabEls.forEach((b, i) => b.classList.toggle('on', i === k));
            rememberTab();
            if (tabs[k]) lastTabs.set(def.id, tabs[k].key);
            panelIn.innerHTML = '';
            panel.scrollTop = 0;
            const t = tabs[k];
            if (!t) return;
            const ctx = makeCtx(k);
            try {
                const r = t.render(ctx);
                if (typeof r === 'function') tabCleanup.push(r);
                else if (r && typeof r.then === 'function') r.then((fn) => { if (typeof fn === 'function') tabCleanup.push(fn); }).catch((err) => console.error('[HOMER Hub]', err));
            } catch (err) {
                console.error('[HOMER Hub] tab failed:', err);
                panelIn.appendChild(ui.empty('This didn\'t load', String(err && err.message || err)));
            }
            updateLegend();
        };

        // ----- ticker (made once the hub's API below exists) -----
        const tickerEl = $('.hb-ticker');
        let ticker = null;

        // ----- toast -----
        let toastTimer = 0;
        const toastEl = el('div', 'hb-toast');
        stage.appendChild(toastEl);
        function toast(text) {
            toastEl.textContent = text;
            toastEl.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
        }

        // ----- legend -----
        function updateLegend() {
            const items = [{ key: '▲▼◀▶', label: 'Move' }];
            const okLabel = focused && focused.dataset.okLabel;
            if (focused === tickerEl && ticker) {
                const tk = def.ticker || {};
                items.push({ key: '◀▶', label: tk.stepLabel || 'More' });
                if (ticker.actionable()) items.push({ key: 'OK', label: tk.okLabel || 'Watch', action: 'ok' });
            } else if (okLabel) items.push({ key: 'OK', label: okLabel, action: 'ok' });
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            if (tabs.length > 1) items.push({ key: '[ ]', label: 'Sections', action: 'nexttab' });
            items.push('spacer',
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: 'Back', action: 'back' });
            const html = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span${i.action ? ` data-action="${i.action}"` : ''}><span class="hb-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
            const lg = $('.hb-legend');
            if (lg.innerHTML !== html) lg.innerHTML = html;
        }

        // ----- input -----
        const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        const onKey = (ev) => {
            if (!alive || document.getElementById('cg-root')) return; // the guide is on top
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (isTyping(ev.target) && !root.contains(ev.target)) return;
            const k = ev.key;
            if (k === 'h' || k === 'H') { eat(ev); if (!ev.repeat) goHome(); return; }
            if (BACK_KEYS.includes(k)) {
                eat(ev);
                if (ev.repeat) return;
                // the focused thing, then the hub, can take Back (an overlay of its own closing)
                if (focused && focused._hbBack && safe(() => focused._hbBack(), false)) return;
                if (def.onBack && safe(() => def.onBack(api_), false)) return;
                goBack();
                return;
            }
            const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
            if (dirs[k]) { eat(ev); move(dirs[k]); return; }
            if (k === 'Enter' || k === ' ') { eat(ev); if (!ev.repeat) ok(); return; }
            if (k === '[' || k === 'PageUp') { eat(ev); if (tabs.length) focusTab(tabIndex - 1); return; }
            if (k === ']' || k === 'PageDown') { eat(ev); if (tabs.length) focusTab(tabIndex + 1); return; }
            if (/^[1-9]$/.test(k) && tabs[+k - 1]) { eat(ev); focusTab(+k - 1); return; }
            if ((k === 'f' || k === 'F') && !docked()) {
                // not playing yet: F on a channel tunes it full screen
                eat(ev);
                if (focused && focused._hbF) focused._hbF();
                else if (tuning) fullscreen();
                return;
            }
            // G (the guide), L and the rest pass through
        };
        const focusTab = (k) => {
            const n = (k + tabs.length) % tabs.length;
            showTab(n);
            setFocus(tabEls[n]);
        };
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            if (phone) { if (root.contains(ev.target)) ev.stopImmediatePropagation(); return; } // native scrolling
            // scroll the box under the pointer ourselves; nothing reaches the page underneath
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const box = ev.target.closest && ev.target.closest('[data-hb-scroll]');
            if (box && stage.contains(box)) box.scrollTop += ev.deltaY;
            const row = ev.target.closest && ev.target.closest('[data-hb-scroll-x]');
            if (row && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) row.scrollLeft += ev.deltaX;
        };
        const onClick = (ev) => {
            if (ev.target.closest('.hb-brand')) { goHome(); return; }
            if (ev.target.closest('.hb-now-stop')) { const p = HP(); if (p && p.stop) p.stop(); return; }
            const leg = ev.target.closest('.hb-legend [data-action]');
            if (leg) {
                const a = leg.dataset.action;
                if (a === 'home') goHome();
                else if (a === 'back') goBack();
                else if (a === 'fullscreen') fullscreen();
                else if (a === 'ok') ok();
                else if (a === 'nexttab') focusTab(tabIndex + 1);
                return;
            }
            const f = ev.target.closest('.hb-focusable');
            if (f && stage.contains(f) && f !== tvEl) {
                setFocus(f, { scroll: false });
                ok();
            }
        };
        const onMouse = (ev) => {
            if (phone) return;
            const f = ev.target.closest && ev.target.closest('.hb-focusable');
            if (f && stage.contains(f) && f !== focused && f !== tickerEl) setFocus(f, { scroll: false, hover: true });
        };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('wheel', onWheel, { capture: true, passive: false });
        window.addEventListener('resize', fit);
        stage.addEventListener('click', onClick);
        stage.addEventListener('mousemove', onMouse);

        // ----- the hub's own API (tabs and the ticker source get it) -----
        const api_ = {
            def,
            root,
            stage,
            ui,
            fmt,
            data,
            channels,
            watch,
            tune: (n) => byNumber(n).then((ch) => ch && watch(ch)),
            toast,
            poll(fn, opts) { const p = poll(fn, opts); hubPolls.push(p); return p; },
            showTab: (keyOrIndex) => {
                const k = typeof keyOrIndex === 'number' ? keyOrIndex : tabs.findIndex((t) => t.key === keyOrIndex);
                if (k >= 0) focusTab(k);
            },
            currentTab: () => tabs[tabIndex] && tabs[tabIndex].key,
            focus: (n) => setFocus(n),
            refreshTab: () => showTab(tabIndex, { force: true }),
            ticker: () => ticker,
            alive: () => alive
        };

        // ----- ticker -----
        if (def.ticker && window.HomerTicker) {
            ticker = window.HomerTicker.create(tickerEl, Object.assign({}, def.ticker, {
                source: def.ticker.source ? () => def.ticker.source(api_) : null
            }));
            tickerEl._hbFocus = () => ticker.pause();
            tickerEl._hbBlur = () => ticker.resume();
            tickerEl._hbKey = (dir) => {
                if (dir === 'left' || dir === 'right') {
                    ticker.step(dir === 'right' ? 1 : -1);
                    updateLegend();
                    return true;
                }
                return false;
            };
            tickerEl._hbOk = () => { if (!ticker.ok()) ticker.step(1); };
        } else {
            tickerEl.remove();
            root.classList.add('hb-no-ticker');
        }

        // ----- the Actions strip (shared/actions.js) -----
        // What the hub's own keys do, for a remote that hasn't got them. Both
        // hubs get it from here, under their own name.
        const tabLabel = (k) => (tabs.length ? tabs[(k + tabs.length) % tabs.length].label : '');
        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            if (tabs.length > 1) {
                out.push(
                    { id: 'nexttab', key: ']', icon: 'chevron_right', label: 'Next section', sub: tabLabel(tabIndex + 1), run: () => focusTab(tabIndex + 1) },
                    { id: 'prevtab', key: '[', icon: 'chevron_left', label: 'Previous section', sub: tabLabel(tabIndex - 1), run: () => focusTab(tabIndex - 1) }
                );
            }
            if (docked()) out.push({ id: 'fullscreen', key: 'F', icon: 'fullscreen', label: 'Full screen', run: fullscreen });
            return out;
        }, { id: def.id, title: def.title || def.id }) : () => {};

        // ----- open -----
        const minuteTimer = setInterval(() => { guide.tick(); paintTv(); applySize(); }, 30000);
        const onSizeChange = () => applySize();
        window.addEventListener('homer-guide-size', onSizeChange);
        guide.load().catch((err) => {
            console.warn('[HOMER Hub] channels:', err);
            $('.hb-guide-list').appendChild(ui.empty('Channels didn\'t load'));
        }).then(() => { if (alive) autoTune(); });

        // tune the default channel, unless something's playing already
        const autoTune = () => {
            if (!alive || !def.tv || !def.tv.channel) return;
            if (HomerHub.autoplay === false || def.tv.autoplay === false) return;
            if (window.HomerLayout && window.HomerLayout.isPhone()) return; // a phone: only when asked
            if (docked() || nowPlaying() || isVideoRoute() || tuning) return;
            if (!HP()) return;
            if (defaultCh) watch(defaultCh);
        };

        const startTab = Math.max(0, tabs.findIndex((t) => t.key === lastTabs.get(def.id)));
        applySize();
        showTab(startTab);
        setFocus(tabEls[startTab] || tvEl, { scroll: false });
        paintTv();
        updateLegend();
        if (def.onOpen) safe(() => def.onOpen(api_));

        return {
            def,
            phone,
            api: api_,
            show() {
                root.style.visibility = '';
                fit();
                // Jellyfin titles an address it doesn't know "Page not found"
                if (def.title) document.title = def.title;
            },
            sync() {
                if (docked()) tuning = null; // it's in: the player knows what's on
                else if (tuning && Date.now() - tuning.at > 45000) tuning = null; // never started
                paintTv();
                guide.paintWatching();
                updateLegend();
            },
            teardown() {
                alive = false;
                if (def.onClose) safe(() => def.onClose(api_));
                offActions();
                tabCleanup.forEach((fn) => safe(fn));
                hubPolls.forEach((p) => p.stop());
                cleanups.forEach((fn) => safe(fn));
                if (ticker) ticker.destroy();
                clearInterval(clockTimer);
                clearInterval(minuteTimer);
                clearTimeout(toastTimer);
                safe(wxDetach);
                window.removeEventListener('homer-guide-size', onSizeChange);
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('wheel', onWheel, { capture: true });
                window.removeEventListener('resize', fit);
                root.remove();
            }
        };
    };

    // ---------- Routes: each hub claims its own ----------

    const defs = new Map(); // id -> def
    const lastTabs = new Map(); // hub id -> the tab it was on (a change of layout keeps it)
    let screen = null; // the open hub's screen
    let suppressed = null; // a hub closed with close(): stays out of the way until the route changes
    let destroyed = false;

    const routeRe = (route) => new RegExp(`^#!?\\/${String(route).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?|$)`, 'i');
    const which = () => {
        const r = currentRoute();
        for (const d of defs.values()) if (d._re.test(r)) return d;
        return null;
    };
    const closeScreen = () => {
        if (!screen) return;
        const s = screen;
        screen = null;
        s.teardown();
    };
    const sync = () => {
        if (destroyed) return;
        const d = which();
        if (!d || (suppressed && suppressed !== d.id)) suppressed = null;
        if (screen && screen.def !== d) closeScreen();
        if (!d || !getServer() || suppressed === d.id) { closeScreen(); return; }
        if (screen) { screen.sync(); return; }
        const s = createScreen(d);
        screen = s;
        ensureCss(d).then(() => { if (screen === s) s.show(); });
    };

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
        setTimeout(() => { // not rAF: it never fires in a background tab
            syncQueued = false;
            subscribe();
            const sig = currentRoute() + '|' + location.href;
            if (sig === lastSig && (screen || !which())) return;
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

    // A hub's screen while the phone layout is up: the TV layout, shrunk
    // between the bars (stageBox), until a hub brings its own.
    // A phone and a TV draw it differently: a change (a rotation across the
    // line, a resized window) draws it again, on the same tab.
    const offLayout = window.HomerLayout ? window.HomerLayout.onChange(() => {
        if (!screen) return;
        if (screen.phone !== (isPhone() && !!screen.def.phone)) { closeScreen(); onRouteChange(); }
        else window.dispatchEvent(new Event('resize'));
    }) : () => {};

    const HomerHub = {
        version: VERSION,
        base: BASE,
        query: QUERY,
        autoplay: true, // false: never tune the default channel on open (tests)
        // register a hub (again: replaces it, redrawing it if it's open)
        define(def) {
            if (!def || !def.id || !def.route) throw new Error('HomerHub.define: id and route are required');
            def._re = routeRe(def.route);
            const had = defs.get(def.id);
            defs.set(def.id, def);
            if (had && screen && screen.def === had) closeScreen();
            onRouteChange();
            return def;
        },
        undefine(id) {
            const d = defs.get(id);
            if (!d) return;
            if (screen && screen.def === d) closeScreen();
            defs.delete(id);
        },
        // open a hub (going to its route)
        open(id) {
            const d = defs.get(id);
            if (!d) return;
            suppressed = null;
            if (!d._re.test(currentRoute())) { go('#/' + d.route); return; }
            onRouteChange();
        },
        close() {
            if (!screen) return;
            suppressed = screen.def.id;
            closeScreen();
        },
        current: () => (screen ? screen.api : null),
        isHubRoute: (h) => [...defs.values()].some((d) => d._re.test(h || '')),
        data,
        ui,
        fmt,
        channels,
        destroy() {
            destroyed = true;
            closeScreen();
            offLayout();
            observer && observer.disconnect();
            if (unsubscribe) safe(unsubscribe);
            window.removeEventListener('hashchange', onRouteChange);
            window.removeEventListener('popstate', onRouteChange);
            document.removeEventListener('DOMContentLoaded', start);
        }
    };
    window.HomerHub = HomerHub;
    // hubs that loaded before this (a reload of hub.js alone) define themselves again
    window.dispatchEvent(new Event('homer-hub-ready'));
})();
