/*
 * HOMER weather bug: current temperature and conditions, shown to the left of
 * each screen's clock. Data from Open-Meteo (free, no key). Icons are Meteocons by Bas Milius (MIT, see shared/wx/LICENSE),
 * with the raindrop blue brightened (#0A5AD4 -> #4FAEFF) to read on HOMER navy.
 *
 * Screens call HomerWeather.attach(clockEl) and run the returned function on
 * teardown. Every attached bug shares one fetch, refreshed every 10 minutes.
 *
 * Where: saved per device (localStorage), set from HOMER Settings.
 *   device  the browser's own location. Browsers only share it over HTTPS
 *           (or localhost), so on plain http this falls back to the ZIP.
 *   zip     a US ZIP code, looked up once through Open-Meteo's geocoder.
 * With nothing saved, a browser that can share its location uses it, and
 * anything else uses 75142 (Kaufman, TX).
 */
(() => {
    if (window.HomerWeather) return;

    const src = (document.currentScript && document.currentScript.src) || '';
    const BASE = src.replace(/shared\/weather\.js(\?.*)?$/, '');
    const QUERY = (src.match(/\?.*$/) || [''])[0];

    const REFRESH_MS = 10 * 60 * 1000;
    const forecastUrl = (lat, lon) => 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
        + '&current=temperature_2m,weather_code,is_day'
        + '&daily=temperature_2m_max,temperature_2m_min'
        + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1';

    // ---------- Location ----------

    const KEY = 'homer-weather-location';
    const DEFAULT_ZIP = { mode: 'zip', zip: '75142', name: 'Kaufman, TX', lat: 32.589, lon: -96.3089 };
    const STATES = {
        Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
        Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', 'Washington, D.C.': 'DC',
        Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN',
        Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
        Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
        Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
        'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
        Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
        'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
        Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR'
    };

    // browsers only hand out a location on a secure page
    const canUseDevice = () => !!(window.isSecureContext && navigator.geolocation);

    const readSaved = () => {
        try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
    };
    const writeSaved = (v) => {
        try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
    };
    // the last ZIP this device picked, or Kaufman
    const savedZip = () => {
        const s = readSaved();
        return s && s.zip && typeof s.lat === 'number' ? s : DEFAULT_ZIP;
    };
    const wantedMode = () => {
        const s = readSaved();
        if (s && s.mode === 'zip') return 'zip';
        if (s && s.mode === 'device') return 'device';
        return canUseDevice() ? 'device' : 'zip';
    };

    let deviceState = ''; // '' | 'denied' | 'unavailable'
    const devicePosition = () => new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (p) => { deviceState = ''; resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
            (err) => { deviceState = err && err.code === 1 ? 'denied' : 'unavailable'; resolve(null); },
            { maximumAge: 30 * 60 * 1000, timeout: 15000 }
        );
    });

    // where the weather actually comes from right now
    let place = null; // { mode, lat, lon, name, zip? }
    const resolvePlace = async () => {
        if (wantedMode() === 'device' && canUseDevice()) {
            const pos = await devicePosition();
            if (pos) return { mode: 'device', name: 'This device\'s location', ...pos };
        }
        const z = savedZip();
        return { mode: 'zip', zip: z.zip, name: z.name, lat: z.lat, lon: z.lon };
    };

    // US ZIP -> { zip, name, lat, lon } through Open-Meteo's geocoder
    const lookupZip = async (zip) => {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&countryCode=US&name='
            + encodeURIComponent(zip));
        if (!r.ok) throw new Error('lookup failed');
        const hits = ((await r.json()).results || []);
        const hit = hits.find((h) => (h.postcodes || []).includes(zip)) || hits[0];
        if (!hit) return null;
        const st = STATES[hit.admin1] || hit.admin1 || '';
        return { zip, name: st ? `${hit.name}, ${st}` : hit.name, lat: hit.latitude, lon: hit.longitude };
    };

    // WMO weather code -> [label, day icon, night icon]
    const CODES = {
        0: ['Clear', 'clear-day', 'clear-night'],
        1: ['Mostly clear', 'mostly-clear-day', 'mostly-clear-night'],
        2: ['Partly cloudy', 'partly-cloudy-day', 'partly-cloudy-night'],
        3: ['Overcast', 'overcast', 'overcast'],
        45: ['Fog', 'fog-day', 'fog-night'],
        48: ['Freezing fog', 'fog-day', 'fog-night'],
        51: ['Light drizzle', 'drizzle'],
        53: ['Drizzle', 'drizzle'],
        55: ['Heavy drizzle', 'drizzle'],
        56: ['Freezing drizzle', 'sleet'],
        57: ['Freezing drizzle', 'sleet'],
        61: ['Light rain', 'rain'],
        63: ['Rain', 'rain'],
        65: ['Heavy rain', 'extreme-rain'],
        66: ['Freezing rain', 'sleet'],
        67: ['Freezing rain', 'sleet'],
        71: ['Light snow', 'snow'],
        73: ['Snow', 'snow'],
        75: ['Heavy snow', 'snow'],
        77: ['Snow grains', 'snow'],
        80: ['Showers', 'partly-cloudy-day-rain', 'partly-cloudy-night-rain'],
        81: ['Showers', 'partly-cloudy-day-rain', 'partly-cloudy-night-rain'],
        82: ['Heavy showers', 'extreme-rain'],
        85: ['Snow showers', 'partly-cloudy-day-snow', 'partly-cloudy-night-snow'],
        86: ['Snow showers', 'partly-cloudy-day-snow', 'partly-cloudy-night-snow'],
        95: ['Thunderstorms', 'thunderstorms-rain'],
        96: ['Thunderstorms with hail', 'thunderstorms-hail'],
        99: ['Thunderstorms with hail', 'thunderstorms-hail'],
    };

    const describe = (code, isDay) => {
        const c = CODES[code] || CODES[3];
        return { label: c[0], icon: (!isDay && c[2]) || c[1] };
    };
    const iconUrl = (name) => BASE + 'shared/wx/' + name + '.svg' + QUERY;

    let data = null;
    let fetchedAt = 0;
    let timer = null;
    let inflight = null;
    const bugs = new Set();

    const paint = (bug) => {
        const group = bug.group;
        if (!data) { group.classList.remove('homer-wx-ready'); return; }
        const { label, icon } = describe(data.code, data.isDay);
        const src = iconUrl(icon);
        if (bug.img.getAttribute('src') !== src) bug.img.setAttribute('src', src);
        bug.img.alt = label;
        bug.temp.textContent = data.temp + '°';
        bug.hi.textContent = data.hi + '°';
        bug.lo.textContent = data.lo + '°';
        bug.wx.title = place ? `${label} · ${place.name}` : label;
        group.classList.add('homer-wx-ready');
    };

    const load = () => {
        if (inflight) return inflight;
        inflight = resolvePlace()
            .then((p) => { place = p; return fetch(forecastUrl(p.lat, p.lon), { cache: 'no-store' }); })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
            .then((j) => {
                const cur = j.current || {};
                const day = j.daily || {};
                if (typeof cur.temperature_2m !== 'number') throw new Error('no temperature');
                data = {
                    temp: Math.round(cur.temperature_2m),
                    code: cur.weather_code,
                    isDay: cur.is_day === 1,
                    hi: Math.round((day.temperature_2m_max || [])[0]),
                    lo: Math.round((day.temperature_2m_min || [])[0]),
                };
                fetchedAt = Date.now();
            })
            .catch(() => {
                // keep showing the last good reading for up to an hour, then hide
                if (Date.now() - fetchedAt > 60 * 60 * 1000) data = null;
            })
            .finally(() => {
                inflight = null;
                bugs.forEach(paint);
            });
        return inflight;
    };

    // start over for a new location (after any fetch already on its way)
    const reload = async () => {
        if (inflight) await inflight;
        data = null;
        return load();
    };

    const build = (clockEl) => {
        const group = document.createElement('div');
        group.className = 'homer-wx-group';
        group.innerHTML = `
            <div class="homer-wx">
                <img class="homer-wx-icon" alt="" draggable="false">
                <div class="homer-wx-text">
                    <div class="homer-wx-temp"></div>
                    <div class="homer-wx-hilo"><span class="homer-wx-k">H</span><span class="homer-wx-hi"></span><span class="homer-wx-k">L</span><span class="homer-wx-lo"></span></div>
                </div>
            </div>
            <div class="homer-wx-rule" aria-hidden="true"></div>`;
        clockEl.parentNode.insertBefore(group, clockEl);
        group.appendChild(clockEl);
        const q = (s) => group.querySelector(s);
        return {
            group, clockEl,
            wx: q('.homer-wx'), img: q('.homer-wx-icon'), temp: q('.homer-wx-temp'),
            hi: q('.homer-wx-hi'), lo: q('.homer-wx-lo'),
        };
    };

    window.HomerWeather = {
        attach(clockEl) {
            if (!clockEl || !clockEl.parentNode) return () => {};
            const bug = build(clockEl);
            bugs.add(bug);
            paint(bug);
            if (!data || Date.now() - fetchedAt > REFRESH_MS) load();
            if (!timer) timer = setInterval(load, REFRESH_MS);
            return () => {
                bugs.delete(bug);
                if (!bugs.size) { clearInterval(timer); timer = null; }
            };
        },
        refresh: load,

        // ----- for HOMER Settings -----
        canUseDevice,
        deviceState: () => deviceState,
        // what Settings shows as picked: 'device' or 'zip'
        mode: () => (wantedMode() === 'device' && canUseDevice() ? 'device' : 'zip'),
        zip: () => savedZip(),
        // the place in use, once the first reading is in
        place: () => place,
        useDevice() {
            writeSaved(Object.assign({}, savedZip(), { mode: 'device' }));
            return reload();
        },
        // resolves to the saved place, or null for a ZIP that doesn't exist
        async useZip(zip) {
            zip = String(zip || '').trim();
            if (!/^\d{5}$/.test(zip)) return null;
            const hit = await lookupZip(zip);
            if (!hit) return null;
            writeSaved({ mode: 'zip', ...hit });
            await reload();
            return hit;
        },

        _describe: describe, // for previews
        _iconUrl: iconUrl,
    };
})();
