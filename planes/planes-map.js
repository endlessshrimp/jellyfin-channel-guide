/*
 * HOMER Planes, the map. One widget, drawn the same on a TV and on a phone.
 *
 * The backdrop: OpenStreetMap's own tiles
 * ---------------------------------------
 * Fetched through HOMER's helper on the NAS rather than straight from the
 * browser (`/homer-feeds/planes/tile/<z>/<x>/<y>.png`), which is what makes
 * this allowed under the OSMF tile usage policy:
 *
 *   * the helper sends a User-Agent that names HOMER, which a browser can't
 *     be made to do;
 *   * it keeps every tile on the NAS for a month, so a tile is fetched from
 *     OSM once and never again — the policy asks for at least seven days;
 *   * only the tiles actually on screen are asked for, never a pre-seeded
 *     area or a range of zooms, and the helper caps zoom at 13 so it can't
 *     become a way to scrape a city;
 *   * the attribution is drawn in the corner of the map, as required;
 *   * and it's one house looking at one neighbourhood, so the whole set is a
 *     few dozen tiles.
 * It also solves the other half of the problem: the helper answers over https
 * on media.nel.sn through the same Caddy route as the news feeds, so the map
 * works from outside the house without a mixed-content block.
 *
 * The tiles are a light map, so they're inverted and dimmed into HOMER's
 * navy rather than dropped on top of it. If a tile never arrives, the map is
 * still a working radar scope: the ground, the range rings and the aircraft
 * are all drawn here, not fetched.
 *
 * Everything else is vector: range rings at quarters of the range, a compass,
 * the house, each aircraft as a silhouette turned to its track and coloured by
 * altitude, and a trail behind the one you've pinned.
 *
 *   const map = HomerPlanesMap.create(hostEl);
 *   map.draw({ home: {lat, lon}, look: {lat, lon}, range: 50, planes: [...],
 *              focus: 'a1b2c3', pinned: '', trail: (hex) => [...] });
 *   map.resize();   // the host changed size
 *   map.destroy();  // …in teardown()
 *
 * window.HomerPlanesMap = { create, ALT_BANDS, altColor, version }
 */
(() => {
    const VERSION = '0.1.0';

    const TILE = 256;
    const MIN_Z = 3;
    const MAX_Z = 13; // the helper refuses anything deeper
    const M_PER_NM = 1852;
    const EQUATOR_M = 40075016.686;

    // An aircraft's silhouette, pointing north, about 22 units across.
    const PLANE_PATH = 'M0,-11 L2.1,-4.2 L11,1.8 L11,4.4 L2.1,2.2 L2.1,7.4 '
        + 'L4.9,9.9 L4.9,11.6 L0,10.3 L-4.9,11.6 L-4.9,9.9 L-2.1,7.4 '
        + 'L-2.1,2.2 L-11,4.4 L-11,1.8 L-2.1,-4.2 Z';

    // Altitude bands, lowest first. The screens draw this as the map's key.
    const ALT_BANDS = [
        { upTo: 0, color: '#5a6f89', label: 'On the ground' },
        { upTo: 5000, color: '#6fd3ff', label: 'Below 5,000' },
        { upTo: 15000, color: '#33d17a', label: '5–15,000' },
        { upTo: 25000, color: '#ffd23f', label: '15–25,000' },
        { upTo: 35000, color: '#ff9d3f', label: '25–35,000' },
        { upTo: Infinity, color: '#ff6f91', label: 'Above 35,000' }
    ];
    const altColor = (p) => {
        if (!p || p.ground) return ALT_BANDS[0].color;
        const ft = typeof p.alt === 'number' ? p.alt : -1;
        if (ft < 0) return '#8ea3bd'; // height unknown
        for (const b of ALT_BANDS) if (ft <= b.upTo) return b.color;
        return ALT_BANDS[ALT_BANDS.length - 1].color;
    };

    // ---------- Web Mercator ----------

    const worldPx = (lat, lon, z) => {
        const size = TILE * Math.pow(2, z);
        const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
        return {
            x: ((lon + 180) / 360) * size,
            y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size
        };
    };
    const metresPerPx = (lat, z) => (EQUATOR_M * Math.cos(lat * Math.PI / 180)) / (TILE * Math.pow(2, z));

    const svgEl = (tag, attrs) => {
        const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // HOMER's helper on the NAS, the same address the rest of HOMER uses
    const helper = () => (location.protocol === 'https:'
        ? location.origin + '/homer-feeds'
        : 'http://' + location.hostname + ':8095');

    const create = (host, opts = {}) => {
        if (!host) throw new Error('HomerPlanesMap.create needs an element');

        const root = document.createElement('div');
        root.className = 'pm';
        root.innerHTML = `
            <div class="pm-tiles" aria-hidden="true"></div>
            <div class="pm-tint" aria-hidden="true"></div>
            <svg class="pm-vec" aria-hidden="true"></svg>
            <div class="pm-labels"></div>
            <div class="pm-credit">© OpenStreetMap contributors</div>`;
        host.appendChild(root);

        const tilesBox = root.querySelector('.pm-tiles');
        const vec = root.querySelector('.pm-vec');
        const labels = root.querySelector('.pm-labels');

        let w = 0;
        let h = 0;
        let z = 9;
        let originX = 0;
        let originY = 0;
        let last = null; // the most recent draw() argument
        const pool = new Map(); // "z/x/y" -> img
        let tilesOff = false; // the helper isn't answering: vectors only

        // The map is built before its stylesheet has loaded, so its box is
        // 0x0 at first and whatever the screen gives it a moment later. Every
        // draw measures again rather than trusting the first answer — the
        // alternative was a map drawn at zoom 3, which is a lovely picture of
        // Texas and no use at all for finding a helicopter.
        const measure = () => {
            const nw = Math.max(1, Math.round(root.clientWidth));
            const nh = Math.max(1, Math.round(root.clientHeight));
            if (nw === w && nh === h) return false;
            w = nw;
            h = nh;
            vec.setAttribute('viewBox', `0 0 ${w} ${h}`);
            vec.setAttribute('width', w);
            vec.setAttribute('height', h);
            return true;
        };
        const dropTiles = () => {
            pool.forEach((img) => img.remove());
            pool.clear();
        };

        // The deepest zoom at which the whole range still fits on screen.
        const zoomFor = (lat, rangeNm) => {
            const half = Math.min(w, h) / 2 - 12;
            if (half <= 0 || !rangeNm) return MIN_Z;
            const want = (EQUATOR_M * Math.cos(lat * Math.PI / 180) * half) / (TILE * rangeNm * M_PER_NM);
            return Math.max(MIN_Z, Math.min(MAX_Z, Math.floor(Math.log2(want))));
        };

        const project = (lat, lon) => {
            const p = worldPx(lat, lon, z);
            return { x: p.x - originX, y: p.y - originY };
        };

        // ----- the tile layer -----

        const paintTiles = () => {
            if (tilesOff || opts.tiles === false) { tilesBox.innerHTML = ''; pool.clear(); return; }
            const want = new Set();
            const x0 = Math.floor(originX / TILE);
            const x1 = Math.floor((originX + w) / TILE);
            const y0 = Math.floor(originY / TILE);
            const y1 = Math.floor((originY + h) / TILE);
            const span = Math.pow(2, z);
            for (let ty = y0; ty <= y1; ty++) {
                if (ty < 0 || ty >= span) continue;
                for (let tx = x0; tx <= x1; tx++) {
                    const wrapped = ((tx % span) + span) % span; // the world joins up at the date line
                    const key = `${z}/${wrapped}/${ty}`;
                    const at = `${key}@${tx}`;
                    want.add(at);
                    let img = pool.get(at);
                    if (!img) {
                        img = new Image();
                        img.className = 'pm-tile';
                        img.alt = '';
                        img.draggable = false;
                        img.decoding = 'async';
                        img.addEventListener('load', () => img.classList.add('on'));
                        img.addEventListener('error', () => img.classList.add('gone'));
                        img.src = `${helper()}/planes/tile/${key}.png`;
                        tilesBox.appendChild(img);
                        pool.set(at, img);
                    }
                    img.style.transform = `translate(${Math.round(tx * TILE - originX)}px, ${Math.round(ty * TILE - originY)}px)`;
                }
            }
            for (const [key, img] of pool) {
                if (want.has(key)) continue;
                img.remove();
                pool.delete(key);
            }
        };

        // ----- the vector layer -----

        // Rings land on round numbers — 10, 20, 30, 40 inside a 50 nm range,
        // not 12.5 and 37.5. A scope you have to do arithmetic on isn't one.
        const NICE = [1, 2, 5, 10, 25, 50, 100];
        const ringStep = (rangeNm) => NICE.find((n) => n >= rangeNm / 5) || rangeNm;

        const ringsAndCompass = (frag, home, rangeNm) => {
            const c = project(home.lat, home.lon);
            const mpp = metresPerPx(home.lat, z);
            const step = ringStep(rangeNm);
            const at = [];
            for (let d = step; d < rangeNm - 0.01; d += step) at.push(d);
            at.push(rangeNm);
            // on a phone's map the rings sit close together; labelling every
            // one of them makes a stack of unreadable numbers, so label every
            // other one (and always the outermost) when they're that tight
            const gap = (step * M_PER_NM) / mpp;
            const every = gap < 40 ? 2 : 1;
            at.forEach((d, i) => {
                const r = (d * M_PER_NM) / mpp;
                if (r < 8 || r > Math.max(w, h) * 1.6) return;
                frag.appendChild(svgEl('circle', {
                    cx: c.x, cy: c.y, r,
                    class: 'pm-ring' + (d === rangeNm ? ' pm-ring-edge' : '')
                }));
                if (d !== rangeNm && (at.length - 1 - i) % every) return;
                // down and to the left, off the vertical where the aircraft
                // labels stack up: a ring you can't read is just a circle
                const k = 0.7071;
                const t = svgEl('text', {
                    x: c.x - r * k, y: c.y + r * k + 4, class: 'pm-ring-label'
                });
                t.textContent = `${d} nm`;
                frag.appendChild(t);
            });
            const r = Math.min((rangeNm * M_PER_NM) / mpp, Math.min(w, h) / 2 - 14);
            for (const [label, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
                const t = svgEl('text', {
                    x: c.x + dx * (r + 2), y: c.y + dy * (r + 2) + 6, class: 'pm-compass'
                });
                t.textContent = label;
                frag.appendChild(t);
            }
            // the house
            const g = svgEl('g', { class: 'pm-home', transform: `translate(${c.x},${c.y})` });
            g.appendChild(svgEl('circle', { r: 16, class: 'pm-home-halo' }));
            g.appendChild(svgEl('path', { class: 'pm-home-mark', d: 'M-8,1 L0,-7 L8,1 L8,8 L-8,8 Z' }));
            frag.appendChild(g);
        };

        const trailFor = (frag, hex, get) => {
            const pts = (typeof get === 'function' && get(hex)) || [];
            if (pts.length < 2) return;
            const d = pts.map((p, i) => {
                const s = project(p.lat, p.lon);
                return `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
            }).join(' ');
            frag.appendChild(svgEl('path', { class: 'pm-trail', d }));
        };

        const paintVec = (d) => {
            const frag = document.createDocumentFragment();
            if (d.home) ringsAndCompass(frag, d.home, d.range);
            const marked = d.pinned || d.focus;
            if (marked) trailFor(frag, marked, d.trail);

            const list = d.planes || [];
            const onScreen = [];
            for (const p of list) {
                if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
                const s = project(p.lat, p.lon);
                if (s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40) continue;
                const is = p.hex === d.focus;
                const pin = p.hex === d.pinned;
                const scale = pin ? 1.35 : is ? 1.2 : 0.92;
                const turn = typeof p.track === 'number' ? p.track : 0;
                const g = svgEl('g', {
                    class: 'pm-plane' + (is ? ' on' : '') + (pin ? ' pinned' : '') + (p.ground ? ' ground' : ''),
                    transform: `translate(${s.x.toFixed(1)},${s.y.toFixed(1)})`
                });
                if (is || pin) g.appendChild(svgEl('circle', { r: pin ? 26 : 22, class: 'pm-plane-halo' }));
                g.appendChild(svgEl('path', {
                    class: 'pm-plane-body',
                    d: PLANE_PATH,
                    fill: altColor(p),
                    transform: `rotate(${turn.toFixed(1)}) scale(${scale})`
                }));
                frag.appendChild(g);
                onScreen.push({ p, s, is, pin });
            }
            vec.textContent = '';
            vec.appendChild(frag);
            return onScreen;
        };

        // Labels are HTML, so they get Barlow and a readable chip. Only the
        // ones worth reading across a room: the focused aircraft, the pinned
        // one, and the nearest few — a label on all forty is a grey smear.
        const paintLabels = (d, onScreen) => {
            const named = onScreen.filter((x) => x.is || x.pin
                || (!x.p.ground && onScreen.indexOf(x) < (opts.labels == null ? 7 : opts.labels)));
            labels.innerHTML = named.map(({ p, s, is, pin }) => {
                const name = p.flight || p.reg || p.hex.toUpperCase();
                const alt = p.ground ? 'Ground' : typeof p.alt === 'number' ? Math.round(p.alt / 100) * 100 + ' ft' : '';
                return `<div class="pm-label${is ? ' on' : ''}${pin ? ' pinned' : ''}" style="left:${s.x.toFixed(0)}px;top:${s.y.toFixed(0)}px" data-hex="${esc(p.hex)}">
                    <b>${esc(name)}</b>${alt ? `<i>${esc(alt)}</i>` : ''}</div>`;
            }).join('');
        };

        const draw = (d) => {
            last = d || last;
            if (!last || !last.home) return;
            const grew = measure();
            const look = last.look || last.home;
            const want = zoomFor(last.home.lat, last.range || 50);
            // a tile is only good for the zoom it was cut at
            if (want !== z || grew) { z = want; dropTiles(); }
            const c = worldPx(look.lat, look.lon, z);
            originX = c.x - w / 2;
            originY = c.y - h / 2;
            paintTiles();
            paintLabels(last, paintVec(last));
        };

        const resize = () => { measure(); dropTiles(); draw(); };

        // a tap or click on an aircraft picks it
        const onClick = (ev) => {
            if (typeof opts.onPick !== 'function') return;
            const lab = ev.target.closest('.pm-label');
            if (lab) { opts.onPick(lab.dataset.hex); return; }
            if (!last || !last.planes || !last.planes.length) return;
            const box = root.getBoundingClientRect();
            const x = ev.clientX - box.left;
            const y = ev.clientY - box.top;
            let best = null;
            let bestD = 34 * 34; // a finger's worth of slack
            for (const p of last.planes) {
                if (typeof p.lat !== 'number') continue;
                const s = project(p.lat, p.lon);
                const dd = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
                if (dd < bestD) { bestD = dd; best = p; }
            }
            if (best) opts.onPick(best.hex);
        };
        root.addEventListener('click', onClick);

        measure();

        return {
            get zoom() { return z; },
            draw,
            resize,
            project,
            // the helper is unreachable: stop asking for tiles, keep the scope
            tiles(on) {
                tilesOff = !on;
                if (tilesOff) { dropTiles(); tilesBox.innerHTML = ''; }
                root.classList.toggle('pm-notiles', tilesOff);
                draw();
            },
            destroy() {
                root.removeEventListener('click', onClick);
                pool.clear();
                root.remove();
            }
        };
    };

    window.HomerPlanesMap = { version: VERSION, create, ALT_BANDS, altColor };
})();
