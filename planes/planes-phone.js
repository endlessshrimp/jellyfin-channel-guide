/*
 * HOMER Planes, phone layout. planes/planes.js draws this instead of the TV
 * screen when shared/layout.js says it's a phone; both read the same model
 * (planes/planes-model.js) through ctx, so there is one poll, not two, and
 * both draw the same map (planes/planes-map.js).
 *
 *   The map      on top, about two fifths of the screen, centred on the house
 *                with the range rings and every aircraft on it. A tap on an
 *                aircraft picks it; the map then follows it.
 *   The list     under it, one card an aircraft, nearest first: callsign,
 *                what it is, where it's going, how high, how fast, which way.
 *                A tap follows it (a second tap lets it go), and the card it
 *                belongs to opens out with the rest of what's known.
 *   The range    chips above the list — 10, 25, 50, 100, 150 nm.
 *
 * The top bar's ‹ (shared/layout.js) lets a followed aircraft go, which is
 * what the screen's own "top" means here.
 *
 * window.HomerPlanesPhone = { create, version }
 */
(() => {
    const VERSION = '0.1.0';

    const el = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    };

    const create = (ctx) => {
        const {
            esc, icon, altText, speedText, headText, distText, trend, compass,
            whatIsIt, nameOf, routeText, routeLong, ageText, statusMessage, go
        } = ctx;
        const M = ctx.model();

        const root = el('div', 'homer-screen vp-phone');
        root.id = 'hv-root';
        root.style.visibility = 'hidden';
        root.innerHTML = `
            <div class="vp-map"></div>
            <div class="vp-under">
                <div class="vp-head">
                    <span class="vp-count"></span>
                    <span class="vp-age"></span>
                </div>
                <div class="vp-ranges"></div>
                <div class="vp-list"></div>
            </div>
            <div class="vp-state"></div>`;
        document.body.appendChild(root);
        const $ = (s) => root.querySelector(s);

        let alive = true;
        let list = [];
        let pinnedHex = (ctx.was && ctx.was.pinned) || '';
        let openHex = (ctx.was && (ctx.was.pinned || ctx.was.focus)) || '';
        let lastRows = '';

        const map = window.HomerPlanesMap ? window.HomerPlanesMap.create($('.vp-map'), {
            labels: 4, // a phone's map has room for a handful of names, not ten
            onPick: (hex) => {
                if (!hex) return;
                openHex = hex;
                pinnedHex = pinnedHex === hex ? '' : hex;
                lastRows = '';
                paint();
            }
        }) : null;

        // ----- the range chips -----

        const paintRanges = () => {
            if (!M) return;
            const box = $('.vp-ranges');
            const html = M.RANGES.map((r) => `<button type="button" class="vp-range${r === M.range ? ' on' : ''}" data-range="${r}">${r} nm</button>`).join('');
            if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
        };

        // ----- the cards -----

        const cardHtml = (p) => {
            const t = trend(p);
            const pin = p.hex === pinnedHex;
            const open = p.hex === openHex;
            const color = window.HomerPlanesMap ? window.HomerPlanesMap.altColor(p) : '#6fd3ff';
            const route = routeText(p);
            const what = whatIsIt(p);
            const long = routeLong(p);
            return `
                <div class="vp-card${open ? ' open' : ''}${pin ? ' pinned' : ''}${p.ground ? ' ground' : ''}" data-hex="${esc(p.hex)}" role="button" style="--band:${color}">
                    <div class="vp-card-top">
                        <div class="vp-card-who">
                            <div class="vp-card-call">${esc(nameOf(p))}${pin ? icon('push_pin', 'vp-pin') : ''}</div>
                            <div class="vp-card-what">${what ? esc(what) : '<em>Unknown aircraft</em>'}</div>
                        </div>
                        <div class="vp-card-nums">
                            <div class="vp-card-alt">${t ? icon(t.icon, 'vp-vs') : ''}${esc(altText(p))}</div>
                            <div class="vp-card-dist">${esc(distText(p))} ${esc(compass(p.dir))}</div>
                        </div>
                    </div>
                    ${route ? `<div class="vp-card-route">${icon('trending_flat', 'vp-arrow')}${esc(route)}${long ? `<i>${esc(long)}</i>` : ''}</div>` : ''}
                    ${open ? `<div class="vp-card-more">
                        <span><b>${esc(speedText(p) || '—')}</b>Speed</span>
                        <span><b>${esc(headText(p) || '—')}</b>Heading</span>
                        <span><b>${esc(t ? t.word : p.ground ? 'Stopped' : 'Level')}</b>Climb</span>
                        ${p.owner ? `<span class="wide"><b>${esc(p.owner)}</b>Operator</span>` : ''}
                        ${p.desc ? `<span class="wide"><b>${esc(p.desc)}</b>Aircraft</span>` : ''}
                    </div>` : ''}
                </div>`;
        };

        const paintList = () => {
            const box = $('.vp-list');
            const html = list.length
                ? list.map(cardHtml).join('')
                : `<div class="vp-none">${icon('flight_takeoff')}<b>Quiet sky</b><span>Nothing within ${esc(String(M ? M.range : ''))} nm right now.</span></div>`;
            if (html === lastRows) return;
            lastRows = html;
            box.innerHTML = html;
        };

        const paintHead = () => {
            if (!M) return;
            const parked = list.filter((p) => p.ground).length;
            const flying = list.length - parked;
            $('.vp-count').textContent = list.length
                ? `${flying} flying${parked ? ` · ${parked} on the ground` : ''} within ${M.range} nm`
                : `Nothing within ${M.range} nm`;
            $('.vp-age').textContent = M.at ? (M.stale ? `${ageText(M.at)} · feed quiet` : ageText(M.at)) : '';
        };

        const paintMap = () => {
            if (!map || !M || !M.place) return;
            const keep = list.find((p) => p.hex === pinnedHex);
            map.draw({
                home: { lat: M.place.lat, lon: M.place.lon },
                look: keep ? { lat: keep.lat, lon: keep.lon } : { lat: M.place.lat, lon: M.place.lon },
                range: M.range,
                planes: list,
                focus: openHex,
                pinned: pinnedHex,
                trail: (hex) => M.trail(hex)
            });
        };

        const drawStatus = () => {
            const msg = statusMessage(M);
            root.classList.toggle('vp-waiting', !!msg);
            const box = $('.vp-state');
            box.classList.toggle('show', !!msg);
            box.innerHTML = msg
                ? `${msg.spin ? '<div class="vp-spinner"></div>' : icon(msg.icon || 'flight', 'vp-state-icon')}<b>${esc(msg.title)}</b>${msg.text ? `<span>${esc(msg.text)}</span>` : ''}${msg.ok ? `<button type="button" class="vp-state-ok" data-ok>${esc(msg.ok)}</button>` : ''}`
                : '';
        };

        const paint = () => {
            if (!alive || !M) return;
            list = M.planes || [];
            if (pinnedHex && !list.some((p) => p.hex === pinnedHex)) pinnedHex = '';
            if (openHex && !list.some((p) => p.hex === openHex)) openHex = '';
            drawStatus();
            paintRanges();
            paintHead();
            paintList();
            paintMap();
        };

        const onClick = (ev) => {
            const r = ev.target.closest('.vp-range');
            if (r) { M.setRange(Number(r.dataset.range)); lastRows = ''; paint(); return; }
            const ok = ev.target.closest('[data-ok]');
            if (ok) {
                const msg = statusMessage(M);
                if (msg && msg.act === 'settings') go('#/mypreferencesmenu');
                else M.refresh();
                return;
            }
            const card = ev.target.closest('.vp-card');
            if (card) {
                const hex = card.dataset.hex;
                // first tap opens it, a tap on the open one follows it, and a
                // tap on the one being followed lets it go
                if (openHex !== hex) openHex = hex;
                else pinnedHex = pinnedHex === hex ? '' : hex;
                lastRows = '';
                paint();
            }
        };
        root.addEventListener('click', onClick);

        const onResize = () => { if (map) map.resize(); };
        window.addEventListener('resize', onResize);

        // the top bar's ‹ : let a followed aircraft go, then a closed card
        const offHome = window.HomerLayout && window.HomerLayout.setScreenHome
            ? window.HomerLayout.setScreenHome(() => {
                if (!pinnedHex && !openHex) return false;
                pinnedHex = '';
                openHex = '';
                lastRows = '';
                paint();
                return true;
            }, { atTop: () => !pinnedHex && !openHex })
            : () => {};

        const offActions = window.HomerActions ? window.HomerActions.provide(() => {
            const out = [];
            if (M) out.push({ id: 'refresh', icon: 'refresh', label: 'Refresh', main: true, run: () => M.refresh() });
            return out;
        }, { id: 'planes', title: 'Planes' }) : () => {};

        if (map) {
            fetch(`${location.protocol === 'https:' ? location.origin + '/homer-feeds' : 'http://' + location.hostname + ':8095'}/health`, { cache: 'no-store' })
                .then((r) => { if (!r.ok) throw new Error('no helper'); })
                .catch(() => { if (alive) map.tiles(false); });
        }

        const offModel = M ? M.watch(() => paint()) : () => {};
        const ageTimer = setInterval(() => { if (alive) paintHead(); }, 5000);
        paint();

        return {
            phone: true,
            show() { root.style.visibility = ''; if (map) map.resize(); },
            sync() { paint(); },
            state: () => ({ focus: openHex, pinned: pinnedHex }),
            teardown() {
                alive = false;
                offModel();
                offActions();
                offHome();
                clearInterval(ageTimer);
                root.removeEventListener('click', onClick);
                window.removeEventListener('resize', onResize);
                if (map) map.destroy();
                root.remove();
            }
        };
    };

    window.HomerPlanesPhone = { version: VERSION, create };
    if (window.HomerLayout) window.HomerLayout.register('planes', { phone: true });
})();
