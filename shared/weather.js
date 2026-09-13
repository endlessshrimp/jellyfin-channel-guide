/*
 * HOMER weather bug: current temperature and conditions for Kaufman, TX
 * (75142), shown to the left of each screen's clock. Data from Open-Meteo
 * (free, no key). Icons are Meteocons by Bas Milius (MIT, see shared/wx/LICENSE),
 * with the raindrop blue brightened (#0A5AD4 -> #4FAEFF) to read on HOMER navy.
 *
 * Screens call HomerWeather.attach(clockEl) and run the returned function on
 * teardown. Every attached bug shares one fetch, refreshed every 10 minutes.
 */
(() => {
    if (window.HomerWeather) return;

    const src = (document.currentScript && document.currentScript.src) || '';
    const BASE = src.replace(/shared\/weather\.js(\?.*)?$/, '');
    const QUERY = (src.match(/\?.*$/) || [''])[0];

    const PLACE = 'Kaufman, TX';
    const URL = 'https://api.open-meteo.com/v1/forecast?latitude=32.589&longitude=-96.3086'
        + '&current=temperature_2m,weather_code,is_day'
        + '&daily=temperature_2m_max,temperature_2m_min'
        + '&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=1';
    const REFRESH_MS = 10 * 60 * 1000;

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
        bug.wx.title = `${label} · ${PLACE}`;
        group.classList.add('homer-wx-ready');
    };

    const load = () => {
        if (inflight) return inflight;
        inflight = fetch(URL, { cache: 'no-store' })
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
        _describe: describe, // for previews
        _iconUrl: iconUrl,
    };
})();
