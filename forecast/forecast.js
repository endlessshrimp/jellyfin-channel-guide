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
 *                 the next sunrise or sunset; below them the next 14 hours,
 *                 two at a time: conditions, temperature, chance of rain
 *   Radar         the last hour of the National Weather Service's radar, on a
 *                 HOMER map centered on the place
 *   Next 3 days   one panel a day: conditions, high and low, chance of rain
 *                 and how much, wind, sunrise and sunset
 *
 * Now and each day sit on an illustrated sky that matches the weather (and,
 * for Now, the time of day). Only the Now icon and the radar move; the rest
 * are stills.
 *
 * Remote/keyboard: Esc/Backspace goes back, H goes Home, OK tries again after
 * an error.
 *
 * window.HomerForecast = { open, close, destroy, version }
 */
(() => {
    const VERSION = '0.2.0';

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
    const SLOTS = 8; // Now, then the next 14 hours two at a time
    const STEP = 2;
    const RADAR_MS = 5 * 60 * 1000; // a fresh radar loop
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

    // ---------- Radar ----------
    // The National Weather Service's radar mosaic (MRMS base reflectivity,
    // public domain), from the NWS's own map server: a picture of just the rain,
    // in the NWS colors, for any area and any time in the last two hours. HOMER
    // takes the last hour of them, about 6 minutes apart, and plays them over
    // its own navy map. The pictures are shown as they come, with no filter or
    // fade, so every rain color is exactly the NWS's; the only things drawn over
    // them are thin map lines and town names.
    //
    // The map is the Census Bureau's (TIGERweb, public domain): land, county and
    // state lines, interstates (a dim grey, so they can't pass for rain), and
    // the bigger towns. It's centered on the place. The NWS radar covers the US
    // and its territories; anywhere else the panel says there's no radar.

    const OPENGEO = 'https://opengeo.ncep.noaa.gov/geoserver/';
    const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/';
    const MAP_W = 640; // the map, in stage pixels: the panel at its widest...
    const MAP_H = 432; // ...and its height
    const MAP_KM = 420; // across
    const FRAMES = 10; // pictures in the loop,
    const FRAME_GAP = 5 * 60000; // at least this far apart (the mosaic is redrawn every 2 minutes)
    // a panel as narrow as it gets (a 1600 stage) shows the middle 516 of the 640
    const SAFE_X = [(MAP_W - 516) / 2 + 12, (MAP_W + 516) / 2 - 12];

    // which NWS mosaic covers a place
    const radarRegion = (lat, lon) => {
        if (lat > 50 && lon < -129) return 'alaska';
        if (lat < 24 && lon < -150) return 'hawaii';
        if (lat < 21 && lon > -68.5 && lon < -63) return 'carib';
        if (lon > 140) return 'guam';
        return 'conus';
    };

    // near enough to the US to try the radar when the map can't say for sure
    const roughlyUS = (lat, lon) => (lat > 24 && lat < 50 && lon > -125 && lon < -66.5)
        || (lat > 51 && lat < 72 && lon > -170 && lon < -129)
        || (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154)
        || (lat > 17.5 && lat < 18.7 && lon > -67.5 && lon < -64.5)
        || (lat > 13 && lat < 14 && lon > 144 && lon < 146);

    // Web Mercator (EPSG:3857), which both servers draw in
    const EARTH = 6378137;
    const merc = (lat, lon) => [EARTH * lon * Math.PI / 180, EARTH * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
    // the map's area: MAP_KM across, centered on the place; and stage pixels in it
    const mapArea = (lat, lon) => {
        const [x, y] = merc(lat, lon);
        const half = MAP_KM * 500 / Math.cos(lat * Math.PI / 180); // Mercator stretches away from the equator
        const box = [x - half, y - half * MAP_H / MAP_W, x + half, y + half * MAP_H / MAP_W];
        const px = (mx, my) => [(mx - box[0]) / (box[2] - box[0]) * MAP_W, (box[3] - my) / (box[3] - box[1]) * MAP_H];
        return { box, center: [x, y], px };
    };

    // when each picture in the mosaic was taken, oldest first
    const radarTimes = (ws) => fetch(`${OPENGEO}${ws}/${ws}_bref_qcd/ows?service=WMS&version=1.3.0&request=GetCapabilities`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((xml) => {
            const m = /<Dimension name="time"[^>]*>([^<]+)</.exec(xml);
            if (!m) throw new Error('no radar times');
            return m[1].split(',').map((t) => Date.parse(t.trim())).filter(isFinite).sort((a, b) => a - b);
        });
    // the newest picture, and the ones at least FRAME_GAP apart before it
    const pickFrames = (times) => {
        const out = [];
        for (let i = times.length - 1; i >= 0 && out.length < FRAMES; i--) {
            if (!out.length || out[0] - times[i] >= FRAME_GAP) out.unshift(times[i]);
        }
        return out;
    };
    // one picture: the rain over the map's area, transparent everywhere else
    const frameUrl = (ws, box, scale, at) => `${OPENGEO}${ws}/${ws}_bref_qcd/ows?` + new URLSearchParams({
        service: 'WMS', version: '1.3.0', request: 'GetMap', layers: `${ws}_bref_qcd`, styles: '',
        format: 'image/png', transparent: 'true', crs: 'EPSG:3857', bbox: box.join(','),
        width: MAP_W * scale, height: MAP_H * scale, time: new Date(at).toISOString(),
    });

    // the interstates, drawn by the Census server in HOMER's dim grey; always
    // at twice the map's size (its main roads only draw at that scale or closer)
    const roadsUrl = (box) => TIGER + 'Transportation/MapServer/export?' + new URLSearchParams({
        bbox: box.join(','), bboxSR: 3857, imageSR: 3857, size: `${MAP_W * 2},${MAP_H * 2}`,
        format: 'png32', transparent: 'true', f: 'image',
        dynamicLayers: JSON.stringify([{
            id: 101, minScale: 0, maxScale: 0, source: { type: 'mapLayer', mapLayerId: 1 }, // primary roads
            drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [150, 158, 170, 255], width: 2.2 } } },
        }]),
    });

    const tiger = (layer, params) => fetch(TIGER + layer + '/query?' + new URLSearchParams({ f: 'json', ...params }))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => (j.error ? Promise.reject(new Error(j.error.message || 'TIGERweb')) : j.features || []));
    // counties, states and towns around a place, once per place
    const maps = new Map(); // "lat,lon" -> Promise<{ counties, states, towns }>
    const mapShapes = (lat, lon, box) => {
        const key = lat.toFixed(2) + ',' + lon.toFixed(2);
        if (maps.has(key)) return maps.get(key);
        const area = { geometry: box.join(','), geometryType: 'esriGeometryEnvelope', inSR: 3857, spatialRel: 'esriSpatialRelIntersects' };
        // simplified to about a pixel
        const shapes = { ...area, outFields: 'NAME', returnGeometry: 'true', outSR: 3857, maxAllowableOffset: 400, geometryPrecision: 0 };
        const p = Promise.all([
            tiger('State_County/MapServer/9', shapes),
            tiger('State_County/MapServer/8', shapes),
            // the biggest towns (2020 census); names are a nicety
            tiger('tigerWMS_Census2020/MapServer/26', {
                ...area, outFields: 'BASENAME,CENTLAT,CENTLON', returnGeometry: 'false',
                orderByFields: 'POP100 DESC', resultRecordCount: 30,
            }).catch(() => []),
        ]).then(([counties, states, towns]) => ({ counties, states, towns }));
        p.catch(() => maps.delete(key)); // try again next time
        maps.set(key, p);
        return p;
    };
    // is a point inside any of these polygons (rings in the same units)?
    const inside = (x, y, features) => features.some((f) => {
        let hit = false;
        (f.geometry && f.geometry.rings || []).forEach((ring) => {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i];
                const [xj, yj] = ring[j];
                if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
            }
        });
        return hit;
    });

    // ---------- Skies (behind Now and each day) ----------
    // An illustrated sky for each kind of weather, in the flat, soft-gradient
    // style of the icons, lit for day, dawn, dusk or night. Drawn here as SVG,
    // so there are no image files, and kept low-key: a navy scrim over it keeps
    // every number readable. Nothing moves.

    // WMO code -> the sky it gets
    const skyKind = (code) => {
        if (code >= 95) return 'storm';
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
        if ([56, 57, 66, 67].includes(code)) return 'sleet';
        if (code >= 51) return 'rain';
        if (code === 45 || code === 48) return 'fog';
        if (code === 3) return 'overcast';
        if (code === 2) return 'partly';
        if (code === 1) return 'mostly';
        return 'clear';
    };
    // dawn and dusk: 45 minutes either side of sunrise and sunset
    const skyTime = (at, isDay, day) => {
        const near = (t) => isFinite(t) && Math.abs(at - t) < 45 * 60000;
        if (day && near(day.sunrise)) return 'dawn';
        if (day && near(day.sunset)) return 'dusk';
        return isDay ? 'day' : 'night';
    };

    // the sky from top to horizon: clear, grey (overcast, rain), pale (snow,
    // fog) and dark (storms)
    const SKY = {
        day: { clear: ['#154f9f', '#347bc8', '#78b1e3'], grey: ['#384556', '#526176', '#768597'], pale: ['#566a80', '#7a8ca0', '#a2b0bf'], dark: ['#131a25', '#232c3a', '#3a4556'] },
        dawn: { clear: ['#1a295b', '#65548c', '#dc946f'], grey: ['#2d3346', '#575164', '#937b79'], pale: ['#474d62', '#767182', '#b19c95'], dark: ['#141924', '#2b2b39', '#52454a'] },
        dusk: { clear: ['#131d4b', '#663c70', '#d97646'], grey: ['#252b3e', '#4f4255', '#8a665f'], pale: ['#40455a', '#6e6477', '#a88a82'], dark: ['#11151e', '#282331', '#4a3a3c'] },
        night: { clear: ['#030815', '#0a1937', '#16325f'], grey: ['#0a0f1a', '#151e2d', '#232f42'], pale: ['#131a27', '#212b3b', '#324054'], dark: ['#05070c', '#0d121b', '#1a212e'] },
    };
    // clouds, lit top and shaded base: fair-weather, grey, rain and storm
    const CLOUD = {
        day: { fair: ['#eef3f9', '#b3c4d8'], grey: ['#b1bcc9', '#7b8796'], rain: ['#77828f', '#485261'], storm: ['#4d5664', '#252c37'] },
        dawn: { fair: ['#fbe0d4', '#b488a2'], grey: ['#a498a4', '#696275'], rain: ['#6c6676', '#423d4c'], storm: ['#48424e', '#24212b'] },
        dusk: { fair: ['#f8cfba', '#a36c8a'], grey: ['#9d8c96', '#625466'], rain: ['#675a66', '#3d3342'], storm: ['#443a44', '#211c25'] },
        night: { fair: ['#34435e', '#1c273c'], grey: ['#2a3447', '#161e2c'], rain: ['#212a39', '#101621'], storm: ['#1b212c', '#0a0e15'] },
    };
    // what each kind of sky is made of
    const SKY_PARTS = {
        clear: { sky: 'clear', light: 1, stars: 70 },
        mostly: { sky: 'clear', light: 1, stars: 55, clouds: 'fair', few: 1 },
        partly: { sky: 'clear', light: 1, stars: 35, clouds: 'fair', few: 3 },
        overcast: { sky: 'grey', clouds: 'grey', deck: 1 },
        fog: { sky: 'pale', clouds: 'grey', deck: 0.5, fog: 1 },
        rain: { sky: 'grey', clouds: 'rain', deck: 1, fall: 'rain' },
        sleet: { sky: 'grey', clouds: 'rain', deck: 1, fall: 'sleet' },
        snow: { sky: 'pale', clouds: 'grey', deck: 1, fall: 'snow' },
        storm: { sky: 'dark', clouds: 'storm', deck: 1, fall: 'rain', glow: 1 },
    };

    // the same "random" stars and cloud offsets every time
    const seeded = (seed) => () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };

    // 1600×640, pinned to the right edge of the panel; the panel crops the rest.
    // The text covers nearly all of Now on a narrow screen, so the sun, moon,
    // clouds and bolt stay in the top right corner (x > 1400, y < 370).
    const skySvg = (kind, time) => {
        const parts = SKY_PARTS[kind] || SKY_PARTS.clear;
        const sky = SKY[time][parts.sky];
        const tone = parts.clouds && CLOUD[time][parts.clouds];
        const rnd = seeded(7);
        const defs = [];
        const art = [];
        let gid = 0;
        const n = (v) => Math.round(v * 10) / 10;

        defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>`);
        art.push('<rect width="1600" height="640" fill="url(#sky)"/>');

        // stars, on clear-ish nights
        if (time === 'night' && parts.stars) {
            let dots = '';
            for (let i = 0; i < parts.stars; i++) {
                dots += `<circle cx="${n(rnd() * 1600)}" cy="${n(rnd() * 420)}" r="${n(0.8 + rnd() * 1.3)}" opacity="${n(0.25 + rnd() * 0.55)}"/>`;
            }
            art.push(`<g fill="#fff">${dots}</g>`);
        }

        // the sun, the moon, or the glow of a sun on the horizon
        if (parts.light) {
            if (time === 'day') {
                defs.push('<radialGradient id="sun"><stop offset="0" stop-color="#fffbe6"/><stop offset=".16" stop-color="#ffeaa0" stop-opacity=".7"/><stop offset=".45" stop-color="#ffe08a" stop-opacity=".22"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient>');
                art.push('<circle cx="1530" cy="150" r="300" fill="url(#sun)"/><circle cx="1530" cy="150" r="42" fill="#ffefb0"/>');
            } else if (time === 'night') {
                defs.push('<radialGradient id="moonGlow"><stop offset="0" stop-color="#cdd9ff" stop-opacity=".22"/><stop offset="1" stop-color="#cdd9ff" stop-opacity="0"/></radialGradient>');
                defs.push('<mask id="crescent"><circle cx="1530" cy="150" r="38" fill="#fff"/><circle cx="1549" cy="137" r="34" fill="#000"/></mask>');
                art.push('<circle cx="1530" cy="150" r="220" fill="url(#moonGlow)"/><circle cx="1530" cy="150" r="38" fill="#eef0e4" mask="url(#crescent)"/>');
            } else {
                defs.push('<radialGradient id="sun"><stop offset="0" stop-color="#ffd9a1" stop-opacity=".95"/><stop offset=".25" stop-color="#ffb070" stop-opacity=".45"/><stop offset="1" stop-color="#ff9a5c" stop-opacity="0"/></radialGradient>');
                art.push('<circle cx="1450" cy="700" r="620" fill="url(#sun)"/>');
            }
        }

        // a cloud: puffs on a flat base, w wide, its base line at (x, y)
        const cloud = (x, y, w, top, base) => {
            const u = w / 100;
            const id = 'c' + gid++;
            defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(y - 46 * u)}" x2="0" y2="${n(y)}"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${base}"/></linearGradient>`);
            const c = (dx, dy, r) => `<circle cx="${n(x + dx * u)}" cy="${n(y + dy * u)}" r="${n(r * u)}"/>`;
            return `<g fill="url(#${id})">${c(-28, -12, 16)}${c(-6, -22, 24)}${c(18, -16, 20)}${c(36, -8, 12)}`
                + `<rect x="${n(x - 44 * u)}" y="${n(y - 16 * u)}" width="${n(88 * u)}" height="${n(16 * u)}" rx="${n(8 * u)}"/></g>`;
        };
        defs.push('<filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>');

        // the glow of lightning inside the storm clouds
        if (parts.glow) {
            defs.push('<radialGradient id="flash"><stop offset="0" stop-color="#e4dcff" stop-opacity=".55"/><stop offset=".5" stop-color="#b9b0ff" stop-opacity=".18"/><stop offset="1" stop-color="#b9b0ff" stop-opacity="0"/></radialGradient>');
        }

        if (parts.few) {
            // fair-weather clouds drifting past the sun
            const spots = [[1510, 290, 170], [1580, 215, 120], [1400, 110, 110]].slice(0, parts.few);
            art.push(`<g filter="url(#soft)">${spots.map(([x, y, w]) => cloud(x, y, w, tone[0], tone[1])).join('')}</g>`);
        } else if (parts.deck) {
            // a deck of cloud across the top: staggered rows, darker below
            let deck = `<rect width="1600" height="${n(130 * parts.deck)}" fill="${tone[1]}"/>`;
            const rows = parts.deck < 1 ? [[150, 300]] : [[140, 340], [240, 300], [330, 250]];
            rows.forEach(([y, w], r) => {
                for (let x = -120 + r * 130; x < 1760; x += w * 0.66) {
                    deck += cloud(x + rnd() * 60, y * parts.deck + rnd() * 36 - 18, w + rnd() * 140, tone[0], tone[1]);
                }
            });
            if (parts.glow) deck += '<ellipse cx="1470" cy="210" rx="300" ry="150" fill="url(#flash)"/>';
            art.push(`<g filter="url(#soft)">${deck}</g>`);
        }

        // a short bolt out of the glow, kept high: Now's next hours sit below it
        if (parts.glow) {
            art.push('<path d="M1532 226 L1508 290 L1530 290 L1500 362 L1552 276 L1528 276 L1546 226 Z" fill="#fff1c2" opacity=".75"/>');
        }

        // what's falling, fading out toward the ground
        if (parts.fall) {
            defs.push('<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".15" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>');
            defs.push('<mask id="below"><rect y="300" width="1600" height="340" fill="url(#fade)"/></mask>');
            const streaks = (w, h, op) => `<path d="M${w * 0.25} 0v${h}M${w * 0.75} ${h * 1.5}v${h}" stroke="#d2e2ff" stroke-opacity="${op}" stroke-width="2.5" stroke-linecap="round"/>`;
            const flakes = '<g fill="#fff" fill-opacity=".7"><circle cx="12" cy="18" r="3.5"/><circle cx="58" cy="8" r="2.5"/><circle cx="40" cy="52" r="4"/><circle cx="78" cy="66" r="3"/><circle cx="20" cy="76" r="2.5"/></g>';
            const tile = parts.fall === 'snow' ? [90, 90, flakes]
                : parts.fall === 'sleet' ? [60, 90, streaks(60, 18, 0.36) + '<g fill="#fff" fill-opacity=".65"><circle cx="45" cy="12" r="2.6"/><circle cx="15" cy="70" r="2.6"/></g>']
                    : [40, 80, streaks(40, 26, 0.36)];
            defs.push(`<pattern id="fall" width="${tile[0]}" height="${tile[1]}" patternUnits="userSpaceOnUse" patternTransform="rotate(${parts.fall === 'snow' ? 0 : 12})">${tile[2]}</pattern>`);
            art.push('<rect y="300" width="1600" height="340" fill="url(#fall)" mask="url(#below)"/>');
        }

        // fog: soft pale bands low in the sky
        if (parts.fog) {
            defs.push('<filter id="mist" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="14"/></filter>');
            art.push('<g fill="#e3e9f0" filter="url(#mist)">'
                + '<rect x="-60" y="270" width="1100" height="44" rx="22" opacity=".22"/>'
                + '<rect x="500" y="350" width="1200" height="56" rx="28" opacity=".26"/>'
                + '<rect x="-60" y="440" width="1300" height="60" rx="30" opacity=".3"/>'
                + '<rect x="300" y="530" width="1400" height="70" rx="35" opacity=".34"/></g>');
        }

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 640" width="1600" height="640" preserveAspectRatio="xMidYMid slice"><defs>${defs.join('')}</defs>${art.join('')}</svg>`;
    };
    const skies = new Map(); // "kind time" -> data: URL
    const skyUrl = (kind, time) => {
        const key = kind + ' ' + time;
        if (!skies.has(key)) skies.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(skySvg(kind, time)));
        return skies.get(key);
    };

    // Put a sky behind a panel; a change of weather fades the new sky in over
    // the old one.
    const setSky = (box, code, time) => {
        const kind = skyKind(code);
        const key = kind + ' ' + time;
        if (box.dataset.sky === key) return;
        const first = !box.dataset.sky;
        box.dataset.sky = key;
        const old = [...box.querySelectorAll('i')];
        const layer = document.createElement('i');
        layer.style.backgroundImage = `url("${skyUrl(kind, time)}")`;
        box.appendChild(layer);
        if (first) {
            layer.className = 'on';
            return;
        }
        void layer.offsetWidth; // start from transparent
        layer.className = 'on';
        setTimeout(() => old.forEach((o) => o.remove()), 1600);
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
                    <div class="hf-sky"></div>
                    <h2 class="hf-head">Now</h2>
                    <div class="hf-now-top">
                        <div class="hf-now-main">
                            <img class="hf-now-icon" alt="" draggable="false">
                            <div class="hf-preview" data-homer-preview><span class="material-icons" aria-hidden="true">live_tv</span></div>
                            <div class="hf-now-temp"></div>
                        </div>
                        <div class="hf-now-side">
                            <div class="hf-now-cond"></div>
                            <div class="hf-now-stats"></div>
                        </div>
                    </div>
                    <div class="hf-strip">
                        <div class="hf-strip-head"><span class="hf-strip-range"></span><span class="hf-key-rain"><i></i>Chance of rain</span></div>
                        <div class="hf-strip-cols"></div>
                    </div>
                </section>
                <section class="hf-panel hf-radar">
                    <div class="hf-radar-map">
                        <svg class="hf-radar-land" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
                        <div class="hf-radar-frames"></div>
                        <img class="hf-radar-roads" alt="" draggable="false">
                        <svg class="hf-radar-lines" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
                    </div>
                    <h2 class="hf-head">Radar<span class="hf-radar-name">Past hour</span></h2>
                    <div class="hf-radar-time"><span class="hf-radar-clock"></span><span class="hf-radar-ticks"></span></div>
                    <div class="hf-radar-off"><b></b><span></span></div>
                </section>
                <div class="hf-days">
                    ${'<section class="hf-panel hf-day"><div class="hf-sky"></div><div class="hf-day-body"></div></section>'.repeat(3)}
                </div>
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
        let fmt = null; // formatters in the place's own time zone

        const hourNow = () => clamp(Math.floor((Date.now() - fc.hours[0].at) / 3600000), 0, fc.hours.length - 1);
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
        // a label and its value (Now's readings, and each day's)
        const stat = (k, v) => (v ? `<div class="hf-stat"><span class="hf-stat-k">${esc(k)}</span><span class="hf-stat-v">${esc(v)}</span></div>` : '');
        const drawNowSky = () => setSky($('.hf-now .hf-sky'), fc.current.code, skyTime(Date.now(), fc.current.isDay, fc.days[0]));
        const drawNow = () => {
            const cur = fc.current;
            const { label, icon } = describe(cur.code, cur.isDay);
            $('.hf-now-temp').textContent = deg(cur.temp);
            const img = $('.hf-now-icon');
            const src = iconUrl(icon);
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            img.alt = label;
            $('.hf-now-cond').textContent = label;
            drawNowSky();

            const now = Date.now();
            const today = fc.days[0] || {};
            const tomorrow = fc.days[1] || {};
            const sun = now < today.sunrise ? ['Sunrise', today.sunrise]
                : now < today.sunset ? ['Sunset', today.sunset]
                    : ['Sunrise', tomorrow.sunrise];
            $('.hf-now-stats').innerHTML = [
                stat('Feels like', cur.feels == null ? '' : deg(cur.feels)),
                stat('Humidity', cur.humidity == null ? '' : `${cur.humidity}%`),
                stat('Wind', cur.wind == null ? '' : cur.wind < 1 ? 'Calm' : `${compass(cur.windFrom)} ${cur.wind} mph`),
                stat(sun[0], isFinite(sun[1]) ? fmt.time(sun[1]) : '')
            ].join('');
        };

        // ----- the next 14 hours, under Now -----
        // Now, then two hours at a time: a slot shows its first hour's
        // temperature, the wetter hour's conditions when rain is likely, and
        // the higher chance of rain of the two.
        const drawStrip = () => {
            const i0 = hourNow();
            const slots = [];
            for (let k = 0; k < SLOTS; k++) {
                const i = k === 0 ? i0 : i0 + 1 + (k - 1) * STEP;
                if (i >= fc.hours.length) break;
                slots.push({ i, hrs: fc.hours.slice(i, k === 0 ? i + 1 : i + STEP) });
            }
            const box = $('.hf-strip-cols');
            box.innerHTML = slots.map(({ i, hrs }, k) => {
                const h = hrs[0];
                const isNow = k === 0;
                const likely = hrs.filter((x) => wet(x.code) && x.pop >= 30);
                // the Now slot shows the current reading, same as the panel above it
                const code = isNow ? fc.current.code : likely.length ? Math.max(...likely.map((x) => x.code)) : h.code;
                const { label, icon } = describe(code, isNow ? fc.current.isDay : h.isDay);
                const pops = hrs.map((x) => x.pop).filter((v) => v != null);
                const pop = pops.length ? Math.round(Math.max(...pops)) : null;
                const newDay = k > 0 && dayOf(i) !== dayOf(slots[k - 1].i);
                const time = isNow ? 'Now' : newDay ? `${fmt.wdShort(h.at)} ${fmt.hour(h.at)}` : fmt.hour(h.at);
                return `
                    <div class="hf-slot${isNow ? ' now' : ''}${newDay ? ' new-day' : ''}" title="${esc(label)}">
                        <div class="hf-slot-time">${esc(time)}</div>
                        ${stillImg(icon, 'hf-slot-icon')}
                        <div class="hf-slot-temp">${deg(isNow ? fc.current.temp : h.temp)}</div>
                        <div class="hf-slot-pop${pop >= 10 ? '' : ' dry'}"><i></i>${pop == null ? '–' : pop + '%'}</div>
                    </div>`;
            }).join('');
            fillStills(box);
            $('.hf-strip-range').textContent = `Next ${Math.max(1, (slots.length - 1) * STEP)} hours`;
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
        // a panel a day, each on its daytime sky
        const drawDays = () => {
            stage.querySelectorAll('.hf-day').forEach((pane, k) => {
                const d = fc.days[k + 1];
                const body = pane.querySelector('.hf-day-body');
                pane.style.visibility = d ? '' : 'hidden';
                if (!d) return;
                const code = dayCode(k + 1);
                const { label, icon } = describe(code, true);
                setSky(pane.querySelector('.hf-sky'), code, 'day');
                const noon = d.at + 12 * 3600000;
                // the chance, and how much only when it's at all likely (a 2% day
                // can still add up to 0.1 in). Open-Meteo's amount is melted, so
                // a snowy day gets the chance alone.
                const snow = wetWord(code) === 'Snow';
                const rain = d.pop == null ? '' : `${Math.round(d.pop)}%${!snow && d.pop >= 10 && inches(d.precip) ? ` · ${inches(d.precip)}` : ''}`;
                const wind = d.wind == null ? '' : d.wind < 1 ? 'Calm' : `${compass(d.windFrom)} ${d.wind} mph`;
                body.innerHTML = `
                    <div class="hf-day-top"><span class="hf-day-name">${esc(fmt.weekday(noon))}</span><span class="hf-day-date">${esc(fmt.date(noon))}</span></div>
                    <div class="hf-day-mid">
                        ${stillImg(icon, 'hf-day-icon')}
                        <div class="hf-day-main">
                            <div class="hf-day-temps"><span class="hf-day-hi">${deg(d.hi)}</span><span class="hf-day-lo">${deg(d.lo)}</span></div>
                            <div class="hf-day-cond">${esc(label)}</div>
                        </div>
                    </div>
                    <div class="hf-day-facts">
                        ${stat(snow ? 'Snow' : 'Rain', rain)}${stat('Wind', wind)}
                        ${stat('Sunrise', isFinite(d.sunrise) ? fmt.time(d.sunrise) : '')}${stat('Sunset', isFinite(d.sunset) ? fmt.time(d.sunset) : '')}
                    </div>`;
                fillStills(body);
            });
        };

        // ----- radar -----
        const radarBox = $('.hf-radar');
        let radarFor = ''; // the place ("lat,lon") the panel is for
        let radar = null; // { ws, area, scale, map } for the place, once it has one
        let frames = []; // [{ at, img }], oldest first
        let frameAt = 0; // which one is showing
        let frameTimer = null;
        let radarToken = 0;
        const radarState = (s, title = '', text = '') => {
            radarBox.dataset.state = s; // loading | ready | off
            $('.hf-radar-off b').textContent = title;
            $('.hf-radar-off span').textContent = text;
        };
        const radarFailed = (who) => radarState('off', 'The radar didn\'t load',
            `${who} didn't answer. HOMER tries again every few minutes.`);

        // Play the loop: each picture for 300 ms, the newest for 1.5 s. Only
        // the one showing is visible; the rest wait, already decoded.
        const showFrame = (k) => {
            frames.forEach((f, i) => f.img.classList.toggle('on', i === k));
            $('.hf-radar-clock').textContent = frames[k] ? fmt.time(frames[k].at) : '';
            $('.hf-radar-ticks').querySelectorAll('i').forEach((t, i) => t.classList.toggle('on', i <= k));
        };
        const play = () => {
            clearTimeout(frameTimer);
            if (!alive || !frames.length) return;
            frameAt = Math.min(frameAt, frames.length - 1);
            showFrame(frameAt);
            const last = frameAt === frames.length - 1;
            frameTimer = setTimeout(() => {
                frameAt = last ? 0 : frameAt + 1;
                play();
            }, last ? 1500 : 300);
        };

        // the last hour of pictures; ones already here are kept, new ones are
        // swapped in once they've all loaded and decoded
        const loadFrames = async () => {
            if (!radar) return;
            const token = ++radarToken;
            const { ws, area, scale } = radar;
            try {
                const times = pickFrames(await radarTimes(ws));
                if (!times.length) throw new Error('no radar pictures');
                const have = new Map(frames.map((f) => [f.at, f]));
                const next = (await Promise.all(times.map((at) => have.get(at) || new Promise((resolve) => {
                    const img = new Image();
                    img.alt = '';
                    img.draggable = false;
                    img.onload = () => Promise.resolve(img.decode && img.decode()).catch(() => {}).then(() => resolve({ at, img }));
                    img.onerror = () => resolve(null);
                    img.src = frameUrl(ws, area.box, scale, at);
                })))).filter(Boolean);
                if (!alive || token !== radarToken) return;
                if (!next.length) throw new Error('no radar pictures loaded');
                const box = $('.hf-radar-frames');
                frames.filter((f) => !next.includes(f)).forEach((f) => f.img.remove());
                next.forEach((f) => { if (!f.img.isConnected) box.appendChild(f.img); });
                const fresh = !frames.length || frames[frames.length - 1].at !== next[next.length - 1].at;
                frames = next;
                $('.hf-radar-ticks').innerHTML = '<i></i>'.repeat(frames.length);
                if (fresh) frameAt = 0; // a new loop starts from the beginning
                radarState('ready');
                play();
            } catch (err) {
                if (!alive || token !== radarToken) return;
                console.warn('[HOMER Weather] radar', err);
                // keep the last good loop; the next round may work
                if (!frames.length) radarFailed('The National Weather Service');
            }
        };

        // the map: land, then (over the rain) county and state lines, the
        // interstates, the bigger towns, and the place itself
        const drawMap = (shapes, place) => {
            const { px } = radar.area;
            const path = (features) => features.map((f) => (f.geometry && f.geometry.rings || [])
                .map((ring) => 'M' + ring.map(([x, y]) => px(x, y).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z').join('')).join('');
            $('.hf-radar-land').innerHTML = `<path d="${path(shapes.states)}"/>`;
            // the place, and as many towns as fit around it without crowding
            const [cx, cy] = px(...radar.area.center);
            const name = place.mode === 'device' ? 'Here' : String(place.name || '').split(',')[0];
            const taken = [[cx - 8, cy - 14, cx + 16 + name.length * 10, cy + 14]];
            const clear = (b) => taken.every((t) => b[2] < t[0] - 6 || b[0] > t[2] + 6 || b[3] < t[1] - 4 || b[1] > t[3] + 4);
            const towns = [];
            shapes.towns.forEach((t) => {
                const a = t.attributes || {};
                if (towns.length >= 8 || !a.BASENAME || a.BASENAME === name) return;
                const [x, y] = px(...merc(parseFloat(a.CENTLAT), parseFloat(a.CENTLON)));
                const w = a.BASENAME.length * 8.4;
                // the name to the right of the dot, or else to the left; clear
                // of the panel's edges, its title, the time and other names
                const fits = (b) => b[0] >= SAFE_X[0] && b[2] <= SAFE_X[1] && b[1] >= 70 && b[3] <= MAP_H - 56 && clear(b);
                const right = [x - 5, y - 11, x + 10 + w, y + 11];
                const left = [x - 10 - w, y - 11, x + 5, y + 11];
                const b = fits(right) ? right : fits(left) ? left : null;
                if (!b) return;
                taken.push(b);
                const tx = b === right ? `x="${(x + 9).toFixed(1)}"` : `x="${(x - 9).toFixed(1)}" text-anchor="end"`;
                towns.push(`<circle class="town" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/><text ${tx} y="${(y + 5.5).toFixed(1)}">${esc(a.BASENAME)}</text>`);
            });
            $('.hf-radar-lines').innerHTML = `
                <path class="county" d="${path(shapes.counties)}"/>
                <path class="state" d="${path(shapes.states)}"/>
                ${towns.join('')}
                <circle class="here" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6"/>
                <text class="here" x="${(cx + 13).toFixed(1)}" y="${(cy + 6.5).toFixed(1)}">${esc(name)}</text>`;
        };

        const drawRadar = () => {
            const p = fc.place;
            if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') { radarState('off', 'Radar unavailable here'); return; }
            const key = p.lat.toFixed(2) + ',' + p.lon.toFixed(2);
            if (key === radarFor) return;
            radarFor = key;
            radarToken++;
            radar = null;
            clearTimeout(frameTimer);
            frames.forEach((f) => f.img.remove());
            frames = [];
            $('.hf-radar-land').innerHTML = '';
            $('.hf-radar-lines').innerHTML = '';
            $('.hf-radar-roads').removeAttribute('src');
            radarState('loading');
            // twice the detail on a screen with pixels to spare (a 4K TV)
            const scale = stage.getBoundingClientRect().height / 1080 * (window.devicePixelRatio || 1) > 1.25 ? 2 : 1;
            const area = mapArea(p.lat, p.lon);
            radar = { ws: radarRegion(p.lat, p.lon), area, scale, map: false };
            loadMap(p, key).then((ok) => { if (ok) loadFrames(); });
        };
        // The map, which also says whether the place is in the US. Without it
        // (the Census server didn't answer) a place that's roughly in the US
        // still gets the rain, with just the place marked, and the map is
        // tried again with the next loop.
        const loadMap = (p, key) => mapShapes(p.lat, p.lon, radar.area.box).then((shapes) => {
            if (!alive || radarFor !== key) return false;
            // the NWS only covers the US: somewhere no county holds isn't
            if (!inside(radar.area.center[0], radar.area.center[1], shapes.counties)) {
                radar = null;
                clearTimeout(frameTimer);
                radarState('off', 'Radar unavailable here', 'The National Weather Service\'s radar covers the US and its territories.');
                return false;
            }
            radar.map = true;
            drawMap(shapes, p);
            $('.hf-radar-roads').src = roadsUrl(radar.area.box);
            return true;
        }, (err) => {
            if (!alive || radarFor !== key) return false;
            console.warn('[HOMER Weather] radar map', err);
            if (!roughlyUS(p.lat, p.lon)) {
                radarFor = ''; // look again next round
                radar = null;
                radarFailed('The Census Bureau\'s map server');
                return false;
            }
            drawMap({ counties: [], states: [], towns: [] }, p);
            return true;
        });
        // a fresh loop every 5 minutes while the screen is up
        const radarTimer = setInterval(() => {
            if (!fc) return;
            if (!radar) {
                if (!radarFor) drawRadar();
                return;
            }
            if (!radar.map) loadMap(fc.place, radarFor);
            loadFrames();
        }, RADAR_MS);

        // ----- legend -----
        const updateLegend = () => {
            const items = [];
            if (status === 'error') items.push({ key: 'OK', label: 'Try again', action: 'ok' });
            if (docked()) items.push({ key: 'F', label: 'Full screen', action: 'fullscreen' });
            items.push('spacer',
                { key: 'H', label: 'Home', action: 'home' },
                { key: 'ESC', label: 'Back', action: 'back' });
            $('.hf-legend').innerHTML = items.map((i) => (i === 'spacer'
                ? '<span class="spacer"></span>'
                : `<span data-action="${i.action}"><span class="hf-key">${esc(i.key)}</span>${esc(i.label)}</span>`)).join('');
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
            drawStrip();
            drawDays();
            drawRadar();
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
        // a new hour moves the strip along (and the sentence and sun time with
        // it); dawn and dusk come and go on their own time
        let lastHour = -1;
        const hourTimer = setInterval(() => {
            if (!fc || status !== 'ready') return;
            drawNowSky();
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
            // nothing on this screen moves, but the arrows mustn't reach the page underneath
            const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', ' '];
            if (!handled.includes(k)) return; // F (full screen), G (the guide) and the rest pass through
            eat(ev);
            if ((k === 'Enter' || k === ' ') && !ev.repeat) ok();
        };

        // Jellyfin's player turns the wheel into volume, and the page underneath
        // would scroll: every wheel event is ours while this screen is up.
        const onWheel = (ev) => {
            if (document.getElementById('cg-root')) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
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
                clearInterval(radarTimer);
                clearTimeout(frameTimer);
                radarToken++;
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
        // for previews: an illustrated sky as a data: URL (kind: clear, mostly,
        // partly, overcast, fog, rain, sleet, snow, storm; time: day, dawn,
        // dusk, night)
        _skyUrl: skyUrl,
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
